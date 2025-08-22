\
const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const pool = require("./src/db");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "secret123";

app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.static("public"));

// ===== helpers =====
function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Not logged in" });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}
async function getActiveGameId() {
  const r = await pool.query("SELECT id FROM games WHERE active=true LIMIT 1");
  return r.rows[0]?.id || null;
}
async function getLastClosedGameId() {
  const r = await pool.query("SELECT id FROM games WHERE active=false ORDER BY id DESC LIMIT 1");
  return r.rows[0]?.id || null;
}

// ===== auth (sans PIN pour admin : sélection simple) =====
app.post("/api/auth/select", async (req, res) => {
  try {
    const { playerId } = req.body || {};
    if (!playerId) return res.status(400).json({ error: "Missing playerId" });
    const r = await pool.query("SELECT id, name, role FROM players WHERE id=$1", [playerId]);
    if (!r.rows.length) return res.status(404).json({ error: "Player not found" });
    const p = r.rows[0];
    const token = jwt.sign({ id: p.id, name: p.name, role: p.role }, SECRET, { expiresIn: "30d" });
    const isProd = process.env.NODE_ENV === "production";
    res.cookie("token", token, { httpOnly: true, sameSite: "lax", secure: isProd, maxAge: 1000*60*60*24*30 });
    res.json({ ok: true, user: { id: p.id, name: p.name, role: p.role } });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post("/api/auth/logout", (req, res) => { res.clearCookie("token"); res.json({ ok: true }); });
app.get("/api/auth/me", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({ user: null });
  try { res.json({ user: jwt.verify(token, SECRET) }); }
  catch { res.json({ user: null }); }
});

// ===== players =====
app.get("/api/players", async (req, res) => {
  const r = await pool.query("SELECT id,name,role FROM players ORDER BY name ASC");
  res.json(r.rows);
});

// ===== write paper =====
app.post("/api/paper", auth, async (req, res) => {
  try {
    const gameId = await getActiveGameId();
    if (!gameId) return res.status(400).json({ error: "No active game" });
    const { targetName, type, message } = req.body || {};
    if (!targetName || !type || !message) return res.status(400).json({ error: "Missing fields" });
    // target must exist (admin inclus)
    const t = await pool.query("SELECT name FROM players WHERE LOWER(name)=LOWER($1) LIMIT 1", [String(targetName).trim()]);
    if (!t.rows.length) return res.status(400).json({ error: "Target not found" });
    const r = await pool.query(
      "INSERT INTO papers (game_id, author_id, target, type, message) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [gameId, req.user.id, t.rows[0].name, type, message]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get("/api/my/last-paper", auth, async (req, res) => {
  const gameId = await getActiveGameId();
  if (!gameId) return res.json(null);
  const r = await pool.query("SELECT * FROM papers WHERE game_id=$1 AND author_id=$2 ORDER BY created_at DESC LIMIT 1", [gameId, req.user.id]);
  res.json(r.rows[0] || null);
});
app.delete("/api/my/last-paper", auth, async (req, res) => {
  try {
    const gameId = await getActiveGameId();
    if (!gameId) return res.status(400).json({ error: "No active game" });
    const r = await pool.query(
      "DELETE FROM papers WHERE id = (SELECT id FROM papers WHERE game_id=$1 AND author_id=$2 ORDER BY created_at DESC LIMIT 1) RETURNING *",
      [gameId, req.user.id]
    );
    if (!r.rows.length) return res.status(409).json({ error: "No deletable paper (not latest)" });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ===== admin views (active or last closed) =====
app.get("/api/admin/papers", auth, adminOnly, async (req, res) => {
  let gameId = await getActiveGameId();
  if (!gameId) gameId = await getLastClosedGameId();
  if (!gameId) return res.json([]);
  const r = await pool.query(
    `SELECT p.*, pl.name AS author_name
     FROM papers p
     JOIN players pl ON pl.id=p.author_id
     WHERE p.game_id=$1
     ORDER BY p.created_at ASC`, [gameId]
  );
  res.json(r.rows);
});

app.post("/api/game/close", auth, adminOnly, async (req, res) => {
  const r = await pool.query("UPDATE games SET active=false WHERE active=true RETURNING id");
  res.json({ ok: true, closedCount: r.rowCount });
});
app.post("/api/game/new", auth, adminOnly, async (req, res) => {
  await pool.query("UPDATE games SET active=false WHERE active=true");
  const r = await pool.query("INSERT INTO games (active) VALUES (true) RETURNING id");
  res.json({ ok: true, gameId: r.rows[0].id });
});

// ===== reading flow (equitable + one-by-one reveal/skip) =====

// Migration helper: ensure columns exist
async function ensureReadAssignmentsColumns(){
  await pool.query(`ALTER TABLE read_assignments ADD COLUMN IF NOT EXISTS revealed BOOLEAN DEFAULT false;`);
  await pool.query(`ALTER TABLE read_assignments ADD COLUMN IF NOT EXISTS consumed BOOLEAN DEFAULT false;`);
  await pool.query(`ALTER TABLE read_assignments ADD COLUMN IF NOT EXISTS read_order INT;`);
  await pool.query(`ALTER TABLE papers ADD COLUMN IF NOT EXISTS revealed BOOLEAN DEFAULT false;`);
}

// Start reading: close + assign equitably to authors-only (including admin if authored)
app.post("/api/admin/reading/start", auth, adminOnly, async (req, res) => {
  try {
    await ensureReadAssignmentsColumns();

    const gameId = await getActiveGameId();
    if (!gameId) return res.status(400).json({ error: "No active game" });

    await pool.query("UPDATE games SET active=false WHERE id=$1", [gameId]);

    await pool.query(`DELETE FROM read_assignments WHERE paper_id IN (SELECT id FROM papers WHERE game_id=$1)`, [gameId]);

    const papers = (await pool.query(`SELECT id FROM papers WHERE game_id=$1 ORDER BY id ASC`, [gameId])).rows.map(r=>r.id);
    if (!papers.length) return res.json({ ok: true, assigned: 0 });

    // Eligible readers = players who authored at least one paper in this game (admin inclus)
    const readers = (await pool.query(
      `SELECT pl.id
       FROM players pl
       WHERE EXISTS (SELECT 1 FROM papers p WHERE p.game_id=$1 AND p.author_id=pl.id)
       ORDER BY pl.name ASC`, [gameId]
    )).rows.map(r=>r.id);

    if (!readers.length) {
      // Fallback: no eligible authors; assign to all players to avoid empty lots
      const all = await pool.query(`SELECT id FROM players ORDER BY name ASC`);
      const allIds = all.rows.map(r=>r.id);
      if (!allIds.length) return res.json({ ok: true, assigned: 0 });
      let idx = 0, order = 1;
      for (const pid of shuffle(papers)) {
        const readerId = allIds[idx % allIds.length];
        idx++;
        await pool.query(`INSERT INTO read_assignments (paper_id, reader_id, read_order, revealed, consumed) VALUES ($1,$2,$3,false,false)`, [pid, readerId, order++]);
      }
      return res.json({ ok: true, assigned: papers.length, readers: allIds.length, mode: "fallback_all_players" });
    }

    // Equitable distribution round-robin to eligible readers
    let idx = 0, order = 1;
    for (const pid of shuffle(papers)) {
      const readerId = readers[idx % readers.length];
      idx++;
      await pool.query(`INSERT INTO read_assignments (paper_id, reader_id, read_order, revealed, consumed) VALUES ($1,$2,$3,false,false)`, [pid, readerId, order++]);
    }

    res.json({ ok: true, assigned: papers.length, readers: readers.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

function shuffle(arr){
  const a = [...arr];
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

// Next-to-read for current user (from last closed game)
app.get("/api/reading/next", auth, async (req, res) => {
  try {
    await ensureReadAssignmentsColumns();
    const gameId = await getLastClosedGameId();
    if (!gameId) return res.json({ done: true });

    const r = await pool.query(
      `SELECT ra.id AS assignment_id, p.id AS paper_id, p.type, p.target, p.message, ra.revealed, ra.consumed
       FROM read_assignments ra
       JOIN papers p ON p.id = ra.paper_id
       WHERE p.game_id=$1 AND ra.reader_id=$2 AND ra.consumed=false
       ORDER BY ra.read_order ASC, ra.id ASC
       LIMIT 1`,
      [gameId, req.user.id]
    );
    if (!r.rows.length) return res.json({ done: true });
    res.json({ done: false, item: r.rows[0] });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Reveal author for an assignment
app.post("/api/reading/reveal", auth, async (req, res) => {
  try {
    const { assignmentId } = req.body || {};
    if (!assignmentId) return res.status(400).json({ error: "Missing assignmentId" });
    await ensureReadAssignmentsColumns();
    const gameId = await getLastClosedGameId();
    if (!gameId) return res.status(400).json({ error: "No closed game" });

    // Verify ownership
    const r = await pool.query(
      `SELECT ra.id, p.id as paper_id, a.name as author_name
       FROM read_assignments ra
       JOIN papers p ON p.id = ra.paper_id
       JOIN players a ON a.id = p.author_id
       WHERE ra.id=$1 AND ra.reader_id=$2 AND p.game_id=$3`,
      [assignmentId, req.user.id, gameId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Assignment not found" });

    const { paper_id, author_name } = r.rows[0];
    await pool.query(`UPDATE read_assignments SET revealed=true, consumed=true WHERE id=$1`, [assignmentId]);
    await pool.query(`UPDATE papers SET revealed=true WHERE id=$1`, [paper_id]);

    res.json({ ok: true, author: author_name });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Skip current item (do not reveal)
app.post("/api/reading/skip", auth, async (req, res) => {
  try {
    const { assignmentId } = req.body || {};
    if (!assignmentId) return res.status(400).json({ error: "Missing assignmentId" });
    await ensureReadAssignmentsColumns();
    const gameId = await getLastClosedGameId();
    if (!gameId) return res.status(400).json({ error: "No closed game" });

    const r = await pool.query(
      `UPDATE read_assignments ra
       SET consumed=true
       FROM papers p
       WHERE ra.id=$1 AND ra.reader_id=$2 AND p.id=ra.paper_id AND p.game_id=$3
       RETURNING ra.id`,
      [assignmentId, req.user.id, gameId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Assignment not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Legacy list (optional)
app.get("/api/reading/lot", auth, async (req, res) => {
  try {
    await ensureReadAssignmentsColumns();
    const gameId = await getLastClosedGameId();
    if (!gameId) return res.json([]);
    const r = await pool.query(
      `SELECT ra.id as assignment_id, p.id, p.type, p.target, p.message, ra.revealed, ra.consumed
       FROM read_assignments ra
       JOIN papers p ON p.id = ra.paper_id
       WHERE p.game_id=$1 AND ra.reader_id=$2
       ORDER BY ra.read_order ASC, ra.id ASC`,
      [gameId, req.user.id]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// health
app.get("/api/health-db", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW()");
    res.json({ ok: true, now: r.rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

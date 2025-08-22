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
  return r.rows[0]?.id;
}

// Auth: select player (no PIN)
app.post("/api/auth/select", async (req, res) => {
  try {
    const { playerId } = req.body || {};
    if (!playerId) return res.status(400).json({ error: "Missing playerId" });
    const r = await pool.query("SELECT id, name, role FROM players WHERE id=$1", [playerId]);
    if (!r.rows.length) return res.status(404).json({ error: "Player not found" });
    const p = r.rows[0];
    if (p.role === "admin") return res.status(401).json({ error: "Admin requires PIN" });

    const token = jwt.sign({ id: p.id, name: p.name, role: p.role }, SECRET, { expiresIn: "30d" });
    const isProd = process.env.NODE_ENV === "production";
    res.cookie("token", token, { httpOnly: true, sameSite: "lax", secure: isProd, maxAge: 1000*60*60*24*30 });
    res.json({ ok: true, user: p });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Auth: admin with PIN
app.post("/api/auth/admin-login", async (req, res) => {
  try {
    let { name, pin } = req.body || {};
    if (!name || !pin) return res.status(400).json({ error: "Missing name/pin" });
    name = String(name).trim();
    const r = await pool.query("SELECT * FROM players WHERE LOWER(name)=LOWER($1) AND role='admin' LIMIT 1", [name]);
    if (!r.rows.length) return res.status(401).json({ error: "Admin not found" });
    const admin = r.rows[0];
    if (String(admin.pin) !== String(pin)) return res.status(401).json({ error: "Bad admin PIN" });
    const token = jwt.sign({ id: admin.id, name: admin.name, role: admin.role }, SECRET, { expiresIn: "12h" });
    const isProd = process.env.NODE_ENV === "production";
    res.cookie("token", token, { httpOnly: true, sameSite: "lax", secure: isProd, maxAge: 1000*60*60*12 });
    res.json({ ok: true, user: { id: admin.id, name: admin.name, role: admin.role } });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
app.post("/api/auth/logout", (req, res) => { res.clearCookie("token"); res.json({ ok: true }); });
app.get("/api/auth/me", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({ user: null });
  try { res.json({ user: jwt.verify(token, SECRET) }); } catch { res.json({ user: null }); }
});

// Players list
app.get("/api/players", async (req, res) => {
  const r = await pool.query("SELECT id, name, role FROM players ORDER BY name ASC");
  res.json(r.rows);
});

// Write paper (only when game active)
app.post("/api/paper", auth, async (req, res) => {
  try {
    const gameId = await getActiveGameId();
    if (!gameId) return res.status(400).json({ error: "No active game" });
    const g = await pool.query("SELECT active FROM games WHERE id=$1", [gameId]);
    if (!g.rows[0].active) return res.status(400).json({ error: "Game closed" });
    const { targetName, type, message } = req.body || {};
    if (!targetName || !type || !message) return res.status(400).json({ error: "Missing fields" });
    const t = await pool.query("SELECT name FROM players WHERE LOWER(name)=LOWER($1) LIMIT 1", [String(targetName).trim()]);
    if (!t.rows.length) return res.status(400).json({ error: "Target not in players list" });
    const r = await pool.query(
      "INSERT INTO papers (game_id, author_id, target, type, message) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [gameId, req.user.id, t.rows[0].name, type, message]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// My last paper
app.get("/api/my/last-paper", auth, async (req, res) => {
  const gameId = await getActiveGameId();
  if (!gameId) return res.json(null);
  const r = await pool.query("SELECT * FROM papers WHERE game_id=$1 AND author_id=$2 ORDER BY created_at DESC LIMIT 1",
    [gameId, req.user.id]);
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
    res.json({ ok: true, deleted: r.rows[0] });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Admin: all papers
app.get("/api/admin/papers", auth, adminOnly, async (req, res) => {
  const gameId = await getActiveGameId();
  if (!gameId) return res.json([]);
  const r = await pool.query(
    "SELECT p.*, pl.name AS author_name FROM papers p JOIN players pl ON pl.id=p.author_id WHERE p.game_id=$1 ORDER BY p.created_at ASC",
    [gameId]
  );
  res.json(r.rows);
});

// Admin: start reading (close game + assign lots)
app.post("/api/admin/reading/start", auth, adminOnly, async (req, res) => {
  try {
    const gameId = await getActiveGameId();
    if (!gameId) return res.status(400).json({ error: "No active game" });
    await pool.query("UPDATE games SET active=false WHERE id=$1", [gameId]);
    await pool.query("DELETE FROM read_assignments WHERE paper_id IN (SELECT id FROM papers WHERE game_id=$1)", [gameId]);
    const papers = (await pool.query("SELECT id FROM papers WHERE game_id=$1 ORDER BY id ASC", [gameId])).rows.map(r=>r.id);
    const players = (await pool.query("SELECT id FROM players ORDER BY name ASC")).rows.map(r=>r.id);
    if (!papers.length || !players.length) return res.json({ ok: true, assigned: 0 });
    for (let i = papers.length - 1; i > 0; i--) { const j = Math.floor(Math.random()* (i+1)); [papers[i], papers[j]] = [papers[j], papers[i]]; }
    const batchSize = 3;
    let readerIdx = 0;
    for (let i=0;i<papers.length;i+=batchSize) {
      const lot = papers.slice(i, i+batchSize);
      const readerId = players[readerIdx % players.length];
      readerIdx++;
      for (const pid of lot) await pool.query("INSERT INTO read_assignments (paper_id, reader_id) VALUES ($1,$2)", [pid, readerId]);
    }
    res.json({ ok: true, assigned: papers.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Clôturer la partie en cours (admin)
app.post("/api/game/close", auth, adminOnly, async (req, res) => {
  try {
    const r = await pool.query("UPDATE games SET active=false WHERE active=true RETURNING id");
    res.json({ ok: true, closedCount: r.rowCount });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Créer une nouvelle partie (admin)
// Ferme d'abord l'éventuelle partie active, puis crée une nouvelle active=true
app.post("/api/game/new", auth, adminOnly, async (req, res) => {
  try {
    await pool.query("UPDATE games SET active=false WHERE active=true");
    const r = await pool.query("INSERT INTO games (active) VALUES (true) RETURNING id");
    res.json({ ok: true, gameId: r.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});


// Reading: my lot (only after game is closed)
app.get("/api/reading/lot", auth, async (req, res) => {
  try {
    const gameId = await getActiveGameId();
    if (!gameId) return res.json([]);
    const g = await pool.query("SELECT active FROM games WHERE id=$1", [gameId]);
    if (g.rows[0].active) return res.json([]);
    const r = await pool.query(
      `SELECT p.id, p.type, p.target, p.message
       FROM read_assignments ra JOIN papers p ON p.id = ra.paper_id
       WHERE p.game_id=$1 AND ra.reader_id=$2 ORDER BY ra.id ASC`,
      [gameId, req.user.id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Debug
app.get("/api/health-db", async (req, res) => {
  try { const r = await pool.query("SELECT NOW()"); res.json({ ok: true, now: r.rows[0] }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// État global (partie active + compteurs)
app.get("/api/debug/status", async (req, res) => {
  try {
    const g = await pool.query("SELECT id, active FROM games ORDER BY id DESC LIMIT 1");
    const active = g.rows[0]?.active ?? null;
    const gameId = g.rows[0]?.id ?? null;
    const papers = gameId ? (await pool.query("SELECT COUNT(*)::int AS c FROM papers WHERE game_id=$1", [gameId])).rows[0].c : 0;
    const assigns = gameId ? (await pool.query(
      "SELECT COUNT(*)::int AS c FROM read_assignments WHERE paper_id IN (SELECT id FROM papers WHERE game_id=$1)", [gameId]
    )).rows[0].c : 0;
    res.json({ gameId, active, papers, assigns });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Liste brute des assignations (admin)
app.get("/api/debug/assignments", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
    const r = await pool.query(`
      SELECT ra.id, ra.reader_id, p.id AS paper_id, p.target, p.type, p.message
      FROM read_assignments ra
      JOIN papers p ON p.id = ra.paper_id
      ORDER BY ra.id ASC
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Voir mon lot tel quel (même que /api/reading/lot mais verbose)
app.get("/api/debug/my-lot", auth, async (req, res) => {
  try {
    const g = await pool.query("SELECT id, active FROM games WHERE active=false ORDER BY id DESC LIMIT 1");
    if (!g.rows.length) return res.json({ note: "Aucune partie clôturée", lot: [] });
    const gameId = g.rows[0].id;
    const r = await pool.query(`
      SELECT p.id, p.type, p.target, p.message
      FROM read_assignments ra
      JOIN papers p ON p.id = ra.paper_id
      WHERE p.game_id=$1 AND ra.reader_id=$2
      ORDER BY ra.id ASC
    `, [gameId, req.user.id]);
    res.json({ user: req.user, lot: r.rows });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});


app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
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

// Assure les colonnes nécessaires (idempotent)
async function ensureReadAssignmentsColumns() {
  await pool.query(`CREATE TABLE IF NOT EXISTS read_assignments (
    id SERIAL PRIMARY KEY,
    paper_id INT REFERENCES papers(id) ON DELETE CASCADE,
    reader_id INT REFERENCES players(id),
    revealed BOOLEAN DEFAULT false,
    consumed BOOLEAN DEFAULT false,
    read_order INT
  );`);
  await pool.query(`ALTER TABLE read_assignments ADD COLUMN IF NOT EXISTS revealed BOOLEAN DEFAULT false;`);
  await pool.query(`ALTER TABLE read_assignments ADD COLUMN IF NOT EXISTS consumed BOOLEAN DEFAULT false;`);
  await pool.query(`ALTER TABLE read_assignments ADD COLUMN IF NOT EXISTS read_order INT;`);
  await pool.query(`ALTER TABLE papers ADD COLUMN IF NOT EXISTS revealed BOOLEAN DEFAULT false;`);
}

function shuffle(arr){
  const a = [...arr];
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}


// ---- helpers
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

// ---- auth routes (players sans PIN; admin avec PIN)
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
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({ user: null });
  try {
    const u = jwt.verify(token, SECRET);
    res.json({ user: u });
  } catch { res.json({ user: null }); }
});

// ---- players listing
app.get("/api/players", async (req, res) => {
  const r = await pool.query("SELECT id, name, role FROM players ORDER BY name ASC");
  res.json(r.rows);
});

// ---- write paper (no limits; requires active game)
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

// ---- my last paper
app.get("/api/my/last-paper", auth, async (req, res) => {
  const gameId = await getActiveGameId();
  if (!gameId) return res.json(null);
  const r = await pool.query(
    "SELECT * FROM papers WHERE game_id=$1 AND author_id=$2 ORDER BY created_at DESC LIMIT 1",
    [gameId, req.user.id]
  );
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

// ---- admin: list papers (active OR last closed)
app.get("/api/admin/papers", auth, adminOnly, async (req, res) => {
  let gameId = await getActiveGameId();
  if (!gameId) gameId = await getLastClosedGameId();
  if (!gameId) return res.json([]);
  const r = await pool.query(
    `SELECT p.*, pl.name AS author_name
     FROM papers p
     JOIN players pl ON pl.id=p.author_id
     WHERE p.game_id=$1
     ORDER BY p.created_at ASC`,
    [gameId]
  );
  res.json(r.rows);
});

// ---- admin: close game
app.post("/api/game/close", auth, adminOnly, async (req, res) => {
  try {
    const r = await pool.query("UPDATE games SET active=false WHERE active=true RETURNING id");
    res.json({ ok: true, closedCount: r.rowCount });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ---- admin: new game
app.post("/api/game/new", auth, adminOnly, async (req, res) => {
  try {
    await pool.query("UPDATE games SET active=false WHERE active=true");
    const r = await pool.query("INSERT INTO games (active) VALUES (true) RETURNING id");
    res.json({ ok: true, gameId: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post("/api/admin/reset", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });

  try {
    // ⚠️ Supprime tout
    await pool.query(`TRUNCATE read_assignments, papers, games, players RESTART IDENTITY CASCADE;`);

    // Ajoute ici ta nouvelle liste fixe
    const players = [
      { name: "Martin", role: "admin", pin: null },
      { name: "Antoine", role: "player", pin: null },
      { name: "Léa", role: "player", pin: null },
      { name: "Hugo", role: "player", pin: null },
      { name: "Marie", role: "player", pin: null }
    ];

    for (const p of players) {
      await pool.query(
        "INSERT INTO players (name, role, pin) VALUES ($1,$2,$3)",
        [p.name, p.role, p.pin]
      );
    }

    // Crée une nouvelle partie active
    await pool.query("INSERT INTO games (active) VALUES (true)");

    res.json({ ok: true, players });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---- admin: start reading (closes + assigns)
app.post("/api/admin/reading/start", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });

  try {
    await ensureReadAssignmentsColumns();

    // 1) Partie active
    const gameIdRow = await pool.query("SELECT id FROM games WHERE active=true LIMIT 1");
    if (!gameIdRow.rows.length) return res.status(400).json({ error: "No active game" });
    const gameId = gameIdRow.rows[0].id;

    // 2) Clôturer
    await pool.query("UPDATE games SET active=false WHERE id=$1", [gameId]);

    // 3) Purge anciennes assignations
    await pool.query(`
      DELETE FROM read_assignments
      WHERE paper_id IN (SELECT id FROM papers WHERE game_id=$1)
    `, [gameId]);

    // 4) Papiers de la partie
    const paperRows = await pool.query(
      "SELECT id FROM papers WHERE game_id=$1 ORDER BY id ASC",
      [gameId]
    );
    const papers = paperRows.rows.map(r => r.id);
    if (!papers.length) return res.json({ ok: true, assigned: 0 });

    // 5) Lecteurs éligibles = auteurs (admin inclus s'il a écrit)
    const readersRows = await pool.query(
      `SELECT pl.id, pl.name
       FROM players pl
       WHERE EXISTS (
         SELECT 1 FROM papers p
         WHERE p.game_id = $1 AND p.author_id = pl.id
       )
       ORDER BY pl.name ASC`,
      [gameId]
    );
    let readers = readersRows.rows.map(r => r.id);

    // Fallback : s'il n'y a aucun auteur, on répartit sur tous les joueurs
    if (!readers.length) {
      const all = await pool.query("SELECT id FROM players ORDER BY name ASC");
      readers = all.rows.map(r => r.id);
      if (!readers.length) return res.json({ ok: true, assigned: 0 });
    }

    // 6) Répartition équitable (round-robin) + ordre de lecture
    const randomized = shuffle(papers);
    let idx = 0;
    let order = 1;
    for (const pid of randomized) {
      const readerId = readers[idx % readers.length];
      idx++;
      await pool.query(
        `INSERT INTO read_assignments (paper_id, reader_id, read_order, revealed, consumed)
         VALUES ($1,$2,$3,false,false)`,
        [pid, readerId, order++]
      );
    }

    res.json({ ok: true, assigned: papers.length, readers: readers.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});


// ---- player: my reading lot (from LAST closed game)
app.get("/api/reading/lot", auth, async (req, res) => {
  try {
    const gameId = await getLastClosedGameId();
    if (!gameId) return res.json([]);
    const r = await pool.query(
      `SELECT p.id, p.type, p.target, p.message
       FROM read_assignments ra
       JOIN papers p ON p.id = ra.paper_id
       WHERE p.game_id=$1 AND ra.reader_id=$2
       ORDER BY ra.id ASC`,
      [gameId, req.user.id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ---- debug
app.get("/api/health-db", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW()");
    res.json({ ok: true, now: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 1) Récupère le prochain papier à lire pour l'utilisateur courant
app.get("/api/reading/next", auth, async (req, res) => {
  try {
    await ensureReadAssignmentsColumns();
    const gameId = await getLastClosedGameId();
    if (!gameId) return res.json({ done: true }); // pas encore de partie clôturée

    const r = await pool.query(
      `SELECT ra.id AS assignment_id, p.id AS paper_id, p.type, p.target, p.message
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

// 2) Révèle l’auteur (consomme l’item + marque le papier comme révélé globalement)
app.post("/api/reading/reveal", auth, async (req, res) => {
  try {
    const { assignmentId } = req.body || {};
    if (!assignmentId) return res.status(400).json({ error: "Missing assignmentId" });
    await ensureReadAssignmentsColumns();
    const gameId = await getLastClosedGameId();
    if (!gameId) return res.status(400).json({ error: "No closed game" });

    // Vérifie propriété + récupère l'auteur
    const r = await pool.query(
      `SELECT ra.id, p.id AS paper_id, a.name AS author_name
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

// 3) Passe au suivant sans révéler (consomme seulement)
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


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

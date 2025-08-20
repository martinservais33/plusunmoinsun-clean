const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const pool = require("./src/db");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "secret123";

app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

// Middleware auth
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

// Login
app.post("/api/login", async (req, res) => {
  const { name, pin } = req.body;
  const result = await pool.query("SELECT * FROM players WHERE name=$1 AND pin=$2", [name, pin]);
  if (result.rows.length === 0) return res.status(401).json({ error: "Bad credentials" });

  const player = result.rows[0];
  const token = jwt.sign({ id: player.id, name: player.name, role: player.role }, SECRET, { expiresIn: "12h" });
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("token", token, {
  httpOnly: true,
  sameSite: "lax",
  secure: isProd, // true sur Render (https), false en local
  maxAge: 1000 * 60 * 60 * 12 // 12h
  });
  res.json({ success: true, role: player.role });
});

// Ajouter un papier
app.post("/api/paper", auth, async (req, res) => {
  const { target, type, message } = req.body;
  const game = await pool.query("SELECT id FROM games WHERE active=true LIMIT 1");
  if (game.rows.length === 0) return res.status(400).json({ error: "No active game" });

  const result = await pool.query(
    "INSERT INTO papers (game_id, author_id, target, type, message) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [game.rows[0].id, req.user.id, target, type, message]
  );
  res.json(result.rows[0]);
});

// Lister mes papiers
app.get("/api/mypapers", auth, async (req, res) => {
  const result = await pool.query("SELECT * FROM papers WHERE author_id=$1", [req.user.id]);
  res.json(result.rows);
});

// Admin : révéler un papier
app.post("/api/reveal/:id", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  await pool.query("UPDATE papers SET revealed=true WHERE id=$1", [req.params.id]);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
// seed.js — version idempotente (safe)
const fs = require("fs");
const path = require("path");
const pool = require("./src/db");

async function seed() {
  // 1) Applique le schema (création des tables si manquantes)
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await pool.query(schema);

  // 2) Contrainte d'unicité sur le nom (insensible à la casse via index si tu veux)
  // a) UNIQUE simple (sensible à la casse) :
  try {
    await pool.query(`ALTER TABLE players ADD CONSTRAINT players_name_key UNIQUE (name);`);
  } catch (e) {
    // ignore si elle existe déjà
  }

  // (Optionnel à la place : index unique insensible à la casse)
  // await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS players_name_ci ON players (LOWER(name));`);

  // 3) Parse PLAYER_SEED
  const seedEnv = process.env.PLAYER_SEED || "Martin:1111:admin,Antoine:2222,Lea:3333,Hugo:4444,Marie:5555";
  const players = seedEnv.split(",").map(s => {
    const [name, pin, role] = s.split(":").map(x => x.trim());
    return { name, pin, role: role || "player" };
  });

  // 4) Upsert des joueurs (crée si absent, met à jour pin/role si présent)
  for (const p of players) {
    await pool.query(
      `INSERT INTO players (name, pin, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (name) DO UPDATE SET pin = EXCLUDED.pin, role = EXCLUDED.role`,
      [p.name, p.pin, p.role]
    );
  }

  // 5) S'assurer qu'il existe une partie active
  const active = await pool.query(`SELECT id FROM games WHERE active = true LIMIT 1`);
  let gameId;
  if (active.rows.length === 0) {
    const g = await pool.query(`INSERT INTO games (active) VALUES (true) RETURNING id`);
    gameId = g.rows[0].id;
  } else {
    gameId = active.rows[0].id;
  }

  // 6) S'assurer qu'il existe des limites pour la partie active
  const lim = await pool.query(`SELECT id FROM limits WHERE game_id = $1 LIMIT 1`, [gameId]);
  if (lim.rows.length === 0) {
    await pool.query(`INSERT INTO limits (game_id, per_hour, per_day) VALUES ($1, 5, 20)`, [gameId]);
  }

  console.log("Seed (idempotent) terminé ✅");
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});

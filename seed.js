const pool = require("./src/db");
const fs = require("fs");

async function seed() {
  const schema = fs.readFileSync("schema.sql", "utf-8");
  await pool.query(schema);

  await pool.query("DELETE FROM players");
  await pool.query("DELETE FROM games");

  const seed = process.env.PLAYER_SEED || "Martin:1111:admin,Antoine:2222,Lea:3333,Hugo:4444,Marie:5555";

  const players = seed.split(",").map(str => {
    const [name, pin, role] = str.split(":");
    return { name, pin, role: role || "player" };
  });

  for (const p of players) {
    await pool.query("INSERT INTO players (name, pin, role) VALUES ($1,$2,$3)", [p.name, p.pin, p.role]);
  }

  const game = await pool.query("INSERT INTO games (active) VALUES (true) RETURNING id");
  await pool.query("INSERT INTO limits (game_id, per_hour, per_day) VALUES ($1,5,20)", [game.rows[0].id]);

  console.log("Seed terminé ✅");
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
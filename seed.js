const fs = require("fs");
const path = require("path");
const pool = require("./src/db");

async function seed() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await pool.query(schema);

  const seedEnv = process.env.PLAYER_SEED || "Mart:1111:admin,Toon:2222,Thur:3333,Bill:4444,Coco:5555,Matt : 6666,Louche:7777,Ryl:8888,Bert:9999,Diègre:1110,Sacul:2220,Rico:3330";
  const players = seedEnv.split(",").map(s => {
    const [name, pin, role] = s.split(":").map(x => x.trim());
    return { name, pin, role: role || "player" };
  });

  for (const p of players) {
    await pool.query(
      `INSERT INTO players (name, pin, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (name) DO UPDATE SET pin = EXCLUDED.pin, role = EXCLUDED.role`,
      [p.name, p.pin, p.role]
    );
  }

  const active = await pool.query("SELECT id FROM games WHERE active=true LIMIT 1");
  if (!active.rows.length) {
    await pool.query("INSERT INTO games (active) VALUES (true)");
  }

  console.log("Seed terminé ✅");
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
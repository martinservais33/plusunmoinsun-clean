CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  pin TEXT NOT NULL,
  role TEXT DEFAULT 'player'
);

CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMP DEFAULT now(),
  active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS limits (
  id SERIAL PRIMARY KEY,
  game_id INT REFERENCES games(id),
  per_hour INT DEFAULT 5,
  per_day INT DEFAULT 20
);

CREATE TABLE IF NOT EXISTS papers (
  id SERIAL PRIMARY KEY,
  game_id INT REFERENCES games(id),
  author_id INT REFERENCES players(id),
  target TEXT NOT NULL,
  type TEXT CHECK (type IN ('plus','moins', '+1', '-1')),
  message TEXT,
  revealed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS read_assignments (
  id SERIAL PRIMARY KEY,
  paper_id INT REFERENCES papers(id) ON DELETE CASCADE,
  reader_id INT REFERENCES players(id)
);
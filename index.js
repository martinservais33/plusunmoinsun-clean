// index.js
const express = require("express");
const app = express();

// --- Config port Render/Heroku/etc.
const PORT = process.env.PORT || 3000;

// --- Anti-cache pour éviter d'anciennes versions en mémoire/proxy
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Surrogate-Control", "no-store");
  next();
});

// --- Routes
app.get("/", (req, res) => {
  res.type("text/plain; charset=utf-8");
  res.send("Hello World depuis Render — update 2.0 🚀");
});

app.get("/testlog", (req, res) => {
  const now = new Date().toISOString();
  console.log(`[TESTLOG] Visite /testlog @ ${now}`);
  res.type("text/plain; charset=utf-8");
  res.send("Regarde les logs Render 👀");
});

// Ping simple pour monitoring
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// --- Démarrage
app.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
  console.log(`Version déployée @ ${new Date().toISOString()}`);
});

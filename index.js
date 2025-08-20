const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Hello World depuis Render update 2.0🚀");
});

app.get("/testlog", (req, res) => {
  console.log("Quelqu’un a visité /testlog à " + new Date().toISOString());
  res.send("Regarde les logs Render 👀");
});


app.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});

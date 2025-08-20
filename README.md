# Papiers v2 — sans PIN pour les joueurs

- Les joueurs cliquent leur prénom pour se connecter (zéro PIN).
- L'admin se connecte avec PIN via le formulaire dédié.
- Chacun ne voit **que son dernier papier** et peut le supprimer tant que c'est le dernier.
- L'admin voit **tous** les papiers et peut démarrer la **lecture** (clôture la partie) → chacun reçoit son lot.

## Déploiement Render
- Environment Variables:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `PLAYER_SEED` (ex: `Martin:1111:admin,Antoine:2222,Lea:3333,Hugo:4444,Marie:5555`)
- Build Command: `npm install && npm run seed`
- Start Command: `npm start`

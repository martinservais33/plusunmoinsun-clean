async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json();
}

function el(id){ return document.getElementById(id); }
function show(id, vis){ el(id).style.display = vis ? "" : "none"; }

async function refreshMe() {
  const { user } = await api("/api/auth/me");
  const box = el("meBox");
  if (user) {
    box.innerHTML = `Connecté: <strong>${user.name}</strong> (${user.role}) <button id="logoutBtn">Se déconnecter</button>`;
    el("logoutBtn").onclick = async () => { await api("/api/auth/logout", { method:"POST" }); location.reload(); };
  } else {
    box.innerHTML = "Non connecté";
  }
  return user;
}

async function loadPlayers() {
  const list = await api("/api/players");
  const grid = el("playersGrid");
  grid.innerHTML = "";
  list.forEach(p => {
    const btn = document.createElement("button");
    btn.className = "playerBtn";
    btn.textContent = p.name + (p.role === "admin" ? " (admin)" : "");
    btn.onclick = async () => {
      if (p.role === "admin") {
        alert("Utilise le formulaire de connexion admin ci-dessous.");
        return;
      }
      try {
        await api("/api/auth/select", { method:"POST", body: JSON.stringify({ playerId: p.id }) });
        await afterLogin();
      } catch (e) { alert("Connexion impossible: " + e.message); }
    };
    grid.appendChild(btn);
  });

  const sel = el("targetSelect");
  sel.innerHTML = "";
  list.filter(p => p.role !== "admin").forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

async function afterLogin() {
  const me = await refreshMe();
  if (!me) return;
  show("selectSection", false);
  show("writeSection", true);
  show("readingSection", true);
  if (me.role === "admin") show("adminSection", true);
  await refreshLastPaper();
  if (me.role === "admin") await loadAllPapers();
  await loadLot();
}

async function sendPaper() {
  const targetName = el("targetSelect").value;
  const type = el("typeSelect").value;
  const message = el("messageInput").value.trim();
  if (!message) return alert("Message vide.");
  try {
    await api("/api/paper", { method:"POST", body: JSON.stringify({ targetName, type, message }) });
    el("messageInput").value = "";
    await refreshLastPaper();
  } catch (e) { alert("Envoi KO: " + e.message); }
}

async function refreshLastPaper() {
  const p = await api("/api/my/last-paper");
  const box = el("lastPaper");
  if (!p) { box.textContent = "Aucun papier pour l'instant."; return; }
  box.innerHTML = `
    <div>
      <span class="badge ${p.type==='plus' ? 'plus':'moins'}">${p.type === 'plus' ? '+1' : '-1'}</span>
      à ${p.target} — ${p.message}
      <button id="delLastBtn">Supprimer (si toujours le dernier)</button>
    </div>`;
  el("delLastBtn").onclick = async () => {
    try { await api("/api/my/last-paper", { method:"DELETE" }); await refreshLastPaper(); }
    catch (e) { alert("Suppression impossible: " + e.message); }
  };
}

async function loadAllPapers() {
  const list = await api("/api/admin/papers");
  const ul = el("allPapers");
  ul.innerHTML = "";
  list.forEach(p => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="badge ${p.type==='plus' ? 'plus':'moins'}">${p.type === 'plus' ? '+1' : '-1'}</span>
      ${p.author_name} → ${p.target} — ${p.message}`;
    ul.appendChild(li);
  });
}

async function startReading() {
  if (!confirm("Démarrer la lecture ? Cela clôture la partie. Êtes-vous sûr ?")) return;
  try {
    await api("/api/admin/reading/start", { method:"POST" });
    alert("Lecture démarrée. Ouvrez l'onglet 'Lecture'.");
    await loadLot();
  } catch (e) { alert("Impossible de démarrer: " + e.message); }
}

async function loadLot() {
  try {
    const lot = await api("/api/reading/lot");
    const ul = el("lotList");
    ul.innerHTML = "";
    lot.forEach(p => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="badge ${p.type==='plus' ? 'plus':'moins'}">${p.type==='plus'?'+1':'-1'}</span> à ${p.target} — ${p.message}`;
      ul.appendChild(li);
    });
  } catch (e) {}
}

document.addEventListener("DOMContentLoaded", async () => {
  el("sendBtn").onclick = sendPaper;
  el("refreshLotBtn").onclick = loadLot;
  el("adminLoginBtn").onclick = async () => {
    const name = el("adminName").value.trim();
    const pin = el("adminPin").value.trim();
    try { await api("/api/auth/admin-login", { method:"POST", body: JSON.stringify({ name, pin }) }); await afterLogin(); }
    catch (e) { alert("Admin KO: " + e.message); }
  };
  el("startReadingBtn").onclick = startReading;

  await refreshMe();
  await loadPlayers();
});
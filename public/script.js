\
// ==== helpers fetch + UI ====
function el(id){ return document.getElementById(id); }
function toast(msg, type="ok"){
  const wrap = el("toasts");
  if (!wrap) return alert(msg);
  const div = document.createElement("div");
  div.className = "toast " + (type === "error" ? "toast--err" : "toast--ok");
  div.textContent = msg;
  wrap.appendChild(div);
  setTimeout(()=> { div.style.opacity = ".0"; div.style.transform = "translateY(-6px)"; }, 2500);
  setTimeout(()=> wrap.removeChild(div), 3000);
}
async function api(path, options={}){
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if(!res.ok){
    let t = await res.text().catch(()=> "");
    throw new Error(t || ("HTTP "+res.status));
  }
  return res.json();
}

let CURRENT_USER = null;
let TARGET_NAME = null;
let TYPE = "plus";
let PLAYERS = [];

// ==== auth ====
async function refreshMe(){
  const me = await api("/api/auth/me");
  CURRENT_USER = me.user;
  const logoutBtn = el("logoutBtn");
  if (logoutBtn){
    if (CURRENT_USER){
      logoutBtn.style.display = "";
      logoutBtn.onclick = async () => { await api("/api/auth/logout", { method: "POST" }); location.reload(); };
    } else {
      logoutBtn.style.display = "none";
    }
  }
  if (CURRENT_USER){
    const lab = el("meLabel"); if (lab) lab.textContent = `Connecté : ${CURRENT_USER.name} (${CURRENT_USER.role})`;
  }
  return CURRENT_USER;
}

// ==== players ====
function renderPlayersGrid(list){
  const grid = el("playersGrid"); if (!grid) return;
  grid.innerHTML = "";
  list.forEach(p => {
    const chip = document.createElement("button");
    chip.className = "chip";
    const initials = p.name.substring(0,1).toUpperCase();
    chip.innerHTML = `<span class="chip__avatar">${initials}</span> ${p.name}`;
    chip.onclick = async () => {
      try {
        await api("/api/auth/select", { method:"POST", body: JSON.stringify({ playerId: p.id }) });
        await afterLogin();
      } catch(e){ toast("Connexion impossible", "error"); }
    };
    grid.appendChild(chip);
  });
}
async function loadPlayers(){
  const list = await api("/api/players");
  PLAYERS = list;
  renderPlayersGrid(list);
  // Destinataires (admin inclus)
  const row = el("targetsChips");
  if (row){
    row.innerHTML = "";
    list.forEach((p,i) => {
      const b = document.createElement("button");
      b.className = "chip" + (i===0 ? " chip--active" : "");
      b.textContent = p.role === "admin" ? `${p.name} (admin)` : p.name;
      b.onclick = () => {
        [...row.children].forEach(c => c.classList.remove("chip--active"));
        b.classList.add("chip--active");
        TARGET_NAME = p.name;
      };
      row.appendChild(b);
      if (i===0) TARGET_NAME = p.name;
    });
  }
}
function filterPlayers(term){
  const t = term.trim().toLowerCase();
  if (!t) return renderPlayersGrid(PLAYERS);
  renderPlayersGrid(PLAYERS.filter(p => p.name.toLowerCase().includes(t)));
}

// ==== write ====
function initTypeToggle(){
  const plus = el("typePlus"), moins = el("typeMoins");
  if (plus && moins){
    plus.onclick = () => { TYPE="plus"; plus.classList.add("active"); moins.classList.remove("active"); };
    moins.onclick = () => { TYPE="moins"; moins.classList.add("active"); plus.classList.remove("active"); };
  }
}
async function sendPaper(){
  const msgEl = el("messageInput");
  if (!msgEl) return;
  const msg = msgEl.value.trim();
  if (!msg) return toast("Message vide", "error");
  try {
    el("sendBtn").disabled = true;
    await api("/api/paper", { method:"POST", body: JSON.stringify({ targetName: TARGET_NAME, type: TYPE, message: msg }) });
    msgEl.value = "";
    toast("Papier envoyé");
    await refreshLastPaper();
  } catch(e){ toast("Envoi impossible", "error"); }
  finally { el("sendBtn").disabled = false; }
}
async function refreshLastPaper(){
  const box = el("lastPaperBox");
  if (!box) return;
  box.className = "paper paper--empty";
  box.textContent = "Chargement…";
  try {
    const p = await api("/api/my/last-paper");
    if (!p){ box.className = "paper paper--empty"; box.textContent = "Aucun papier pour l’instant."; return; }
    box.className = "paper";
    box.innerHTML = `
      <div class="paper__meta">
        <span class="badge ${p.type==='plus'?'plus':'moins'}">${p.type==='plus'?'+1':'-1'}</span>
        <span class="paper__target">à ${p.target}</span>
      </div>
      <div class="paper__msg">${escapeHtml(p.message)}</div>
      <div class="row" style="margin-top:8px;">
        <button id="delLastBtn" class="btn btn--ghost">Supprimer</button>
      </div>
    `;
    const del = el("delLastBtn");
    if (del){
      del.onclick = async () => {
        try { await api("/api/my/last-paper", { method:"DELETE" }); toast("Supprimé"); await refreshLastPaper(); }
        catch(e){ toast("Suppression impossible (pas le dernier ?)", "error"); }
      };
    }
  } catch {
    box.className = "paper paper--empty";
    box.textContent = "Erreur de chargement.";
  }
}

// ==== reading one-by-one ====
let CURRENT_ASSIGNMENT_ID = null;
async function loadNextToRead(){
  const listWrap = el("lotList");
  const empty = el("lotEmpty");
  if (!listWrap) return;
  listWrap.innerHTML = "";
  try {
    const r = await api("/api/reading/next");
    if (r.done){
      if (empty) empty.style.display = "";
      return;
    }
    if (empty) empty.style.display = "none";
    const p = r.item;
    CURRENT_ASSIGNMENT_ID = p.assignment_id;
    const card = document.createElement("div");
    card.className = "paper";
    card.innerHTML = `
      <div class="paper__meta">
        <span class="badge ${p.type==='plus'?'plus':'moins'}">${p.type==='plus'?'+1':'-1'}</span>
        <span class="paper__target">à ${escapeHtml(p.target)}</span>
      </div>
      <div class="paper__msg">${escapeHtml(p.message)}</div>
      <div class="row" style="margin-top:10px;">
        <button id="revealBtn" class="btn btn--accent">Révéler l’auteur</button>
        <button id="skipBtn" class="btn btn--ghost">Suivant</button>
      </div>
    `;
    listWrap.appendChild(card);
    el("revealBtn").onclick = revealCurrent;
    el("skipBtn").onclick = skipCurrent;
  } catch {
    if (empty) empty.style.display = "";
  }
}
async function revealCurrent(){
  if (!CURRENT_ASSIGNMENT_ID) return;
  try {
    const r = await api("/api/reading/reveal", { method:"POST", body: JSON.stringify({ assignmentId: CURRENT_ASSIGNMENT_ID }) });
    const listWrap = el("lotList");
    if (listWrap){
      listWrap.innerHTML = `
        <div class="paper">
          <div class="paper__msg"><strong>Auteur :</strong> ${escapeHtml(r.author)}</div>
          <div class="row" style="margin-top:10px;">
            <button id="nextAfterReveal" class="btn">Continuer</button>
          </div>
        </div>
      `;
      el("nextAfterReveal").onclick = () => { CURRENT_ASSIGNMENT_ID = null; loadNextToRead(); };
    }
  } catch(e){ toast("Action impossible", "error"); }
}
async function skipCurrent(){
  if (!CURRENT_ASSIGNMENT_ID) return;
  try {
    await api("/api/reading/skip", { method:"POST", body: JSON.stringify({ assignmentId: CURRENT_ASSIGNMENT_ID }) });
    CURRENT_ASSIGNMENT_ID = null;
    await loadNextToRead();
  } catch(e){ toast("Action impossible", "error"); }
}

// ==== admin ====
async function loadAllPapers(){
  const wrap = el("allPapers");
  const empty = el("allPapersEmpty");
  if (!wrap) return;
  wrap.innerHTML = "";
  try {
    const list = await api("/api/admin/papers");
    if (!list || list.length === 0){ if (empty) empty.style.display = ""; return; }
    if (empty) empty.style.display = "none";
    list.forEach(p => {
      const card = document.createElement("div");
      card.className = "paper";
      card.innerHTML = `
        <div class="paper__meta">
          <span class="badge ${p.type==='plus'?'plus':'moins'}">${p.type==='plus'?'+1':'-1'}</span>
          <span class="paper__target">${escapeHtml(p.author_name)} → ${escapeHtml(p.target)}</span>
        </div>
        <div class="paper__msg">${escapeHtml(p.message)}</div>
      `;
      wrap.appendChild(card);
    });
  } catch { if (empty) empty.style.display = ""; }
}
async function closeGame(){
  if (!confirm("Clôturer la partie ?")) return;
  try { await api("/api/game/close", { method:"POST" }); toast("Partie clôturée"); await loadAllPapers(); }
  catch(e){ toast("Clôture impossible", "error"); }
}
async function startReading(){
  if (!confirm("Démarrer la lecture ?")) return;
  try {
    const r = await api("/api/admin/reading/start", { method:"POST" });
    toast(`Lecture lancée (${r.assigned ?? "?"} papiers répartis)`);
    await loadNextToRead();
  } catch(e){ toast("Impossible de lancer la lecture", "error"); }
}
async function newGame(){
  if (!confirm("Créer une nouvelle partie ?")) return;
  try {
    await api("/api/game/new", { method:"POST" });
    toast("Nouvelle partie créée");
    await loadAllPapers();
    await refreshLastPaper();
    const listWrap = el("lotList"); if (listWrap) listWrap.innerHTML = "";
    const empty = el("lotEmpty"); if (empty) empty.style.display = "";
  } catch(e){ toast("Impossible de créer une nouvelle partie", "error"); }
}

// ==== utils ====
function escapeHtml(str){
  return String(str).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

// ==== after login ====
async function afterLogin(){
  const me = await refreshMe();
  if (!me) return;
  if (el("selectSection")) el("selectSection").style.display = "none";
  if (el("writeSection")) el("writeSection").style.display = "";
  if (el("readingSection")) el("readingSection").style.display = "";
  if (me.role === "admin" && el("adminSection")) el("adminSection").style.display = "";
  await refreshLastPaper();
  await loadNextToRead();
  if (me.role === "admin") await loadAllPapers();
}

// ==== boot ====
document.addEventListener("DOMContentLoaded", async () => {
  if (el("playerSearch")) el("playerSearch").addEventListener("input", (e)=> filterPlayers(e.target.value));
  if (el("sendBtn")) el("sendBtn").onclick = sendPaper;
  if (el("refreshLotBtn")) el("refreshLotBtn").onclick = loadNextToRead;
  if (el("closeGameBtn")) el("closeGameBtn").onclick = closeGame;
  if (el("startReadingBtn")) el("startReadingBtn").onclick = startReading;
  if (el("newGameBtn")) el("newGameBtn").onclick = newGame;
  initTypeToggle();

  await refreshMe();
  await loadPlayers();

  // Si déjà connecté, montrer sections et charger données
  if (CURRENT_USER){
    if (el("selectSection")) el("selectSection").style.display = "none";
    if (el("writeSection")) el("writeSection").style.display = "";
    if (el("readingSection")) el("readingSection").style.display = "";
    if (CURRENT_USER.role === "admin" && el("adminSection")) el("adminSection").style.display = "";
    await refreshLastPaper();
    await loadNextToRead();
    if (CURRENT_USER.role === "admin") await loadAllPapers();
  }
});

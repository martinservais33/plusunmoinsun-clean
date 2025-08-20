async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",                   // <-- indispensable pour le cookie
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json();
}

async function login() {
  const name = document.getElementById("name").value;
  const pin = document.getElementById("pin").value;
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ name, pin })
    });
    document.getElementById("login").style.display = "none";
    document.getElementById("actions").style.display = "block";
    loadMyPapers();
  } catch (e) {
    alert("Login KO : " + e.message); // te dira “Bad credentials”, “Missing name/pin”, etc.
  }
}

async function addPaper() {
  const target = document.getElementById("target").value;
  const type = document.getElementById("type").value;
  const message = document.getElementById("message").value;

  try {
    await api("/api/paper", {
      method: "POST",
      body: JSON.stringify({ target, type, message })
    });
    loadMyPapers();
  } catch (e) {
    alert("Envoi KO : " + e.message);
  }
}

async function loadMyPapers() {
  try {
    const papers = await api("/api/mypapers");
    const list = document.getElementById("mypapers");
    list.innerHTML = "";
    papers.forEach(p => {
      const li = document.createElement("li");
      li.textContent = `${p.type === "plus" ? "+1" : "-1"} ${p.target} : ${p.message}`;
      list.appendChild(li);
    });
  } catch (e) {
    alert("Chargement KO : " + e.message);
  }
}


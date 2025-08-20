async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",                  // <-- important !
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
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

    if (data.success) {
      document.getElementById("login").style.display = "none";
      document.getElementById("actions").style.display = "block";
      loadMyPapers();
    } else {
      alert("Échec de connexion");
    }
  } catch (e) {
    alert("Connexion impossible: " + e.message);
  }
}

async function addPaper() {
  const target = document.getElementById("target").value;
  const type = document.getElementById("type").value;
  const message = document.getElementById("message").value;

  await api("/api/paper", {
    method: "POST",
    body: JSON.stringify({ target, type, message })
  });

  loadMyPapers();
}

async function loadMyPapers() {
  const papers = await api("/api/mypapers");
  const list = document.getElementById("mypapers");
  list.innerHTML = "";
  papers.forEach(p => {
    const li = document.createElement("li");
    li.textContent = `${p.type === "plus" ? "+1" : "-1"} ${p.target} : ${p.message}`;
    list.appendChild(li);
  });
}

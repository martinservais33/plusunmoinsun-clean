async function login() {
  const name = document.getElementById("name").value;
  const pin = document.getElementById("pin").value;

  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, pin })
  });

  const data = await res.json();
  if (data.success) {
    document.getElementById("login").style.display = "none";
    document.getElementById("actions").style.display = "block";
    loadMyPapers();
  } else {
    alert("Échec de connexion");
  }
}

async function addPaper() {
  const target = document.getElementById("target").value;
  const type = document.getElementById("type").value;
  const message = document.getElementById("message").value;

  await fetch("/api/paper", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, type, message })
  });

  loadMyPapers();
}

async function loadMyPapers() {
  const res = await fetch("/api/mypapers");
  const papers = await res.json();
  const list = document.getElementById("mypapers");
  list.innerHTML = "";
  papers.forEach(p => {
    const li = document.createElement("li");
    li.textContent = `${p.type === "plus" ? "+1" : "-1"} ${p.target} : ${p.message}`;
    list.appendChild(li);
  });
}
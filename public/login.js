document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("err");
  const btn = e.target.querySelector("button");
  err.hidden = true;
  btn.disabled = true;
  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: document.getElementById("pw").value }),
    });
    if (r.ok) return location.replace("/");
    const data = await r.json().catch(() => ({}));
    err.textContent = data.error || "Login failed";
  } catch {
    err.textContent = "No connection";
  }
  err.hidden = false;
  btn.disabled = false;
});

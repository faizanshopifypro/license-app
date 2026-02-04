import session from "express-session";
import bcrypt from "bcrypt";
import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import bodyParser from "body-parser";

// ====== CONFIG ======
const app = express();
const PORT = 3000;
const DATA_FILE = "licenses.json";
const CSS_FILE = "css/pro-theme.css";

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// ===== SESSION =====
app.use(
  session({
    secret: "vertex-super-secret-change-this",
    resave: false,
    saveUninitialized: false,
  })
);

// ===== ADMIN CREDENTIALS =====
const ADMIN_USER = "vertex";
// CHANGE PASSWORD HERE:
const ADMIN_PASS_HASH = bcrypt.hashSync("Vertex@2026$", 10);

// ===== LOGIN MIDDLEWARE =====
function requireLogin(req, res, next) {
  if (req.session.loggedIn) return next();
  res.redirect("/login");
}

// ====== LOAD LICENSES ======
let licenses = {};
if (fs.existsSync(DATA_FILE)) {
  licenses = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

// ====== SAVE LICENSES ======
function saveLicenses() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(licenses, null, 2));
}

// ====== LICENSE GENERATOR ======
function generateLicenseKey() {
  function chunk() {
    return crypto.randomBytes(2).toString("hex").toUpperCase();
  }
  return `VEL-${chunk()}-${chunk()}-${chunk()}-${chunk()}`;
}

// ================= LOGIN =================

app.get("/login", (req, res) => {
  res.send(`
  <h2>Owner Login</h2>
  <form method="POST">
    <input name="user" placeholder="Username"/><br><br>
    <input name="pass" type="password" placeholder="Password"/><br><br>
    <button>Login</button>
  </form>
  `);
});

app.post("/login", async (req, res) => {
  const { user, pass } = req.body;

  if (user !== ADMIN_USER) return res.send("Invalid");

  const ok = await bcrypt.compare(pass, ADMIN_PASS_HASH);
  if (!ok) return res.send("Invalid");

  req.session.loggedIn = true;
  res.redirect("/admin");
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// =====================================================
// 1️⃣ SHOPIFY WEBHOOK
// =====================================================
app.post("/webhook/orders/fulfilled", (req, res) => {
  try {
    const order = req.body;

    const customerName = order.destination
      ? `${order.destination.first_name} ${order.destination.last_name}`
      : "unknown";

    const customerEmail = order.email;
    const storeDomain = order.myshopify_domain || "unknown-store";

    const licenseKey = generateLicenseKey();

    licenses[licenseKey] = {
      customer: customerName,
      email: customerEmail,
      store: storeDomain,
      createdAt: new Date(),
      valid: true,
    };

    saveLicenses();

    return res.json({
      success: true,
      message: "License created successfully",
      licenseKey,
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ success: false });
  }
});

// =====================================================
// 2️⃣ VALIDATE LICENSE
// =====================================================
app.get("/validate", (req, res) => {
  const { key, store } = req.query;

  if (!key) return res.status(400).json({ valid: false });

  const license = licenses[key];
  if (!license) return res.status(404).json({ valid: false });

  if (!license.valid) return res.status(403).json({ valid: false });

  if (license.store === "unknown-store") {
    if (store) {
      license.store = store;
      saveLicenses();
    }

    return res.json({
      valid: true,
      firstTime: true,
      cssUrl: `https://api-vertex.com/theme.css?key=${key}&store=${store}`,
    });
  }

  if (license.store !== store) return res.status(403).json({ valid: false });

  return res.json({
    valid: true,
    cssUrl: `https://api-vertex.com/theme.css?key=${key}&store=${store}`,
    license,
  });
});

// =====================================================
// 3️⃣ PROTECTED CSS
// =====================================================
app.get("/theme.css", (req, res) => {
  const { key, store } = req.query;
  const license = licenses[key];
  if (!license || !license.valid) return res.status(403).send("Invalid");

  if (license.store !== "unknown-store" && license.store !== store)
    return res.status(403).send("Store mismatch");

  const cssPath = path.join(process.cwd(), CSS_FILE);
  res.setHeader("Content-Type", "text/css");
  res.send(fs.readFileSync(cssPath, "utf8"));
});

// =====================================================
// 🔐 ADMIN ROUTES (PROTECTED)
// =====================================================

app.get("/licenses", requireLogin, (req, res) => res.json(licenses));

app.get("/revoke", requireLogin, (req, res) => {
  const { key } = req.query;
  licenses[key].valid = false;
  saveLicenses();
  res.json({ success: true });
});

app.get("/activate", requireLogin, (req, res) => {
  const { key } = req.query;
  licenses[key].valid = true;
  saveLicenses();
  res.json({ success: true });
});

// ================= ADMIN DASHBOARD =================

app.get("/admin", requireLogin, (req, res) => {
  const html = `
  <html>
  <head>
    <title>License Dashboard</title>
    <style>
      body { font-family: Arial; margin: 30px; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      th, td { padding: 12px; border-bottom: 1px solid #ddd; text-align: left; }
      th { background: #f4f4f4; }
      .btn { padding:6px 10px;border:none;border-radius:4px;cursor:pointer;}
      .revoke{background:#e53935;color:#fff}
      .activate{background:#43a047;color:#fff}
      .copy{background:#3949ab;color:#fff}
      .info{background:#00897b;color:#fff}
      .small{font-size:13px;opacity:.7}
    </style>
  </head>
  <body>

<h2>License Dashboard</h2>
<a href="/logout">Logout</a>
<br />
<h2>License Dashboard</h2>

<input
  id="search"
  placeholder="Search by license, email, store..."
  style="padding:8px;width:300px;margin-bottom:15px"
/>

<table>
<tr>
<th>License</th><th>Customer</th><th>Email</th><th>Store</th><th>Status</th><th>Created</th><th>Actions</th>
</tr>

${Object.entries(licenses).map(([key,lic])=>`
<tr>
<td><b>${key}</b></td>
<td>${lic.customer}</td>
<td>${lic.email}</td>
<td>${lic.store}</td>
<td>${lic.valid?"✅":"❌"}</td>
<td class="small">${new Date(lic.createdAt).toLocaleString()}</td>
<td>
<button class="btn copy" onclick="copyKey('${key}')">Copy</button>
${lic.valid?
`<button class="btn revoke" onclick="revoke('${key}')">Revoke</button>`:
`<button class="btn activate" onclick="activate('${key}')">Activate</button>`}
</td>
</tr>`).join("")}

</table>

<script>
function copyKey(k){navigator.clipboard.writeText(k)}
function revoke(k){fetch("/revoke?key="+k).then(()=>location.reload())}
function activate(k){fetch("/activate?key="+k).then(()=>location.reload())}

const search = document.getElementById("search");

search.addEventListener("keyup", function () {
  const value = this.value.toLowerCase();
  document.querySelectorAll("table tr").forEach((row, i) => {
    if (i === 0) return;
    row.style.display = row.innerText.toLowerCase().includes(value)
      ? ""
      : "none";
  });
});
</script>


</body></html>`;

  res.send(html);
});

// =====================================================
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log("Running"));



import express from "express";
import session from "express-session";
import bcrypt from "bcrypt";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import bodyParser from "body-parser";

// ===== CONFIG =====
const app = express();
const PORT = 3000;
const DATA_FILE = "licenses.json";
const CSS_FILE = "css/pro-theme.css";

// ===== OWNER LOGIN =====
const ADMIN_USER = "vertex";
const ADMIN_PASSWORD = "Vertex@2026$"; // CHANGE THIS
const ADMIN_PASS_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use(
  session({
    secret: "vertex-super-secret",
    resave: false,
    saveUninitialized: false,
  })
);

// ===== LOGIN MIDDLEWARE =====
function requireLogin(req, res, next) {
  if (req.session.loggedIn) return next();
  res.redirect("/login");
}

// ===== LOAD LICENSES =====
let licenses = {};
if (fs.existsSync(DATA_FILE)) {
  licenses = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

// ===== SAVE LICENSES =====
function saveLicenses() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(licenses, null, 2));
}

// ===== LICENSE GENERATOR =====
function generateLicenseKey() {
  const chunk = () =>
    crypto.randomBytes(2).toString("hex").toUpperCase();
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

  if (user !== ADMIN_USER) return res.send("Invalid credentials");

  const ok = await bcrypt.compare(pass, ADMIN_PASS_HASH);
  if (!ok) return res.send("Invalid credentials");

  req.session.loggedIn = true;
  res.redirect("/admin");
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// ================= SHOPIFY WEBHOOK =================

app.post("/webhook/orders/fulfilled", (req, res) => {
  try {
    const order = req.body;

    const customerName = order.destination
      ? `${order.destination.first_name} ${order.destination.last_name}`
      : "unknown";

    const licenseKey = generateLicenseKey();

    licenses[licenseKey] = {
      customer: customerName,
      email: order.email,
      store: order.myshopify_domain || "unknown-store",
      createdAt: new Date(),
      valid: true,
    };

    saveLicenses();

    res.json({ success: true, licenseKey });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// ================= VALIDATE LICENSE =================

app.get("/validate", (req, res) => {
  const { key, store } = req.query;

  const lic = licenses[key];
  if (!lic || !lic.valid) return res.json({ valid: false });

  if (lic.store === "unknown-store" && store) {
    lic.store = store;
    saveLicenses();
  }

  if (lic.store !== store && lic.store !== "unknown-store")
    return res.json({ valid: false });

  res.json({
    valid: true,
    cssUrl: `https://api-vertex.com/theme.css?key=${key}&store=${store}`,
  });
});

// ================= CSS =================

app.get("/theme.css", (req, res) => {
  const lic = licenses[req.query.key];
  if (!lic || !lic.valid) return res.sendStatus(403);

  const cssPath = path.join(process.cwd(), CSS_FILE);
  res.type("text/css").send(fs.readFileSync(cssPath));
});

// ================= ADMIN =================

app.get("/licenses", requireLogin, (req, res) => res.json(licenses));

app.get("/revoke", requireLogin, (req, res) => {
  licenses[req.query.key].valid = false;
  saveLicenses();
  res.json({ success: true });
});

app.get("/activate", requireLogin, (req, res) => {
  licenses[req.query.key].valid = true;
  saveLicenses();
  res.json({ success: true });
});

app.get("/admin", requireLogin, (req, res) => {
  res.send(`
  <h2>License Dashboard</h2>
  <a href="/logout">Logout</a>
  <pre>${JSON.stringify(licenses, null, 2)}</pre>
  `);
});

// ================= HEALTH =================

app.get("/health", (req, res) => res.json({ ok: true }));

// ================= START =================

app.listen(PORT, () =>
  console.log("Server running on port " + PORT)
);


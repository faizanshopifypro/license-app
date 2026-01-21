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

// =====================================================
// 1️⃣ SHOPIFY WEBHOOK — ORDER PAID → GENERATE LICENSE
// =====================================================
app.post("/webhook/orders/fulfilled", (req, res) => {
  try {
    const order = req.body;

    const customerName =
    order.destination ? `${order.destination.first_name} ${order.destination.last_name}` : "unknown";
    const customerEmail =  order.email;
    const storeDomain = order.myshopify_domain || "unknown-store";

    const licenseKey = generateLicenseKey();

    licenses[licenseKey] = {
      customer: customerName,
      email: customerEmail,
      store: storeDomain,
      createdAt: new Date(),
      valid: true
    };

    saveLicenses();

    return res.json({
      success: true,
      message: "License created successfully",
      licenseKey,
    });

  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ success: false, message: "Webhook processing failed" });
  }
});

// =====================================================
// 2️⃣ VALIDATE LICENSE
// =====================================================
app.get("/validate", (req, res) => {
  const { key, store } = req.query;

  if (!key) return res.status(400).json({ valid: false, message: "License key is required ❌" });

  const license = licenses[key];
  if (!license)
    return res.status(404).json({ valid: false, message: "License not found ❌" });

  if (!license.valid)
    return res.status(403).json({ valid: false, message: "License revoked ❌" });

  // -------------------------------
  // 1️⃣ First time use → store = unknown-store
  // -------------------------------
  if (license.store === "unknown-store") {
    // Save the store permanently
    if (store) {
      license.store = store;
      saveLicenses();
    }

    return res.json({
      valid: true,
      firstTime: true,
      message: "License activated for the first time and store locked 🔒",
      cssUrl: `http://localhost:3000/theme.css?key=${key}&store=${store}`
    });
  }

  // -------------------------------
  // 2️⃣ After first activation → verify store match
  // -------------------------------
  if (!store) {
    return res.status(400).json({
      valid: false,
      message: "Store domain required after activation ❌"
    });
  }

  if (license.store !== store) {
    return res.status(403).json({
      valid: false,
      message: `License already activated by another store (${license.store}) ❌`
    });
  }

  return res.json({
    valid: true,
    message: "License verified successfully ✅",
    cssUrl: `http://localhost:3000/theme.css?key=${key}&store=${store}`,
    license
  });
});


// =====================================================
// 3️⃣ PROTECTED CSS DELIVERY
// =====================================================
app.get("/theme.css", (req, res) => {
  const { key, store } = req.query;

  const license = licenses[key];
  if (!license)
    return res.status(404).send("License not found");

  // ❌ Block revoked license
  if (!license.valid)
    return res.status(403).send("License revoked");

  // First-time activation
  if (license.store === "unknown-store") {
    return sendCss(res);
  }

  // Store mismatch
  if (license.store !== store) {
    return res.status(403).send("License invalid for this store");
  }

  return sendCss(res);
});


function sendCss(res) {
  const cssPath = path.join(process.cwd(), CSS_FILE);
  if (!fs.existsSync(cssPath)) return res.status(404).send("CSS file not found");

  res.setHeader("Content-Type", "text/css");
  res.send(fs.readFileSync(cssPath, "utf8"));
}


// =====================================================
// 4️⃣ LIST ALL LICENSES (admin use)
// =====================================================
app.get("/licenses", (req, res) => {
  res.json(licenses);
});

// =====================================================
// 5️⃣ REVOKE LICENSE
// =====================================================
app.get("/revoke", (req, res) => {
  const { key } = req.query;
  if (!key || !licenses[key]) {
    return res.status(404).json({ success: false, message: "License not found ❌" });
  }

  licenses[key].valid = false;
  saveLicenses();

  return res.json({ success: true, message: "License revoked 🔒" });
});

// =====================================================
// 6️⃣ ACTIVATE LICENSE
// =====================================================
app.get("/activate", (req, res) => {
  const { key } = req.query;
  if (!key || !licenses[key]) {
    return res.status(404).json({ success: false, message: "License not found ❌" });
  }

  licenses[key].valid = true;
  saveLicenses();

  return res.json({ success: true, message: "License activated 🔓" });
});
// ================================
//  🔐 ADMIN DASHBOARD (HTML PAGE)
// ================================
app.get("/admin", (req, res) => {
  const html = `
  <html>
  <head>
    <title>License Dashboard</title>
    <style>
      body { font-family: Arial; margin: 30px; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      th, td { padding: 12px; border-bottom: 1px solid #ddd; text-align: left; }
      th { background: #f4f4f4; }
      .btn {
        padding: 6px 10px;
        border: none;
        cursor: pointer;
        border-radius: 4px;
      }
      .revoke { background: #e53935; color: white; }
      .activate { background: #43a047; color: white; }
      .copy { background: #3949ab; color: white; }
      .info { background: #00897b; color: white; }
      .small { font-size: 13px; opacity: 0.7; }
    </style>
  </head>
  <body>

    <h2>License Dashboard</h2>
    <button onclick="location.reload()" class="btn info">Reload</button>

    <table>
      <tr>
        <th>License Key</th>
        <th>Customer</th>
        <th>Email</th>
        <th>Store</th>
        <th>Status</th>
        <th>Created</th>
        <th>Actions</th>
      </tr>

      ${Object.entries(licenses)
        .map(([key, lic]) => {
          return `
            <tr>
              <td><b>${key}</b></td>
              <td>${lic.customer}</td>
              <td>${lic.email}</td>
              <td>${lic.store}</td>
              <td>${lic.valid ? "✅ Active" : "❌ Revoked"}</td>
              <td class="small">${new Date(lic.createdAt).toLocaleString()}</td>
              <td>
                <button class="btn copy" onclick="copyKey('${key}')">Copy</button>
                <button class="btn info" onclick='viewLicense("${Buffer.from(JSON.stringify(lic)).toString("base64")}")'>View</button>
                ${
                  lic.valid
                    ? `<button class="btn revoke" onclick="revoke('${key}')">Revoke</button>`
                    : `<button class="btn activate" onclick="activate('${key}')">Activate</button>`
                }
              </td>
            </tr>
          `;
        })
        .join("")}
    </table>

 <script>
  function copyKey(key) {
    navigator.clipboard.writeText(key);
    alert("Copied: " + key);
  }

  function revoke(key) {
    if (!confirm("Revoke this license?")) return;
    fetch("/revoke?key=" + key)
      .then(res => res.json())
      .then(data => {
        alert(data.message);
        location.reload();
      });
  }

  function activate(key) {
    if (!confirm("Activate this license?")) return;
    fetch("/activate?key=" + key)
      .then(res => res.json())
      .then(data => {
        alert(data.message);
        location.reload();
      });
  }

  function viewLicense(encoded) {
    let json = atob(encoded);
    alert(json);
  }
</script>


  </body>
  </html>
  `;

  res.send(html);
});

// =====================================================
// 7️⃣ HEALTH CHECK
// =====================================================
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "License server running 🚀" });
});

// =====================================================
app.listen(PORT, () =>
  console.log(`🚀 License server running at http://localhost:${PORT}`)
);

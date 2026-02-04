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
  <style>
        body {
            font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px;
            font-weight: 400;
            margin: 30px;
            background: linear-gradient(135deg, #020617 0%, #020617 40%, #0B1120 65%, #1E3A8A 100%);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            height: -webkit-fill-available;
        }

        h2 {
            color: #F9FAFB;
            margin-top: 0;
            margin-bottom: 15px;
            font-size: 28px;
            font-weight: 700;
        }

        .login-box {
            background-color: #111827;
            border-radius: 8px;
            padding: 30px;
            width: 100%;
            max-width: 250px;
            text-align: center;
            overflow: hidden;
            box-shadow: rgba(0, 0, 0, 0.35) 0px 5px 15px;
        }

        input {
            width: 100%;
            border: none;
            outline: none;
            padding: 10px 15px;
            border-radius: 50px;
        }

        button {
            background-color: white;
            padding: 6px 12px;
            margin: 0;
            text-decoration: none;
            border-radius: 5px;
            font-size: 12px;
            font-weight: 400;
            color: #000;
            text-transform: uppercase;
            transition: all 0.3s ease;
            border: 1px solid transparent;
            cursor: pointer;
        }

        button:hover {
            border: 1px solid #1E3A8A;
            box-shadow: -4px 4px #1E3A8A;
        }
    </style>
 <div class="login-box">
        <h2>Admin Login</h2>
        <form method="POST">
            <input name="user" placeholder="Username"><br><br>
            <input name="pass" type="password" placeholder="Password"><br><br>
            <button>Login</button>
        </form>
    </div>
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
        body {
            font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px;
            font-weight: 400;
            margin: 30px;
            background: linear-gradient(135deg, #020617 0%, #020617 40%, #0B1120 65%, #1E3A8A 100%);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: self-start;
            height: -webkit-fill-available;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            background-color: #111827;
            border-radius: 8px;
            overflow: hidden;
           box-shadow: rgba(0, 0, 0, 0.35) 0px 5px 15px;
        }

        h2 {
            color: #F9FAFB;
            margin-top: 0;
            margin-bottom: 0;
            font-size: 28px;
            font-weight: 700;
        }

        .das-logout {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            margin-bottom:40px;
        }

        h4 {
            font-size: 20px;
            font-weight: 700;
            color: #F9FAFB;
            margin-bottom: 20px;
            margin-top: 20px;
        }

        .das-logout a {
            background-color: white;
            padding: 10px;
            margin: 0;
            text-decoration: none;
            border-radius: 5px;
            font-size: 13px;
            font-weight: 500;
            color: #000;
            text-transform: uppercase;
            transition: all 0.3s ease;
            border: 1px solid transparent;
        }

        .das-logout a:hover {
            border: 1px solid #1E3A8A;
            box-shadow: -5px 5px #1E3A8A;
        }

        input#search {
            border: none;
            outline: none;
            padding: 11px !important;
            border-radius: 5px;
        }

        th,
        td {
            padding: 12px;
            border-bottom: 1px solid #1F2937;
            text-align: left;
        }

        th {
            background: #202234;
            color: #CBD5E1;
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }

        td {
            color: #fff;
        }

        tr {
            background-color: #191D2B;
            font-size: 13px;
            font-weight: 400;
            color: #94A3B8;
        }

        .icon-svg {
            text-align: center;
        }

        .icon-svg svg {
            fill: green;
            width: 18px;
            text-align: center;
            background: #fff;
            border-radius: 50px;
            padding: 2px;
        }

        .btn {
            padding: 6px 10px;
            border: none;
            cursor: pointer;
            border-radius: 4px;
            transition: opacity 0.2s ease, transform 0.1s ease;
            font-size: 14px;
            font-weight: 500;
        }

        td.button-display {
            display: flex;
            justify-content: space-around;
        }

        .revoke {
            background: #e53935;
            color: white;
            border: 1px solid transparent;
            transition: all 0.3s ease;
        }

        .revoke:hover {
            box-shadow: -4px 4px white;
            border: 1px solid #e53935;
        }

        .copy {
            background: #3949ab;
            color: white;
            border: 1px solid transparent;
            transition: all 0.3s ease;
        }

        .copy:hover {
            box-shadow: -4px 4px white;
            border: 1px solid #3949ab;
        }

        .info {
            background: #00897b;
            color: white;
        }

        .small {
            font-size: 13px;
            opacity: 0.7;
            color: #fff;
        }

        /* Tablets (768px to 1024px) */
        @media screen and (max-width: 1024px) {
            body {
                margin: 20px;
            }

            input#search {
                width: 100%;
                max-width: 400px;
            }

            table {
                font-size: 13px;
            }

            h2 {
                font-size: 24px;
            }

            h4 {
                font-size: 18px;
            }


            td.button-display {
                flex-direction: column;
                gap: 6px;
            }
        }

        /* Mobile (up to 767px) */
        @media screen and (max-width: 767px) {
            body {
                margin: 15px;
            }

            h2 {
                font-size: 20px;
            }

            h4 {
                font-size: 16px;
            }

            input#search {
                width: 100%;
                padding: 10px;
                font-size: 13px;
            }

            table {
                display: block;
                overflow-x: auto;
                font-size: 12px;
                width: 100%;
            }

            th,
            td {
                padding: 10px;
            }

            td.button-display {
                flex-direction: column;
                gap: 6px;
            }

            .das-logout {
                flex-direction: column;
                align-items: flex-start;
                gap: 8px;
            }
        }
    </style>
  </head>
  <body>
<div class="das-logout">
        <h2>VERTEX COMMERCE</h2>
    </div>
<div class="das-logout">
        <h2 style="text-align:center;margin:20px 0px;">License Dashboard</h2>
        <a href="/logout">Logout</a>
    </div>
<h4>User & License Search</h4>

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
<td class="icon-svg">${lic.valid?"✔️":"❌"}</td>
<td class="small">${new Date(lic.createdAt).toLocaleString()}</td>
<td class="button-display">
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









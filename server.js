// server.js
// Admin API: manage clients and control bots

const express = require("express");
const fs = require("fs");
const path = require("path");
const { startBot, stopBot, updateClientConfig, getLatestQr } = require("./botManager");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DB_DIR = path.join(__dirname, "database");
const DB_FILE = path.join(DB_DIR, "clients.json");

// ensure database folder + file exist
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]", "utf8");

function readClients() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    return [];
  }
}
function saveClients(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}

// GET all clients
app.get("/clients", (req, res) => {
  res.json(readClients());
});

// GET single client
app.get("/clients/:clientId", (req, res) => {
  const clients = readClients();
  const c = clients.find(x => x.clientId === req.params.clientId);
  if (!c) return res.status(404).json({ error: "not_found" });
  res.json(c);
});

// Add client (admin / dashboard calls this)
app.post("/clients", (req, res) => {
  const { clientId, trigger, welcome, plan_expiry } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });

  const clients = readClients();
  if (clients.find(c => c.clientId === clientId)) {
    return res.status(400).json({ error: "client exists" });
  }

  const newClient = {
    clientId,
    trigger: (trigger || "menu").toLowerCase(),
    welcome: welcome || "Welcome! How can I help?",
    plan_expiry: plan_expiry || null,
    botStatus: true,
    warning_sent: false,
    connection_status: "disconnected"
  };

  clients.push(newClient);
  saveClients(clients);

  // start bot immediately
  startBot(newClient).catch(err => console.error("startBot error:", err));

  res.json({ status: "ok", client: newClient });
});

// PATCH client (update)
app.patch("/clients/:clientId", (req, res) => {
  const clients = readClients();
  const idx = clients.findIndex(c => c.clientId === req.params.clientId);
  if (idx === -1) return res.status(404).json({ error: "not_found" });

  const updated = { ...clients[idx], ...req.body };
  clients[idx] = updated;
  saveClients(clients);

  // update in-memory bot config too
  updateClientConfig(req.params.clientId, updated);

  res.json({ status: "ok", client: updated });
});

// Toggle bot on/off
app.post("/bot/toggle", (req, res) => {
  const { clientId, status } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });

  const clients = readClients();
  const c = clients.find(x => x.clientId === clientId);
  if (!c) return res.status(404).json({ error: "not_found" });

  c.botStatus = !!status;
  saveClients(clients);
  updateClientConfig(clientId, { botStatus: c.botStatus });

  // if turning off, optionally stop the bot process
  if (!c.botStatus) stopBot(clientId).catch(()=>{});

  res.json({ status: "ok", botStatus: c.botStatus });
});

// Get QR for a client (dashboard polls this after creating client)
app.get("/bot/qr/:clientId", (req, res) => {
  const dataUrl = getLatestQr(req.params.clientId);
  if (!dataUrl) return res.status(404).json({ error: "qr_not_ready" });
  res.json({ qrDataUrl: dataUrl });
});

// Start existing clients on server start
async function startExistingBots() {
  const clients = readClients();
  for (const c of clients) {
    if (c.botStatus) {
      try { await startBot(c); } catch (e) { console.error("startExistingBots:", e); }
    }
  }
}

app.listen(PORT, async () => {
  console.log(`Admin API running on port ${PORT}`);
  await startExistingBots();
});

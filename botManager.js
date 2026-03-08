// botManager.js
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const path = require("path");
const { loadMemory, saveMemory, appendMemory } = require("./memory");

const activeBots = new Map(); // clientId -> { client, config, latestQr }

// Puppeteer options - Render needs no-sandbox flags and correct chromium path
function createClientInstance(clientId) {
  return new Client({
    authStrategy: new LocalAuth({ clientId }),
    puppeteer: {
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    }
  });
}

async function startBot(clientConfig) {
  const clientId = clientConfig.clientId;
  if (activeBots.has(clientId)) return; // already running

  const client = createClientInstance(clientId);
  let latestQrDataUrl = null;

  client.on("qr", qrString => {
    // save data URL for dashboard and also print to console
    qrcodeTerminal.generate(qrString, { small: true });
    qrcode.toDataURL(qrString)
      .then(dataUrl => { latestQrDataUrl = dataUrl; })
      .catch(() => { latestQrDataUrl = null; });
    console.log(`QR generated for ${clientId} - dashboard can poll /bot/qr/${clientId}`);
  });

  client.on("ready", () => {
    console.log(`${clientId} bot ready`);
  });

  client.on("auth_failure", (err) => {
    console.error(`${clientId} auth failure`, err && err.message);
  });

  client.on("disconnected", (reason) => {
    console.log(`${clientId} disconnected:`, reason);
    // keep the entry but mark disconnected; dashboard/backend can handle reconnect logic or restart
  });

  client.on("message", async message => {
    try {
      // load fresh config from activeBots map (in case server updated it)
      const entry = activeBots.get(clientId);
      const config = entry && entry.config ? entry.config : clientConfig;

      if (!config || !config.botStatus) return;

      const user = message.from;
      const text = (message.body || "").trim();

      // Trigger
      if (text.toLowerCase() === (config.trigger || "menu").toLowerCase()) {
        await client.sendMessage(user, config.welcome || "Welcome!");
        // create a session tracker (optional) - here we just reply and return
        appendMemory(clientId, user, "assistant", config.welcome || "Welcome!");
        return;
      }

      // Menu simple
      if (text.toLowerCase() === "menu") {
        await client.sendMessage(user, "1️⃣ Products\n2️⃣ Support\n3️⃣ Pricing");
        appendMemory(clientId, user, "assistant", "1️⃣ Products\n2️⃣ Support\n3️⃣ Pricing");
        return;
      }

      // Default: use AI (Cohere) - call function via require to avoid circular deps
      const { aiReply } = require("./ai");
      const reply = await aiReply(text, clientId, user); // aiReply handles memory as well
      await client.sendMessage(user, reply);
    } catch (err) {
      console.error("message handler error:", err && err.message);
      try { await client.sendMessage(message.from, "Sorry, something went wrong."); } catch(e){ }
    }
  });

  await client.initialize();

  activeBots.set(clientId, { client, config: clientConfig, getLatestQr: () => latestQrDataUrl });
  return;
}

async function stopBot(clientId) {
  const entry = activeBots.get(clientId);
  if (!entry) return;
  try {
    await entry.client.destroy();
  } catch (e) { /* ignore */ }
  activeBots.delete(clientId);
}

function updateClientConfig(clientId, newConfig) {
  const entry = activeBots.get(clientId);
  if (entry) {
    entry.config = { ...entry.config, ...newConfig };
    activeBots.set(clientId, entry);
  }
}

function getLatestQr(clientId) {
  const entry = activeBots.get(clientId);
  if (!entry) return null;
  return entry.getLatestQr();
}

module.exports = { startBot, stopBot, updateClientConfig, getLatestQr, activeBots };

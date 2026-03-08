const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const { loadMemory, appendMemory } = require("./memory");

const activeBots = new Map(); // clientId -> { client, config, latestQr }

function createClientInstance(clientId) {
  return new Client({
    authStrategy: new LocalAuth({ clientId }),
    puppeteer: {
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process"
      ]
    }
  });
}

async function startBot(clientConfig) {
  const clientId = clientConfig.clientId;

  if (!clientId) {
    throw new Error("clientId required");
  }

  if (activeBots.has(clientId)) {
    console.log(`Bot already running for ${clientId}`);
    return;
  }

  const client = createClientInstance(clientId);
  let latestQrDataUrl = null;

  client.on("qr", qrString => {
    qrcodeTerminal.generate(qrString, { small: true });

    qrcode.toDataURL(qrString)
      .then(dataUrl => {
        latestQrDataUrl = dataUrl;
      })
      .catch(() => {
        latestQrDataUrl = null;
      });

    console.log(`QR generated for ${clientId} - dashboard can poll /bot/qr/${clientId}`);
  });

  client.on("authenticated", () => {
    console.log(`${clientId} authenticated`);
  });

  client.on("ready", () => {
    console.log(`${clientId} bot ready`);
  });

  client.on("auth_failure", (err) => {
    console.error(`${clientId} auth failure`, err && err.message);
  });

  client.on("disconnected", (reason) => {
    console.log(`${clientId} disconnected:`, reason);
  });

  client.on("message", async message => {
    try {
      const entry = activeBots.get(clientId);
      const config = entry && entry.config ? entry.config : clientConfig;

      if (!config || !config.botStatus) return;

      const user = message.from;
      const text = (message.body || "").trim().toLowerCase();

      if (!text) return;

      // Trigger
      if (text === (config.trigger || "menu").toLowerCase()) {
        const reply = config.welcome || "Welcome!";
        await client.sendMessage(user, reply);
        appendMemory(clientId, user, "assistant", reply);
        return;
      }

      // Menu command
      if (text === "menu") {
        const menu = "1️⃣ Products\n2️⃣ Support\n3️⃣ Pricing";
        await client.sendMessage(user, menu);
        appendMemory(clientId, user, "assistant", menu);
        return;
      }

      // Load memory context
      loadMemory(clientId, user);

      // AI reply
      const { aiReply } = require("./ai");
      const reply = await aiReply(text, clientId, user);

      if (reply) {
        await client.sendMessage(user, reply);
      }

    } catch (err) {
      console.error("Message handler error:", err && err.message);

      try {
        await client.sendMessage(message.from, "Sorry, something went wrong.");
      } catch (e) {}
    }
  });

  await client.initialize();

  activeBots.set(clientId, {
    client,
    config: clientConfig,
    getLatestQr: () => latestQrDataUrl
  });
}

async function stopBot(clientId) {
  const entry = activeBots.get(clientId);
  if (!entry) return;

  try {
    await entry.client.destroy();
  } catch (e) {}

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

module.exports = {
  startBot,
  stopBot,
  updateClientConfig,
  getLatestQr,
  activeBots
};

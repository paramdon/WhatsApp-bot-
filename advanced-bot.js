// advanced-bot.js
// Multi-client WhatsApp bot engine with admin API, QR generation, memory, plan checks.
// Requirements: npm i whatsapp-web.js express axios qrcode fs-extra

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const qrcodeLib = require('qrcode'); // toDataURL
const { Client, LocalAuth } = require('whatsapp-web.js');

// ---------- CONFIG ----------
const PORT = process.env.PORT || 3000;
const BACKEND_API_BASE = process.env.BACKEND_API_BASE || 'http://localhost:3000'; 
// BACKEND_API_BASE is your Lovable / Supabase REST endpoint that exposes client configs and receives updates.
// Example endpoints used below (you can adapt):
// GET  ${BACKEND_API_BASE}/clients          -> list all clients
// POST ${BACKEND_API_BASE}/clients         -> add client (body includes clientId, whatsapp_number, trigger, welcome, plan_expiry, bot_status)
// PATCH ${BACKEND_API_BASE}/clients/:id    -> update client
// (If you use Supabase, adapt axios calls to supabase REST or SDK.)
const COHERE_API_KEY = process.env.COHERE_API_KEY || ''; // use :contentReference[oaicite:1]{index=1} key
const MEMORY_DIR = path.resolve(__dirname, 'memory');
const SESSIONS_DIR = path.resolve(__dirname, 'sessions');

fs.ensureDirSync(MEMORY_DIR);
fs.ensureDirSync(SESSIONS_DIR);

// limits
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours active session per user
const MEMORY_MAX_MESSAGES = 12; // per-user short-term memory

// ---------- STATE ----------
const activeBots = new Map(); // clientId -> { clientInstance, config, qrDataUrl }
const activeSessions = new Map(); // `${clientId}|${userNumber}` -> { start }

// ---------- HELPERS ----------
async function safeGetClients() {
  try {
    const res = await axios.get(`${BACKEND_API_BASE}/clients`);
    return Array.isArray(res.data) ? res.data : [];
  } catch (e) {
    console.error('Error fetching clients from backend:', e.message);
    return [];
  }
}

function memoryPathFor(userNumber) {
  // userNumber like "9198...@c.us" -> strip @c.us for filename
  const clean = userNumber.replace(/[^0-9]/g, '');
  return path.join(MEMORY_DIR, `${clean}.json`);
}

function loadMemory(userNumber) {
  const p = memoryPathFor(userNumber);
  try {
    const data = fs.readFileSync(p, 'utf8');
    return JSON.parse(data);
  } catch {
    return { messages: [] };
  }
}

function saveMemory(userNumber, memoryObj) {
  const p = memoryPathFor(userNumber);
  fs.writeFileSync(p, JSON.stringify(memoryObj));
}

function appendMemory(userNumber, role, text) {
  const mem = loadMemory(userNumber);
  mem.messages = mem.messages || [];
  mem.messages.push({ role, text, time: Date.now() });
  if (mem.messages.length > MEMORY_MAX_MESSAGES) mem.messages = mem.messages.slice(-MEMORY_MAX_MESSAGES);
  saveMemory(userNumber, mem);
}

function planStatusFromExpiry(expiryIso) {
  if (!expiryIso) return 'expired';
  const now = new Date();
  const expiry = new Date(expiryIso);
  const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'expired';
  if (diffDays <= 2) return 'warning';
  return 'active';
}

// ---------- AI (Cohere) ----------
async function askCohere(promptText, history = []) {
  if (!COHERE_API_KEY) return 'AI not configured.';
  try {
    // lightweight chat-style call - adjust for your Cohere plan / API
    const payload = {
      model: 'command-r',
      message: promptText,
      // optionally include history as you like; here we send just the prompt
    };
    const res = await axios.post('https://api.cohere.ai/v1/chat', payload, {
      headers: {
        Authorization: `Bearer ${COHERE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    return (res.data && res.data.text) ? res.data.text : 'No reply from AI.';
  } catch (err) {
    console.error('Cohere error:', err?.response?.data || err.message);
    return 'AI error. Try again later.';
  }
}

// ---------- BOT LIFECYCLE ----------
async function startBotForClient(clientConfig) {
  const clientId = clientConfig.clientId;
  if (activeBots.has(clientId)) {
    console.log(`Bot already started for ${clientId}`);
    return;
  }

  console.log(`Starting bot for ${clientId} ...`);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId }),
    puppeteer: { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] }
  });

  // temporary place to hold latest QR image data URL so dashboard can fetch it
  let latestQrDataUrl = null;

  client.on('qr', async qrString => {
    // create data URL and store
    try {
      latestQrDataUrl = await qrcodeLib.toDataURL(qrString);
    } catch (e) {
      console.warn('QR -> toDataURL failed, dashboard can still show raw string.');
      latestQrDataUrl = null;
    }
    console.log(`QR generated for ${clientId} (dashboard can fetch /bot/qr/${clientId})`);
  });

  client.on('ready', () => {
    console.log(`WhatsApp client ready for ${clientId}`);
    // push back config to backend (status = connected) if needed
    axios.patch(`${BACKEND_API_BASE}/clients/${clientId}`, { connection_status: 'connected' }).catch(()=>{});
  });

  client.on('auth_failure', (err) => {
    console.error(`Auth failure for ${clientId}:`, err);
    axios.patch(`${BACKEND_API_BASE}/clients/${clientId}`, { connection_status: 'auth_failure' }).catch(()=>{});
  });

  client.on('disconnected', (reason) => {
    console.log(`Client ${clientId} disconnected: ${reason}`);
    axios.patch(`${BACKEND_API_BASE}/clients/${clientId}`, { connection_status: 'disconnected' }).catch(()=>{});
  });

  client.on('message_create', async message => {
    // message_create fires for messages sent by us too; use 'message' if you prefer only incoming
  });

  client.on('message', async message => {
    try {
      // load latest client config each message (keeps dashboard changes effective immediately)
      const res = await axios.get(`${BACKEND_API_BASE}/clients/${clientId}`).catch(()=>({data: clientConfig}));
      const config = res.data || clientConfig;

      if (!config.botStatus) return; // disabled by admin / expired

      // plan check
      const planState = planStatusFromExpiry(config.plan_expiry);
      if (planState === 'expired') {
        await client.sendMessage(message.from, '❌ Your automation plan has expired. Please renew in your dashboard to continue.');
        return;
      }
      if (planState === 'warning' && !config._warningSent) {
        // send warning once; backend should record warning_sent to avoid repeating (here we attempt)
        await client.sendMessage(message.from, '⚠️ Your plan expires in 2 days. Renew to avoid interruption.');
        // tell backend warning was sent (so it can persist)
        axios.patch(`${BACKEND_API_BASE}/clients/${clientId}`, { warning_sent: true }).catch(()=>{});
      }

      // Trigger activation: user sends the client's trigger word (e.g., 'menu')
      const text = (message.body || '').toString().trim().toLowerCase();
      const userKey = `${clientId}|${message.from}`;

      if (text === (config.trigger || 'menu').toLowerCase()) {
        // start session
        activeSessions.set(userKey, { start: Date.now() });
        await client.sendMessage(message.from, config.welcome || 'Welcome! How can I help?');
        return;
      }

      // ignore unless user has active session
      const session = activeSessions.get(userKey);
      if (!session) return;

      // check session expiry
      if (Date.now() - session.start > SESSION_TTL_MS) {
        activeSessions.delete(userKey);
        await client.sendMessage(message.from, "Session expired. Send the trigger word to start again.");
        return;
      }

      // save user message to memory
      appendMemory(message.from, 'user', message.body);

      // check for simple keywords (faq) - optional: if your backend stores FAQs, fetch and match
      // (skipping here; fallback to AI)

      // AI fallback
      const mem = loadMemory(message.from);
      const recent = (mem.messages || []).map(m => `${m.role}: ${m.text || m.content}`).join('\n');
      const prompt = `You are a helpful assistant for ${config.business_name || clientId}. User: ${message.body}\nContext:\n${recent}`;

      const aiReply = await askCohere(message.body, mem.messages);

      // save assistant reply
      appendMemory(message.from, 'assistant', aiReply);

      // send reply
      await client.sendMessage(message.from, aiReply);

    } catch (err) {
      console.error('Message handler error:', err?.message || err);
      try { await client.sendMessage(message.from, 'Sorry, something went wrong.'); } catch {}
    }
  });

  await client.initialize();

  activeBots.set(clientId, { client, config: clientConfig, latestQrDataUrl: () => latestQrDataUrl });
  console.log(`Started bot for ${clientId}`);
}

// stop a bot (if needed)
async function stopBot(clientId) {
  const entry = activeBots.get(clientId);
  if (!entry) return;
  try {
    await entry.client.destroy();
  } catch { /* ignore */ }
  activeBots.delete(clientId);
  console.log(`Stopped bot for ${clientId}`);
}

// start all clients from backend
async function startAllFromBackend() {
  const clients = await safeGetClients();
  for (const c of clients) {
    if (c.botStatus) await startBotForClient(c);
  }
}

// ---------- EXPRESS ADMIN API (for dashboard) ----------
const app = express();
app.use(express.json());

// list active bots (for admin UI)
app.get('/bot/active', (req, res) => {
  const list = [];
  for (const [clientId, entry] of activeBots.entries()) {
    list.push({ clientId, connected: !!entry.client.info, config: entry.config });
  }
  res.json(list);
});

// get QR image for client (dashboard will poll this after creating client)
app.get('/bot/qr/:clientId', async (req, res) => {
  const clientId = req.params.clientId;
  const entry = activeBots.get(clientId);
  if (!entry) return res.status(404).json({ error: 'bot not started' });
  // return the last QR data URL if available
  const dataUrl = entry.latestQrDataUrl();
  if (!dataUrl) return res.status(404).json({ error: 'QR not ready (check console)' });
  // send as JSON (dashboard can render data URL directly)
  res.json({ qrDataUrl: dataUrl });
});

// admin endpoint to start a client immediately (also expected to be persisted by backend)
app.post('/bot/start', async (req, res) => {
  const clientConfig = req.body; // expect clientId, trigger, welcome, plan_expiry, botStatus, etc.
  try {
    await startBotForClient(clientConfig);
    res.json({ status: 'started' });
  } catch (e) {
    console.error('start bot error', e);
    res.status(500).json({ error: 'start_failed' });
  }
});

// admin endpoint to stop a client
app.post('/bot/stop', async (req, res) => {
  const { clientId } = req.body;
  await stopBot(clientId);
  res.json({ status: 'stopped' });
});

// health check
app.get('/health', (req, res) => res.send('ok'));

// start express
app.listen(PORT, async () => {
  console.log(`Admin API listening on ${PORT}`);
  // start bots known in backend on startup
  await startAllFromBackend();
});

// graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  for (const clientId of Array.from(activeBots.keys())) await stopBot(clientId);
  process.exit();
});


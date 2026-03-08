// memory.js - stores memory per client & user to avoid collisions
const fs = require("fs");
const path = require("path");

const BASE = path.join(__dirname, "memory"); // ensure exists
if (!fs.existsSync(BASE)) fs.mkdirSync(BASE, { recursive: true });

function safeName(s) {
  // clientId + userNumber -> filename
  return (s || "").replace(/[^a-z0-9-_]/gi, "_");
}

function memoryPath(clientId, userNumber) {
  const filename = `${safeName(clientId)}__${safeName(userNumber)}.json`;
  return path.join(BASE, filename);
}

function loadMemory(clientId, userNumber) {
  const p = memoryPath(clientId, userNumber);
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { messages: [] };
  }
}

function saveMemory(clientId, userNumber, obj) {
  const p = memoryPath(clientId, userNumber);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function appendMemory(clientId, userNumber, role, text) {
  const mem = loadMemory(clientId, userNumber);
  mem.messages = mem.messages || [];
  mem.messages.push({ role, text, time: Date.now() });
  // keep max ~12 messages
  if (mem.messages.length > 12) mem.messages = mem.messages.slice(-12);
  saveMemory(clientId, userNumber, mem);
}

// exported helpers
module.exports = { loadMemory, saveMemory, appendMemory };

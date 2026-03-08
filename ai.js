// ai.js (Cohere)
const { CohereClient } = require("cohere-ai");
const { appendMemory, loadMemory } = require("./memory");

const cohere = new CohereClient({ token: process.env.COHERE_API_KEY || "" });

async function aiReply(userMessage, clientId, userNumber) {
  // load recent memory for context
  const mem = loadMemory(clientId, userNumber); // we store memory per client/user (see memory.js)
  const history = (mem.messages || []).map(m => `${m.role}: ${m.text}`).join("\n");

  const prompt = `You are an assistant for ${clientId}. Context:\n${history}\nUser: ${userMessage}\nAssistant:`;

  try {
    const res = await cohere.chat({
      model: "command-r",
      message: prompt
    });
    const text = res?.text || "Sorry, I couldn't generate an answer.";
    appendMemory(clientId, userNumber, "assistant", text);
    return text;
  } catch (err) {
    console.error("Cohere error:", err?.message || err);
    return "AI error. Please try again later.";
  }
}

module.exports = { aiReply };

const { Client, LocalAuth } = require("whatsapp-web.js")
const qrcode = require("qrcode-terminal")
const { loadMemory, saveMemory } = require("./memory")

const activeBots = {}

function startBot(clientConfig) {

  if (activeBots[clientConfig.clientId]) return

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: clientConfig.clientId
    }),
    puppeteer: {
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox"
      ]
    }
  })

  client.on("qr", qr => {
    console.log("Scan QR for:", clientConfig.clientId)
    qrcode.generate(qr, { small: true })
  })

  client.on("ready", () => {
    console.log(clientConfig.clientId + " bot ready")
  })

  client.on("message", async msg => {

    if (!clientConfig.botStatus) return

    const user = msg.from

    let memory = loadMemory(user)

    memory.count = (memory.count || 0) + 1

    if (msg.body.toLowerCase() === clientConfig.trigger) {
      await client.sendMessage(user, clientConfig.welcome)
    }

    if (msg.body.toLowerCase() === "menu") {
      await client.sendMessage(
        user,
        "1️⃣ Products\n2️⃣ Support\n3️⃣ Pricing"
      )
    }

    saveMemory(user, memory)

  })

  client.initialize()

  activeBots[clientConfig.clientId] = client
}

module.exports = { startBot, activeBots }

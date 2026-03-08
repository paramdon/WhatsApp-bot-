const express = require("express")
const fs = require("fs")
const path = require("path")
const { startBot } = require("./botManager")

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000

const DB_DIR = path.join(__dirname, "database")
const DB = path.join(DB_DIR, "clients.json")

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR)
}

if (!fs.existsSync(DB)) {
  fs.writeFileSync(DB, "[]")
}

function readClients() {
  try {
    return JSON.parse(fs.readFileSync(DB))
  } catch {
    return []
  }
}

function saveClients(data) {
  fs.writeFileSync(DB, JSON.stringify(data, null, 2))
}

app.post("/add-client", (req, res) => {
  const { clientId, trigger, welcome } = req.body

  const clients = readClients()

  const client = {
    clientId,
    trigger,
    welcome,
    botStatus: true
  }

  clients.push(client)
  saveClients(clients)

  startBot(client)

  res.json({ status: "Client added and bot started" })
})

app.get("/clients", (req, res) => {
  res.json(readClients())
})

app.post("/bot/toggle", (req, res) => {
  const { clientId, status } = req.body

  let clients = readClients()
  const client = clients.find(c => c.clientId === clientId)

  if (client) {
    client.botStatus = status
  }

  saveClients(clients)

  res.json({ status: "Bot status updated" })
})

function startExistingBots() {
  const clients = readClients()

  clients.forEach(client => {
    if (client.botStatus) {
      startBot(client)
    }
  })
}

app.listen(PORT, () => {
  console.log(`Admin API running on port ${PORT}`)
  startExistingBots()
})

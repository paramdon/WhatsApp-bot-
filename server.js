const express = require("express")
const fs = require("fs")
const { startBot } = require("./botManager")

const app = express()
app.use(express.json())

const DB = "./database/clients.json"

// Read clients
function readClients(){
    try{
        return JSON.parse(fs.readFileSync(DB))
    } catch { return [] }
}

// Save clients
function saveClients(data){
    fs.writeFileSync(DB, JSON.stringify(data, null, 2))
}

// Add client API
app.post("/add-client", (req,res)=>{
    const { clientId, trigger, welcome } = req.body

    let clients = readClients()
    clients.push({
        clientId, trigger, welcome, botStatus: true
    })
    saveClients(clients)

    // Start bot immediately
    startBot({ clientId, trigger, welcome, botStatus: true })

    res.json({status:"Client added & bot started"})
})

// Get all clients
app.get("/clients",(req,res)=>{
    res.json(readClients())
})

// Toggle bot status
app.post("/bot/toggle",(req,res)=>{
    const { clientId, status } = req.body
    let clients = readClients()
    const client = clients.find(c=>c.clientId===clientId)
    if(client) client.botStatus = status
    saveClients(clients)
    res.json({status:"Bot status updated"})
})

app.listen(3000, ()=>console.log("Admin API running on port 3000"))
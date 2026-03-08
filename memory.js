const fs = require("fs")

function loadMemory(user){
    try {
        return JSON.parse(fs.readFileSync(`./memory/${user}.json`))
    } catch {
        return { messages: [] }
    }
}

function saveMemory(user, data){
    fs.writeFileSync(`./memory/${user}.json`, JSON.stringify(data))
}

module.exports = { loadMemory, saveMemory }
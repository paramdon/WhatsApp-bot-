const fs = require("fs")
const path = require("path")

const MEMORY_DIR = path.join(__dirname, "memory")

if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR)
}

function loadMemory(user) {

  const file = path.join(MEMORY_DIR, user + ".json")

  try {
    return JSON.parse(fs.readFileSync(file))
  } catch {
    return {}
  }
}

function saveMemory(user, data) {

  const file = path.join(MEMORY_DIR, user + ".json")

  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

module.exports = { loadMemory, saveMemory }

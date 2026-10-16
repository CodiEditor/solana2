// Mining Web Worker
// Computes SHA-256 hashes to find nonce that meets difficulty target

interface MiningTask {
  type: 'start'
  challenge: string
  difficulty: number
  target: string
}

interface StopTask {
  type: 'stop'
}

type WorkerMessage = MiningTask | StopTask

interface ProofMessage {
  type: 'proof'
  nonce: number
  hash: string
  challenge: string
  attempts: number
}

interface StatsMessage {
  type: 'stats'
  hashrate: number
  attempts: number
}

let mining = false
let currentChallenge: string | null = null
let attempts = 0
let startTime = 0

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

// Convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// Compute SHA-256 hash
async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  return bytesToHex(hashArray)
}

// Check if hash meets difficulty target
function meetsTarget(hash: string, target: string): boolean {
  return hash <= target
}

// Main mining loop
async function mine(challenge: string, difficulty: number, target: string) {
  mining = true
  currentChallenge = challenge
  attempts = 0
  startTime = Date.now()
  let nonce = 0
  let lastStatsTime = startTime

  while (mining && currentChallenge === challenge) {
    // Compute hash for current nonce
    const input = challenge + nonce.toString()
    const hash = await sha256(input)
    attempts++

    // Check if we found a valid proof
    if (meetsTarget(hash, target)) {
      self.postMessage({
        type: 'proof',
        nonce,
        hash,
        challenge,
        attempts
      } as ProofMessage)
      
      // Stop after finding proof - main thread will request new challenge
      mining = false
      break
    }

    nonce++

    // Report stats every second
    const now = Date.now()
    if (now - lastStatsTime >= 1000) {
      const elapsed = (now - startTime) / 1000
      const hashrate = Math.round(attempts / elapsed)
      self.postMessage({
        type: 'stats',
        hashrate,
        attempts
      } as StatsMessage)
      lastStatsTime = now
    }

    // Yield to prevent blocking (every 100 hashes)
    if (nonce % 100 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
}

// Handle messages from main thread
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data

  if (msg.type === 'start') {
    if (mining) {
      mining = false // Stop current task
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    mine(msg.challenge, msg.difficulty, msg.target)
  } else if (msg.type === 'stop') {
    mining = false
    currentChallenge = null
  }
}

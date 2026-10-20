// Mining worker: finds a nonce whose SHA-256(challenge + nonce) is at or below the target.
// Runs on the CPU with the Web Crypto API. INTENSITY sets the share of each cycle spent hashing.

type InMessage =
  | { type: 'start'; challenge: string; difficulty: number; target: string; intensity?: number }
  | { type: 'intensity'; value: number }
  | { type: 'stop' }

// Work in slices, then rest. Timers in a worker are clamped to about 4 ms once nested, so resting
// after every small batch would cap the speed even at 100%.
const SLICE_MS = 40
const MAX_REST_MS = 2000

let mining = false
let activeChallenge: string | null = null
let intensity = 75

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

async function mine(challenge: string, target: string) {
  mining = true
  activeChallenge = challenge
  let attempts = 0
  let nonce = 0
  const startedAt = Date.now()
  let lastStatsAt = startedAt

  while (mining && activeChallenge === challenge) {
    const sliceStart = performance.now()
    while (mining && activeChallenge === challenge && performance.now() - sliceStart < SLICE_MS) {
      const hash = await sha256Hex(challenge + nonce.toString())
      attempts++
      if (hash <= target) {
        // Report the measured rate first, so a quick share does not leave the display at 0 H/s.
        const seconds = Math.max((Date.now() - startedAt) / 1000, 0.001)
        self.postMessage({ type: 'stats', hashrate: Math.round(attempts / seconds), attempts })
        self.postMessage({ type: 'proof', nonce, hash, challenge, attempts })
        mining = false
        return
      }
      nonce++
    }

    const now = Date.now()
    if (now - lastStatsAt >= 1000) {
      self.postMessage({ type: 'stats', hashrate: Math.round(attempts / ((now - startedAt) / 1000)), attempts })
      lastStatsAt = now
    }

    // Rest in proportion to the work just done, so intensity 50 hashes about half of the time.
    const busy = performance.now() - sliceStart
    const rest = intensity >= 100 ? 0 : Math.min(MAX_REST_MS, busy * (100 - intensity) / intensity)
    await sleep(rest)
  }
}

self.onmessage = async (e: MessageEvent<InMessage>) => {
  const msg = e.data
  if (msg.type === 'start') {
    if (mining) {
      mining = false
      await sleep(10)
    }
    if (typeof msg.intensity === 'number') intensity = Math.min(100, Math.max(1, msg.intensity))
    void mine(msg.challenge, msg.target)
  } else if (msg.type === 'intensity') {
    intensity = Math.min(100, Math.max(1, msg.value))
  } else if (msg.type === 'stop') {
    mining = false
    activeChallenge = null
  }
}

// Mining utilities and types

export interface Challenge {
  challenge: string
  difficulty: number
  target: string
  expiresAt: number
}

export interface MiningProof {
  address: string
  nonce: number
  hash: string
  challenge: string
  hw?: string
}

export interface MiningStats {
  hashrate: number
  shares: number
  accepted: number
  rejected: number
}

// Generate difficulty target (hex string with N leading zeros)
export function difficultyToTarget(difficulty: number): string {
  // difficulty 3 = 0x000F...
  // difficulty 4 = 0x000F...
  // difficulty N = hash must be less than target
  const zeros = '0'.repeat(difficulty)
  const remaining = 'f'.repeat(64 - difficulty)
  return zeros + remaining
}

// Check if hash meets target
export function meetsTarget(hash: string, target: string): boolean {
  return hash.localeCompare(target) <= 0
}

// Calculate credits from difficulty
export function creditsFromDifficulty(difficulty: number): number {
  // difficulty 3 = ~4,096 hashes = 0.01 credits
  // difficulty 4 = ~65,536 hashes = 0.1 credits
  // difficulty 5 = ~1,048,576 hashes = 1.0 credits
  const avgHashes = Math.pow(16, difficulty)
  return avgHashes / 100000 // Scale factor
}

// Format hashrate for display
export function formatHashrate(hashrate: number): string {
  if (hashrate >= 1_000_000) {
    return (hashrate / 1_000_000).toFixed(2) + ' MH/s'
  }
  if (hashrate >= 1_000) {
    return (hashrate / 1_000).toFixed(2) + ' KH/s'
  }
  return hashrate.toFixed(0) + ' H/s'
}

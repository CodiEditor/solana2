// Crypto utilities for hash verification

import { createHash, randomBytes } from 'crypto'

// Compute SHA-256 hash (server-side with Node.js crypto)
export function sha256(message: string): string {
  return createHash('sha256').update(message).digest('hex')
}

// Generate random challenge
export function generateChallenge(): string {
  return randomBytes(32).toString('hex')
}

// Verify proof-of-work
export function verifyProof(
  challenge: string,
  nonce: number,
  hash: string,
  target: string
): boolean {
  // 1. Recompute hash
  const computed = sha256(challenge + nonce.toString())
  
  // 2. Check hash matches
  if (computed !== hash) {
    return false
  }
  
  // 3. Check hash meets target
  if (computed.localeCompare(target) > 0) {
    return false
  }
  
  return true
}

// Check if hash meets difficulty (count leading zeros)
export function countLeadingZeros(hash: string): number {
  let count = 0
  for (const char of hash) {
    if (char === '0') count++
    else break
  }
  return count
}

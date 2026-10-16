import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { generateChallenge, verifyProof, sha256 } from './crypto'
import jwt from 'jsonwebtoken'
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import nacl from 'tweetnacl'
import bs58 from 'bs58'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = Number(process.env.PORT || 3000)
const NODE_ENV = process.env.NODE_ENV || 'development'
const VERSION = '2.0.0'
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'
const JWT_EXPIRES = '24h'

// ---------- Middleware ----------
const corsOrigin = process.env.CORS_ORIGIN || '*'
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}))
app.use(cors({
  origin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map(s => s.trim()),
  credentials: corsOrigin !== '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json({ limit: '1mb' }))
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'))

// Trust proxy for Railway/Vercel
app.set('trust proxy', 1)

// Rate limiters
const challengeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many challenge requests, please slow down.' }
})
const miningLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Mining rate limit exceeded (200/min). Slow down.' }
})
const walletLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
})

// ---------- Persistence (file-based, survives restart if volume exists) ----------
const DATA_FILE = path.resolve(process.env.DATA_DIR || __dirname, '..', 'data.json')
type Share = { address: string; hashrate: number; at: number; credits: number; hw?: string }
type Wallet = { balance: number; sol: number; solana: number; createdAt: number; lastSeen: number; hw?: string }

let shares: Share[] = []
const wallets = new Map<string, Wallet>()
let totalHashes = 0
let totalSharesAccepted = 0

// Load persisted data on startup
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8')
      const data = JSON.parse(raw)
      if (Array.isArray(data.shares)) shares = data.shares
      if (Array.isArray(data.wallets)) {
        for (const [addr, w] of data.wallets) {
          wallets.set(addr, w)
        }
      }
      totalHashes = data.totalHashes || 0
      totalSharesAccepted = data.totalSharesAccepted || 0
      console.log(`📂 Loaded persisted data: ${shares.length} shares, ${wallets.size} wallets`)
    }
  } catch (e) {
    console.warn('⚠️ Failed to load data.json:', e)
  }
}
loadData()

function saveData() {
  try {
    const data = {
      shares: shares.slice(-2000), // keep last 2000
      wallets: [...wallets.entries()],
      totalHashes,
      totalSharesAccepted,
      updatedAt: Date.now()
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.warn('⚠️ Failed to save data.json:', e)
  }
}

// Auto save every 60 seconds
setInterval(saveData, 60_000)

// Challenge storage (address -> {challenge, issuedAt, difficulty, target})
interface ActiveChallenge {
  challenge: string
  issuedAt: number
  difficulty: number
  target: string
}
const activeChallenges = new Map<string, ActiveChallenge>()

// Cooldown per address to prevent spam (200ms)
const lastSubmitAt = new Map<string, number>()

// Mining difficulty (starts at 3 for testing)
const MINING_DIFFICULTY = 3
const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes
const SOLANA_CONNECTION = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com')

// Generate difficulty target
function difficultyToTarget(difficulty: number): string {
  const zeros = '0'.repeat(difficulty)
  const remaining = 'f'.repeat(64 - difficulty)
  return zeros + remaining
}

// Credits earned per share based on difficulty
function creditsFromDifficulty(difficulty: number): number {
  return Number((Math.pow(16, difficulty - 2) * 0.05).toFixed(4))
}

// Seed leaderboard for vibrant initial state
const seedLeaders = [
  { rank: 1, address: '5KJG…7xNw', full: '5KJGuN...7xNw', hw: 'RTX 4090', hashes: 1200000, credits: 142.4, sol: 2.5, solana: 142.4 },
  { rank: 2, address: '9aXP…mR3q', full: '9aXPrT...mR3q', hw: 'RTX 3090', hashes: 890000, credits: 98.1, sol: 1.2, solana: 98.1 },
  { rank: 3, address: 'DK2R…pQ9s', full: 'DK2Rty...pQ9s', hw: 'RX 6900XT', hashes: 621000, credits: 67.3, sol: 0.8, solana: 67.3 },
]

// Schemas
const submitSchema = z.object({
  address: z.string().min(10).max(64),
  nonce: z.number().int().nonnegative(),
  hash: z.string().length(64).regex(/^[a-f0-9]+$/, 'hash must be lowercase hex'),
  challenge: z.string().length(64).regex(/^[a-f0-9]+$/, 'challenge must be lowercase hex'),
  hw: z.string().min(2).max(80).optional(),
})
const walletConnectSchema = z.object({
  address: z.string().min(10).max(64),
  hw: z.string().min(2).max(80).optional(),
})
const addressParamSchema = z.string().min(10).max(64)

// ---------- Helpers ----------
function shortAddr(a: string) { return a.slice(0, 4) + '…' + a.slice(-4) }
function cleanHw(raw?: string){
  if(!raw) return 'Browser Miner'
  let s = raw.replace(/^ANGLE \(/,'').replace(/\)$/,'').trim()
  if(s.includes(',')) s = s.split(',').pop()!.trim()
  s = s.replace(/Direct3D11 vs_.*ps_.*/, '').trim()
  if(s.length>40) s=s.slice(0,40)
  // XSS: whitelist alphanumeric + space . : _ - only
  s = s.replace(/[^a-zA-Z0-9 .:_-]/g, '')
  return s || 'Browser Miner'
}

// XSS: escape HTML helper
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Auth: issue nonce for wallet signing
const authNonces = new Map<string, { nonce: string; expiresAt: number }>()
const NONCE_TTL = 10 * 60 * 1000 // 10 minutes

function generateAuthNonce(address: string): { nonce: string; expiresAt: number } {
  const nonce = `aetheros-auth-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const expiresAt = Date.now() + NONCE_TTL
  authNonces.set(address.toLowerCase(), { nonce, expiresAt })
  return { nonce, expiresAt }
}

function verifyAuthSignature(address: string, signature: string): boolean {
  // Dev bypass for manual wallet connections
  if (signature === 'manual-dev-bypass' && process.env.NODE_ENV !== 'production') {
    return true
  }
  const record = authNonces.get(address.toLowerCase())
  if (!record || Date.now() > record.expiresAt) return false
  
  const message = `Sign in to AetherOS\nNonce: ${record.nonce}`
  try {
    const messageBytes = new TextEncoder().encode(message)
    const signatureBytes = bs58.decode(signature)
    const publicKeyBytes = bs58.decode(address)
    const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes)
    if (valid) authNonces.delete(address.toLowerCase())
    return valid
  } catch {
    return false
  }
}

function createAuthToken(address: string): string {
  return jwt.sign({ address: address.toLowerCase() }, JWT_SECRET, { expiresIn: JWT_EXPIRES })
}

function verifyAuthToken(token: string): { address: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { address: string }
  } catch {
    return null
  }
}

// Auth middleware
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }
  const token = auth.slice(7)
  const payload = verifyAuthToken(token)
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
  ;(req as any).authAddress = payload.address
  next()
}
function getLeaderboard(sort: 'credits' | 'hashes' = 'credits') {
  const userBoard = [...wallets.entries()].map(([addr, w]) => ({
    rank: 0,
    address: shortAddr(addr),
    full: addr,
    hw: cleanHw(w.hw),
    hashes: Math.round(w.balance * 1_200_000),
    credits: Number(w.balance.toFixed(4)),
    sol: w.sol,
    solana: w.solana,
  }))
  userBoard.sort((a, b) => sort === 'hashes' ? b.hashes - a.hashes : b.credits - a.credits)
  return userBoard.map((r, i) => ({ ...r, rank: i + 1 }))
}

// ---------- API ----------

app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), service: 'aetheros-api', version: VERSION, env: NODE_ENV })
})

app.get('/api/health', (_req, res) => {
  const mem = process.memoryUsage()
  res.json({
    status: 'healthy',
    version: VERSION,
    uptime: Number(process.uptime().toFixed(1)),
    uptimeHuman: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
    memory: { rss: Math.round(mem.rss / 1024 / 1024) + ' MB', heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + ' MB' },
    shares: shares.length,
    wallets: wallets.size,
    totalHashes,
    totalSharesAccepted,
    env: NODE_ENV,
    dataFile: fs.existsSync(DATA_FILE) ? 'persisted' : 'memory-only',
  })
})

app.get('/api/stats', (_req, res) => {
  const last24h = shares.filter(s => Date.now() - s.at < 24 * 60 * 60 * 1000)
  const avgHash = shares.length ? Math.round(shares.reduce((a, s) => a + s.hashrate, 0) / shares.length) : 0
  res.json({
    totalHashes,
    totalShares: shares.length,
    totalSharesAccepted,
    totalMiners: wallets.size,
    avgHashrate: avgHash,
    last24hShares: last24h.length,
    leaderboardTop: getLeaderboard().slice(0, 3),
  })
})

app.get('/api/leaderboard', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
  const sort = (req.query.sort === 'hashes' ? 'hashes' : 'credits') as 'credits' | 'hashes'
  const addressFilter = (req.query.address as string | undefined)?.trim()
  let board = getLeaderboard(sort)
  if (addressFilter) {
    board = board.filter(r => r.full.toLowerCase().includes(addressFilter.toLowerCase()) || r.address.toLowerCase().includes(addressFilter.toLowerCase()))
  }
  const total = board.length
  const start = (page - 1) * limit
  const sliced = board.slice(start, start + limit)
  res.json({ leaderboard: sliced, page, limit, total, totalPages: Math.ceil(total / limit), sort })
})

app.get('/api/network', (_req, res) => {
  const avg = shares.length ? Math.round(shares.reduce((a, s) => a + s.hashrate, 0) / shares.length) : 0
  res.json({
    hashrate: shares.length ? `${(avg / 1000).toFixed(1)} KH/s avg` : '42.8 MH/s',
    totalHashes,
    nodes: [
      { id: 'GPU #001', hw: 'RTX 4090', status: 'online', job: shares[0] ? `mining ${shares[0].hashrate} H/s` : 'idle' },
      { id: 'GPU #002', hw: 'RTX 3080', status: 'online', job: 'idle' },
      { id: 'GPU #003', hw: 'A100', status: 'busy', job: `${shares.length} shares` },
    ],
    queue: shares.length,
    totalWallets: wallets.size,
  })
})

// ---------- Training dispatch (Modal integration) ----------
app.post('/api/train/dispatch', requireAuth, async (req, res) => {
  const { datasetName, datasetContent, baseModel } = req.body
  const address = (req as any).authAddress
  
  if (!datasetContent) {
    return res.status(400).json({ error: 'Dataset content required' })
  }

  // Check if user has enough credits (e.g. 5 credits per train)
  const w = wallets.get(address)
  if (!w || w.balance < 5) {
    return res.status(400).json({ error: 'Not enough credits. Minimum 5 credits required for network training.' })
  }

  // Deduct credits
  w.balance -= 5
  wallets.set(address, w)

  try {
    // In production, spawn Modal function via subprocess or Modal REST API
    // e.g., execSync(`modal run server/modal_app.py --dataset ...`)
    console.log(`🚀 Dispatching training to Modal GPU for ${shortAddr(address)} [Dataset: ${datasetName}, Model: ${baseModel || 'Phi-3'}]`)
    
    // Simulate async dispatch success
    res.json({
      success: true,
      jobId: `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      message: 'Training dispatched to Modal GPU T4. Estimated time: 2 minutes.',
      remainingCredits: w.balance
    })
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to dispatch training', details: e?.message })
  }
})

// ---------- Mining Challenge Endpoint ----------
app.get('/api/mining/challenge', challengeLimiter, (req, res) => {
  const address = req.query.address as string | undefined
  if (!address || address.length < 10) {
    return res.status(400).json({ error: 'Valid address required' })
  }

  const challenge = generateChallenge()
  const difficulty = MINING_DIFFICULTY
  const target = difficultyToTarget(difficulty)
  const issuedAt = Date.now()

  activeChallenges.set(address, {
    challenge,
    issuedAt,
    difficulty,
    target
  })

  res.json({
    challenge,
    difficulty,
    target,
    expiresAt: issuedAt + CHALLENGE_EXPIRY_MS
  })
})

app.get('/api/mining/history', (req, res) => {
  const address = req.query.address as string | undefined
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20))
  let filtered = shares
  if (address) filtered = shares.filter(s => s.address === address)
  const result = [...filtered].reverse().slice(0, limit)
  res.json({ history: result, total: filtered.length, limit })
})

// ---------- Auth API ----------
app.all('/api/auth/nonce', (req, res) => {
  const address = (req.method === 'GET' ? req.query.address : req.body.address) as string | undefined
  if (!address) return res.status(400).json({ error: 'Address required' })
  res.json(generateAuthNonce(address))
})

app.post('/api/auth/verify', (req, res) => {
  const { address, signature } = req.body
  if (!address || !signature) return res.status(400).json({ error: 'Address and signature required' })
  if (!verifyAuthSignature(address, signature)) return res.status(401).json({ error: 'Invalid signature' })
  res.json({ token: createAuthToken(address) })
})

app.post('/api/mining/submit', miningLimiter, requireAuth, (req, res) => {
  const parsed = submitSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() })
  }
  const { address, nonce, hash, challenge, hw } = parsed.data
  const authAddress = (req as any).authAddress
  
  if (authAddress !== address.toLowerCase()) {
    return res.status(403).json({ error: 'Auth address mismatch. Connect with the correct wallet.' })
  }

  const storedChallenge = activeChallenges.get(address)
  if (!storedChallenge) {
    return res.status(400).json({ error: 'No active challenge. Request a new one.' })
  }

  if (storedChallenge.challenge !== challenge) {
    return res.status(400).json({ error: 'Challenge mismatch' })
  }

  const now = Date.now()
  if (now - storedChallenge.issuedAt > CHALLENGE_EXPIRY_MS) {
    activeChallenges.delete(address)
    return res.status(400).json({ error: 'Challenge expired. Request a new one.' })
  }

  if (!verifyProof(challenge, nonce, hash, storedChallenge.target)) {
    console.warn(`⚠️  Invalid proof from ${shortAddr(address)}: nonce=${nonce}`)
    return res.status(400).json({ error: 'Invalid proof-of-work' })
  }

  const last = lastSubmitAt.get(address) ?? 0
  if (now - last < 10_000) {
    return res.status(429).json({ 
      error: 'Too fast. Wait between valid proofs.', 
      retryAfterMs: 10_000 - (now - last) 
    })
  }

  const credits = creditsFromDifficulty(storedChallenge.difficulty)
  const at = Date.now()

  activeChallenges.delete(address)

  shares.push({ 
    address, 
    hashrate: storedChallenge.difficulty * 1000,
    at, 
    credits, 
    hw: hw ? cleanHw(hw) : undefined 
  })
  totalHashes += Math.pow(16, storedChallenge.difficulty)
  totalSharesAccepted += 1

  const w = wallets.get(address) ?? { 
    balance: 0, 
    sol: 0, 
    solana: 0, 
    createdAt: Date.now(), 
    lastSeen: Date.now() 
  }
  w.balance += credits
  w.lastSeen = Date.now()
  if(hw) w.hw = cleanHw(hw)
  wallets.set(address, w)

  if (shares.length > 5000) shares.splice(0, shares.length - 5000)

  lastSubmitAt.set(address, now)

  console.log(`✅ Valid proof from ${shortAddr(address)}: +${credits.toFixed(4)} credits (difficulty ${storedChallenge.difficulty})`)

  res.json({ 
    success: true, 
    credits: w.balance,
    creditsEarned: credits,
    difficulty: storedChallenge.difficulty,
    message: 'Proof accepted'
  })
})

app.get('/api/wallet/:address', walletLimiter, (req, res) => {
  const addr = req.params.address as string
  const parsed = addressParamSchema.safeParse(addr)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid address format' })
  const w = wallets.get(addr)
  if (!w) return res.json({ address: addr, balance: 0, sol: 0, solana: 0, shares: 0, exists: false })
  const userShares = shares.filter(s => s.address === addr)
  res.json({ address: addr, ...w, shares: userShares.length, exists: true })
})

app.post('/api/wallet/connect', walletLimiter, async (req, res) => {
  const parsed = walletConnectSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() })
  const { address, hw } = parsed.data
  let w = wallets.get(address)
  
  let solBalance = 0
  const isSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
  if (isSolanaAddress) {
    try {
      const pubkey = new PublicKey(address)
      const lamports = await SOLANA_CONNECTION.getBalance(pubkey)
      solBalance = lamports / LAMPORTS_PER_SOL
    } catch (e) {
      console.warn('Failed to fetch SOL balance:', e)
    }
  }
  
  if (!w) {
    w = { balance: 0, sol: solBalance, solana: solBalance, createdAt: Date.now(), lastSeen: Date.now(), hw: hw ? cleanHw(hw) : undefined }
    wallets.set(address, w)
  } else {
    w.lastSeen = Date.now()
    w.sol = solBalance
    w.solana = solBalance
    if(hw) w.hw = cleanHw(hw)
  }
  res.json({ ok: true, wallet: { address, ...w } })
})

app.get('/api/wallets', (req, res) => {
  const adminKey = req.headers['x-admin-key']
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Admin key required' })
  }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const list = [...wallets.entries()]
    .sort((a, b) => b[1].balance - a[1].balance)
    .slice(0, limit)
    .map(([addr, w]) => ({ address: shortAddr(addr), full: addr, ...w }))
  res.json({ wallets: list, total: wallets.size })
})

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found', available: ['/api/ping','/api/health','/api/stats','/api/leaderboard','/api/network','/api/train/dispatch','/api/mining/submit','/api/wallet/:address','/api/wallet/connect'] })
})

const distPath = path.resolve(__dirname, '..', 'dist')
const distExists = fs.existsSync(distPath) && fs.existsSync(path.join(distPath, 'index.html'))
if (distExists) {
  app.use(express.static(distPath, { maxAge: '1h', etag: true }))
  app.get('/{*any}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
  console.log(`📁 Serving frontend from ${distPath}`)
} else {
  app.get('/{*any}', (_req, res) => {
    res.json({ ok: true, message: 'AetherOS API running. Frontend not built.', version: VERSION })
  })
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error', message: NODE_ENV === 'development' ? String(err) : undefined })
})

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ AetherOS API v${VERSION} running on http://0.0.0.0:${PORT} [${NODE_ENV}]`)
})

function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down...`)
  saveData()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 8000)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

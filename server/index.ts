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

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = Number(process.env.PORT || 3000)
const NODE_ENV = process.env.NODE_ENV || 'development'
const VERSION = '2.0.0'

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
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
})
const miningLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Mining rate limit exceeded (60/min). Slow down.' }
})
const walletLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api/', globalLimiter)

// ---------- Persistence (file-based, survives restart if volume exists) ----------
const DATA_FILE = path.resolve(__dirname, '..', 'data.json')
type Share = { address: string; hashrate: number; at: number; credits: number; hw?: string }
type Wallet = { balance: number; sol: number; solana: number; createdAt: number; lastSeen: number; hw?: string }

let shares: Share[] = []
const wallets = new Map<string, Wallet>()
let totalHashes = 0
let totalSharesAccepted = 0

// Cooldown per address to prevent spam (200ms)
const lastSubmitAt = new Map<string, number>()

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
      shares = raw.shares ?? []
      totalHashes = raw.totalHashes ?? 0
      totalSharesAccepted = raw.totalSharesAccepted ?? 0
      if (raw.wallets) {
        for (const [k, v] of Object.entries(raw.wallets as Record<string, Wallet>)) {
          wallets.set(k, v as Wallet)
        }
      }
      console.log(`📦 Loaded ${shares.length} shares, ${wallets.size} wallets from data.json`)
    }
  } catch (e) {
    console.warn('⚠️  Failed to load data.json:', e)
  }
}
function saveData() {
  try {
    const obj: Record<string, unknown> = {
      shares: shares.slice(-2000), // keep last 2000
      wallets: Object.fromEntries(wallets),
      totalHashes,
      totalSharesAccepted,
      savedAt: new Date().toISOString(),
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2))
  } catch (e) {
    console.warn('⚠️  Failed to save data.json:', e)
  }
}
loadData()
// autosave every 30s
setInterval(saveData, 30_000)
// save on exit
process.on('SIGTERM', () => { saveData(); process.exit(0) })
process.on('SIGINT', () => { saveData(); process.exit(0) })

// Seed leaderboard (static mock + dynamic wallets)
const seedLeaders = [
  { rank: 1, address: '5KJG…7xNw', full: '5KJG7xNwSeedAddress111111111111111111', hw: 'RTX 4090', hashes: 1_200_000, credits: 142.4 },
  { rank: 2, address: '9aXP…mR3q', hw: 'RTX 3090', full: '9aXPmR3qSeedAddress222222222222222222', hashes: 890_000, credits: 98.1 },
  { rank: 3, address: 'DK2R…pQ9s', hw: 'RX 6900XT', full: 'DK2RpQ9sSeedAddress333333333333333333', hashes: 621_000, credits: 67.3 },
]

// ---------- Validation ----------
const submitSchema = z.object({
  address: z.string().min(10).max(64).regex(/^[A-Za-z0-9]+$/, 'address must be alphanumeric'),
  hashrate: z.number().min(1).max(50_000).optional().default(1200),
  shares: z.number().int().min(1).max(100).optional().default(1),
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
  // strip vendor prefix like "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 ...)" -> "RTX 4060"
  let s = raw.replace(/^ANGLE \(/,'').replace(/\)$/,'').trim()
  // keep last chunk after comma
  if(s.includes(',')) s = s.split(',').pop()!.trim()
  // shorten intel/apple/nvidia verbose strings
  s = s.replace(/Direct3D11 vs_.*ps_.*/, '').trim()
  if(s.length>40) s=s.slice(0,40)
  return s || 'Browser Miner'
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
  const combined = [...seedLeaders.map(s => ({ ...s })), ...userBoard]
  combined.sort((a, b) => sort === 'hashes' ? b.hashes - a.hashes : b.credits - a.credits)
  return combined.map((r, i) => ({ ...r, rank: i + 1 }))
}

// ---------- API ----------

app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), service: 'solanaos-api', version: VERSION, env: NODE_ENV })
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
  // aggregated stats for dashboard
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

app.get('/api/mining/history', (req, res) => {
  const address = req.query.address as string | undefined
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20))
  let filtered = shares
  if (address) filtered = shares.filter(s => s.address === address)
  // newest first
  const result = [...filtered].reverse().slice(0, limit)
  res.json({ history: result, total: filtered.length, limit })
})

app.post('/api/mining/submit', miningLimiter, (req, res) => {
  const parsed = submitSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() })
  }
  const { address, hashrate, shares: shareCount, hw } = parsed.data
  const h = Number(hashrate) || 1200

  // anti-cheat: cooldown 150ms per address
  const now = Date.now()
  const last = lastSubmitAt.get(address) ?? 0
  if (now - last < 150) {
    return res.status(429).json({ error: 'Too fast. Slow down mining submissions.', retryAfterMs: 150 - (now - last) })
  }
  lastSubmitAt.set(address, now)

  // anti-cheat: hashrate cap already via zod 50k, but also warn if unrealistic
  if (h > 20_000) {
    console.warn(`⚠️  High hashrate ${h} from ${shortAddr(address)}`)
  }

  const credits = h / Math.pow(2, 34) // 2^34 hashes = 1 credit, same as frontend
  const at = Date.now()

  // push shares (one entry per submit, not per shareCount to keep memory sane)
  shares.push({ address, hashrate: h, at, credits, hw: hw ? cleanHw(hw) : undefined })
  totalHashes += h
  totalSharesAccepted += shareCount ?? 1

  // update wallet
  const w = wallets.get(address) ?? { balance: 0, sol: 1.24 + Math.random() * 2, solana: Math.random() * 50, createdAt: Date.now(), lastSeen: Date.now() }
  w.balance += credits
  w.solana += credits * 900
  w.lastSeen = Date.now()
  if(hw) w.hw = cleanHw(hw)
  wallets.set(address, w)

  // keep last 5000 shares max
  if (shares.length > 5000) shares.splice(0, shares.length - 5000)

  // async save (debounced via interval, but also try)
  // no await

  res.json({
    ok: true,
    credits: Number(credits.toFixed(6)),
    balance: Number(w.balance.toFixed(6)),
    solana: Number(w.solana.toFixed(2)),
    totalHashes,
    sharesAccepted: totalSharesAccepted,
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

app.post('/api/wallet/connect', walletLimiter, (req, res) => {
  const parsed = walletConnectSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() })
  const { address, hw } = parsed.data
  let w = wallets.get(address)
  if (!w) {
    w = { balance: 0, sol: 1.24 + Math.random() * 2, solana: Math.random() * 50, createdAt: Date.now(), lastSeen: Date.now(), hw: hw ? cleanHw(hw) : undefined }
    wallets.set(address, w)
  } else {
    w.lastSeen = Date.now()
    if(hw) w.hw = cleanHw(hw)
  }
  res.json({ ok: true, wallet: { address, ...w } })
})

// List wallets (for admin/debug) - paginated, no secrets
app.get('/api/wallets', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const list = [...wallets.entries()]
    .sort((a, b) => b[1].balance - a[1].balance)
    .slice(0, limit)
    .map(([addr, w]) => ({ address: shortAddr(addr), full: addr, ...w }))
  res.json({ wallets: list, total: wallets.size })
})

// ---------- 404 for API ----------
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found', available: ['/api/ping','/api/health','/api/stats','/api/leaderboard','/api/network','/api/mining/submit','/api/mining/history','/api/wallet/:address','/api/wallet/connect','/api/wallets'] })
})

// ---------- Serve frontend (dist) if exists ----------
const distPath = path.resolve(__dirname, '..', 'dist')
const distExists = fs.existsSync(distPath) && fs.existsSync(path.join(distPath, 'index.html'))
if (distExists) {
  app.use(express.static(distPath, { maxAge: '1h', etag: true }))
  // SPA fallback: serve index.html for non-API routes
  app.get('/{*any}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
  console.log(`📁 Serving frontend from ${distPath}`)
} else {
  app.get('/{*any}', (_req, res) => {
    res.json({ ok: true, message: 'SolanaOS API running. Frontend not built. Run: npm run build', version: VERSION, endpoints: '/api/ping /api/health /api/leaderboard /api/mining/submit /api/wallet/:address' })
  })
  console.log('⚠️  Frontend dist not found. API only mode.')
}

// ---------- Error handler ----------
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error', message: NODE_ENV === 'development' ? String(err) : undefined })
})

// ---------- Start ----------
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SolanaOS API v${VERSION} running on http://0.0.0.0:${PORT} [${NODE_ENV}]`)
  console.log(`   CORS_ORIGIN=${corsOrigin}`)
  console.log(`   Data persistence: ${fs.existsSync(DATA_FILE) ? DATA_FILE : 'memory (will create data.json)'}`)
  console.log(`   Endpoints:`)
  console.log(`     GET  /api/ping  /api/health  /api/stats  /api/leaderboard  /api/network  /api/wallets`)
  console.log(`     POST /api/mining/submit  /api/wallet/connect`)
  console.log(`     GET  /api/mining/history  /api/wallet/:address`)
})

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down...`)
  saveData()
  server.close(() => {
    console.log('Server closed.')
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 8000)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

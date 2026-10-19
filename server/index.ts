import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { randomBytes } from 'crypto'
import { fileURLToPath } from 'url'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { generateChallenge, verifyProof } from './crypto'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = Number(process.env.PORT || 3000)
const NODE_ENV = process.env.NODE_ENV || 'development'

// Without JWT_SECRET the server signs with a random per-boot secret: nothing guessable
// ships in the code, and the only cost is that sign-ins reset on every restart.
const JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex')
if (!process.env.JWT_SECRET) {
  console.warn('JWT_SECRET is not set. Using a random secret, so sign-ins reset on every restart.')
}
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
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json({ limit: '64kb' }))
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'))

// Trust proxy for Railway/Vercel
app.set('trust proxy', 1)

// Rate limiters. Behind Vercel and Railway every visitor can arrive from the same IP, so a
// limit keyed by IP would be shared by all users. Key by wallet address when the request has
// one (signed-in session, query, path or body) and fall back to the IP otherwise.
const limitKey = (req: express.Request): string => {
  const candidate = (req as any).authAddress ?? req.params?.address ?? req.query?.address ?? req.body?.address
  return typeof candidate === 'string' && isSolanaAddress(candidate) ? candidate : ipKeyGenerator(req.ip ?? '')
}
const limiter = (max: number, message?: string) => rateLimit({
  windowMs: 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: limitKey,
  ...(message ? { message: { error: message } } : {}),
})
const authLimiter = limiter(20, 'Too many sign-in attempts. Try again in a minute.')
const challengeLimiter = limiter(500, 'Too many challenge requests, please slow down.')
const miningLimiter = limiter(200, 'Mining rate limit exceeded. Slow down.')
const walletLimiter = limiter(60)

// ---------- Mining rules ----------
// Each value can be tuned with an environment variable. Out-of-range values fall back to the default.
const envNumber = (name: string, fallback: number, min: number, max: number) => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && process.env[name] !== '' && n >= min && n <= max ? n : fallback
}
// Difficulty is the number of leading zero hex digits a hash needs: about 16^5 = 1,048,576 hashes
// per share at 5, which takes a typical browser tab tens of seconds.
const MINING_DIFFICULTY = Math.round(envNumber('MINING_DIFFICULTY', 5, 1, 8))
const CREDITS_PER_SHARE = envNumber('CREDITS_PER_SHARE', 1, 0.0001, 1000)
const DAILY_CREDIT_CAP = envNumber('DAILY_CREDIT_CAP', 1000, 1, 1_000_000)
const SUBMIT_COOLDOWN_MS = Math.round(envNumber('SUBMIT_COOLDOWN_MS', 10_000, 0, 600_000))
const CHALLENGE_EXPIRY_MS = 30 * 60 * 1000
// Share count for wallets saved before accepted shares were tracked (they earned 0.8 per share).
const LEGACY_CREDITS_PER_SHARE = 0.8

const round4 = (n: number) => Math.round(n * 10_000) / 10_000
const dayKeyNow = () => new Date().toISOString().slice(0, 10)
const nextResetAt = () => {
  const d = new Date()
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

function difficultyToTarget(difficulty: number): string {
  return '0'.repeat(difficulty) + 'f'.repeat(64 - difficulty)
}

// ---------- Persistence (JSON file, survives restarts only if DATA_DIR is a volume) ----------
// With DATA_DIR set the file is DATA_DIR/data.json, so mount the volume at that folder.
const DATA_FILE = process.env.DATA_DIR
  ? path.join(path.resolve(process.env.DATA_DIR), 'data.json')
  : path.resolve(__dirname, '..', 'data.json')
type Share = { address: string; at: number; credits: number }
type Wallet = {
  balance: number
  accepted?: number
  createdAt: number
  lastSeen: number
  dayKey?: string      // UTC date of the last accepted share, e.g. 2026-10-17
  dayCredits?: number  // credits earned on that date
}

let shares: Share[] = []
const wallets = new Map<string, Wallet>()
let totalSharesAccepted = 0

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
    if (Array.isArray(data.shares)) shares = data.shares
    if (Array.isArray(data.wallets)) {
      for (const [addr, w] of data.wallets) wallets.set(addr, w)
    }
    totalSharesAccepted = data.totalSharesAccepted || 0
    console.log(`Loaded ${wallets.size} wallets and ${shares.length} shares from ${DATA_FILE}`)
  } catch (e) {
    console.warn('Failed to load data file:', e)
  }
}
loadData()
console.log(`Data file: ${DATA_FILE}`)

function saveData() {
  try {
    const data = {
      shares: shares.slice(-2000),
      wallets: [...wallets.entries()],
      totalSharesAccepted,
      updatedAt: Date.now(),
    }
    // Write to a temp file first so a crash mid-write cannot corrupt the data file.
    const tmp = `${DATA_FILE}.tmp`
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8')
    fs.renameSync(tmp, DATA_FILE)
  } catch (e) {
    console.warn('Failed to save data file:', e)
  }
}
// Save shortly after a change instead of on every request. A crash loses at most two seconds.
let saveTimer: NodeJS.Timeout | undefined
function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => { saveTimer = undefined; saveData() }, 2000)
}

// ---------- Short-lived state ----------
interface ActiveChallenge { challenge: string; issuedAt: number; difficulty: number; target: string }
const activeChallenges = new Map<string, ActiveChallenge>()
const lastSubmitAt = new Map<string, number>()
const authNonces = new Map<string, { message: string; expiresAt: number }>()
const NONCE_TTL = 10 * 60 * 1000

// Drop expired entries so anonymous traffic cannot grow these maps forever.
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of activeChallenges) if (now - v.issuedAt > CHALLENGE_EXPIRY_MS) activeChallenges.delete(k)
  for (const [k, v] of authNonces) if (now > v.expiresAt) authNonces.delete(k)
  for (const [k, at] of lastSubmitAt) if (now - at > SUBMIT_COOLDOWN_MS) lastSubmitAt.delete(k)
}, 60_000)

// ---------- Helpers ----------
function isSolanaAddress(a: string): boolean {
  try { return bs58.decode(a).length === 32 } catch { return false }
}
const addressSchema = z.string().refine(isSolanaAddress, 'Invalid Solana address')
const submitSchema = z.object({
  address: addressSchema,
  nonce: z.number().int().nonnegative(),
  hash: z.string().length(64).regex(/^[a-f0-9]+$/, 'hash must be lowercase hex'),
  challenge: z.string().length(64).regex(/^[a-f0-9]+$/, 'challenge must be lowercase hex'),
})
const connectSchema = z.object({ address: addressSchema })

function shortAddr(a: string) { return a.slice(0, 4) + '…' + a.slice(-4) }

const MAX_NONCES = 20_000

function issueNonce(address: string) {
  // Cap the map so a flood of throwaway addresses cannot grow it without bound.
  if (authNonces.size >= MAX_NONCES) {
    const oldest = authNonces.keys().next().value
    if (oldest !== undefined) authNonces.delete(oldest)
  }
  const nonce = randomBytes(16).toString('hex')
  const message = `Sign in to AetherOS\nNonce: ${nonce}`
  const expiresAt = Date.now() + NONCE_TTL
  authNonces.set(address, { message, expiresAt })
  return { nonce, message, expiresAt }
}

// The signature must be a detached ed25519 signature over the exact message we issued.
function verifySignature(address: string, signature: string): boolean {
  const record = authNonces.get(address)
  if (!record || Date.now() > record.expiresAt) return false
  try {
    const valid = nacl.sign.detached.verify(
      new TextEncoder().encode(record.message),
      bs58.decode(signature),
      bs58.decode(address),
    )
    if (valid) authNonces.delete(address)
    return valid
  } catch {
    return false
  }
}

function createAuthToken(address: string): string {
  return jwt.sign({ address }, JWT_SECRET, { expiresIn: JWT_EXPIRES, algorithm: 'HS256' })
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Sign in with your wallet to continue.' })
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET, { algorithms: ['HS256'] }) as { address: string }
    ;(req as any).authAddress = payload.address
    next()
  } catch {
    return res.status(401).json({ error: 'Your session expired. Connect your wallet again.' })
  }
}

function sharesOf(_addr: string, w: Wallet) {
  return w.accepted ?? Math.round(w.balance / LEGACY_CREDITS_PER_SHARE)
}

const earnedToday = (w?: Wallet) => (w && w.dayKey === dayKeyNow() ? w.dayCredits ?? 0 : 0)
const atDailyCap = (w?: Wallet) => round4(earnedToday(w) + CREDITS_PER_SHARE) > DAILY_CREDIT_CAP
const dailyLimitBody = () => ({
  error: 'Daily limit reached. Mining resumes at 00:00 UTC.',
  dailyLimit: true,
  resetAt: nextResetAt(),
})
const walletView = (address: string, w?: Wallet) => ({
  address,
  balance: w?.balance ?? 0,
  shares: w ? sharesOf(address, w) : 0,
  exists: !!w,
  creditsPerShare: CREDITS_PER_SHARE,
  dailyEarned: earnedToday(w),
  dailyCap: DAILY_CREDIT_CAP,
})

function getLeaderboard() {
  const rows = [...wallets.entries()].map(([addr, w]) => ({
    addr,
    address: shortAddr(addr),
    credits: Number(w.balance.toFixed(4)),
    shares: sharesOf(addr, w),
  }))
  rows.sort((a, b) => b.credits - a.credits)
  return rows.map((r, i) => ({ ...r, rank: i + 1 }))
}
const publicRow = ({ addr: _addr, ...row }: ReturnType<typeof getLeaderboard>[number]) => row

// ---------- API ----------
app.get('/api/ping', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/stats', (_req, res) => {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000
  res.json({
    totalMiners: wallets.size,
    totalShares: totalSharesAccepted,
    last24hShares: shares.filter(s => s.at > dayAgo).length,
  })
})

app.get('/api/leaderboard', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
  const addressFilter = typeof req.query.address === 'string' ? req.query.address.trim() : ''
  let board = getLeaderboard()
  if (addressFilter) board = board.filter(r => r.addr === addressFilter)
  const total = board.length
  const start = (page - 1) * limit
  res.json({
    leaderboard: board.slice(start, start + limit).map(publicRow),
    page, limit, total, totalPages: Math.ceil(total / limit),
  })
})

// ---------- Auth ----------
app.get('/api/auth/nonce', authLimiter, (req, res) => {
  const address = typeof req.query.address === 'string' ? req.query.address : ''
  if (!isSolanaAddress(address)) return res.status(400).json({ error: 'A valid Solana address is required.' })
  res.json(issueNonce(address))
})

app.post('/api/auth/verify', authLimiter, (req, res) => {
  const { address, signature } = req.body ?? {}
  if (typeof address !== 'string' || typeof signature !== 'string' || !isSolanaAddress(address)) {
    return res.status(400).json({ error: 'Address and signature are required.' })
  }
  if (!verifySignature(address, signature)) return res.status(401).json({ error: 'Invalid signature.' })
  res.json({ token: createAuthToken(address) })
})

// ---------- Wallet ----------
app.get('/api/wallet/:address', walletLimiter, (req, res) => {
  const addr = req.params.address as string
  if (!isSolanaAddress(addr)) return res.status(400).json({ error: 'Invalid address format' })
  res.json(walletView(addr, wallets.get(addr)))
})

app.post('/api/wallet/connect', requireAuth, walletLimiter, (req, res) => {
  const parsed = connectSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed' })
  const { address } = parsed.data
  if ((req as any).authAddress !== address) {
    return res.status(403).json({ error: 'Signed in with a different wallet.' })
  }
  let w = wallets.get(address)
  if (!w) {
    w = { balance: 0, accepted: 0, createdAt: Date.now(), lastSeen: Date.now() }
    wallets.set(address, w)
    scheduleSave()
  } else {
    w.lastSeen = Date.now()
  }
  res.json({ ok: true, wallet: walletView(address, w) })
})

// ---------- Mining ----------
app.get('/api/mining/challenge', requireAuth, challengeLimiter, (req, res) => {
  const address = typeof req.query.address === 'string' ? req.query.address : ''
  if (!isSolanaAddress(address)) return res.status(400).json({ error: 'A valid Solana address is required.' })
  if ((req as any).authAddress !== address) {
    return res.status(403).json({ error: 'Signed in with a different wallet.' })
  }

  // Do not hand out work that could never be paid.
  const w = wallets.get(address)
  if (atDailyCap(w)) return res.status(429).json(dailyLimitBody())

  const challenge = generateChallenge()
  const issuedAt = Date.now()
  const target = difficultyToTarget(MINING_DIFFICULTY)
  activeChallenges.set(address, { challenge, issuedAt, difficulty: MINING_DIFFICULTY, target })

  res.json({
    challenge,
    difficulty: MINING_DIFFICULTY,
    target,
    expiresAt: issuedAt + CHALLENGE_EXPIRY_MS,
    creditsPerShare: CREDITS_PER_SHARE,
    cooldownMs: SUBMIT_COOLDOWN_MS,
    dailyEarned: earnedToday(w),
    dailyCap: DAILY_CREDIT_CAP,
  })
})

app.post('/api/mining/submit', requireAuth, miningLimiter, (req, res) => {
  const parsed = submitSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed' })
  const { address, nonce, hash, challenge } = parsed.data

  if ((req as any).authAddress !== address) {
    return res.status(403).json({ error: 'Signed in with a different wallet.' })
  }
  if (atDailyCap(wallets.get(address))) return res.status(429).json(dailyLimitBody())

  const stored = activeChallenges.get(address)
  if (!stored) return res.status(400).json({ error: 'No active challenge. Request a new one.' })
  if (stored.challenge !== challenge) return res.status(400).json({ error: 'Challenge mismatch' })

  const now = Date.now()
  if (now - stored.issuedAt > CHALLENGE_EXPIRY_MS) {
    activeChallenges.delete(address)
    return res.status(400).json({ error: 'Challenge expired. Request a new one.' })
  }

  if (!verifyProof(challenge, nonce, hash, stored.target)) {
    return res.status(400).json({ error: 'Invalid proof-of-work' })
  }

  const last = lastSubmitAt.get(address) ?? 0
  if (now - last < SUBMIT_COOLDOWN_MS) {
    return res.status(429).json({
      error: 'Too fast. Wait between valid proofs.',
      retryAfterMs: SUBMIT_COOLDOWN_MS - (now - last),
    })
  }

  const credits = CREDITS_PER_SHARE
  activeChallenges.delete(address)

  shares.push({ address, at: now, credits })
  if (shares.length > 5000) shares.splice(0, shares.length - 5000)
  totalSharesAccepted += 1

  const w = wallets.get(address) ?? { balance: 0, accepted: 0, createdAt: now, lastSeen: now }
  const today = dayKeyNow()
  w.accepted = sharesOf(address, w) + 1
  w.balance = round4(w.balance + credits)
  w.dayCredits = round4(earnedToday(w) + credits)
  w.dayKey = today
  w.lastSeen = now
  wallets.set(address, w)
  lastSubmitAt.set(address, now)
  scheduleSave()

  res.json({
    success: true,
    credits: w.balance,
    creditsEarned: credits,
    difficulty: stored.difficulty,
    dailyEarned: w.dayCredits,
    dailyCap: DAILY_CREDIT_CAP,
  })
})

app.get('/api/wallets', (req, res) => {
  const adminKey = req.headers['x-admin-key']
  if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Admin key required' })
  }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const list = [...wallets.entries()]
    .sort((a, b) => b[1].balance - a[1].balance)
    .slice(0, limit)
    .map(([addr, w]) => ({ address: addr, ...w }))
  res.json({ wallets: list, total: wallets.size })
})

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// ---------- Static frontend (only when a build exists next to the server) ----------
const distPath = path.resolve(__dirname, '..', 'dist')
if (fs.existsSync(path.join(distPath, 'index.html'))) {
  app.use(express.static(distPath, { maxAge: '1h', etag: true }))
  app.get('/{*any}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
} else {
  app.get('/{*any}', (_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Bad input from a client (broken JSON, a body over the size limit) is a 4xx, not a server fault.
  const status = Number(err?.status ?? err?.statusCode)
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: status === 413 ? 'Request too large' : 'Invalid request' })
  }
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`AetherOS API running on http://0.0.0.0:${PORT} [${NODE_ENV}]`)
})

function shutdown(signal: string) {
  console.log(`${signal} received. Shutting down...`)
  saveData()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 8000)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

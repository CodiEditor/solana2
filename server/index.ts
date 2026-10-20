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
import { envNumber } from './env'

dotenv.config()

// Loaded after dotenv so a local .env can supply ANTHROPIC_API_KEY.
const ai = await import('./assistant')

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
// Small bodies everywhere except the assistant, which receives a dataset or a chat history.
const bodyLimits: Record<string, express.RequestHandler> = {
  '/api/assistant/profile': express.json({ limit: '1mb' }),
  '/api/assistant/chat': express.json({ limit: '256kb' }),
}
const smallBody = express.json({ limit: '64kb' })
app.use((req, res, next) => (bodyLimits[req.path] ?? smallBody)(req, res, next))
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
  ...(message ? { message: { error: message, code: 'rate_limited' } } : {}),
})
const authLimiter = limiter(20, 'Too many sign-in attempts. Try again in a minute.')
const challengeLimiter = limiter(500, 'Too many challenge requests, please slow down.')
const miningLimiter = limiter(200, 'Mining rate limit exceeded. Slow down.')
const walletLimiter = limiter(60)
const assistantLimiter = limiter(
  Math.round(envNumber('AI_REQUESTS_PER_MINUTE', 30, 1, 10_000)),
  'Too many assistant requests. Try again in a minute.',
)

// ---------- Mining rules ----------
// Each value can be tuned with an environment variable. Out-of-range values fall back to the default.
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
  aiDayKey?: string    // UTC date of the last assistant use
  aiMessages?: number  // chat messages on that date
  aiProfiles?: number  // profiles built on that date
  aiSpent?: number     // credits spent on the assistant, all time
}
// The profile Claude wrote from a dataset. The dataset itself is never stored.
type AssistantProfile = { name: string; sourceName: string; datasetChars: number; text: string; builtAt: number }
type AiMonth = { month: string; spentUsd: number; calls: number }

let shares: Share[] = []
const wallets = new Map<string, Wallet>()
let totalSharesAccepted = 0
const profiles = new Map<string, AssistantProfile>()
const monthKeyNow = () => new Date().toISOString().slice(0, 7)
let aiMonth: AiMonth = { month: monthKeyNow(), spentUsd: 0, calls: 0 }

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
    if (Array.isArray(data.shares)) shares = data.shares
    if (Array.isArray(data.wallets)) {
      for (const [addr, w] of data.wallets) wallets.set(addr, w)
    }
    totalSharesAccepted = data.totalSharesAccepted || 0
    if (Array.isArray(data.profiles)) {
      for (const [addr, p] of data.profiles) profiles.set(addr, p)
    }
    if (data.aiMonth && typeof data.aiMonth.spentUsd === 'number') aiMonth = data.aiMonth
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
      profiles: [...profiles.entries()],
      aiMonth,
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
  // Ranked by work done, so spending credits on the assistant never costs a place.
  rows.sort((a, b) => b.shares - a.shares || b.credits - a.credits)
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

// ---------- Assistant ----------
// Credits pay for Claude calls. Server-side guards keep the bill inside AI_MONTHLY_BUDGET_USD:
// a price in credits, a daily limit per wallet, a minimum wallet age, a minimum SOL balance on
// Solana mainnet, one call at a time per wallet, and a monthly dollar cap across everyone.
const AI_MESSAGE_CREDITS = envNumber('AI_MESSAGE_CREDITS', 2, 0, 100_000)
const AI_PROFILE_CREDITS = envNumber('AI_PROFILE_CREDITS', 50, 0, 1_000_000)
const AI_DAILY_MESSAGES = Math.round(envNumber('AI_DAILY_MESSAGES', 100, 0, 100_000))
const AI_DAILY_PROFILES = Math.round(envNumber('AI_DAILY_PROFILES', 3, 0, 1000))
const AI_MONTHLY_BUDGET_USD = envNumber('AI_MONTHLY_BUDGET_USD', 50, 0, 1_000_000)
const AI_MIN_WALLET_AGE_HOURS = envNumber('AI_MIN_WALLET_AGE_HOURS', 24, 0, 24 * 365)
const AI_MIN_WALLET_AGE_MS = AI_MIN_WALLET_AGE_HOURS * 3_600_000
const AI_MIN_SOL = envNumber('AI_MIN_SOL', 0.01, 0, 1_000_000)
const AI_MAX_CONCURRENT = Math.round(envNumber('AI_MAX_CONCURRENT', 8, 1, 200))
const DATASET_MIN_CHARS = 200
const DATASET_MAX_CHARS = 150_000
const MESSAGE_MAX_CHARS = 2_000
const HISTORY_MAX_TURNS = 12
const HISTORY_TURN_MAX_CHARS = 4_000
const PROFILE_MAX_CHARS = 12_000

const aiInFlight = new Set<string>()
let aiReservedUsd = 0
const solChecks = new Map<string, { sol: number; at: number }>()
const SOL_OK_TTL = 30 * 60_000
const SOL_LOW_TTL = 60_000
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of solChecks) if (now - v.at > SOL_OK_TTL) solChecks.delete(k)
}, 60_000)

function rollAiMonth() {
  const m = monthKeyNow()
  if (aiMonth.month !== m) aiMonth = { month: m, spentUsd: 0, calls: 0 }
}
const nextMonthAt = () => {
  const d = new Date()
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}
const budgetOpen = (extraUsd = 0) => {
  rollAiMonth()
  return aiMonth.spentUsd + aiReservedUsd + extraUsd <= AI_MONTHLY_BUDGET_USD
}
const aiToday = (w?: Wallet) => (w && w.aiDayKey === dayKeyNow()
  ? { messages: w.aiMessages ?? 0, profiles: w.aiProfiles ?? 0 }
  : { messages: 0, profiles: 0 })
const walletReadyAt = (w: Wallet) => w.createdAt + AI_MIN_WALLET_AGE_MS

// SOL balance on mainnet, cached so chat does not hit the RPC on every message. A low balance is
// cached for a minute only, so a wallet that was just funded passes soon after.
async function solOf(address: string, recheck = false): Promise<number | null> {
  const cached = solChecks.get(address)
  if (cached && !recheck) {
    const ttl = cached.sol >= AI_MIN_SOL ? SOL_OK_TTL : SOL_LOW_TTL
    if (Date.now() - cached.at < ttl) return cached.sol
  }
  try {
    const sol = await ai.solBalance(address)
    solChecks.set(address, { sol, at: Date.now() })
    return sol
  } catch (e) {
    console.warn('Solana balance check failed:', e instanceof Error ? e.message : e)
    return null
  }
}

type Gate = { status: number; body: Record<string, unknown> }
const offlineGate: Gate = { status: 503, body: { code: 'offline', error: 'The assistant is not available right now. Try again later.' } }

async function assistantGate(address: string, kind: 'message' | 'profile', estimateUsd: number): Promise<Gate | null> {
  if (!ai.assistantEnabled()) return offlineGate
  const w = wallets.get(address)
  if (!w) return { status: 403, body: { code: 'no_wallet', error: 'Connect your wallet first.' } }
  if (Date.now() < walletReadyAt(w)) {
    return { status: 403, body: { code: 'wallet_age', readyAt: walletReadyAt(w), error: `The assistant opens ${AI_MIN_WALLET_AGE_HOURS} hours after a wallet's first sign-in.` } }
  }
  const today = aiToday(w)
  if (kind === 'message' && today.messages >= AI_DAILY_MESSAGES) {
    return { status: 429, body: { code: 'daily_limit', resetAt: nextResetAt(), error: `You have used today's ${AI_DAILY_MESSAGES} messages. More at 00:00 UTC.` } }
  }
  if (kind === 'profile' && today.profiles >= AI_DAILY_PROFILES) {
    return { status: 429, body: { code: 'daily_limit', resetAt: nextResetAt(), error: `You have built ${AI_DAILY_PROFILES} profiles today. More at 00:00 UTC.` } }
  }
  const price = kind === 'message' ? AI_MESSAGE_CREDITS : AI_PROFILE_CREDITS
  if (w.balance < price) {
    return { status: 402, body: { code: 'credits', price, balance: w.balance, error: `This costs ${price} cr and your balance is ${w.balance.toFixed(4)} cr. Mine more in miner.exe.` } }
  }
  const sol = await solOf(address)
  if (sol === null) return { status: 503, body: { code: 'sol_unknown', error: 'Could not check your SOL balance right now. Try again in a minute.' } }
  if (sol < AI_MIN_SOL) {
    return { status: 403, body: { code: 'sol_balance', sol, minSol: AI_MIN_SOL, error: `The assistant needs a wallet holding at least ${AI_MIN_SOL} SOL on Solana. This one holds ${sol} SOL.` } }
  }
  // Checked last, after the await, so nothing can start in between the check and the call.
  if (aiInFlight.has(address)) return { status: 429, body: { code: 'in_flight', error: 'Wait for the current reply first.' } }
  if (aiInFlight.size >= AI_MAX_CONCURRENT) return { status: 503, body: { code: 'busy', error: 'The assistant is busy. Try again in a minute.' } }
  if (!budgetOpen(estimateUsd)) {
    return { status: 503, body: { code: 'budget', reopensAt: nextMonthAt(), error: "The assistant has used this month's capacity. It opens again on the 1st at 00:00 UTC." } }
  }
  return null
}

// Credits are taken before the call and given back if it fails or Claude declines.
function beginAiCall(address: string, w: Wallet, price: number, estimateUsd: number) {
  aiInFlight.add(address)
  aiReservedUsd += estimateUsd
  w.accepted = sharesOf(address, w) // fix the share count of old wallets before the balance moves
  w.balance = round4(w.balance - price)
}
function endAiCall(
  address: string, w: Wallet, kind: 'message' | 'profile', price: number, estimateUsd: number,
  result: { costUsd: number } | null, delivered: boolean,
) {
  aiInFlight.delete(address)
  aiReservedUsd = Math.max(0, aiReservedUsd - estimateUsd)
  if (result) {
    rollAiMonth()
    aiMonth.spentUsd += result.costUsd
    aiMonth.calls += 1
    // Every call Claude answered counts toward the daily limit, so declined requests cannot run up the bill.
    const today = aiToday(w)
    w.aiDayKey = dayKeyNow()
    w.aiMessages = today.messages + (kind === 'message' ? 1 : 0)
    w.aiProfiles = today.profiles + (kind === 'profile' ? 1 : 0)
  }
  if (delivered) w.aiSpent = round4((w.aiSpent ?? 0) + price)
  else w.balance = round4(w.balance + price)
  w.lastSeen = Date.now()
  scheduleSave()
}

const aiLog = (kind: string, address: string, r: { inputTokens: number; outputTokens: number; costUsd: number; stopReason: string | null }) =>
  console.log(`assistant ${kind} ${shortAddr(address)} in=${r.inputTokens} out=${r.outputTokens} stop=${r.stopReason} cost=$${r.costUsd.toFixed(5)} month=$${aiMonth.spentUsd.toFixed(4)}/${AI_MONTHLY_BUDGET_USD}`)

const nameSchema = z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N} .,'_-]+$/u, 'Use letters, numbers and spaces')
const profileSchema = z.object({
  name: nameSchema,
  sourceName: z.string().trim().min(1).max(120).default('pasted text'),
  text: z.string().min(DATASET_MIN_CHARS).max(DATASET_MAX_CHARS),
})
const chatSchema = z.object({
  message: z.string().trim().min(1).max(MESSAGE_MAX_CHARS),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    text: z.string().min(1).max(HISTORY_TURN_MAX_CHARS),
  })).max(60).default([]),
})
const stripControl = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

app.get('/api/assistant/status', requireAuth, assistantLimiter, async (req, res) => {
  const address = (req as any).authAddress as string
  const w = wallets.get(address)
  const enabled = ai.assistantEnabled()
  const sol = enabled && w ? await solOf(address, req.query.recheck === '1') : null
  res.json({
    enabled,
    prices: { message: AI_MESSAGE_CREDITS, profile: AI_PROFILE_CREDITS },
    limits: {
      messagesPerDay: AI_DAILY_MESSAGES,
      profilesPerDay: AI_DAILY_PROFILES,
      datasetMinChars: DATASET_MIN_CHARS,
      datasetMaxChars: DATASET_MAX_CHARS,
      messageMaxChars: MESSAGE_MAX_CHARS,
      historyTurns: HISTORY_MAX_TURNS,
    },
    today: aiToday(w),
    resetAt: nextResetAt(),
    balance: w?.balance ?? 0,
    checks: {
      walletAge: { ok: !!w && Date.now() >= walletReadyAt(w), readyAt: w ? walletReadyAt(w) : null, hours: AI_MIN_WALLET_AGE_HOURS },
      sol: { ok: sol === null ? null : sol >= AI_MIN_SOL, sol, minSol: AI_MIN_SOL },
      budget: { ok: budgetOpen(), reopensAt: nextMonthAt() },
    },
    profile: profiles.get(address) ?? null,
  })
})

app.post('/api/assistant/profile', requireAuth, assistantLimiter, async (req, res) => {
  const parsed = profileSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ code: 'invalid', error: `Give the assistant a name (letters, numbers, spaces) and between ${DATASET_MIN_CHARS} and ${DATASET_MAX_CHARS.toLocaleString('en-US')} characters of text.` })
  }
  const address = (req as any).authAddress as string
  const name = parsed.data.name
  const sourceName = stripControl(parsed.data.sourceName)
  const text = stripControl(parsed.data.text)
  const estimateUsd = ai.estimateCostUsd(ai.profilePromptChars(text.length), ai.profileMaxTokens)
  const gate = await assistantGate(address, 'profile', estimateUsd)
  if (gate) return res.status(gate.status).json(gate.body)

  const w = wallets.get(address)!
  beginAiCall(address, w, AI_PROFILE_CREDITS, estimateUsd)
  let result: Awaited<ReturnType<typeof ai.buildProfile>>
  try {
    result = await ai.buildProfile(name, sourceName, text)
  } catch (e) {
    const d = ai.describeAiError(e)
    console.error(d.log)
    endAiCall(address, w, 'profile', AI_PROFILE_CREDITS, estimateUsd, null, false)
    return res.status(d.status).json({ code: d.code, error: d.error })
  }
  aiLog('profile', address, result)
  if (result.stopReason === 'refusal' || result.stopReason === 'max_tokens' || !result.text) {
    endAiCall(address, w, 'profile', AI_PROFILE_CREDITS, estimateUsd, result, false)
    return res.status(422).json(result.stopReason === 'refusal'
      ? { code: 'refused', error: 'Claude declined to read this text. Try a different file. Your credits were returned.' }
      : { code: 'cut_off', error: 'The profile came out incomplete. Try a shorter file. Your credits were returned.' })
  }
  endAiCall(address, w, 'profile', AI_PROFILE_CREDITS, estimateUsd, result, true)
  const profile: AssistantProfile = { name, sourceName, datasetChars: text.length, text: result.text.slice(0, PROFILE_MAX_CHARS), builtAt: Date.now() }
  profiles.set(address, profile)
  scheduleSave()
  res.json({ profile, balance: w.balance, today: aiToday(w) })
})

app.post('/api/assistant/profile/delete', requireAuth, assistantLimiter, (req, res) => {
  const address = (req as any).authAddress as string
  if (profiles.delete(address)) scheduleSave()
  res.json({ ok: true })
})

app.post('/api/assistant/chat', requireAuth, assistantLimiter, async (req, res) => {
  const parsed = chatSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ code: 'invalid', error: `Write a message of up to ${MESSAGE_MAX_CHARS.toLocaleString('en-US')} characters.` })
  }
  const address = (req as any).authAddress as string
  const message = stripControl(parsed.data.message)
  // Recent turns only, and the conversation must open with a user turn.
  const history = parsed.data.history.slice(-HISTORY_MAX_TURNS).map(t => ({ role: t.role, text: stripControl(t.text) }))
  while (history.length && history[0].role !== 'user') history.shift()
  const profile = profiles.get(address)
  const historyChars = history.reduce((n, t) => n + t.text.length, 0)
  const estimateUsd = ai.estimateCostUsd(ai.chatPromptChars(profile?.text.length ?? 0, historyChars, message.length), ai.chatMaxTokens)
  const gate = await assistantGate(address, 'message', estimateUsd)
  if (gate) return res.status(gate.status).json(gate.body)

  const w = wallets.get(address)!
  beginAiCall(address, w, AI_MESSAGE_CREDITS, estimateUsd)
  let result: Awaited<ReturnType<typeof ai.chatReply>>
  try {
    result = await ai.chatReply(profile?.name ?? null, profile?.text ?? null, history, message)
  } catch (e) {
    const d = ai.describeAiError(e)
    console.error(d.log)
    endAiCall(address, w, 'message', AI_MESSAGE_CREDITS, estimateUsd, null, false)
    return res.status(d.status).json({ code: d.code, error: d.error })
  }
  aiLog('message', address, result)
  if (result.stopReason === 'refusal' || !result.text) {
    endAiCall(address, w, 'message', AI_MESSAGE_CREDITS, estimateUsd, result, false)
    return res.status(422).json(result.stopReason === 'refusal'
      ? { code: 'refused', error: 'The assistant declined to answer that. Try asking in a different way. Your credits were returned.' }
      : { code: 'cut_off', error: 'The reply came out empty. Try a shorter question. Your credits were returned.' })
  }
  endAiCall(address, w, 'message', AI_MESSAGE_CREDITS, estimateUsd, result, true)
  res.json({ reply: result.text, truncated: result.stopReason === 'max_tokens', balance: w.balance, today: aiToday(w) })
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

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { randomBytes } from 'crypto'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit, { ipKeyGenerator, type Options, type Store, type IncrementResponse } from 'express-rate-limit'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { generateChallenge, verifyProof } from './crypto.js'
import { envNumber } from './env.js'
import { sql, dbConfigured, ensureSchema, cleanupExpired } from './db.js'
import * as ai from './assistant.js'

const app = express()
const NODE_ENV = process.env.NODE_ENV || 'development'

// Without JWT_SECRET the server signs with a random per-instance secret: nothing guessable ships in
// the code, but sign-ins reset whenever a new instance starts. Always set it in production.
const JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex')
if (!process.env.JWT_SECRET) {
  console.warn('JWT_SECRET is not set. Using a random secret, so sign-ins reset whenever a new instance starts.')
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

// Trust the platform's proxy (Vercel, or Caddy in front of a standalone server)
app.set('trust proxy', 1)

// ---------- Mining rules ----------
// Each value can be tuned with an environment variable. Out-of-range values fall back to the default.
// Difficulty is the number of leading zero hex digits a hash needs: about 16^5 = 1,048,576 hashes
// per share at 5, which takes a typical browser tab tens of seconds.
const MINING_DIFFICULTY = Math.round(envNumber('MINING_DIFFICULTY', 5, 1, 8))
const CREDITS_PER_SHARE = envNumber('CREDITS_PER_SHARE', 1, 0.0001, 1000)
const DAILY_CREDIT_CAP = envNumber('DAILY_CREDIT_CAP', 1000, 1, 1_000_000)
const SUBMIT_COOLDOWN_MS = Math.round(envNumber('SUBMIT_COOLDOWN_MS', 10_000, 0, 600_000))
const CHALLENGE_EXPIRY_MS = 30 * 60 * 1000
const NONCE_TTL = 10 * 60 * 1000

const round4 = (n: number) => Math.round(n * 10_000) / 10_000
const dayKeyNow = () => new Date().toISOString().slice(0, 10)
const monthKeyNow = () => new Date().toISOString().slice(0, 7)
const nextResetAt = () => {
  const d = new Date()
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

function difficultyToTarget(difficulty: number): string {
  return '0'.repeat(difficulty) + 'f'.repeat(64 - difficulty)
}

// ---------- Storage ----------
// Rows of the wallets table. Credits, shares and the assistant counters of one address.
type Wallet = {
  address: string
  balance: number
  accepted: number
  created_at: number
  last_seen: number
  last_submit_at: number | null
  day_key: string | null      // UTC date of the last accepted share, e.g. 2026-10-17
  day_credits: number         // credits earned on that date
  ai_day_key: string | null   // UTC date of the last assistant use
  ai_messages: number         // chat messages on that date
  ai_profiles: number         // profiles built on that date
  ai_spent: number            // credits spent on the assistant, all time
}
// The profile Claude wrote from a dataset. The dataset itself is never stored.
type AssistantProfile = { name: string; sourceName: string; datasetChars: number; text: string; builtAt: number }

async function getWallet(address: string): Promise<Wallet | undefined> {
  const [w] = await sql<Wallet[]>`SELECT * FROM wallets WHERE address = ${address}`
  return w
}

async function getProfile(address: string): Promise<AssistantProfile | null> {
  const [p] = await sql<AssistantProfile[]>`
    SELECT name, source_name AS "sourceName", dataset_chars AS "datasetChars", text, built_at AS "builtAt"
    FROM profiles WHERE address = ${address}`
  return p ?? null
}

// Every API route waits for the tables. Without a database the API says so instead of failing later.
app.use('/api', async (req, res, next) => {
  if (req.path === '/ping' || req.path === '/health') return next()
  if (!dbConfigured) return res.status(503).json({ error: 'The service is starting up. Try again in a minute.' })
  try {
    await ensureSchema()
  } catch (e) {
    console.error('Database unavailable:', e instanceof Error ? e.message : e)
    return res.status(503).json({ error: 'The service is unavailable right now. Try again in a minute.' })
  }
  void cleanupExpired(CHALLENGE_EXPIRY_MS).catch(e => console.warn('Cleanup failed:', e instanceof Error ? e.message : e))
  next()
})

// Rate limits are counted in the database so every instance sees the same numbers. Behind a proxy
// every visitor can arrive from the same IP, so a limit keyed by IP would be shared by all users.
// Key by wallet address when the request has one (signed-in session, query, path or body) and
// fall back to the IP otherwise.
class PgStore implements Store {
  windowMs = 60_000
  constructor(public prefix: string) {}
  init(options: Options) { this.windowMs = options.windowMs }
  async increment(key: string): Promise<IncrementResponse> {
    const now = Date.now(), k = `${this.prefix}:${key}`, reset = now + this.windowMs
    const [r] = await sql<{ hits: number; reset_at: number }[]>`
      INSERT INTO rate_limits (key, hits, reset_at) VALUES (${k}, 1, ${reset})
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN rate_limits.reset_at <= ${now} THEN 1 ELSE rate_limits.hits + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at <= ${now} THEN ${reset} ELSE rate_limits.reset_at END
      RETURNING hits, reset_at`
    return { totalHits: r.hits, resetTime: new Date(r.reset_at) }
  }
  async decrement(key: string) { await sql`UPDATE rate_limits SET hits = GREATEST(0, hits - 1) WHERE key = ${`${this.prefix}:${key}`}` }
  async resetKey(key: string) { await sql`DELETE FROM rate_limits WHERE key = ${`${this.prefix}:${key}`}` }
}

const limitKey = (req: express.Request): string => {
  const candidate = (req as any).authAddress ?? req.params?.address ?? req.query?.address ?? req.body?.address
  return typeof candidate === 'string' && isSolanaAddress(candidate) ? candidate : ipKeyGenerator(req.ip ?? '')
}
const limiter = (name: string, max: number, message?: string) => rateLimit({
  windowMs: 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: limitKey,
  store: new PgStore(name),
  passOnStoreError: true, // a counting failure must not lock everyone out
  ...(message ? { message: { error: message, code: 'rate_limited' } } : {}),
})
const authLimiter = limiter('auth', 20, 'Too many sign-in attempts. Try again in a minute.')
const challengeLimiter = limiter('challenge', 500, 'Too many challenge requests, please slow down.')
const miningLimiter = limiter('mining', 200, 'Mining rate limit exceeded. Slow down.')
const walletLimiter = limiter('wallet', 60)
const assistantLimiter = limiter(
  'assistant',
  Math.round(envNumber('AI_REQUESTS_PER_MINUTE', 30, 1, 10_000)),
  'Too many assistant requests. Try again in a minute.',
)

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

async function issueNonce(address: string) {
  const nonce = randomBytes(16).toString('hex')
  const message = `Sign in to AetherOS\nNonce: ${nonce}`
  const expiresAt = Date.now() + NONCE_TTL
  await sql`
    INSERT INTO auth_nonces (address, message, expires_at) VALUES (${address}, ${message}, ${expiresAt})
    ON CONFLICT (address) DO UPDATE SET message = EXCLUDED.message, expires_at = EXCLUDED.expires_at`
  return { nonce, message, expiresAt }
}

// The signature must be a detached ed25519 signature over the exact message we issued.
// A valid signature consumes the nonce, so the same signature cannot sign in twice.
async function verifySignature(address: string, signature: string): Promise<boolean> {
  const [record] = await sql<{ message: string; expires_at: number }[]>`
    SELECT message, expires_at FROM auth_nonces WHERE address = ${address}`
  if (!record || Date.now() > record.expires_at) return false
  let valid = false
  try {
    valid = nacl.sign.detached.verify(
      new TextEncoder().encode(record.message),
      bs58.decode(signature),
      bs58.decode(address),
    )
  } catch {
    return false
  }
  if (!valid) return false
  const used = await sql`DELETE FROM auth_nonces WHERE address = ${address} AND message = ${record.message}`
  return used.count === 1
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

const earnedToday = (w?: Wallet) => (w && w.day_key === dayKeyNow() ? w.day_credits : 0)
const atDailyCap = (w?: Wallet) => round4(earnedToday(w) + CREDITS_PER_SHARE) > DAILY_CREDIT_CAP
const dailyLimitBody = () => ({
  error: 'Daily limit reached. Mining resumes at 00:00 UTC.',
  dailyLimit: true,
  resetAt: nextResetAt(),
})
const walletView = (address: string, w?: Wallet) => ({
  address,
  balance: w?.balance ?? 0,
  shares: w?.accepted ?? 0,
  exists: !!w,
  creditsPerShare: CREDITS_PER_SHARE,
  dailyEarned: earnedToday(w),
  dailyCap: DAILY_CREDIT_CAP,
})

// ---------- API ----------
app.get('/api/ping', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/stats', async (_req, res) => {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000
  const [row] = await sql<{ miners: number; total: number | null; recent: number }[]>`
    SELECT (SELECT count(*)::int FROM wallets) AS miners,
           (SELECT value FROM counters WHERE name = 'shares') AS total,
           (SELECT count(*)::int FROM shares WHERE at > ${dayAgo}) AS recent`
  res.json({
    totalMiners: row.miners,
    totalShares: row.total ?? 0,
    last24hShares: row.recent,
  })
})

// Ranked by work done, so spending credits on the assistant never costs a place.
app.get('/api/leaderboard', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
  const addressFilter = typeof req.query.address === 'string' ? req.query.address.trim() : ''
  const filter = addressFilter ? sql`WHERE address = ${addressFilter}` : sql``
  const rows = await sql<{ address: string; balance: number; accepted: number; rank: number; total: number }[]>`
    SELECT address, balance, accepted, rank, count(*) OVER ()::int AS total FROM (
      SELECT address, balance, accepted,
             row_number() OVER (ORDER BY accepted DESC, balance DESC, created_at, address)::int AS rank
      FROM wallets
    ) ranked ${filter}
    ORDER BY rank LIMIT ${limit} OFFSET ${(page - 1) * limit}`
  let total = rows[0]?.total
  if (total === undefined) {
    const [c] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM wallets ${filter}`
    total = c.n
  }
  res.json({
    leaderboard: rows.map(r => ({
      address: shortAddr(r.address),
      credits: Number(r.balance.toFixed(4)),
      shares: r.accepted,
      rank: r.rank,
    })),
    page, limit, total, totalPages: Math.ceil(total / limit),
  })
})

// ---------- Auth ----------
app.get('/api/auth/nonce', authLimiter, async (req, res) => {
  const address = typeof req.query.address === 'string' ? req.query.address : ''
  if (!isSolanaAddress(address)) return res.status(400).json({ error: 'A valid Solana address is required.' })
  res.json(await issueNonce(address))
})

app.post('/api/auth/verify', authLimiter, async (req, res) => {
  const { address, signature } = req.body ?? {}
  if (typeof address !== 'string' || typeof signature !== 'string' || !isSolanaAddress(address)) {
    return res.status(400).json({ error: 'Address and signature are required.' })
  }
  if (!(await verifySignature(address, signature))) return res.status(401).json({ error: 'Invalid signature.' })
  res.json({ token: createAuthToken(address) })
})

// ---------- Wallet ----------
app.get('/api/wallet/:address', walletLimiter, async (req, res) => {
  const addr = req.params.address as string
  if (!isSolanaAddress(addr)) return res.status(400).json({ error: 'Invalid address format' })
  res.json(walletView(addr, await getWallet(addr)))
})

app.post('/api/wallet/connect', requireAuth, walletLimiter, async (req, res) => {
  const parsed = connectSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed' })
  const { address } = parsed.data
  if ((req as any).authAddress !== address) {
    return res.status(403).json({ error: 'Signed in with a different wallet.' })
  }
  const now = Date.now()
  const [w] = await sql<Wallet[]>`
    INSERT INTO wallets (address, created_at, last_seen) VALUES (${address}, ${now}, ${now})
    ON CONFLICT (address) DO UPDATE SET last_seen = EXCLUDED.last_seen
    RETURNING *`
  res.json({ ok: true, wallet: walletView(address, w) })
})

// ---------- Mining ----------
app.get('/api/mining/challenge', requireAuth, challengeLimiter, async (req, res) => {
  const address = typeof req.query.address === 'string' ? req.query.address : ''
  if (!isSolanaAddress(address)) return res.status(400).json({ error: 'A valid Solana address is required.' })
  if ((req as any).authAddress !== address) {
    return res.status(403).json({ error: 'Signed in with a different wallet.' })
  }

  // Do not hand out work that could never be paid.
  const w = await getWallet(address)
  if (atDailyCap(w)) return res.status(429).json(dailyLimitBody())

  // One challenge per wallet: a newer one replaces the last, so a second tab cannot double the rate.
  const challenge = generateChallenge()
  const issuedAt = Date.now()
  const target = difficultyToTarget(MINING_DIFFICULTY)
  await sql`
    INSERT INTO challenges (address, challenge, issued_at, difficulty, target)
    VALUES (${address}, ${challenge}, ${issuedAt}, ${MINING_DIFFICULTY}, ${target})
    ON CONFLICT (address) DO UPDATE SET challenge = EXCLUDED.challenge, issued_at = EXCLUDED.issued_at,
      difficulty = EXCLUDED.difficulty, target = EXCLUDED.target`

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

type SubmitOutcome = { status: number; body: Record<string, unknown> }

app.post('/api/mining/submit', requireAuth, miningLimiter, async (req, res) => {
  const parsed = submitSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed' })
  const { address, nonce, hash, challenge } = parsed.data

  if ((req as any).authAddress !== address) {
    return res.status(403).json({ error: 'Signed in with a different wallet.' })
  }

  // The challenge row is locked for the whole check, so parallel submits of one proof pay once.
  const out = await sql.begin(async (tx): Promise<SubmitOutcome> => {
    const [stored] = await tx<{ challenge: string; issued_at: number; difficulty: number; target: string }[]>`
      SELECT challenge, issued_at, difficulty, target FROM challenges WHERE address = ${address} FOR UPDATE`
    const [w] = await tx<Wallet[]>`SELECT * FROM wallets WHERE address = ${address} FOR UPDATE`
    if (atDailyCap(w)) return { status: 429, body: dailyLimitBody() }

    if (!stored) return { status: 400, body: { error: 'No active challenge. Request a new one.' } }
    if (stored.challenge !== challenge) return { status: 400, body: { error: 'Challenge mismatch' } }

    const now = Date.now()
    if (now - stored.issued_at > CHALLENGE_EXPIRY_MS) {
      await tx`DELETE FROM challenges WHERE address = ${address}`
      return { status: 400, body: { error: 'Challenge expired. Request a new one.' } }
    }

    if (!verifyProof(challenge, nonce, hash, stored.target)) {
      return { status: 400, body: { error: 'Invalid proof-of-work' } }
    }

    const last = w?.last_submit_at ?? 0
    if (now - last < SUBMIT_COOLDOWN_MS) {
      return {
        status: 429,
        body: { error: 'Too fast. Wait between valid proofs.', retryAfterMs: SUBMIT_COOLDOWN_MS - (now - last) },
      }
    }

    const credits = CREDITS_PER_SHARE
    await tx`DELETE FROM challenges WHERE address = ${address}`
    const balance = round4((w?.balance ?? 0) + credits)
    const dayCredits = round4(earnedToday(w) + credits)
    await tx`
      INSERT INTO wallets (address, balance, accepted, created_at, last_seen, last_submit_at, day_key, day_credits)
      VALUES (${address}, ${balance}, 1, ${now}, ${now}, ${now}, ${dayKeyNow()}, ${dayCredits})
      ON CONFLICT (address) DO UPDATE SET
        balance = EXCLUDED.balance, accepted = wallets.accepted + 1, last_seen = EXCLUDED.last_seen,
        last_submit_at = EXCLUDED.last_submit_at, day_key = EXCLUDED.day_key, day_credits = EXCLUDED.day_credits`
    await tx`INSERT INTO shares (address, at, credits) VALUES (${address}, ${now}, ${credits})`
    await tx`INSERT INTO counters (name, value) VALUES ('shares', 1) ON CONFLICT (name) DO UPDATE SET value = counters.value + 1`

    return {
      status: 200,
      body: {
        success: true,
        credits: balance,
        creditsEarned: credits,
        difficulty: stored.difficulty,
        dailyEarned: dayCredits,
        dailyCap: DAILY_CREDIT_CAP,
      },
    }
  })
  res.status(out.status).json(out.body)
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
// A call still marked in progress after this long belongs to an instance that died; it no longer counts.
const AI_INFLIGHT_STALE_MS = 5 * 60_000
const DATASET_MIN_CHARS = 200
const DATASET_MAX_CHARS = 150_000
const MESSAGE_MAX_CHARS = 2_000
const HISTORY_MAX_TURNS = 12
const HISTORY_TURN_MAX_CHARS = 4_000
const PROFILE_MAX_CHARS = 12_000

// SOL balances are only a cache, so they stay in memory: a new instance simply asks the RPC again.
const solChecks = new Map<string, { sol: number; at: number }>()
const SOL_OK_TTL = 30 * 60_000
const SOL_LOW_TTL = 60_000

const nextMonthAt = () => {
  const d = new Date()
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}
async function aiMonthSpent(): Promise<number> {
  const [m] = await sql<{ spent_usd: number }[]>`SELECT spent_usd FROM ai_month WHERE month = ${monthKeyNow()}`
  return m?.spent_usd ?? 0
}
async function aiReservedUsd(): Promise<number> {
  const [r] = await sql<{ usd: number | null }[]>`
    SELECT sum(estimate_usd) AS usd FROM ai_inflight WHERE started_at > ${Date.now() - AI_INFLIGHT_STALE_MS}`
  return r.usd ?? 0
}
const budgetOpen = async (extraUsd = 0) =>
  (await aiMonthSpent()) + (await aiReservedUsd()) + extraUsd <= AI_MONTHLY_BUDGET_USD
const aiToday = (w?: Wallet) => (w && w.ai_day_key === dayKeyNow()
  ? { messages: w.ai_messages, profiles: w.ai_profiles }
  : { messages: 0, profiles: 0 })
const walletReadyAt = (w: Wallet) => w.created_at + AI_MIN_WALLET_AGE_MS

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
    if (solChecks.size > 10_000) solChecks.clear()
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
  const w = await getWallet(address)
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
  const stale = Date.now() - AI_INFLIGHT_STALE_MS
  const [mine] = await sql`SELECT 1 FROM ai_inflight WHERE address = ${address} AND started_at > ${stale}`
  if (mine) return { status: 429, body: { code: 'in_flight', error: 'Wait for the current reply first.' } }
  const [busy] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ai_inflight WHERE started_at > ${stale}`
  if (busy.n >= AI_MAX_CONCURRENT) return { status: 503, body: { code: 'busy', error: 'The assistant is busy. Try again in a minute.' } }
  if (!(await budgetOpen(estimateUsd))) {
    return { status: 503, body: { code: 'budget', reopensAt: nextMonthAt(), error: "The assistant has used this month's capacity. It opens again on the 1st at 00:00 UTC." } }
  }
  return null
}

// Credits are taken before the call and given back if it fails or Claude declines. The in-flight row
// is claimed and the price taken in one transaction, so two requests cannot both start a call or
// spend the same credits.
async function beginAiCall(address: string, price: number, estimateUsd: number): Promise<Gate | null> {
  return sql.begin(async tx => {
    const now = Date.now()
    await tx`DELETE FROM ai_inflight WHERE address = ${address} AND started_at <= ${now - AI_INFLIGHT_STALE_MS}`
    const claimed = await tx`
      INSERT INTO ai_inflight (address, started_at, estimate_usd) VALUES (${address}, ${now}, ${estimateUsd})
      ON CONFLICT (address) DO NOTHING`
    if (claimed.count !== 1) return { status: 429, body: { code: 'in_flight', error: 'Wait for the current reply first.' } }
    const paid = await tx`UPDATE wallets SET balance = round((balance - ${price})::numeric, 4)::float8 WHERE address = ${address} AND balance >= ${price}`
    if (paid.count !== 1) {
      await tx`DELETE FROM ai_inflight WHERE address = ${address}`
      return { status: 402, body: { code: 'credits', price, error: `This costs ${price} cr. Mine more in miner.exe.` } }
    }
    return null
  })
}
async function endAiCall(
  address: string, kind: 'message' | 'profile', price: number,
  result: { costUsd: number } | null, delivered: boolean,
): Promise<Wallet> {
  return sql.begin(async tx => {
    await tx`DELETE FROM ai_inflight WHERE address = ${address}`
    const [w] = await tx<Wallet[]>`SELECT * FROM wallets WHERE address = ${address} FOR UPDATE`
    if (result) {
      await tx`
        INSERT INTO ai_month (month, spent_usd, calls) VALUES (${monthKeyNow()}, ${result.costUsd}, 1)
        ON CONFLICT (month) DO UPDATE SET spent_usd = ai_month.spent_usd + EXCLUDED.spent_usd, calls = ai_month.calls + 1`
      // Every call Claude answered counts toward the daily limit, so declined requests cannot run up the bill.
      const today = aiToday(w)
      w.ai_day_key = dayKeyNow()
      w.ai_messages = today.messages + (kind === 'message' ? 1 : 0)
      w.ai_profiles = today.profiles + (kind === 'profile' ? 1 : 0)
    }
    if (delivered) w.ai_spent = round4(w.ai_spent + price)
    else w.balance = round4(w.balance + price)
    w.last_seen = Date.now()
    await tx`
      UPDATE wallets SET balance = ${w.balance}, ai_spent = ${w.ai_spent}, ai_day_key = ${w.ai_day_key},
        ai_messages = ${w.ai_messages}, ai_profiles = ${w.ai_profiles}, last_seen = ${w.last_seen}
      WHERE address = ${address}`
    return w
  })
}

const aiLog = async (kind: string, address: string, r: { inputTokens: number; outputTokens: number; costUsd: number; stopReason: string | null }) =>
  console.log(`assistant ${kind} ${shortAddr(address)} in=${r.inputTokens} out=${r.outputTokens} stop=${r.stopReason} cost=$${r.costUsd.toFixed(5)} month=$${(await aiMonthSpent()).toFixed(4)}/${AI_MONTHLY_BUDGET_USD}`)

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
  const w = await getWallet(address)
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
      budget: { ok: await budgetOpen(), reopensAt: nextMonthAt() },
    },
    profile: await getProfile(address),
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
  const gate = (await assistantGate(address, 'profile', estimateUsd)) ?? (await beginAiCall(address, AI_PROFILE_CREDITS, estimateUsd))
  if (gate) return res.status(gate.status).json(gate.body)

  let result: Awaited<ReturnType<typeof ai.buildProfile>>
  try {
    result = await ai.buildProfile(name, sourceName, text)
  } catch (e) {
    const d = ai.describeAiError(e)
    console.error(d.log)
    await endAiCall(address, 'profile', AI_PROFILE_CREDITS, null, false)
    return res.status(d.status).json({ code: d.code, error: d.error })
  }
  if (result.stopReason === 'refusal' || result.stopReason === 'max_tokens' || !result.text) {
    await endAiCall(address, 'profile', AI_PROFILE_CREDITS, result, false)
    await aiLog('profile', address, result)
    return res.status(422).json(result.stopReason === 'refusal'
      ? { code: 'refused', error: 'Claude declined to read this text. Try a different file. Your credits were returned.' }
      : { code: 'cut_off', error: 'The profile came out incomplete. Try a shorter file. Your credits were returned.' })
  }
  const w = await endAiCall(address, 'profile', AI_PROFILE_CREDITS, result, true)
  await aiLog('profile', address, result)
  const profile: AssistantProfile = { name, sourceName, datasetChars: text.length, text: result.text.slice(0, PROFILE_MAX_CHARS), builtAt: Date.now() }
  await sql`
    INSERT INTO profiles (address, name, source_name, dataset_chars, text, built_at)
    VALUES (${address}, ${profile.name}, ${profile.sourceName}, ${profile.datasetChars}, ${profile.text}, ${profile.builtAt})
    ON CONFLICT (address) DO UPDATE SET name = EXCLUDED.name, source_name = EXCLUDED.source_name,
      dataset_chars = EXCLUDED.dataset_chars, text = EXCLUDED.text, built_at = EXCLUDED.built_at`
  res.json({ profile, balance: w.balance, today: aiToday(w) })
})

app.post('/api/assistant/profile/delete', requireAuth, assistantLimiter, async (req, res) => {
  const address = (req as any).authAddress as string
  await sql`DELETE FROM profiles WHERE address = ${address}`
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
  const profile = await getProfile(address)
  const historyChars = history.reduce((n, t) => n + t.text.length, 0)
  const estimateUsd = ai.estimateCostUsd(ai.chatPromptChars(profile?.text.length ?? 0, historyChars, message.length), ai.chatMaxTokens)
  const gate = (await assistantGate(address, 'message', estimateUsd)) ?? (await beginAiCall(address, AI_MESSAGE_CREDITS, estimateUsd))
  if (gate) return res.status(gate.status).json(gate.body)

  let result: Awaited<ReturnType<typeof ai.chatReply>>
  try {
    result = await ai.chatReply(profile?.name ?? null, profile?.text ?? null, history, message)
  } catch (e) {
    const d = ai.describeAiError(e)
    console.error(d.log)
    await endAiCall(address, 'message', AI_MESSAGE_CREDITS, null, false)
    return res.status(d.status).json({ code: d.code, error: d.error })
  }
  if (result.stopReason === 'refusal' || !result.text) {
    await endAiCall(address, 'message', AI_MESSAGE_CREDITS, result, false)
    await aiLog('message', address, result)
    return res.status(422).json(result.stopReason === 'refusal'
      ? { code: 'refused', error: 'The assistant declined to answer that. Try asking in a different way. Your credits were returned.' }
      : { code: 'cut_off', error: 'The reply came out empty. Try a shorter question. Your credits were returned.' })
  }
  const w = await endAiCall(address, 'message', AI_MESSAGE_CREDITS, result, true)
  await aiLog('message', address, result)
  res.json({ reply: result.text, truncated: result.stopReason === 'max_tokens', balance: w.balance, today: aiToday(w) })
})

app.get('/api/wallets', async (req, res) => {
  const adminKey = req.headers['x-admin-key']
  if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Admin key required' })
  }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const list = await sql<Wallet[]>`SELECT * FROM wallets ORDER BY balance DESC LIMIT ${limit}`
  const [c] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM wallets`
  res.json({ wallets: list, total: c.n })
})

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

export function errorHandler(err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) {
  // Bad input from a client (broken JSON, a body over the size limit) is a 4xx, not a server fault.
  const status = Number(err?.status ?? err?.statusCode)
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: status === 413 ? 'Request too large' : 'Invalid request' })
  }
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
}
app.use(errorHandler)

export default app

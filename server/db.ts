// Postgres storage. Every request may land on a fresh serverless instance, so nothing that must
// survive between requests is kept in memory: balances, shares, sign-in nonces, mining challenges,
// cooldowns, rate limits and assistant calls in progress all live in these tables.
import postgres from 'postgres'

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || ''
export const dbConfigured = url !== ''

export const sql = postgres(url || 'postgres://unset@127.0.0.1:1/unset', {
  prepare: false, // Neon's pooled endpoint runs PgBouncer in transaction mode
  max: Math.max(1, Number(process.env.DB_POOL_MAX) || 5),
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},
  // Millisecond timestamps are stored as bigint; read them back as plain numbers.
  types: { bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) } },
})

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wallets (
  address text PRIMARY KEY,
  balance double precision NOT NULL DEFAULT 0,
  accepted integer NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  last_seen bigint NOT NULL,
  last_submit_at bigint,
  day_key text,
  day_credits double precision NOT NULL DEFAULT 0,
  ai_day_key text,
  ai_messages integer NOT NULL DEFAULT 0,
  ai_profiles integer NOT NULL DEFAULT 0,
  ai_spent double precision NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS wallets_rank_idx ON wallets (accepted DESC, balance DESC);
CREATE TABLE IF NOT EXISTS shares (
  id bigserial PRIMARY KEY,
  address text NOT NULL,
  at bigint NOT NULL,
  credits double precision NOT NULL
);
CREATE INDEX IF NOT EXISTS shares_at_idx ON shares (at);
CREATE TABLE IF NOT EXISTS counters (name text PRIMARY KEY, value bigint NOT NULL);
CREATE TABLE IF NOT EXISTS challenges (
  address text PRIMARY KEY,
  challenge text NOT NULL,
  issued_at bigint NOT NULL,
  difficulty integer NOT NULL,
  target text NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_nonces (address text PRIMARY KEY, message text NOT NULL, expires_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS profiles (
  address text PRIMARY KEY,
  name text NOT NULL,
  source_name text NOT NULL,
  dataset_chars integer NOT NULL,
  text text NOT NULL,
  built_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_month (month text PRIMARY KEY, spent_usd double precision NOT NULL DEFAULT 0, calls integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ai_inflight (address text PRIMARY KEY, started_at bigint NOT NULL, estimate_usd double precision NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (key text PRIMARY KEY, hits integer NOT NULL, reset_at bigint NOT NULL);
`

// Created once per instance. The advisory lock stops two cold starts from creating the same table at once.
let ready: Promise<void> | null = null
export function ensureSchema(): Promise<void> {
  ready ??= sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(4300)`
    await tx.unsafe(SCHEMA)
  }).then(() => undefined).catch(e => { ready = null; throw e })
  return ready
}

// Expired rows are removed now and then instead of on a timer, which a serverless instance does not keep.
let lastCleanup = 0
export async function cleanupExpired(challengeExpiryMs: number) {
  const now = Date.now()
  if (now - lastCleanup < 5 * 60_000) return
  lastCleanup = now
  await sql`DELETE FROM auth_nonces WHERE expires_at < ${now}`
  await sql`DELETE FROM challenges WHERE issued_at < ${now - challengeExpiryMs}`
  await sql`DELETE FROM rate_limits WHERE reset_at < ${now - 60_000}`
  await sql`DELETE FROM shares WHERE at < ${now - 2 * 24 * 3_600_000}`
}

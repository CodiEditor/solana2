import { getWallets } from '@wallet-standard/app'
import type { Wallet, WalletAccount } from '@wallet-standard/base'
import bs58 from 'bs58'
import type { LogLine, MinerState, WalletState } from './types'
import { apiFetch, ApiError, isAuthError, setAuthToken, clearAuthToken, getAuthToken } from './api'
import { storage } from './storage'

const LS_WALLET = 'aetheros:wallet'
const LS_WALLET_NAME = 'aetheros:walletName'

// Keys written by earlier versions of the app.
;['aetheros:sol', 'aetheros:provider', 'aetheros:chain', 'aetheros:network', 'aetheros:token',
  'solanaos:datasets', 'solanaos:models', 'solanaos:jobs', 'solanaos:seen'].forEach(k => storage.remove(k))

export const wallet: WalletState = {
  address: storage.get(LS_WALLET),
  walletName: storage.get(LS_WALLET_NAME),
}

export const miner: MinerState = {
  running: false,
  waiting: false,
  intensity: 75,
  hashrate: 0,
  found: 0,
  accepted: 0,
  rejected: 0,
  session: 0,
  balance: 0,
  creditsPerShare: null,
  dailyEarned: 0,
  dailyCap: null,
}

export const minerLog: LogLine[] = []

let tickCb: ((m: MinerState, uptime: string) => void) | null = null
let balanceCb: (() => void) | null = null
let noticeCb: ((line: LogLine) => void) | null = null
let walletsCb: (() => void) | null = null
export const onMinerTick = (cb: (m: MinerState, uptime: string) => void) => { tickCb = cb }
export const onBalanceChange = (cb: () => void) => { balanceCb = cb }
export const onNotice = (cb: (line: LogLine) => void) => { noticeCb = cb }
export const onWalletsChange = (cb: () => void) => { walletsCb = cb }

function log(text: string, kind: LogLine['kind'] = 'info') {
  const line = { at: Date.now(), text, kind }
  minerLog.push(line)
  if (minerLog.length > 60) minerLog.shift()
  noticeCb?.(line)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const fmtUptime = (s: number) =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':')

// ---------- Wallets (Wallet Standard) ----------
// Wallets announce themselves, so names and icons come from the wallet and no vendor is hard-coded.
const registry = getWallets()
registry.on('register', () => walletsCb?.())
registry.on('unregister', () => walletsCb?.())

const canSignIn = (w: Wallet) => 'standard:connect' in w.features && 'solana:signMessage' in w.features

export function listWallets(): { name: string; icon: string }[] {
  const seen = new Set<string>()
  return registry.get().filter(canSignIn).filter(w => !seen.has(w.name) && !!seen.add(w.name))
    .map(w => ({ name: w.name, icon: w.icon }))
}

let stopWatchingAccount: (() => void) | null = null

export async function connectWallet(name: string): Promise<string> {
  const w = registry.get().find(x => x.name === name && canSignIn(x))
  if (!w) throw new Error('That wallet is no longer available. Reload the page and try again.')

  const connect = (w.features['standard:connect'] as any).connect as () => Promise<{ accounts: readonly WalletAccount[] }>
  const { accounts } = await connect()
  const account = accounts.find(a => a.chains.some(c => c.startsWith('solana:'))) ?? accounts[0]
  if (!account) throw new Error('The wallet did not share an account.')
  const address = account.address

  // Sign the exact message the server issued. No transaction is sent.
  const { message } = await apiFetch(`/auth/nonce?address=${encodeURIComponent(address)}`)
  const signMessage = (w.features['solana:signMessage'] as any).signMessage as
    (...inputs: { account: WalletAccount; message: Uint8Array }[]) => Promise<{ signature: Uint8Array }[]>
  const [{ signature }] = await signMessage({ account, message: new TextEncoder().encode(message) })
  const { token } = await apiFetch('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ address, signature: bs58.encode(signature) }),
  })
  setAuthToken(token)

  wallet.address = address
  wallet.walletName = w.name
  storage.set(LS_WALLET, address)
  storage.set(LS_WALLET_NAME, w.name)

  stopWatchingAccount?.()
  const events = w.features['standard:events'] as any
  stopWatchingAccount = events?.on?.('change', (p: { accounts?: readonly WalletAccount[] }) => {
    const next = p.accounts?.[0]?.address
    if (next && next !== wallet.address) sessionLost('The wallet switched accounts. Connect again to continue.')
  }) ?? null

  await apiFetch('/wallet/connect', { method: 'POST', body: JSON.stringify({ address }) })
  await refreshBalance()
  return address
}

function clearSession() {
  stopWatchingAccount?.()
  stopWatchingAccount = null
  wallet.address = null
  wallet.walletName = null
  miner.balance = 0
  miner.session = 0
  miner.dailyEarned = 0
  miner.dailyCap = null
  clearAuthToken()
  storage.remove(LS_WALLET)
  storage.remove(LS_WALLET_NAME)
  balanceCb?.()
}

export async function disconnectWallet() {
  stopMining()
  const name = wallet.walletName
  clearSession()
  const w = name ? registry.get().find(x => x.name === name) : undefined
  try { await (w?.features['standard:disconnect'] as any)?.disconnect?.() } catch { /* wallet refused */ }
}

function sessionLost(message: string) {
  stopMining()
  clearSession()
  log(message, 'error')
}

export async function refreshBalance() {
  if (!wallet.address) return
  try {
    const d = await apiFetch(`/wallet/${encodeURIComponent(wallet.address)}`)
    miner.balance = d.balance ?? 0
    miner.creditsPerShare = d.creditsPerShare ?? miner.creditsPerShare
    miner.dailyEarned = d.dailyEarned ?? 0
    miner.dailyCap = d.dailyCap ?? miner.dailyCap
  } catch { /* balance stays as it was */ }
  balanceCb?.()
}

// ---------- Mining ----------
let worker: Worker | null = null
let runId = 0
let uptimeSec = 0
let uptimeTimer: number | undefined
let submitting = false
let lastAcceptedAt = 0
let cooldownMs = 10_000

const isDailyLimit = (e: unknown) => e instanceof ApiError && e.status === 429 && !!e.body?.dailyLimit

function dailyLimitReached() {
  if (miner.dailyCap !== null) miner.dailyEarned = miner.dailyCap
  stopMining()
  log('Daily limit reached. Mining resumes at 00:00 UTC.', 'error')
}

async function requestChallenge(id: number, attempt = 0): Promise<boolean> {
  if (id !== runId || !worker) return false
  try {
    const c = await apiFetch(`/mining/challenge?address=${encodeURIComponent(wallet.address!)}`)
    if (id !== runId || !worker) return false
    miner.creditsPerShare = c.creditsPerShare ?? miner.creditsPerShare
    cooldownMs = c.cooldownMs ?? cooldownMs
    miner.dailyEarned = c.dailyEarned ?? miner.dailyEarned
    miner.dailyCap = c.dailyCap ?? miner.dailyCap
    miner.waiting = false
    worker.postMessage({ type: 'start', challenge: c.challenge, difficulty: c.difficulty, target: c.target, intensity: miner.intensity })
    return true
  } catch (e) {
    if (isAuthError(e)) { sessionLost('Your session expired. Connect your wallet again.'); return false }
    if (isDailyLimit(e)) { dailyLimitReached(); return false }
    const retryable = !(e instanceof ApiError) || [429, 500, 502, 503, 504].includes(e.status)
    if (retryable && attempt < 3) {
      const wait = 1000 * 2 ** attempt
      log(`Server busy. Retrying in ${wait / 1000}s.`)
      await sleep(wait)
      return requestChallenge(id, attempt + 1)
    }
    log(`Could not get a challenge: ${errText(e)}`, 'error')
    return false
  }
}

async function submitProof(msg: { nonce: number; hash: string; challenge: string }, id: number) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await apiFetch('/mining/submit', {
        method: 'POST',
        body: JSON.stringify({ address: wallet.address, nonce: msg.nonce, hash: msg.hash, challenge: msg.challenge }),
      })
    } catch (e) {
      if (e instanceof ApiError && e.status === 429 && attempt === 0 && !isDailyLimit(e)) {
        const wait = Math.min(Number(e.body?.retryAfterMs) || cooldownMs, 30_000)
        log(`Too fast. Waiting ${Math.ceil(wait / 1000)}s before submitting.`)
        miner.waiting = true
        tickCb?.(miner, fmtUptime(uptimeSec))
        await sleep(wait + 250)
        if (id !== runId) return null
        continue
      }
      throw e
    }
  }
  return null
}

async function onProof(msg: { nonce: number; hash: string; challenge: string; attempts: number }, id: number) {
  if (submitting) return
  submitting = true
  miner.found++
  log(`Share found after ${msg.attempts.toLocaleString()} hashes.`)
  try {
    const res = await submitProof(msg, id)
    if (id !== runId) return
    if (res?.success) {
      miner.accepted++
      miner.balance = res.credits
      miner.session += res.creditsEarned
      miner.dailyEarned = res.dailyEarned ?? miner.dailyEarned
      miner.dailyCap = res.dailyCap ?? miner.dailyCap
      lastAcceptedAt = Date.now()
      log(`Accepted. +${Number(res.creditsEarned).toFixed(4)} cr`, 'ok')
      balanceCb?.()
    }
  } catch (e) {
    if (isAuthError(e)) { sessionLost('Your session expired. Connect your wallet again.'); return }
    if (isDailyLimit(e)) { dailyLimitReached(); return }
    miner.rejected++
    log(`Rejected: ${errText(e)}`, 'error')
  } finally {
    submitting = false
  }

  if (!miner.running || id !== runId) return
  const wait = cooldownMs - (Date.now() - lastAcceptedAt)
  if (wait > 0) {
    log(`Next share in ${Math.ceil(wait / 1000)}s.`)
    miner.waiting = true
    tickCb?.(miner, fmtUptime(uptimeSec))
    await sleep(wait)
  }
  if (!miner.running || id !== runId) return
  if (!(await requestChallenge(id))) stopMining()
}

export async function startMining() {
  if (miner.running) return
  if (!wallet.address || !getAuthToken()) {
    log('Connect your wallet to start mining.', 'error')
    return
  }
  const id = ++runId
  miner.running = true
  miner.hashrate = 0
  uptimeSec = 0
  uptimeTimer = window.setInterval(() => { uptimeSec++; tickCb?.(miner, fmtUptime(uptimeSec)) }, 1000)

  worker = new Worker(new URL('./workers/miner.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    if (id !== runId) return
    if (e.data.type === 'stats') {
      miner.hashrate = e.data.hashrate
      tickCb?.(miner, fmtUptime(uptimeSec))
    } else if (e.data.type === 'proof') {
      void onProof(e.data, id)
    }
  }
  worker.onerror = (ev) => { log(`Mining worker error: ${ev.message}`, 'error'); stopMining() }

  log('Mining started.')
  if (!(await requestChallenge(id))) stopMining()
}

export function stopMining() {
  const wasRunning = miner.running
  runId++
  miner.running = false
  miner.waiting = false
  miner.hashrate = 0
  submitting = false
  if (worker) { worker.postMessage({ type: 'stop' }); worker.terminate(); worker = null }
  if (uptimeTimer) { clearInterval(uptimeTimer); uptimeTimer = undefined }
  if (wasRunning) log('Mining stopped.')
  tickCb?.(miner, fmtUptime(uptimeSec))
  balanceCb?.()
}

export function setIntensity(v: number) {
  miner.intensity = v
  worker?.postMessage({ type: 'intensity', value: v })
}

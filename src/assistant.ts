// assistant.exe: build a profile from your own text, then chat with it. Every call is paid with credits.
import { apiFetch, ApiError } from './api'
import { esc } from './html'
import { miner, wallet, setBalance, sessionLost } from './store'
import type { AssistantStatus, ChatTurn } from './types'

type Ctx = {
  rerender: () => void
  toast: (msg: string, kind?: 'success' | 'info' | 'error') => void
  connect: () => void
}

type Turn = ChatTurn & { cut?: boolean }

const NAME_CHARS = /[^\p{L}\p{N} .,'_-]/gu
const FILE_MAX_BYTES = 5 * 1024 * 1024
const FALLBACK_MAX_CHARS = 150_000

const st = {
  address: null as string | null,
  status: null as AssistantStatus | null,
  load: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  loadedAt: 0,
  tab: null as 'chat' | 'teach' | null,
  turns: [] as Turn[],
  draft: '',
  name: '',
  source: '',
  dataset: '',
  busy: null as null | 'chat' | 'profile' | 'delete' | 'recheck',
  showProfile: false,
  deleteArmedUntil: 0,
}

// A different wallet (or none) starts from a clean window: chats and drafts never carry over.
function syncWallet() {
  if (st.address === wallet.address) return
  Object.assign(st, {
    address: wallet.address, status: null, load: 'idle', loadedAt: 0, tab: null, turns: [], draft: '',
    name: '', source: '', dataset: '', busy: null, showProfile: false, deleteArmedUntil: 0,
  })
}

const fmtCr = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 4 })} cr`
const fmtSol = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 4 })
const fmtWhen = (ts: number) =>
  new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const fmtCount = (n: number) => n.toLocaleString('en-US')

function gateRow(ok: boolean | null, text: string, action = '') {
  const cls = ok ? 'ok' : 'warn'
  const mark = ok ? '✓' : ok === null ? '?' : '✗'
  return `<div class="ck-gate ${cls} ai-gate"><span aria-hidden="true">${mark}</span><span>${text}</span>${action}</div>`
}

function checksHTML(s: AssistantStatus): string {
  const c = s.checks
  const recheck = `<button class="ck-btn ck-btn--ghost ck-btn--sm" data-ai-recheck ${st.busy ? 'disabled' : ''}>${st.busy === 'recheck' ? 'CHECKING…' : 'CHECK AGAIN'}</button>`
  const rows = [
    gateRow(c.walletAge.ok, c.walletAge.ok
      ? `Wallet signed in for ${c.walletAge.hours} hours or more`
      : `Opens ${c.walletAge.readyAt ? fmtWhen(c.walletAge.readyAt) : 'soon'}, ${c.walletAge.hours} hours after this wallet's first sign-in`),
    gateRow(c.sol.ok, c.sol.ok
      ? `Holds ${fmtSol(c.sol.sol ?? 0)} SOL on Solana`
      : c.sol.ok === null
        ? 'Could not check the SOL balance of this wallet.'
        : `Holds ${fmtSol(c.sol.sol ?? 0)} SOL on Solana. The assistant needs at least ${c.sol.minSol} SOL in the wallet. Nothing is spent.`,
      c.sol.ok ? '' : recheck),
    gateRow(miner.balance >= s.prices.message, `Balance ${fmtCr(miner.balance)}. A message costs ${fmtCr(s.prices.message)}, a profile ${fmtCr(s.prices.profile)}.`),
  ]
  if (!c.budget.ok) rows.push(gateRow(false, `This month's capacity is used. The assistant opens again ${fmtWhen(c.budget.reopensAt)}.`))
  return `<div class="ck-card"><div class="ck-card-head">BEFORE YOU START</div><div class="ck-list">${rows.join('')}</div></div>`
}

const ready = (s: AssistantStatus) => s.enabled && s.checks.walletAge.ok && s.checks.sol.ok === true && s.checks.budget.ok

function chatHTML(s: AssistantStatus): string {
  const p = s.profile
  const name = p ? p.name : 'AetherOS assistant'
  const canSend = ready(s) && !st.busy && miner.balance >= s.prices.message && s.today.messages < s.limits.messagesPerDay
  const bubbles = st.turns.map(t => `<div class="ck-bubble ${t.role === 'user' ? 'user' : 'bot'}">${esc(t.text)}${t.cut ? '<span class="ai-cut">The reply stopped at the length limit.</span>' : ''}</div>`).join('')
  return `
    <div class="ck-card ai-chat-card">
      <div class="ck-card-head ai-head"><span>${esc(name)} · ${p ? `taught from ${esc(p.sourceName)}` : 'no profile yet, open TEACH to make it yours'}</span>${st.turns.length ? `<button class="ck-btn ck-btn--ghost ck-btn--sm" data-ai-newchat ${st.busy ? 'disabled' : ''}>NEW CHAT</button>` : ''}</div>
      <div class="ck-chat ai-chat" id="ai-chat" aria-live="polite">
        ${bubbles || `<div class="ck-empty">Ask ${esc(name)} anything. Each message costs ${fmtCr(s.prices.message)}.</div>`}
        ${st.busy === 'chat' ? '<div class="ck-bubble bot ai-typing">writing…</div>' : ''}
      </div>
      <div class="ai-compose">
        <textarea id="ai-input" class="ai-textarea" rows="2" maxlength="${s.limits.messageMaxChars}" placeholder="Message ${esc(name)}" aria-label="Message">${esc(st.draft)}</textarea>
        <button class="ck-btn ck-btn--go" id="ai-send" ${canSend ? '' : 'disabled'}>SEND · ${fmtCr(s.prices.message)}</button>
      </div>
      <div class="ck-hint">Today ${s.today.messages} of ${s.limits.messagesPerDay} messages · balance ${fmtCr(miner.balance)} · Enter sends, Shift+Enter adds a line</div>
    </div>`
}

function teachHTML(s: AssistantStatus): string {
  const p = s.profile
  const max = s.limits.datasetMaxChars
  const building = st.busy === 'profile'
  const canBuild = ready(s) && !st.busy && miner.balance >= s.prices.profile && s.today.profiles < s.limits.profilesPerDay
  const current = p ? `
    <div class="ck-card">
      <div class="ck-card-head">CURRENT PROFILE</div>
      <div class="ck-grid2">
        <div class="ck-mini"><span>name</span><b>${esc(p.name)}</b></div>
        <div class="ck-mini"><span>built</span><b>${esc(fmtWhen(p.builtAt))}</b></div>
        <div class="ck-mini"><span>from</span><b class="ai-ellipsis">${esc(p.sourceName)}</b></div>
        <div class="ck-mini"><span>text read</span><b>${fmtCount(p.datasetChars)} chars</b></div>
      </div>
      <div class="ck-row">
        <button class="ck-btn ck-btn--ghost ck-btn--sm" data-ai-view>${st.showProfile ? 'HIDE PROFILE' : 'VIEW PROFILE'}</button>
        <button class="ck-btn ck-btn--ghost ck-btn--sm" data-ai-delete ${st.busy ? 'disabled' : ''}>${Date.now() < st.deleteArmedUntil ? 'CONFIRM DELETE' : 'DELETE PROFILE'}</button>
      </div>
      ${st.showProfile ? `<pre class="ck-pre ai-profile">${esc(p.text)}</pre>` : ''}
    </div>` : ''
  return `${current}
    <div class="ck-card">
      <div class="ck-card-head">${p ? 'REBUILD FROM NEW TEXT' : 'TEACH YOUR ASSISTANT'}</div>
      <div class="ck-desc">Upload a text file or paste text: notes, posts, a FAQ, a style guide. Claude reads it once and writes a profile of its voice and knowledge. Chat then answers from that profile.</div>
      <label class="ai-label" for="ai-name">ASSISTANT NAME</label>
      <input id="ai-name" class="ck-input" maxlength="40" value="${esc(st.name)}" placeholder="Atlas" autocomplete="off"/>
      <div class="ck-row">
        <label class="ck-btn ck-btn--ghost ck-btn--sm ai-file">CHOOSE FILE<input type="file" id="ai-file" accept=".txt,.md,.markdown,.csv,.tsv,.json,.jsonl,text/plain,text/markdown,text/csv,application/json"/></label>
        <span class="ck-hint ai-ellipsis">${st.source ? esc(st.source) : '.txt .md .csv .json'}</span>
      </div>
      <textarea id="ai-dataset" class="ai-textarea ai-dataset" rows="7" maxlength="${max}" placeholder="Or paste text here" aria-label="Text to learn from">${esc(st.dataset)}</textarea>
      <div class="ck-row">
        <span class="ck-hint" id="ai-count">${fmtCount(st.dataset.length)} of ${fmtCount(max)} characters</span>
        <button id="ai-build" class="ck-btn ck-btn--go" style="margin-left:auto" ${canBuild ? '' : 'disabled'}>${building ? 'READING…' : `BUILD PROFILE · ${fmtCr(s.prices.profile)}`}</button>
      </div>
      <div class="ck-hint">${building ? 'Claude is reading your text. This can take up to a minute.' : `Your text goes to Anthropic to write the profile. AetherOS keeps the profile, not the text. Today ${s.today.profiles} of ${s.limits.profilesPerDay} profiles.`}</div>
    </div>`
}

export function assistantBody(): string {
  syncWallet()
  const s = st.status
  const tab = st.tab ?? (s?.profile ? 'chat' : 'teach')
  const head = `
    <div class="cherry-app-head">
      <div class="cherry-kicker"><span class="ck-dot"></span> ASSISTANT · Claude, taught from your own text, paid with credits</div>
      ${s?.enabled ? `<div class="cherry-tabs" role="tablist">
        <button class="ck-tab ${tab === 'chat' ? 'on' : ''}" data-ai-tab="chat" role="tab" aria-selected="${tab === 'chat'}">CHAT</button>
        <button class="ck-tab ${tab === 'teach' ? 'on' : ''}" data-ai-tab="teach" role="tab" aria-selected="${tab === 'teach'}">TEACH</button>
      </div>` : ''}
    </div>`
  let body: string
  if (!wallet.address) {
    body = `<div class="ck-card" style="text-align:center"><div class="ck-desc">Connect a wallet to use the assistant. Credits you mine pay for each message.</div><div><button class="ck-btn ck-btn--go" data-ai-connect>CONNECT WALLET</button></div></div>`
  } else if (!s) {
    body = st.load === 'error'
      ? `<div class="ck-card"><div class="ck-desc">Could not load the assistant.</div><div><button class="ck-btn ck-btn--ghost ck-btn--sm" data-ai-retry>TRY AGAIN</button></div></div>`
      : `<div class="ck-empty">Checking your wallet…</div>`
  } else if (!s.enabled) {
    body = `<div class="ck-card"><div class="ck-desc">The assistant is offline right now. Mining and the leaderboard work as usual.</div></div>`
  } else {
    body = (ready(s) ? '' : checksHTML(s)) + (tab === 'chat' ? chatHTML(s) : teachHTML(s))
  }
  return `<div class="cherry-app ai-app" id="ai-root">${head}${body}</div>`
}

// ---------- Actions ----------
async function loadStatus(ctx: Ctx, recheck = false) {
  if (st.load === 'loading' && !recheck) return
  const address = wallet.address
  if (!address) return
  if (recheck) st.busy = 'recheck'
  else st.load = 'loading'
  try {
    const s = await apiFetch(`/assistant/status${recheck ? '?recheck=1' : ''}`) as AssistantStatus
    if (wallet.address !== address) return
    st.status = s
    st.load = 'ready'
    st.loadedAt = Date.now()
    setBalance(s.balance)
  } catch (e) {
    if (wallet.address !== address) return
    if (!handleAuth(e)) {
      if (!st.status) st.load = 'error'
      if (recheck) ctx.toast(esc(e instanceof Error ? e.message : 'Could not check the wallet'), 'error')
    }
  } finally {
    if (recheck) st.busy = null
  }
  ctx.rerender()
}

// A 401, or a 403 without a reason code, means the sign-in is gone. Gate refusals always carry a code.
function handleAuth(e: unknown): boolean {
  if (e instanceof ApiError && (e.status === 401 || (e.status === 403 && !e.body?.code))) {
    sessionLost('Your session expired. Connect your wallet again.')
    return true
  }
  return false
}

function handleError(e: unknown, ctx: Ctx) {
  if (handleAuth(e)) return
  const body = e instanceof ApiError ? e.body : null
  const s = st.status
  if (s && body?.code) {
    if (body.code === 'wallet_age') s.checks.walletAge = { ...s.checks.walletAge, ok: false, readyAt: body.readyAt ?? s.checks.walletAge.readyAt }
    if (body.code === 'sol_balance') s.checks.sol = { ok: false, sol: body.sol ?? 0, minSol: body.minSol ?? s.checks.sol.minSol }
    if (body.code === 'sol_unknown') s.checks.sol = { ...s.checks.sol, ok: null }
    if (body.code === 'budget') s.checks.budget = { ok: false, reopensAt: body.reopensAt ?? s.checks.budget.reopensAt }
    if (body.code === 'credits' && typeof body.balance === 'number') setBalance(body.balance)
  }
  ctx.toast(esc(e instanceof Error ? e.message : 'Something went wrong. Try again.'), 'error')
}

async function send(ctx: Ctx) {
  const s = st.status
  const text = st.draft.trim()
  if (!s || !text || st.busy) return
  st.busy = 'chat'
  const history = st.turns.slice(-s.limits.historyTurns).map(({ role, text }) => ({ role, text }))
  st.turns.push({ role: 'user', text })
  st.draft = ''
  ctx.rerender()
  try {
    const r = await apiFetch('/assistant/chat', { method: 'POST', body: JSON.stringify({ message: text, history }) })
    st.turns.push({ role: 'assistant', text: r.reply, cut: !!r.truncated })
    s.today = r.today
    st.busy = null
    setBalance(r.balance)
  } catch (e) {
    st.turns.pop()
    st.draft = text
    st.busy = null
    handleError(e, ctx)
  }
  ctx.rerender()
  document.getElementById('ai-input')?.focus()
}

async function build(ctx: Ctx) {
  const s = st.status
  if (!s || st.busy) return
  const name = st.name.trim()
  if (!name) { ctx.toast('Give your assistant a name first.', 'error'); document.getElementById('ai-name')?.focus(); return }
  if (st.dataset.trim().length < s.limits.datasetMinChars) {
    ctx.toast(`Add at least ${fmtCount(s.limits.datasetMinChars)} characters of text.`, 'error')
    return
  }
  st.busy = 'profile'
  ctx.rerender()
  try {
    const r = await apiFetch('/assistant/profile', {
      method: 'POST',
      body: JSON.stringify({ name, sourceName: st.source || 'pasted text', text: st.dataset }),
    })
    s.profile = r.profile
    s.today = r.today
    Object.assign(st, { dataset: '', source: '', turns: [], tab: 'chat', showProfile: false, busy: null })
    setBalance(r.balance)
    ctx.toast(`${esc(r.profile.name)} is ready to chat`, 'success')
  } catch (e) {
    st.busy = null
    handleError(e, ctx)
  }
  ctx.rerender()
}

async function removeProfile(ctx: Ctx) {
  const s = st.status
  if (!s || st.busy) return
  if (Date.now() > st.deleteArmedUntil) {
    st.deleteArmedUntil = Date.now() + 4000
    ctx.rerender()
    setTimeout(() => { if (st.deleteArmedUntil && Date.now() > st.deleteArmedUntil) ctx.rerender() }, 4100)
    return
  }
  st.busy = 'delete'
  try {
    await apiFetch('/assistant/profile/delete', { method: 'POST', body: '{}' })
    s.profile = null
    Object.assign(st, { turns: [], showProfile: false, deleteArmedUntil: 0, tab: 'teach' })
    ctx.toast('Profile deleted', 'info')
  } catch (e) {
    handleError(e, ctx)
  }
  st.busy = null
  ctx.rerender()
}

async function readFile(file: File, ctx: Ctx) {
  if (file.size > FILE_MAX_BYTES) { ctx.toast('That file is over 5 MB. Use a smaller text file.', 'error'); return }
  let text: string
  try { text = await file.text() } catch { ctx.toast('Could not read that file.', 'error'); return }
  if (text.includes('\u0000')) { ctx.toast('That file is not plain text. Use .txt, .md, .csv or .json.', 'error'); return }
  const max = st.status?.limits.datasetMaxChars ?? FALLBACK_MAX_CHARS
  if (text.length > max) {
    text = text.slice(0, max)
    ctx.toast(`Only the first ${fmtCount(max)} characters are used.`, 'info')
  }
  st.dataset = text
  st.source = file.name.slice(0, 120)
  if (!st.name.trim()) st.name = file.name.replace(/\.[^.]+$/, '').replace(NAME_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
  ctx.rerender()
}

export function bindAssistant(ctx: Ctx) {
  const root = document.getElementById('ai-root')
  if (!root) return
  syncWallet()
  if (wallet.address && (st.load === 'idle' || (st.load === 'ready' && !st.busy && Date.now() - st.loadedAt > 60_000))) {
    void loadStatus(ctx)
  }
  const on = (sel: string, ev: string, fn: (e: Event, el: HTMLElement) => void) =>
    root.querySelectorAll<HTMLElement>(sel).forEach(el => el.addEventListener(ev, e => fn(e, el)))

  on('[data-ai-connect]', 'click', () => ctx.connect())
  on('[data-ai-retry]', 'click', () => { st.load = 'idle'; ctx.rerender() })
  on('[data-ai-tab]', 'click', (_e, el) => { st.tab = el.dataset.aiTab as 'chat' | 'teach'; ctx.rerender() })
  on('[data-ai-recheck]', 'click', () => void loadStatus(ctx, true))
  on('[data-ai-newchat]', 'click', () => { st.turns = []; ctx.rerender() })
  on('[data-ai-view]', 'click', () => { st.showProfile = !st.showProfile; ctx.rerender() })
  on('[data-ai-delete]', 'click', () => void removeProfile(ctx))
  on('#ai-send', 'click', () => void send(ctx))
  on('#ai-build', 'click', () => void build(ctx))
  on('#ai-input', 'input', (_e, el) => { st.draft = (el as HTMLTextAreaElement).value })
  on('#ai-input', 'keydown', (e) => {
    const k = e as KeyboardEvent
    if (k.key === 'Enter' && !k.shiftKey && !k.isComposing) { e.preventDefault(); void send(ctx) }
  })
  on('#ai-name', 'input', (_e, el) => { st.name = (el as HTMLInputElement).value })
  on('#ai-dataset', 'input', (_e, el) => {
    st.dataset = (el as HTMLTextAreaElement).value
    const count = document.getElementById('ai-count')
    const max = st.status?.limits.datasetMaxChars ?? FALLBACK_MAX_CHARS
    if (count) count.textContent = `${fmtCount(st.dataset.length)} of ${fmtCount(max)} characters`
  })
  on('#ai-file', 'change', (_e, el) => {
    const input = el as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file) void readFile(file, ctx)
  })
  const chat = document.getElementById('ai-chat')
  if (chat) chat.scrollTop = chat.scrollHeight
}

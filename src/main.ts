import './style.css'
import { apiFetch } from './api'
import { storage } from './storage'
import { miner, minerLog, wallet, startMining, stopMining, setIntensity, onMinerTick, onBalanceChange, onNotice, onWalletsChange, listWallets, connectWallet, disconnectWallet, refreshBalance } from './store'
import type { AppId, Wallpaper, WindowInfo, LeaderRow, LogLine } from './types'

// ---------- State ----------
let zCounter = 10
let windows: WindowInfo[] = []
let activeId: string | null = null
const WALLPAPER_KEYS: Wallpaper[] = ['aurora', 'dusk', 'night', 'neon']
const savedWallpaper = storage.get('aetheros:wallpaper') as Wallpaper | null
let wallpaper: Wallpaper = savedWallpaper && WALLPAPER_KEYS.includes(savedWallpaper) ? savedWallpaper : 'aurora'
const prevBounds = new Map<string, {x:number,y:number,w:number,h:number}>()
const WALLS: Record<Wallpaper,string> = {
  aurora: 'linear-gradient(165deg,#ff8cc6 0%,#ffb3da 24%,#ecc4ff 52%,#b9e0ff 80%,#e2f4ff 100%)',
  dusk:   'linear-gradient(170deg,#ff6fb1 0%,#c77de0 40%,#7d8cf0 70%,#8fd3ff 100%)',
  night:  'linear-gradient(165deg,#1a0b2e 0%,#2d1b4e 28%,#1e3a5f 60%,#0f2942 100%)',
  neon:   'linear-gradient(165deg,#0ff0b3 0%,#00d4ff 35%,#7b61ff 65%,#ff6fb1 100%)',
}
function applyWallpaper(w: Wallpaper){
  wallpaper=w
  storage.set('aetheros:wallpaper', w)
  const el=document.getElementById('wallpaper')
  if(el) el.className=`wallpaper wallpaper-${w}`
  // also update CSS var for fallback / body
  document.documentElement.style.setProperty('--wall', WALLS[w])
  document.body.style.background=WALLS[w]
}

const APPS: Record<AppId, { title:string; icon:string }> = {
  miner:{title:'miner.exe', icon:'⛏️'},
  wallet:{title:'wallet.exe', icon:'👛'},
  leaderboard:{title:'leaderboard', icon:'🏆'},
  readme:{title:'readme.txt', icon:'📄'},
  settings:{title:'settings', icon:'⚙️'},
}

const $ = <T extends HTMLElement>(s:string)=> document.querySelector(s) as T | null
const el = (h:string)=>{ const t=document.createElement('template'); t.innerHTML=h.trim(); return t.content.firstElementChild as HTMLElement }
const esc = (s:string)=> s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
const shortAddr = (a:string)=> a.slice(0,4)+'…'+a.slice(-4)

function toast(msg:string, kind:'success'|'info'|'error'='info'){
  const c = document.getElementById('toasts')!
  if(!c) return
  const d = el(`<div class="toast ${kind}">${msg}</div>`)
  c.appendChild(d)
  setTimeout(()=> d.remove(), 2600)
}

function shellHTML(){
  const BLURB:Record<string,string>={
    'miner':'mine credits in this tab',
    'wallet':'connect or disconnect',
    'leaderboard':'top wallets by credits',
    'readme':'how AetherOS works',
    'settings':'wallpaper'
  }
  return `
  <div id="wallpaper" class="wallpaper wallpaper-${wallpaper}"></div>
  <div id="desktop-icons" class="desktop-icons">
    ${Object.entries(APPS).map(([id,v])=>`
      <button type="button" class="desktop-icon" data-open="${id}" aria-label="Open ${v.title}">
        <div class="icon-img" aria-hidden="true">${v.icon}</div><span>${v.title}</span>
      </button>`).join('')}
  </div>
  <div class="desktop-branding">
    <div class="pixel-logo-text">AetherOS</div>
    <div class="pixel-tagline">MINE CREDITS IN YOUR BROWSER<br/>SIGN IN WITH A SOLANA WALLET</div>
    <div class="brand-stats">
      <div class="brand-pill"><span class="dot"></span> <b id="brand-hash">0 H/s</b> hashrate</div>
      <div class="brand-pill">credits <b id="brand-credits">${miner.balance.toFixed(4)}</b></div>
    </div>
  </div>
  <div id="windows-container"></div>
  <div class="mobile-scrim" id="mobile-scrim"></div>
  <div class="mobile-dock-hint" id="mobile-hint">tap icon • swipe ↓ minimize</div>
  <div id="taskbar" class="taskbar">
    <button class="taskbar-start-btn" id="start-btn"><span class="sol-icon">◆</span> AETHEROS</button>
    <div class="taskbar-apps" id="taskbar-apps"></div>
    <div class="taskbar-tray">
      <div class="tray-item" data-open="wallet"><span id="tray-wallet-text">${wallet.address ? shortAddr(wallet.address) : 'no wallet'}</span></div>
      <div class="tray-item" data-open="wallet"><span>credits</span> <span id="tray-credits">${miner.balance.toFixed(4)}</span></div>
      <div class="tray-time" id="tray-time">00:00</div>
    </div>
  </div>
  <div id="start-menu" class="start-menu hidden">
    <div class="start-menu-header"><div class="start-logo">◆ AetherOS</div><div class="start-version">v1.0.0</div></div>
    <div class="start-menu-items">
      ${Object.entries(APPS).map(([id,v])=>`<div class="start-item" data-open="${id}">${v.icon} ${v.title} <small>${BLURB[id]??''}</small></div>`).join('')}
      <div class="start-sep"></div>
      <div class="start-item" id="start-shutdown"><span>⏻</span> shut down <small>stop mining, close everything</small></div>
    </div>
  </div>
  <div id="shutdown-overlay" class="shutdown-overlay hidden">
    <div class="shutdown-card">
      <div class="shutdown-icon">⏻</div>
      <div class="shutdown-title">It is now safe to close this tab.</div>
      <div class="shutdown-sub">Mining stopped · all windows closed</div>
      <button class="btn-pixel btn-green" id="btn-reboot">↻ TURN BACK ON</button>
      <div class="shutdown-hint">Click anywhere to reboot</div>
    </div>
  </div>
  <div id="toasts" style="position:fixed;right:12px;bottom:66px;z-index:90;display:flex;flex-direction:column;gap:8px;pointer-events:none"></div>
  <style>
    .toast{padding:10px 14px;border-radius:10px;background:rgba(17,17,31,.97);border:1px solid rgba(255,255,255,.08);color:white;font-size:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);animation:toastIn .18s ease}
    @keyframes toastIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    .toast.success{border-color:rgba(20,241,149,.4)} .toast.error{border-color:rgba(255,77,106,.45)}
    .taskbar-app.minimized{opacity:.6;border-style:dashed}
    .window.active-win{box-shadow:0 24px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(153,69,255,.22) !important}
    .start-item small{display:block;color:var(--inkSoft);font:400 10px var(--mono);margin-top:2px}
    .start-sep{height:2px;background:var(--line);margin:6px 4px}
  </style>
  `
}

// ---------- Window Manager (fixed) ----------
function openApp(id:AppId){
  const existing = windows.find(w=>w.appId===id)
  if(existing){
    if(existing.minimized){
      existing.minimized=false
      activeId=existing.id
      existing.z=++zCounter
      haptic(20)
      renderWindows()
      toast(`${APPS[id].title} restored`,'info')
    } else {
      focus(existing.id)
      haptic(10)
    }
    return
  }
  const w = Math.min(720, window.innerWidth-24)
  const h = Math.min(520, window.innerHeight-80)
  const x = 84 + (windows.length%6)*28
  const y = 24 + (windows.length%6)*24
  const phone=isPhone()
  const info:WindowInfo = { id:`win-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, appId:id, title:APPS[id].title, icon:APPS[id].icon, x, y, w, h, z: ++zCounter, minimized:false, maximized: phone }
  if(phone) haptic(25)
  windows.push(info)
  activeId=info.id
  renderWindows()
}

function focus(id:string){
  activeId=id
  const win=windows.find(w=>w.id===id)
  if(win) win.z=++zCounter
  // fast path: just sync z without full re-render to avoid losing focus
  syncZ()
}

function closeWin(id:string){
  const w = windows.find(x=>x.id===id)
  windows = windows.filter(x=>x.id!==id)
  if(activeId===id){
    const visible=windows.filter(x=>!x.minimized)
    activeId = visible.length? visible.sort((a,b)=>b.z-a.z)[0].id : null
  }
  renderWindows()
  syncMaximizedClass()
  if(w) toast(`${w.title} closed`,'info')
}

function minimizeWin(id:string){
  const w=windows.find(x=>x.id===id)
  if(!w) return
  w.minimized=true
  const visible=windows.filter(x=>!x.minimized)
  activeId = visible.length? visible.sort((a,b)=>b.z-a.z)[0].id : null
  renderWindows()
  syncMaximizedClass()
  toast(`${w.title} minimized`,'info')
}

function maximizeWin(id:string){
  const w=windows.find(x=>x.id===id)
  if(!w) return
  if(!w.maximized){
    prevBounds.set(id,{x:w.x,y:w.y,w:w.w,h:w.h})
    w.maximized=true
  } else {
    const b=prevBounds.get(id)
    if(b){ w.x=b.x; w.y=b.y; w.w=b.w; w.h=b.h; prevBounds.delete(id) }
    w.maximized=false
  }
  activeId=id
  w.z=++zCounter
  renderWindows()
  syncMaximizedClass()
}

function syncMaximizedClass(){
  const anyMax = windows.some(w=> w.maximized && !w.minimized)
  document.body.classList.toggle('has-maximized', anyMax)
  const hint=document.getElementById('mobile-hint')
  if(hint){
    const phone=window.matchMedia('(max-width:760px)').matches
    hint.style.display = (phone && !anyMax && windows.filter(w=>!w.minimized).length===0) ? 'flex' : 'none'
    const scrim=document.getElementById('mobile-scrim')
    if(scrim) scrim.style.display = (phone && anyMax) ? 'block' : 'none'
  }
}
function doShutdown(){
  if(miner.running) stopMining()
  windows = []
  activeId=null
  renderWindows()
  syncMaximizedClass()
  const ov=document.getElementById('shutdown-overlay')
  if(ov){ ov.classList.remove('hidden'); ov.classList.add('show') }
  toast('AetherOS shut down — click to reboot','info')
  haptic(30)
}
function doReboot(){
  const ov=document.getElementById('shutdown-overlay')
  if(ov){ ov.classList.add('hidden'); ov.classList.remove('show') }
  toast('AetherOS rebooted','success')
  haptic(20)
  setTimeout(()=> openApp('miner'), 120)
}
const isPhone=()=> window.matchMedia('(max-width:760px)').matches
const haptic=(ms:number=18)=> { try{ (navigator as any).vibrate?.(ms) }catch{} }

function syncZ(){
  document.querySelectorAll<HTMLElement>('[data-win-id]').forEach(el=>{
    const w=windows.find(x=>x.id===el.dataset.winId)
    if(w) el.style.zIndex=String(w.z)
    el.classList.toggle('active-win', el.dataset.winId===activeId)
  })
  document.querySelectorAll<HTMLElement>('[data-focus]').forEach(b=>{
    const id=b.dataset.focus!
    const w=windows.find(x=>x.id===id)
    const isActive = id===activeId && !w?.minimized
    b.classList.toggle('active', isActive)
    b.classList.toggle('minimized', !!w?.minimized)
  })
}

let delegationBound=false

function renderWindows(){
  const cont = $('#windows-container')!
  const tray = $('#taskbar-apps')!

  // event delegation for window controls (bound once)
  if(!delegationBound){
    delegationBound=true
    cont.addEventListener('click',(e)=>{
      const target=e.target as HTMLElement
      const closeBtn=target.closest<HTMLElement>('[data-close]')
      if(closeBtn){ e.stopPropagation(); closeWin(closeBtn.dataset.close!); return }
      const minBtn=target.closest<HTMLElement>('[data-min]')
      if(minBtn){ e.stopPropagation(); minimizeWin(minBtn.dataset.min!); return }
      const maxBtn=target.closest<HTMLElement>('[data-max]')
      if(maxBtn){ e.stopPropagation(); maximizeWin(maxBtn.dataset.max!); return }
    })
    // tap anywhere in a window to bring it to the front (needed on mobile)
    const bringFront=(e:Event)=>{
      const winEl=(e.target as HTMLElement).closest<HTMLElement>('[data-win-id]')
      if(!winEl) return
      if((e.target as HTMLElement).closest('.win-controls')) return
      const id=winEl.dataset.winId!
      if(activeId!==id){ haptic(10); activeId=id; const w=windows.find(x=>x.id===id); if(w) w.z=++zCounter; syncZ() }
    }
    cont.addEventListener('pointerdown', bringFront as any)
    cont.addEventListener('touchstart', bringFront as any, {passive:true} as any)
    // focus on mousedown (not click) so controls still work
    cont.addEventListener('mousedown',(e)=>{
      const winEl=(e.target as HTMLElement).closest<HTMLElement>('[data-win-id]')
      if(!winEl) return
      // if clicking controls, don't steal focus separately (close handler already)
      if((e.target as HTMLElement).closest('.win-controls')) return
      const id=winEl.dataset.winId!
      if(activeId!==id){
        activeId=id
        const w=windows.find(x=>x.id===id)
        if(w) w.z=++zCounter
        syncZ()
      }
    })
  }

  // taskbar — show ALL windows (including minimized)
  tray.innerHTML = windows.map(w=>`
    <button class="taskbar-app ${activeId===w.id && !w.minimized ? 'active':''} ${w.minimized?'minimized':''}" data-focus="${w.id}" title="${w.minimized?'Click to restore':'Click to minimize'}">${w.icon} ${w.title}${w.minimized?' ·':''}</button>
  `).join('')
  tray.querySelectorAll('[data-focus]').forEach(b=>{
    b.addEventListener('click',()=>{
      const id=(b as HTMLElement).dataset.focus!
      const win=windows.find(x=>x.id===id)!
      if(win.minimized){
        win.minimized=false
        activeId=id
        win.z=++zCounter
        renderWindows()
      } else if(activeId===id){
        minimizeWin(id)
      } else {
        focus(id)
      }
    })
  })

  // remove old windows and recreate visible ones
  // keep container listeners, so only clear window elements
  cont.querySelectorAll('[data-win-id]').forEach(e=>e.remove())

  for(const w of windows){
    if(w.minimized) continue
    const isMax=w.maximized
    const wrap=document.createElement('div')
    wrap.className=`window ${isMax?'maximized':''} ${activeId===w.id?'active-win':''}`
    wrap.style.left=w.x+'px'
    wrap.style.top=w.y+'px'
    wrap.style.width=w.w+'px'
    wrap.style.height=w.h+'px'
    wrap.style.zIndex=String(w.z)
    wrap.dataset.winId=w.id
    wrap.setAttribute('role','dialog')
    wrap.setAttribute('aria-label',w.title)
    wrap.innerHTML=`
      <div class="window-header" data-drag="${w.id}">
        <div class="win-title">${w.icon} ${w.title}</div>
        <div class="win-controls">
          <button class="win-btn" data-min="${w.id}" title="Minimize" aria-label="Minimize">—</button>
          <button class="win-btn" data-max="${w.id}" title="${isMax?'Restore':'Maximize'}" aria-label="${isMax?'Restore':'Maximize'}">${isMax?'❐':'□'}</button>
          <button class="win-btn close" data-close="${w.id}" title="Close" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="window-body">${appBody(w.appId)}</div>
    `
    cont.appendChild(wrap)
  }

  enableDrag()
  bindAppEvents()
  refreshTray()
}

function enableDrag(){
  document.querySelectorAll<HTMLElement>('[data-drag]').forEach(h=>{
    const id=h.dataset.drag!
    const win=windows.find(x=>x.id===id)!
    if(!win) return
    let sx=0, sy=0, ox=0, oy=0, dragging=false, swipeStartY=0, swipeDy=0
    h.addEventListener('dblclick',(e)=>{
      if((e.target as HTMLElement).closest('.win-controls')) return
      haptic(15); maximizeWin(id)
    })
    // swipe down to minimize on phone
    h.addEventListener('touchstart',(e:TouchEvent)=>{
      if(!isPhone()) return
      swipeStartY=e.touches[0].clientY; swipeDy=0
    },{passive:true})
    h.addEventListener('touchmove',(e:TouchEvent)=>{
      if(!isPhone()) return
      swipeDy=e.touches[0].clientY - swipeStartY
      if(swipeDy>0){
        const el=document.querySelector<HTMLElement>(`[data-win-id="${id}"]`)
        if(el){ el.style.transform=`translateY(${Math.min(swipeDy,180)}px)`; el.style.opacity=String(1 - Math.min(swipeDy/260, .35)) }
      }
    },{passive:true})
    h.addEventListener('touchend',()=>{
      const el=document.querySelector<HTMLElement>(`[data-win-id="${id}"]`)
      if(el){ el.style.transform=''; el.style.opacity='' }
      if(swipeDy>90){ haptic(18); minimizeWin(id); return }
      if(swipeDy>40){ haptic(10); if(el){ el.classList.add('shake'); setTimeout(()=>el.classList.remove('shake'),300)} }
      swipeDy=0
    })
    const onDown=(e:PointerEvent)=>{
      if(win.maximized && !isPhone()) return
      if(isPhone()) return // phone uses swipe, not drag
      if((e.target as HTMLElement).closest('.win-controls')) return
      dragging=true; sx=e.clientX; sy=e.clientY; ox=win.x; oy=win.y
      h.setPointerCapture(e.pointerId)
      if(activeId!==id){ activeId=id; win.z=++zCounter; syncZ() }
      e.preventDefault()
    }
    const onMove=(e:PointerEvent)=>{
      if(!dragging) return
      win.x=Math.max(0, ox + e.clientX - sx)
      win.y=Math.max(0, oy + e.clientY - sy)
      const el=document.querySelector<HTMLElement>(`[data-win-id="${id}"]`)
      if(el){ el.style.left=win.x+'px'; el.style.top=win.y+'px' }
    }
    const onUp=()=>{ dragging=false }
    h.addEventListener('pointerdown', onDown)
    h.addEventListener('pointermove', onMove)
    h.addEventListener('pointerup', onUp)
    h.addEventListener('pointercancel', onUp)
  })
}

// ---------- App Bodies ----------
let leaderRows: LeaderRow[] = []
let leaderState: 'idle' | 'loading' | 'ready' | 'error' = 'idle'
let leaderLoadedAt = 0

const logLineHTML = (l: LogLine) =>
  `<div class="log-line"><span class="log-time">${new Date(l.at).toLocaleTimeString()}</span> &gt; ${l.kind === 'ok' ? '<span style="color:#14F195">' : l.kind === 'error' ? '<span style="color:#ff4d6a">' : '<span>'}${esc(l.text)}</span></div>`

function minerBody(): string {
  const connected = !!wallet.address
  const lines = minerLog.length
    ? minerLog.map(logLineHTML).join('')
    : `<div class="log-line"><span class="log-time">${new Date().toLocaleTimeString()}</span> &gt; ${connected ? 'ready. Press START.' : 'ready. Connect a wallet to start.'}</div>`
  return `
    <div class="cherry-app">
      <div class="cherry-app-head">
        <div class="cherry-kicker"><span class="ck-dot"></span> MINER · hashes in a background thread of this tab</div>
        <div class="cherry-actions">
          ${connected
            ? `<button class="ck-btn ${miner.running ? 'ck-btn--stop' : 'ck-btn--go'}" id="btn-mining">${miner.running ? '■ STOP' : '▶ START'}</button>`
            : `<button class="ck-btn ck-btn--go" id="btn-open-wallet">CONNECT WALLET</button>`}
          <label class="ck-field"><span>INTENSITY</span><input type="range" id="intensity" min="1" max="100" value="${miner.intensity}" aria-label="Mining intensity"/><b id="intensity-val">${miner.intensity}%</b></label>
        </div>
      </div>
      <div class="ck-card ck-terminal">
        <div class="ck-card-head">miner.exe · ${miner.running ? 'mining' : 'idle'} · ${wallet.address ? shortAddr(wallet.address) : 'no wallet'}</div>
        <div class="ck-stats">
          <div><span>hashrate</span><b class="t-green" id="m-hashrate">${miner.hashrate} H/s</b></div>
          <div><span>shares found</span><b id="m-found">${miner.found}</b></div>
          <div><span>accepted</span><b class="t-green" id="m-accepted">${miner.accepted}</b></div>
          <div><span>balance</span><b class="t-sol" id="m-balance">${miner.balance.toFixed(4)} cr</b></div>
          <div><span>session</span><b class="t-sol" id="m-session">+${miner.session.toFixed(4)} cr</b></div>
          <div><span>uptime</span><b id="m-uptime">00:00:00</b></div>
          <div><span>status</span><b class="${miner.running ? 't-green' : 't-yellow'}" id="m-status">${miner.running ? 'mining' : 'stopped'}</b></div>
          <div><span>reward</span><b id="m-reward">${miner.creditsPerShare === null ? '—' : miner.creditsPerShare + ' cr / share'}</b></div>
        </div>
        <div class="ck-progress"><div id="m-progress" style="width:${miner.running ? miner.intensity + '%' : '0%'}"></div></div>
        <div class="ck-log" id="miner-log">${lines}</div>
      </div>
      <div class="ck-desc">Each accepted share adds credits to your balance. Credits set your place on the leaderboard.</div>
    </div>`
}

function walletBody(): string {
  if (wallet.address) {
    return `
    <div class="cherry-app">
      <div class="ck-card" style="text-align:center">
        <div class="ck-icon">◆</div>
        <div class="ck-title">Wallet connected</div>
        <div class="ck-status"><b>${esc(wallet.walletName ?? 'Wallet')}</b> · <span class="ck-mono">${esc(wallet.address.slice(0, 6))}…${esc(wallet.address.slice(-6))}</span></div>
        <div class="ck-grid2" style="margin-top:10px;text-align:left">
          <div class="ck-mini"><span>credits</span><b class="t-sol">${miner.balance.toFixed(4)}</b></div>
          <div class="ck-mini"><span>this session</span><b>+${miner.session.toFixed(4)}</b></div>
        </div>
        <button class="ck-btn ck-btn--stop" id="btn-disconnect" style="margin-top:10px">DISCONNECT</button>
      </div>
    </div>`
  }
  const wallets = listWallets()
  return `
    <div class="cherry-app">
      <div class="ck-card" style="text-align:center">
        <div class="ck-icon">◆</div>
        <div class="ck-title">Connect wallet</div>
        <div class="ck-desc">You sign one message to sign in. No transaction is sent and nothing is charged.</div>
        ${wallets.length
          ? `<div class="ck-row" style="justify-content:center;flex-wrap:wrap;margin-top:8px">${wallets.map(w =>
              `<button class="ck-btn ck-btn--go" data-connect="${esc(w.name)}">${w.icon.startsWith('data:image/') ? `<img src="${esc(w.icon)}" alt="" width="18" height="18"/>` : ''}${esc(w.name)}</button>`).join('')}</div>`
          : `<div class="ck-status"><span class="ck-muted">No Solana wallet found in this browser.</span></div>
             <div class="ck-hint">Install one from the <a href="https://solana.com/solana-wallets" target="_blank" rel="noopener noreferrer">wallet directory</a>, or open this page in the browser built into your wallet app.</div>`}
      </div>
    </div>`
}

function leaderboardTable(): string {
  const head = `<div class="lb-header"><span>#</span><span>WALLET</span><span>SHARES</span><span>CREDITS</span></div>`
  if (leaderState === 'error') return head + `<div class="lb-loading" style="color:#c0264a">Could not load the leaderboard. Press refresh to try again.</div>`
  if (leaderState !== 'ready') return head + `<div class="lb-loading">Loading leaderboard…</div>`
  if (!leaderRows.length) return head + `<div class="lb-loading">No miners yet. Connect a wallet and press START to be first.</div>`
  const me = wallet.address ? shortAddr(wallet.address) : null
  return head + leaderRows.map(r => `
      <div class="lb-row ${r.address === me ? 'me' : ''}">
        <span>${r.rank}</span>
        <span class="lb-addr">${esc(r.address)}${r.address === me ? ' (you)' : ''}</span>
        <span>${r.shares.toLocaleString()}</span>
        <span class="t-sol">${r.credits.toFixed(2)} cr</span>
      </div>`).join('')
}

function appBody(id: AppId): string {
  if (id === 'miner') return minerBody()
  if (id === 'wallet') return walletBody()
  if (id === 'leaderboard') return `
    <div class="app-content">
      <div class="ck-row" style="margin-bottom:8px"><span class="ck-hint">Top wallets by credits</span><button class="ck-btn ck-btn--ghost ck-btn--sm" id="btn-refresh-lb" style="margin-left:auto">↻ Refresh</button></div>
      <div class="lb-table lb4" id="lb-table">${leaderboardTable()}</div>
    </div>`
  if (id === 'readme') return `
    <div class="app-content" style="padding:0">
      <div class="readme-toolbar">
        <span class="readme-path">C:\\AetherOS\\readme.txt</span>
        <button class="btn-pixel btn-sm" id="btn-copy-readme">⧉ Copy</button>
      </div>
      <pre class="readme-pre">AetherOS
========

Mine credits in your browser and see where you rank.

HOW IT WORKS

1. Connect a Solana wallet in wallet.exe. You sign one message to
   sign in. No transaction is sent and nothing is charged.

2. Press START in miner.exe. Your browser hashes on the CPU in a
   background thread until it finds a hash that meets the target.
   INTENSITY sets how much of each moment is spent hashing.

3. The server checks every share. Each accepted share adds credits
   to your balance. The reward per share and the wait between
   shares are set by the server and shown in miner.exe.

4. leaderboard ranks wallets by credits.

THE APPS

miner.exe     start and stop mining
wallet.exe    connect or disconnect your wallet
leaderboard   top wallets by credits
settings      wallpaper
readme.txt    this file

GOOD TO KNOW

Credits are a score kept by this site. They are not a token and
cannot be exchanged.
Mining stops when you close the tab.

WHAT THE SERVER STORES

Your wallet address, your credit balance and your accepted shares.
Nothing else about you or your computer is sent.</pre>
    </div>`
  return `
    <div class="app-content">
      <div class="settings-sections">
        <div class="settings-section"><div class="ss-title">WALLPAPER (Pick a theme)</div><div class="wallpaper-options">
          ${(['aurora', 'dusk', 'night', 'neon'] as Wallpaper[]).map(w => `<div class="wp-opt ${wallpaper === w ? 'active' : ''}" data-wp="${w}" role="button" tabindex="0" aria-label="Wallpaper ${w}"><div class="wp-swatch"></div><div class="wp-label">${w}${wallpaper === w ? ' ✓' : ''}</div></div>`).join('')}
        </div></div>
        <div class="settings-section"><div class="ss-title">ABOUT</div><div class="about-box"><div class="about-logo">◆ AetherOS</div><div class="about-ver">v1.0.0</div><div class="about-desc">Mine credits in your browser with a Solana wallet.</div></div></div>
      </div>
    </div>`
}

async function loadLeaderboard() {
  if (leaderState === 'loading') return
  leaderState = 'loading'
  try {
    const data = await apiFetch('/leaderboard?limit=100')
    leaderRows = data.leaderboard as LeaderRow[]
    leaderState = 'ready'
    leaderLoadedAt = Date.now()
  } catch {
    leaderState = 'error'
  }
  const table = document.getElementById('lb-table')
  if (table) table.innerHTML = leaderboardTable()
}

async function doConnect(name: string) {
  try {
    toast('Check your wallet to sign in','info')
    await connectWallet(name)
    toast('Wallet connected','success')
  } catch (e: any) {
    toast(esc(String(e?.message ?? 'Could not connect the wallet').slice(0, 140)), 'error')
  }
  renderWindows()
}

function bindAppEvents(){
  $('#btn-mining')?.addEventListener('click', ()=>{
    if(miner.running){ stopMining(); toast('Mining stopped','info') }
    else { void startMining() }
    renderWindows()
  })
  $('#btn-open-wallet')?.addEventListener('click', ()=>{
    const list = listWallets()
    if(list.length === 1){ void doConnect(list[0].name); return }
    openApp('wallet'); renderWindows()
  })
  document.querySelectorAll('[data-connect]').forEach(b=> b.addEventListener('click', ()=> void doConnect((b as HTMLElement).dataset.connect!)))
  $('#btn-disconnect')?.addEventListener('click', async()=>{ await disconnectWallet(); toast('Disconnected','info'); renderWindows() })
  $('#intensity')?.addEventListener('input',(e)=>{
    const v=Number((e.target as HTMLInputElement).value)
    setIntensity(v)
    const a=$('#intensity-val'); if(a) a.textContent=v+'%'
    const p=$('#m-progress'); if(p && miner.running) p.style.width=v+'%'
  })
  $('#btn-refresh-lb')?.addEventListener('click', ()=>{ const t=$('#lb-table'); leaderState='idle'; if(t) t.innerHTML=leaderboardTable(); void loadLeaderboard() })
  if(document.getElementById('lb-table') && (leaderState==='idle' || Date.now()-leaderLoadedAt>15000)) void loadLeaderboard()
  document.querySelectorAll('[data-wp]').forEach(b=> {
    const pick=()=>{ const w=(b as HTMLElement).dataset.wp as Wallpaper; applyWallpaper(w); toast(`Wallpaper: ${w}`,'success'); renderWindows() }
    b.addEventListener('click', pick)
    b.addEventListener('keydown',(e)=>{ if((e as KeyboardEvent).key==='Enter' || (e as KeyboardEvent).key===' '){ e.preventDefault(); pick() } })
  })
  $('#btn-copy-readme')?.addEventListener('click', async()=>{
    const txt=(document.querySelector('.readme-pre') as HTMLElement | null)?.textContent ?? ''
    try{ await navigator.clipboard.writeText(txt); toast('readme.txt copied','success') }catch{ toast('Select the text and copy it manually','info') }
  })
  $('#start-shutdown')?.addEventListener('click',()=>{
    const sm=$('#start-menu'); if(sm) sm.classList.add('hidden')
    doShutdown()
  })
  $('#btn-reboot')?.addEventListener('click',()=> doReboot())
  $('#shutdown-overlay')?.addEventListener('click',(e)=>{
    if((e.target as HTMLElement).id==='shutdown-overlay') doReboot()
  })
}

function refreshTray(){
  const set=(id:string,v:string)=>{ const e=document.getElementById(id); if(e) e.textContent=v }
  set('tray-credits', miner.balance.toFixed(4)); set('brand-credits', miner.balance.toFixed(4))
  set('brand-hash', miner.hashrate? `${miner.hashrate} H/s`:'0 H/s')
  set('tray-wallet-text', wallet.address ? shortAddr(wallet.address) : 'no wallet')
}
onMinerTick((m, uptime)=>{
  const set=(id:string,v:string)=>{ const e=document.getElementById(id); if(e) e.textContent=v }
  set('m-hashrate', `${m.hashrate} H/s`); set('m-found', `${m.found}`); set('m-accepted', `${m.accepted}`)
  set('m-session', `+${m.session.toFixed(4)} cr`); set('m-balance', `${m.balance.toFixed(4)} cr`); set('m-uptime', uptime)
  set('m-status', m.running?'mining':'stopped')
  set('m-reward', m.creditsPerShare===null ? '—' : `${m.creditsPerShare} cr / share`)
  const prog=document.getElementById('m-progress'); if(prog) prog.style.width= m.running? (m.intensity+'%') : '0%'
  refreshTray()
})
onBalanceChange(()=>{
  refreshTray()
  // keep the open windows in step with wallet and balance changes
  if(windows.some(w=>w.appId==='wallet' || w.appId==='miner')) renderWindows()
})
onNotice((line)=>{
  const log=document.getElementById('miner-log')
  if(log){ log.insertAdjacentHTML('beforeend', logLineHTML(line)); log.scrollTop=log.scrollHeight }
  if(line.kind==='error') toast(esc(line.text),'error')
})
onWalletsChange(()=>{ if(windows.some(w=>w.appId==='wallet')) renderWindows() })

function boot(){
  const app=document.getElementById('app')!
  app.innerHTML=shellHTML()
  // click to open (single tap on phones, click or double click on desktop)
  app.addEventListener('click',(e)=>{
    const t=e.target as HTMLElement
    const open=t.closest<HTMLElement>('[data-open]')?.dataset.open
    if(open){ if(isPhone()) haptic(18); openApp(open as AppId) }
  })
  // long-press on desktop icon = select + haptic
  let pressTimer:any=null
  app.addEventListener('touchstart',(e)=>{
    const icon=(e.target as HTMLElement).closest<HTMLElement>('.desktop-icon')
    if(!icon) return
    icon.classList.add('sel')
    pressTimer=setTimeout(()=>{ haptic(30); icon.classList.add('sel') }, 420)
  },{passive:true})
  app.addEventListener('touchend',()=>{
    clearTimeout(pressTimer)
    setTimeout(()=> document.querySelectorAll('.desktop-icon.sel').forEach(el=>el.classList.remove('sel')), 700)
  },{passive:true})
  // scrim tap → minimize top window (phone)
  document.getElementById('mobile-scrim')?.addEventListener('click',()=>{
    if(!isPhone()) return
    haptic(16)
    const top=[...windows].filter(w=>!w.minimized).sort((a,b)=>b.z-a.z)[0]
    if(top) minimizeWin(top.id)
  })
  const obs=new MutationObserver(()=> syncMaximizedClass())
  obs.observe(app, {childList:true, subtree:true})
  setTimeout(()=>{ const h=document.getElementById('mobile-hint'); if(h) h.style.opacity='0'; setTimeout(()=>{ if(h) h.style.display='none'}, 400) }, 5000)
  $('#start-btn')!.addEventListener('click',(e)=>{
    e.stopPropagation(); haptic(12)
    $('#start-menu')!.classList.toggle('hidden')
  })
  document.addEventListener('click',(e)=>{
    const sm=$('#start-menu')!, btn=$('#start-btn')!
    if(!sm.contains(e.target as Node) && !btn.contains(e.target as Node)) sm.classList.add('hidden')
  })
  setInterval(()=>{
    const s=new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
    const e=document.getElementById('tray-time'); if(e) e.textContent=s
  },1000)
  // One window on start: the miner explains itself and has the Connect button.
  openApp('miner')
  applyWallpaper(wallpaper)
  void refreshBalance()
  syncMaximizedClass()
  window.addEventListener('resize', syncMaximizedClass)
  window.addEventListener('beforeunload',()=>{ if(miner.running) stopMining() })
}
boot()

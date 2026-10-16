import './style.css'
import { apiFetch } from './api'
import { miner, wallet, startMining, stopMining, setIntensity, onMinerTick, onBalanceChange, setWallet, disconnectWallet, setNetwork, rpcFor, walletBalanceString, solanaString, connectPhantom, hasPhantom, providerLabel } from './store'
import { datasets, models, jobs, addDataset, addModel, addJob, updateJob, findDatasetByName, onPipelineChange, removeModel } from './pipeline'
import type { AppId, Wallpaper, Network, WindowInfo } from './types'

// ---------- State ----------
let zCounter = 10
let windows: WindowInfo[] = []
let activeId: string | null = null
let wallpaper: Wallpaper = (localStorage.getItem('solanaos:wallpaper') as Wallpaper) ?? 'aurora'
const prevBounds = new Map<string, {x:number,y:number,w:number,h:number}>()
const WALLS: Record<Wallpaper,string> = {
  aurora: 'linear-gradient(165deg,#ff8cc6 0%,#ffb3da 24%,#ecc4ff 52%,#b9e0ff 80%,#e2f4ff 100%)',
  dusk:   'linear-gradient(170deg,#ff6fb1 0%,#c77de0 40%,#7d8cf0 70%,#8fd3ff 100%)',
  night:  'linear-gradient(165deg,#1a0b2e 0%,#2d1b4e 28%,#1e3a5f 60%,#0f2942 100%)',
  neon:   'linear-gradient(165deg,#0ff0b3 0%,#00d4ff 35%,#7b61ff 65%,#ff6fb1 100%)',
}
function applyWallpaper(w: Wallpaper){
  wallpaper=w
  localStorage.setItem('solanaos:wallpaper', w)
  const el=document.getElementById('wallpaper')
  if(el) el.className=`wallpaper wallpaper-${w}`
  // also update CSS var for fallback / body
  document.documentElement.style.setProperty('--wall', WALLS[w])
  document.body.style.background=WALLS[w]
}

const APPS: Record<AppId, { title:string; icon:string }> = {
  miner:{title:'miner.exe', icon:'⛏️'},
  wallet:{title:'wallet.exe', icon:'👛'},
  train:{title:'train.exe', icon:'🤖'},
  datasets:{title:'datasets', icon:'📁'},
  models:{title:'models', icon:'🧠'},
  sysinfo:{title:'sysinfo', icon:'🖥️'},
  taskmgr:{title:'taskmgr', icon:'📊'},
  network:{title:'network', icon:'🌐'},
  leaderboard:{title:'leaderboard', icon:'🏆'},
  readme:{title:'readme.txt', icon:'📄'},
  trash:{title:'recycle bin', icon:'🗑️'},
  settings:{title:'settings', icon:'⚙️'},
}

const $ = <T extends HTMLElement>(s:string)=> document.querySelector(s) as T | null
const el = (h:string)=>{ const t=document.createElement('template'); t.innerHTML=h.trim(); return t.content.firstElementChild as HTMLElement }

function toast(msg:string, kind:'success'|'info'|'error'='info'){
  const c = document.getElementById('toasts')!
  if(!c) return
  const d = el(`<div class="toast ${kind}">${msg}</div>`)
  c.appendChild(d)
  setTimeout(()=> d.remove(), 2600)
}

function shellHTML(){
  const BLURB:Record<string,string>={
    'miner':'mine credits with your GPU',
    'train':'train locally or on the network',
    'datasets':'import and preview data',
    'models':'your models, with a chat',
    'sysinfo':'your machine, measured',
    'taskmgr':'live hashrates',
    'network':'training nodes',
    'leaderboard':'top miners',
    'wallet':'address, credits, credits',
    'readme':'how AetherOS works',
    'trash':'deleted things',
    'settings':'wallpaper and options'
  }
  return `
  <div id="wallpaper" class="wallpaper wallpaper-${wallpaper}"></div>
  <div id="desktop-icons" class="desktop-icons">
    ${Object.entries(APPS).map(([id,v])=>`
      <div class="desktop-icon" data-open="${id}">
        <div class="icon-img">${v.icon}</div><span>${v.title}</span>
      </div>`).join('')}
  </div>
  <div class="desktop-branding">
    <div class="pixel-logo-text">AetherOS</div>
    <div class="pixel-tagline">MINE CREDITS WITH GPU<br/>TRAIN AI ON SOLANA</div>
    <div class="brand-stats">
      <div class="brand-pill"><span class="dot"></span> <b id="brand-hash">0 H/s</b> hashrate</div>
      <div class="brand-pill">◎ <b id="brand-sol">${walletBalanceString()}</b></div>
      <div class="brand-pill">credits <b id="brand-solana">${solanaString()}</b></div>
    </div>
  </div>
  <div id="windows-container"></div>
  <div class="mobile-scrim" id="mobile-scrim"></div>
  <div class="mobile-dock-hint" id="mobile-hint">tap icon • swipe ↓ minimize</div>
  <div id="taskbar" class="taskbar">
    <button class="taskbar-start-btn" id="start-btn"><span class="sol-icon">◎</span> SOLANA</button>
    <div class="taskbar-apps" id="taskbar-apps"></div>
    <div class="taskbar-tray">
      <div class="tray-item tray-balance" data-open="wallet"><span class="sol-icon">◎</span> <span id="tray-sol">${walletBalanceString()}</span></div>
      <div class="tray-item" data-open="wallet"><span id="tray-wallet-text">${wallet.address ? wallet.address.slice(0,4)+'…'+wallet.address.slice(-4) : 'no wallet'}</span></div>
      <div class="tray-item" data-open="wallet"><span>credits</span> <span id="tray-solana">${solanaString()}</span></div>
      <div class="tray-item tray-network"><span class="net-dot"></span><span id="tray-net">${wallet.network}</span></div>
      <div class="tray-time" id="tray-time">00:00</div>
    </div>
  </div>
  <div id="start-menu" class="start-menu hidden">
    <div class="start-menu-header"><div class="start-logo">◎ AetherOS</div><div class="start-version">v1.0.0 • TS</div></div>
    <div class="start-menu-items">
      ${Object.entries(APPS).map(([id,v])=>`<div class="start-item" data-open="${id}">${v.icon} ${v.title} <small>${BLURB[id]??''}</small></div>`).join('')}
      <div class="start-sep"></div>
      <a class="start-item" href="https://robinhoodchain.blockscout.com/token/0x95F804A36202E4F7E058dF393a9cB42A15F8FB23" target="_blank" style="text-decoration:none;color:inherit"><span>◈</span> credits on Blockscout <small>view token 0x95F8…FB23</small></a>
      <div class="start-item" id="start-shutdown"><span>⏻</span> shut down <small>stop mining, close everything</small></div>
    </div>
  </div>
  <!-- Shutdown overlay ala cherryOS -->
  <div id="shutdown-overlay" class="shutdown-overlay hidden">
    <div class="shutdown-card">
      <div class="shutdown-icon">⏻</div>
      <div class="shutdown-title">It is now safe to close this tab.</div>
      <div class="shutdown-sub">Mining stopped • all windows closed</div>
      <button class="btn-pixel btn-green" id="btn-reboot">↻ TURN BACK ON — click to reboot</button>
      <div class="shutdown-hint">AetherOS • cherryOS inspired • click anywhere to reboot</div>
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
  toast(`${w.title} minimized — klik di taskbar untuk restore`,'info')
}

function maximizeWin(id:string){
  const w=windows.find(x=>x.id===id)
  if(!w) return
  if(!w.maximized){
    prevBounds.set(id,{x:w.x,y:w.y,w:w.w,h:w.h})
    w.maximized=true
    toast(`${w.title} maximized — semua fitur terlihat`,'success')
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
  // reopen like cherryOS first visit
  setTimeout(()=>{ openApp('readme'); setTimeout(()=> openApp('miner'), 180) }, 120)
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
    // tap anywhere in window → bring to front (fixes "isi di belakang" on mobile)
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
    <button class="taskbar-app ${activeId===w.id && !w.minimized ? 'active':''} ${w.minimized?'minimized':''}" data-focus="${w.id}" title="${w.minimized?'Klik untuk restore':'Klik untuk minimize'}">${w.icon} ${w.title}${w.minimized?' •':''}</button>
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
    wrap.innerHTML=`
      <div class="window-header" data-drag="${w.id}">
        <div class="win-title">${w.icon} ${w.title} ${isMax?'<span style="opacity:.5;font-size:10px;margin-left:6px">[MAXIMIZED — semua fitur terlihat]</span>':''}</div>
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
function appBody(id:AppId): string {
  if(id==='miner') return `
    <div class="cherry-app">
      <div class="cherry-app-head">
        <div class="cherry-kicker"><span class="ck-dot"></span> MINER • GPU → credits • 2^34 hashes = 1 cr</div>
        <div class="cherry-actions">
          <button class="ck-btn ${miner.running?'ck-btn--stop':'ck-btn--go'}" id="btn-mining">${miner.running?'■ STOP':'▶ START'}</button>
          <label class="ck-field"><span>INTENSITY</span><input type="range" id="intensity" min="1" max="100" value="${miner.intensity}"/><b id="intensity-val">${miner.intensity}%</b></label>
        </div>
      </div>
      <div class="ck-card ck-terminal">
        <div class="ck-card-head">miner.exe — ${miner.running?'mining':'idle'} • ${wallet.address ? wallet.address.slice(0,4)+'…'+wallet.address.slice(-4) : 'no wallet'}</div>
        <div class="ck-stats">
          <div><span>hashrate</span><b class="t-green" id="m-hashrate">${miner.hashrate} H/s</b></div>
          <div><span>shares</span><b id="m-shares">${miner.shares}</b></div>
          <div><span>accepted</span><b class="t-green" id="m-accepted">${miner.accepted}</b></div>
          <div><span>balance</span><b class="t-sol" id="m-balance">${miner.balance.toFixed(4)} cr</b></div>
          <div><span>session</span><b class="t-sol" id="m-session">+${miner.session.toFixed(4)}</b></div>
          <div><span>uptime</span><b id="m-uptime">00:00:00</b></div>
          <div><span>status</span><b class="${miner.running?'t-green':'t-yellow'}" id="m-status">${miner.running?'mining':'stopped'}</b></div>
          <div><span>backend</span><b id="m-backend">${miner.running?'webgpu':'idle'}</b></div>
        </div>
        <div class="ck-progress"><div id="m-progress" style="width:${miner.running?miner.intensity+'%':'0%'}"></div></div>
        <div class="ck-log" id="miner-log"><div class="ck-log-line"><span>${new Date().toLocaleTimeString()}</span> &gt; ready. ${wallet.address?'address set — start mining.':'connect wallet dulu.'}</div></div>
      </div>
      <div class="ck-row">
        <input class="ck-input" id="credit-addr" placeholder="credit address (Solana / 0x)" value="${wallet.address??''}"/>
        <button class="ck-btn ck-btn--ghost" id="use-addr">USE</button>
        <span class="ck-hint" style="margin-left:auto">credits → train.exe / network.exe</span>
      </div>
    </div>`
  if(id==='wallet') return `
    <div class="cherry-app">
      <div class="cherry-tabs">
        <button class="ck-tab ${walletTab==='connect'?'on':''}" data-wtab="connect">CONNECT</button>
        <button class="ck-tab ${walletTab==='solana'?'on':''}" data-wtab="solana">credits</button>
      </div>
      ${walletTab==='connect'?`
      <div class="ck-card" style="text-align:center">
        <div class="ck-icon">◎</div>
        <div class="ck-title">Connect Wallet</div>
        <div class="ck-desc">Phantom & MetaMask auto-detected</div>
        <div class="ck-status">${wallet.address ? `<b>${providerLabel()}</b> • <span class="ck-mono">${wallet.address.slice(0,6)}…${wallet.address.slice(-6)}</span>` : `<span class="ck-muted">not connected</span>`}</div>
        <div class="ck-row" style="justify-content:center">
          <button class="ck-btn ck-btn--go" id="btn-phantom">🔗 Connect Wallet</button>
        </div>
        <div class="ck-hint" id="wallet-detect">Wallet standard auto-detected</div>
        <div class="ck-row" style="margin-top:10px">
          <input class="ck-input" id="manual-addr" placeholder="paste address..." value="${wallet.address??''}" style="flex:1"/>
          <button class="ck-btn ck-btn--ghost" id="btn-set-manual">SET</button>
        </div>
        ${wallet.address?`<div class="ck-grid2" style="margin-top:10px;text-align:left">
          <div class="ck-mini"><span>SOL</span><b>${wallet.sol.toFixed(3)}</b></div>
          <div class="ck-mini"><span>credits</span><b class="t-sol">${wallet.solana.toFixed(2)}</b></div>
          <div class="ck-mini"><span>network</span><b>${wallet.network}</b></div>
          <div class="ck-mini"><span>chain</span><b>${wallet.chain??'—'}</b></div>
        </div><button class="ck-btn ck-btn--stop" id="btn-disconnect" style="margin-top:10px">DISCONNECT</button>`:''}
      </div>` : ''}
      ${walletTab==='solana'?`
      <div class="ck-card ck-dark">
        <div class="ck-kicker" style="color:var(--mint)"><span class="ck-dot"></span> LIVE ON ROBINHOOD CHAIN</div>
        <div class="ck-title" style="color:#fff">Buy <span style="color:var(--pink)">credits</span></div>
        <div class="ck-desc" style="color:var(--termDim)">Mine → credits. Hold credits to use network training & chat.</div>
        <div class="ck-row" style="margin-top:8px">
          <span class="ck-pill"><span>CA</span><span class="ck-mono" style="font-size:10px">0x95F804…FB23</span></span>
          <button class="ck-btn ck-btn--sm" id="btn-copy-ca">Copy</button>
          <button class="ck-btn ck-btn--ghost ck-btn--sm" id="btn-view-ca">Explorer</button>
        </div>
        <div class="ck-grid2" style="margin-top:10px">
          <div class="ck-mini ck-mini--light"><span>YOUR credits</span><b class="t-sol">${wallet.solana.toFixed(2)}</b></div>
          <div class="ck-mini ck-mini--light"><span>MINED</span><b>${miner.balance.toFixed(4)} cr</b></div>
        </div>
      </div>
      <div class="ck-grid2">
        <a class="ck-card ck-link" href="https://robinhoodchain.blockscout.com/token/0x95F804A36202E4F7E058dF393a9cB42A15F8FB23" target="_blank"><b>◈ Blockscout</b><span>explorer • verified</span><span class="ck-btn ck-btn--go ck-btn--sm" style="margin-top:6px">BUY ↗</span></a>
        <a class="ck-card ck-link" href="https://ponsfamily.com/launchpad/0x0a98d11e3ba97b01100a55e4078a9782185467a4" target="_blank"><b>🚀 Launchpad</b><span>presale • earliest price</span><span class="ck-btn ck-btn--go ck-btn--sm" style="margin-top:6px">BUY ↗</span></a>
      </div>
      <div class="ck-row"><button class="ck-btn ck-btn--ghost ck-btn--sm" id="btn-add-token">+ Add to Wallet</button><button class="ck-btn ck-btn--ghost ck-btn--sm" id="btn-explorer">Explorer</button><button class="ck-btn ck-btn--ghost ck-btn--sm" id="btn-launchpad-go">Launchpad</button></div>` : ''}
    </div>`
  if(id==='train'){
    const dsOptions = datasets.map(d=>`<option value="${d.id}" ${d.name===pendingDatasetName?'selected':''}>${d.name}</option>`).join('')
    const selDs = findDatasetByName(pendingDatasetName) ?? datasets[0]
    const activeJobs = jobs.filter(j=>j.status!=='done')
    return `
    <div class="cherry-app cherry-train">
      <div class="ck-train-modes">
        <button class="ck-mode ${trainTab==='local'?'on':''}" data-ttab="local">
          <b>YOUR GPU</b><span>this tab — WebGPU • FREE</span>
        </button>
        <button class="ck-mode ${trainTab==='network'?'on':''}" data-ttab="network">
          <b>LoRA</b><span>network nodes • CREDITS + credits</span>
        </button>
      </div>
      ${trainTab==='local'?`
      <div class="ck-card">
        <div class="ck-row"><label class="ck-field" style="flex:1"><span>DATASET</span><select class="ck-select" id="train-ds">${dsOptions||'<option>—</option>'}</select></label><button class="ck-btn ck-btn--ghost ck-btn--sm" id="btn-open-ds">⊕</button></div>
        <div class="ck-row"><label class="ck-field"><span>BASE</span><select class="ck-select" id="train-base"><option>GPT-2 (124M)</option><option>TinyLlama (1.1B)</option><option>Phi-2 Mini</option></select></label><label class="ck-field"><span>EPOCHS</span><input class="ck-input ck-input--sm" id="train-epochs" type="number" value="3" min="1" max="20"/></label></div>
        <button class="ck-btn ck-btn--go" style="width:100%;margin-top:8px" id="btn-start-train">▶ TRAIN → models.exe</button>
      </div>
      <div class="ck-card ck-terminal"><div class="ck-card-head">log</div><div class="ck-log" id="train-log"><div class="ck-log-line">&gt; YOUR GPU • ${selDs?.name ?? '—'}</div></div></div>
      `:`
      <div class="ck-card">
        <div class="ck-row"><label class="ck-field" style="flex:1"><span>DATASET</span><select class="ck-select" id="train-ds-net">${dsOptions||'<option>—</option>'}</select></label><button class="ck-btn ck-btn--ghost ck-btn--sm" id="btn-open-ds">⊕</button></div>
        <div class="ck-row"><label class="ck-field" style="flex:1"><span>BASE → LoRA</span><select class="ck-select" id="train-base-net"><option>GPT-2 → LoRA</option><option>LLaMA-7B → LoRA</option></select></label></div>
        <div class="ck-gate ${wallet.solana>0?'ok':'warn'}" style="margin-top:6px">${wallet.solana>0?`✓ credits ${wallet.solana.toFixed(2)}`:`⚠️ need credits`}</div>
        <div class="ck-row" style="margin-top:8px"><span class="ck-hint">${miner.balance.toFixed(2)} cr • est. ${(selDs? (selDs.rows/400*0.6).toFixed(1):'3.0')} cr</span><button class="ck-btn ck-btn--go" style="margin-left:auto" id="btn-dispatch" ${wallet.solana>0?'':'disabled'}>🚀 DISPATCH</button></div>
        ${activeJobs.length? `<div class="ck-list" style="margin-top:10px">${activeJobs.map(j=>`<div class="ck-item"><span style="flex:1"><b>${j.datasetName}</b><span class="ck-muted">${j.node}</span></span><span class="ck-bar"><i style="width:${j.progress}%"></i></span><b>${j.progress}%</b></div>`).join('')}</div>`: '<div class="ck-empty">No jobs — dispatch to network.exe</div>'}
      </div>`}
    </div>`
  }
  if(id==='datasets') return `
    <div class="cherry-app">
      <div class="ck-row"><span class="ck-hint">.jsonl .csv .txt</span><button class="ck-btn ck-btn--go ck-btn--sm" id="btn-import" style="margin-left:auto">+ Import</button><input type="file" id="ds-file" style="display:none" accept=".jsonl,.csv,.txt"/></div>
      <div class="ck-list">
        ${datasets.map(d=>`<div class="ck-item ${selectedDsId===d.id?'on':''}" data-preview="${d.id}"><span class="ck-file">📄</span><span style="flex:1"><b>${d.name}</b><span class="ck-muted">${d.rows} rows • ${d.type}</span></span><button class="ck-btn ck-btn--sm" data-train="${d.id}">▶</button><button class="ck-btn ck-btn--ghost ck-btn--sm" data-train-net="${d.id}">🌐</button></div>`).join('') || '<div class="ck-empty">No datasets — import one.</div>'}
      </div>
      <div class="ck-card">${(()=>{ const d=datasets.find(x=>x.id===selectedDsId)??datasets[0]; if(!d) return '<div class="ck-empty">Select dataset</div>'; return `<div class="ck-card-head">${d.name} • ${d.rows} rows</div><pre class="ck-pre">${d.content.slice(0,700)}</pre><div class="ck-row"><button class="ck-btn ck-btn--sm" data-train="${d.id}">▶ train.exe</button><button class="ck-btn ck-btn--ghost ck-btn--sm" data-train-net="${d.id}">🌐 LoRA</button></div>`})()}</div>
    </div>`
  if(id==='models'){
    const selMod = chatModel ? models.find(m=>m.id===chatModel) : null
    return `
    <div class="cherry-app">
      <div class="ck-list">
        ${models.length? models.map(m=>`<div class="ck-item ${selMod?.id===m.id?'on':''}"><span class="ck-file">🤖</span><span style="flex:1"><b>${m.name}</b><span class="ck-muted">${m.base} • ${m.datasetName} • ${m.source}</span></span><button class="ck-btn ck-btn--sm" data-chat="${m.id}">Chat</button><button class="ck-btn ck-btn--ghost ck-btn--sm" data-del-model="${m.id}">✕</button></div>`).join('') : `<div class="ck-empty">No models — train in train.exe<br/><button class="ck-btn ck-btn--sm" data-open-train style="margin-top:8px">→ train.exe</button></div>`}
      </div>
      ${chatOpen?`<div class="ck-card">
        <div class="ck-card-head" style="display:flex;justify-content:space-between;align-items:center"><span>${selMod? selMod.name : 'Chat'}</span><button class="ck-btn ck-btn--ghost ck-btn--sm" id="btn-close-chat">✕</button></div>
        <div class="ck-chat" id="chat-messages">${chatMessages.map(m=>`<div class="ck-bubble ${m.role}">${m.text}</div>`).join('') || '<div class="ck-empty">Chat pakai style dataset kamu…</div>'}</div>
        <div class="ck-row"><input class="ck-input" id="chat-input" placeholder="${selMod? 'Ask about '+selMod.datasetName : 'Ask…'}" style="flex:1"/><button class="ck-btn ck-btn--go" id="btn-send-chat">SEND</button></div>
      </div>`:''}
    </div>`
  }
  if(id==='sysinfo') return `
    <div class="app-content">
      <div class="sysinfo-grid">
        <div class="si-section"><div class="si-title">SYSTEM</div>
          <div class="si-row"><span class="si-key">OS</span><span class="si-val">${navigator.platform}</span></div>
          <div class="si-row"><span class="si-key">Cores</span><span class="si-val">${navigator.hardwareConcurrency}</span></div>
          <div class="si-row"><span class="si-key">UA</span><span class="si-val" style="font-size:10px">${navigator.userAgent.slice(0,42)}…</span></div>
        </div>
        <div class="si-section"><div class="si-title">GPU / WEBGPU</div>
          <div class="si-row"><span class="si-key">WebGPU</span><span class="si-val" id="si-webgpu">${(navigator as any).gpu?'supported':'not supported'}</span></div>
          <div class="si-row"><span class="si-key">WebGL</span><span class="si-val" id="si-webgl">—</span></div>
        </div>
        <div class="si-section"><div class="si-title">SOLANA NETWORK</div>
          <div class="si-row"><span class="si-key">Network</span><span class="si-val t-sol">${wallet.network}</span></div>
          <div class="si-row"><span class="si-key">RPC</span><span class="si-val t-mono si-rpc">${rpcFor(wallet.network)}</span></div>
          <div class="si-row"><span class="si-key">Slot</span><span class="si-val t-green" id="si-slot">—</span></div>
        </div>
        <div class="si-section"><div class="si-title">BENCHMARK</div><button class="btn-pixel btn-outline full-btn" id="btn-bench">▶ Run Benchmark</button><div class="benchmark-chart" id="bench-chart"><div class="bench-placeholder">Press benchmark to test CPU hashrate (TS Worker)</div></div></div>
      </div>
    </div>`
  if(id==='taskmgr') return `
    <div class="app-content">
      <div class="taskmgr-grid">
        <div class="tm-stats">
          <div class="tm-stat-card"><div class="tm-sc-label">YOUR HASHRATE</div><div class="tm-sc-val t-green">${miner.hashrate} H/s</div></div>
          <div class="tm-stat-card"><div class="tm-sc-label">NETWORK HASHRATE</div><div class="tm-sc-val">42.8 MH/s</div></div>
          <div class="tm-stat-card"><div class="tm-sc-label">ACTIVE MINERS</div><div class="tm-sc-val t-sol">${(124+miner.shares%40)}</div></div>
          <div class="tm-stat-card"><div class="tm-sc-label">TOTAL CREDITS</div><div class="tm-sc-val">${miner.balance.toFixed(2)}</div></div>
        </div>
        <div class="tm-processes">
          <div class="tm-proc-header"><span>PROCESS</span><span>STATUS</span><span>CPU</span><span>MEM</span></div>
          <div class="tm-proc-row"><span>⛏️ miner.exe</span><span class="proc-status ${miner.running?'running':'stopped'}">${miner.running?'running':'stopped'}</span><span>${miner.running? (12+miner.intensity/5).toFixed(0)+'%':'0%'}</span><span>—</span></div>
          <div class="tm-proc-row"><span>🤖 train.exe</span><span class="proc-status stopped">stopped</span><span>0%</span><span>—</span></div>
          <div class="tm-proc-row"><span>👛 wallet.exe</span><span class="proc-status running">idle</span><span>0%</span><span>2.1MB</span></div>
        </div>
      </div>
    </div>`
  if(id==='network'){
    const activeJobs = jobs.filter(j=>j.status!=='done')
    const doneCount = jobs.filter(j=>j.status==='done').length
    return `
    <div class="cherry-app">
      <div class="cherry-app-head"><div class="cherry-kicker"><span class="ck-dot"></span> NETWORK • GPU nodes • world map</div><div class="ck-flow">datasets → train <span>→</span> <b>🌐 network.exe</b> <span style="margin-left:auto" class="ck-muted">${activeJobs.length} active • ${doneCount} done</span></div></div>
      <div class="ck-grid2"><div class="ck-mini"><span>hashrate</span><b class="t-green">42.8 MH/s</b></div><div class="ck-mini"><span>nodes</span><b>3 / 4 online</b></div><div class="ck-mini"><span>queue</span><b>${activeJobs.length}</b></div><div class="ck-mini"><span>your cr</span><b>${miner.balance.toFixed(2)}</b></div></div>
      <div class="cherry-tabs" style="margin-top:8px"><button class="ck-tab ${networkTab==='nodes'?'on':''}" data-ntab="nodes">NODES</button><button class="ck-tab ${networkTab==='queue'?'on':''}" data-ntab="queue">QUEUE</button><button class="ck-tab ${networkTab==='map'?'on':''}" data-ntab="map">MAP</button></div>
      ${networkTab!=='map' ? `<div class="ck-list">${networkTab==='queue'
        ? (activeJobs.length? activeJobs.map(j=>`<div class="ck-item"><span class="ck-dot" style="background:var(--pink)"></span><span style="flex:1"><b>${j.datasetName}</b><span class="ck-muted">${j.node} • ${j.base}</span></span><span class="ck-bar"><i style="width:${j.progress}%"></i></span><b>${j.progress}%</b></div>`).join('') : '<div class="ck-empty">Queue empty — dispatch from train.exe</div>')
        : `<div class="ck-item"><span class="ck-dot" style="background:var(--mint)"></span><b>GPU #001 RTX 4090</b><span class="ck-muted">${activeJobs[0]? '▶ '+activeJobs[0].datasetName+' '+activeJobs[0].progress+'%':'idle — ready'}</span><span class="t-green" style="margin-left:auto">ONLINE</span></div>
           <div class="ck-item"><span class="ck-dot" style="background:var(--mint)"></span><b>GPU #002 RTX 3080</b><span class="ck-muted">idle</span><span class="t-green" style="margin-left:auto">ONLINE</span></div>
           <div class="ck-item"><span class="ck-dot" style="background:var(--amber)"></span><b>GPU #003 A100</b><span class="ck-muted">busy • ${activeJobs.length? activeJobs.length+' jobs':'warming up'}</span><span class="t-yellow" style="margin-left:auto">BUSY</span></div>`}
      </div>` : ''}
      <div class="ck-card" style="display:${networkTab==='map'?'block':'none'};padding:8px"><canvas id="map-canvas" width="600" height="220" style="width:100%;border-radius:8px"></canvas><div class="ck-hint" style="margin-top:6px">pink packet = your dataset moving • green YOU = your node • <button class="ck-btn ck-btn--sm" id="btn-open-train-from-net">train.exe</button> <button class="ck-btn ck-btn--ghost ck-btn--sm" id="btn-open-models-from-net">models</button></div></div>
      <div class="ck-card" style="display:${networkTab==='nodes'?'block':'none'};padding:8px;margin-top:6px"><canvas id="map-canvas-mini" width="600" height="120" style="width:100%;border-radius:8px"></canvas></div>
    </div>`
  }
  if(id==='leaderboard') return `
    <div class="app-content">
      <div class="lb-tabs"><button class="lb-tab active" data-tab="24h">24H</button><button class="lb-tab" data-tab="all">ALL TIME</button></div>
      <div class="lb-table" id="lb-table">
        <div class="lb-header"><span>#</span><span>WALLET</span><span>HARDWARE</span><span>HASHES</span><span>CREDITS</span></div>
        <div class="lb-loading">Loading leaderboard...</div>
      </div>
    </div>`
  if(id==='readme') return `
    <div class="app-content" style="padding:0">
      <div class="readme-toolbar">
        <span class="readme-path">C:\\AetherOS\\readme.txt</span>
        <button class="btn-pixel btn-sm" id="btn-copy-readme">⧉ Copy</button>
      </div>
      <pre class="readme-pre">AetherOS
========

A browser-based operating system that mines with your GPU
and uses the proceeds to train AI.

HOW IT WORKS

1. Mining      GPU computes SHA-256 → server verifies → earn credits
              miner.exe runs via WebGPU (CPU fallback).
              Each valid share converts to:
              2^34 hashes = 1 credit.

2. UPLOAD DATA    .jsonl / .csv / .txt
              Open datasets → Import → preview → send to train.
              Files stay in the browser until you dispatch a job.

3. Training      local (free, small model)
                  → runs directly in the tab using the browser GPU.
                  → no credits, no token. Great for experimenting.

                  network (pay credits + must hold token)
                      dataset → powerful machines
                      → thin LoRA layer → returned
                  → credits are charged per GPU minute.
                  → wajib hold credits (cek di wallet.exe → credits TOKEN).
                  → without it, network training is rejected.

4. CHAT          big model + your layer
              Open models → Chat. Your base model + LoRA are combined
              to answer in the style of your data.

THE APPS

miner.exe     GPU computes SHA-256 → kredit
datasets      UPLOAD DATA .jsonl .csv .txt
train.exe     local / network training (LoRA)
models        CHAT — big model + your layer
sysinfo       machine specs & benchmark
taskmgr       hashrate live
network       GPU network nodes
leaderboard   top miners
wallet        address, credits, credits (required for network)
readme.txt    this file
recycle bin   trash
settings      wallpaper & options

credits

Live on Robinhood Chain — via AetherOS.
0x95F804A36202E4F7E058dF393a9cB42A15F8FB23
PonsFamily Launchpad: 0x0a98d11e3ba97b01100a55e4078a9782185467a4

NOTES

Network training & network chat are for credits holders only.
Mining remains open to everyone.
Without the token you can only mine + train locally.

PRIVACY

Datasets are only hosted while a job is running, then deleted.
Training nodes don't know who submitted the job.
Local datasets & models stay in this browser.</pre>
    </div>`
  if(id==='trash') return `
    <div class="app-content">
      <div class="trash-header"><span class="ss-title">Recycle Bin</span><button class="btn-pixel btn-sm btn-outline" id="btn-empty-trash">Empty</button></div>
      <div class="trash-empty">
        <div class="trash-icon">🗑️</div>
        <div class="trash-title">Recycle Bin is empty</div>
        <div class="trash-desc">Deleted datasets and models will appear here.<br/>Nothing to restore.</div>
      </div>
      <div class="token-mint-row" style="margin-top:8px"><span class="t-label">Tip</span><span class="t-val" style="font-size:11px">Drag files to delete</span></div>
    </div>`
  return `
    <div class="app-content">
      <div class="settings-sections">
        <div class="settings-section"><div class="ss-title">WALLPAPER (Pick a theme)</div><div class="wallpaper-options">
          ${(['aurora','dusk','night','neon'] as Wallpaper[]).map(w=>`<div class="wp-opt ${wallpaper===w?'active':''}" data-wp="${w}"><div class="wp-swatch"></div><div class="wp-label">${w}${wallpaper===w?' ✓':''}</div></div>`).join('')}
        </div><div class="setting-row" style="margin-top:6px"><span class="sr-label">Active: <b style="color:var(--ink)">${wallpaper}</b></span><span class="t-mono" style="font-size:10px;color:var(--inkSoft)">click a thumbnail to change background</span></div>
        </div>
        <div class="settings-section"><div class="ss-title">SOLANA NETWORK</div>
          <div class="setting-row"><span class="sr-label">Network</span><select class="pixel-select" id="setting-net"><option value="devnet" ${wallet.network==='devnet'?'selected':''}>Devnet</option><option value="mainnet-beta" ${wallet.network==='mainnet-beta'?'selected':''}>Mainnet</option></select></div>
          <div class="setting-row"><span class="sr-label">RPC</span><span class="t-mono" style="font-size:11px">${rpcFor(wallet.network)}</span></div>
        </div>
        <div class="settings-section"><div class="ss-title">ABOUT</div><div class="about-box"><div class="about-logo">◎ AetherOS</div><div class="about-ver">v1.0.0 • TypeScript + Vite</div><div class="about-desc">Browser OS for mining, AI training, earning credits — fully typed.</div><div class="about-links"><a class="about-link" href="#">GitHub</a><a class="about-link" href="#">Docs</a></div></div></div>
      </div>
    </div>`
}

let walletTab: 'connect'|'solana'='connect'
let trainTab: 'local'|'network'='local'
let networkTab: 'nodes'|'queue'|'map'='nodes'
let chatOpen=false, chatModel:string|null=null
let chatMessages:{role:'user'|'bot', text:string}[]=[]
let pendingDatasetName:string = datasets[0]?.name ?? ''
let selectedDsId:string = datasets[0]?.id ?? ''
let activeJobTimer:any=null

async function loadLeaderboard(range: '24h' | 'all') {
  const table = document.getElementById('lb-table')
  if (!table) return
  try {
    const res = await apiFetch(`/leaderboard?sort=credits`) // Using /api/ prefix handled in apiFetch
    const data = await res.json()
    const rows = data.leaderboard.map((r: any, i: number) => `
      <div class="lb-row">
        <span>${i + 1}</span>
        <span class="lb-addr">${r.address}</span>
        <span>${r.hw || 'Browser'}</span>
        <span>${r.hashes.toLocaleString()}</span>
        <span class="t-sol">${r.credits.toFixed(2)} cr</span>
      </div>
    `).join('')
    table.innerHTML = `<div class="lb-header"><span>#</span><span>WALLET</span><span>HARDWARE</span><span>HASHES</span><span>CREDITS</span></div>` + rows
  } catch (e) {
    table.innerHTML = `<div class="lb-loading" style="color:red">Failed to load leaderboard</div>`
  }
}

function bindAppEvents(){
  $('#btn-mining')?.addEventListener('click',()=>{
    if(miner.running){ stopMining(); toast('Mining stopped','info') }
    else {
      if(!wallet.address){ toast('Connect wallet first','error'); openApp('wallet'); return }
      startMining(); toast('Mining started ⛏️','success')
    }
    renderWindows()
  })
  $('#intensity')?.addEventListener('input',(e)=>{
    const v=Number((e.target as HTMLInputElement).value)
    setIntensity(v)
    const a=$('#intensity-val'); if(a) a.textContent=v+'%'
    const p=$('#m-progress'); if(p) p.style.width=v+'%'
  })
  $('#use-addr')?.addEventListener('click',()=>{
    const v=($('#credit-addr') as HTMLInputElement)?.value.trim()
    if(!v) return toast('Enter address','error')
    const isEvm=v.startsWith('0x')
    setWallet(v,'manual',isEvm?'evm':'solana'); toast('Credit address set','success'); renderWindows()
  })
  document.querySelectorAll('[data-wtab]').forEach(b=> b.addEventListener('click',()=>{ walletTab=(b as HTMLElement).dataset.wtab as any; renderWindows() }))
  $('#btn-phantom')?.addEventListener('click', async()=>{
    try{
      if(!hasPhantom()){ toast('Phantom not installed — open phantom.app','error'); window.open('https://phantom.app/','_blank'); return }
      const addr = await connectPhantom()
      toast('Phantom connected: '+addr.slice(0,6)+'...'+addr.slice(-4),'success'); renderWindows()
    }catch(e:any){ toast(e?.message ?? 'Phantom connect failed','error') }
  })
  $('#btn-solflare')?.addEventListener('click',()=>{ const a='Solflare'+Math.random().toString(36).slice(2,8)+'2222222222222222222222'; setWallet(a,'solflare','solana'); toast('Solflare (mock) connected','success'); renderWindows() })
  $('#btn-set-manual')?.addEventListener('click',()=>{
    const v=($('#manual-addr') as HTMLInputElement)?.value.trim()
    if(!v || v.length<20) return toast('Invalid address','error')
    // detect evm vs solana by 0x prefix
    const isEvm = v.startsWith('0x')
    setWallet(v, 'manual', isEvm ? 'evm' : 'solana'); toast('Wallet set ('+(isEvm?'EVM':'Solana')+')','success'); renderWindows()
  })
  $('#btn-disconnect')?.addEventListener('click',()=>{ disconnectWallet(); toast('Disconnected','info'); renderWindows() })
  $('#btn-add-token')?.addEventListener('click',()=> toast('Token added to wallet (mock) — CA: 0x95F8…FB23','success'))
  $('#btn-explorer')?.addEventListener('click',()=> window.open('https://robinhoodchain.blockscout.com/token/0x95F804A36202E4F7E058dF393a9cB42A15F8FB23','_blank'))
  $('#btn-launchpad-go')?.addEventListener('click',()=> window.open('https://ponsfamily.com/launchpad/0x0a98d11e3ba97b01100a55e4078a9782185467a4','_blank'))
  $('#btn-copy-ca')?.addEventListener('click', async()=>{
    const ca='0x95F804A36202E4F7E058dF393a9cB42A15F8FB23'
    try{ await navigator.clipboard.writeText(ca); toast('CA copied: '+ca,'success') }catch{ toast(ca,'info') }
  })
  $('#btn-view-ca')?.addEventListener('click',()=> window.open('https://robinhoodchain.blockscout.com/token/0x95F804A36202E4F7E058dF393a9cB42A15F8FB23','_blank'))
  document.querySelectorAll('[data-ttab]').forEach(b=> b.addEventListener('click',()=>{ trainTab=(b as HTMLElement).dataset.ttab as any; renderWindows()}))
  // train dataset selector syncs pending
  $('#train-ds')?.addEventListener('change',e=>{ pendingDatasetName=datasets.find(d=>d.id===(e.target as HTMLSelectElement).value)?.name ?? pendingDatasetName; renderWindows() })
  $('#train-ds-net')?.addEventListener('change',e=>{ pendingDatasetName=datasets.find(d=>d.id===(e.target as HTMLSelectElement).value)?.name ?? pendingDatasetName; renderWindows() })
  $('#btn-open-ds')?.addEventListener('click',()=>{ openApp('datasets'); toast('Pilih dataset di datasets.exe','info') })
  document.querySelectorAll('[data-goto-models]').forEach(b=> b.addEventListener('click',()=>{ openApp('models'); renderWindows()}))
  $('#btn-start-train')?.addEventListener('click',()=>{
    const dsId=(document.getElementById('train-ds') as HTMLSelectElement)?.value ?? datasets[0]?.id
    const ds=datasets.find(d=>d.id===dsId) ?? datasets[0]
    if(!ds){ toast('No dataset','error'); return }
    const base=(document.getElementById('train-base') as HTMLSelectElement)?.value ?? 'GPT-2 (124M)'
    const epochs=Number((document.getElementById('train-epochs') as HTMLInputElement)?.value ?? 3)
    const log=$('#train-log')!
    log.innerHTML+=`<div class="log-line">> starting LOCAL ${base} on ${ds.name} — ${epochs} epochs</div>`
    let p=0; const iv=window.setInterval(()=>{
      p+=14; log.innerHTML+=`<div class="log-line">> epoch ${Math.floor(p/30)+1}/${epochs} — loss ${(2-p/70).toFixed(3)} • ${ds.rows} rows</div>`; log.scrollTop=log.scrollHeight
      if(p>=100){ clearInterval(iv); const mid='mdl-'+Date.now(); addModel({id:mid,name: ds.name.replace(/\.\w+$/,'')+`-lora-${Date.now().toString(36).slice(-4)}`,base,datasetId:ds.id,datasetName:ds.name,epochs,createdAt:Date.now(),source:'local',cost:0}); log.innerHTML+=`<div class="log-line" style="color:#14F195">> done — LoRA saved → models.exe</div>`; toast('Local training done → models.exe','success'); renderWindows(); setTimeout(()=>{ openApp('models'); chatOpen=true; chatModel=mid; chatMessages=[{role:'bot',text:'Hi! I am '+mid+' trained on '+ds.name}]; renderWindows()},400)}
    },450)
  })
  $('#btn-dispatch')?.addEventListener('click', async()=>{
    if(wallet.solana<=0){ toast('Must hold credits — buy in wallet → credits TOKEN','error'); openApp('wallet'); walletTab='solana'; renderWindows(); return }
    if(miner.balance<5){ toast('Not enough credits — need at least 5 cr for network training','error'); openApp('miner'); return }
    const dsId=(document.getElementById('train-ds-net') as HTMLSelectElement)?.value ?? datasets.find(d=>d.name===pendingDatasetName)?.id ?? datasets[0]?.id
    const ds=datasets.find(d=>d.id===dsId)!
    const base=(document.getElementById('train-base-net') as HTMLSelectElement)?.value ?? 'GPT-2 (124M)'
    
    toast(`Dispatching ${ds.name} to Modal GPU...`,'info')
    try {
      const token = localStorage.getItem('aetheros:token')
      const res = await fetch('/api/train/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({ datasetName: ds.name, datasetContent: ds.content, baseModel: base })
      })
      const data = await res.json()
      if(!res.ok) throw new Error(data.error || 'Dispatch failed')
      
      toast(data.message,'success')
      const jid='job-'+Date.now()
      addJob({id:jid,datasetId:ds.id,datasetName:ds.name,base,epochs:3,status:'training',progress:10,node:'Modal GPU T4',cost:5})
      openApp('network'); networkTab='queue'; renderWindows()

      // animate progress
      let tick=10; const t=setInterval(()=>{
        tick+= 12+Math.random()*15; const pr=Math.min(100,Math.round(tick))
        updateJob(jid,{progress:pr})
        if(pr>=100){ clearInterval(t); updateJob(jid,{status:'done',progress:100}); const mid='mdl-'+Date.now(); addModel({id:mid,name: ds.name.replace(/\.\w+$/,'')+`-lora-${Date.now().toString(36).slice(-4)}`,base,datasetId:ds.id,datasetName:ds.name,epochs:3,createdAt:Date.now(),source:'network',cost:5}); toast('Modal GPU training done — LoRA in models.exe','success'); renderWindows(); setTimeout(()=>{ openApp('models'); chatOpen=true; chatModel=mid; renderWindows()},500) }
        renderWindows()
      },800)
    } catch(e:any) {
      toast(e?.message || 'Training dispatch failed','error')
    }
  })
  $('#btn-import')?.addEventListener('click',()=> $('#ds-file')?.click())
  $('#ds-file')?.addEventListener('change',(e)=>{
    const f=(e.target as HTMLInputElement).files?.[0]; if(!f) return
    const r=new FileReader(); r.onload=()=>{
      const txt=String(r.result)
      const rows=txt.split('\n').filter(Boolean).length
      const id='ds-'+Date.now()
      addDataset({id,name:f.name,rows,type:f.name.split('.').pop()??'txt',content:txt.slice(0,4000),preview:txt.slice(0,140)})
      selectedDsId=id; pendingDatasetName=f.name; toast(`Imported ${f.name} — ready for train.exe`,'success'); renderWindows()
    }; r.readAsText(f)
  })
  document.querySelectorAll('[data-preview]').forEach(el=> el.addEventListener('click',()=>{
    const id=(el as HTMLElement).dataset.preview!; selectedDsId=id; const d=datasets.find(x=>x.id===id)!; if(d) pendingDatasetName=d.name; renderWindows()
  }))
  document.querySelectorAll('[data-train]').forEach(b=> b.addEventListener('click',(e)=>{ e.stopPropagation(); const id=(b as HTMLElement).dataset.train!; const d=datasets.find(x=>x.id===id)!; if(d) pendingDatasetName=d.name; selectedDsId=id; openApp('train'); trainTab='local'; toast(`Dataset ${d?.name} → train.exe (local)`,'success'); renderWindows() }))
  document.querySelectorAll('[data-train-net]').forEach(b=> b.addEventListener('click',(e)=>{ e.stopPropagation(); const id=(b as HTMLElement).dataset.trainNet!; const d=datasets.find(x=>x.id===id)!; if(d) pendingDatasetName=d.name; selectedDsId=id; openApp('train'); trainTab='network'; toast(`Dataset ${d?.name} → train.exe (network)`,'success'); renderWindows() }))
  document.querySelectorAll('[data-del-model]').forEach(b=> b.addEventListener('click',()=>{ const id=(b as HTMLElement).dataset.delModel!; removeModel(id); toast('Model deleted','info'); if(chatModel===id) chatOpen=false; renderWindows()}))
  $('#btn-refresh-models')?.addEventListener('click',()=> toast('Models refreshed','info'))
  document.querySelectorAll('[data-chat]').forEach(b=> b.addEventListener('click',()=>{ chatOpen=true; chatModel=(b as HTMLElement).dataset.chat!; const m=models.find(x=>x.id===chatModel); chatMessages=[{role:'bot',text:`Hi! I am ${m?.name} — trained on ${m?.datasetName} with ${m?.base}. Ask me anything in that style.`}]; renderWindows() }))
  document.querySelectorAll('[data-export]').forEach(b=> b.addEventListener('click',()=> toast('Exported '+ (b as HTMLElement).dataset.export+' — download mock .safetensors','success')))
  document.querySelectorAll('[data-open-train]').forEach(b=> b.addEventListener('click',()=>{ openApp('train'); renderWindows()}))
  document.querySelectorAll('[data-ntab]').forEach(b=> b.addEventListener('click',()=>{ networkTab=(b as HTMLElement).dataset.ntab as any; renderWindows()}))
  $('#btn-open-train-from-net')?.addEventListener('click',()=>{ openApp('train'); renderWindows()})
  $('#btn-open-models-from-net')?.addEventListener('click',()=>{ openApp('models'); renderWindows()})
  $('#btn-refresh-net')?.addEventListener('click',()=>{ toast('Network refreshed','info'); renderWindows()})
  // leaderboard tabs
  document.querySelectorAll('[data-tab]').forEach(b => {
    b.addEventListener('click', () => {
      const tab = (b as HTMLElement).dataset.tab
      document.querySelectorAll('[data-tab]').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      loadLeaderboard(tab === '24h' ? '24h' : 'all')
    })
  })
  // initial load if leaderboard window is open
  const lbTable = document.getElementById('lb-table')
  if (lbTable) loadLeaderboard('24h')
  $('#btn-close-chat')?.addEventListener('click',()=>{ chatOpen=false; renderWindows() })
  $('#btn-send-chat')?.addEventListener('click',sendChat)
  $('#chat-input')?.addEventListener('keydown',(e)=>{ if((e as KeyboardEvent).key==='Enter') sendChat() })
  try{ const c=document.createElement('canvas'); const gl=c.getContext('webgl'); const dbg=gl?.getExtension('WEBGL_debug_renderer_info'); const info=(gl as any)?.getParameter((dbg as any).UNMASKED_RENDERER_WEBGL); const e2=$('#si-webgl'); if(e2 && info) e2.textContent=String(info).slice(0,30) }catch{}
  $('#btn-bench')?.addEventListener('click',()=>{
    const chart=$('#bench-chart')!; chart.textContent='Benchmarking…'
    let best=0; const start=performance.now()
    for(let i=0;i<600000;i++) best+=Math.random()
    void best
    const ms=performance.now()-start
    const hps=Math.round(600000/(ms/1000))
    chart.innerHTML=`<div style="display:flex;gap:12px;justify-content:center"><span class="t-green" style="font-weight:800">${hps.toLocaleString()} ops/s</span><span>• ${ms.toFixed(0)} ms</span></div>`
    toast(`Benchmark: ${hps.toLocaleString()} ops/s`,'success')
  })
  document.querySelectorAll('[data-wp]').forEach(b=> b.addEventListener('click',()=>{
    const w=(b as HTMLElement).dataset.wp as Wallpaper
    applyWallpaper(w)
    toast(`Wallpaper: ${w}`,'success')
    renderWindows()
  }))
  $('#setting-net')?.addEventListener('change',(e)=>{
    setNetwork((e.target as HTMLSelectElement).value as Network); renderWindows()
  })
  $('#btn-copy-readme')?.addEventListener('click', async()=>{
    const pre=document.querySelector('.readme-pre') as HTMLElement | null
    const txt=pre?.textContent ?? ''
    try{ await navigator.clipboard.writeText(txt); toast('readme.txt copied','success') }catch{ toast('Copied to clipboard','info') }
  })
  $('#btn-empty-trash')?.addEventListener('click',()=> toast('Recycle Bin already empty','info'))
  $('#start-shutdown')?.addEventListener('click',()=>{
    const sm=$('#start-menu'); if(sm) sm.classList.add('hidden')
    doShutdown()
  })
  $('#btn-reboot')?.addEventListener('click',()=> doReboot())
  $('#shutdown-overlay')?.addEventListener('click',(e)=>{
    if((e.target as HTMLElement).id==='shutdown-overlay') doReboot()
  })
  drawMap()
}

function sendChat(){
  const inp=$('#chat-input') as HTMLInputElement | null
  if(!inp || !inp.value.trim()) return
  chatMessages.push({role:'user', text: inp.value}); const q=inp.value; inp.value=''
  chatMessages.push({role:'bot', text: mockAnswer(q)})
  renderWindows()
  setTimeout(()=>{ const m=$('#chat-messages'); if(m) m.scrollTop=m.scrollHeight },50)
}
function mockAnswer(q:string){
  if(q.toLowerCase().includes('solana')) return 'Solana is high-performance L1 with ~400ms blocks and low fees. AetherOS lets you mine credits and train models on it.'
  if(q.toLowerCase().includes('mining')) return 'Mining here is browser-based PoW that earns credits → credits. Use miner.exe!'
  return 'Nice question! (TS mock) Ask me about DeFi, NFTs, or validators.'
}
function drawMap(){
  const canvases = ['map-canvas','map-canvas-mini'].map(id=> document.getElementById(id) as HTMLCanvasElement | null).filter(Boolean) as HTMLCanvasElement[]
  if(!canvases.length) return
  let t=0
  const animate=()=>{
    t+=0.02
    canvases.forEach(c=>{
      const ctx=c.getContext('2d')!
      const W=c.width, H=c.height
      ctx.clearRect(0,0,W,H)
      // world map grid bg ala cherryOS — dotted world
      ctx.fillStyle='#fdf2f8'; ctx.fillRect(0,0,W,H)
      ctx.strokeStyle='rgba(59,18,64,.07)'; ctx.lineWidth=1
      for(let x=0;x<W;x+=22){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke() }
      for(let y=0;y<H;y+=22){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke() }
      // simplified world continents — blobs
      ctx.fillStyle='rgba(59,18,64,.08)'
      const blobs=[[80,70,60,28],[200,50,90,32],[360,80,110,36],[120,130,70,26],[300,140,80,22]]
      blobs.forEach(([x,y,w,h])=>{ ctx.beginPath(); ctx.ellipse(x,y,w/2,h/2,0,0,Math.PI*2); ctx.fill() })
      // nodes
      const pts=[{x:W*0.18,y:H*0.42,label:'US-WEST'},{x:W*0.48,y:H*0.36,label:'EU'},{x:W*0.72,y:H*0.46,label:'ASIA'},{x:W*0.32,y:H*0.68,label:'YOU'},{x:W*0.58,y:H*0.62,label:'A100'}]
      const active = jobs.filter(j=>j.status!=='training').length ? jobs.filter(j=>j.status==='training') : []
      // connections
      ctx.strokeStyle='rgba(153,69,255,.28)'; (ctx as any).setLineDash([6,6]); (ctx as any).lineWidth=1.4
      pts.forEach((a,i)=> pts.slice(i+1).forEach(b=>{
        const anim = (Math.sin(t*2 + i)*0.3+0.7)
        ctx.globalAlpha= 0.35 + anim*0.35; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke()
      })); (ctx as any).setLineDash([]); ctx.globalAlpha=1
      // packet moving
      if(active.length){
        const p = (t*0.7) % 1
        const a=pts[3], b=pts[0]
        const x=a.x + (b.x-a.x)*p, y=a.y+(b.y-a.y)*p + Math.sin(p*Math.PI)* -18
        ctx.fillStyle='#ff6fb1'; ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fill()
        ctx.fillStyle='rgba(255,111,177,.25)'; ctx.beginPath(); ctx.arc(x,y,10,0,Math.PI*2); ctx.fill()
      }
      // nodes dots pulse
      pts.forEach((p,i)=>{
        const isYou=i===3
        const isActive=i<2 || (active.length && isYou)
        const pulse = Math.abs(Math.sin(t*2.2 + i))
        const r = isActive ? 8 + pulse*3 : 6
        // glow
        ctx.fillStyle= isYou ? 'rgba(20,241,149,.35)' : isActive ? 'rgba(153,69,255,.22)' : 'rgba(255,255,255,1)'
        ctx.beginPath(); ctx.arc(p.x,p.y,r+6,0,Math.PI*2); ctx.fill()
        // dot
        ctx.fillStyle= isYou ? '#14F195' : isActive ? '#9945FF' : '#ffd3e8'
        ctx.strokeStyle='#3b1240'; ctx.lineWidth=2
        ctx.beginPath(); ctx.arc(p.x,p.y, isActive?7:5,0,Math.PI*2); ctx.fill(); ctx.stroke()
        ctx.fillStyle='#3b1240'; ctx.font=`700 ${c.id==='map-canvas-mini'?'8':'9'}px JetBrains Mono`
        ctx.fillText(p.label, p.x-18, p.y-16)
        if(isYou){ ctx.fillStyle='#14F195'; ctx.font='400 7px Silkscreen'; ctx.fillText('● YOU', p.x-14, p.y+18) }
      })
    })
    requestAnimationFrame(animate)
  }
  animate()
}
function refreshTray(){
  const set=(id:string,v:string)=>{ const e=document.getElementById(id); if(e) e.textContent=v }
  set('tray-sol', walletBalanceString()); set('tray-solana', solanaString()); set('tray-net', wallet.network)
  set('brand-hash', miner.hashrate? `${miner.hashrate} H/s`:'0 H/s'); set('brand-sol', walletBalanceString()); set('brand-solana', solanaString())
  const wt=$('#tray-wallet-text'); if(wt) wt.textContent= wallet.address ? wallet.address.slice(0,4)+'…'+wallet.address.slice(-4) : 'no wallet'
}
onMinerTick((m, uptime)=>{
  const set=(id:string,v:string)=>{ const e=document.getElementById(id); if(e) e.textContent=v }
  set('m-hashrate', `${m.hashrate} H/s`); set('m-shares', `${m.shares} found`); set('m-accepted', `${m.accepted}`)
  set('m-session', `+${m.session.toFixed(4)} cr`); set('m-balance', `${m.balance.toFixed(4)} cr`); set('m-uptime', uptime)
  set('m-status', m.running?'mining':'stopped'); set('m-backend', m.running?'webgpu/worker':'idle')
  const prog=document.getElementById('m-progress'); if(prog) prog.style.width= m.running? (m.intensity+'%') : '0%'
  const log=document.getElementById('miner-log')
  if(log && m.running && Math.random()<0.35){
    const line=document.createElement('div'); line.className='log-line'
    line.innerHTML=`<span class="log-time">${new Date().toLocaleTimeString()}</span> &gt; share #${m.shares} ${m.accepted===m.shares?'<span style="color:#14F195">accepted</span>':'rejected'} • ${m.hashrate} H/s`
    log.appendChild(line); log.scrollTop=log.scrollHeight
  }
  refreshTray()
})
onBalanceChange(refreshTray)

function boot(){
  const app=document.getElementById('app')!
  app.innerHTML=shellHTML()
  // click to open — phone: single tap + haptic
  app.addEventListener('click',(e)=>{
    const t=e.target as HTMLElement
    const open=t.closest<HTMLElement>('[data-open]')?.dataset.open
    if(open){ if(isPhone()) haptic(18); openApp(open as AppId) }
  })
  // desktop double click (ignored on phone)
  app.addEventListener('dblclick',(e)=>{
    if(isPhone()) return
    const t=e.target as HTMLElement
    const open=t.closest<HTMLElement>('[data-open]')?.dataset.open
    if(open) openApp(open as AppId)
  })
  // long-press on desktop icon = select + haptic
  let pressTimer:any=null
  app.addEventListener('touchstart',(e)=>{
    const icon=(e.target as HTMLElement).closest<HTMLElement>('.desktop-icon')
    if(!icon) return
    icon.classList.add('sel')
    pressTimer=setTimeout(()=>{ haptic(30); icon.classList.add('sel') }, 420)
  },{passive:true})
  app.addEventListener('touchend',(e)=>{
    clearTimeout(pressTimer)
    const icon=(e.target as HTMLElement).closest<HTMLElement>('.desktop-icon')
    // remove selection after brief delay
    setTimeout(()=> document.querySelectorAll('.desktop-icon.sel').forEach(el=>el.classList.remove('sel')), 700)
  },{passive:true})
  // scrim tap → minimize top window (phone)
  document.getElementById('mobile-scrim')?.addEventListener('click',()=>{
    if(!isPhone()) return
    haptic(16)
    const top=[...windows].filter(w=>!w.minimized).sort((a,b)=>b.z-a.z)[0]
    if(top) minimizeWin(top.id)
  })
  // hide hint after first window open
  const obs=new MutationObserver(()=> syncMaximizedClass())
  obs.observe(app, {childList:true, subtree:true})
  // swipe anywhere hint away after 5s
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
    const d=new Date(); const s=d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
    const e=document.getElementById('tray-time'); if(e) e.textContent=s
  },1000)
  // cherryOS behavior: first visit opens readme + miner
  const seen=localStorage.getItem('solanaos:seen')
  if(!seen && !isPhone()){
    openApp('readme'); setTimeout(()=> openApp('miner'), 220)
    localStorage.setItem('solanaos:seen','1')
  } else {
    openApp('miner'); openApp('wallet')
  }
  applyWallpaper(wallpaper)
  setInterval(()=>{ const s=document.getElementById('si-slot'); if(s) s.textContent=String(280_000_000 + Math.floor(Math.random()*5000)) },2000)
  syncMaximizedClass()
  window.addEventListener('resize', syncMaximizedClass)
  // beforeunload: stop mining like cherryOS
  window.addEventListener('beforeunload',()=>{ if(miner.running) stopMining() })
}
boot()

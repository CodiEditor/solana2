import './style.css'
import { miner, wallet, startMining, stopMining, setIntensity, onMinerTick, onBalanceChange, setWallet, disconnectWallet, setNetwork, rpcFor, walletBalanceString, solanaString } from './store'
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
    'wallet':'address, credits, $SOLANA',
    'readme':'how SolanaOS works',
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
    <div class="pixel-logo-text">SolanaOS</div>
    <div class="pixel-tagline">MINE WITH YOUR GPU<br/>EARN $SOLANA ON SOLANA</div>
    <div class="brand-stats">
      <div class="brand-pill"><span class="dot"></span> <b id="brand-hash">0 H/s</b> hashrate</div>
      <div class="brand-pill">◎ <b id="brand-sol">${walletBalanceString()}</b></div>
      <div class="brand-pill">$SOLANA <b id="brand-solana">${solanaString()}</b></div>
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
      <div class="tray-item" data-open="wallet"><span>$SOLANA</span> <span id="tray-solana">${solanaString()}</span></div>
      <div class="tray-item tray-network"><span class="net-dot"></span><span id="tray-net">${wallet.network}</span></div>
      <div class="tray-time" id="tray-time">00:00</div>
    </div>
  </div>
  <div id="start-menu" class="start-menu hidden">
    <div class="start-menu-header"><div class="start-logo">◎ SolanaOS</div><div class="start-version">v1.0.0 • TS</div></div>
    <div class="start-menu-items">
      ${Object.entries(APPS).map(([id,v])=>`<div class="start-item" data-open="${id}">${v.icon} ${v.title} <small>${BLURB[id]??''}</small></div>`).join('')}
      <div class="start-sep"></div>
      <a class="start-item" href="https://robinhoodchain.blockscout.com/token/0x95F804A36202E4F7E058dF393a9cB42A15F8FB23" target="_blank" style="text-decoration:none;color:inherit"><span>◈</span> $SOLANA on Blockscout <small>view token 0x95F8…FB23</small></a>
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
      <div class="shutdown-hint">SolanaOS • cherryOS inspired • click anywhere to reboot</div>
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
  toast('SolanaOS shut down — click to reboot','info')
  haptic(30)
}
function doReboot(){
  const ov=document.getElementById('shutdown-overlay')
  if(ov){ ov.classList.add('hidden'); ov.classList.remove('show') }
  toast('SolanaOS rebooted','success')
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
    <div class="app-content">
      <div class="app-toolbar">
        <button class="btn-pixel ${miner.running?'btn-red':'btn-green'}" id="btn-mining">${miner.running?'■ STOP MINING':'▶ START MINING'}</button>
        <span class="toolbar-label">INTENSITY</span>
        <input type="range" id="intensity" min="1" max="100" value="${miner.intensity}" class="pixel-slider" />
        <span id="intensity-val">${miner.intensity}%</span>
        <input type="text" id="credit-addr" placeholder="Solana address to credit" class="pixel-input addr-input" value="${wallet.address??''}" />
        <button class="btn-pixel btn-outline" id="use-addr">USE</button>
      </div>
      <div class="terminal-box">
        <div class="terminal-header">─ solanaOS miner ─ TypeScript Edition ─</div>
        <div class="terminal-grid">
          <span class="t-label">backend</span><span class="t-val" id="m-backend">${miner.running?'webgpu':'idle'}</span>
          <span class="t-label">hashrate</span><span class="t-val t-green" id="m-hashrate">${miner.hashrate} H/s</span>
          <span class="t-label">difficulty</span><span class="t-val" id="m-diff">${miner.difficulty.toLocaleString()}</span>
          <span class="t-label">shares</span><span class="t-val" id="m-shares">${miner.shares} found</span>
          <span class="t-label">accepted</span><span class="t-val t-green" id="m-accepted">${miner.accepted}</span>
          <span class="t-label">session</span><span class="t-val t-sol" id="m-session">+${miner.session.toFixed(4)} cr</span>
          <span class="t-label">balance</span><span class="t-val t-sol" id="m-balance">${miner.balance.toFixed(4)} cr</span>
          <span class="t-label">uptime</span><span class="t-val" id="m-uptime">00:00:00</span>
          <span class="t-label">status</span><span class="t-val ${miner.running?'t-green':'t-yellow'}" id="m-status">${miner.running?'mining':'stopped'}</span>
        </div>
        <div class="terminal-progress"><div class="progress-inner" id="m-progress" style="width:${miner.running? (miner.intensity+'%') : '0%'}"></div></div>
        <div class="terminal-log" id="miner-log"><div class="log-line"><span class="log-time">${new Date().toLocaleTimeString()}</span> &gt; miner.exe ready. ${wallet.address ? 'Address set.' : 'Connect wallet and start mining.'}</div></div>
      </div>
    </div>`
  if(id==='wallet') return `
    <div class="app-content">
      <div class="wallet-tabs">
        <button class="wallet-tab ${walletTab==='connect'?'active':''}" data-wtab="connect">CONNECT</button>
        <button class="wallet-tab ${walletTab==='solana'?'active':''}" data-wtab="solana">$SOLANA TOKEN</button>
        <button class="wallet-tab ${walletTab==='txns'?'active':''}" data-wtab="txns">TRANSACTIONS</button>
      </div>
      <div class="wallet-panel ${walletTab!=='connect'?'hidden':''}">
        <div class="wallet-connect-box">
          <div class="wallet-sol-icon">◎</div>
          <div class="wallet-title">Connect Solana Wallet</div>
          <div class="wallet-desc">TypeScript-native wallet adapter. Connect Phantom / Solflare or paste address.</div>
          <div class="wallet-buttons">
            <button class="btn-pixel btn-sol-purple" id="btn-phantom">👻 Connect Phantom</button>
            <button class="btn-pixel btn-sol-orange" id="btn-solflare">🌟 Connect Solflare</button>
          </div>
          <div class="wallet-or">— or paste address manually —</div>
          <div class="wallet-manual">
            <input type="text" id="manual-addr" placeholder="Solana wallet address (base58)" class="pixel-input full-input" value="${wallet.address??''}" />
            <button class="btn-pixel btn-outline" id="btn-set-manual">SET</button>
          </div>
          <div class="wallet-info-box" style="${wallet.address?'':'display:none'}" id="wallet-info">
            <div class="wi-row"><span class="wi-label">Address</span><span class="wi-val" style="font-size:10px">${wallet.address??'—'}</span></div>
            <div class="wi-row"><span class="wi-label">SOL Balance</span><span class="wi-val t-green">${wallet.sol.toFixed(3)} SOL</span></div>
            <div class="wi-row"><span class="wi-label">$SOLANA Balance</span><span class="wi-val t-sol">${wallet.solana.toFixed(2)} SOLANA</span></div>
            <div class="wi-row"><span class="wi-label">Network</span><span class="wi-val">${wallet.network}</span></div>
            <button class="btn-pixel btn-red btn-sm" id="btn-disconnect">DISCONNECT</button>
          </div>
        </div>
      </div>
      <div class="wallet-panel ${walletTab!=='solana'?'hidden':''}">
        <div class="cherry-buy-hero">
          <div class="buy-hero-left">
            <div class="buy-kicker"><span class="buy-dot"></span> LIVE ON ROBINHOOD CHAIN</div>
            <div class="buy-title">Buy <span>$SOLANA</span></div>
            <div class="buy-sub">CherryOS-style: Mine with your GPU, spend what you mine on AI training. Now buy $SOLANA directly from the official markets.</div>
            <div class="buy-ca-row">
              <div class="buy-ca-chip"><span class="ca-label">CA</span><span class="ca-val" id="ca-val">0x95F804A36202E4F7E058dF393a9cB42A15F8FB23</span></div>
              <button class="btn-pixel btn-sm" id="btn-copy-ca">⧉ Copy</button>
              <button class="btn-pixel btn-sm btn-outline" id="btn-view-ca">View</button>
            </div>
            <div class="buy-qr-hint">Tip: Copy CA → paste di launchpad / explorer untuk beli</div>
          </div>
          <div class="buy-hero-art">
            <div class="buy-token-badge">
              <div class="buy-token-icon">◎</div>
              <div><div class="buy-token-name">$SOLANA</div><div class="buy-token-net">Robinhood Chain • SPL</div></div>
            </div>
            <div class="buy-stats-mini">
              <div><span>YOUR BALANCE</span><b class="t-sol">${wallet.solana.toFixed(2)} SOLANA</b></div>
              <div><span>MINED CREDITS</span><b>${miner.balance.toFixed(4)} cr</b></div>
            </div>
          </div>
        </div>

        <div class="buy-grid">
          <a class="buy-card buy-card--explorer" href="https://robinhoodchain.blockscout.com/token/0x95F804A36202E4F7E058dF393a9cB42A15F8FB23" target="_blank" rel="noopener noreferrer">
            <div class="buy-card-top">
              <div class="buy-card-icon" style="background:#111827;color:#fff">◈</div>
              <div class="buy-card-tag">EXPLORER • VERIFIED</div>
            </div>
            <div class="buy-card-title">Blockscout</div>
            <div class="buy-card-desc">Lihat holder, transfer & verified contract di Robinhood Chain Explorer. Klik untuk buka token page resmi.</div>
            <div class="buy-card-meta"><span class="meta-dot" style="background:#14F195"></span> robinhoodchain.blockscout.com <span class="meta-arrow">↗</span></div>
            <div class="btn-pixel btn-sol-purple buy-card-btn">BUY ON BLOCKSCOUT ↗</div>
          </a>
          <a class="buy-card buy-card--launchpad" href="https://ponsfamily.com/launchpad/0x0a98d11e3ba97b01100a55e4078a9782185467a4" target="_blank" rel="noopener noreferrer">
            <div class="buy-card-top">
              <div class="buy-card-icon" style="background:#ff6fb1;color:#fff">🚀</div>
              <div class="buy-card-tag" style="background:#ffe07a;color:#3b1240;border-color:#3b1240">LAUNCHPAD • PRESALE</div>
            </div>
            <div class="buy-card-title">PonsFamily Launchpad</div>
            <div class="buy-card-desc">Beli langsung dari launchpad resmi. Support wallet connect & allocation check. Harga launchpad paling awal.</div>
            <div class="buy-card-meta"><span class="meta-dot" style="background:#ff6fb1"></span> ponsfamily.com/launchpad <span class="meta-arrow">↗</span></div>
            <div class="btn-pixel btn-green buy-card-btn" style="color:#3b1240">BUY ON LAUNCHPAD ↗</div>
          </a>
        </div>

        <div class="token-info" style="margin-top:10px">
          <div class="token-header"><div class="token-badge">$SOLANA</div><div class="token-name">SolanaOS Token — CherryOS inspired</div><span class="token-live"><span class="dot"></span> LIVE</span></div>
          <div class="token-stats">
            <div class="token-stat"><div class="ts-label">YOUR BALANCE</div><div class="ts-val t-sol">${wallet.solana.toFixed(2)} SOLANA</div></div>
            <div class="token-stat"><div class="ts-label">TOTAL SUPPLY</div><div class="ts-val">1,000,000,000</div></div>
            <div class="token-stat"><div class="ts-label">PRICE</div><div class="ts-val t-green">$0.0042</div></div>
            <div class="token-stat"><div class="ts-label">MARKET CAP</div><div class="ts-val">$4.2M</div></div>
          </div>
          <div class="token-mint-row"><span class="t-label">Mint / Contract</span><span class="t-val t-mono" style="font-size:10px">0x95F804…FB23 • Robinhood Chain</span></div>
          <div class="token-actions">
            <button class="btn-pixel btn-sol-purple" id="btn-add-token">+ Add to Wallet</button>
            <button class="btn-pixel btn-outline" id="btn-explorer">View on Explorer</button>
            <button class="btn-pixel btn-outline" id="btn-launchpad-go">Open Launchpad ↗</button>
          </div>
          <div class="how-to-buy">
            <div class="htb-title">How to buy — 3 langkah ala cherryOS</div>
            <div class="htb-steps">
              <div class="htb-step"><b>1</b><span>Connect wallet di tab <b>CONNECT</b></span></div>
              <div class="htb-step"><b>2</b><span>Pilih market: <b>Blockscout</b> (explorer) atau <b>PonsFamily Launchpad</b></span></div>
              <div class="htb-step"><b>3</b><span>Approve & swap — $SOLANA langsung masuk wallet</span></div>
            </div>
          </div>
        </div>
      </div>
      <div class="wallet-panel ${walletTab!=='txns'?'hidden':''}">
        <div class="txn-list" id="txn-list">
          ${txns.length? txns.map(t=>`<div class="txn-item"><span>${t.label}</span><span class="t-sol">${t.amount}</span></div>`).join('') : '<div class="txn-empty">No transactions yet. Start mining to earn $SOLANA!</div>'}
        </div>
      </div>
    </div>`
  if(id==='train') return `
    <div class="app-content">
      <div class="train-tabs">
        <button class="train-tab ${trainTab==='local'?'active':''}" data-ttab="local">LOCAL TRAINING</button>
        <button class="train-tab ${trainTab==='network'?'active':''}" data-ttab="network">NETWORK TRAINING</button>
      </div>
      ${trainTab==='local'?`
      <div class="train-form">
        <div class="form-row"><label class="form-label">BASE MODEL</label><select class="pixel-select" id="train-base"><option>GPT-2 (124M)</option><option>TinyLlama (1.1B)</option><option>Phi-2 Mini</option></select></div>
        <div class="form-row"><label class="form-label">DATASET</label><select class="pixel-select" id="train-ds"><option>solana-docs.jsonl</option><option>defi-glossary.jsonl</option></select></div>
        <div class="form-row"><label class="form-label">EPOCHS</label><input type="number" class="pixel-input sm-input" id="train-epochs" value="3" /></div>
        <button class="btn-pixel btn-green full-btn" id="btn-start-train">▶ START LOCAL TRAINING (FREE)</button>
      </div>
      <div class="terminal-box"><div class="terminal-log" id="train-log"><div class="log-line">&gt; train.exe ready (TS). Browser GPU — free.</div></div></div>
      `:`<div class="network-train-info">
        <div class="nti-header">🌐 Network Training (Distributed)</div>
        <div class="nti-desc">Dispatch to decentralized GPU nodes. Billed in credits from mining.</div>
        <div class="credit-cost"><div class="cc-row"><span>GPT-2 LoRA</span><span class="t-sol">~5 cr/min</span></div><div class="cc-row"><span>LLaMA-7B LoRA</span><span class="t-sol">~25 cr/min</span></div></div>
        <div>Your Credits: <span class="t-sol">${miner.balance.toFixed(2)} cr</span></div>
        <button class="btn-pixel btn-sol-purple full-btn" id="btn-dispatch">DISPATCH JOB</button>
      </div>`}
    </div>`
  if(id==='datasets') return `
    <div class="app-content">
      <div class="datasets-header"><button class="btn-pixel btn-outline" id="btn-import">+ Import Dataset</button><input type="file" id="ds-file" style="display:none" accept=".jsonl,.csv,.txt" /></div>
      <div class="datasets-list">
        ${['solana-docs.jsonl','defi-glossary.jsonl','nft-descriptions.txt'].map(n=>`
          <div class="dataset-item" data-preview="${n}"><div class="di-icon">📄</div><div class="di-info"><div class="di-name">${n}</div><div class="di-meta">${Math.round(500+Math.random()*1500)} rows</div></div><button class="btn-pixel btn-sm btn-sol-purple" data-train="${n}">Train</button></div>
        `).join('')}
      </div>
      <div class="dataset-preview" id="ds-preview"><div class="preview-placeholder">Select a dataset to preview — TypeScript file reader active.</div></div>
    </div>`
  if(id==='models') return `
    <div class="app-content">
      <div class="models-header"><span>Trained Models & LoRA Adapters</span><button class="btn-pixel btn-outline btn-sm" id="btn-refresh-models">↻ Refresh</button></div>
      <div class="models-list">
        <div class="model-item"><div class="model-icon">🤖</div><div class="model-info"><div class="model-name">solana-gpt2-lora-v1</div><div class="model-meta">Base: GPT-2 · 2.1MB · local</div></div><div class="model-actions"><button class="btn-pixel btn-sm btn-green" data-chat="solana-gpt2-lora-v1">Chat</button><button class="btn-pixel btn-sm btn-outline" data-export="solana-gpt2-lora-v1">Export</button></div></div>
      </div>
      <div class="model-chat" id="model-chat" style="display:${chatOpen?'block':'none'}">
        <div class="chat-header"><span id="chat-title">${chatModel??'Model Chat'}</span><button class="btn-pixel btn-sm btn-red" id="btn-close-chat">✕ Close</button></div>
        <div class="chat-messages" id="chat-messages">${chatMessages.map(m=>`<div class="chat-bubble ${m.role}">${m.text}</div>`).join('')}</div>
        <div class="chat-input-row"><input type="text" class="pixel-input chat-input" id="chat-input" placeholder="Type a message..." /><button class="btn-pixel btn-sol-purple" id="btn-send-chat">SEND</button></div>
      </div>
    </div>`
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
  if(id==='network') return `
    <div class="app-content">
      <div class="network-tabs"><button class="network-tab active">GPU NODES</button><button class="network-tab">MINERS</button></div>
      <div class="node-list">
        <div class="node-item"><div class="node-status-dot online"></div><div class="node-info"><div class="node-name">GPU Node #001</div><div class="node-meta">RTX 4090 · 24GB · TS Worker</div></div><span class="t-green">ONLINE</span></div>
        <div class="node-item"><div class="node-status-dot online"></div><div class="node-info"><div class="node-name">GPU Node #002</div><div class="node-meta">RTX 3080 · 12GB · 1 job</div></div><span class="t-green">ONLINE</span></div>
        <div class="node-item"><div class="node-status-dot offline"></div><div class="node-info"><div class="node-name">GPU Node #003</div><div class="node-meta">A100 · 80GB · offline</div></div><span class="t-yellow">OFFLINE</span></div>
      </div>
      <div class="network-map" style="margin-top:10px"><canvas id="map-canvas" width="600" height="220" style="width:100%"></canvas></div>
    </div>`
  if(id==='leaderboard') return `
    <div class="app-content">
      <div class="lb-tabs"><button class="lb-tab active">24H</button><button class="lb-tab">ALL TIME</button></div>
      <div class="lb-table">
        <div class="lb-header"><span>#</span><span>WALLET</span><span>HARDWARE</span><span>HASHES</span><span>CREDITS</span></div>
        ${[
          ['🥇','5KJG…7xNw','RTX 4090','1.2M','142.4'],
          ['🥈','9aXP…mR3q','RTX 3090','890K','98.1'],
          ['🥉','DK2R…pQ9s','RX 6900XT','621K','67.3'],
        ].map(r=>`<div class="lb-row"><span>${r[0]}</span><span class="lb-addr">${r[1]}</span><span>${r[2]}</span><span>${r[3]}</span><span class="t-sol">${r[4]} cr</span></div>`).join('')}
        ${wallet.address? `<div class="lb-row" style="background:rgba(153,69,255,.12)"><span>•</span><span class="lb-addr">${wallet.address.slice(0,6)}…</span><span>Your Rig</span><span>${miner.shares}</span><span class="t-sol">${miner.balance.toFixed(2)} cr</span></div>`:''}
      </div>
    </div>`
  if(id==='readme') return `
    <div class="app-content" style="padding:0">
      <div class="readme-toolbar">
        <span class="readme-path">C:\\SolanaOS\\readme.txt</span>
        <button class="btn-pixel btn-sm" id="btn-copy-readme">⧉ Copy</button>
      </div>
      <pre class="readme-pre">SolanaOS
========

An operating system in your browser that mines with your GPU
and spends what it mines on training AI — SolanaOS edition.

HOW IT WORKS

1. mine      miner.exe runs SHA-256 on your GPU through WebGPU
             (CPU fallback if no WebGPU).
             Each share is checked & credited to your wallet.

2. collect   Credits are proof of the work your machine did.
             2^34 hashes = 1 credit. Mining earns credits every
             share accepted. Credits → $SOLANA.

3. train     train.exe spends credits on GPU-minutes. Your
             dataset → training node → LoRA adapter back.
             Or train a small model locally, for free.

4. talk      models lets you chat with what you trained.

5. buy       $SOLANA is live on Robinhood Chain
             0x95F804A36202E4F7E058dF393a9cB42A15F8FB23
             Buy on Blockscout or PonsFamily Launchpad
             (wallet.exe → $SOLANA TOKEN).

THE APPS

miner.exe     mine credits with your GPU
train.exe     local training, or LoRA runs on the network
datasets      import .jsonl .csv .txt, preview, send to train
models        your adapters and local models, with a chat
sysinfo       what your machine is, and what it measures
taskmgr       live hashrate, yours and the network's
network       training nodes and browser miners, live
leaderboard   top miners, 24 hours and all time
wallet        address, credits, $SOLANA buy (Blockscout/Launchpad)
readme.txt    this file — how SolanaOS works
recycle bin   deleted things (trash)
settings      wallpaper and options

WHAT IS REAL

Everything on screen is read live: hardware from the browser,
every number from local store / chain. When chain is down,
apps say so.

Hashes are proof of work, not useful work.

$SOLANA

Live on Robinhood Chain — via SolanaOS.
0x95F804A36202E4F7E058dF393a9cB42A15F8FB23
PonsFamily Launchpad: 0x0a98d11e3ba97b01100a55e4078a9782185467a4

Training and chat on the network are for holders.
Mining stays open to everyone.

FOLLOW

SolanaOS — solanaos inspired build

PRIVACY

Your dataset is hosted only for the length of a run, then
deleted. Training nodes never learn who sent a job. Datasets
and local models stay in this browser.</pre>
    </div>`
  if(id==='trash') return `
    <div class="app-content">
      <div class="trash-header"><span class="ss-title">Recycle Bin</span><button class="btn-pixel btn-sm btn-outline" id="btn-empty-trash">Empty</button></div>
      <div class="trash-empty">
        <div class="trash-icon">🗑️</div>
        <div class="trash-title">Recycle Bin is empty</div>
        <div class="trash-desc">Deleted datasets & models will appear here.<br/>Nothing to restore — just like cherryOS.</div>
      </div>
      <div class="token-mint-row" style="margin-top:8px"><span class="t-label">Tip</span><span class="t-val" style="font-size:11px">Drag files to trash to delete (coming soon)</span></div>
    </div>`
  return `
    <div class="app-content">
      <div class="settings-sections">
        <div class="settings-section"><div class="ss-title">WALLPAPER — pilih tema, langsung live preview</div><div class="wallpaper-options">
          ${(['aurora','dusk','night','neon'] as Wallpaper[]).map(w=>`<div class="wp-opt ${wallpaper===w?'active':''}" data-wp="${w}"><div class="wp-swatch"></div><div class="wp-label">${w}${wallpaper===w?' ✓':''}</div></div>`).join('')}
        </div><div class="setting-row" style="margin-top:6px"><span class="sr-label">Aktif: <b style="color:var(--ink)">${wallpaper}</b></span><span class="t-mono" style="font-size:10px;color:var(--inkSoft)">klik thumbnail → background berubah instan</span></div>
        </div>
        <div class="settings-section"><div class="ss-title">SOLANA NETWORK</div>
          <div class="setting-row"><span class="sr-label">Network</span><select class="pixel-select" id="setting-net"><option value="devnet" ${wallet.network==='devnet'?'selected':''}>Devnet</option><option value="mainnet-beta" ${wallet.network==='mainnet-beta'?'selected':''}>Mainnet</option><option value="testnet" ${wallet.network==='testnet'?'selected':''}>Testnet</option></select></div>
          <div class="setting-row"><span class="sr-label">RPC</span><span class="t-mono" style="font-size:11px">${rpcFor(wallet.network)}</span></div>
        </div>
        <div class="settings-section"><div class="ss-title">ABOUT</div><div class="about-box"><div class="about-logo">◎ SolanaOS</div><div class="about-ver">v1.0.0 • TypeScript + Vite</div><div class="about-desc">Browser OS for mining, AI training, earning $SOLANA — fully typed.</div><div class="about-links"><a class="about-link" href="#">GitHub</a><a class="about-link" href="#">Docs</a></div></div></div>
      </div>
    </div>`
}

let walletTab: 'connect'|'solana'|'txns'='connect'
let trainTab: 'local'|'network'='local'
let chatOpen=false, chatModel:string|null=null
let chatMessages:{role:'user'|'bot', text:string}[]=[]
let txns:{label:string, amount:string}[]=[]

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
    setWallet(v); toast('Credit address set','success'); renderWindows()
  })
  document.querySelectorAll('[data-wtab]').forEach(b=> b.addEventListener('click',()=>{ walletTab=(b as HTMLElement).dataset.wtab as any; renderWindows() }))
  $('#btn-phantom')?.addEventListener('click',()=>{ const a='Phantom'+Math.random().toString(36).slice(2,8)+'1111111111111111111111'; setWallet(a); txns.unshift({label:'Phantom connected',amount:'+0.00'}); toast('Phantom connected','success'); renderWindows() })
  $('#btn-solflare')?.addEventListener('click',()=>{ const a='Solflare'+Math.random().toString(36).slice(2,8)+'2222222222222222222222'; setWallet(a); toast('Solflare connected','success'); renderWindows() })
  $('#btn-set-manual')?.addEventListener('click',()=>{
    const v=($('#manual-addr') as HTMLInputElement)?.value.trim()
    if(!v || v.length<20) return toast('Invalid address','error')
    setWallet(v); toast('Wallet set','success'); renderWindows()
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
  $('#btn-start-train')?.addEventListener('click',()=>{
    const log=$('#train-log')!
    log.innerHTML+=`<div class="log-line">> starting local training… epochs=${($('#train-epochs') as HTMLInputElement)?.value}</div>`
    let p=0; const iv=window.setInterval(()=>{
      p+=12; log.innerHTML+=`<div class="log-line">> epoch ${Math.floor(p/30)}/3 — loss ${(2-p/60).toFixed(3)}</div>`; log.scrollTop=log.scrollHeight
      if(p>=100){ clearInterval(iv); log.innerHTML+=`<div class="log-line" style="color:#14F195">> training complete — model saved</div>`; toast('Training complete','success')}
    },500)
  })
  $('#btn-dispatch')?.addEventListener('click',()=> toast('Dispatched to GPU Node #001 (mock)','success'))
  $('#btn-import')?.addEventListener('click',()=> $('#ds-file')?.click())
  $('#ds-file')?.addEventListener('change',(e)=>{
    const f=(e.target as HTMLInputElement).files?.[0]; if(!f) return
    const r=new FileReader(); r.onload=()=>{ const prev=$('#ds-preview'); if(prev) prev.textContent=String(r.result).slice(0,1200) }; r.readAsText(f); toast(`Imported ${f.name}`,'success')
  })
  document.querySelectorAll('[data-preview]').forEach(el=> el.addEventListener('click',()=>{
    const n=(el as HTMLElement).dataset.preview!
    const prev=$('#ds-preview'); if(prev) prev.innerHTML=`<b>${n}</b><br/><br/>{"prompt":"What is Solana?","completion":"Solana is high-throughput blockchain..."}`
  }))
  document.querySelectorAll('[data-train]').forEach(b=> b.addEventListener('click',(e)=>{ e.stopPropagation(); openApp('train'); trainTab='local'; renderWindows(); toast('Training on dataset…','info')}))
  $('#btn-refresh-models')?.addEventListener('click',()=> toast('Models refreshed','info'))
  document.querySelectorAll('[data-chat]').forEach(b=> b.addEventListener('click',()=>{ chatOpen=true; chatModel=(b as HTMLElement).dataset.chat!; chatMessages=[{role:'bot',text:'Hi! I am '+chatModel+' — ask me about Solana.'}]; renderWindows() }))
  document.querySelectorAll('[data-export]').forEach(b=> b.addEventListener('click',()=> toast('Exported '+ (b as HTMLElement).dataset.export,'success')))
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
  if(q.toLowerCase().includes('solana')) return 'Solana is high-performance L1 with ~400ms blocks and low fees. SolanaOS lets you mine credits and train models on it.'
  if(q.toLowerCase().includes('mining')) return 'Mining here is browser-based PoW that earns credits → $SOLANA. Use miner.exe!'
  return 'Nice question! (TS mock) Ask me about DeFi, NFTs, or validators.'
}
function drawMap(){
  const c=$('#map-canvas') as HTMLCanvasElement | null
  if(!c) return
  const ctx=c.getContext('2d')!
  ctx.clearRect(0,0,c.width,c.height)
  ctx.fillStyle='rgba(255,255,255,.04)'; ctx.fillRect(0,0,c.width,c.height)
  const pts=[{x:100,y:80},{x:260,y:60},{x:420,y:100},{x:180,y:160},{x:380,y:170}]
  ctx.strokeStyle='rgba(153,69,255,.35)'; (ctx as any).lineWidth=1.2
  pts.forEach((a,i)=> pts.slice(i+1).forEach(b=>{ ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke() }))
  pts.forEach((p,i)=>{
    ctx.fillStyle= i<2 ? '#14F195' : i===2 ? '#FFD23F' : 'rgba(255,255,255,.9)'
    ctx.beginPath(); ctx.arc(p.x,p.y,7,0,Math.PI*2); ctx.fill()
    ctx.fillStyle='white'; ctx.font='10px JetBrains Mono'; ctx.fillText('NODE #'+(i+1), p.x-24, p.y-12)
  })
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
    if(m.accepted%5===0) txns.unshift({label:`Mining reward +0.0007 cr`, amount:'+0.0007 cr'})
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

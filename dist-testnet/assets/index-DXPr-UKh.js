(function(){const s=document.createElement("link").relList;if(s&&s.supports&&s.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))a(n);new MutationObserver(n=>{for(const i of n)if(i.type==="childList")for(const c of i.addedNodes)c.tagName==="LINK"&&c.rel==="modulepreload"&&a(c)}).observe(document,{childList:!0,subtree:!0});function e(n){const i={};return n.integrity&&(i.integrity=n.integrity),n.referrerPolicy&&(i.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?i.credentials="include":n.crossOrigin==="anonymous"?i.credentials="omit":i.credentials="same-origin",i}function a(n){if(n.ep)return;n.ep=!0;const i=e(n);fetch(n.href,i)}})();const tt="solanaos:wallet",rt="solanaos:sol",pt="solanaos:solx",D="solanaos:miner-balance",st="solanaos:miner-session",vt="testnet",K="https://api.testnet.solana.com",r={address:localStorage.getItem(tt),sol:Number(localStorage.getItem(rt)??"0"),solx:Number(localStorage.getItem(pt)??"0"),network:localStorage.getItem("solanaos:network")??vt},o={running:!1,intensity:75,hashrate:0,shares:0,accepted:0,session:Number(localStorage.getItem(st)??"0"),balance:Number(localStorage.getItem(D)??"0"),difficulty:4200};let Y,V,P=0,L=null,w=null;function J(t){const s=String(Math.floor(t/3600)).padStart(2,"0"),e=String(Math.floor(t%3600/60)).padStart(2,"0"),a=String(t%60).padStart(2,"0");return`${s}:${e}:${a}`}function bt(t){L=t}function ft(t){w=t}function gt(){o.running||(o.running=!0,P=0,V=window.setInterval(()=>{const t=800+o.intensity*18+Math.random()*400;o.hashrate=Math.round(t),Math.random()<.18+o.intensity/600&&(o.shares++,Math.random()<.82&&(o.accepted++,o.session+=7e-4+Math.random()*8e-4,o.balance=o.session+Number(localStorage.getItem(D)??"0"))),localStorage.setItem(st,String(o.session)),L==null||L(o,J(P)),w==null||w()},600),Y=window.setInterval(()=>{P++,L==null||L(o,J(P))},1e3))}function ht(){o.running=!1,o.hashrate=0,V&&clearInterval(V),Y&&clearInterval(Y);const t=Number(localStorage.getItem(D)??"0")+o.session;localStorage.setItem(D,String(t)),o.balance=t,o.session=0,localStorage.setItem(st,"0"),L==null||L(o,J(P)),w==null||w()}function wt(t){o.intensity=t}function F(){return`${r.sol.toFixed(4)} SOL`}function G(){return r.solx.toFixed(2)}function W(t){r.address=t,r.sol=1.24+Math.random()*2,r.solx=o.balance*1200+Math.random()*50,localStorage.setItem(tt,t),localStorage.setItem(rt,String(r.sol)),localStorage.setItem(pt,String(r.solx)),w==null||w()}function xt(){r.address=null,localStorage.removeItem(tt),w==null||w()}function yt(t){r.network=t,localStorage.setItem("solanaos:network",t),w==null||w()}function ot(t){return t===vt&&K?K:t==="mainnet-beta"?"https://api.mainnet-beta.solana.com":t==="testnet"?K:"https://api.devnet.solana.com"}let T=10,b=[],g=null,A=localStorage.getItem("solanaos:wallpaper")??"aurora";const _=new Map,R={miner:{title:"miner.exe",icon:"⛏️"},wallet:{title:"wallet.exe",icon:"👛"},train:{title:"train.exe",icon:"🤖"},datasets:{title:"datasets",icon:"📁"},models:{title:"models",icon:"🧠"},sysinfo:{title:"sysinfo",icon:"🖥️"},taskmgr:{title:"taskmgr",icon:"📊"},network:{title:"network",icon:"🌐"},leaderboard:{title:"leaderboard",icon:"🏆"},settings:{title:"settings",icon:"⚙️"}},d=t=>document.querySelector(t),St=t=>{const s=document.createElement("template");return s.innerHTML=t.trim(),s.content.firstElementChild};function u(t,s="info"){const e=document.getElementById("toasts");if(!e)return;const a=St(`<div class="toast ${s}">${t}</div>`);e.appendChild(a),setTimeout(()=>a.remove(),2600)}function $t(){return`
  <div id="wallpaper" class="wallpaper wallpaper-${A}"></div>
  <div id="desktop-icons" class="desktop-icons">
    ${Object.entries(R).map(([t,s])=>`
      <div class="desktop-icon" data-open="${t}">
        <div class="icon-img">${s.icon}</div><span>${s.title}</span>
      </div>`).join("")}
  </div>
  <div class="desktop-branding">
    <div class="pixel-logo-text">SolanaOS</div>
    <div class="pixel-tagline">MINE WITH YOUR GPU<br/>EARN $SOLX ON SOLANA</div>
    <div class="brand-stats">
      <div class="brand-pill"><span class="dot"></span> <b id="brand-hash">0 H/s</b> hashrate</div>
      <div class="brand-pill">◎ <b id="brand-sol">${F()}</b></div>
      <div class="brand-pill">$SOLX <b id="brand-solx">${G()}</b></div>
    </div>
  </div>
  <div id="windows-container"></div>
  <div class="mobile-scrim" id="mobile-scrim"></div>
  <div class="mobile-dock-hint" id="mobile-hint">tap icon • swipe ↓ minimize</div>
  <div id="taskbar" class="taskbar">
    <button class="taskbar-start-btn" id="start-btn"><span class="sol-icon">◎</span> SOLANA</button>
    <div class="taskbar-apps" id="taskbar-apps"></div>
    <div class="taskbar-tray">
      <div class="tray-item tray-balance" data-open="wallet"><span class="sol-icon">◎</span> <span id="tray-sol">${F()}</span></div>
      <div class="tray-item" data-open="wallet"><span id="tray-wallet-text">${r.address?r.address.slice(0,4)+"…"+r.address.slice(-4):"no wallet"}</span></div>
      <div class="tray-item" data-open="wallet"><span>$SOLX</span> <span id="tray-solx">${G()}</span></div>
      <div class="tray-item tray-network"><span class="net-dot"></span><span id="tray-net">${r.network}</span></div>
      <div class="tray-time" id="tray-time">00:00</div>
    </div>
  </div>
  <div id="start-menu" class="start-menu hidden">
    <div class="start-menu-header"><div class="start-logo">◎ SolanaOS</div><div class="start-version">v1.0.0 • TS</div></div>
    <div class="start-menu-items">
      ${Object.entries(R).map(([t,s])=>`<div class="start-item" data-open="${t}">${s.icon} ${s.title}</div>`).join("")}
    </div>
  </div>
  <div id="toasts" style="position:fixed;right:12px;bottom:66px;z-index:90;display:flex;flex-direction:column;gap:8px;pointer-events:none"></div>
  <style>
    .toast{padding:10px 14px;border-radius:10px;background:rgba(17,17,31,.97);border:1px solid rgba(255,255,255,.08);color:white;font-size:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);animation:toastIn .18s ease}
    @keyframes toastIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    .toast.success{border-color:rgba(20,241,149,.4)} .toast.error{border-color:rgba(255,77,106,.45)}
    .taskbar-app.minimized{opacity:.6;border-style:dashed}
    .window.active-win{box-shadow:0 24px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(153,69,255,.22) !important}
  </style>
  `}function M(t){const s=b.find(y=>y.appId===t);if(s){s.minimized?(s.minimized=!1,g=s.id,s.z=++T,$(20),f(),u(`${R[t].title} restored`,"info")):(mt(s.id),$(10));return}const e=Math.min(720,window.innerWidth-24),a=Math.min(520,window.innerHeight-80),n=84+b.length%6*28,i=24+b.length%6*24,c=k(),v={id:`win-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,appId:t,title:R[t].title,icon:R[t].icon,x:n,y:i,w:e,h:a,z:++T,minimized:!1,maximized:c};c&&$(25),b.push(v),g=v.id,f()}function mt(t){g=t;const s=b.find(e=>e.id===t);s&&(s.z=++T),X()}function Et(t){const s=b.find(e=>e.id===t);if(b=b.filter(e=>e.id!==t),g===t){const e=b.filter(a=>!a.minimized);g=e.length?e.sort((a,n)=>n.z-a.z)[0].id:null}f(),N(),s&&u(`${s.title} closed`,"info")}function U(t){const s=b.find(a=>a.id===t);if(!s)return;s.minimized=!0;const e=b.filter(a=>!a.minimized);g=e.length?e.sort((a,n)=>n.z-a.z)[0].id:null,f(),N(),u(`${s.title} minimized — klik di taskbar untuk restore`,"info")}function ut(t){const s=b.find(e=>e.id===t);if(s){if(!s.maximized)_.set(t,{x:s.x,y:s.y,w:s.w,h:s.h}),s.maximized=!0,u(`${s.title} maximized — semua fitur terlihat`,"success");else{const e=_.get(t);e&&(s.x=e.x,s.y=e.y,s.w=e.w,s.h=e.h,_.delete(t)),s.maximized=!1}g=t,s.z=++T,f(),N()}}function N(){const t=b.some(e=>e.maximized&&!e.minimized);document.body.classList.toggle("has-maximized",t);const s=document.getElementById("mobile-hint");if(s){const e=window.matchMedia("(max-width:760px)").matches;s.style.display=e&&!t&&b.filter(n=>!n.minimized).length===0?"flex":"none";const a=document.getElementById("mobile-scrim");a&&(a.style.display=e&&t?"block":"none")}}const k=()=>window.matchMedia("(max-width:760px)").matches,$=(t=18)=>{var s;try{(s=navigator.vibrate)==null||s.call(navigator,t)}catch{}};function X(){document.querySelectorAll("[data-win-id]").forEach(t=>{const s=b.find(e=>e.id===t.dataset.winId);s&&(t.style.zIndex=String(s.z)),t.classList.toggle("active-win",t.dataset.winId===g)}),document.querySelectorAll("[data-focus]").forEach(t=>{const s=t.dataset.focus,e=b.find(n=>n.id===s),a=s===g&&!(e!=null&&e.minimized);t.classList.toggle("active",a),t.classList.toggle("minimized",!!(e!=null&&e.minimized))})}let dt=!1;function f(){const t=d("#windows-container"),s=d("#taskbar-apps");if(!dt){dt=!0,t.addEventListener("click",a=>{const n=a.target,i=n.closest("[data-close]");if(i){a.stopPropagation(),Et(i.dataset.close);return}const c=n.closest("[data-min]");if(c){a.stopPropagation(),U(c.dataset.min);return}const v=n.closest("[data-max]");if(v){a.stopPropagation(),ut(v.dataset.max);return}});const e=a=>{const n=a.target.closest("[data-win-id]");if(!n||a.target.closest(".win-controls"))return;const i=n.dataset.winId;if(g!==i){$(10),g=i;const c=b.find(v=>v.id===i);c&&(c.z=++T),X()}};t.addEventListener("pointerdown",e),t.addEventListener("touchstart",e,{passive:!0}),t.addEventListener("mousedown",a=>{const n=a.target.closest("[data-win-id]");if(!n||a.target.closest(".win-controls"))return;const i=n.dataset.winId;if(g!==i){g=i;const c=b.find(v=>v.id===i);c&&(c.z=++T),X()}})}s.innerHTML=b.map(e=>`
    <button class="taskbar-app ${g===e.id&&!e.minimized?"active":""} ${e.minimized?"minimized":""}" data-focus="${e.id}" title="${e.minimized?"Klik untuk restore":"Klik untuk minimize"}">${e.icon} ${e.title}${e.minimized?" •":""}</button>
  `).join(""),s.querySelectorAll("[data-focus]").forEach(e=>{e.addEventListener("click",()=>{const a=e.dataset.focus,n=b.find(i=>i.id===a);n.minimized?(n.minimized=!1,g=a,n.z=++T,f()):g===a?U(a):mt(a)})}),t.querySelectorAll("[data-win-id]").forEach(e=>e.remove());for(const e of b){if(e.minimized)continue;const a=e.maximized,n=document.createElement("div");n.className=`window ${a?"maximized":""} ${g===e.id?"active-win":""}`,n.style.left=e.x+"px",n.style.top=e.y+"px",n.style.width=e.w+"px",n.style.height=e.h+"px",n.style.zIndex=String(e.z),n.dataset.winId=e.id,n.innerHTML=`
      <div class="window-header" data-drag="${e.id}">
        <div class="win-title">${e.icon} ${e.title} ${a?'<span style="opacity:.5;font-size:10px;margin-left:6px">[MAXIMIZED — semua fitur terlihat]</span>':""}</div>
        <div class="win-controls">
          <button class="win-btn" data-min="${e.id}" title="Minimize" aria-label="Minimize">—</button>
          <button class="win-btn" data-max="${e.id}" title="${a?"Restore":"Maximize"}" aria-label="${a?"Restore":"Maximize"}">${a?"❐":"□"}</button>
          <button class="win-btn close" data-close="${e.id}" title="Close" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="window-body">${kt(e.appId)}</div>
    `,t.appendChild(n)}Lt(),Tt(),et()}function Lt(){document.querySelectorAll("[data-drag]").forEach(t=>{const s=t.dataset.drag,e=b.find(m=>m.id===s);if(!e)return;let a=0,n=0,i=0,c=0,v=!1,y=0,S=0;t.addEventListener("dblclick",m=>{m.target.closest(".win-controls")||($(15),ut(s))}),t.addEventListener("touchstart",m=>{k()&&(y=m.touches[0].clientY,S=0)},{passive:!0}),t.addEventListener("touchmove",m=>{if(k()&&(S=m.touches[0].clientY-y,S>0)){const E=document.querySelector(`[data-win-id="${s}"]`);E&&(E.style.transform=`translateY(${Math.min(S,180)}px)`,E.style.opacity=String(1-Math.min(S/260,.35)))}},{passive:!0}),t.addEventListener("touchend",()=>{const m=document.querySelector(`[data-win-id="${s}"]`);if(m&&(m.style.transform="",m.style.opacity=""),S>90){$(18),U(s);return}S>40&&($(10),m&&(m.classList.add("shake"),setTimeout(()=>m.classList.remove("shake"),300))),S=0});const C=m=>{e.maximized&&!k()||k()||m.target.closest(".win-controls")||(v=!0,a=m.clientX,n=m.clientY,i=e.x,c=e.y,t.setPointerCapture(m.pointerId),g!==s&&(g=s,e.z=++T,X()),m.preventDefault())},H=m=>{if(!v)return;e.x=Math.max(0,i+m.clientX-a),e.y=Math.max(0,c+m.clientY-n);const E=document.querySelector(`[data-win-id="${s}"]`);E&&(E.style.left=e.x+"px",E.style.top=e.y+"px")},z=()=>{v=!1};t.addEventListener("pointerdown",C),t.addEventListener("pointermove",H),t.addEventListener("pointerup",z),t.addEventListener("pointercancel",z)})}function kt(t){return t==="miner"?`
    <div class="app-content">
      <div class="app-toolbar">
        <button class="btn-pixel ${o.running?"btn-red":"btn-green"}" id="btn-mining">${o.running?"■ STOP MINING":"▶ START MINING"}</button>
        <span class="toolbar-label">INTENSITY</span>
        <input type="range" id="intensity" min="1" max="100" value="${o.intensity}" class="pixel-slider" />
        <span id="intensity-val">${o.intensity}%</span>
        <input type="text" id="credit-addr" placeholder="Solana address to credit" class="pixel-input addr-input" value="${r.address??""}" />
        <button class="btn-pixel btn-outline" id="use-addr">USE</button>
      </div>
      <div class="terminal-box">
        <div class="terminal-header">─ solanaOS miner ─ TypeScript Edition ─</div>
        <div class="terminal-grid">
          <span class="t-label">backend</span><span class="t-val" id="m-backend">${o.running?"webgpu":"idle"}</span>
          <span class="t-label">hashrate</span><span class="t-val t-green" id="m-hashrate">${o.hashrate} H/s</span>
          <span class="t-label">difficulty</span><span class="t-val" id="m-diff">${o.difficulty.toLocaleString()}</span>
          <span class="t-label">shares</span><span class="t-val" id="m-shares">${o.shares} found</span>
          <span class="t-label">accepted</span><span class="t-val t-green" id="m-accepted">${o.accepted}</span>
          <span class="t-label">session</span><span class="t-val t-sol" id="m-session">+${o.session.toFixed(4)} cr</span>
          <span class="t-label">balance</span><span class="t-val t-sol" id="m-balance">${o.balance.toFixed(4)} cr</span>
          <span class="t-label">uptime</span><span class="t-val" id="m-uptime">00:00:00</span>
          <span class="t-label">status</span><span class="t-val ${o.running?"t-green":"t-yellow"}" id="m-status">${o.running?"mining":"stopped"}</span>
        </div>
        <div class="terminal-progress"><div class="progress-inner" id="m-progress" style="width:${o.running?o.intensity+"%":"0%"}"></div></div>
        <div class="terminal-log" id="miner-log"><div class="log-line"><span class="log-time">${new Date().toLocaleTimeString()}</span> &gt; miner.exe ready. ${r.address?"Address set.":"Connect wallet and start mining."}</div></div>
      </div>
    </div>`:t==="wallet"?`
    <div class="app-content">
      <div class="wallet-tabs">
        <button class="wallet-tab ${I==="connect"?"active":""}" data-wtab="connect">CONNECT</button>
        <button class="wallet-tab ${I==="solx"?"active":""}" data-wtab="solx">$SOLX TOKEN</button>
        <button class="wallet-tab ${I==="txns"?"active":""}" data-wtab="txns">TRANSACTIONS</button>
      </div>
      <div class="wallet-panel ${I!=="connect"?"hidden":""}">
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
            <input type="text" id="manual-addr" placeholder="Solana wallet address (base58)" class="pixel-input full-input" value="${r.address??""}" />
            <button class="btn-pixel btn-outline" id="btn-set-manual">SET</button>
          </div>
          <div class="wallet-info-box" style="${r.address?"":"display:none"}" id="wallet-info">
            <div class="wi-row"><span class="wi-label">Address</span><span class="wi-val" style="font-size:10px">${r.address??"—"}</span></div>
            <div class="wi-row"><span class="wi-label">SOL Balance</span><span class="wi-val t-green">${r.sol.toFixed(3)} SOL</span></div>
            <div class="wi-row"><span class="wi-label">$SOLX Balance</span><span class="wi-val t-sol">${r.solx.toFixed(2)} SOLX</span></div>
            <div class="wi-row"><span class="wi-label">Network</span><span class="wi-val">${r.network}</span></div>
            <button class="btn-pixel btn-red btn-sm" id="btn-disconnect">DISCONNECT</button>
          </div>
        </div>
      </div>
      <div class="wallet-panel ${I!=="solx"?"hidden":""}">
        <div class="token-info">
          <div class="token-header"><div class="token-badge">$SOLX</div><div class="token-name">SolanaOS Token (TS)</div></div>
          <div class="token-stats">
            <div class="token-stat"><div class="ts-label">YOUR BALANCE</div><div class="ts-val t-sol">${r.solx.toFixed(2)} SOLX</div></div>
            <div class="token-stat"><div class="ts-label">TOTAL SUPPLY</div><div class="ts-val">1,000,000,000</div></div>
            <div class="token-stat"><div class="ts-label">PRICE</div><div class="ts-val t-green">$0.0042</div></div>
            <div class="token-stat"><div class="ts-label">MARKET CAP</div><div class="ts-val">$4.2M</div></div>
          </div>
          <div class="token-mint-row"><span class="t-label">Mint</span><span class="t-val t-mono" style="font-size:10px">SoLx…TSv1 • SPL Token</span></div>
          <div class="token-actions"><button class="btn-pixel btn-sol-purple" id="btn-add-token">+ Add to Wallet</button><button class="btn-pixel btn-outline" id="btn-explorer">View on Explorer</button></div>
        </div>
      </div>
      <div class="wallet-panel ${I!=="txns"?"hidden":""}">
        <div class="txn-list" id="txn-list">
          ${j.length?j.map(s=>`<div class="txn-item"><span>${s.label}</span><span class="t-sol">${s.amount}</span></div>`).join(""):'<div class="txn-empty">No transactions yet. Start mining to earn $SOLX!</div>'}
        </div>
      </div>
    </div>`:t==="train"?`
    <div class="app-content">
      <div class="train-tabs">
        <button class="train-tab ${B==="local"?"active":""}" data-ttab="local">LOCAL TRAINING</button>
        <button class="train-tab ${B==="network"?"active":""}" data-ttab="network">NETWORK TRAINING</button>
      </div>
      ${B==="local"?`
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
        <div>Your Credits: <span class="t-sol">${o.balance.toFixed(2)} cr</span></div>
        <button class="btn-pixel btn-sol-purple full-btn" id="btn-dispatch">DISPATCH JOB</button>
      </div>`}
    </div>`:t==="datasets"?`
    <div class="app-content">
      <div class="datasets-header"><button class="btn-pixel btn-outline" id="btn-import">+ Import Dataset</button><input type="file" id="ds-file" style="display:none" accept=".jsonl,.csv,.txt" /></div>
      <div class="datasets-list">
        ${["solana-docs.jsonl","defi-glossary.jsonl","nft-descriptions.txt"].map(s=>`
          <div class="dataset-item" data-preview="${s}"><div class="di-icon">📄</div><div class="di-info"><div class="di-name">${s}</div><div class="di-meta">${Math.round(500+Math.random()*1500)} rows</div></div><button class="btn-pixel btn-sm btn-sol-purple" data-train="${s}">Train</button></div>
        `).join("")}
      </div>
      <div class="dataset-preview" id="ds-preview"><div class="preview-placeholder">Select a dataset to preview — TypeScript file reader active.</div></div>
    </div>`:t==="models"?`
    <div class="app-content">
      <div class="models-header"><span>Trained Models & LoRA Adapters</span><button class="btn-pixel btn-outline btn-sm" id="btn-refresh-models">↻ Refresh</button></div>
      <div class="models-list">
        <div class="model-item"><div class="model-icon">🤖</div><div class="model-info"><div class="model-name">solana-gpt2-lora-v1</div><div class="model-meta">Base: GPT-2 · 2.1MB · local</div></div><div class="model-actions"><button class="btn-pixel btn-sm btn-green" data-chat="solana-gpt2-lora-v1">Chat</button><button class="btn-pixel btn-sm btn-outline" data-export="solana-gpt2-lora-v1">Export</button></div></div>
      </div>
      <div class="model-chat" id="model-chat" style="display:${Z?"block":"none"}">
        <div class="chat-header"><span id="chat-title">${Q??"Model Chat"}</span><button class="btn-pixel btn-sm btn-red" id="btn-close-chat">✕ Close</button></div>
        <div class="chat-messages" id="chat-messages">${q.map(s=>`<div class="chat-bubble ${s.role}">${s.text}</div>`).join("")}</div>
        <div class="chat-input-row"><input type="text" class="pixel-input chat-input" id="chat-input" placeholder="Type a message..." /><button class="btn-pixel btn-sol-purple" id="btn-send-chat">SEND</button></div>
      </div>
    </div>`:t==="sysinfo"?`
    <div class="app-content">
      <div class="sysinfo-grid">
        <div class="si-section"><div class="si-title">SYSTEM</div>
          <div class="si-row"><span class="si-key">OS</span><span class="si-val">${navigator.platform}</span></div>
          <div class="si-row"><span class="si-key">Cores</span><span class="si-val">${navigator.hardwareConcurrency}</span></div>
          <div class="si-row"><span class="si-key">UA</span><span class="si-val" style="font-size:10px">${navigator.userAgent.slice(0,42)}…</span></div>
        </div>
        <div class="si-section"><div class="si-title">GPU / WEBGPU</div>
          <div class="si-row"><span class="si-key">WebGPU</span><span class="si-val" id="si-webgpu">${navigator.gpu?"supported":"not supported"}</span></div>
          <div class="si-row"><span class="si-key">WebGL</span><span class="si-val" id="si-webgl">—</span></div>
        </div>
        <div class="si-section"><div class="si-title">SOLANA NETWORK</div>
          <div class="si-row"><span class="si-key">Network</span><span class="si-val t-sol">${r.network}</span></div>
          <div class="si-row"><span class="si-key">RPC</span><span class="si-val t-mono si-rpc">${ot(r.network)}</span></div>
          <div class="si-row"><span class="si-key">Slot</span><span class="si-val t-green" id="si-slot">—</span></div>
        </div>
        <div class="si-section"><div class="si-title">BENCHMARK</div><button class="btn-pixel btn-outline full-btn" id="btn-bench">▶ Run Benchmark</button><div class="benchmark-chart" id="bench-chart"><div class="bench-placeholder">Press benchmark to test CPU hashrate (TS Worker)</div></div></div>
      </div>
    </div>`:t==="taskmgr"?`
    <div class="app-content">
      <div class="taskmgr-grid">
        <div class="tm-stats">
          <div class="tm-stat-card"><div class="tm-sc-label">YOUR HASHRATE</div><div class="tm-sc-val t-green">${o.hashrate} H/s</div></div>
          <div class="tm-stat-card"><div class="tm-sc-label">NETWORK HASHRATE</div><div class="tm-sc-val">42.8 MH/s</div></div>
          <div class="tm-stat-card"><div class="tm-sc-label">ACTIVE MINERS</div><div class="tm-sc-val t-sol">${124+o.shares%40}</div></div>
          <div class="tm-stat-card"><div class="tm-sc-label">TOTAL CREDITS</div><div class="tm-sc-val">${o.balance.toFixed(2)}</div></div>
        </div>
        <div class="tm-processes">
          <div class="tm-proc-header"><span>PROCESS</span><span>STATUS</span><span>CPU</span><span>MEM</span></div>
          <div class="tm-proc-row"><span>⛏️ miner.exe</span><span class="proc-status ${o.running?"running":"stopped"}">${o.running?"running":"stopped"}</span><span>${o.running?(12+o.intensity/5).toFixed(0)+"%":"0%"}</span><span>—</span></div>
          <div class="tm-proc-row"><span>🤖 train.exe</span><span class="proc-status stopped">stopped</span><span>0%</span><span>—</span></div>
          <div class="tm-proc-row"><span>👛 wallet.exe</span><span class="proc-status running">idle</span><span>0%</span><span>2.1MB</span></div>
        </div>
      </div>
    </div>`:t==="network"?`
    <div class="app-content">
      <div class="network-tabs"><button class="network-tab active">GPU NODES</button><button class="network-tab">MINERS</button></div>
      <div class="node-list">
        <div class="node-item"><div class="node-status-dot online"></div><div class="node-info"><div class="node-name">GPU Node #001</div><div class="node-meta">RTX 4090 · 24GB · TS Worker</div></div><span class="t-green">ONLINE</span></div>
        <div class="node-item"><div class="node-status-dot online"></div><div class="node-info"><div class="node-name">GPU Node #002</div><div class="node-meta">RTX 3080 · 12GB · 1 job</div></div><span class="t-green">ONLINE</span></div>
        <div class="node-item"><div class="node-status-dot offline"></div><div class="node-info"><div class="node-name">GPU Node #003</div><div class="node-meta">A100 · 80GB · offline</div></div><span class="t-yellow">OFFLINE</span></div>
      </div>
      <div class="network-map" style="margin-top:10px"><canvas id="map-canvas" width="600" height="220" style="width:100%"></canvas></div>
    </div>`:t==="leaderboard"?`
    <div class="app-content">
      <div class="lb-tabs"><button class="lb-tab active">24H</button><button class="lb-tab">ALL TIME</button></div>
      <div class="lb-table">
        <div class="lb-header"><span>#</span><span>WALLET</span><span>HARDWARE</span><span>HASHES</span><span>CREDITS</span></div>
        ${[["🥇","5KJG…7xNw","RTX 4090","1.2M","142.4"],["🥈","9aXP…mR3q","RTX 3090","890K","98.1"],["🥉","DK2R…pQ9s","RX 6900XT","621K","67.3"]].map(s=>`<div class="lb-row"><span>${s[0]}</span><span class="lb-addr">${s[1]}</span><span>${s[2]}</span><span>${s[3]}</span><span class="t-sol">${s[4]} cr</span></div>`).join("")}
        ${r.address?`<div class="lb-row" style="background:rgba(153,69,255,.12)"><span>•</span><span class="lb-addr">${r.address.slice(0,6)}…</span><span>Your Rig</span><span>${o.shares}</span><span class="t-sol">${o.balance.toFixed(2)} cr</span></div>`:""}
      </div>
    </div>`:`
    <div class="app-content">
      <div class="settings-sections">
        <div class="settings-section"><div class="ss-title">WALLPAPER</div><div class="wallpaper-options">
          ${["aurora","dusk","night","neon"].map(s=>`<div class="wp-opt ${A===s?"active":""}" data-wp="${s}">${s}</div>`).join("")}
        </div></div>
        <div class="settings-section"><div class="ss-title">SOLANA NETWORK</div>
          <div class="setting-row"><span class="sr-label">Network</span><select class="pixel-select" id="setting-net"><option value="devnet" ${r.network==="devnet"?"selected":""}>Devnet</option><option value="mainnet-beta" ${r.network==="mainnet-beta"?"selected":""}>Mainnet</option><option value="testnet" ${r.network==="testnet"?"selected":""}>Testnet</option></select></div>
          <div class="setting-row"><span class="sr-label">RPC</span><span class="t-mono" style="font-size:11px">${ot(r.network)}</span></div>
        </div>
        <div class="settings-section"><div class="ss-title">ABOUT</div><div class="about-box"><div class="about-logo">◎ SolanaOS</div><div class="about-ver">v1.0.0 • TypeScript + Vite</div><div class="about-desc">Browser OS for mining, AI training, earning $SOLX — fully typed.</div><div class="about-links"><a class="about-link" href="#">GitHub</a><a class="about-link" href="#">Docs</a></div></div></div>
      </div>
    </div>`}let I="connect",B="local",Z=!1,Q=null,q=[],j=[];function Tt(){var t,s,e,a,n,i,c,v,y,S,C,H,z,m,E,nt,at,it,lt;(t=d("#btn-mining"))==null||t.addEventListener("click",()=>{if(o.running)ht(),u("Mining stopped","info");else{if(!r.address){u("Connect wallet first","error"),M("wallet");return}gt(),u("Mining started ⛏️","success")}f()}),(s=d("#intensity"))==null||s.addEventListener("input",l=>{const p=Number(l.target.value);wt(p);const h=d("#intensity-val");h&&(h.textContent=p+"%");const x=d("#m-progress");x&&(x.style.width=p+"%")}),(e=d("#use-addr"))==null||e.addEventListener("click",()=>{var p;const l=(p=d("#credit-addr"))==null?void 0:p.value.trim();if(!l)return u("Enter address","error");W(l),u("Credit address set","success"),f()}),document.querySelectorAll("[data-wtab]").forEach(l=>l.addEventListener("click",()=>{I=l.dataset.wtab,f()})),(a=d("#btn-phantom"))==null||a.addEventListener("click",()=>{const l="Phantom"+Math.random().toString(36).slice(2,8)+"1111111111111111111111";W(l),j.unshift({label:"Phantom connected",amount:"+0.00"}),u("Phantom connected","success"),f()}),(n=d("#btn-solflare"))==null||n.addEventListener("click",()=>{const l="Solflare"+Math.random().toString(36).slice(2,8)+"2222222222222222222222";W(l),u("Solflare connected","success"),f()}),(i=d("#btn-set-manual"))==null||i.addEventListener("click",()=>{var p;const l=(p=d("#manual-addr"))==null?void 0:p.value.trim();if(!l||l.length<20)return u("Invalid address","error");W(l),u("Wallet set","success"),f()}),(c=d("#btn-disconnect"))==null||c.addEventListener("click",()=>{xt(),u("Disconnected","info"),f()}),(v=d("#btn-add-token"))==null||v.addEventListener("click",()=>u("Token added to wallet (mock)","success")),(y=d("#btn-explorer"))==null||y.addEventListener("click",()=>u("Opening explorer… (devnet)","info")),document.querySelectorAll("[data-ttab]").forEach(l=>l.addEventListener("click",()=>{B=l.dataset.ttab,f()})),(S=d("#btn-start-train"))==null||S.addEventListener("click",()=>{var x;const l=d("#train-log");l.innerHTML+=`<div class="log-line">> starting local training… epochs=${(x=d("#train-epochs"))==null?void 0:x.value}</div>`;let p=0;const h=window.setInterval(()=>{p+=12,l.innerHTML+=`<div class="log-line">> epoch ${Math.floor(p/30)}/3 — loss ${(2-p/60).toFixed(3)}</div>`,l.scrollTop=l.scrollHeight,p>=100&&(clearInterval(h),l.innerHTML+='<div class="log-line" style="color:#14F195">> training complete — model saved</div>',u("Training complete","success"))},500)}),(C=d("#btn-dispatch"))==null||C.addEventListener("click",()=>u("Dispatched to GPU Node #001 (mock)","success")),(H=d("#btn-import"))==null||H.addEventListener("click",()=>{var l;return(l=d("#ds-file"))==null?void 0:l.click()}),(z=d("#ds-file"))==null||z.addEventListener("change",l=>{var x;const p=(x=l.target.files)==null?void 0:x[0];if(!p)return;const h=new FileReader;h.onload=()=>{const O=d("#ds-preview");O&&(O.textContent=String(h.result).slice(0,1200))},h.readAsText(p),u(`Imported ${p.name}`,"success")}),document.querySelectorAll("[data-preview]").forEach(l=>l.addEventListener("click",()=>{const p=l.dataset.preview,h=d("#ds-preview");h&&(h.innerHTML=`<b>${p}</b><br/><br/>{"prompt":"What is Solana?","completion":"Solana is high-throughput blockchain..."}`)})),document.querySelectorAll("[data-train]").forEach(l=>l.addEventListener("click",p=>{p.stopPropagation(),M("train"),B="local",f(),u("Training on dataset…","info")})),(m=d("#btn-refresh-models"))==null||m.addEventListener("click",()=>u("Models refreshed","info")),document.querySelectorAll("[data-chat]").forEach(l=>l.addEventListener("click",()=>{Z=!0,Q=l.dataset.chat,q=[{role:"bot",text:"Hi! I am "+Q+" — ask me about Solana."}],f()})),document.querySelectorAll("[data-export]").forEach(l=>l.addEventListener("click",()=>u("Exported "+l.dataset.export,"success"))),(E=d("#btn-close-chat"))==null||E.addEventListener("click",()=>{Z=!1,f()}),(nt=d("#btn-send-chat"))==null||nt.addEventListener("click",ct),(at=d("#chat-input"))==null||at.addEventListener("keydown",l=>{l.key==="Enter"&&ct()});try{const p=document.createElement("canvas").getContext("webgl"),h=p==null?void 0:p.getExtension("WEBGL_debug_renderer_info"),x=p==null?void 0:p.getParameter(h.UNMASKED_RENDERER_WEBGL),O=d("#si-webgl");O&&x&&(O.textContent=String(x).slice(0,30))}catch{}(it=d("#btn-bench"))==null||it.addEventListener("click",()=>{const l=d("#bench-chart");l.textContent="Benchmarking…";const p=performance.now(),h=performance.now()-p,x=Math.round(6e5/(h/1e3));l.innerHTML=`<div style="display:flex;gap:12px;justify-content:center"><span class="t-green" style="font-weight:800">${x.toLocaleString()} ops/s</span><span>• ${h.toFixed(0)} ms</span></div>`,u(`Benchmark: ${x.toLocaleString()} ops/s`,"success")}),document.querySelectorAll("[data-wp]").forEach(l=>l.addEventListener("click",()=>{A=l.dataset.wp,localStorage.setItem("solanaos:wallpaper",A);const p=d("#wallpaper");p&&(p.className=`wallpaper wallpaper-${A}`),f()})),(lt=d("#setting-net"))==null||lt.addEventListener("change",l=>{yt(l.target.value),f()}),Mt()}function ct(){const t=d("#chat-input");if(!t||!t.value.trim())return;q.push({role:"user",text:t.value});const s=t.value;t.value="",q.push({role:"bot",text:It(s)}),f(),setTimeout(()=>{const e=d("#chat-messages");e&&(e.scrollTop=e.scrollHeight)},50)}function It(t){return t.toLowerCase().includes("solana")?"Solana is high-performance L1 with ~400ms blocks and low fees. SolanaOS lets you mine credits and train models on it.":t.toLowerCase().includes("mining")?"Mining here is browser-based PoW that earns credits → $SOLX. Use miner.exe!":"Nice question! (TS mock) Ask me about DeFi, NFTs, or validators."}function Mt(){const t=d("#map-canvas");if(!t)return;const s=t.getContext("2d");s.clearRect(0,0,t.width,t.height),s.fillStyle="rgba(255,255,255,.04)",s.fillRect(0,0,t.width,t.height);const e=[{x:100,y:80},{x:260,y:60},{x:420,y:100},{x:180,y:160},{x:380,y:170}];s.strokeStyle="rgba(153,69,255,.35)",s.lineWidth=1.2,e.forEach((a,n)=>e.slice(n+1).forEach(i=>{s.beginPath(),s.moveTo(a.x,a.y),s.lineTo(i.x,i.y),s.stroke()})),e.forEach((a,n)=>{s.fillStyle=n<2?"#14F195":n===2?"#FFD23F":"rgba(255,255,255,.9)",s.beginPath(),s.arc(a.x,a.y,7,0,Math.PI*2),s.fill(),s.fillStyle="white",s.font="10px JetBrains Mono",s.fillText("NODE #"+(n+1),a.x-24,a.y-12)})}function et(){const t=(e,a)=>{const n=document.getElementById(e);n&&(n.textContent=a)};t("tray-sol",F()),t("tray-solx",G()),t("tray-net",r.network),t("brand-hash",o.hashrate?`${o.hashrate} H/s`:"0 H/s"),t("brand-sol",F()),t("brand-solx",G());const s=d("#tray-wallet-text");s&&(s.textContent=r.address?r.address.slice(0,4)+"…"+r.address.slice(-4):"no wallet")}bt((t,s)=>{const e=(i,c)=>{const v=document.getElementById(i);v&&(v.textContent=c)};e("m-hashrate",`${t.hashrate} H/s`),e("m-shares",`${t.shares} found`),e("m-accepted",`${t.accepted}`),e("m-session",`+${t.session.toFixed(4)} cr`),e("m-balance",`${t.balance.toFixed(4)} cr`),e("m-uptime",s),e("m-status",t.running?"mining":"stopped"),e("m-backend",t.running?"webgpu/worker":"idle");const a=document.getElementById("m-progress");a&&(a.style.width=t.running?t.intensity+"%":"0%");const n=document.getElementById("miner-log");if(n&&t.running&&Math.random()<.35){const i=document.createElement("div");i.className="log-line",i.innerHTML=`<span class="log-time">${new Date().toLocaleTimeString()}</span> &gt; share #${t.shares} ${t.accepted===t.shares?'<span style="color:#14F195">accepted</span>':"rejected"} • ${t.hashrate} H/s`,n.appendChild(i),n.scrollTop=n.scrollHeight,t.accepted%5===0&&j.unshift({label:"Mining reward +0.0007 cr",amount:"+0.0007 cr"})}et()});ft(et);function At(){var n;const t=document.getElementById("app");t.innerHTML=$t(),t.addEventListener("click",i=>{var y;const v=(y=i.target.closest("[data-open]"))==null?void 0:y.dataset.open;v&&(k()&&$(18),M(v))}),t.addEventListener("dblclick",i=>{var y;if(k())return;const v=(y=i.target.closest("[data-open]"))==null?void 0:y.dataset.open;v&&M(v)});let s=null;t.addEventListener("touchstart",i=>{const c=i.target.closest(".desktop-icon");c&&(c.classList.add("sel"),s=setTimeout(()=>{$(30),c.classList.add("sel")},420))},{passive:!0}),t.addEventListener("touchend",i=>{clearTimeout(s),i.target.closest(".desktop-icon"),setTimeout(()=>document.querySelectorAll(".desktop-icon.sel").forEach(c=>c.classList.remove("sel")),700)},{passive:!0}),(n=document.getElementById("mobile-scrim"))==null||n.addEventListener("click",()=>{if(!k())return;$(16);const i=[...b].filter(c=>!c.minimized).sort((c,v)=>v.z-c.z)[0];i&&U(i.id)}),new MutationObserver(()=>N()).observe(t,{childList:!0,subtree:!0}),setTimeout(()=>{const i=document.getElementById("mobile-hint");i&&(i.style.opacity="0"),setTimeout(()=>{i&&(i.style.display="none")},400)},5e3),d("#start-btn").addEventListener("click",i=>{i.stopPropagation(),$(12),d("#start-menu").classList.toggle("hidden")}),document.addEventListener("click",i=>{const c=d("#start-menu"),v=d("#start-btn");!c.contains(i.target)&&!v.contains(i.target)&&c.classList.add("hidden")}),setInterval(()=>{const c=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),v=document.getElementById("tray-time");v&&(v.textContent=c)},1e3),M("miner"),M("wallet");const a=document.getElementById("wallpaper");a&&(a.className=`wallpaper wallpaper-${A}`),setInterval(()=>{const i=document.getElementById("si-slot");i&&(i.textContent=String(28e7+Math.floor(Math.random()*5e3)))},2e3),N(),window.addEventListener("resize",N)}At();

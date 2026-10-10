import type { MinerState, Network, WalletState } from './types'

const LS_WALLET='solanaos:wallet'
const LS_WALLET_SOL='solanaos:sol'
const LS_WALLET_SOLANA='solanaos:solana'
const LS_MINER_BAL='solanaos:miner-balance'
const LS_MINER_SESSION='solanaos:miner-session'

// Vite env is injected at build time — determines testnet/mainnet builds
const ENV_NETWORK = (import.meta.env.VITE_SOLANA_NETWORK as Network | undefined) ?? 'devnet'
const ENV_RPC = import.meta.env.VITE_SOLANA_RPC as string | undefined

// migrate old solx key if exists
if(!localStorage.getItem(LS_WALLET_SOLANA) && localStorage.getItem('solanaos:solx')){
  localStorage.setItem(LS_WALLET_SOLANA, localStorage.getItem('solanaos:solx')!)
}

export const wallet: WalletState = {
  address: localStorage.getItem(LS_WALLET),
  sol: Number(localStorage.getItem(LS_WALLET_SOL) ?? '0'),
  solana: Number(localStorage.getItem(LS_WALLET_SOLANA) ?? '0'),
  network: (localStorage.getItem('solanaos:network') as Network) ?? ENV_NETWORK
}

export const miner: MinerState = {
  running:false,
  intensity:75,
  hashrate:0,
  shares:0,
  accepted:0,
  session: Number(localStorage.getItem(LS_MINER_SESSION) ?? '0'),
  balance: Number(localStorage.getItem(LS_MINER_BAL) ?? '0'),
  difficulty: 4200
}

let minerTimer:number|undefined
let hashTimer:number|undefined
let uptimeSec=0
let hashCallback: ((m:MinerState, uptime:string)=>void) | null = null
let balanceCallback: (()=>void)|null=null

function fmtUptime(s:number){
  const h=String(Math.floor(s/3600)).padStart(2,'0')
  const m=String(Math.floor((s%3600)/60)).padStart(2,'0')
  const sec=String(s%60).padStart(2,'0')
  return `${h}:${m}:${sec}`
}

export function onMinerTick(cb:(m:MinerState, uptime:string)=>void){ hashCallback=cb }
export function onBalanceChange(cb:()=>void){ balanceCallback=cb }

export function startMining(){
  if(miner.running) return
  miner.running=true
  uptimeSec=0
  hashTimer = window.setInterval(()=>{
    const base = 800 + miner.intensity*18 + Math.random()*400
    miner.hashrate = Math.round(base)
    if(Math.random()<0.18 + miner.intensity/600){
      miner.shares++
      if(Math.random()<0.82){ miner.accepted++; miner.session+=0.0007 + Math.random()*0.0008; miner.balance=miner.session + Number(localStorage.getItem(LS_MINER_BAL) ?? '0') }
    }
    localStorage.setItem(LS_MINER_SESSION, String(miner.session))
    hashCallback?.(miner, fmtUptime(uptimeSec))
    balanceCallback?.()
  }, 600)
  minerTimer = window.setInterval(()=>{ uptimeSec++; hashCallback?.(miner, fmtUptime(uptimeSec)) },1000)
}

export function stopMining(){
  miner.running=false
  miner.hashrate=0
  if(hashTimer) clearInterval(hashTimer)
  if(minerTimer) clearInterval(minerTimer)
  const total = Number(localStorage.getItem(LS_MINER_BAL) ?? '0') + miner.session
  localStorage.setItem(LS_MINER_BAL, String(total))
  miner.balance=total
  miner.session=0
  localStorage.setItem(LS_MINER_SESSION,'0')
  hashCallback?.(miner, fmtUptime(uptimeSec))
  balanceCallback?.()
}

export function setIntensity(v:number){ miner.intensity=v }

export function walletBalanceString(){ return `${wallet.sol.toFixed(4)} SOL` }
export function solanaString(){ return wallet.solana.toFixed(2) }

export function setWallet(addr:string){
  wallet.address=addr
  wallet.sol = 1.24 + Math.random()*2
  wallet.solana = miner.balance*1200 + Math.random()*50
  localStorage.setItem(LS_WALLET, addr)
  localStorage.setItem(LS_WALLET_SOL, String(wallet.sol))
  localStorage.setItem(LS_WALLET_SOLANA, String(wallet.solana))
  balanceCallback?.()
}
export function disconnectWallet(){
  wallet.address=null
  localStorage.removeItem(LS_WALLET)
  balanceCallback?.()
}

export function setNetwork(n:Network){
  wallet.network=n
  localStorage.setItem('solanaos:network', n)
  balanceCallback?.()
}

export function rpcFor(n:Network){
  if(n===ENV_NETWORK && ENV_RPC) return ENV_RPC
  if(n==='mainnet-beta') return ENV_RPC && ENV_NETWORK==='mainnet-beta' ? ENV_RPC : 'https://api.mainnet-beta.solana.com'
  if(n==='testnet') return ENV_RPC && ENV_NETWORK==='testnet' ? ENV_RPC : 'https://api.testnet.solana.com'
  return ENV_RPC && ENV_NETWORK==='devnet' ? ENV_RPC : 'https://api.devnet.solana.com'
}

export function addCreditsToWallet(){
  const add = miner.balance>0 ? miner.balance : 0.05
  wallet.solana += add*900
  localStorage.setItem(LS_WALLET_SOLANA, String(wallet.solana))
  balanceCallback?.()
}

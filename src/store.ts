import type { MinerState, Network, WalletState } from './types'
import { apiFetch, setAuthToken, clearAuthToken } from './api'
import bs58 from 'bs58'

const LS_WALLET='aetheros:wallet'
const LS_WALLET_SOL='aetheros:sol'
const LS_WALLET_PROVIDER='aetheros:provider'
const LS_WALLET_CHAIN='aetheros:chain'

// Vite env
const ENV_NETWORK = (import.meta.env.VITE_SOLANA_NETWORK as Network | undefined) ?? 'devnet'
const ENV_RPC = import.meta.env.VITE_SOLANA_RPC as string | undefined

export const wallet: WalletState = {
  address: localStorage.getItem(LS_WALLET),
  sol: Number(localStorage.getItem(LS_WALLET_SOL) ?? '0'),
  solana: Number(localStorage.getItem(LS_WALLET_SOL) ?? '0'),
  network: (localStorage.getItem('aetheros:network') as Network) ?? ENV_NETWORK,
  provider: (localStorage.getItem(LS_WALLET_PROVIDER) as WalletState['provider']) ?? null,
  chain: 'solana',
}

export const miner: MinerState = {
  running:false,
  intensity:75,
  hashrate:0,
  shares:0,
  accepted:0,
  session: 0,
  balance: 0,
  difficulty: 3
}

let cachedGpu: string | null = null
export function getGpuRenderer(): string {
  if(cachedGpu) return cachedGpu
  try{
    const c=document.createElement('canvas')
    const gl=(c.getContext('webgl')||c.getContext('experimental-webgl')) as WebGLRenderingContext|null
    if(!gl){ cachedGpu='Browser Miner'; return cachedGpu }
    const ext=gl.getExtension('WEBGL_debug_renderer_info') as any
    if(ext){
      const raw=gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string
      let s=raw.replace(/^ANGLE \(/,'').replace(/\)$/,'').trim()
      if(s.includes(',')) s=s.split(',').pop()!.trim()
      s=s.replace(/Direct3D11 vs_.*ps_.*/,'').trim()
      if(s.length>40) s=s.slice(0,40)
      cachedGpu=s||'WebGL GPU'
    } else {
      cachedGpu='WebGL GPU'
    }
  }catch{ cachedGpu='Browser Miner' }
  return cachedGpu
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

// Mining worker
let miningWorker: Worker | null = null
let currentChallenge: any = null
let isSubmittingProof = false
let lastSuccessfulProofAt = 0

async function fetchChallenge(address: string, retries = 3, delay = 1000): Promise<any> {
  try {
    const response = await apiFetch(`/mining/challenge?address=${encodeURIComponent(address)}`)
    return response
  } catch (e: any) {
    if (retries > 0 && (e?.message?.includes('429') || e?.message?.includes('500') || e?.message?.includes('Failed to fetch'))) {
      console.warn(`⚠️ Fetch challenge failed (${e.message}), retrying in ${delay}ms... (${retries} left)`)
      await new Promise(r => setTimeout(r, delay))
      return fetchChallenge(address, retries - 1, delay * 2)
    }
    console.error('Failed to fetch challenge:', e)
    return null
  }
}

async function submitProof(address: string, nonce: number, hash: string, challenge: string, hw: string) {
  try {
    const response = await apiFetch('/mining/submit', {
      method: 'POST',
      body: JSON.stringify({ address, nonce, hash, challenge, hw })
    })
    return response
  } catch (e) {
    console.error('Failed to submit proof:', e)
    return null
  }
}

export async function startMining(){
  if(miner.running) return
  if(!wallet.address) {
    console.warn('No wallet connected, cannot mine')
    return
  }
  
  miner.running=true
  uptimeSec=0
  const hw = getGpuRenderer()
  
  minerTimer = window.setInterval(()=>{ 
    uptimeSec++
    hashCallback?.(miner, fmtUptime(uptimeSec)) 
  }, 1000)
  
  miningWorker = new Worker(new URL('./workers/miner.worker.ts', import.meta.url), { type: 'module' })
  
  miningWorker.onmessage = async (e) => {
    if (e.data.type === 'stats') {
      miner.hashrate = e.data.hashrate
      hashCallback?.(miner, fmtUptime(uptimeSec))
    } else if (e.data.type === 'proof') {
      if (isSubmittingProof) {
        console.log('⏸️ Proof already being processed, ignoring new proof')
        return
      }
      
      isSubmittingProof = true
      
      try {
        const result = await submitProof(wallet.address!, e.data.nonce, e.data.hash, e.data.challenge, hw)
        
        if (result?.success) {
          miner.accepted++
          miner.shares++
          miner.balance = result.credits
          lastSuccessfulProofAt = Date.now()
          console.log(`✅ Proof accepted: +${result.creditsEarned.toFixed(4)} credits`)
          balanceCallback?.()
        } else if (result?.error?.includes?.('Too fast') || result?.retryAfterMs) {
          const waitMs = result.retryAfterMs || 10000
          console.log(`⏳ Rate limited, waiting ${waitMs}ms before retry...`)
          await new Promise(r => setTimeout(r, waitMs))
          
          if (miner.running && wallet.address && miningWorker) {
            const retryResult = await submitProof(wallet.address!, e.data.nonce, e.data.hash, e.data.challenge, hw)
            if (retryResult?.success) {
              miner.accepted++
              miner.shares++
              miner.balance = retryResult.credits
              console.log(`✅ Proof accepted (retry): +${retryResult.creditsEarned.toFixed(4)} credits`)
              balanceCallback?.()
            } else {
              console.warn('❌ Proof rejected (retry):', retryResult?.error)
            }
          }
        } else {
          console.warn('❌ Proof rejected:', result?.error)
        }
      } finally {
        isSubmittingProof = false
      }
      
      if (miner.running && wallet.address) {
        const timeSinceLastProof = Date.now() - lastSuccessfulProofAt
        const cooldownMs = 10000
        if (timeSinceLastProof < cooldownMs) {
          const waitMs = cooldownMs - timeSinceLastProof
          console.log(`⏳ Client cooldown: waiting ${waitMs}ms before new challenge...`)
          await new Promise(r => setTimeout(r, waitMs))
        }
        
        currentChallenge = await fetchChallenge(wallet.address)
        if (currentChallenge && miningWorker) {
          miningWorker.postMessage({
            type: 'start',
            challenge: currentChallenge.challenge,
            difficulty: currentChallenge.difficulty,
            target: currentChallenge.target
          })
        }
      }
    }
  }
  
  miningWorker.onerror = (error) => {
    console.error('Mining worker error:', error)
  }
  
  currentChallenge = await fetchChallenge(wallet.address)
  if (currentChallenge && miningWorker) {
    miningWorker.postMessage({
      type: 'start',
      challenge: currentChallenge.challenge,
      difficulty: currentChallenge.difficulty,
      target: currentChallenge.target
    })
  } else {
    console.error('Failed to get initial challenge')
    stopMining()
  }
}

export function stopMining(){
  miner.running=false
  miner.hashrate=0
  
  if(miningWorker) {
    miningWorker.postMessage({ type: 'stop' })
    miningWorker.terminate()
    miningWorker = null
  }
  
  if(hashTimer) clearInterval(hashTimer)
  if(minerTimer) clearInterval(minerTimer)
  
  hashCallback?.(miner, fmtUptime(uptimeSec))
  balanceCallback?.()
}

export function setIntensity(v:number){ miner.intensity=v }

export function walletBalanceString(){ return `${wallet.sol.toFixed(4)} SOL` }
export function solanaString(){ return wallet.sol.toFixed(4) }

function persistWallet(){
  if(wallet.address) localStorage.setItem(LS_WALLET, wallet.address)
  localStorage.setItem(LS_WALLET_SOL, String(wallet.sol))
  if(wallet.provider) localStorage.setItem(LS_WALLET_PROVIDER, wallet.provider)
  else localStorage.removeItem(LS_WALLET_PROVIDER)
  balanceCallback?.()
}

export async function setWallet(addr:string, provider: WalletState['provider'] = 'manual', _chain: WalletState['chain'] = 'solana'){
  wallet.address=addr
  wallet.provider=provider
  wallet.chain='solana'
  persistWallet()
  
  try{
    const hw=getGpuRenderer()
    await apiFetch('/wallet/connect', { method:'POST', body: JSON.stringify({ address: addr, hw }) })
    
    // Sign message flow for JWT auth (Phantom) OR generate token directly for manual/other providers
    if (provider === 'phantom' && (window as any).solana?.signMessage) {
      try {
        const nonceRes = await apiFetch(`/auth/nonce?address=${addr}`)
        const { nonce } = nonceRes
        const message = `Sign in to AetherOS\nNonce: ${nonce}`
        const messageBytes = new TextEncoder().encode(message)
        const signed = await (window as any).solana.signMessage(messageBytes, 'utf8')
        const signature = bs58.encode(signed.signature)
        const verifyRes = await apiFetch('/auth/verify', { 
          method: 'POST', 
          body: JSON.stringify({ address: addr, signature }) 
        })
        console.log('🛡️ Auth verify response:', verifyRes)
        if (verifyRes.token) {
          setAuthToken(verifyRes.token)
        }
      } catch (e) {
        console.warn('Sign message flow failed:', e)
      }
    } else {
      // For manual/other providers: request token directly (dev mode)
      try {
        console.log('🔐 Attempting manual auth for:', addr)
        const verifyRes = await apiFetch('/auth/verify', { 
          method: 'POST', 
          body: JSON.stringify({ address: addr, signature: 'manual-dev-bypass' }) 
        })
        console.log('🔐 Manual auth verify response:', verifyRes)
        if (verifyRes.token) {
          console.log('🔐 Setting auth token for manual wallet')
          setAuthToken(verifyRes.token)
        } else {
          console.warn('🔐 No token in verify response')
        }
      } catch (e) {
        console.warn('Manual auth flow failed:', e)
      }
    }
    
    const data = await apiFetch(`/wallet/${addr}`)
    miner.balance = data.balance || 0
    wallet.sol = data.sol || 0
    wallet.solana = data.sol || 0
    persistWallet()
  }catch(e){
    console.warn('Failed to fetch wallet balance:', e)
  }
}

export function disconnectWallet(){
  try{
    const sol = (window as any).solana
    if(sol?.disconnect) sol.disconnect()
  }catch{}
  wallet.address=null
  wallet.provider=null
  wallet.chain=null
  clearAuthToken()
  localStorage.removeItem(LS_WALLET)
  localStorage.removeItem(LS_WALLET_PROVIDER)
  localStorage.removeItem(LS_WALLET_CHAIN)
  balanceCallback?.()
}

export function setNetwork(n:Network){
  wallet.network=n
  localStorage.setItem('aetheros:network', n)
  balanceCallback?.()
}

export function rpcFor(n:Network){
  if(n===ENV_NETWORK && ENV_RPC) return ENV_RPC
  if(n==='mainnet-beta') return ENV_RPC && ENV_NETWORK==='mainnet-beta' ? ENV_RPC : 'https://api.mainnet-beta.solana.com'
  if(n==='testnet') return ENV_RPC && ENV_NETWORK==='testnet' ? ENV_RPC : 'https://api.testnet.solana.com'
  return ENV_RPC && ENV_NETWORK==='devnet' ? ENV_RPC : 'https://api.devnet.solana.com'
}

// --- Real extension helpers ---

declare global {
  interface Window {
    solana?: any
    phantom?: any
  }
}

export function hasPhantom(): boolean {
  const w = window as any
  return !!(w.solana?.isPhantom || w.phantom?.solana?.isPhantom)
}

export async function connectPhantom(): Promise<string> {
  const w = window as any
  const sol = w.solana ?? w.phantom?.solana
  if(!sol) throw new Error('Phantom not found')
  const resp = await sol.connect({ onlyIfTrusted: false })
  const pubkey = resp?.publicKey?.toString?.() ?? sol.publicKey?.toString?.()
  if(!pubkey) throw new Error('No publicKey from Phantom')
  await setWallet(pubkey, 'phantom', 'solana')
  try{
    sol.on?.('disconnect', ()=> { disconnectWallet() })
    sol.on?.('accountChanged', (pk:any)=> {
      if(!pk) disconnectWallet()
      else {
        const addr = pk?.toString?.() ?? String(pk)
        wallet.address = addr; persistWallet()
      }
    })
  }catch{}
  return pubkey
}

export function providerLabel(): string {
  if(!wallet.provider) return 'no wallet'
  if(wallet.provider==='phantom') return 'Phantom ✓'
  if(wallet.provider==='solflare') return 'Solflare ✓'
  return wallet.provider
}

export type AppId = 'miner'|'wallet'|'train'|'datasets'|'models'|'sysinfo'|'taskmgr'|'network'|'leaderboard'|'settings'|'readme'|'trash'
export type Wallpaper = 'aurora'|'dusk'|'night'|'neon'
export type Network = 'devnet'|'mainnet-beta'|'testnet'

export interface MinerState {
  running: boolean
  intensity: number
  hashrate: number
  shares: number
  accepted: number
  session: number
  balance: number
  difficulty: number
}

export interface WalletState {
  address: string | null
  sol: number
  solana: number
  network: Network
  provider: 'phantom' | 'metamask' | 'solflare' | 'manual' | null
  chain: 'solana' | 'evm' | null
}

export interface WindowInfo {
  id: string
  appId: AppId
  title: string
  icon: string
  x: number
  y: number
  w: number
  h: number
  z: number
  minimized: boolean
  maximized: boolean
}

export interface Toast { id:number; msg:string; kind:'success'|'info'|'error' }

export interface Dataset { id:string; name:string; rows:number; type:string; content:string; preview:string }
export interface TrainedModel { id:string; name:string; base:string; datasetId:string; datasetName:string; epochs:number; createdAt:number; source:'local'|'network'; cost:number }
export interface TrainJob { id:string; datasetId:string; datasetName:string; base:string; epochs:number; status:'queued'|'training'|'done'|'failed'; progress:number; node:string; cost:number }

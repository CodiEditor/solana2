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

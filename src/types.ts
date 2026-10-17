export type AppId = 'miner' | 'wallet' | 'leaderboard' | 'settings' | 'readme'
export type Wallpaper = 'aurora' | 'dusk' | 'night' | 'neon'

export interface MinerState {
  running: boolean
  waiting: boolean
  intensity: number
  hashrate: number
  found: number
  accepted: number
  rejected: number
  session: number
  balance: number
  creditsPerShare: number | null
  dailyEarned: number
  dailyCap: number | null
}

export interface WalletState {
  address: string | null
  walletName: string | null
}

export interface LogLine {
  at: number
  text: string
  kind: 'info' | 'ok' | 'error'
}

export interface LeaderRow {
  rank: number
  address: string
  shares: number
  credits: number
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

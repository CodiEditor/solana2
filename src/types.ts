export type AppId = 'miner' | 'assistant' | 'wallet' | 'leaderboard' | 'settings' | 'readme'
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

export interface AssistantProfile {
  name: string
  sourceName: string
  datasetChars: number
  text: string
  builtAt: number
}

export interface AssistantStatus {
  enabled: boolean
  prices: { message: number; profile: number }
  limits: {
    messagesPerDay: number
    profilesPerDay: number
    datasetMinChars: number
    datasetMaxChars: number
    messageMaxChars: number
    historyTurns: number
  }
  today: { messages: number; profiles: number }
  resetAt: number
  balance: number
  checks: {
    walletAge: { ok: boolean; readyAt: number | null; hours: number }
    sol: { ok: boolean | null; sol: number | null; minSol: number }
    budget: { ok: boolean; reopensAt: number }
  }
  profile: AssistantProfile | null
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
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

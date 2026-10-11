// Helper API Railway - support 2 mode:
// - Proxy mode (vercel.json + vite proxy): VITE_API_BASE kosong -> fetch /api/... (bebas CORS)
// - Direct mode: VITE_API_BASE=https://solana2-production.up.railway.app -> fetch langsung (butuh CORS di Railway)
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')

export async function apiFetch(path: string, init?: RequestInit) {
  const normalizedPath = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : '/' + path}`
  const url = API_BASE ? `${API_BASE}${normalizedPath}` : normalizedPath
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${text || res.statusText}`)
  }
  // coba parse json, fallback text
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return res.json()
  return res.text()
}

// Contoh pemakaian di main.ts / store.ts:
// import { apiFetch } from './api'
// const data = await apiFetch('/ping')
// const user = await apiFetch('/user/123')

// Kalau Railway kamu belum pakai prefix /api, hapus prefix di vite.config.ts & vercel.json
// Misal Railway endpoint kamu https://solana2-production.up.railway.app/health
// maka panggil: apiFetch('/health') -> akan jadi /api/health -> ke Railway /api/health
// Kalau mau tanpa /api, ganti rewrite source jadi "/(.*)" dan proxy "/health" langsung

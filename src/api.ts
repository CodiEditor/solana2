// Helper terpusat untuk panggil API Railway via proxy Vercel
// Di local (vite dev) -> /api diproxy ke Railway via vite.config.ts
// Di production (Vercel) -> /api direwrite ke Railway via vercel.json
// Jadi frontend cukup panggil path relatif /api/...
const API_BASE = '' // kosong = pakai origin yang sama (proxy/rewrite)

export async function apiFetch(path: string, init?: RequestInit) {
  const url = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : '/' + path}`
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

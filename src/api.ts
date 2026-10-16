// All API calls use a relative /api path: Vite proxies it in development and
// vercel.json rewrites it to the backend in production.
import { storage } from './storage'

const AUTH_TOKEN_KEY = 'aetheros:auth'

export class ApiError extends Error {
  status: number
  body: any
  constructor(status: number, message: string, body?: any) {
    super(message)
    this.status = status
    this.body = body
  }
}

export const isAuthError = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.status === 403)

export function getAuthToken(): string | null {
  return storage.get(AUTH_TOKEN_KEY)
}

export function setAuthToken(token: string): void {
  storage.set(AUTH_TOKEN_KEY, token)
}

export function clearAuthToken(): void {
  storage.remove(AUTH_TOKEN_KEY)
}

export async function apiFetch(path: string, init?: RequestInit): Promise<any> {
  const url = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : '/' + path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  }
  const token = getAuthToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(url, { ...init, headers })
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json')

  if (!res.ok) {
    let body: any = null
    if (isJson) { try { body = await res.json() } catch { /* empty body */ } }
    throw new ApiError(res.status, body?.error || res.statusText || `Request failed (${res.status})`, body)
  }
  return isJson ? res.json() : res.text()
}

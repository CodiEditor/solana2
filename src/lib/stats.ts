import { apiFetch } from '../api'

export async function fetchStats() {
  try {
    return await apiFetch('/stats')
  } catch {
    return null
  }
}

export async function fetchLeaderboard(sort = 'credits') {
  try {
    const res = await apiFetch(`/leaderboard?sort=${sort}`)
    return res.leaderboard || []
  } catch {
    return []
  }
}

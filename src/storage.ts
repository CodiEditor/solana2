// localStorage can be missing or throw (private windows, blocked site data, some in-app
// browsers). Every read and write goes through here so the app still runs from memory.
const memory = new Map<string, string>()

export const storage = {
  get(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return memory.get(key) ?? null }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(key, value) } catch { memory.set(key, value) }
  },
  remove(key: string): void {
    try { localStorage.removeItem(key) } catch { /* storage unavailable */ }
    memory.delete(key)
  },
}

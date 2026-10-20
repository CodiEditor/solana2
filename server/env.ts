// Reads a number from an environment variable. Missing, empty or out-of-range values fall back to the default.
export const envNumber = (name: string, fallback: number, min: number, max: number) => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && process.env[name] !== '' && n >= min && n <= max ? n : fallback
}

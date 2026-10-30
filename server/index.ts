// Standalone server for local development and self-hosting: the same API as the Vercel function in
// api/index.ts, plus the built frontend when dist/ exists. Data lives in Postgres (DATABASE_URL).
import express from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import app, { errorHandler } from './app.js'
import { sql, dbConfigured } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3000)
const NODE_ENV = process.env.NODE_ENV || 'development'

if (!dbConfigured) console.warn('DATABASE_URL is not set. The API answers 503 until it points at a Postgres database.')

const distPath = path.resolve(__dirname, '..', 'dist')
if (fs.existsSync(path.join(distPath, 'index.html'))) {
  app.use(express.static(distPath, { maxAge: '1h', etag: true }))
  app.get('/{*any}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
} else {
  app.get('/{*any}', (_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })
}
app.use(errorHandler)

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`AetherOS API running on http://0.0.0.0:${PORT} [${NODE_ENV}]`)
})

function shutdown(signal: string) {
  console.log(`${signal} received. Shutting down...`)
  server.close(() => { void sql.end({ timeout: 5 }).finally(() => process.exit(0)) })
  setTimeout(() => process.exit(1), 8000)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

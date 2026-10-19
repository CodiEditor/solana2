# AetherOS

A browser-based desktop where you mine credits with a Solana wallet and climb a leaderboard.

## How it works

1. You connect any Solana wallet that supports the Wallet Standard and sign one message to sign in. No transaction is sent.
2. `miner.exe` hashes SHA-256 on the CPU in a Web Worker until it finds a hash at or below the server's target.
3. The server verifies each share. An accepted share adds credits to the wallet's balance, up to a daily limit per wallet.
4. `leaderboard` ranks wallets by credits.

Credits are a score kept by the server. They are not a token.

The Terms and Privacy pages are static files in `public/` (`terms.html`, `privacy.html`). They describe what the code does today, so update them when the rules or the stored data change.

## Prerequisites

- Node.js 24 or newer
- npm

## Local setup

```bash
npm install
cp .env.example .env
npm run dev:api   # API on http://localhost:3000
npm run dev       # frontend on http://localhost:5173, proxies /api to the API
```

## Server environment variables

| Name | Purpose |
| --- | --- |
| `PORT` | API port (default 3000) |
| `CORS_ORIGIN` | Allowed browser origins, comma separated |
| `JWT_SECRET` | Signs sign-in tokens. Set a long random value in production. When empty the server uses a random per-boot secret and sign-ins reset on every restart |
| `ADMIN_KEY` | Enables `GET /api/wallets` for the `x-admin-key` header. Empty disables it |
| `DATA_DIR` | Folder for `data.json`. The Dockerfile sets `/data`; mount a volume there so balances survive redeploys |
| `MINING_DIFFICULTY` | Leading zero hex digits a hash needs (default 5, about 1,048,576 hashes per share) |
| `CREDITS_PER_SHARE` | Credits added per accepted share (default 1) |
| `DAILY_CREDIT_CAP` | Credits one wallet can earn per UTC day (default 1000) |
| `SUBMIT_COOLDOWN_MS` | Minimum wait between accepted shares for one wallet (default 10000) |

## Deployment

- Frontend: Vercel (`npm run build`, output `dist`). `vercel.json` rewrites `/api/*` to the backend and sets the security headers.
- Backend: Railway from the `Dockerfile` (Node 24 Alpine, `NODE_ENV=production`). Add a volume mounted at `/data`.
- Share cards: `public/og.png` is the 1200 x 630 share image. Social crawlers need an absolute URL, so the build fills `og:url` and `og:image` from `SITE_URL`, or from Vercel's `VERCEL_PROJECT_PRODUCTION_URL` when that is set. With neither, those tags are left out.

## Notes

- Data lives in one JSON file. Without a volume at `DATA_DIR`, balances reset on redeploy. Writes are atomic and happen about two seconds after a change and on shutdown.
- Difficulty and the daily cap raise the cost of inflating the leaderboard. They do not stop someone who runs a GPU against many wallets.
- `server/modal_app.py` is a Modal training sketch kept for later. Nothing in the app calls it.

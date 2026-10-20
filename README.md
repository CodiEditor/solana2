# AetherOS

A browser-based desktop where you mine credits with a Solana wallet, spend them on an assistant that learns from your own text, and climb a leaderboard.

## How it works

1. You connect any Solana wallet that supports the Wallet Standard and sign one message to sign in. No transaction is sent.
2. `miner.exe` hashes SHA-256 on the CPU in a Web Worker until it finds a hash at or below the server's target.
3. The server verifies each share. An accepted share adds credits to the wallet's balance, up to a daily limit per wallet.
4. `assistant.exe` spends credits on Claude (Anthropic). TEACH sends a text file to Claude, which writes a profile of its voice and knowledge. CHAT answers from that profile. The dataset and chat messages are not stored; only the profile is.
5. `leaderboard` ranks wallets by shares mined, so spending credits never costs a place.

Credits are kept by the server and only spent inside the app. They are not a token.

## Credits

One balance per wallet, kept in `data.json`. Every number below comes from the server, and the UI shows the server's values (`/api/wallet/:address`, `/api/mining/challenge`, `/api/assistant/status`) rather than its own copies.

- Earned: `CREDITS_PER_SHARE` (default 1) for each accepted share. A share needs a SHA-256 hash of `challenge + nonce` at or below the target, which is `MINING_DIFFICULTY` leading zero hex digits (default 5, about 1,048,576 hashes).
- Earning limits: at least `SUBMIT_COOLDOWN_MS` (default 10,000) between accepted shares of one wallet, and at most `DAILY_CREDIT_CAP` (default 1,000) per UTC day. A share that would pass the cap is refused, and the server stops issuing challenges until 00:00 UTC.
- Spent: `AI_MESSAGE_CREDITS` (default 2) per assistant message and `AI_PROFILE_CREDITS` (default 50) per profile, taken when the request starts and returned if no answer comes back.
- Balance = earned minus spent, rounded to four decimals. The leaderboard ranks by accepted shares, then by balance, so spending never moves a wallet down.
- Credits cannot be bought, sold, transferred or withdrawn.

With the defaults a browser tab earns roughly 0.6 to 2 credits a minute. A share averages 1,048,576 hashes, which took 23 to 87 seconds in the live-site runs (12,000 to 45,000 H/s at 75% intensity, depending on the CPU and its load), plus the 10 second wait. A message is one to three minutes of mining and a profile 25 to 80 minutes.

## The assistant

Code: `server/assistant.ts` (Claude calls, prompts, price math, Solana balance check), the `/api/assistant/*` routes in `server/index.ts`, and `src/assistant.ts` for the window.

- Model `claude-haiku-5-5` through the official `@anthropic-ai/sdk`. Profiles run at effort `medium` (streamed, 12,000 max tokens), chat at effort `low` (2,000 max tokens).
- Without `ANTHROPIC_API_KEY` the window says the assistant is offline and everything else runs as usual.
- Guards, all on the server, in the order they are checked: wallet first signed in at least `AI_MIN_WALLET_AGE_HOURS` ago, daily message and profile limits per wallet, enough credits, at least `AI_MIN_SOL` SOL on mainnet (cached 30 minutes, 1 minute when low), one call at a time per wallet, `AI_MAX_CONCURRENT` calls in total, and the monthly dollar cap.
- The monthly cap reserves a worst-case estimate before each call (two characters per token, full `max_tokens`), then books the real cost from the response's `usage`. Spend is stored in `data.json` under `aiMonth` and resets on the 1st (UTC).
- Credits are taken before the call and returned when the call fails, is declined (`stop_reason: refusal`) or comes back empty. Every call Claude answered counts toward the daily limit, declined ones included, so refusals cannot run up the bill.
- Rough cost with the default prices: a chat message is about $0.0005 to $0.003, a profile from 150,000 characters about $0.01. One wallet at its daily limits costs at most about $0.35 a day, so `AI_MONTHLY_BUDGET_USD` is what bounds the bill when many wallets are active.
- Each call logs one line (`assistant message|profile <short address> in= out= stop= cost= month=`) with no user text.
- The readme in the app and the Terms page quote the defaults (24 hours, 0.01 SOL). Update them if you change those values.

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
| `ANTHROPIC_API_KEY` | Claude API key for the assistant. Empty turns the assistant off |
| `AI_MODEL` | Claude model (default `claude-haiku-5-5`). Change the two price variables with it |
| `AI_PRICE_INPUT_PER_MTOK` / `AI_PRICE_OUTPUT_PER_MTOK` | USD per million tokens used for the budget (defaults 0.10 and 0.50, Haiku 5.5 list prices for prompts up to 100,000 tokens) |
| `AI_MONTHLY_BUDGET_USD` | Monthly spend cap across all wallets (default 50) |
| `AI_MESSAGE_CREDITS` / `AI_PROFILE_CREDITS` | Price in credits of a chat message and of a profile (defaults 2 and 50) |
| `AI_DAILY_MESSAGES` / `AI_DAILY_PROFILES` | Per-wallet limits per UTC day (defaults 100 and 3) |
| `AI_MIN_WALLET_AGE_HOURS` | Hours after a wallet's first sign-in before it can use the assistant (default 24) |
| `AI_MIN_SOL` | SOL the wallet must hold on mainnet (default 0.01). Only read, never moved |
| `AI_MAX_CONCURRENT` | Assistant calls running at once across all wallets (default 8) |
| `AI_REQUESTS_PER_MINUTE` | Assistant requests per wallet per minute, status checks included (default 30) |
| `SOLANA_RPC_URL` | RPC for the SOL balance check (default `https://api.mainnet-beta.solana.com`) |

## Deployment

- The public site is self-hosted at https://aetheros.lumoracle.io (systemd and Caddy, see `docs/OPERATIONS.md`). Any deployment of this repo on a `*.vercel.app` address redirects there permanently (`redirects` in `vercel.json`), so old Vercel copies send visitors to the one site with the live data.
- Frontend on Vercel under a custom domain: `npm run build`, output `dist`. `vercel.json` rewrites `/api/*` to the backend and sets the security headers.
- Backend: Railway from the `Dockerfile` (Node 24 Alpine, `NODE_ENV=production`). Add a volume mounted at `/data`.
- Share cards: `public/og.png` is the 1200 x 630 share image. Social crawlers need an absolute URL, so the build fills `og:url` and `og:image` from `SITE_URL`, or from Vercel's `VERCEL_PROJECT_PRODUCTION_URL` when that is set. With neither, those tags are left out.

## Notes

- Data lives in one JSON file. Without a volume at `DATA_DIR`, balances reset on redeploy. Writes are atomic and happen about two seconds after a change and on shutdown.
- Difficulty and the daily cap raise the cost of inflating the leaderboard. They do not stop someone who runs a GPU against many wallets.
- `server/modal_app.py` is a Modal training sketch kept for later. Nothing in the app calls it.

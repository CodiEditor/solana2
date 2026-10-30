# Operations

How the deployment runs on Vercel, how to turn the assistant on, and what it costs.

## Layout

| What | Where |
| --- | --- |
| Frontend | Vercel static build of `dist` (`npm run build`) |
| API | One Vercel Function, `api/index.ts`, holding the Express app from `server/app.ts`; `vercel.json` rewrites `/api/*` to it |
| Data | Postgres from the Neon integration (`DATABASE_URL`). Tables are created on first use: `wallets`, `shares`, `counters`, `challenges`, `auth_nonces`, `profiles`, `ai_month`, `ai_inflight`, `rate_limits` |
| Settings | Project environment variables: `DATABASE_URL` (set by the integration), `JWT_SECRET`, `CORS_ORIGIN`, optional `ADMIN_KEY`, `ANTHROPIC_API_KEY` and `AI_*` |
| Logs | Vercel's runtime logs for the function |
| Backups | Neon keeps point-in-time history for the branch; restore from the Neon console |

## Redeploy

1. From a clean copy of the commit (`git archive <commit>` into an empty folder): `vercel link --project <project>`, then `vercel deploy --prod`.
2. Check `/api/ping`, `/api/leaderboard`, the page, `/terms.html` and the security headers. To roll back, promote the previous deployment (`vercel rollback`). Data lives in Postgres, so a rollback never touches it; schema changes are additive (`CREATE TABLE IF NOT EXISTS`).

## Turning the assistant on

Without a key the assistant window says it is offline and everything else runs as usual. To turn it on, add the key to the project's production environment without it passing through a terminal or a log, then redeploy so the function reads it:

```bash
vercel env add ANTHROPIC_API_KEY production < anthropic-key.txt
vercel deploy --prod
```

Check: `/api/assistant/status` with a signed-in session reports `"enabled": true`, and after the first message the function logs show one `assistant message` line per call with token counts and cost, never the text. Also set a monthly spend limit in the Anthropic Console as a second guard next to `AI_MONTHLY_BUDGET_USD`.

## Assistant cost

Claude Haiku 5.5 list prices: $0.10 per million input tokens and $0.50 per million output tokens, for prompts up to 100,000 tokens, five times that above it. Thinking tokens count as output. Chat prompts always stay under 100,000 tokens. A profile from English text near the 150,000-character limit is about 50,000 tokens; text in a denser script such as Chinese or Japanese can pass 100,000 tokens and is then billed at the higher rate (about $0.11 for that one call). The monthly cap books the real cost from each response, so it still holds.

| Call | Typical | Largest the server allows |
| --- | --- | --- |
| Chat message | about 3,000 tokens in, 300 out: about $0.0005 | profile 4,000 + 12 turns of history 16,000 + message, 2,000 out: about $0.003 |
| Profile | 20,000 characters read, 3,000 out: about $0.002 | 150,000 characters (about 50,000 tokens), 12,000 out: about $0.011 |

Per wallet the daily limits (100 messages and 3 profiles) cap the cost at about $0.34 a day, and typical use of those limits is about $0.05 a day. Credits limit it further: a day at the limits costs 350 credits, roughly 3 to 10 hours of mining.

| Month at `AI_MONTHLY_BUDGET_USD=50` | Covers |
| --- | --- |
| Typical messages only | about 100,000 messages |
| Wallets using their full daily limits, typical size | about 970 wallet-days, for example 32 wallets every day |
| Wallets using their full daily limits, largest size | about 145 wallet-days, for example 5 wallets every day |

When the month reaches the cap the assistant pauses until 00:00 UTC on the 1st, and mining and the leaderboard keep running. These are estimates from the prompt sizes; the logged `cost=` per call is the real figure.

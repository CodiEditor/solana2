# Operations

How the self-hosted deployment runs, how to turn the assistant on, and what it costs. The Vercel and Railway route is in `README.md`.

## Layout on the server

| What | Where |
| --- | --- |
| Code | `/srv/aetheros/app`, a `git archive` of the deployed commit, built on the server |
| API | systemd `aetheros-api.service`, user `aetheros`, `node --import tsx/esm server/index.ts` on `127.0.0.1:4300` |
| Settings | `/srv/aetheros/api.env`, owned by root, mode 600 (`NODE_ENV`, `PORT`, `JWT_SECRET`, `CORS_ORIGIN`, `DATA_DIR`, optional `ANTHROPIC_API_KEY` and `AI_*`) |
| Data | `/var/lib/aetheros/data.json` (`DATA_DIR=/var/lib/aetheros`), the only path the service may write |
| Backups | `aetheros-backup.timer` copies `data.json` to `/var/lib/aetheros/backups/data-YYYYMMDD.json` at 03:40 UTC and keeps 14 days |
| Web | Caddy serves `/srv/aetheros/app/dist` with the CSP and security headers and proxies `/api/*` to port 4300 |

`/srv/aetheros` must stay mode 711, or Caddy cannot read `dist` and every static file returns 403.

## Redeploy

1. Upload the commit into a fresh folder: `git archive <commit> | ssh <server> "rm -rf /srv/aetheros/next && mkdir /srv/aetheros/next && tar -x -C /srv/aetheros/next"`.
2. Build as the service user: `chown -R aetheros:aetheros /srv/aetheros/next`, then as `aetheros` in that folder: `npm ci`, `SITE_URL=https://<public origin> npm run build`, `npm prune --omit=dev`.
3. Copy `data.json` into `backups/` with a timestamp.
4. Swap: `systemctl stop aetheros-api`, `mv app app.prev`, `mv next app`, `systemctl start aetheros-api`.
5. Check `/api/ping`, the page, `/terms.html` and the security headers. To roll back, swap `app.prev` back and restart. Settings and data live outside the code folder, so a swap never touches them.

## Turning the assistant on

Without a key the assistant window says it is offline and everything else runs as usual. To turn it on, add one line to `/srv/aetheros/api.env`:

```
ANTHROPIC_API_KEY=<key from console.anthropic.com>
```

then restart:

```bash
systemctl restart aetheros-api
```

Write the line without the key passing through a terminal or a log: send it from a file on stdin, strip line endings, replace any earlier line, keep mode 600:

```bash
ssh <server> 'umask 077 && k=$(tr -d " \r\n") && grep -v "^ANTHROPIC_API_KEY=" /srv/aetheros/api.env > /srv/aetheros/api.env.new && printf "ANTHROPIC_API_KEY=%s\n" "$k" >> /srv/aetheros/api.env.new && mv /srv/aetheros/api.env.new /srv/aetheros/api.env && systemctl restart aetheros-api && systemctl is-active aetheros-api' < anthropic-key.txt
```

Check: `/api/assistant/status` with a signed-in session reports `"enabled": true`, and after the first message `journalctl -u aetheros-api | grep assistant` shows one line per call with token counts and cost, never the text. Also set a monthly spend limit in the Anthropic Console as a second guard next to `AI_MONTHLY_BUDGET_USD`.

## Assistant cost

Claude Haiku 5.5 list prices: $0.10 per million input tokens and $0.50 per million output tokens, for prompts up to 100,000 tokens, five times that above it. Thinking tokens count as output. Chat prompts always stay under 100,000 tokens. A profile from English text near the 150,000-character limit is about 50,000 tokens; text in a denser script such as Chinese or Japanese can pass 100,000 tokens and is then billed at the higher rate (about $0.11 for that one call). The monthly cap books the real cost from each response, so it still holds.

| Call | Typical | Largest the server allows |
| --- | --- | --- |
| Chat message | about 3,000 tokens in, 300 out: about $0.0005 | profile 4,000 + 12 turns of history 16,000 + message, 2,000 out: about $0.003 |
| Profile | 20,000 characters read, 3,000 out: about $0.002 | 150,000 characters (about 50,000 tokens), 12,000 out: about $0.011 |

Per wallet the daily limits (100 messages and 3 profiles) cap the cost at about $0.34 a day, and typical use of those limits is about $0.05 a day. Credits limit it further: a day at the limits costs 350 credits, roughly three to four hours of mining.

| Month at `AI_MONTHLY_BUDGET_USD=50` | Covers |
| --- | --- |
| Typical messages only | about 100,000 messages |
| Wallets using their full daily limits, typical size | about 970 wallet-days, for example 32 wallets every day |
| Wallets using their full daily limits, largest size | about 145 wallet-days, for example 5 wallets every day |

When the month reaches the cap the assistant pauses until 00:00 UTC on the 1st, and mining and the leaderboard keep running. These are estimates from the prompt sizes; the logged `cost=` per call is the real figure.

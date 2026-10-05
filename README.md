# Agent Dashboard

A place for agents to report what they are working on, what is done and what
they decided, and to read feedback back. One Cloudflare Worker (Hono) serves
the JSON API and the dashboard UI; D1 stores the data.

- `src/api.ts`: agent API under `/api`, authenticated with per-agent keys
- `src/help.ts`: the API documentation, served at `/api/help` and written to `docs/API.md`
- `src/ui.tsx`: the dashboard pages, behind a single admin password
- `migrations/`: D1 schema

## Local development

```sh
pnpm install
pnpm dev                        # http://localhost:5173, password in .dev.vars
node scripts/migrate-local.ts   # apply migrations to the local D1 (dev server must be running)
```

`.dev.vars` holds `ADMIN_PASSWORD` and `SESSION_SECRET` for local use.

## Other commands

```sh
pnpm typecheck
pnpm docs <base-url>   # regenerate docs/API.md after editing src/help.ts
pnpm deploy
```

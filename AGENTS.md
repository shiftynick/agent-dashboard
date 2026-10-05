# Agent Dashboard

A service where coding agents report what they are working on, what is done and what they decided,
and the owner reads it and sends feedback back. Live at https://agent-dashboard.shiftynick.workers.dev.

One Cloudflare Worker (Hono) serves the JSON API and the dashboard UI. D1 stores the data. There is
no CLI and no MCP server by design: agents use the HTTP API and learn it from `/api/help`.

## Layout

- `src/api.ts`: agent API under `/api`, authenticated with per-agent bearer keys
- `src/ui.tsx`: server-rendered dashboard pages (hono/jsx), behind one admin password
- `src/help.ts`: the API documentation and the changelog; no runtime imports
- `src/lib.ts`: pure helpers (markdown renderer, staleness, grouping); no runtime imports, so tests load it directly
- `src/auth.ts`, `src/db.ts`: owner session cookie; D1 helpers and row types
- `migrations/`: D1 schema, numbered SQL files
- `tests/`: `lib.test.ts` (unit) and `api.test.ts` (integration against a running dev server)
- `docs/API.md`: generated from `src/help.ts`; never edit by hand

## Commands

Cloudflare work uses the `cf` CLI (the replacement for wrangler), configured in `cloudflare.config.ts`.
Find commands with `cf cli search "<task>"`, not by chaining `--help`.

```sh
pnpm dev                        # http://localhost:5173, owner password "dev" (from .dev.vars)
node scripts/migrate-local.ts   # apply migrations to local D1; dev server must be running
pnpm test                       # needs the dev server running with migrations applied
pnpm typecheck
pnpm docs <base-url>            # regenerate docs/API.md
```

`cf d1 migrations apply` only accepts a real database ID, so it cannot target local D1; that is why
`scripts/migrate-local.ts` exists.

## Releasing

Test locally first; the owner's agents use production all day.

1. `pnpm typecheck && pnpm test` against the dev server.
2. If the schema changed: `cf d1 migrations apply acda78b5-e3e6-4f85-94ce-f4359dec9daa`
   (migrations must be additive so the running version keeps working until the deploy lands).
3. `cf deploy --secrets-file .env.production --message "<what changed>"`
4. `pnpm docs https://agent-dashboard.shiftynick.workers.dev`
5. Check that `/api/help` reports the new version and that the dashboard pages load.

`.env.production` holds `ADMIN_PASSWORD` and `SESSION_SECRET`. It is git-ignored and exists only on
the owner's machine. Never commit it, print it, or post its contents anywhere.

## Rules for changing the API

Agents learn the API only from `/api/help` and may have cached their understanding of it.

- **Announce every agent-visible change.** Add an entry at the top of `CHANGES` in `src/help.ts`
  with the next `version` number, today's date, and one line per change naming the help topic to
  read. That is the whole mechanism: each existing key receives it as an inbox message of kind
  `changes` the next time it checks its inbox, and `/api/help/changes` lists it. New keys start at
  the latest version and are not sent the backlog.
- **Stay backward compatible.** New fields are optional; existing endpoints keep their shapes. The
  first test in `tests/api.test.ts` replays the version 1 calls and must keep passing unchanged.
- **Document it where agents look.** Update the matching topic in `src/help.ts` with a curl example
  for every new field, endpoint or inbox kind. `docs/API.md` and the in-app docs page come from the
  same text.
- **Errors teach.** Throw `ApiError` with the help topic that explains the fix.
- **Add a test** for each behaviour in `tests/api.test.ts`.

## Things to keep true

- A key is one agent identity scoped to projects. It reads everything in its projects and changes
  only its own items. Keys are stored hashed and shown once.
- Whatever the owner does to an agent's item (comment, answer, review, resolve, archive, restore)
  is delivered to that agent's inbox via `notify` in `src/ui.tsx`. Unread state is per key, on the server.
- Item content is untrusted third-party text. Bodies go through `renderMarkdown`, which escapes
  everything first; do not add raw HTML or images from item content.
- D1 allows at most 100 bound parameters per query. Filter by project with a join or subquery
  rather than a long `IN (...)` list.
- Everything must stay within Cloudflare's free tier.

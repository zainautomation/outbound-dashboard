# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at localhost:3000
npm run build    # Production build
npm run start    # Run production build
npx tsc --noEmit # Type check
```

No test runner or linter is configured — TypeScript (`strict: true`) is the primary safety net.

## Architecture

### Data Flow

The browser never calls Instantly directly. All live data goes through one server-side route:

```
Browser → POST /api/sync → Instantly MCP server (JSON-RPC over SSE)
                              ├─ list_campaigns
                              ├─ get_campaign_analytics
                              ├─ list_accounts
                              └─ count_unread_emails
                         → flat DashboardData JSON → browser render
```

The four tool calls run in parallel on one MCP session. There is no LLM in this
path — `/api/sync` speaks JSON-RPC to the MCP server itself.

MCP URLs embed the client's Instantly API key. They are read only inside API
routes, never sent to the browser, and `redact()` strips them from error
messages before anything is logged or returned.

### Auth Model

Two roles validated in `/api/auth` against env vars only — no database:

- **Admin**: `ADMIN_USERNAME` + `ADMIN_PASSWORD` → sees all clients via dropdown, can switch workspaces
- **Client**: `CLIENT_{ID}_USERNAME` + `CLIENT_{ID}_PASSWORD` → locked to their own workspace

`getAdminCredentials()` returns `null` when the env vars are unset — there is
deliberately no default value, so a misconfigured deployment fails closed rather
than granting admin access. Do not reintroduce a fallback.

`/api/sync` re-validates credentials on every call (role + username + password
in the request body) via `authorize()`, which also pins client users to their
own `clientId` regardless of what they request.

### Client Configuration

Clients are discovered dynamically from env vars — zero code changes to add one:

```
CLIENT_{ID}_NAME=Display Name
CLIENT_{ID}_MCP_URL=https://mcp.instantly.ai/mcp/API_KEY
CLIENT_{ID}_USERNAME=login
CLIENT_{ID}_PASSWORD=password
```

`src/lib/clients.ts` scans `process.env` for keys matching `CLIENT_*_NAME`. The
`{ID}` segment becomes the client's internal id (lowercased). Entries missing
any of the four keys are skipped rather than half-configured.

### File Map

- `src/app/page.tsx` — all UI (`'use client'`), components co-located as named functions
- `src/app/layout.tsx` — Bricolage Grotesque + DM Mono fonts, metadata
- `src/app/globals.css` — theme CSS variables, animations
- `src/app/api/auth/route.ts` — POST: validates credentials, returns role + client list
- `src/app/api/sync/route.ts` — POST: authorizes, calls MCP, returns `DashboardData`
- `src/lib/clients.ts` — env-var client registry and credential checks
- `src/lib/types.ts` — shared types across API routes and UI
- `src/lib/metrics.ts` — reply rate, warmup averages, sorting (shared by `Workspace` and `AIAssistant`)

Derived metrics belong in `src/lib/metrics.ts`, not inline in a component —
`Workspace` and `AIAssistant` both consume them and previously drifted apart.

## Design System

Light theme: **pearl white surfaces, charcoal text.** Colors are CSS variables in
`globals.css` and are mirrored in `tailwind.config.js` — always use them, never
hardcode hex values in new UI.

| Variable | Use |
|---|---|
| `var(--pearl)` | Page background |
| `var(--surface)` | Cards, nav (white, raised) |
| `var(--surface-sunken)` | Inputs, progress tracks |
| `var(--ink)` | Primary text (charcoal) |
| `var(--ink-soft)` | Secondary text |
| `var(--ink-muted)` | Labels, meta |
| `var(--line)` / `var(--line-strong)` | Hairlines, borders |
| `var(--orange)` | Brand fills — logo tile, decorative bars |
| `var(--orange-ink)` | Orange **text** and CTA fills on light surfaces |
| `var(--blue-ink)` / `var(--green-ink)` | Reply metrics / pipeline values |

Orange splits deliberately: `--orange` (#f97316) is vivid enough for fills but
only hits ~2.6:1 on pearl, so anything that renders as text or carries white
text uses `--orange-ink` (#b34a08, ~5:1). Do not use `--orange` for text.

Fonts: `Bricolage Grotesque` (UI, `--font-sans`), `DM Mono` (numbers, emails,
`--font-mono`). Section titles are `--orange-ink`, uppercase, `tracking-widest`,
followed by a hairline rule.

## What Does Not Exist Yet

These features are planned but unbuilt — do not assume they exist:

- Admin overview page (all clients as summary cards)
- Add-client UI form (clients are env-var only today)
- Per-campaign drill-down or email sequence viewer
- Notifications for reply spikes or warmup score drops

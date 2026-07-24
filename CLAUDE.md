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

The browser never calls a outreach platform directly. Two server-side routes:

```
POST /api/sync      → one client   → provider adapter → that client's MCP server
POST /api/overview  → all clients  → provider adapter per client, in parallel
```

Both return normalized JSON. There is no LLM in this path — the adapters speak
JSON-RPC to the MCP servers themselves.

MCP URLs embed the platform API key. They are read only inside API routes, never
sent to the browser, and `redact()` in `src/lib/authorize.ts` strips *every*
configured client's URL from error messages before anything is logged or
returned.

### Providers

`src/lib/providers/` normalizes two platforms that agree on almost nothing but
the word "MCP". Before changing an adapter, know these differences:

| | Instantly | Smartlead |
|---|---|---|
| Transport | Streamable HTTP (`POST` + `mcp-session-id`) | SSE — `GET /sse` opens a stream, server replies with a POST endpoint, responses come back on the stream matched by JSON-RPC id |
| Auth | key in URL path | key must be passed as a `smartlead_user_api_key` **argument** on every call |
| Analytics | one call returns every campaign | one call **per campaign** |
| Active | `status === 1` | `status === "ACTIVE"` |
| Counts | numbers | strings — always run through `num()` |
| Body | pure JSON | prose prefix then JSON — always run through `parseToolJson()` |
| Warmup | `stat_warmup_score` 0–100 | none; derived from inbox placement |
| Unread | yes | not exposed — `unreadCount` is undefined, and the UI shows "—" |

The Smartlead MCP URL may carry its key as `?smartlead_user_api_key=KEY` or as a
bare `?KEY`. `extractApiKey()` handles both; the bare form is *not* forwarded by
the server to tool calls, which is why the key is injected per call.

Adding a platform: write an adapter returning `ProviderData`, register it in
`src/lib/providers/index.ts`, and extend `ProviderId`.

### Auth Model

Two roles validated against env vars only — no database:

- **Admin**: `ADMIN_USERNAME` + `ADMIN_PASSWORD` → the cross-client overview plus any single workspace
- **Client**: `CLIENT_{ID}_USERNAME` + `CLIENT_{ID}_PASSWORD` → locked to their own workspace

`getAdminCredentials()` returns `null` when the env vars are unset — there is
deliberately no default value, so a misconfigured deployment fails closed rather
than granting admin access. **Do not reintroduce a fallback.**

Every data route re-validates credentials from the request body:
`authorizeClient()` pins client users to their own `clientId` regardless of what
they request; `authorizeAdmin()` guards `/api/overview` entirely.

### Client Configuration

Clients are discovered dynamically from env vars — zero code changes to add one:

```
CLIENT_{ID}_NAME=Display Name
CLIENT_{ID}_MCP_URL=https://mcp.instantly.ai/mcp/API_KEY
CLIENT_{ID}_USERNAME=login
CLIENT_{ID}_PASSWORD=password
CLIENT_{ID}_PROVIDER=instantly|smartlead   # optional; inferred from the host
```

`src/lib/clients.ts` scans `process.env` for keys matching `CLIENT_*_NAME`. The
`{ID}` segment becomes the client's internal id (lowercased). Entries missing any
required key are skipped rather than half-configured. All values are trimmed —
a stray leading space in a NAME reaches the UI otherwise.

### File Map

- `src/app/page.tsx` — all UI (`'use client'`), components co-located
- `src/app/api/auth/route.ts` — POST: validates credentials, returns role + client list
- `src/app/api/sync/route.ts` — POST: one client's workspace
- `src/app/api/overview/route.ts` — POST: admin-only, every client at once
- `src/lib/providers/mcp.ts` — both MCP transports, `parseToolJson()`, `num()`
- `src/lib/providers/{instantly,smartlead}.ts` — per-platform adapters
- `src/lib/authorize.ts` — credential checks and `redact()`
- `src/lib/clients.ts` — env-var client registry
- `src/lib/types.ts` — types shared between API routes and UI
- `src/lib/metrics.ts` — reply/bounce rate, warmup averages, sorting, `sumAnalytics()` totals

Derived metrics belong in `src/lib/metrics.ts`, not inline in a component —
`Workspace`, `AdminOverview` and `AIAssistant` all consume them.

One failing client must never blank the admin overview: `/api/overview` catches
per-client errors and reports them in that client's rollup.

## Design System

Light theme: **pearl white surfaces, dark navy-blue text.** Colors are CSS
variables in `globals.css` and mirrored in `tailwind.config.js` — always use
them, never hardcode hex values in new UI.

| Variable | Use |
|---|---|
| `var(--pearl)` | Page background |
| `var(--surface)` | Cards, nav (white, raised) |
| `var(--surface-sunken)` | Inputs, progress tracks |
| `var(--ink)` | Primary text (dark navy `#13294d`) |
| `var(--ink-soft)` | Secondary text |
| `var(--ink-muted)` | Labels, meta |
| `var(--line)` / `var(--line-strong)` | Hairlines, borders |
| `var(--orange)` | Brand fills — logo tile, decorative bars |
| `var(--orange-ink)` | Orange **text** and CTA fills on light surfaces |
| `var(--blue-ink)` | Reply-rate metrics |
| `var(--green-ink)` | Positive replies, pipeline $, healthy states |

Orange splits deliberately: `--orange` (#f97316) is vivid enough for fills but
only hits ~2.6:1 on pearl, so anything that renders as text or carries white
text uses `--orange-ink` (#b34a08, ~5:1). Do not use `--orange` for text.

**Positive replies** (Instantly opportunities / Smartlead "interested") are
always green with the `DollarBadge` — a green coin with a `$`. That badge is the
one place the dollar motif appears; keep it tied to positive-reply figures.

Fonts: `Bricolage Grotesque` (UI, `--font-sans`, the Zutomate brand font),
`DM Mono` (numbers, emails, `--font-mono`). Headings use `font-bold` (700) —
deliberately not `extrabold`. Section titles are `--orange-ink`, uppercase,
`tracking-widest`, then a hairline.

## What Does Not Exist Yet

These features are planned but unbuilt — do not assume they exist:

- Add-client UI form (clients are env-var only today)
- Per-campaign drill-down or email sequence viewer
- Notifications for reply spikes or warmup score drops
- Any persistence — every sync hits the provider live, nothing is cached or stored

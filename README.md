# Zutomate Dashboard

Multi-client outbound dashboard built with Next.js 14. Each client's workspace is
backed by either **Instantly** or **Smartlead**, reached over that platform's MCP server.

## How live data works

```
Browser ─┬─ POST /api/sync      (one client)     ─┐
         └─ POST /api/overview  (all clients)    ─┴─→ provider adapter → MCP server
                                                        ↓
                                              normalized JSON → render
```

Every 30 seconds the frontend re-syncs. Routes re-validate credentials on every
call, then hand off to the provider adapter for that client.

MCP URLs contain the platform API key. They are only ever read inside API routes,
never sent to the browser, and are stripped from error messages before anything
is logged or returned.

## Providers

Both platforms speak MCP, but almost nothing else about them matches — the
adapters in `src/lib/providers/` normalize the differences:

| | Instantly | Smartlead |
|---|---|---|
| Transport | Streamable HTTP | SSE (long-lived stream) |
| Auth | key in the URL path | key as a `smartlead_user_api_key` argument |
| Campaign list | `list_campaigns` | `get_campaigns` |
| Analytics | `get_campaign_analytics` (all at once) | `get_campaign_analytics` (one call per campaign) |
| Accounts | `list_accounts` | `get_email_accounts` |
| Active flag | `status === 1` | `status === "ACTIVE"` |
| Counts | numbers | strings |
| Response body | JSON | prose prefix, then JSON |
| Warmup | `stat_warmup_score` (0–100) | none — derived from inbox placement |
| Unread count | yes | not exposed |

Adding a third platform means writing one adapter that returns `ProviderData`
and registering it in `src/lib/providers/index.ts`.

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in your credentials
npm run dev                  # http://localhost:3000
```

## Commands

```bash
npm run dev      # dev server
npm run build    # production build
npm run start    # serve the production build
npx tsc --noEmit # type check (no test runner or linter is configured)
```

## Adding a client

Clients are defined entirely by environment variables — no code changes needed.
In Vercel: Settings → Environment Variables, then redeploy.

```
CLIENT_NEWCLIENT_NAME=Client Display Name
CLIENT_NEWCLIENT_MCP_URL=https://mcp.instantly.ai/mcp/THEIR_API_KEY
CLIENT_NEWCLIENT_USERNAME=their_login
CLIENT_NEWCLIENT_PASSWORD=their_password
```

The `{ID}` segment becomes the client's internal id, lowercased. All four keys
must be set or the client is skipped. The provider is inferred from the MCP
host; override it with `CLIENT_NEWCLIENT_PROVIDER` if needed.

## Auth

Two roles, validated against env vars only — there is no database.

- **Admin** (`ADMIN_USERNAME` + `ADMIN_PASSWORD`) — lands on the **All clients**
  overview showing every campaign across every workspace, and can drill into any
  single client.
- **Client** (`CLIENT_{ID}_USERNAME` + `CLIENT_{ID}_PASSWORD`) — pinned to their
  own workspace, with no access to the overview.

Admin credentials have no fallback value: if the env vars are unset, admin login
simply fails.

## Deploy

Push to GitHub, then import the repo at vercel.com and add the same environment
variables under Settings → Environment Variables.

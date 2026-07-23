# Zutomate Dashboard

Multi-client Instantly outreach dashboard built with Next.js 14 and the Instantly MCP server.

## How live data works

```
Browser → POST /api/sync → Instantly MCP server (JSON-RPC over SSE) → structured JSON → Browser
```

Every 30 seconds the frontend calls `/api/sync`. That route re-validates the
caller's credentials, opens an MCP session, and calls four tools in parallel —
`list_campaigns`, `get_campaign_analytics`, `list_accounts`, `count_unread_emails` —
then returns a single flat payload.

MCP URLs contain Instantly API keys and are only ever read inside API routes;
they never reach the browser, and they are stripped out of error messages
before anything is logged or returned.

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
must be set or the client is skipped.

## Auth

Two roles, validated against env vars only — there is no database.

- **Admin** (`ADMIN_USERNAME` + `ADMIN_PASSWORD`) — switches between all client workspaces.
- **Client** (`CLIENT_{ID}_USERNAME` + `CLIENT_{ID}_PASSWORD`) — pinned to their own workspace.

Admin credentials have no fallback value: if the env vars are unset, admin login
simply fails.

## Deploy

Push to GitHub, then import the repo at vercel.com and add the same environment
variables under Settings → Environment Variables.

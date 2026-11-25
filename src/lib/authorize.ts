import type { NextRequest } from 'next/server'
import { Client, getClients, toSummary } from './clients'
import { readSession, type SessionClaims } from './session'
import type { AuthResponse } from './types'

/**
 * MCP URLs embed the client's API key, and errors surface in the browser —
 * strip every configured URL out before anything is logged or returned.
 */
export function redact(message: string): string {
  let safe = message
  for (const { mcpUrl, linkedinMcpUrl } of getClients()) {
    for (const secret of [mcpUrl, linkedinMcpUrl, ...queryValues(mcpUrl), ...queryValues(linkedinMcpUrl)]) {
      if (secret) safe = safe.split(secret).join('[redacted]')
    }
  }
  return safe
}

/** A key can also leak on its own (HeyReach's xMcpKey, Smartlead's api key), raw or URL-decoded. */
function queryValues(url: string | undefined): string[] {
  const query = url?.split('?')[1]
  if (!query) return []
  return query.split('&').flatMap(pair => {
    const raw = pair.includes('=') ? pair.split('=')[1] : pair
    if (!raw || raw.length < 12) return []
    try {
      return [raw, decodeURIComponent(raw)]
    } catch {
      return [raw]
    }
  })
}

/**
 * Resolves the client whose data the caller may read, or null. Admins may
 * read any client; a client user is pinned to their own workspace regardless
 * of the clientId they ask for.
 */
export function authorizeClient(req: NextRequest, clientId: string): Client | null {
  const session = readSession(req)
  if (!session) return null
  const id = session.role === 'admin' ? clientId : session.clientId
  if (session.role === 'user' && clientId !== session.clientId) return null
  return getClients().find(c => c.id === id) ?? null
}

/** Admin-only routes: returns every client, or null when not an admin. */
export function authorizeAdmin(req: NextRequest): Client[] | null {
  return readSession(req)?.role === 'admin' ? getClients() : null
}

/** What the browser needs to render a signed-in session. */
export function authResponse(session: SessionClaims): AuthResponse | null {
  if (session.role === 'admin') {
    return { role: 'admin', username: session.username, clients: getClients().map(toSummary) }
  }
  const client = getClients().find(c => c.id === session.clientId)
  return client
    ? { role: 'user', username: session.username, clientId: client.id, client: toSummary(client) }
    : null
}

import { Client, findClientByCredentials, getClients, isAdmin } from './clients'

export interface Credentials {
  role?: string
  username?: string
  password?: string
}

/**
 * MCP URLs embed the client's API key, and errors surface in the browser —
 * strip every configured URL out before anything is logged or returned.
 */
export function redact(message: string): string {
  let safe = message
  for (const { mcpUrl, linkedinMcpUrl } of getClients()) {
    for (const secret of [mcpUrl, linkedinMcpUrl, ...queryValues(linkedinMcpUrl)]) {
      if (secret) safe = safe.split(secret).join('[redacted]')
    }
  }
  return safe
}

/** A key can also leak on its own (HeyReach's xMcpKey), raw or URL-decoded. */
function queryValues(url: string | undefined): string[] {
  const query = url?.split('?')[1]
  if (!query) return []
  return query.split('&').flatMap(pair => {
    const raw = pair.split('=')[1]
    if (!raw || raw.length < 12) return []
    try {
      return [raw, decodeURIComponent(raw)]
    } catch {
      return [raw]
    }
  })
}

/**
 * Resolves the client whose data the caller may read, or null if the
 * credentials are bad. Admins may read any client; a client user is pinned to
 * their own workspace regardless of the clientId they ask for.
 */
export function authorizeClient(clientId: string, creds: Credentials): Client | null {
  const { role, username = '', password = '' } = creds

  if (role === 'admin') {
    if (!isAdmin(username, password)) return null
    return getClients().find(c => c.id === clientId) ?? null
  }

  const client = findClientByCredentials(username, password)
  return client && client.id === clientId ? client : null
}

/** Admin-only routes: returns every client, or null when not an admin. */
export function authorizeAdmin(creds: Credentials): Client[] | null {
  const { role, username = '', password = '' } = creds
  if (role !== 'admin' || !isAdmin(username, password)) return null
  return getClients()
}

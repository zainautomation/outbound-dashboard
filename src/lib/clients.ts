import { detectProvider, isProviderId } from './providers'
import type { ClientSummary, ProviderId } from './types'

export interface Client extends ClientSummary {
  mcpUrl: string
  username: string
  password: string
}

/** Env values are trimmed — a stray space in a NAME reaches the UI otherwise. */
function env(key: string): string | undefined {
  return process.env[key]?.trim() || undefined
}

/**
 * Clients are declared entirely through env vars, so onboarding one needs no
 * code change: CLIENT_{ID}_NAME / _MCP_URL / _USERNAME / _PASSWORD, plus an
 * optional _PROVIDER ('instantly' | 'smartlead') when the MCP host is
 * ambiguous. Entries missing any required key are skipped rather than
 * half-configured.
 */
export function getClients(): Client[] {
  const ids = Object.keys(process.env)
    .filter(k => k.startsWith('CLIENT_') && k.endsWith('_NAME'))
    .map(k => k.slice('CLIENT_'.length, -'_NAME'.length))

  return ids.flatMap(id => {
    const name = env(`CLIENT_${id}_NAME`)
    const mcpUrl = env(`CLIENT_${id}_MCP_URL`)
    const username = env(`CLIENT_${id}_USERNAME`)
    const password = env(`CLIENT_${id}_PASSWORD`)
    if (!name || !mcpUrl || !username || !password) return []

    const configured = env(`CLIENT_${id}_PROVIDER`)?.toLowerCase()
    const provider: ProviderId =
      configured && isProviderId(configured) ? configured : detectProvider(mcpUrl)

    return [{ id: id.toLowerCase(), name, mcpUrl, username, password, provider }]
  })
}

export function toSummary(client: Client): ClientSummary {
  return { id: client.id, name: client.name, provider: client.provider }
}

/**
 * Returns null when ADMIN_USERNAME/ADMIN_PASSWORD are unset. There is
 * deliberately no default — a fallback would grant admin access to a
 * misconfigured deployment.
 */
export function getAdminCredentials(): { username: string; password: string } | null {
  const username = env('ADMIN_USERNAME')
  const password = env('ADMIN_PASSWORD')
  return username && password ? { username, password } : null
}

export function isAdmin(username: string, password: string): boolean {
  const admin = getAdminCredentials()
  return admin !== null && username === admin.username && password === admin.password
}

export function findClientByCredentials(username: string, password: string): Client | null {
  return getClients().find(c => c.username === username && c.password === password) ?? null
}

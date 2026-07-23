import type { ClientSummary } from './types'

export interface Client extends ClientSummary {
  mcpUrl: string
  username: string
  password: string
}

/**
 * Clients are declared entirely through env vars, so onboarding one needs no
 * code change: CLIENT_{ID}_NAME / _MCP_URL / _USERNAME / _PASSWORD.
 * Entries missing any of the four are skipped rather than half-configured.
 */
export function getClients(): Client[] {
  const ids = Object.keys(process.env)
    .filter(k => k.startsWith('CLIENT_') && k.endsWith('_NAME'))
    .map(k => k.slice('CLIENT_'.length, -'_NAME'.length))

  return ids.flatMap(id => {
    const name = process.env[`CLIENT_${id}_NAME`]
    const mcpUrl = process.env[`CLIENT_${id}_MCP_URL`]
    const username = process.env[`CLIENT_${id}_USERNAME`]
    const password = process.env[`CLIENT_${id}_PASSWORD`]
    if (!name || !mcpUrl || !username || !password) return []
    return [{ id: id.toLowerCase(), name, mcpUrl, username, password }]
  })
}

/**
 * Returns null when ADMIN_USERNAME/ADMIN_PASSWORD are unset. There is
 * deliberately no default — a fallback would grant admin access to a
 * misconfigured deployment.
 */
export function getAdminCredentials(): { username: string; password: string } | null {
  const username = process.env.ADMIN_USERNAME
  const password = process.env.ADMIN_PASSWORD
  return username && password ? { username, password } : null
}

export function isAdmin(username: string, password: string): boolean {
  const admin = getAdminCredentials()
  return admin !== null && username === admin.username && password === admin.password
}

export function findClientByCredentials(username: string, password: string): Client | null {
  return getClients().find(c => c.username === username && c.password === password) ?? null
}

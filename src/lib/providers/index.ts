import { cached } from '../cache'
import { fetchInstantly } from './instantly'
import { fetchSmartlead } from './smartlead'
import type { ProviderData, ProviderId } from '../types'

/** Infers the platform from the MCP host; override with CLIENT_{ID}_PROVIDER. */
export function detectProvider(mcpUrl: string): ProviderId {
  try {
    const host = new URL(mcpUrl).hostname
    if (host.includes('smartlead')) return 'smartlead'
  } catch {
    // Malformed URL — fall through and let the fetch fail with a clear error.
  }
  return 'instantly'
}

export function isProviderId(value: string): value is ProviderId {
  return value === 'instantly' || value === 'smartlead'
}

/**
 * Short TTL so the overview and a workspace polling at the same moment share
 * one fetch; a failed refresh serves the last good copy for up to 30 minutes.
 */
const CACHE = { ttlMs: 20_000, staleMs: 30 * 60_000 }

export function fetchProviderData(provider: ProviderId, mcpUrl: string): Promise<ProviderData> {
  return cached(`${provider}:${mcpUrl}`, CACHE, () =>
    provider === 'smartlead' ? fetchSmartlead(mcpUrl) : fetchInstantly(mcpUrl),
  )
}

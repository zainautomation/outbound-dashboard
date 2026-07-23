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

export function fetchProviderData(provider: ProviderId, mcpUrl: string): Promise<ProviderData> {
  return provider === 'smartlead' ? fetchSmartlead(mcpUrl) : fetchInstantly(mcpUrl)
}

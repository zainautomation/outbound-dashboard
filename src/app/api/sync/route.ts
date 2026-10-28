import { NextRequest, NextResponse } from 'next/server'
import { authorizeClient, redact } from '@/lib/authorize'
import { sumAnalytics } from '@/lib/metrics'
import { fetchProviderData } from '@/lib/providers'
import { fetchHeyReach } from '@/lib/providers/heyreach'
import type { DashboardData } from '@/lib/types'

/** Smartlead and HeyReach need a round trip per campaign. */
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { clientId, role, username, password } = await req.json()

    const client = authorizeClient(clientId, { role, username, password })
    if (!client) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // LinkedIn is optional and must never take the email workspace down with it.
    const [provider, linkedin] = await Promise.all([
      fetchProviderData(client.provider, client.mcpUrl),
      client.linkedinMcpUrl
        ? fetchHeyReach(client.linkedinMcpUrl).then(
            data => ({ data }),
            err => ({ error: redact(err instanceof Error ? err.message : 'LinkedIn sync failed') }),
          )
        : undefined,
    ])

    const data: DashboardData = {
      ...provider,
      ...sumAnalytics(provider.analytics),
      clientId: client.id,
      clientName: client.name,
      provider: client.provider,
      activeCampaigns: provider.campaigns.filter(c => c.active).length,
      linkedin: linkedin && 'data' in linkedin ? linkedin.data : undefined,
      linkedinError: linkedin && 'error' in linkedin ? linkedin.error : undefined,
      syncedAt: new Date().toISOString(),
    }

    return NextResponse.json(data)
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : 'Sync failed')
    console.error('Sync error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

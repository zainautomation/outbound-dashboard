import { NextRequest, NextResponse } from 'next/server'
import { authorizeClient, redact } from '@/lib/authorize'
import { fetchProviderData } from '@/lib/providers'
import type { DashboardData } from '@/lib/types'

/** Smartlead needs a round trip per campaign and per account. */
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { clientId, role, username, password } = await req.json()

    const client = authorizeClient(clientId, { role, username, password })
    if (!client) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const provider = await fetchProviderData(client.provider, client.mcpUrl)

    const data: DashboardData = {
      ...provider,
      clientId: client.id,
      clientName: client.name,
      provider: client.provider,
      totalSent: provider.analytics.reduce((s, a) => s + a.sent, 0),
      totalReplies: provider.analytics.reduce((s, a) => s + a.replies, 0),
      activeCampaigns: provider.campaigns.filter(c => c.active).length,
      syncedAt: new Date().toISOString(),
    }

    return NextResponse.json(data)
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : 'Sync failed')
    console.error('Sync error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

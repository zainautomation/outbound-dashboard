import { NextRequest, NextResponse } from 'next/server'
import { authorizeAdmin, redact } from '@/lib/authorize'
import { averageWarmupScore } from '@/lib/metrics'
import { fetchProviderData } from '@/lib/providers'
import type { AttributedCampaign, ClientRollup, OverviewData } from '@/lib/types'

/** Every client is fetched on one request, and Smartlead needs several round trips. */
export const maxDuration = 60

/**
 * Admin-only cross-client view: every campaign from every client in one
 * payload. A client that fails to sync is reported in its rollup with an
 * error rather than failing the whole request — one broken MCP server should
 * not blank the entire overview.
 */
export async function POST(req: NextRequest) {
  try {
    const { role, username, password } = await req.json()

    const clients = authorizeAdmin({ role, username, password })
    if (!clients) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const results = await Promise.all(
      clients.map(async client => {
        const identity = {
          clientId: client.id,
          clientName: client.name,
          provider: client.provider,
        }

        try {
          const data = await fetchProviderData(client.provider, client.mcpUrl)
          const activeById = new Map(data.campaigns.map(c => [c.id, c]))

          const campaigns: AttributedCampaign[] = data.analytics.map(a => ({
            ...a,
            ...identity,
            active: activeById.get(a.campaignId)?.active ?? false,
            createdAt: activeById.get(a.campaignId)?.createdAt,
          }))

          const rollup: ClientRollup = {
            ...identity,
            totalSent: data.analytics.reduce((s, a) => s + a.sent, 0),
            totalReplies: data.analytics.reduce((s, a) => s + a.replies, 0),
            activeCampaigns: data.campaigns.filter(c => c.active).length,
            accountCount: data.accounts.length,
            avgWarmup: averageWarmupScore(data.accounts),
          }

          return { rollup, campaigns }
        } catch (err) {
          const rollup: ClientRollup = {
            ...identity,
            totalSent: 0,
            totalReplies: 0,
            activeCampaigns: 0,
            accountCount: 0,
            error: redact(err instanceof Error ? err.message : 'Sync failed'),
          }
          return { rollup, campaigns: [] as AttributedCampaign[] }
        }
      }),
    )

    const campaigns = results.flatMap(r => r.campaigns).sort((a, b) => b.sent - a.sent)
    const rollups = results.map(r => r.rollup)

    const overview: OverviewData = {
      clients: rollups,
      campaigns,
      totalSent: rollups.reduce((s, c) => s + c.totalSent, 0),
      totalReplies: rollups.reduce((s, c) => s + c.totalReplies, 0),
      activeCampaigns: rollups.reduce((s, c) => s + c.activeCampaigns, 0),
      syncedAt: new Date().toISOString(),
    }

    return NextResponse.json(overview)
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : 'Overview failed')
    console.error('Overview error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { authorizeAdmin, redact } from '@/lib/authorize'
import { averageWarmupScore, mergeDaily, sumAnalytics } from '@/lib/metrics'
import { fetchProviderData } from '@/lib/providers'
import { fetchHeyReach } from '@/lib/providers/heyreach'
import type { AttributedCampaign, ClientRollup, DailyPoint, OverviewData } from '@/lib/types'

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

        // LinkedIn totals are a bonus — a HeyReach failure leaves them out.
        const linkedinPromise = client.linkedinMcpUrl
          ? fetchHeyReach(client.linkedinMcpUrl).then(d => d.totals, () => undefined)
          : Promise.resolve(undefined)

        try {
          const [data, linkedin] = await Promise.all([
            fetchProviderData(client.provider, client.mcpUrl),
            linkedinPromise,
          ])
          const byId = new Map(data.campaigns.map(c => [c.id, c]))

          // Already in the platform's order — keep it.
          const campaigns: AttributedCampaign[] = data.analytics.map(a => {
            const status = byId.get(a.campaignId)?.status ?? 'error'
            return { ...a, ...identity, status, active: status === 'active' }
          })

          const rollup: ClientRollup = {
            ...identity,
            ...sumAnalytics(data.analytics),
            activeCampaigns: data.campaigns.filter(c => c.active).length,
            accountCount: data.accounts.length,
            avgWarmup: averageWarmupScore(data.accounts),
            linkedin,
          }

          return { rollup, campaigns, daily: data.daily }
        } catch (err) {
          const rollup: ClientRollup = {
            ...identity,
            totalSent: 0,
            totalContacted: 0,
            totalReplies: 0,
            totalPositiveReplies: 0,
            totalBounces: 0,
            totalPipeline: 0,
            activeCampaigns: 0,
            accountCount: 0,
            linkedin: await linkedinPromise,
            error: redact(err instanceof Error ? err.message : 'Sync failed'),
          }
          return { rollup, campaigns: [] as AttributedCampaign[], daily: [] as DailyPoint[] }
        }
      }),
    )

    const campaigns = results.flatMap(r => r.campaigns)
    const rollups = results.map(r => r.rollup)
    const sum = (key: keyof Pick<ClientRollup, 'totalSent' | 'totalContacted' | 'totalReplies' | 'totalPositiveReplies' | 'totalBounces' | 'totalPipeline' | 'activeCampaigns'>) =>
      rollups.reduce((s, c) => s + c[key], 0)

    const overview: OverviewData = {
      clients: rollups,
      campaigns,
      totalSent: sum('totalSent'),
      totalContacted: sum('totalContacted'),
      totalReplies: sum('totalReplies'),
      totalPositiveReplies: sum('totalPositiveReplies'),
      totalBounces: sum('totalBounces'),
      totalPipeline: sum('totalPipeline'),
      activeCampaigns: sum('activeCampaigns'),
      daily: mergeDaily(results.map(r => r.daily)),
      syncedAt: new Date().toISOString(),
    }

    return NextResponse.json(overview)
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : 'Overview failed')
    console.error('Overview error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

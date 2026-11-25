import { NextRequest, NextResponse } from 'next/server'
import { authorizeClient, redact } from '@/lib/authorize'
import { fetchProviderData } from '@/lib/providers'
import { fetchHeyReachThreads, fetchInstantlyThreads, fetchSmartleadThreads } from '@/lib/providers/replies'
import type { PositiveThread, RepliesData } from '@/lib/types'

/** Instantly needs several pages of leads and replies. */
export const maxDuration = 60

/**
 * One workspace's positive-reply conversations, email and LinkedIn merged and
 * newest first. A failing source is reported in `errors`; the others still return.
 */
export async function POST(req: NextRequest) {
  try {
    const { clientId } = await req.json()
    const client = authorizeClient(req, clientId)
    if (!client) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const email: Promise<PositiveThread[]> =
      client.provider === 'smartlead'
        ? fetchSmartleadThreads(client.mcpUrl)
        : fetchProviderData('instantly', client.mcpUrl).then(data =>
            fetchInstantlyThreads(client.mcpUrl, new Map(data.campaigns.map(c => [c.id, c.name]))),
          )
    const linkedin = client.linkedinMcpUrl ? fetchHeyReachThreads(client.linkedinMcpUrl) : Promise.resolve([])

    const results = await Promise.allSettled([email, linkedin])
    const labels = ['Email', 'LinkedIn']
    const body: RepliesData = {
      threads: results
        .flatMap(r => (r.status === 'fulfilled' ? r.value : []))
        .sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
      errors: results.flatMap((r, i) =>
        r.status === 'rejected' ? [`${labels[i]}: ${redact(r.reason instanceof Error ? r.reason.message : 'failed')}`] : [],
      ),
    }
    return NextResponse.json(body)
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : 'Replies failed')
    console.error('Replies error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

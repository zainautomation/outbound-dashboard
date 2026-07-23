import { num, openMcpSession, parseToolJson } from './mcp'
import type { Campaign, CampaignAnalytics, EmailAccount, ProviderData } from '../types'

interface SmartleadCampaign {
  id: number
  name: string
  status: string
  created_at?: string
}

/** Counts come back as strings from this API. */
interface SmartleadAnalytics {
  id: number
  name: string
  sent_count?: string | number
  reply_count?: string | number
  total_count?: string | number
}

interface SmartleadAccount {
  id: number
  from_email?: string
  username?: string
}

interface SmartleadWarmup {
  sent_count?: string | number
  spam_count?: string | number
  inbox_count?: string | number
}

/**
 * The Smartlead MCP server wants its key as a named argument. The configured
 * URL may carry it either as `?smartlead_user_api_key=KEY` or as a bare
 * `?KEY` query string, and the bare form is not forwarded to tool calls — so
 * pull it out of the URL and pass it explicitly on every call.
 */
export function extractApiKey(mcpUrl: string): string | null {
  const query = mcpUrl.split('?')[1]
  if (!query) return null
  const named = new URLSearchParams(query).get('smartlead_user_api_key')
  if (named) return named
  return query.includes('=') ? null : decodeURIComponent(query)
}

/** Smartlead has no 0–100 warmup score, so use inbox placement as the analogue. */
function inboxPlacement(stats: SmartleadWarmup): number | undefined {
  const inbox = num(stats.inbox_count)
  const spam = num(stats.spam_count)
  const delivered = inbox + spam
  return delivered > 0 ? Math.round((inbox / delivered) * 100) : undefined
}

/** Per-campaign and per-account calls are serialized in small batches. */
const BATCH_SIZE = 5

async function inBatches<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    results.push(...(await Promise.all(items.slice(i, i + BATCH_SIZE).map(fn))))
  }
  return results
}

export async function fetchSmartlead(mcpUrl: string): Promise<ProviderData> {
  const apiKey = extractApiKey(mcpUrl)
  if (!apiKey) {
    throw new Error('Smartlead MCP URL is missing an API key')
  }

  const session = await openMcpSession(mcpUrl, 'sse')

  try {
    const call = async <T>(tool: string, args: Record<string, unknown> = {}) =>
      parseToolJson<T>(await session.call(tool, { ...args, smartlead_user_api_key: apiKey }), tool)

    const [rawCampaigns, rawAccounts] = await Promise.all([
      call<SmartleadCampaign[]>('get_campaigns'),
      call<SmartleadAccount[]>('get_email_accounts'),
    ])

    const campaignList = Array.isArray(rawCampaigns) ? rawCampaigns : []
    const accountList = Array.isArray(rawAccounts) ? rawAccounts : []

    const campaigns: Campaign[] = campaignList.map(c => ({
      id: String(c.id),
      name: c.name,
      active: c.status?.toUpperCase() === 'ACTIVE',
      createdAt: c.created_at,
    }))

    // Aggregate stats are only available one campaign at a time.
    const analytics: CampaignAnalytics[] = (
      await inBatches(campaignList, async c => {
        try {
          const a = await call<SmartleadAnalytics>('get_campaign_analytics', { campaign_id: c.id })
          return {
            campaignId: String(c.id),
            campaignName: a.name ?? c.name,
            leads: num(a.total_count),
            sent: num(a.sent_count),
            replies: num(a.reply_count),
            opportunityValue: 0,
          }
        } catch {
          // One bad campaign should not blank the whole workspace.
          return null
        }
      })
    ).filter((a): a is CampaignAnalytics => a !== null)

    const accounts: EmailAccount[] = await inBatches(accountList, async acc => {
      const email = acc.from_email ?? acc.username ?? String(acc.id)
      try {
        const stats = await call<SmartleadWarmup>('get_email_warmup_stats', {
          email_account_id: acc.id,
        })
        return { email, warmupScore: inboxPlacement(stats) }
      } catch {
        return { email }
      }
    })

    // Smartlead's MCP surface has no unread-inbox count.
    return { campaigns, analytics, accounts }
  } finally {
    session.close()
  }
}

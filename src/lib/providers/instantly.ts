import { orderLikeCampaigns } from '../metrics'
import { num, openMcpSession, parseToolJson } from './mcp'
import type { CampaignStatus, ProviderData } from '../types'

interface InstantlyCampaign {
  id: string
  name: string
  status: number
  timestamp_created?: string
}

interface Page<T> {
  items?: T[]
  next_starting_after?: string
}

interface InstantlyAnalytics {
  campaign_id: string
  campaign_name: string
  leads_count?: number
  contacted_count?: number
  emails_sent_count?: number
  /** Excludes automatic replies (out-of-office etc.), which are counted separately. */
  reply_count?: number
  bounced_count?: number
  /** Leads marked interested; each carries an opportunity value. */
  total_opportunities?: number
  total_opportunity_value?: number
}

interface InstantlyDaily {
  date: string
  sent?: number
  replies?: number
  opportunities?: number
}

interface InstantlyAccount {
  email: string
  stat_warmup_score?: number
}

/**
 * Instantly status codes: 0 draft, 1 active, 2 paused, 3 completed,
 * 4 running subsequences; negatives are account or bounce-protection holds.
 */
function toStatus(code: number): CampaignStatus {
  if (code === 1 || code === 4) return 'active'
  if (code === 2) return 'paused'
  if (code === 3) return 'completed'
  if (code === 0) return 'draft'
  return 'error'
}

/** list_campaigns pages at most 100 at a time; stop well short of anything runaway. */
const PAGE_SIZE = 100
const MAX_PAGES = 20

export async function fetchInstantly(mcpUrl: string): Promise<ProviderData> {
  const session = await openMcpSession(mcpUrl, 'http')

  try {
    const call = async <T>(tool: string, args: Record<string, unknown> = {}) =>
      parseToolJson<T>(await session.call(tool, args), tool)

    // List endpoints are paginated (10 per page by default) — reading only the
    // first page silently drops campaigns and accounts. The campaign list's
    // order is the order Instantly shows.
    const listAll = async <T>(tool: string) => {
      const all: T[] = []
      let after: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await call<Page<T>>(tool, {
          limit: PAGE_SIZE,
          ...(after ? { starting_after: after } : {}),
        })
        all.push(...(res.items ?? []))
        after = res.next_starting_after
        if (!after || (res.items ?? []).length === 0) break
      }
      return all
    }

    const [campaignList, analyticsRes, accountList, unreadRes, dailyRes] = await Promise.all([
      listAll<InstantlyCampaign>('list_campaigns'),
      call<InstantlyAnalytics[]>('get_campaign_analytics'),
      listAll<InstantlyAccount>('list_accounts'),
      call<{ count?: number }>('count_unread_emails'),
      call<InstantlyDaily[]>('get_daily_campaign_analytics').catch(() => [] as InstantlyDaily[]),
    ])

    const campaigns = campaignList.map(c => {
      const status = toStatus(c.status)
      return {
        id: String(c.id),
        name: c.name,
        status,
        active: status === 'active',
        createdAt: c.timestamp_created,
      }
    })

    const analytics = (Array.isArray(analyticsRes) ? analyticsRes : []).map(a => ({
      campaignId: String(a.campaign_id),
      campaignName: a.campaign_name,
      leads: num(a.leads_count),
      contacted: num(a.contacted_count),
      sent: num(a.emails_sent_count),
      replies: num(a.reply_count),
      positiveReplies: num(a.total_opportunities),
      bounces: num(a.bounced_count),
      opportunityValue: num(a.total_opportunity_value),
    }))

    // Drafts and never-sent campaigns have no analytics row; list them with zeros
    // so the table matches what Instantly shows.
    const reported = new Set(analytics.map(a => a.campaignId))
    for (const c of campaigns) {
      if (reported.has(c.id)) continue
      analytics.push({
        campaignId: c.id,
        campaignName: c.name,
        leads: 0,
        contacted: 0,
        sent: 0,
        replies: 0,
        positiveReplies: 0,
        bounces: 0,
        opportunityValue: 0,
      })
    }

    return {
      campaigns,
      analytics: orderLikeCampaigns(analytics, campaigns),
      accounts: accountList.map(a => ({
        email: a.email,
        warmupScore: a.stat_warmup_score,
      })),
      unreadCount: num(unreadRes.count),
      daily: (Array.isArray(dailyRes) ? dailyRes : []).map(d => ({
        date: d.date,
        sent: num(d.sent),
        replies: num(d.replies),
        positive: num(d.opportunities),
      })),
    }
  } finally {
    session.close()
  }
}

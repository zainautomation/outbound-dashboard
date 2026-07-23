import { num, openMcpSession, parseToolJson } from './mcp'
import type { ProviderData } from '../types'

interface InstantlyCampaign {
  id: string
  name: string
  status: number
  created_at?: string
}

interface InstantlyAnalytics {
  campaign_id: string
  campaign_name: string
  leads_count?: number
  emails_sent_count?: number
  reply_count?: number
  total_opportunity_value?: number
}

interface InstantlyAccount {
  email: string
  stat_warmup_score?: number
}

/** Instantly campaign status 1 means active. */
const ACTIVE_STATUS = 1

export async function fetchInstantly(mcpUrl: string): Promise<ProviderData> {
  const session = await openMcpSession(mcpUrl, 'http')

  try {
    const call = async <T>(tool: string) => parseToolJson<T>(await session.call(tool), tool)

    const [campaignsRes, analyticsRes, accountsRes, unreadRes] = await Promise.all([
      call<{ items?: InstantlyCampaign[] }>('list_campaigns'),
      call<InstantlyAnalytics[]>('get_campaign_analytics'),
      call<{ items?: InstantlyAccount[] }>('list_accounts'),
      call<{ count?: number }>('count_unread_emails'),
    ])

    return {
      campaigns: (campaignsRes.items ?? []).map(c => ({
        id: String(c.id),
        name: c.name,
        active: c.status === ACTIVE_STATUS,
        createdAt: c.created_at,
      })),
      analytics: (Array.isArray(analyticsRes) ? analyticsRes : []).map(a => ({
        campaignId: String(a.campaign_id),
        campaignName: a.campaign_name,
        leads: num(a.leads_count),
        sent: num(a.emails_sent_count),
        replies: num(a.reply_count),
        opportunityValue: num(a.total_opportunity_value),
      })),
      accounts: (accountsRes.items ?? []).map(a => ({
        email: a.email,
        warmupScore: a.stat_warmup_score,
      })),
      unreadCount: num(unreadRes.count),
    }
  } finally {
    session.close()
  }
}

import { num, openMcpSession, parseToolJson } from './mcp'
import type {
  CampaignStatus,
  LinkedInCampaign,
  LinkedInData,
  LinkedInDailyPoint,
  LinkedInStats,
} from '../types'

/*
 * HeyReach — LinkedIn outreach. Its MCP server is stateless Streamable HTTP
 * (no session id) with the key in the URL's `xMcpKey` query parameter. Stats
 * come from get_overall_stats, which returns lifetime `overallStats` plus a
 * `byDayStats` map, filterable by campaign.
 */

interface HeyReachCampaign {
  id: number
  name: string
  status: string
  progressStats?: { totalUsers?: number }
}

interface HeyReachDayStats {
  profileViews?: number
  messagesSent?: number
  totalMessageReplies?: number
  totalInmailReplies?: number
  inmailMessagesSent?: number
  connectionsSent?: number
  connectionsAccepted?: number
  uniqueLeadsContacted?: number
  autoTaggedInterested?: number
}

interface HeyReachStats {
  overallStats?: HeyReachDayStats
  byDayStats?: Record<string, HeyReachDayStats>
}

interface HeyReachAccount {
  firstName?: string
  lastName?: string
  emailAddress?: string
  isActive?: boolean
  activeCampaigns?: number
}

interface Paged<T> {
  totalCount?: number
  items?: T[]
}

/** HeyReach statuses: DRAFT, STARTING, IN_PROGRESS, PAUSED, FINISHED, CANCELED, FAILED. */
function toStatus(raw: string): CampaignStatus {
  switch (raw?.toUpperCase()) {
    case 'IN_PROGRESS':
    case 'STARTING':
      return 'active'
    case 'PAUSED':
      return 'paused'
    case 'FINISHED':
    case 'CANCELED':
      return 'completed'
    case 'DRAFT':
      return 'draft'
    default:
      return 'error'
  }
}

function toStats(s: HeyReachDayStats = {}): LinkedInStats {
  return {
    connectionsSent: num(s.connectionsSent),
    connectionsAccepted: num(s.connectionsAccepted),
    messagesSent: num(s.messagesSent) + num(s.inmailMessagesSent),
    replies: num(s.totalMessageReplies) + num(s.totalInmailReplies),
    interested: num(s.autoTaggedInterested),
    leadsContacted: num(s.uniqueLeadsContacted),
    profileViews: num(s.profileViews),
  }
}

const PAGE_SIZE = 100
const MAX_PAGES = 10
const BATCH_SIZE = 5

export async function fetchHeyReach(mcpUrl: string): Promise<LinkedInData> {
  const session = await openMcpSession(mcpUrl, 'http-stateless')

  try {
    const call = async <T>(tool: string, args: Record<string, unknown> = {}) =>
      parseToolJson<T>(await session.call(tool, args), tool)

    const listAll = async <T>(tool: string) => {
      const all: T[] = []
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await call<Paged<T>>(tool, { offset: page * PAGE_SIZE, limit: PAGE_SIZE })
        const items = res.items ?? []
        all.push(...items)
        if (items.length < PAGE_SIZE || all.length >= num(res.totalCount)) break
      }
      return all
    }

    const [campaignList, overall, accounts] = await Promise.all([
      listAll<HeyReachCampaign>('get_all_campaigns'),
      call<HeyReachStats>('get_overall_stats'),
      listAll<HeyReachAccount>('get_all_linked_in_accounts'),
    ])

    // Per-campaign stats need one call each; keep HeyReach's own order.
    const campaigns: LinkedInCampaign[] = []
    for (let i = 0; i < campaignList.length; i += BATCH_SIZE) {
      const batch = await Promise.all(
        campaignList.slice(i, i + BATCH_SIZE).map(async c => {
          const stats = await call<HeyReachStats>('get_overall_stats', { campaignIds: [c.id] }).catch(
            () => ({}) as HeyReachStats,
          )
          return {
            id: String(c.id),
            name: c.name,
            status: toStatus(c.status),
            leads: num(c.progressStats?.totalUsers),
            ...toStats(stats.overallStats),
          }
        }),
      )
      campaigns.push(...batch)
    }

    const daily: LinkedInDailyPoint[] = Object.entries(overall.byDayStats ?? {})
      .map(([date, s]) => ({
        date: date.slice(0, 10),
        connectionsSent: num(s.connectionsSent),
        connectionsAccepted: num(s.connectionsAccepted),
        replies: num(s.totalMessageReplies) + num(s.totalInmailReplies),
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return {
      totals: toStats(overall.overallStats),
      campaigns,
      senders: accounts.map(a => ({
        name: [a.firstName, a.lastName].filter(Boolean).join(' ') || a.emailAddress || 'LinkedIn account',
        active: Boolean(a.isActive),
        activeCampaigns: num(a.activeCampaigns),
      })),
      daily,
    }
  } finally {
    session.close()
  }
}

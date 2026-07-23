import type { Campaign, CampaignAnalytics, EmailAccount } from './types'

/** Warmup scores below this are surfaced as unhealthy. */
export const WARMUP_THRESHOLD = 95

export function replyRate(sent: number, replies: number): number {
  return sent > 0 ? (replies / sent) * 100 : 0
}

export function averageWarmupScore(accounts: EmailAccount[]): number {
  if (accounts.length === 0) return 0
  const total = accounts.reduce((sum, a) => sum + (a.stat_warmup_score ?? 0), 0)
  return Math.round(total / accounts.length)
}

export function countLowWarmup(accounts: EmailAccount[]): number {
  return accounts.filter(a => (a.stat_warmup_score ?? 0) < WARMUP_THRESHOLD).length
}

/** Newest campaigns first; entries without a known creation date sort last. */
export function sortByNewest(
  analytics: CampaignAnalytics[],
  campaigns: Campaign[],
): CampaignAnalytics[] {
  const createdAt = new Map(campaigns.map(c => [c.id, c.created_at]))
  const time = (a: CampaignAnalytics) => {
    const created = createdAt.get(a.campaign_id)
    return created ? new Date(created).getTime() : 0
  }
  return [...analytics].sort((a, b) => time(b) - time(a))
}

/** The campaign with the highest reply rate, or null when nothing has sent yet. */
export function topCampaign(analytics: CampaignAnalytics[]): CampaignAnalytics | null {
  const sending = analytics.filter(a => (a.emails_sent_count ?? 0) > 0)
  if (sending.length === 0) return null
  return sending.reduce((best, a) =>
    replyRate(a.emails_sent_count ?? 0, a.reply_count ?? 0) >
    replyRate(best.emails_sent_count ?? 0, best.reply_count ?? 0)
      ? a
      : best,
  )
}

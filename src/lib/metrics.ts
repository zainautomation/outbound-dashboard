import type { Campaign, CampaignAnalytics, EmailAccount } from './types'

/** Warmup scores below this are surfaced as unhealthy. */
export const WARMUP_THRESHOLD = 95

export interface Totals {
  totalSent: number
  totalReplies: number
  totalPositiveReplies: number
  totalBounces: number
  totalPipeline: number
}

/** Sums the per-campaign figures both data routes report. */
export function sumAnalytics(analytics: CampaignAnalytics[]): Totals {
  return analytics.reduce<Totals>(
    (t, a) => ({
      totalSent: t.totalSent + a.sent,
      totalReplies: t.totalReplies + a.replies,
      totalPositiveReplies: t.totalPositiveReplies + a.positiveReplies,
      totalBounces: t.totalBounces + a.bounces,
      totalPipeline: t.totalPipeline + a.opportunityValue,
    }),
    { totalSent: 0, totalReplies: 0, totalPositiveReplies: 0, totalBounces: 0, totalPipeline: 0 },
  )
}

export function replyRate(sent: number, replies: number): number {
  return sent > 0 ? (replies / sent) * 100 : 0
}

export function bounceRate(sent: number, bounces: number): number {
  return sent > 0 ? (bounces / sent) * 100 : 0
}

/** Averages only accounts the provider reported a score for. */
export function averageWarmupScore(accounts: EmailAccount[]): number | undefined {
  const scored = accounts.filter(a => a.warmupScore !== undefined)
  if (scored.length === 0) return undefined
  const total = scored.reduce((sum, a) => sum + (a.warmupScore ?? 0), 0)
  return Math.round(total / scored.length)
}

export function countLowWarmup(accounts: EmailAccount[]): number {
  return accounts.filter(a => a.warmupScore !== undefined && a.warmupScore < WARMUP_THRESHOLD).length
}

/** Newest campaigns first; entries without a known creation date sort last. */
export function sortByNewest(
  analytics: CampaignAnalytics[],
  campaigns: Campaign[],
): CampaignAnalytics[] {
  const createdAt = new Map(campaigns.map(c => [c.id, c.createdAt]))
  const time = (a: CampaignAnalytics) => {
    const created = createdAt.get(a.campaignId)
    return created ? new Date(created).getTime() : 0
  }
  return [...analytics].sort((a, b) => time(b) - time(a))
}

/** The campaign with the highest reply rate, or null when nothing has sent yet. */
export function topCampaign<T extends CampaignAnalytics>(analytics: T[]): T | null {
  const sending = analytics.filter(a => a.sent > 0)
  if (sending.length === 0) return null
  return sending.reduce((best, a) =>
    replyRate(a.sent, a.replies) > replyRate(best.sent, best.replies) ? a : best,
  )
}

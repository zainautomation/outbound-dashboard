import type { Campaign, CampaignAnalytics, DailyPoint, EmailAccount } from './types'

/** Warmup scores below this are surfaced as unhealthy. */
export const WARMUP_THRESHOLD = 95

export interface Totals {
  totalSent: number
  totalContacted: number
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
      totalContacted: t.totalContacted + a.contacted,
      totalReplies: t.totalReplies + a.replies,
      totalPositiveReplies: t.totalPositiveReplies + a.positiveReplies,
      totalBounces: t.totalBounces + a.bounces,
      totalPipeline: t.totalPipeline + a.opportunityValue,
    }),
    {
      totalSent: 0,
      totalContacted: 0,
      totalReplies: 0,
      totalPositiveReplies: 0,
      totalBounces: 0,
      totalPipeline: 0,
    },
  )
}

export function replyRate(sent: number, replies: number): number {
  return sent > 0 ? (replies / sent) * 100 : 0
}

export function bounceRate(sent: number, bounces: number): number {
  return sent > 0 ? (bounces / sent) * 100 : 0
}

/** Share of replies that were positive. */
export function positiveRate(replies: number, positive: number): number {
  return replies > 0 ? (positive / replies) * 100 : 0
}

/** Emails sent per positive reply, e.g. 386 for "386:1". Undefined with no positives. */
export function emailsPerLead(sent: number, positive: number): number | undefined {
  return positive > 0 ? Math.round(sent / positive) : undefined
}

export function acceptanceRate(sent: number, accepted: number): number {
  return sent > 0 ? (accepted / sent) * 100 : 0
}

/** Averages only accounts the provider reported a score for. */
export function averageWarmupScore(accounts: EmailAccount[]): number | undefined {
  const scored = accounts.filter(a => a.warmupScore !== undefined)
  if (scored.length === 0) return undefined
  const total = scored.reduce((sum, a) => sum + (a.warmupScore ?? 0), 0)
  return Math.round(total / scored.length)
}

/**
 * Orders analytics rows to match the platform's own campaign list, so the
 * dashboard shows campaigns in the same order as Instantly or Smartlead.
 * Rows for campaigns missing from the list keep their relative order at the end.
 */
export function orderLikeCampaigns(
  analytics: CampaignAnalytics[],
  campaigns: Campaign[],
): CampaignAnalytics[] {
  const position = new Map(campaigns.map((c, i) => [c.id, i]))
  const rank = (a: CampaignAnalytics) => position.get(a.campaignId) ?? Number.MAX_SAFE_INTEGER
  // Array.prototype.sort is stable, so unknown rows keep their order.
  return [...analytics].sort((a, b) => rank(a) - rank(b))
}

/** Sums several daily series into one, by date, oldest first. */
export function mergeDaily(series: DailyPoint[][]): DailyPoint[] {
  const byDate = new Map<string, DailyPoint>()
  for (const point of series.flat()) {
    const d = byDate.get(point.date) ?? { date: point.date, sent: 0, replies: 0, positive: 0 }
    d.sent += point.sent
    d.replies += point.replies
    d.positive += point.positive
    byDate.set(point.date, d)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** The last `days` calendar days of a series, zero-filled where a day has no activity. */
export function lastDays<T extends { date: string }>(
  series: T[],
  days: number,
  empty: (date: string) => T,
): T[] {
  const byDate = new Map(series.map(p => [p.date.slice(0, 10), p]))
  const out: T[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i))
    const key = d.toISOString().slice(0, 10)
    out.push(byDate.get(key) ?? empty(key))
  }
  return out
}

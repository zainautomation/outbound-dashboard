export type Role = 'admin' | 'user'

/** Email platform backing a client's workspace. */
export type ProviderId = 'instantly' | 'smartlead'

/** Normalized campaign lifecycle — each platform's own status codes map onto this. */
export type CampaignStatus = 'active' | 'paused' | 'completed' | 'draft' | 'error'

/** Minimal client identity sent to the browser — never includes MCP URLs or passwords. */
export interface ClientSummary {
  id: string
  name: string
  provider: ProviderId
  /** True when a HeyReach (LinkedIn) connection is configured for this client. */
  hasLinkedIn: boolean
}

export interface Campaign {
  id: string
  name: string
  status: CampaignStatus
  active: boolean
  createdAt?: string
}

export interface CampaignAnalytics {
  campaignId: string
  campaignName: string
  leads: number
  /** Unique prospects contacted. */
  contacted: number
  sent: number
  replies: number
  /** Leads marked interested — Instantly opportunities, Smartlead "interested". */
  positiveReplies: number
  bounces: number
  /** Pipeline value attached to positive replies, where the provider reports one. */
  opportunityValue: number
}

export interface EmailAccount {
  email: string
  /**
   * 0–100 health score. Instantly reports this directly; for Smartlead it is
   * derived from inbox placement. Undefined when the provider has no data.
   */
  warmupScore?: number
}

/** One day of email activity, used for sparklines and the trend chart. */
export interface DailyPoint {
  date: string
  sent: number
  replies: number
  positive: number
}

/** Normalized payload every email provider must produce. */
export interface ProviderData {
  /** In the platform's own order — the UI must not re-sort. */
  campaigns: Campaign[]
  /** In the same order as `campaigns`. */
  analytics: CampaignAnalytics[]
  accounts: EmailAccount[]
  /** Undefined when the provider exposes no unread count. */
  unreadCount?: number
  /** Empty when the provider has no day-level analytics. */
  daily: DailyPoint[]
}

/* ── LinkedIn (HeyReach) ─────────────────────────────────────────────────── */

export interface LinkedInStats {
  connectionsSent: number
  connectionsAccepted: number
  messagesSent: number
  replies: number
  /** Leads HeyReach auto-tagged as interested. */
  interested: number
  leadsContacted: number
  profileViews: number
}

export interface LinkedInCampaign extends LinkedInStats {
  id: string
  name: string
  status: CampaignStatus
  leads: number
}

export interface LinkedInDailyPoint {
  date: string
  connectionsSent: number
  connectionsAccepted: number
  replies: number
}

export interface LinkedInSender {
  name: string
  active: boolean
  activeCampaigns: number
}

export interface LinkedInData {
  totals: LinkedInStats
  /** In HeyReach's own order. */
  campaigns: LinkedInCampaign[]
  senders: LinkedInSender[]
  daily: LinkedInDailyPoint[]
}

/* ── Route payloads ──────────────────────────────────────────────────────── */

/** Response shape of POST /api/sync — one client's workspace. */
export interface DashboardData extends ProviderData {
  clientId: string
  clientName: string
  provider: ProviderId
  totalSent: number
  totalContacted: number
  totalReplies: number
  totalPositiveReplies: number
  totalBounces: number
  totalPipeline: number
  activeCampaigns: number
  /** Present when the client has HeyReach configured and it synced. */
  linkedin?: LinkedInData
  /** Set when HeyReach is configured but failed; email data is still returned. */
  linkedinError?: string
  syncedAt: string
}

/** One client's contribution to the admin overview. */
export interface ClientRollup {
  clientId: string
  clientName: string
  provider: ProviderId
  totalSent: number
  totalContacted: number
  totalReplies: number
  totalPositiveReplies: number
  totalBounces: number
  totalPipeline: number
  activeCampaigns: number
  accountCount: number
  avgWarmup?: number
  linkedin?: LinkedInStats
  /** Set when this client's email platform failed to sync; its numbers are then all zero. */
  error?: string
}

/** A campaign row tagged with the client it belongs to. */
export interface AttributedCampaign extends CampaignAnalytics {
  clientId: string
  clientName: string
  provider: ProviderId
  status: CampaignStatus
  active: boolean
}

/** Response shape of POST /api/overview — every client at once, admin only. */
export interface OverviewData {
  clients: ClientRollup[]
  /** Grouped by client, each client's campaigns in its platform's own order. */
  campaigns: AttributedCampaign[]
  totalSent: number
  totalContacted: number
  totalReplies: number
  totalPositiveReplies: number
  totalBounces: number
  totalPipeline: number
  activeCampaigns: number
  daily: DailyPoint[]
  syncedAt: string
}

/** Response shape of POST /api/auth. */
export type AuthResponse =
  | { role: 'admin'; username: string; clients: ClientSummary[] }
  | { role: 'user'; username: string; clientId: string; client: ClientSummary }

/** Auth response plus the password, which every data route re-validates. */
export type Session = AuthResponse & { password: string }

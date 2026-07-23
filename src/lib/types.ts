export type Role = 'admin' | 'user'

/** Outreach platform backing a client's workspace. */
export type ProviderId = 'instantly' | 'smartlead'

/** Minimal client identity sent to the browser — never includes MCP URL or password. */
export interface ClientSummary {
  id: string
  name: string
  provider: ProviderId
}

export interface Campaign {
  id: string
  name: string
  active: boolean
  createdAt?: string
}

export interface CampaignAnalytics {
  campaignId: string
  campaignName: string
  leads: number
  sent: number
  replies: number
  /** Pipeline value, where the provider reports one. */
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

/** Normalized payload every provider must produce. */
export interface ProviderData {
  campaigns: Campaign[]
  analytics: CampaignAnalytics[]
  accounts: EmailAccount[]
  /** Undefined when the provider exposes no unread count. */
  unreadCount?: number
}

/** Response shape of POST /api/sync — one client's workspace. */
export interface DashboardData extends ProviderData {
  clientId: string
  clientName: string
  provider: ProviderId
  totalSent: number
  totalReplies: number
  activeCampaigns: number
  syncedAt: string
}

/** One client's contribution to the admin overview. */
export interface ClientRollup {
  clientId: string
  clientName: string
  provider: ProviderId
  totalSent: number
  totalReplies: number
  activeCampaigns: number
  accountCount: number
  avgWarmup?: number
  /** Set when this client failed to sync; its numbers are then all zero. */
  error?: string
}

/** A campaign row tagged with the client it belongs to. */
export interface AttributedCampaign extends CampaignAnalytics {
  clientId: string
  clientName: string
  provider: ProviderId
  active: boolean
  createdAt?: string
}

/** Response shape of POST /api/overview — every client at once, admin only. */
export interface OverviewData {
  clients: ClientRollup[]
  campaigns: AttributedCampaign[]
  totalSent: number
  totalReplies: number
  activeCampaigns: number
  syncedAt: string
}

/** Response shape of POST /api/auth. */
export type AuthResponse =
  | { role: 'admin'; username: string; clients: ClientSummary[] }
  | { role: 'user'; username: string; clientId: string }

/** Auth response plus the password, which every data route re-validates. */
export type Session = AuthResponse & { password: string }

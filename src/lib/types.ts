export type Role = 'admin' | 'user'

/** Minimal client identity sent to the browser — never includes MCP URL or password. */
export interface ClientSummary {
  id: string
  name: string
}

export interface Campaign {
  id: string
  name: string
  /** Instantly campaign status; 1 = active. */
  status: number
  created_at?: string
}

export interface CampaignAnalytics {
  campaign_id: string
  campaign_name: string
  leads_count?: number
  emails_sent_count?: number
  reply_count?: number
  total_opportunity_value?: number
}

export interface EmailAccount {
  email: string
  stat_warmup_score?: number
}

/** Response shape of POST /api/sync. */
export interface DashboardData {
  campaigns: Campaign[]
  analytics: CampaignAnalytics[]
  accounts: EmailAccount[]
  unread_count: number
  totalSent: number
  totalReplies: number
  activeCampaigns: number
  clientName: string
  syncedAt: string
}

/** Response shape of POST /api/auth. */
export type AuthResponse =
  | { role: 'admin'; username: string; clients: ClientSummary[] }
  | { role: 'user'; username: string; clientId: string }

/** Auth response plus the password, which /api/sync re-validates on every call. */
export type Session = AuthResponse & { password: string }

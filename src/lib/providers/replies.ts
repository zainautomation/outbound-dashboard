import { cached } from '../cache'
import { cleanBody, htmlToText } from '../text'
import { num, openMcpSession, parseToolJson } from './mcp'
import { extractApiKey } from './smartlead'
import type { PositiveThread, ThreadMessage } from '../types'

/*
 * Positive-reply conversations for the side panel, one fetcher per platform.
 * What counts as "positive" is each platform's own label:
 *   Instantly — lead interest status Interested / Meeting booked / completed / Closed / custom positive
 *   Smartlead — lead categories whose sentiment_type is "positive"
 *   HeyReach  — conversations auto-tagged "Interested"
 */

/** Replies change slowly and these fetches are heavy — reuse for 3 minutes. */
const CACHE = { ttlMs: 3 * 60_000, staleMs: 6 * 60 * 60_000 }

const byTime = (a: ThreadMessage, b: ThreadMessage) => a.at.localeCompare(b.at)

/* ── Instantly ───────────────────────────────────────────────────────────── */

const INSTANTLY_POSITIVE: Record<string, string> = {
  FILTER_LEAD_INTERESTED: 'Interested',
  FILTER_LEAD_MEETING_BOOKED: 'Meeting booked',
  FILTER_LEAD_MEETING_COMPLETED: 'Meeting completed',
  FILTER_LEAD_CLOSED: 'Closed',
  FILTER_LEAD_CUSTOM_LABEL_POSITIVE: 'Positive',
}

interface InstantlyLead {
  email: string
  first_name?: string
  last_name?: string
  company_name?: string
  job_title?: string
  campaign?: string
  timestamp_last_reply?: string
}

interface InstantlyEmail {
  lead?: string
  subject?: string
  timestamp_email?: string
  body?: { text?: string; html?: string }
}

interface Page<T> {
  items?: T[]
  next_starting_after?: string
}

/** Reply inbox pages scanned for positive leads' messages (100 per page). */
const INSTANTLY_EMAIL_PAGES = 8

/** The first reply quotes our outreach underneath — recover it as the opening message. */
function quotedOutreach(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex(l => /wrote:\s*$/i.test(l.trim()))
  if (start === -1) return ''
  return lines
    .slice(start + 1)
    .map(l => l.replace(/^\s*>\s?/, ''))
    .join('\n')
    .split(/\n\s*On\s.+wrote:\s*$/im)[0]
    .trim()
    .slice(0, 2000)
}

export function fetchInstantlyThreads(mcpUrl: string, campaignNames: Map<string, string>): Promise<PositiveThread[]> {
  return cached(`replies:instantly:${mcpUrl}`, CACHE, async () => {
    const session = await openMcpSession(mcpUrl, 'http')
    try {
      const call = async <T>(tool: string, args: Record<string, unknown>) =>
        parseToolJson<T>(await session.call(tool, args), tool)

      const listAll = async <T>(tool: string, args: Record<string, unknown>, maxPages: number) => {
        const all: T[] = []
        let after: string | undefined
        for (let page = 0; page < maxPages; page++) {
          const res = await call<Page<T>>(tool, { ...args, limit: 100, ...(after ? { starting_after: after } : {}) })
          all.push(...(res.items ?? []))
          after = res.next_starting_after
          if (!after || (res.items ?? []).length === 0) break
        }
        return all
      }

      // Positive leads first; their label is the strongest filter that matched.
      const leads = new Map<string, { lead: InstantlyLead; label: string }>()
      for (const [filter, label] of Object.entries(INSTANTLY_POSITIVE)) {
        for (const lead of await listAll<InstantlyLead>('list_leads', { filter }, 5)) {
          const key = lead.email?.toLowerCase()
          if (key && !leads.has(key)) leads.set(key, { lead, label })
        }
      }
      if (leads.size === 0) return []

      const replies = await listAll<InstantlyEmail>('list_emails', { email_type: 'received' }, INSTANTLY_EMAIL_PAGES)
      const byLead = new Map<string, InstantlyEmail[]>()
      for (const email of replies) {
        const key = email.lead?.toLowerCase()
        if (key && leads.has(key)) byLead.set(key, [...(byLead.get(key) ?? []), email])
      }

      return [...leads.entries()].map(([key, { lead, label }]) => {
        const emails = (byLead.get(key) ?? []).sort((a, b) =>
          (a.timestamp_email ?? '').localeCompare(b.timestamp_email ?? ''),
        )
        const messages: ThreadMessage[] = emails.map(e => ({
          from: 'lead',
          at: e.timestamp_email ?? '',
          body: cleanBody(e.body?.text || e.body?.html, !e.body?.text),
        }))
        const firstRaw = emails[0]?.body?.text || (emails[0]?.body?.html ? htmlToText(emails[0].body.html) : '')
        const outreach = quotedOutreach(firstRaw)
        if (outreach) messages.unshift({ from: 'us', at: '', body: outreach })

        const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ')
        return {
          id: `instantly:${key}`,
          channel: 'email' as const,
          leadName: name || lead.email,
          leadEmail: lead.email,
          company: lead.company_name,
          title: lead.job_title,
          campaign: lead.campaign ? campaignNames.get(lead.campaign) : undefined,
          label,
          lastAt: emails.at(-1)?.timestamp_email ?? lead.timestamp_last_reply ?? '',
          messages,
        }
      })
    } finally {
      session.close()
    }
  })
}

/* ── Smartlead ───────────────────────────────────────────────────────────── */

interface SmartleadCategory {
  id: number
  name: string
  sentiment_type?: string
}

interface SmartleadInboxItem {
  email_lead_map_id: string | number
  lead_first_name?: string
  lead_last_name?: string
  lead_email?: string
  lead_category_id?: number
  last_reply_time?: string
  email_campaign_name?: string
  email_history?: { type?: string; time?: string; email_body?: string }[]
}

/** The inbox API returns at most 20 per page. */
const SMARTLEAD_PAGE = 20
const SMARTLEAD_MAX_PAGES = 6

export function fetchSmartleadThreads(mcpUrl: string): Promise<PositiveThread[]> {
  return cached(`replies:smartlead:${mcpUrl}`, CACHE, async () => {
    const apiKey = extractApiKey(mcpUrl)
    if (!apiKey) throw new Error('Smartlead MCP URL is missing an API key')

    const session = await openMcpSession(mcpUrl, 'sse')
    try {
      const call = async <T>(tool: string, args: Record<string, unknown> = {}) =>
        parseToolJson<T>(await session.call(tool, { ...args, smartlead_user_api_key: apiKey }), tool)

      const categories = await call<SmartleadCategory[]>('get_lead_categories')
      const positive = (Array.isArray(categories) ? categories : []).filter(
        c => c.sentiment_type?.toLowerCase() === 'positive',
      )
      if (positive.length === 0) return []
      const names = new Map(positive.map(c => [c.id, c.name]))

      const items: SmartleadInboxItem[] = []
      for (let page = 0; page < SMARTLEAD_MAX_PAGES; page++) {
        const res = await call<{ items?: SmartleadInboxItem[] }>('fetch_master_inbox_replies', {
          offset: page * SMARTLEAD_PAGE,
          limit: SMARTLEAD_PAGE,
          fetch_message_history: true,
          filters: { leadCategories: { categoryIdsIn: positive.map(c => c.id).slice(0, 10) } },
        })
        const batch = res.items ?? []
        items.push(...batch)
        if (batch.length < SMARTLEAD_PAGE) break
      }

      return items.map(item => {
        const messages: ThreadMessage[] = (item.email_history ?? [])
          .map(m => ({
            from: m.type?.toUpperCase() === 'SENT' ? ('us' as const) : ('lead' as const),
            at: m.time ?? '',
            body: cleanBody(m.email_body, true),
          }))
          .filter(m => m.body)
          .sort(byTime)
        const name = [item.lead_first_name, item.lead_last_name].filter(Boolean).join(' ')
        return {
          id: `smartlead:${item.email_lead_map_id}`,
          channel: 'email' as const,
          leadName: name || item.lead_email || 'Lead',
          leadEmail: item.lead_email,
          campaign: item.email_campaign_name,
          label: names.get(num(item.lead_category_id)) ?? 'Positive',
          lastAt: item.last_reply_time ?? messages.at(-1)?.at ?? '',
          messages,
        }
      })
    } finally {
      session.close()
    }
  })
}

/* ── HeyReach (LinkedIn) ─────────────────────────────────────────────────── */

interface HeyReachConversation {
  id: string
  lastMessageAt?: string
  correspondentProfile?: {
    firstName?: string
    lastName?: string
    companyName?: string
    position?: string
    emailAddress?: string
    autoTags?: { name?: string; campaignName?: string }[]
  }
  messages?: { createdAt?: string; body?: string; sender?: string }[]
}

const HEYREACH_PAGE = 100
const HEYREACH_MAX_PAGES = 5

export function fetchHeyReachThreads(mcpUrl: string): Promise<PositiveThread[]> {
  return cached(`replies:heyreach:${mcpUrl}`, CACHE, async () => {
    const session = await openMcpSession(mcpUrl, 'http')
    try {
      const all: HeyReachConversation[] = []
      for (let page = 0; page < HEYREACH_MAX_PAGES; page++) {
        const res = parseToolJson<{ totalCount?: number; items?: HeyReachConversation[] }>(
          await session.call('get_conversations_v2', { offset: page * HEYREACH_PAGE, limit: HEYREACH_PAGE }),
          'get_conversations_v2',
        )
        const batch = res.items ?? []
        all.push(...batch)
        if (batch.length < HEYREACH_PAGE || all.length >= num(res.totalCount)) break
      }

      return all.flatMap(conv => {
        const profile = conv.correspondentProfile ?? {}
        const tag = profile.autoTags?.find(t => t.name?.toLowerCase() === 'interested')
        if (!tag) return []
        const messages: ThreadMessage[] = (conv.messages ?? [])
          .map(m => ({
            from: m.sender === 'ME' ? ('us' as const) : ('lead' as const),
            at: m.createdAt ?? '',
            body: (m.body ?? '').trim(),
          }))
          .filter(m => m.body)
          .sort(byTime)
        return [
          {
            id: `heyreach:${conv.id}`,
            channel: 'linkedin' as const,
            leadName: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'LinkedIn lead',
            leadEmail: profile.emailAddress || undefined,
            company: profile.companyName,
            title: profile.position,
            campaign: tag.campaignName,
            label: 'Interested',
            lastAt: conv.lastMessageAt ?? messages.at(-1)?.at ?? '',
            messages,
          },
        ]
      })
    } finally {
      session.close()
    }
  })
}

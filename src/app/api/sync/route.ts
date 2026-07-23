import { NextRequest, NextResponse } from 'next/server'
import { Client, findClientByCredentials, getClients, isAdmin } from '@/lib/clients'
import type { Campaign, CampaignAnalytics, DashboardData, EmailAccount } from '@/lib/types'

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
}

async function mcpInit(mcpUrl: string): Promise<string> {
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'zutomate', version: '1.0' },
      },
    }),
  })

  const sessionId = res.headers.get('mcp-session-id')
  if (!sessionId) throw new Error('MCP server did not return a session ID')
  return sessionId
}

/** Calls one MCP tool and unwraps the JSON payload from the SSE response. */
async function mcpTool<T>(
  mcpUrl: string,
  sessionId: string,
  id: number,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: { ...MCP_HEADERS, 'mcp-session-id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  })

  const text = await res.text()
  const dataLine = text.split('\n').find(l => l.startsWith('data:'))
  if (!dataLine) throw new Error(`No SSE data from tool ${tool}`)

  const json = JSON.parse(dataLine.slice('data:'.length).trim())
  if (json.error) throw new Error(`MCP error on ${tool}: ${json.error.message}`)

  const contentText = json.result?.content?.[0]?.text
  if (!contentText) throw new Error(`Empty content from tool ${tool}`)
  if (json.result?.isError) throw new Error(`Tool ${tool} error: ${contentText}`)

  return JSON.parse(contentText) as T
}

/**
 * Resolves the client whose data the caller may read, or null if the
 * credentials are bad. Admins may read any client; a client user is pinned to
 * their own workspace regardless of the clientId they ask for.
 */
function authorize(clientId: string, role: string, username: string, password: string): Client | null {
  if (role === 'admin') {
    if (!isAdmin(username, password)) return null
    return getClients().find(c => c.id === clientId) ?? null
  }

  const client = findClientByCredentials(username, password)
  return client && client.id === clientId ? client : null
}

/**
 * MCP URLs embed the client's Instantly API key, and errors surface in the
 * browser — strip the URL out before anything is logged or returned.
 */
function redact(message: string, mcpUrl: string | undefined): string {
  return mcpUrl ? message.split(mcpUrl).join('[mcp-url]') : message
}

export async function POST(req: NextRequest) {
  let mcpUrl: string | undefined

  try {
    const { clientId, role, username, password } = await req.json()

    const client = authorize(clientId, role, username, password)
    if (!client) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    mcpUrl = client.mcpUrl

    const sessionId = await mcpInit(client.mcpUrl)

    const [campaignsRes, analyticsRes, accountsRes, unreadRes] = await Promise.all([
      mcpTool<{ items?: Campaign[] }>(client.mcpUrl, sessionId, 2, 'list_campaigns'),
      mcpTool<CampaignAnalytics[]>(client.mcpUrl, sessionId, 3, 'get_campaign_analytics'),
      mcpTool<{ items?: EmailAccount[] }>(client.mcpUrl, sessionId, 4, 'list_accounts'),
      mcpTool<{ count?: number }>(client.mcpUrl, sessionId, 5, 'count_unread_emails'),
    ])

    const campaigns = campaignsRes.items ?? []
    const analytics = Array.isArray(analyticsRes) ? analyticsRes : []
    const accounts = accountsRes.items ?? []

    const data: DashboardData = {
      campaigns,
      analytics,
      accounts,
      unread_count: unreadRes.count ?? 0,
      totalSent: analytics.reduce((s, a) => s + (a.emails_sent_count ?? 0), 0),
      totalReplies: analytics.reduce((s, a) => s + (a.reply_count ?? 0), 0),
      activeCampaigns: campaigns.filter(c => c.status === 1).length,
      clientName: client.name,
      syncedAt: new Date().toISOString(),
    }

    return NextResponse.json(data)
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : 'Sync failed', mcpUrl)
    console.error('Sync error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

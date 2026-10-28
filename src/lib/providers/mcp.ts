/**
 * Minimal MCP client covering the transports our providers use.
 *
 *  - 'http' (Instantly): Streamable HTTP with a session. Each POST returns its
 *    own response body containing one SSE `data:` frame.
 *  - 'http-stateless' (HeyReach): Streamable HTTP with no session id.
 *  - 'sse'  (Smartlead): the older SSE transport. A GET opens a stream that
 *    stays open; the server replies with a POST endpoint, and every response
 *    arrives back on that one stream, matched by JSON-RPC id.
 */
export type Transport = 'http' | 'http-stateless' | 'sse'

const PROTOCOL_VERSION = '2024-11-05'
const CLIENT_INFO = { name: 'zutomate', version: '1.0' }
const JSON_HEADERS = { 'Content-Type': 'application/json' }
const SSE_HEADERS = { ...JSON_HEADERS, Accept: 'application/json, text/event-stream' }

export interface McpSession {
  /** Calls a tool and returns its text content, or throws with the tool's error. */
  call(tool: string, args?: Record<string, unknown>): Promise<string>
  close(): void
}

/** Pulls the JSON-RPC payloads out of a chunk of SSE text. */
function parseFrames(text: string): any[] {
  const out: any[] = []
  for (const frame of text.split('\n\n')) {
    const data = frame
      .split('\n')
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice('data:'.length).trim())
      .join('')
    if (!data.startsWith('{')) continue
    try {
      out.push(JSON.parse(data))
    } catch {
      // Partial frame — the caller will see it again once more bytes arrive.
    }
  }
  return out
}

/** Unwraps a tools/call result into its text content. */
function unwrap(result: any, tool: string): string {
  const text = result?.content?.[0]?.text
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error(`Empty content from tool ${tool}`)
  }
  if (result?.isError) throw new Error(`Tool ${tool} error: ${text}`)
  return text
}

/** Instantly intermittently answers initialize without a session id; retrying fixes it. */
const INIT_ATTEMPTS = 4

/** A hung tool call fails (and is retried) instead of eating the route's time budget. */
const HTTP_TIMEOUT_MS = 20_000

/**
 * Streamable HTTP. `stateful` servers (Instantly) must hand back an
 * `mcp-session-id`; stateless ones (HeyReach) never do, and accept bare calls.
 */
async function openHttpSession(url: string, stateful: boolean): Promise<McpSession> {
  let sessionId: string | null = null

  for (let attempt = 0; attempt < INIT_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: SSE_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      }),
    })
    await res.text()
    if (!res.ok) throw new Error(`MCP initialize failed (${res.status})`)
    sessionId = res.headers.get('mcp-session-id')
    if (sessionId || !stateful) break
  }
  if (stateful && !sessionId) throw new Error('MCP server did not return a session ID')

  let nextId = 2
  const headers = sessionId ? { ...SSE_HEADERS, 'mcp-session-id': sessionId } : SSE_HEADERS

  return {
    async call(tool, args = {}) {
      const id = nextId++
      const toolRes = await fetch(url, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name: tool, arguments: args },
        }),
      })

      const body = await toolRes.text()
      // Responses arrive as one SSE frame, or as plain JSON from stateless servers.
      const [frame] = parseFrames(body).concat(body.trim().startsWith('{') ? [JSON.parse(body)] : [])
      if (!frame) throw new Error(`No data from tool ${tool}`)
      if (frame.error) throw new Error(`MCP error on ${tool}: ${frame.error.message}`)
      return unwrap(frame.result, tool)
    },
    close() {},
  }
}

const SSE_TIMEOUT_MS = 45_000

async function openSseSession(url: string): Promise<McpSession> {
  const controller = new AbortController()
  const res = await fetch(url, { headers: { Accept: 'text/event-stream' }, signal: controller.signal })
  if (!res.ok || !res.body) {
    controller.abort()
    throw new Error(`MCP SSE connect failed (${res.status})`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

  let buffer = ''
  let consumed = 0
  let endpointResolve: (v: string) => void = () => {}
  const endpointReady = new Promise<string>(r => (endpointResolve = r))

  // Single reader loop: resolves the endpoint event, then dispatches replies by id.
  ;(async () => {
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const endpointMatch = buffer.match(/event:\s*endpoint\s*\ndata:\s*(.+)/)
        if (endpointMatch) endpointResolve(endpointMatch[1].trim())

        // Only dispatch frames we have not already handled.
        const fresh = buffer.slice(consumed)
        const boundary = fresh.lastIndexOf('\n\n')
        if (boundary === -1) continue
        for (const frame of parseFrames(fresh.slice(0, boundary))) {
          const waiter = typeof frame.id === 'number' ? pending.get(frame.id) : undefined
          if (!waiter) continue
          pending.delete(frame.id)
          if (frame.error) waiter.reject(new Error(frame.error.message))
          else waiter.resolve(frame.result)
        }
        consumed += boundary + 2
      }
    } catch {
      // Stream closed or aborted — any still-pending calls time out below.
    } finally {
      for (const waiter of pending.values()) waiter.reject(new Error('MCP stream closed'))
      pending.clear()
    }
  })()

  const endpoint = await endpointReady
  const postUrl = endpoint.startsWith('http') ? endpoint : new URL(url).origin + endpoint

  const post = (body: unknown) =>
    fetch(postUrl, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) })

  await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
  })
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' })

  let nextId = 2

  return {
    async call(tool, args = {}) {
      const id = nextId++
      const reply = new Promise<any>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error(`Timed out waiting for tool ${tool}`))
        }, SSE_TIMEOUT_MS)
      })

      await post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } })
      return unwrap(await reply, tool)
    },
    close() {
      controller.abort()
    },
  }
}

/**
 * Rate limits and blips that are worth another try. HeyReach reports its 429s
 * inside a 200 response as a tool error ("…status code 429 (TooManyRequests)").
 */
const TRANSIENT = /429|too ?many ?requests|rate.?limit|timed? ?out|timeout|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|50[234]|No data from tool|Empty content/i

const RETRY_DELAYS_MS = [700, 1600, 3500]

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Retries transient failures with backoff plus jitter, so parallel retries don't re-collide. */
function withRetry(session: McpSession): McpSession {
  return {
    async call(tool, args) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await session.call(tool, args)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (attempt >= RETRY_DELAYS_MS.length || !TRANSIENT.test(message)) throw err
          await sleep(RETRY_DELAYS_MS[attempt] + Math.random() * 400)
        }
      }
    },
    close: () => session.close(),
  }
}

export async function openMcpSession(url: string, transport: Transport): Promise<McpSession> {
  const session = transport === 'sse' ? await openSseSession(url) : await openHttpSession(url, transport === 'http')
  return withRetry(session)
}

/**
 * Some servers wrap their JSON in prose ("Found 9 campaigns: [...]").
 * Falls back to the first JSON value in the string.
 */
export function parseToolJson<T>(text: string, tool: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    const start = text.search(/[[{]/)
    const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'))
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T
      } catch {
        /* fall through */
      }
    }
    throw new Error(`Could not parse JSON from tool ${tool}`)
  }
}

/** Smartlead returns counts as strings; Instantly returns numbers. */
export function num(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  WARMUP_THRESHOLD,
  averageWarmupScore,
  countLowWarmup,
  replyRate,
  sortByNewest,
  topCampaign,
} from '@/lib/metrics'
import type {
  CampaignAnalytics,
  DashboardData,
  EmailAccount,
  Session,
} from '@/lib/types'

const SYNC_SECONDS = 30

export default function Home() {
  const [session, setSession] = useState<Session | null>(null)
  const [selectedClient, setSelectedClient] = useState('')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(SYNC_SECONDS)
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  const [authUser, setAuthUser] = useState('')
  const [authPass, setAuthPass] = useState('')
  const [authError, setAuthError] = useState('')

  async function handleLogin() {
    setAuthError('')
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: authUser, password: authPass }),
    })
    if (!res.ok) {
      setAuthError('Invalid credentials. Please try again.')
      return
    }
    const auth = await res.json()
    setSession({ ...auth, password: authPass })
    if (auth.role === 'user') setSelectedClient(auth.clientId)
  }

  function logout() {
    clearInterval(intervalRef.current)
    setSession(null)
    setData(null)
    setSelectedClient('')
    setCountdown(SYNC_SECONDS)
  }

  const syncData = useCallback(async (clientId: string, sess: Session) => {
    if (!clientId) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          role: sess.role,
          username: sess.username,
          password: sess.password,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Sync failed')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!session || !selectedClient) return

    syncData(selectedClient, session)
    setCountdown(SYNC_SECONDS)

    intervalRef.current = setInterval(() => {
      setCountdown(c => {
        if (c > 1) return c - 1
        syncData(selectedClient, session)
        return SYNC_SECONDS
      })
    }, 1000)

    return () => clearInterval(intervalRef.current)
  }, [selectedClient, session, syncData])

  if (!session) {
    return (
      <LoginScreen
        user={authUser}
        setUser={setAuthUser}
        pass={authPass}
        setPass={setAuthPass}
        error={authError}
        onLogin={handleLogin}
      />
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--pearl)' }}>
      <nav
        className="h-14 flex items-center gap-4 px-6 sticky top-0 z-50 border-b"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
        <div className="flex items-center gap-2.5 mr-1">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--orange)' }}>
            <ZIcon size={14} />
          </div>
          <span className="font-extrabold text-[15px] tracking-tight" style={{ color: 'var(--ink)' }}>
            Zutomate
          </span>
        </div>

        <div className="w-px h-4 mx-1" style={{ background: 'var(--line-strong)' }} />

        <span
          className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold"
          style={
            session.role === 'admin'
              ? { background: 'var(--orange-wash)', color: 'var(--orange-ink)' }
              : { background: 'var(--blue-wash)', color: 'var(--blue-ink)' }
          }>
          {session.role === 'admin' ? 'Admin' : 'Client'}
        </span>

        {session.role === 'admin' && (
          <select
            value={selectedClient}
            onChange={e => {
              setSelectedClient(e.target.value)
              setData(null)
            }}
            className="text-[13px] px-3 py-1.5 rounded-lg outline-none border ml-1"
            style={{
              background: 'var(--surface-sunken)',
              borderColor: 'var(--line-strong)',
              color: 'var(--ink)',
            }}>
            <option value="">— Select client —</option>
            {session.clients.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-3">
          {selectedClient && (
            <>
              <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                Live ·{' '}
                <span className="font-mono" style={{ color: 'var(--orange-ink)' }}>
                  {countdown}s
                </span>
              </span>
              <button
                onClick={() => syncData(selectedClient, session)}
                className="text-[12px] px-3 py-1.5 rounded-lg border transition-colors hover:border-brand"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-soft)' }}>
                ↻ Refresh
              </button>
            </>
          )}
          <button
            onClick={logout}
            className="text-[12px] px-3 py-1.5 rounded-lg border"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-soft)' }}>
            Sign out
          </button>
        </div>
      </nav>

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-6">
        {!selectedClient ? (
          <div
            className="flex flex-col items-center justify-center py-36 gap-4"
            style={{ color: 'var(--ink-muted)' }}>
            <ZIcon size={32} color="var(--line-strong)" />
            <div className="text-[15px]">Select a client workspace from the dropdown above</div>
          </div>
        ) : error ? (
          <ErrorState message={error} />
        ) : data ? (
          <Workspace data={data} loading={loading} />
        ) : (
          <LoadingState />
        )}
      </main>

      {data && <AIAssistant data={data} />}
    </div>
  )
}

function ZIcon({ size = 18, color = 'white' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path
        d="M4 4h10L4 14h10"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface LoginScreenProps {
  user: string
  setUser: (v: string) => void
  pass: string
  setPass: (v: string) => void
  error: string
  onLogin: () => void
}

const FEATURES = [
  'Live campaign tracking',
  'Email warmup monitoring',
  'AI-powered insights',
  'Multi-client workspace',
]

function LoginScreen({ user, setUser, pass, setPass, error, onLogin }: LoginScreenProps) {
  return (
    <div className="min-h-screen flex" style={{ background: 'var(--pearl)' }}>
      <div
        className="hidden lg:flex flex-col items-center justify-center w-[42%] relative overflow-hidden"
        style={{ background: 'var(--surface)', borderRight: '1px solid var(--line)' }}>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(ellipse at 30% 35%, rgba(249,115,22,0.14) 0%, transparent 62%)',
          }}
        />
        <div className="relative z-10 flex flex-col items-center gap-10 px-14 text-center">
          <div
            className="w-20 h-20 rounded-3xl flex items-center justify-center"
            style={{ background: 'var(--orange)' }}>
            <ZIcon size={40} />
          </div>
          <div>
            <div
              className="text-[34px] font-extrabold tracking-tight mb-3"
              style={{ color: 'var(--ink)' }}>
              Zutomate
            </div>
            <div
              className="text-[14px] leading-relaxed max-w-[260px]"
              style={{ color: 'var(--ink-soft)' }}>
              Your outbound command center.
              <br />
              Real-time insights, zero guesswork.
            </div>
          </div>
          <div className="flex flex-col gap-3 text-left w-full max-w-[260px]">
            {FEATURES.map(f => (
              <div
                key={f}
                className="flex items-center gap-3 text-[13px]"
                style={{ color: 'var(--ink-soft)' }}>
                <div
                  className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--orange-wash)' }}>
                  <span style={{ color: 'var(--orange-ink)', fontSize: 9 }}>✓</span>
                </div>
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-8">
        <div className="w-full max-w-[380px]">
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--orange)' }}>
              <ZIcon size={18} />
            </div>
            <span className="text-[22px] font-extrabold" style={{ color: 'var(--ink)' }}>
              Zutomate
            </span>
          </div>

          <div className="mb-8">
            <h1
              className="text-[28px] font-extrabold tracking-tight mb-1.5"
              style={{ color: 'var(--ink)' }}>
              Welcome back
            </h1>
            <p className="text-[14px]" style={{ color: 'var(--ink-soft)' }}>
              Sign in to your dashboard
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <Field label="Username">
              <LoginInput
                value={user}
                onChange={setUser}
                onEnter={onLogin}
                placeholder="Enter your username"
              />
            </Field>

            <Field label="Password">
              <LoginInput
                value={pass}
                onChange={setPass}
                onEnter={onLogin}
                placeholder="••••••••"
                type="password"
              />
            </Field>

            {error && (
              <div
                className="px-4 py-3 rounded-xl text-[13px]"
                style={{
                  background: 'var(--orange-wash)',
                  border: '1px solid rgba(249,115,22,0.25)',
                  color: 'var(--orange-ink)',
                }}>
                {error}
              </div>
            )}

            <button
              onClick={onLogin}
              className="w-full py-3.5 rounded-xl text-[14px] font-bold text-white transition-opacity hover:opacity-90 mt-1"
              style={{ background: 'var(--orange-ink)' }}>
              Sign in →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        className="block text-[11px] font-bold mb-2 uppercase tracking-widest"
        style={{ color: 'var(--ink-muted)' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function LoginInput({
  value,
  onChange,
  onEnter,
  placeholder,
  type = 'text',
}: {
  value: string
  onChange: (v: string) => void
  onEnter: () => void
  placeholder: string
  type?: string
}) {
  return (
    <input
      value={value}
      type={type}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => e.key === 'Enter' && onEnter()}
      className="w-full px-4 py-3 rounded-xl text-[14px] outline-none border transition-all"
      style={{ background: 'var(--surface)', borderColor: 'var(--line-strong)', color: 'var(--ink)' }}
      onFocus={e => (e.target.style.borderColor = 'var(--orange)')}
      onBlur={e => (e.target.style.borderColor = 'var(--line-strong)')}
    />
  )
}

const CARD_STYLE = {
  background: 'var(--surface)',
  borderColor: 'var(--line)',
  boxShadow: 'var(--shadow-card)',
}

function Workspace({ data, loading }: { data: DashboardData; loading: boolean }) {
  const rate = replyRate(data.totalSent, data.totalReplies)
  const avgWarmup = averageWarmupScore(data.accounts)

  const stats: { label: string; value: string; unit?: string; sub: string; color: string }[] = [
    {
      label: 'Emails Sent',
      value: data.totalSent.toLocaleString(),
      sub: `${data.activeCampaigns} active campaign${data.activeCampaigns !== 1 ? 's' : ''}`,
      color: 'var(--orange-ink)',
    },
    {
      label: 'Reply Rate',
      value: `${rate.toFixed(1)}%`,
      sub: `${data.totalReplies} total replies`,
      color: 'var(--blue-ink)',
    },
    {
      label: 'Total Replies',
      value: data.totalReplies.toLocaleString(),
      sub: 'Across all campaigns',
      color: 'var(--blue-ink)',
    },
    {
      label: 'Unread Emails',
      value: String(data.unread_count),
      sub: 'Awaiting reply',
      color: 'var(--orange-ink)',
    },
    {
      label: 'Avg Warmup',
      value: String(avgWarmup),
      unit: '/100',
      sub: `${data.accounts.length} account${data.accounts.length !== 1 ? 's' : ''}`,
      color: 'var(--blue-ink)',
    },
  ]

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-[22px] font-extrabold tracking-tight" style={{ color: 'var(--ink)' }}>
          {data.clientName} Workspace
        </h1>
        <p className="text-[12px] mt-1" style={{ color: 'var(--ink-muted)' }}>
          {loading ? 'Syncing…' : `Last synced ${new Date(data.syncedAt).toLocaleTimeString()}`}
        </p>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-5">
        {stats.map(s => (
          <div key={s.label} className="rounded-xl p-5 border" style={CARD_STYLE}>
            <div
              className="text-[10px] uppercase tracking-widest font-bold mb-3"
              style={{ color: 'var(--ink-muted)' }}>
              {s.label}
            </div>
            <div className="text-[28px] font-extrabold font-mono leading-none" style={{ color: s.color }}>
              {s.value}
              {s.unit && (
                <span className="text-[13px] font-normal" style={{ color: 'var(--ink-muted)' }}>
                  {s.unit}
                </span>
              )}
            </div>
            <div className="text-[11px] mt-1.5" style={{ color: 'var(--ink-muted)' }}>
              {s.sub}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-4 mb-4">
        <div className="col-span-3 rounded-xl p-5 border" style={CARD_STYLE}>
          <SectionTitle>Campaign Performance</SectionTitle>
          <CampaignBarChart data={data} />
        </div>

        <div className="col-span-2 rounded-xl p-5 border" style={CARD_STYLE}>
          <SectionTitle>Email Accounts</SectionTitle>
          <WarmupList accounts={data.accounts} />
        </div>
      </div>

      <div className="rounded-xl p-5 border mb-24" style={CARD_STYLE}>
        <SectionTitle>Analytics Breakdown</SectionTitle>
        <AnalyticsTable data={data} />
      </div>
    </div>
  )
}

function CampaignBarChart({ data }: { data: DashboardData }) {
  if (data.analytics.length === 0) return <Empty>No campaign data</Empty>

  const items = sortByNewest(data.analytics, data.campaigns).slice(0, 8)
  const maxSent = Math.max(...items.map(a => a.emails_sent_count ?? 0), 1)

  return (
    <div className="flex flex-col gap-4">
      {items.map((item, i) => {
        const sent = item.emails_sent_count ?? 0
        const replies = item.reply_count ?? 0
        const rate = replyRate(sent, replies)

        return (
          <div key={item.campaign_id || i}>
            <div className="flex items-center justify-between mb-1.5">
              <div
                className="text-[12px] font-medium truncate max-w-[55%]"
                style={{ color: 'var(--ink)' }}>
                {item.campaign_name || 'Unknown'}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                <span className="text-[11px] font-mono" style={{ color: 'var(--ink-muted)' }}>
                  {sent.toLocaleString()}
                </span>
                <span
                  className="text-[11px] font-mono font-bold w-12 text-right"
                  style={{ color: rate > 0 ? 'var(--blue-ink)' : 'var(--ink-muted)' }}>
                  {rate.toFixed(1)}%
                </span>
              </div>
            </div>
            <div
              className="relative h-2 rounded-full overflow-hidden"
              style={{ background: 'var(--surface-sunken)' }}>
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${(sent / maxSent) * 100}%`, background: 'var(--orange-wash)' }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${(replies / maxSent) * 100}%`, background: 'var(--blue-ink)' }}
              />
            </div>
          </div>
        )
      })}

      <div className="flex items-center gap-5 mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-1.5 rounded-sm" style={{ background: 'var(--orange-wash)' }} />
          Sent
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-1.5 rounded-sm" style={{ background: 'var(--blue-ink)' }} />
          Replies
        </div>
      </div>
    </div>
  )
}

function AccountRow({ account }: { account: EmailAccount }) {
  const score = account.stat_warmup_score ?? 0
  const warn = score < WARMUP_THRESHOLD
  const color = warn ? 'var(--orange-ink)' : 'var(--blue-ink)'

  return (
    <div
      className="flex items-center justify-between py-2.5 border-b last:border-0"
      style={{ borderColor: 'var(--line)' }}>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-mono truncate" style={{ color: 'var(--ink-soft)' }}>
          {account.email}
        </div>
        <div className="text-[10px] mt-0.5 font-medium" style={{ color }}>
          {warn ? 'Below threshold' : 'Healthy'}
        </div>
      </div>
      <div className="flex items-center gap-2.5 flex-shrink-0 ml-3">
        <div
          className="w-14 h-1.5 rounded-full overflow-hidden"
          style={{ background: 'var(--surface-sunken)' }}>
          <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
        </div>
        <div className="text-[12px] font-mono font-bold w-7 text-right" style={{ color }}>
          {score}
        </div>
      </div>
    </div>
  )
}

const VISIBLE_ACCOUNTS = 9

function WarmupList({ accounts }: { accounts: EmailAccount[] }) {
  const [expanded, setExpanded] = useState(false)
  if (accounts.length === 0) return <Empty>No accounts found</Empty>

  const extra = accounts.slice(VISIBLE_ACCOUNTS)

  return (
    <div className="flex flex-col">
      {accounts.slice(0, VISIBLE_ACCOUNTS).map(a => (
        <AccountRow key={a.email} account={a} />
      ))}

      <div
        style={{
          maxHeight: expanded ? `${Math.min(extra.length * 52, 800)}px` : '0px',
          overflow: 'hidden',
          transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)',
        }}>
        {extra.map(a => (
          <AccountRow key={a.email} account={a} />
        ))}
      </div>

      {extra.length > 0 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-[11px] pt-3 text-left transition-opacity hover:opacity-70"
          style={{ color: expanded ? 'var(--ink-muted)' : 'var(--orange-ink)' }}>
          {expanded ? '↑ Show less' : `+${extra.length} more accounts`}
        </button>
      )}
    </div>
  )
}

const TABLE_HEADERS = ['Campaign', 'Leads', 'Sent', 'Replies', 'Reply %', 'Pipeline']

function AnalyticsTable({ data }: { data: DashboardData }) {
  if (data.analytics.length === 0) return <Empty>No analytics data</Empty>

  const rows = sortByNewest(data.analytics, data.campaigns)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b" style={{ borderColor: 'var(--line-strong)' }}>
            {TABLE_HEADERS.map(h => (
              <th
                key={h}
                className={`py-2.5 px-3 font-bold uppercase tracking-wider text-[10px] ${
                  h === 'Campaign' ? 'text-left' : 'text-right'
                }`}
                style={{ color: 'var(--orange-ink)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a, i) => {
            const rate = replyRate(a.emails_sent_count ?? 0, a.reply_count ?? 0)
            const pipeline = a.total_opportunity_value ?? 0

            return (
              <tr
                key={a.campaign_id || i}
                className="border-b hover:bg-black/[0.02] transition-colors"
                style={{ borderColor: 'var(--line)' }}>
                <td className="py-3 px-3 max-w-[200px]">
                  <div className="truncate font-medium" style={{ color: 'var(--ink)' }}>
                    {a.campaign_name}
                  </div>
                </td>
                <Cell>{(a.leads_count ?? 0).toLocaleString()}</Cell>
                <Cell>{(a.emails_sent_count ?? 0).toLocaleString()}</Cell>
                <Cell>{a.reply_count ?? 0}</Cell>
                <td
                  className="py-3 px-3 text-right font-mono font-semibold"
                  style={{ color: rate > 0 ? 'var(--blue-ink)' : 'var(--ink-muted)' }}>
                  {rate.toFixed(1)}%
                </td>
                <td
                  className="py-3 px-3 text-right font-mono font-semibold"
                  style={{ color: pipeline > 0 ? 'var(--green-ink)' : 'var(--ink-muted)' }}>
                  {pipeline > 0 ? `$${pipeline.toLocaleString()}` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <td className="py-3 px-3 text-right font-mono" style={{ color: 'var(--ink-soft)' }}>
      {children}
    </td>
  )
}

function buildInsights(data: DashboardData): { label: string; value: string; sub: string }[] {
  const rate = replyRate(data.totalSent, data.totalReplies)
  const lowWarmup = countLowWarmup(data.accounts)
  const best = topCampaign(data.analytics)

  const rateAdvice =
    rate > 5 ? 'Strong performance' : rate > 2 ? 'Test your subject lines' : 'Review messaging & targeting'

  return [
    { label: 'Reply Rate', value: `${rate.toFixed(1)}%`, sub: rateAdvice },
    ...(best
      ? [
          {
            label: 'Top Campaign',
            value: `${replyRate(best.emails_sent_count ?? 0, best.reply_count ?? 0).toFixed(1)}%`,
            sub: best.campaign_name,
          },
        ]
      : []),
    {
      label: 'Warmup Health',
      value: `${averageWarmupScore(data.accounts)}/100`,
      sub:
        lowWarmup > 0
          ? `${lowWarmup} account${lowWarmup !== 1 ? 's' : ''} below threshold`
          : 'All accounts healthy',
    },
    {
      label: 'Inbox',
      value: String(data.unread_count),
      sub: data.unread_count > 0 ? 'Unread — reply promptly' : 'Clear',
    },
    {
      label: 'Active Campaigns',
      value: String(data.activeCampaigns),
      sub: `${data.accounts.length} sending accounts`,
    },
  ]
}

function AIAssistant({ data }: { data: DashboardData }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div
          className="w-[320px] rounded-xl overflow-hidden animate-slide-up border"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--line)',
            boxShadow: 'var(--shadow-pop)',
          }}>
          <div
            className="flex items-center justify-between px-5 py-3.5 border-b"
            style={{ borderColor: 'var(--line)', background: 'var(--surface-sunken)' }}>
            <div>
              <div className="text-[13px] font-bold" style={{ color: 'var(--ink)' }}>
                Zutomate AI
              </div>
              <div className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                Live insights
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-[18px] leading-none transition-opacity hover:opacity-60"
              style={{ color: 'var(--ink-muted)' }}>
              ×
            </button>
          </div>

          <div className="px-4 py-3 flex flex-col gap-2">
            {buildInsights(data).map(item => (
              <div
                key={item.label}
                className="flex items-center justify-between py-2.5 border-b last:border-0"
                style={{ borderColor: 'var(--line)' }}>
                <div>
                  <div
                    className="text-[10px] uppercase tracking-widest font-bold mb-0.5"
                    style={{ color: 'var(--ink-muted)' }}>
                    {item.label}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                    {item.sub}
                  </div>
                </div>
                <div
                  className="text-[16px] font-extrabold font-mono"
                  style={{ color: 'var(--orange-ink)' }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          <div
            className="px-5 py-2.5 border-t text-[10px] text-center"
            style={{ borderColor: 'var(--line)', color: 'var(--ink-muted)' }}>
            Synced {new Date(data.syncedAt).toLocaleTimeString()}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        className="w-12 h-12 rounded-xl flex items-center justify-center text-[18px] transition-all hover:scale-105 active:scale-95 font-bold text-white"
        style={{ background: 'var(--orange-ink)', boxShadow: '0 4px 20px rgba(179,74,8,0.3)' }}>
        {open ? '×' : 'AI'}
      </button>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span
        className="text-[10px] uppercase tracking-widest font-extrabold"
        style={{ color: 'var(--orange-ink)' }}>
        {children}
      </span>
      <div className="flex-1 h-px" style={{ background: 'var(--line)' }} />
    </div>
  )
}

function LoadingState() {
  return (
    <div
      className="flex flex-col items-center justify-center py-36 gap-4"
      style={{ color: 'var(--ink-muted)' }}>
      <div
        className="w-6 h-6 rounded-full border-2 animate-spin-slow"
        style={{ borderColor: 'var(--line-strong)', borderTopColor: 'var(--orange)' }}
      />
      <div className="text-[13px]">Syncing…</div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-36 gap-2">
      <div className="text-[14px] font-semibold" style={{ color: 'var(--orange-ink)' }}>
        Sync failed
      </div>
      <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        {message}
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-8 text-center text-[12px]" style={{ color: 'var(--ink-muted)' }}>
      {children}
    </div>
  )
}

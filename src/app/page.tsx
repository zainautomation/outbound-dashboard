'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  WARMUP_THRESHOLD,
  averageWarmupScore,
  bounceRate,
  replyRate,
  sortByNewest,
} from '@/lib/metrics'
import type {
  AttributedCampaign,
  ClientRollup,
  DashboardData,
  EmailAccount,
  OverviewData,
  ProviderId,
  Session,
} from '@/lib/types'

const SYNC_SECONDS = 30

/** Sentinel for the admin's cross-client view. */
const ALL_CLIENTS = ''

export default function Home() {
  const [session, setSession] = useState<Session | null>(null)
  const [selectedClient, setSelectedClient] = useState(ALL_CLIENTS)
  const [data, setData] = useState<DashboardData | null>(null)
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [error, setError] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  const [authUser, setAuthUser] = useState('')
  const [authPass, setAuthPass] = useState('')
  const [authError, setAuthError] = useState('')

  const isOverview = session?.role === 'admin' && selectedClient === ALL_CLIENTS

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
    setSelectedClient(auth.role === 'user' ? auth.clientId : ALL_CLIENTS)
  }

  function logout() {
    clearInterval(intervalRef.current)
    setSession(null)
    setData(null)
    setOverview(null)
    setSelectedClient(ALL_CLIENTS)
  }

  const sync = useCallback(async (clientId: string, sess: Session) => {
    const wantsOverview = sess.role === 'admin' && clientId === ALL_CLIENTS
    setError('')
    try {
      const body = { role: sess.role, username: sess.username, password: sess.password }
      const res = await fetch(wantsOverview ? '/api/overview' : '/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wantsOverview ? body : { ...body, clientId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Sync failed')
      if (wantsOverview) setOverview(json)
      else setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    }
  }, [])

  useEffect(() => {
    if (!session) return
    // A client user has no workspace until their id resolves.
    if (session.role === 'user' && !selectedClient) return

    sync(selectedClient, session)

    // Auto-refresh in the background — no visible countdown.
    intervalRef.current = setInterval(() => {
      sync(selectedClient, session)
    }, SYNC_SECONDS * 1000)

    return () => clearInterval(intervalRef.current)
  }, [selectedClient, session, sync])

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
        <BrandMark />

        <div className="w-px h-4 mx-1" style={{ background: 'var(--line-strong)' }} />

        <RolePill role={session.role} />

        {session.role === 'admin' && (
          <select
            value={selectedClient}
            onChange={e => {
              setSelectedClient(e.target.value)
              setData(null)
              setError('')
            }}
            className="text-[13px] px-3 py-1.5 rounded-lg outline-none border ml-1"
            style={{
              background: 'var(--surface-sunken)',
              borderColor: 'var(--line-strong)',
              color: 'var(--ink)',
            }}>
            <option value={ALL_CLIENTS}>All clients</option>
            {session.clients.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => sync(selectedClient, session)}
            className="text-[12px] px-3 py-1.5 rounded-lg border transition-colors hover:border-brand"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-soft)' }}>
            ↻ Refresh
          </button>
          <button
            onClick={logout}
            className="text-[12px] px-3 py-1.5 rounded-lg border transition-colors hover:border-brand"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-soft)' }}>
            Sign out
          </button>
        </div>
      </nav>

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-6">
        {error && !(isOverview ? overview : data) ? (
          <ErrorState message={error} />
        ) : isOverview && overview ? (
          <AdminOverview overview={overview} />
        ) : !isOverview && data ? (
          <Workspace data={data} />
        ) : (
          <LoadingState />
        )}
      </main>
    </div>
  )
}

/* ── Brand ───────────────────────────────────────────────────────────────── */

/** The Zutomate mark — a deep-navy tile with a clean monogram Z. */
function LogoTile({ size = 28, radius = 9 }: { size?: number; radius?: number }) {
  return (
    <div
      className="flex items-center justify-center flex-shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: 'linear-gradient(145deg, var(--brand-hover), var(--brand-deep))',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 2px 6px rgba(14,28,52,0.28)',
      }}>
      <ZIcon size={size * 0.5} />
    </div>
  )
}

function ZIcon({ size = 14, color = '#ffffff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M6.5 6h11L7 18h11"
        stroke={color}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5 mr-1">
      <LogoTile size={28} radius={9} />
      <span className="font-bold text-[15px] tracking-tight" style={{ color: 'var(--ink)' }}>
        Zutomate
      </span>
    </div>
  )
}

function RolePill({ role }: { role: 'admin' | 'user' }) {
  const admin = role === 'admin'
  return (
    <span
      className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold"
      style={
        admin
          ? { background: 'var(--brand)', color: '#fff' }
          : { background: 'var(--surface-sunken)', color: 'var(--ink-soft)' }
      }>
      {admin ? 'Admin' : 'Client'}
    </span>
  )
}

function DollarSign({ size = 12, color = 'white' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <line x1="12" y1="1.5" x2="12" y2="22.5" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <path
        d="M17 6.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Green coin badge used to mark positive-reply (opportunity) figures. */
function DollarBadge({ size = 18 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full flex-shrink-0"
      style={{ width: size, height: size, background: 'var(--green-ink)' }}>
      <DollarSign size={size * 0.58} color="white" />
    </span>
  )
}

/* ── Login ───────────────────────────────────────────────────────────────── */

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
  'Positive-reply pipeline',
  'Multi-client workspace',
]

function LoginScreen({ user, setUser, pass, setPass, error, onLogin }: LoginScreenProps) {
  return (
    <div className="min-h-screen flex" style={{ background: 'var(--pearl)' }}>
      {/* Deep-navy brand panel */}
      <div
        className="hidden lg:flex flex-col justify-between w-[44%] relative overflow-hidden px-14 py-14"
        style={{ background: 'var(--brand-deep)' }}>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(ellipse at 22% 18%, rgba(255,255,255,0.06) 0%, transparent 55%), radial-gradient(ellipse at 85% 90%, rgba(249,115,22,0.12) 0%, transparent 50%)',
          }}
        />
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <LogoTile size={40} radius={12} />
            <span className="text-[20px] font-bold tracking-tight text-white">Zutomate</span>
          </div>
        </div>

        <div className="relative z-10">
          <div className="text-[30px] leading-tight font-bold text-white mb-3">
            Your outbound
            <br />
            command center.
          </div>
          <div className="text-[14px] leading-relaxed max-w-[300px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Every campaign, warmup score and positive reply across all your clients — in one live view.
          </div>
        </div>

        <div className="relative z-10 flex flex-col gap-3 max-w-[280px]">
          {FEATURES.map(f => (
            <div key={f} className="flex items-center gap-3 text-[13px]" style={{ color: 'rgba(255,255,255,0.82)' }}>
              <span
                className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(249,115,22,0.18)' }}>
                <span style={{ color: 'var(--orange)', fontSize: 9 }}>✓</span>
              </span>
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="w-full max-w-[380px]">
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <LogoTile size={36} radius={11} />
            <span className="text-[22px] font-bold" style={{ color: 'var(--ink)' }}>
              Zutomate
            </span>
          </div>

          <div className="mb-8">
            <h1 className="text-[28px] font-bold tracking-tight mb-1.5" style={{ color: 'var(--ink)' }}>
              Welcome back
            </h1>
            <p className="text-[14px]" style={{ color: 'var(--ink-soft)' }}>
              Sign in to your dashboard
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <Field label="Username">
              <LoginInput value={user} onChange={setUser} onEnter={onLogin} placeholder="Enter your username" />
            </Field>

            <Field label="Password">
              <LoginInput
                value={pass}
                onChange={setPass}
                onEnter={onLogin}
                placeholder="Enter your password"
                type="password"
              />
            </Field>

            {error && (
              <div
                className="px-4 py-3 rounded-xl text-[13px]"
                style={{ background: 'var(--red-wash)', border: '1px solid rgba(180,35,24,0.2)', color: 'var(--red-ink)' }}>
                {error}
              </div>
            )}

            <button
              onClick={onLogin}
              className="w-full py-3.5 rounded-xl text-[14px] font-bold text-white transition-colors mt-1"
              style={{ background: 'var(--brand)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--brand-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--brand)')}>
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
  const [visible, setVisible] = useState(false)
  const isPassword = type === 'password'
  const inputType = isPassword ? (visible ? 'text' : 'password') : type

  return (
    <div className="relative">
      <input
        value={value}
        type={inputType}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onEnter()}
        className={`w-full px-4 py-3 rounded-xl text-[14px] outline-none border transition-all ${
          isPassword ? 'pr-11' : ''
        }`}
        style={{ background: 'var(--surface)', borderColor: 'var(--line-strong)', color: 'var(--ink)' }}
        onFocus={e => (e.target.style.borderColor = 'var(--brand)')}
        onBlur={e => (e.target.style.borderColor = 'var(--line-strong)')}
      />
      {isPassword && (
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 transition-opacity hover:opacity-70"
          style={{ color: 'var(--ink-muted)' }}
          aria-label={visible ? 'Hide password' : 'Show password'}>
          <EyeIcon off={!visible} />
        </button>
      )}
    </div>
  )
}

function EyeIcon({ off = false, size = 17 }: { off?: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  )
}

/* ── Shared building blocks ──────────────────────────────────────────────── */

const CARD_STYLE = {
  background: 'var(--surface)',
  borderColor: 'var(--line)',
  boxShadow: 'var(--shadow-card)',
}

const PROVIDER_LABEL: Record<ProviderId, string> = {
  instantly: 'Instantly',
  smartlead: 'Smartlead',
}

function ProviderBadge({ provider }: { provider: ProviderId }) {
  return (
    <span
      className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded"
      style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}>
      {PROVIDER_LABEL[provider]}
    </span>
  )
}

interface Stat {
  label: string
  value: string
  unit?: string
  sub: string
  color: string
  /** Shows the green dollar badge — used for positive replies (opportunities). */
  badge?: boolean
}

function StatCards({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
      {stats.map(s => (
        <div key={s.label} className="rounded-xl p-5 border" style={CARD_STYLE}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'var(--ink-muted)' }}>
              {s.label}
            </div>
            {s.badge && <DollarBadge size={16} />}
          </div>
          <div className="text-[26px] font-bold font-mono leading-none" style={{ color: s.color }}>
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
  )
}

function PageHeading({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
        {title}
      </h1>
      {right}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      {/* small orange tick — the one deliberate brand accent */}
      <span className="w-[3px] h-3.5 rounded-full flex-shrink-0" style={{ background: 'var(--orange)' }} />
      <span
        className="text-[10px] uppercase tracking-widest font-bold"
        style={{ color: 'var(--ink-soft)' }}>
        {children}
      </span>
      <div className="flex-1 h-px" style={{ background: 'var(--line)' }} />
    </div>
  )
}

/* ── Admin: every client, every campaign ─────────────────────────────────── */

function AdminOverview({ overview }: { overview: OverviewData }) {
  const rate = replyRate(overview.totalSent, overview.totalReplies)
  const bounce = bounceRate(overview.totalSent, overview.totalBounces)
  const failed = overview.clients.filter(c => c.error)

  const stats: Stat[] = [
    {
      label: 'Emails Sent',
      value: overview.totalSent.toLocaleString(),
      sub: `Across ${overview.clients.length} client${overview.clients.length !== 1 ? 's' : ''}`,
      color: 'var(--ink)',
    },
    {
      label: 'Reply Rate',
      value: `${rate.toFixed(1)}%`,
      sub: `${overview.totalReplies.toLocaleString()} total replies`,
      color: 'var(--ink)',
    },
    {
      label: 'Positive Replies',
      value: overview.totalPositiveReplies.toLocaleString(),
      sub: overview.totalPipeline > 0 ? `$${overview.totalPipeline.toLocaleString()} pipeline` : 'Interested leads',
      color: 'var(--green-ink)',
      badge: true,
    },
    {
      label: 'Bounce Rate',
      value: `${bounce.toFixed(1)}%`,
      sub: `${overview.totalBounces.toLocaleString()} bounced`,
      color: bounce > 5 ? 'var(--amber-ink)' : 'var(--ink)',
    },
    {
      label: 'Active Campaigns',
      value: String(overview.activeCampaigns),
      sub: `${overview.campaigns.length} total campaigns`,
      color: 'var(--ink)',
    },
    {
      label: 'Clients',
      value: String(overview.clients.length),
      sub: failed.length > 0 ? `${failed.length} failing to sync` : 'All syncing',
      color: failed.length > 0 ? 'var(--amber-ink)' : 'var(--green-ink)',
    },
  ]

  return (
    <div className="animate-fade-in">
      <PageHeading title="All Clients" />

      <StatCards stats={stats} />

      <div className="rounded-xl p-5 border mb-4" style={CARD_STYLE}>
        <SectionTitle>Client Breakdown</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          {overview.clients.map(c => (
            <ClientCard key={c.clientId} client={c} />
          ))}
        </div>
      </div>

      <div className="rounded-xl p-5 border mb-24" style={CARD_STYLE}>
        <SectionTitle>All Campaigns</SectionTitle>
        <AllCampaignsTable campaigns={overview.campaigns} />
      </div>
    </div>
  )
}

function ClientCard({ client }: { client: ClientRollup }) {
  const rate = replyRate(client.totalSent, client.totalReplies)

  return (
    <div className="rounded-lg p-4 border" style={{ borderColor: 'var(--line)', background: 'var(--pearl)' }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-[13px] font-bold truncate" style={{ color: 'var(--ink)' }}>
          {client.clientName}
        </div>
        <ProviderBadge provider={client.provider} />
      </div>

      {client.error ? (
        <div className="text-[11px] leading-snug" style={{ color: 'var(--red-ink)' }}>
          Sync failed — {client.error}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-y-2.5 gap-x-3">
          <Metric label="Sent" value={client.totalSent.toLocaleString()} />
          <Metric label="Reply rate" value={`${rate.toFixed(1)}%`} />
          <Metric label="Positive" value={client.totalPositiveReplies.toLocaleString()} accent="var(--green-ink)" badge />
          <Metric label="Bounce rate" value={`${bounceRate(client.totalSent, client.totalBounces).toFixed(1)}%`} />
          <Metric label="Active" value={String(client.activeCampaigns)} />
          <Metric label="Avg warmup" value={client.avgWarmup === undefined ? '—' : String(client.avgWarmup)} />
        </div>
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  accent,
  badge,
}: {
  label: string
  value: string
  accent?: string
  badge?: boolean
}) {
  return (
    <div>
      <div
        className="flex items-center gap-1 text-[9px] uppercase tracking-widest font-bold mb-0.5"
        style={{ color: 'var(--ink-muted)' }}>
        {label}
        {badge && <DollarBadge size={12} />}
      </div>
      <div className="text-[15px] font-mono font-bold" style={{ color: accent ?? 'var(--ink)' }}>
        {value}
      </div>
    </div>
  )
}

const ALL_CAMPAIGN_HEADERS = ['Client', 'Campaign', 'Status', 'Leads', 'Sent', 'Replies', 'Positive', 'Reply %']

function AllCampaignsTable({ campaigns }: { campaigns: AttributedCampaign[] }) {
  if (campaigns.length === 0) return <Empty>No campaigns across any client</Empty>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b" style={{ borderColor: 'var(--line-strong)' }}>
            {ALL_CAMPAIGN_HEADERS.map(h => (
              <th
                key={h}
                className={`py-2.5 px-3 font-bold uppercase tracking-wider text-[10px] ${
                  h === 'Client' || h === 'Campaign' ? 'text-left' : 'text-right'
                }`}
                style={{ color: 'var(--ink-soft)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {campaigns.map(c => (
            <tr
              key={`${c.clientId}:${c.campaignId}`}
              className="border-b hover:bg-black/[0.015] transition-colors"
              style={{ borderColor: 'var(--line)' }}>
              <td className="py-3 px-3 whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <span className="font-medium" style={{ color: 'var(--ink)' }}>
                    {c.clientName}
                  </span>
                  <ProviderBadge provider={c.provider} />
                </div>
              </td>
              <td className="py-3 px-3 max-w-[280px]">
                <div className="truncate" style={{ color: 'var(--ink-soft)' }}>
                  {c.campaignName}
                </div>
              </td>
              <td className="py-3 px-3 text-right">
                <StatusPill active={c.active} />
              </td>
              <Cell>{c.leads.toLocaleString()}</Cell>
              <Cell>{c.sent.toLocaleString()}</Cell>
              <Cell>{c.replies.toLocaleString()}</Cell>
              <td
                className="py-3 px-3 text-right font-mono font-semibold"
                style={{ color: c.positiveReplies > 0 ? 'var(--green-ink)' : 'var(--ink-muted)' }}>
                {c.positiveReplies.toLocaleString()}
              </td>
              <td className="py-3 px-3 text-right font-mono font-semibold" style={{ color: 'var(--ink)' }}>
                {replyRate(c.sent, c.replies).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
      style={
        active
          ? { background: 'var(--green-wash)', color: 'var(--green-ink)' }
          : { background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }
      }>
      {active ? 'Active' : 'Paused'}
    </span>
  )
}

/* ── Single client workspace ─────────────────────────────────────────────── */

function Workspace({ data }: { data: DashboardData }) {
  const rate = replyRate(data.totalSent, data.totalReplies)
  const bounce = bounceRate(data.totalSent, data.totalBounces)
  const avgWarmup = averageWarmupScore(data.accounts)

  const stats: Stat[] = [
    {
      label: 'Emails Sent',
      value: data.totalSent.toLocaleString(),
      sub: `${data.activeCampaigns} active campaign${data.activeCampaigns !== 1 ? 's' : ''}`,
      color: 'var(--ink)',
    },
    {
      label: 'Reply Rate',
      value: `${rate.toFixed(1)}%`,
      sub: `${data.totalReplies.toLocaleString()} total replies`,
      color: 'var(--ink)',
    },
    {
      label: 'Positive Replies',
      value: data.totalPositiveReplies.toLocaleString(),
      sub: data.totalPipeline > 0 ? `$${data.totalPipeline.toLocaleString()} pipeline` : 'Interested leads',
      color: 'var(--green-ink)',
      badge: true,
    },
    {
      label: 'Bounce Rate',
      value: `${bounce.toFixed(1)}%`,
      sub: `${data.totalBounces.toLocaleString()} bounced`,
      color: bounce > 5 ? 'var(--amber-ink)' : 'var(--ink)',
    },
    {
      label: 'Unread Emails',
      // Smartlead exposes no unread count.
      value: data.unreadCount === undefined ? '—' : String(data.unreadCount),
      sub: data.unreadCount === undefined ? 'Not reported' : 'Awaiting reply',
      color: 'var(--ink)',
    },
    {
      label: 'Avg Warmup',
      value: avgWarmup === undefined ? '—' : String(avgWarmup),
      unit: avgWarmup === undefined ? undefined : '/100',
      sub: `${data.accounts.length} account${data.accounts.length !== 1 ? 's' : ''}`,
      color: 'var(--ink)',
    },
  ]

  return (
    <div className="animate-fade-in">
      <PageHeading
        title={`${data.clientName} Workspace`}
        right={<ProviderBadge provider={data.provider} />}
      />

      <StatCards stats={stats} />

      <div className="grid grid-cols-5 gap-4 mb-4">
        <div className="col-span-3 rounded-xl p-5 border" style={CARD_STYLE}>
          <SectionTitle>Campaign Performance</SectionTitle>
          <CampaignBarChart data={data} />
        </div>

        <div className="col-span-2 rounded-xl p-5 border" style={CARD_STYLE}>
          <SectionTitle>Email Accounts</SectionTitle>
          <WarmupList accounts={data.accounts} provider={data.provider} />
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
  const maxSent = Math.max(...items.map(a => a.sent), 1)

  return (
    <div className="flex flex-col gap-4">
      {items.map(item => {
        const rate = replyRate(item.sent, item.replies)

        return (
          <div key={item.campaignId}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[12px] font-medium truncate max-w-[55%]" style={{ color: 'var(--ink)' }}>
                {item.campaignName || 'Unknown'}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                <span className="text-[11px] font-mono" style={{ color: 'var(--ink-muted)' }}>
                  {item.sent.toLocaleString()}
                </span>
                <span
                  className="text-[11px] font-mono font-bold w-12 text-right"
                  style={{ color: rate > 0 ? 'var(--ink)' : 'var(--ink-muted)' }}>
                  {rate.toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-sunken)' }}>
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${(item.sent / maxSent) * 100}%`, background: 'var(--brand-wash)' }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${(item.replies / maxSent) * 100}%`, background: 'var(--brand)' }}
              />
            </div>
          </div>
        )
      })}

      <div className="flex items-center gap-5 mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-1.5 rounded-sm" style={{ background: 'var(--brand-wash)' }} />
          Sent
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-1.5 rounded-sm" style={{ background: 'var(--brand)' }} />
          Replies
        </div>
      </div>
    </div>
  )
}

function AccountRow({ account }: { account: EmailAccount }) {
  const score = account.warmupScore
  const warn = score !== undefined && score < WARMUP_THRESHOLD
  const color = warn ? 'var(--amber-ink)' : 'var(--brand)'

  return (
    <div className="flex items-center justify-between py-2.5 border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-mono truncate" style={{ color: 'var(--ink-soft)' }}>
          {account.email}
        </div>
        <div
          className="text-[10px] mt-0.5 font-medium"
          style={{ color: score === undefined ? 'var(--ink-muted)' : color }}>
          {score === undefined ? 'No warmup data' : warn ? 'Below threshold' : 'Healthy'}
        </div>
      </div>
      <div className="flex items-center gap-2.5 flex-shrink-0 ml-3">
        <div className="w-14 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-sunken)' }}>
          <div className="h-full rounded-full" style={{ width: `${score ?? 0}%`, background: color }} />
        </div>
        <div className="text-[12px] font-mono font-bold w-7 text-right" style={{ color }}>
          {score ?? '—'}
        </div>
      </div>
    </div>
  )
}

const VISIBLE_ACCOUNTS = 9

function WarmupList({ accounts, provider }: { accounts: EmailAccount[]; provider: ProviderId }) {
  const [expanded, setExpanded] = useState(false)
  if (accounts.length === 0) return <Empty>No accounts found</Empty>

  const extra = accounts.slice(VISIBLE_ACCOUNTS)

  return (
    <div className="flex flex-col">
      {provider === 'smartlead' && (
        <div className="text-[10px] mb-2" style={{ color: 'var(--ink-muted)' }}>
          Score shown is inbox placement — Smartlead reports no 0–100 warmup score.
        </div>
      )}

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
          className="text-[11px] pt-3 text-left font-medium transition-opacity hover:opacity-70"
          style={{ color: expanded ? 'var(--ink-muted)' : 'var(--brand)' }}>
          {expanded ? '↑ Show less' : `+${extra.length} more accounts`}
        </button>
      )}
    </div>
  )
}

const TABLE_HEADERS = ['Campaign', 'Leads', 'Sent', 'Replies', 'Positive', 'Reply %', 'Pipeline']

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
                style={{ color: 'var(--ink-soft)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(a => {
            const rate = replyRate(a.sent, a.replies)

            return (
              <tr
                key={a.campaignId}
                className="border-b hover:bg-black/[0.015] transition-colors"
                style={{ borderColor: 'var(--line)' }}>
                <td className="py-3 px-3 max-w-[200px]">
                  <div className="truncate font-medium" style={{ color: 'var(--ink)' }}>
                    {a.campaignName}
                  </div>
                </td>
                <Cell>{a.leads.toLocaleString()}</Cell>
                <Cell>{a.sent.toLocaleString()}</Cell>
                <Cell>{a.replies.toLocaleString()}</Cell>
                <td
                  className="py-3 px-3 text-right font-mono font-semibold"
                  style={{ color: a.positiveReplies > 0 ? 'var(--green-ink)' : 'var(--ink-muted)' }}>
                  {a.positiveReplies.toLocaleString()}
                </td>
                <td className="py-3 px-3 text-right font-mono font-semibold" style={{ color: 'var(--ink)' }}>
                  {rate.toFixed(1)}%
                </td>
                <td
                  className="py-3 px-3 text-right font-mono font-semibold"
                  style={{ color: a.opportunityValue > 0 ? 'var(--green-ink)' : 'var(--ink-muted)' }}>
                  {a.opportunityValue > 0 ? `$${a.opportunityValue.toLocaleString()}` : '—'}
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

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-36 gap-4" style={{ color: 'var(--ink-muted)' }}>
      <div
        className="w-6 h-6 rounded-full border-2 animate-spin-slow"
        style={{ borderColor: 'var(--line-strong)', borderTopColor: 'var(--brand)' }}
      />
      <div className="text-[13px]">Syncing…</div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-36 gap-2">
      <div className="text-[14px] font-semibold" style={{ color: 'var(--red-ink)' }}>
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

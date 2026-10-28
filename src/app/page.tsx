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
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  const [authUser, setAuthUser] = useState('')
  const [authPass, setAuthPass] = useState('')
  const [authError, setAuthError] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  const isOverview = session?.role === 'admin' && selectedClient === ALL_CLIENTS

  async function handleLogin() {
    if (signingIn) return
    setAuthError('')
    setSigningIn(true)
    try {
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
    } finally {
      setSigningIn(false)
    }
  }

  function logout() {
    clearInterval(intervalRef.current)
    setSession(null)
    setData(null)
    setOverview(null)
    setLastSync(null)
    setSelectedClient(ALL_CLIENTS)
  }

  function selectClient(id: string) {
    setSelectedClient(id)
    setData(null)
    setError('')
  }

  const sync = useCallback(async (clientId: string, sess: Session) => {
    const wantsOverview = sess.role === 'admin' && clientId === ALL_CLIENTS
    setError('')
    setSyncing(true)
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
      setLastSync(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    if (!session) return
    // A client user has no workspace until their id resolves.
    if (session.role === 'user' && !selectedClient) return

    sync(selectedClient, session)

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
        busy={signingIn}
        onLogin={handleLogin}
      />
    )
  }

  const clientName =
    (session.role === 'admin' ? session.clients.find(c => c.id === selectedClient)?.name : undefined) ??
    data?.clientName ??
    ''
  const provider = isOverview ? undefined : data?.provider

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--pearl)' }}>
      <TopNav
        session={session}
        selectedClient={selectedClient}
        onSelect={selectClient}
        onRefresh={() => sync(selectedClient, session)}
        onLogout={logout}
        syncing={syncing}
        lastSync={lastSync}
      />

      <Hero
        eyebrow={isOverview ? 'Agency overview' : 'Client workspace'}
        title={isOverview ? 'All clients' : clientName || 'Workspace'}
        subtitle={
          isOverview
            ? `Live outbound performance across ${session.clients.length} client workspace${
                session.clients.length !== 1 ? 's' : ''
              }.`
            : 'Campaigns, replies and inbox health — refreshed live from your sending platform.'
        }
        provider={provider}
      />

      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 -mt-16 relative z-10 pb-16">
        {error && !(isOverview ? overview : data) ? (
          <ErrorState message={error} onRetry={() => sync(selectedClient, session)} />
        ) : isOverview && overview ? (
          <AdminOverview overview={overview} onOpenClient={selectClient} />
        ) : !isOverview && data ? (
          <Workspace data={data} />
        ) : (
          <LoadingState />
        )}
      </main>

      <footer className="border-t" style={{ borderColor: 'var(--line)' }}>
        <div
          className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-center justify-between gap-3 text-[12px]"
          style={{ color: 'var(--ink-muted)' }}>
          <Logo height={16} tone="dark" />
          <span>RevOps &amp; GTM engineering · Data refreshes every {SYNC_SECONDS}s</span>
        </div>
      </footer>
    </div>
  )
}

/* ── Brand ───────────────────────────────────────────────────────────────── */

/**
 * The Zutomate mark: a Z whose diagonal is an orange up-right arrow — the same
 * construction as the logo on zutomate.com, redrawn as clean vectors.
 */
function LogoMark({ size = 28, tone = 'light' }: { size?: number; tone?: 'light' | 'dark' }) {
  const bar = tone === 'light' ? '#ffffff' : 'var(--navy)'
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <g strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 6.5h9.5" stroke={bar} />
        <path d="M4.5 25.5h23" stroke={bar} />
        <path d="M6 23.5 25 7.5" stroke="var(--orange)" />
        <path d="M16 6.5h10v10" stroke="var(--orange)" />
      </g>
    </svg>
  )
}

/** Full wordmark: the arrow-Z followed by "utomate", reading as "Zutomate". */
function Logo({ height = 24, tone = 'light' }: { height?: number; tone?: 'light' | 'dark' }) {
  const text = tone === 'light' ? '#ffffff' : 'var(--navy)'
  return (
    <svg height={height} viewBox="0 0 152 32" fill="none" role="img" aria-label="Zutomate" style={{ width: 'auto' }}>
      <g strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 6.5h9.5" stroke={text} />
        <path d="M2 25.5h23" stroke={text} />
        <path d="M3.5 23.5 22.5 7.5" stroke="var(--orange)" />
        <path d="M13.5 6.5h10v10" stroke="var(--orange)" />
      </g>
      <text
        x="27"
        y="27.2"
        fill={text}
        className="font-display"
        style={{ fontSize: 31, fontWeight: 500, letterSpacing: '-0.6px' }}>
        utomate
      </text>
    </svg>
  )
}

function ArrowUpRight({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 17 17 7M8 7h9v9" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RefreshIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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

/* ── App chrome ──────────────────────────────────────────────────────────── */

interface TopNavProps {
  session: Session
  selectedClient: string
  onSelect: (id: string) => void
  onRefresh: () => void
  onLogout: () => void
  syncing: boolean
  lastSync: Date | null
}

function TopNav({ session, selectedClient, onSelect, onRefresh, onLogout, syncing, lastSync }: TopNavProps) {
  const admin = session.role === 'admin'

  return (
    <header className="sticky top-0 z-50 border-b" style={{ background: 'var(--navy)', borderColor: 'var(--on-navy-line)' }}>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
        <Logo height={22} tone="light" />

        <span
          className="hidden sm:inline-flex text-[10.5px] uppercase tracking-[0.14em] font-medium px-2.5 py-1 rounded-full border"
          style={{ borderColor: 'var(--on-navy-line)', color: 'var(--on-navy-soft)' }}>
          {admin ? 'Admin' : 'Client portal'}
        </span>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <LiveIndicator lastSync={lastSync} />

          <button
            onClick={onRefresh}
            disabled={syncing}
            aria-label="Refresh data"
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg border transition-colors hover:bg-white/10"
            style={{ borderColor: 'var(--on-navy-line)', color: 'var(--on-navy)' }}>
            <span className={syncing ? 'animate-spin-slow inline-flex' : 'inline-flex'}>
              <RefreshIcon />
            </span>
          </button>

          <button
            onClick={onLogout}
            className="h-9 px-3.5 rounded-lg border text-[13px] transition-colors hover:bg-white/10"
            style={{ borderColor: 'var(--on-navy-line)', color: 'var(--on-navy)' }}>
            Sign out
          </button>
        </div>
      </div>

      {admin && (
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
          <div className="flex gap-1 overflow-x-auto -mb-px">
            <ClientTab active={selectedClient === ALL_CLIENTS} onClick={() => onSelect(ALL_CLIENTS)}>
              All clients
            </ClientTab>
            {session.clients.map(c => (
              <ClientTab key={c.id} active={selectedClient === c.id} onClick={() => onSelect(c.id)}>
                {c.name}
              </ClientTab>
            ))}
          </div>
        </div>
      )}
    </header>
  )
}

function ClientTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="relative whitespace-nowrap px-3.5 py-3 text-[13px] font-medium transition-colors hover:text-white"
      style={{ color: active ? 'var(--on-navy)' : 'var(--on-navy-muted)' }}>
      {children}
      <span
        className="absolute left-3 right-3 bottom-0 h-[2px] rounded-full transition-opacity"
        style={{ background: 'var(--orange)', opacity: active ? 1 : 0 }}
      />
    </button>
  )
}

function LiveIndicator({ lastSync }: { lastSync: Date | null }) {
  return (
    <div className="hidden md:flex items-center gap-2 text-[12px] mr-1" style={{ color: 'var(--on-navy-soft)' }}>
      <span className="live-dot w-2 h-2 rounded-full" style={{ background: 'var(--orange)' }} />
      Live
      {lastSync && (
        <span style={{ color: 'var(--on-navy-muted)' }}>
          · synced {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  )
}

function Hero({
  eyebrow,
  title,
  subtitle,
  provider,
}: {
  eyebrow: string
  title: string
  subtitle: string
  provider?: ProviderId
}) {
  return (
    <section className="relative overflow-hidden" style={{ background: 'var(--navy)' }}>
      <div className="absolute inset-0 navy-grid" />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 60% 90% at 92% 0%, rgba(242,101,34,0.16) 0%, transparent 60%), radial-gradient(ellipse 50% 80% at 0% 100%, rgba(255,255,255,0.05) 0%, transparent 60%)',
        }}
      />
      <div className="relative max-w-[1400px] mx-auto px-4 sm:px-6 pt-9 pb-28">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Eyebrow>{eyebrow}</Eyebrow>
          {provider && <Eyebrow>{PROVIDER_LABEL[provider]}</Eyebrow>}
        </div>
        <h1
          className="font-display text-[32px] sm:text-[42px] leading-[1.08] font-medium text-white"
          style={{ letterSpacing: '-1.2px' }}>
          {title}
        </h1>
        <p className="mt-3 text-[15px] font-light max-w-[620px]" style={{ color: 'var(--on-navy-soft)' }}>
          {subtitle}
        </p>
      </div>
    </section>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-2 text-[10.5px] uppercase font-medium px-3 py-1 rounded-full border"
      style={{ borderColor: 'rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.8)', letterSpacing: '1.8px' }}>
      {children}
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
  busy: boolean
  onLogin: () => void
}

const FEATURES = [
  { title: 'Live campaign tracking', body: 'Sends, replies and bounces straight from your sending platform.' },
  { title: 'Positive-reply pipeline', body: 'Every interested lead and the pipeline value behind it.' },
  { title: 'Inbox health', body: 'Warmup and placement scores for every sending account.' },
]

function LoginScreen({ user, setUser, pass, setPass, error, busy, onLogin }: LoginScreenProps) {
  return (
    <div className="min-h-screen flex" style={{ background: 'var(--pearl)' }}>
      {/* Navy brand panel */}
      <div
        className="hidden lg:flex flex-col justify-between w-[48%] relative overflow-hidden px-14 py-12"
        style={{ background: 'var(--navy)' }}>
        <div className="absolute inset-0 navy-grid" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(ellipse 70% 55% at 100% 100%, rgba(242,101,34,0.22) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 0% 0%, rgba(255,255,255,0.06) 0%, transparent 60%)',
          }}
        />

        <div className="relative z-10">
          <Logo height={28} tone="light" />
        </div>

        <div className="relative z-10 max-w-[480px]">
          <div className="mb-6">
            <Eyebrow>Client portal</Eyebrow>
          </div>
          <h2
            className="font-display text-[46px] leading-[1.06] font-medium text-white mb-5"
            style={{ letterSpacing: '-1.6px' }}>
            Your outbound,
            <br />
            <span style={{ color: 'var(--orange)' }}>engineered</span> end to end.
          </h2>
          <p className="text-[16px] font-light leading-relaxed" style={{ color: 'var(--on-navy-soft)' }}>
            One live view of every campaign, reply and sending inbox Zutomate runs for you.
          </p>

          <div className="mt-10 flex flex-col gap-5">
            {FEATURES.map(f => (
              <div key={f.title} className="flex gap-3.5">
                <span
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border"
                  style={{ borderColor: 'var(--on-navy-line)', background: 'rgba(255,255,255,0.04)' }}>
                  <ArrowUpRight size={15} color="var(--orange)" />
                </span>
                <div>
                  <div className="text-[14px] font-medium text-white">{f.title}</div>
                  <div className="text-[13px] font-light mt-0.5" style={{ color: 'var(--on-navy-muted)' }}>
                    {f.body}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-[12px]" style={{ color: 'var(--on-navy-muted)' }}>
          © {new Date().getFullYear()} Zutomate · RevOps &amp; GTM engineering
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-8 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-10 lg:hidden">
            <Logo height={28} tone="dark" />
          </div>

          <div className="mb-8">
            <h1
              className="font-display text-[32px] font-medium mb-2"
              style={{ color: 'var(--ink)', letterSpacing: '-0.8px' }}>
              Welcome back
            </h1>
            <p className="text-[15px] font-light" style={{ color: 'var(--ink-soft)' }}>
              Sign in to see your live outbound numbers.
            </p>
          </div>

          <form
            className="flex flex-col gap-4"
            onSubmit={e => {
              e.preventDefault()
              onLogin()
            }}>
            <Field label="Username">
              <LoginInput value={user} onChange={setUser} placeholder="Enter your username" autoComplete="username" />
            </Field>

            <Field label="Password">
              <LoginInput
                value={pass}
                onChange={setPass}
                placeholder="Enter your password"
                type="password"
                autoComplete="current-password"
              />
            </Field>

            {error && (
              <div
                className="px-4 py-3 rounded-xl text-[13px]"
                style={{ background: 'var(--red-wash)', border: '1px solid rgba(194,52,31,0.2)', color: 'var(--red-ink)' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="btn-orange w-full mt-2 py-3.5 rounded-full text-[15px] font-medium inline-flex items-center justify-center gap-2 disabled:opacity-70">
              {busy ? 'Signing in…' : 'Sign in'}
              {!busy && <ArrowUpRight size={16} />}
            </button>
          </form>

          <p className="mt-8 text-[12.5px] text-center" style={{ color: 'var(--ink-muted)' }}>
            Need access? Contact your Zutomate account manager.
          </p>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[13px] font-medium mb-2" style={{ color: 'var(--ink)' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function LoginInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  type?: string
  autoComplete?: string
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
        autoComplete={autoComplete}
        onChange={e => onChange(e.target.value)}
        className={`zt-input w-full px-4 py-3.5 rounded-xl text-[14px] ${isPassword ? 'pr-11' : ''}`}
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
      className="text-[10px] uppercase font-medium px-2 py-0.5 rounded-full border"
      style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-soft)', letterSpacing: '1px' }}>
      {PROVIDER_LABEL[provider]}
    </span>
  )
}

interface Stat {
  label: string
  value: string
  unit?: string
  sub: string
  color?: string
  /** The positive-reply card: rendered on navy with the green dollar badge. */
  featured?: boolean
}

function StatCards({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
      {stats.map(s =>
        s.featured ? (
          <div
            key={s.label}
            className="rounded-2xl p-5 relative overflow-hidden"
            style={{ background: 'linear-gradient(150deg, var(--navy-3), var(--navy))', boxShadow: 'var(--shadow-lift)' }}>
            <div
              className="absolute -right-8 -top-8 w-28 h-28 rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(47,211,138,0.22), transparent 70%)' }}
            />
            <div className="relative flex items-center justify-between mb-4">
              <div className="text-[11px] uppercase font-medium" style={{ color: 'var(--on-navy-soft)', letterSpacing: '1.2px' }}>
                {s.label}
              </div>
              <DollarBadge size={18} />
            </div>
            <div
              className="relative font-display tabular text-[32px] font-semibold leading-none"
              style={{ color: 'var(--green-bright)', letterSpacing: '-0.8px' }}>
              {s.value}
            </div>
            <div className="relative text-[12px] mt-2" style={{ color: 'var(--on-navy-soft)' }}>
              {s.sub}
            </div>
          </div>
        ) : (
          <div key={s.label} className="rounded-2xl p-5 border" style={CARD_STYLE}>
            <div className="text-[11px] uppercase font-medium mb-4" style={{ color: 'var(--ink-muted)', letterSpacing: '1.2px' }}>
              {s.label}
            </div>
            <div
              className="font-display tabular text-[32px] font-semibold leading-none"
              style={{ color: s.color ?? 'var(--ink)', letterSpacing: '-0.8px' }}>
              {s.value}
              {s.unit && (
                <span className="text-[14px] font-normal ml-0.5" style={{ color: 'var(--ink-muted)' }}>
                  {s.unit}
                </span>
              )}
            </div>
            <div className="text-[12px] mt-2" style={{ color: 'var(--ink-muted)' }}>
              {s.sub}
            </div>
          </div>
        ),
      )}
    </div>
  )
}

function Panel({
  title,
  subtitle,
  right,
  className = '',
  children,
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={`rounded-2xl border ${className}`} style={CARD_STYLE}>
      <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4">
        <div>
          <h2 className="font-display text-[17px] font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.3px' }}>
            {title}
          </h2>
          {subtitle && (
            <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              {subtitle}
            </p>
          )}
        </div>
        {right}
      </div>
      <div className="px-5 sm:px-6 pb-5">{children}</div>
    </section>
  )
}

function CountChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[11.5px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap"
      style={{ background: 'var(--surface-sunken)', color: 'var(--ink-soft)' }}>
      {children}
    </span>
  )
}

/* ── Admin: every client, every campaign ─────────────────────────────────── */

function AdminOverview({ overview, onOpenClient }: { overview: OverviewData; onOpenClient: (id: string) => void }) {
  const rate = replyRate(overview.totalSent, overview.totalReplies)
  const bounce = bounceRate(overview.totalSent, overview.totalBounces)
  const failed = overview.clients.filter(c => c.error)
  const [campaignFilter, setCampaignFilter] = useState('all')

  const stats: Stat[] = [
    {
      label: 'Emails sent',
      value: overview.totalSent.toLocaleString(),
      sub: `Across ${overview.clients.length} client${overview.clients.length !== 1 ? 's' : ''}`,
    },
    {
      label: 'Reply rate',
      value: `${rate.toFixed(1)}%`,
      sub: `${overview.totalReplies.toLocaleString()} total replies`,
    },
    {
      label: 'Positive replies',
      value: overview.totalPositiveReplies.toLocaleString(),
      sub: overview.totalPipeline > 0 ? `$${overview.totalPipeline.toLocaleString()} pipeline` : 'Interested leads',
      featured: true,
    },
    {
      label: 'Bounce rate',
      value: `${bounce.toFixed(1)}%`,
      sub: `${overview.totalBounces.toLocaleString()} bounced`,
      color: bounce > 5 ? 'var(--amber-ink)' : undefined,
    },
    {
      label: 'Active campaigns',
      value: String(overview.activeCampaigns),
      sub: `${overview.campaigns.length} total campaigns`,
    },
    {
      label: 'Clients',
      value: String(overview.clients.length),
      sub: failed.length > 0 ? `${failed.length} failing to sync` : 'All syncing',
      color: failed.length > 0 ? 'var(--amber-ink)' : undefined,
    },
  ]

  return (
    <div className="animate-fade-in">
      <StatCards stats={stats} />

      <Panel
        title="Clients"
        subtitle="Performance per workspace — open one to see its campaigns and inboxes."
        right={<CountChip>{overview.clients.length} workspaces</CountChip>}
        className="mb-5">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {overview.clients.map(c => (
            <ClientCard key={c.clientId} client={c} onOpen={() => onOpenClient(c.clientId)} />
          ))}
        </div>
      </Panel>

      <Panel
        title="All campaigns"
        subtitle="Every campaign across every client."
        right={
          <FilterToggle
            value={campaignFilter}
            onChange={setCampaignFilter}
            options={[
              { id: 'all', label: `All ${overview.campaigns.length}` },
              { id: 'active', label: `Active ${overview.activeCampaigns}` },
            ]}
          />
        }>
        <AllCampaignsTable
          key={campaignFilter}
          campaigns={campaignFilter === 'active' ? overview.campaigns.filter(c => c.active) : overview.campaigns}
        />
      </Panel>
    </div>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function ClientCard({ client, onOpen }: { client: ClientRollup; onOpen: () => void }) {
  const rate = replyRate(client.totalSent, client.totalReplies)

  return (
    <button
      onClick={onOpen}
      className="group text-left rounded-2xl border p-5 transition-all hover:-translate-y-0.5"
      style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = 'var(--shadow-lift)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>
      <div className="flex items-center gap-3 mb-5">
        <span
          className="w-10 h-10 rounded-xl flex items-center justify-center font-display text-[14px] font-semibold text-white flex-shrink-0"
          style={{ background: 'var(--navy)' }}>
          {initials(client.clientName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[16px] font-semibold truncate" style={{ color: 'var(--ink)' }}>
            {client.clientName}
          </div>
          <div className="mt-0.5">
            <ProviderBadge provider={client.provider} />
          </div>
        </div>
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center transition-colors group-hover:bg-[var(--orange)] group-hover:text-white"
          style={{ background: 'var(--surface-sunken)', color: 'var(--ink-soft)' }}>
          <ArrowUpRight size={14} />
        </span>
      </div>

      {client.error ? (
        <div
          className="text-[12px] leading-snug rounded-xl px-3 py-2.5"
          style={{ color: 'var(--red-ink)', background: 'var(--red-wash)' }}>
          Sync failed — {client.error}
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between mb-2">
            <div>
              <div className="text-[11px] uppercase font-medium" style={{ color: 'var(--ink-muted)', letterSpacing: '1px' }}>
                Reply rate
              </div>
              <div className="font-display tabular text-[28px] font-semibold leading-tight" style={{ color: 'var(--ink)' }}>
                {rate.toFixed(1)}%
              </div>
            </div>
            <div className="text-right">
              <div
                className="flex items-center justify-end gap-1 text-[11px] uppercase font-medium"
                style={{ color: 'var(--ink-muted)', letterSpacing: '1px' }}>
                Positive <DollarBadge size={13} />
              </div>
              <div className="font-display tabular text-[28px] font-semibold leading-tight" style={{ color: 'var(--green-ink)' }}>
                {client.totalPositiveReplies.toLocaleString()}
              </div>
            </div>
          </div>

          <div className="h-1.5 rounded-full overflow-hidden mb-4" style={{ background: 'var(--surface-sunken)' }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(rate * 10, 100)}%`, background: 'var(--orange)' }}
            />
          </div>

          <div className="grid grid-cols-4 gap-2 pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
            <Metric label="Sent" value={client.totalSent.toLocaleString()} />
            <Metric label="Bounce" value={`${bounceRate(client.totalSent, client.totalBounces).toFixed(1)}%`} />
            <Metric label="Active" value={String(client.activeCampaigns)} />
            <Metric label="Warmup" value={client.avgWarmup === undefined ? '—' : String(client.avgWarmup)} />
          </div>
        </>
      )}
    </button>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase font-medium mb-0.5" style={{ color: 'var(--ink-muted)', letterSpacing: '0.8px' }}>
        {label}
      </div>
      <div className="text-[13.5px] font-mono font-medium truncate" style={{ color: 'var(--ink)' }}>
        {value}
      </div>
    </div>
  )
}

const ALL_CAMPAIGN_HEADERS = ['Client', 'Campaign', 'Status', 'Leads', 'Sent', 'Replies', 'Positive', 'Reply %']

function AllCampaignsTable({ campaigns }: { campaigns: AttributedCampaign[] }) {
  if (campaigns.length === 0) return <Empty>No campaigns across any client</Empty>

  return (
    <TableFrame
      headers={ALL_CAMPAIGN_HEADERS}
      leftAligned={['Client', 'Campaign']}
      rows={campaigns.map(c => (
        <tr key={`${c.clientId}:${c.campaignId}`} className="row-hover border-t" style={{ borderColor: 'var(--line)' }}>
          <td className="py-3.5 px-4 whitespace-nowrap">
            <div className="flex items-center gap-2">
              <span className="font-medium" style={{ color: 'var(--ink)' }}>
                {c.clientName}
              </span>
              <ProviderBadge provider={c.provider} />
            </div>
          </td>
          <td className="py-3.5 px-4 max-w-[320px]">
            <div className="truncate" style={{ color: 'var(--ink-soft)' }}>
              {c.campaignName}
            </div>
          </td>
          <td className="py-3.5 px-4 text-right">
            <StatusPill active={c.active} />
          </td>
          <Cell>{c.leads.toLocaleString()}</Cell>
          <Cell>{c.sent.toLocaleString()}</Cell>
          <Cell>{c.replies.toLocaleString()}</Cell>
          <PositiveCell value={c.positiveReplies} />
          <RateCell value={replyRate(c.sent, c.replies)} />
        </tr>
      ))}
    />
  )
}

const VISIBLE_ROWS = 12

/** Table shell that shows the first VISIBLE_ROWS rows, with a toggle for the rest. */
function TableFrame({
  headers,
  leftAligned,
  rows,
}: {
  headers: string[]
  leftAligned: string[]
  rows: React.ReactNode[]
}) {
  const [showAll, setShowAll] = useState(false)
  const hidden = rows.length - VISIBLE_ROWS

  return (
    <>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--line)' }}>
        <table className="w-full text-[13px]">
        <thead>
          <tr style={{ background: 'var(--surface-sunken)' }}>
            {headers.map(h => (
              <th
                key={h}
                className={`py-3 px-4 font-medium uppercase text-[10.5px] whitespace-nowrap ${
                  leftAligned.includes(h) ? 'text-left' : 'text-right'
                }`}
                style={{ color: 'var(--ink-muted)', letterSpacing: '1px' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
          <tbody>{showAll ? rows : rows.slice(0, VISIBLE_ROWS)}</tbody>
        </table>
      </div>
      {hidden > 0 && (
        <div className="flex justify-center pt-4">
          <button
            onClick={() => setShowAll(s => !s)}
            className="text-[12.5px] font-medium px-4 py-2 rounded-full border transition-colors hover:border-[var(--orange)]"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-soft)' }}>
            {showAll ? 'Show fewer' : `Show all ${rows.length} campaigns`}
          </button>
        </div>
      )}
    </>
  )
}

function FilterToggle({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="inline-flex p-0.5 rounded-full" style={{ background: 'var(--surface-sunken)' }}>
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className="text-[12px] font-medium px-3 py-1 rounded-full transition-colors whitespace-nowrap"
          style={
            o.id === value
              ? { background: 'var(--surface)', color: 'var(--ink)', boxShadow: '0 1px 2px rgba(13,27,46,0.08)' }
              : { color: 'var(--ink-muted)' }
          }>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-medium"
      style={
        active
          ? { background: 'var(--green-wash)', color: 'var(--green-ink)' }
          : { background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }
      }>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
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
      label: 'Emails sent',
      value: data.totalSent.toLocaleString(),
      sub: `${data.activeCampaigns} active campaign${data.activeCampaigns !== 1 ? 's' : ''}`,
    },
    {
      label: 'Reply rate',
      value: `${rate.toFixed(1)}%`,
      sub: `${data.totalReplies.toLocaleString()} total replies`,
    },
    {
      label: 'Positive replies',
      value: data.totalPositiveReplies.toLocaleString(),
      sub: data.totalPipeline > 0 ? `$${data.totalPipeline.toLocaleString()} pipeline` : 'Interested leads',
      featured: true,
    },
    {
      label: 'Bounce rate',
      value: `${bounce.toFixed(1)}%`,
      sub: `${data.totalBounces.toLocaleString()} bounced`,
      color: bounce > 5 ? 'var(--amber-ink)' : undefined,
    },
    {
      label: 'Unread emails',
      // Smartlead exposes no unread count.
      value: data.unreadCount === undefined ? '—' : String(data.unreadCount),
      sub: data.unreadCount === undefined ? 'Not reported' : 'Awaiting reply',
    },
    {
      label: 'Avg warmup',
      value: avgWarmup === undefined ? '—' : String(avgWarmup),
      unit: avgWarmup === undefined ? undefined : '/100',
      sub: `${data.accounts.length} account${data.accounts.length !== 1 ? 's' : ''}`,
    },
  ]

  return (
    <div className="animate-fade-in">
      <StatCards stats={stats} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mb-5">
        <Panel title="Campaign performance" subtitle="Sent vs. replies, latest 8 campaigns" className="lg:col-span-3">
          <CampaignBarChart data={data} />
        </Panel>

        <Panel
          title="Sending accounts"
          subtitle={data.provider === 'smartlead' ? 'Inbox placement score per account' : 'Warmup score per account'}
          right={<CountChip>{data.accounts.length}</CountChip>}
          className="lg:col-span-2">
          <WarmupList accounts={data.accounts} />
        </Panel>
      </div>

      <Panel
        title="Campaign breakdown"
        subtitle="Every campaign in this workspace."
        right={<CountChip>{data.analytics.length} campaigns</CountChip>}>
        <AnalyticsTable data={data} />
      </Panel>
    </div>
  )
}

function CampaignBarChart({ data }: { data: DashboardData }) {
  if (data.analytics.length === 0) return <Empty>No campaign data</Empty>

  const items = sortByNewest(data.analytics, data.campaigns).slice(0, 8)
  const maxSent = Math.max(...items.map(a => a.sent), 1)

  return (
    <div className="flex flex-col gap-5">
      {items.map(item => {
        const rate = replyRate(item.sent, item.replies)

        return (
          <div key={item.campaignId}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-[13px] font-medium truncate" style={{ color: 'var(--ink)' }}>
                {item.campaignName || 'Unknown'}
              </div>
              <div className="flex items-center gap-4 flex-shrink-0">
                <span className="text-[12px] font-mono" style={{ color: 'var(--ink-muted)' }}>
                  {item.sent.toLocaleString()} sent
                </span>
                <span
                  className="text-[12px] font-mono font-medium w-12 text-right"
                  style={{ color: rate > 0 ? 'var(--orange-ink)' : 'var(--ink-muted)' }}>
                  {rate.toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-sunken)' }}>
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${(item.sent / maxSent) * 100}%`, background: 'rgba(13,27,46,0.16)' }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${Math.max((item.replies / maxSent) * 100, item.replies > 0 ? 1.5 : 0)}%`, background: 'var(--orange)' }}
              />
            </div>
          </div>
        )
      })}

      <div className="flex items-center gap-5 pt-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        <div className="flex items-center gap-2">
          <div className="w-3 h-2 rounded-sm" style={{ background: 'rgba(13,27,46,0.16)' }} />
          Sent
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-2 rounded-sm" style={{ background: 'var(--orange)' }} />
          Replies
        </div>
      </div>
    </div>
  )
}

function AccountRow({ account }: { account: EmailAccount }) {
  const score = account.warmupScore
  const warn = score !== undefined && score < WARMUP_THRESHOLD
  const color = warn ? 'var(--amber-ink)' : 'var(--green-ink)'

  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-mono truncate" style={{ color: 'var(--ink)' }}>
          {account.email}
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: score === undefined ? 'var(--ink-muted)' : color }}>
          {score === undefined ? 'No warmup data' : warn ? 'Below threshold' : 'Healthy'}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 ml-3">
        <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-sunken)' }}>
          <div className="h-full rounded-full" style={{ width: `${score ?? 0}%`, background: warn ? color : 'var(--navy)' }} />
        </div>
        <div className="text-[13px] font-mono font-medium w-7 text-right" style={{ color: warn ? color : 'var(--ink)' }}>
          {score ?? '—'}
        </div>
      </div>
    </div>
  )
}

const VISIBLE_ACCOUNTS = 8

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
          maxHeight: expanded ? `${Math.min(extra.length * 56, 900)}px` : '0px',
          overflow: expanded ? 'auto' : 'hidden',
          transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)',
        }}>
        {extra.map(a => (
          <AccountRow key={a.email} account={a} />
        ))}
      </div>

      {extra.length > 0 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-3 self-start text-[12.5px] font-medium px-3 py-1.5 rounded-full border transition-colors hover:border-[var(--orange)]"
          style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-soft)' }}>
          {expanded ? 'Show less' : `Show ${extra.length} more`}
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
    <TableFrame
      headers={TABLE_HEADERS}
      leftAligned={['Campaign']}
      rows={rows.map(a => (
        <tr key={a.campaignId} className="row-hover border-t" style={{ borderColor: 'var(--line)' }}>
          <td className="py-3.5 px-4 max-w-[320px]">
            <div className="truncate font-medium" style={{ color: 'var(--ink)' }}>
              {a.campaignName}
            </div>
          </td>
          <Cell>{a.leads.toLocaleString()}</Cell>
          <Cell>{a.sent.toLocaleString()}</Cell>
          <Cell>{a.replies.toLocaleString()}</Cell>
          <PositiveCell value={a.positiveReplies} />
          <RateCell value={replyRate(a.sent, a.replies)} />
          <td
            className="py-3.5 px-4 text-right font-mono font-medium"
            style={{ color: a.opportunityValue > 0 ? 'var(--green-ink)' : 'var(--ink-muted)' }}>
            {a.opportunityValue > 0 ? `$${a.opportunityValue.toLocaleString()}` : '—'}
          </td>
        </tr>
      ))}
    />
  )
}

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <td className="py-3.5 px-4 text-right font-mono" style={{ color: 'var(--ink-soft)' }}>
      {children}
    </td>
  )
}

function PositiveCell({ value }: { value: number }) {
  return (
    <td className="py-3.5 px-4 text-right font-mono font-medium" style={{ color: value > 0 ? 'var(--green-ink)' : 'var(--ink-muted)' }}>
      {value.toLocaleString()}
    </td>
  )
}

function RateCell({ value }: { value: number }) {
  return (
    <td className="py-3.5 px-4 text-right font-mono font-medium" style={{ color: 'var(--ink)' }}>
      {value.toFixed(1)}%
    </td>
  )
}

function LoadingState() {
  return (
    <div
      className="rounded-2xl border flex flex-col items-center justify-center py-32 gap-4"
      style={{ ...CARD_STYLE, color: 'var(--ink-muted)' }}>
      <div
        className="w-7 h-7 rounded-full border-[2.5px] animate-spin-slow"
        style={{ borderColor: 'var(--line-strong)', borderTopColor: 'var(--orange)' }}
      />
      <div className="text-[13px]">Syncing live data…</div>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border flex flex-col items-center justify-center py-28 gap-3 px-6 text-center" style={CARD_STYLE}>
      <div className="font-display text-[18px] font-semibold" style={{ color: 'var(--red-ink)' }}>
        Sync failed
      </div>
      <div className="text-[13px] max-w-[520px]" style={{ color: 'var(--ink-muted)' }}>
        {message}
      </div>
      <button onClick={onRetry} className="btn-orange mt-3 px-5 py-2.5 rounded-full text-[13px] font-medium">
        Try again
      </button>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-10 text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>
      {children}
    </div>
  )
}

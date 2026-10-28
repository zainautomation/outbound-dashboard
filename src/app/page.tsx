'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  WARMUP_THRESHOLD,
  acceptanceRate,
  averageWarmupScore,
  bounceRate,
  emailsPerLead,
  lastDays,
  positiveRate,
  replyRate,
} from '@/lib/metrics'
import type {
  CampaignAnalytics,
  CampaignStatus,
  ClientRollup,
  ClientSummary,
  DailyPoint,
  DashboardData,
  EmailAccount,
  LinkedInData,
  LinkedInDailyPoint,
  OverviewData,
  ProviderId,
  Session,
} from '@/lib/types'

const SYNC_SECONDS = 30
const TREND_DAYS = 30

/** Sentinel for the admin's cross-client view. */
const ALL_CLIENTS = ''

type View = 'overview' | 'email' | 'linkedin' | 'inboxes'

export default function Home() {
  const [session, setSession] = useState<Session | null>(null)
  const [selectedClient, setSelectedClient] = useState(ALL_CLIENTS)
  const [view, setView] = useState<View>('overview')
  const [data, setData] = useState<DashboardData | null>(null)
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [error, setError] = useState('')
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
      setView('overview')
    } finally {
      setSigningIn(false)
    }
  }

  function logout() {
    clearInterval(intervalRef.current)
    setSession(null)
    setData(null)
    setOverview(null)
    setSelectedClient(ALL_CLIENTS)
    setView('overview')
  }

  function selectClient(id: string) {
    setSelectedClient(id)
    setView('overview')
    setData(null)
    setError('')
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
      else
        setData(prev => {
          // A LinkedIn hiccup on one refresh shouldn't wipe LinkedIn data already on screen.
          const next = json as DashboardData
          if (next.linkedinError && prev?.clientId === next.clientId && prev.linkedin) {
            return { ...next, linkedin: prev.linkedin, linkedinError: undefined }
          }
          return next
        })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    }
  }, [])

  useEffect(() => {
    if (!session) return
    // A client user has no workspace until their id resolves.
    if (session.role === 'user' && !selectedClient) return

    sync(selectedClient, session)

    // Auto-refresh quietly in the background.
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

  const clients: ClientSummary[] = session.role === 'admin' ? session.clients : [session.client]
  const current = clients.find(c => c.id === selectedClient)
  const hasLinkedIn = Boolean(current?.hasLinkedIn)
  const activeView: View = view === 'linkedin' && !hasLinkedIn ? 'overview' : view
  const loaded = isOverview ? overview : data

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--pearl)' }}>
      <Sidebar
        session={session}
        clients={clients}
        selectedClient={selectedClient}
        onSelectClient={selectClient}
        view={activeView}
        onView={setView}
        hasLinkedIn={hasLinkedIn}
        onLogout={logout}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav
          session={session}
          clients={clients}
          selectedClient={selectedClient}
          onSelectClient={selectClient}
          view={activeView}
          onView={setView}
          hasLinkedIn={hasLinkedIn}
          onLogout={logout}
        />

        <main className="flex-1 w-full max-w-[1320px] mx-auto px-4 sm:px-8 py-7 sm:py-9">
          {error && !loaded ? (
            <ErrorState message={error} onRetry={() => sync(selectedClient, session)} />
          ) : isOverview && overview ? (
            <AdminOverview overview={overview} onOpenClient={selectClient} />
          ) : !isOverview && data ? (
            <Workspace data={data} view={activeView} onView={setView} />
          ) : (
            <LoadingState />
          )}
        </main>
      </div>
    </div>
  )
}

/* ── Brand ───────────────────────────────────────────────────────────────── */

/** Full wordmark: a Z whose diagonal is an orange up-right arrow, then "utomate". */
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

/** Small line icons for the sidebar. */
const ICONS: Record<View | 'clients' | 'logout', string> = {
  overview: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
  email: 'M4 6h16v12H4V6Zm0 0 8 6 8-6',
  linkedin: 'M7 10v7M7 7v.01M11 17v-4a2 2 0 0 1 4 0v4M11 10v7M4 4h16v16H4V4Z',
  inboxes: 'M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v6H4v-6Z',
  clients: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 9a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M21 20a5 5 0 0 0-4-4.9',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
}

function Icon({ name, size = 17 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d={ICONS[name]} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

/* ── Navigation ──────────────────────────────────────────────────────────── */

interface NavProps {
  session: Session
  clients: ClientSummary[]
  selectedClient: string
  onSelectClient: (id: string) => void
  view: View
  onView: (v: View) => void
  hasLinkedIn: boolean
  onLogout: () => void
}

function workspaceViews(hasLinkedIn: boolean): { id: View; label: string }[] {
  return [
    { id: 'overview', label: 'Overview' },
    { id: 'email', label: 'Email campaigns' },
    ...(hasLinkedIn ? [{ id: 'linkedin' as View, label: 'LinkedIn' }] : []),
    { id: 'inboxes', label: 'Sending inboxes' },
  ]
}

function Sidebar({ session, clients, selectedClient, onSelectClient, view, onView, hasLinkedIn, onLogout }: NavProps) {
  const admin = session.role === 'admin'
  const current = clients.find(c => c.id === selectedClient)

  return (
    <aside
      className="hidden lg:flex w-[256px] flex-shrink-0 flex-col sticky top-0 h-screen"
      style={{ background: 'var(--navy)' }}>
      <div className="px-6 pt-6 pb-5">
        <Logo height={22} tone="light" />
      </div>

      <div className="mx-4 mb-4">
        {admin ? (
          <ClientSwitcher clients={clients} selectedClient={selectedClient} onSelect={onSelectClient} />
        ) : (
          <div className="rounded-xl px-3.5 py-3" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <div className="text-[14px] font-medium text-white truncate">{current?.name}</div>
            <div className="text-[11px] uppercase mt-0.5" style={{ color: 'var(--on-navy-muted)', letterSpacing: '1.2px' }}>
              Client portal
            </div>
          </div>
        )}
      </div>

      <nav className="relative z-0 flex-1 overflow-y-auto px-3 pb-4">
        {current ? (
          <>
            <NavLabel>Workspace</NavLabel>
            {workspaceViews(hasLinkedIn).map(v => (
              <NavItem key={v.id} active={view === v.id} onClick={() => onView(v.id)} icon={v.id}>
                {v.label}
              </NavItem>
            ))}
          </>
        ) : (
          <>
            <NavLabel>Agency</NavLabel>
            <NavItem active onClick={() => onSelectClient(ALL_CLIENTS)} icon="clients">
              All clients overview
            </NavItem>
          </>
        )}
      </nav>

      <div className="px-3 pb-5 pt-3 border-t" style={{ borderColor: 'var(--on-navy-line)' }}>
        <NavItem active={false} onClick={onLogout} icon="logout">
          Sign out
        </NavItem>
      </div>
    </aside>
  )
}

/** Admin-only dropdown in the sidebar: pick a client to open its workspace. */
function ClientSwitcher({
  clients,
  selectedClient,
  onSelect,
}: {
  clients: ClientSummary[]
  selectedClient: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = clients.find(c => c.id === selectedClient)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const pick = (id: string) => {
    onSelect(id)
    setOpen(false)
  }

  const options = [{ id: ALL_CLIENTS, name: 'All clients' }, ...clients]

  return (
    <div ref={ref} className="relative z-50">
      <div className="px-1 pb-1.5 text-[10.5px] uppercase font-medium" style={{ color: 'var(--on-navy-muted)', letterSpacing: '1.4px' }}>
        Client
      </div>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center gap-3 rounded-xl px-3.5 py-3 border text-left transition-colors hover:bg-white/[0.08]"
        style={{ background: 'rgba(255,255,255,0.05)', borderColor: open ? 'rgba(255,255,255,0.25)' : 'var(--on-navy-line)' }}>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-white truncate">{current ? current.name : 'All clients'}</div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--on-navy-muted)' }}>
            {current ? 'Client workspace' : `${clients.length} workspaces`}
          </div>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className="flex-shrink-0 transition-transform"
          style={{ color: 'var(--on-navy-soft)', transform: open ? 'rotate(180deg)' : undefined }}>
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 mt-1.5 z-50 rounded-xl border p-1.5 max-h-[60vh] overflow-y-auto"
          style={{ background: 'var(--navy-2)', borderColor: 'rgba(255,255,255,0.14)', boxShadow: '0 16px 40px rgba(0,0,0,0.45)' }}>
          {options.map((o, i) => {
            const selected = o.id === selectedClient
            return (
              <div key={o.id || 'all'}>
                {i === 1 && <div className="my-1 h-px" style={{ background: 'var(--on-navy-line)' }} />}
                <button
                  role="option"
                  aria-selected={selected}
                  onClick={() => pick(o.id)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-[13.5px] text-left transition-colors hover:bg-white/[0.07]"
                  style={{ color: selected ? '#fff' : 'var(--on-navy-soft)', background: selected ? 'rgba(255,255,255,0.08)' : undefined }}>
                  <span className="truncate">{o.name}</span>
                  {selected && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="flex-shrink-0">
                      <path d="m5 12 5 5 9-10" stroke="var(--orange)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NavLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-3 pt-4 pb-2 text-[10.5px] uppercase font-medium"
      style={{ color: 'var(--on-navy-muted)', letterSpacing: '1.4px' }}>
      {children}
    </div>
  )
}

function NavItem({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: keyof typeof ICONS
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="relative w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] transition-colors hover:bg-white/5 text-left"
      style={{
        color: active ? '#fff' : 'var(--on-navy-soft)',
        background: active ? 'rgba(255,255,255,0.08)' : undefined,
      }}>
      {active && (
        <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: 'var(--orange)' }} />
      )}
      <Icon name={icon} />
      {children}
    </button>
  )
}

function MobileNav({ session, clients, selectedClient, onSelectClient, view, onView, hasLinkedIn, onLogout }: NavProps) {
  const admin = session.role === 'admin'
  const current = clients.find(c => c.id === selectedClient)

  return (
    <header className="lg:hidden sticky top-0 z-40" style={{ background: 'var(--navy)' }}>
      <div className="h-14 px-4 flex items-center gap-3">
        <Logo height={19} tone="light" />
        {admin && (
          <select
            value={selectedClient}
            onChange={e => onSelectClient(e.target.value)}
            className="ml-auto min-w-0 max-w-[45%] text-[13px] rounded-lg px-2.5 py-1.5 outline-none border"
            style={{ background: 'rgba(255,255,255,0.06)', borderColor: 'var(--on-navy-line)', color: '#fff' }}>
            <option value={ALL_CLIENTS} style={{ color: 'var(--ink)' }}>
              All clients
            </option>
            {clients.map(c => (
              <option key={c.id} value={c.id} style={{ color: 'var(--ink)' }}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={onLogout}
          className={`${admin ? '' : 'ml-auto '}text-[12.5px] px-3 py-1.5 rounded-lg border`}
          style={{ borderColor: 'var(--on-navy-line)', color: '#fff' }}>
          Sign out
        </button>
      </div>
      {current && (
        <div className="flex gap-1 px-3 overflow-x-auto pb-2">
          {workspaceViews(hasLinkedIn).map(v => (
            <button
              key={v.id}
              onClick={() => onView(v.id)}
              className="whitespace-nowrap text-[12.5px] px-3 py-1.5 rounded-full"
              style={
                view === v.id
                  ? { background: '#fff', color: 'var(--navy)' }
                  : { color: 'var(--on-navy-soft)' }
              }>
              {v.label}
            </button>
          ))}
        </div>
      )}
    </header>
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
  { title: 'Email and LinkedIn', body: 'Inbox health and LinkedIn outreach in the same view.' },
]

function LoginScreen({ user, setUser, pass, setPass, error, busy, onLogin }: LoginScreenProps) {
  return (
    <div className="min-h-screen flex" style={{ background: 'var(--pearl)' }}>
      {/* Navy brand panel */}
      <div
        className="hidden lg:flex flex-col justify-between gap-14 w-[48%] relative overflow-hidden px-14 py-12"
        style={{ background: 'var(--navy)' }}>
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

          <div className="mt-12 flex flex-col gap-7">
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

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-2 text-[10.5px] uppercase font-medium px-3 py-1 rounded-full border"
      style={{ borderColor: 'rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.8)', letterSpacing: '1.8px' }}>
      {children}
    </span>
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

/* ── Formatting ──────────────────────────────────────────────────────────── */

/** 747,504 → "747.5K" for headline figures; small numbers stay exact. */
function compact(n: number): string {
  if (Math.abs(n) < 10_000) return n.toLocaleString()
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

const pct = (n: number) => `${n.toFixed(1)}%`

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

function SourceBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[10px] uppercase font-medium px-2 py-0.5 rounded-full border whitespace-nowrap"
      style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-soft)', letterSpacing: '1px' }}>
      {children}
    </span>
  )
}

function PageHeader({
  eyebrow,
  title,
  subtitle,
  badges,
}: {
  eyebrow: string
  title: string
  subtitle: string
  badges?: React.ReactNode
}) {
  return (
    <div className="mb-7">
      <div className="text-[11px] uppercase font-medium mb-2" style={{ color: 'var(--orange-ink)', letterSpacing: '1.6px' }}>
        {eyebrow}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1
          className="font-display text-[30px] sm:text-[34px] leading-tight font-medium"
          style={{ color: 'var(--ink)', letterSpacing: '-1px' }}>
          {title}
        </h1>
        {badges}
      </div>
      <p className="mt-1.5 text-[14.5px] font-light" style={{ color: 'var(--ink-soft)' }}>
        {subtitle}
      </p>
    </div>
  )
}

/** Minimal trend line for KPI cards. */
function Sparkline({ values, color = 'var(--orange)' }: { values: number[]; color?: string }) {
  if (values.length < 2 || values.every(v => v === 0)) return null
  const w = 72
  const h = 22
  const max = Math.max(...values, 1)
  const step = w / (values.length - 1)
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`)
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" aria-hidden className="flex-shrink-0 hidden sm:block">
      <polyline points={points.join(' ')} stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

interface Kpi {
  label: string
  value: string
  /** Full-precision value shown on hover when `value` is compacted. */
  exact?: string
  sub?: string
  /** Small grey fraction chip, e.g. "324/3,654". */
  chip?: string
  spark?: number[]
  sparkColor?: string
  /** Progress bar under the value, 0–100. */
  bar?: { pct: number; color: string }
  valueColor?: string
  tone?: 'default' | 'highlight' | 'positive'
  badge?: boolean
}

function KpiCard({ k }: { k: Kpi }) {
  const highlight = k.tone === 'highlight'
  return (
    <div
      className="rounded-2xl border p-5 flex flex-col min-w-0"
      style={{
        ...CARD_STYLE,
        ...(highlight ? { borderColor: 'var(--orange)', boxShadow: '0 0 0 3px var(--orange-wash), var(--shadow-card)' } : {}),
      }}>
      <div className="flex items-center justify-between gap-2 mb-3 min-h-[20px]">
        <div
          className="text-[10.5px] uppercase font-medium truncate"
          style={{ color: 'var(--ink-muted)', letterSpacing: '1.2px' }}>
          {k.label}
        </div>
        {k.chip && (
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap"
            style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}>
            {k.chip}
          </span>
        )}
        {k.badge && <DollarBadge size={16} />}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div
          className="font-display tabular text-[28px] font-semibold leading-none"
          title={k.exact}
          style={{ color: k.valueColor ?? 'var(--ink)', letterSpacing: '-0.6px' }}>
          {k.value}
        </div>
        {k.spark && <Sparkline values={k.spark} color={k.sparkColor} />}
      </div>
      {k.bar && (
        <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-sunken)' }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(Math.max(k.bar.pct, 0), 100)}%`, background: k.bar.color }} />
        </div>
      )}
      {k.sub && (
        <div className="text-[12px] mt-2 truncate" style={{ color: 'var(--ink-muted)' }}>
          {k.sub}
        </div>
      )}
    </div>
  )
}

function KpiRow({ items, cols }: { items: Kpi[]; cols: string }) {
  return (
    <div className={`grid gap-3 mb-3 ${cols}`}>
      {items.map(k => (
        <KpiCard key={k.label} k={k} />
      ))}
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
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4">
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

function TextButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full border transition-colors hover:border-[var(--orange)]"
      style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-soft)' }}>
      {children}
      <ArrowUpRight size={12} />
    </button>
  )
}

function FilterToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div className="inline-flex flex-wrap p-0.5 rounded-full" style={{ background: 'var(--surface-sunken)' }}>
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

const STATUS_STYLE: Record<CampaignStatus, { label: string; bg: string; fg: string }> = {
  active: { label: 'Active', bg: 'var(--green-wash)', fg: 'var(--green-ink)' },
  paused: { label: 'Paused', bg: 'var(--amber-wash)', fg: 'var(--amber-ink)' },
  completed: { label: 'Completed', bg: 'var(--navy-wash)', fg: 'var(--ink-soft)' },
  draft: { label: 'Draft', bg: 'var(--surface-sunken)', fg: 'var(--ink-muted)' },
  error: { label: 'On hold', bg: 'var(--red-wash)', fg: 'var(--red-ink)' },
}

function StatusPill({ status }: { status: CampaignStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-medium whitespace-nowrap"
      style={{ background: s.bg, color: s.fg }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
      {s.label}
    </span>
  )
}

type StatusFilter = 'all' | 'active' | 'paused' | 'completed'

function statusOptions(statuses: CampaignStatus[]): { id: StatusFilter; label: string }[] {
  const count = (s: CampaignStatus) => statuses.filter(x => x === s).length
  return [
    { id: 'all', label: `All ${statuses.length}` },
    { id: 'active', label: `Active ${count('active')}` },
    { id: 'paused', label: `Paused ${count('paused')}` },
    { id: 'completed', label: `Completed ${count('completed')}` },
  ]
}

const VISIBLE_ROWS = 12

/** Table shell that shows the first rows, with a toggle for the rest. */
function TableFrame({
  headers,
  leftAligned,
  rows,
  limit = VISIBLE_ROWS,
  noun = 'campaigns',
}: {
  headers: string[]
  leftAligned: string[]
  rows: React.ReactNode[]
  limit?: number
  noun?: string
}) {
  const [showAll, setShowAll] = useState(false)

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
          <tbody>{showAll ? rows : rows.slice(0, limit)}</tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="flex justify-center pt-4">
          <button
            onClick={() => setShowAll(s => !s)}
            className="text-[12.5px] font-medium px-4 py-2 rounded-full border transition-colors hover:border-[var(--orange)]"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-soft)' }}>
            {showAll ? 'Show fewer' : `Show all ${rows.length} ${noun}`}
          </button>
        </div>
      )}
    </>
  )
}

function Cell({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <td className="py-3.5 px-4 text-right font-mono whitespace-nowrap" style={{ color: color ?? 'var(--ink-soft)' }}>
      {children}
    </td>
  )
}

/* ── Trend chart ─────────────────────────────────────────────────────────── */

/** Bars for volume (left scale) with a line for the response metric (right scale). */
function TrendChart({
  points,
  barLabel,
  lineLabel,
}: {
  points: { date: string; bar: number; line: number }[]
  barLabel: string
  lineLabel: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  if (points.every(p => p.bar === 0 && p.line === 0)) return <Empty>No activity in the last {TREND_DAYS} days</Empty>

  const W = 720
  const H = 200
  const pad = { t: 10, b: 24 }
  const maxBar = Math.max(...points.map(p => p.bar), 1)
  const maxLine = Math.max(...points.map(p => p.line), 1)
  const slot = W / points.length
  const y = (v: number, max: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  const line = points.map((p, i) => `${(i * slot + slot / 2).toFixed(1)},${y(p.line, maxLine).toFixed(1)}`).join(' ')
  const active = hover !== null ? points[hover] : null
  const label = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })

  return (
    <div>
      <div className="flex flex-wrap items-center gap-5 mb-3 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        <span className="flex items-center gap-2">
          <span className="w-3 h-2.5 rounded-sm" style={{ background: 'rgba(13,27,46,0.18)' }} />
          {barLabel}
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-[2px] rounded-full" style={{ background: 'var(--orange)' }} />
          {lineLabel}
        </span>
        <span className="ml-auto font-mono text-[11.5px]" style={{ color: 'var(--ink-soft)' }}>
          {active
            ? `${label(active.date)} · ${active.bar.toLocaleString()} ${barLabel.toLowerCase()} · ${active.line.toLocaleString()} ${lineLabel.toLowerCase()}`
            : `Last ${TREND_DAYS} days`}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[200px]" preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1="0" x2={W} y1={pad.t + (H - pad.t - pad.b) * f} y2={pad.t + (H - pad.t - pad.b) * f} stroke="var(--line)" strokeWidth="1" />
        ))}
        {points.map((p, i) => (
          <rect
            key={p.date}
            x={i * slot + slot * 0.18}
            width={slot * 0.64}
            y={y(p.bar, maxBar)}
            height={Math.max(H - pad.b - y(p.bar, maxBar), 0)}
            rx="2"
            fill={hover === i ? 'rgba(13,27,46,0.32)' : 'rgba(13,27,46,0.16)'}
          />
        ))}
        <polyline points={line} fill="none" stroke="var(--orange)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <rect key={`h${p.date}`} x={i * slot} width={slot} y="0" height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        <line x1="0" x2={W} y1={H - pad.b} y2={H - pad.b} stroke="var(--line-strong)" strokeWidth="1" />
      </svg>
      <div className="flex justify-between text-[11px] mt-1 font-mono" style={{ color: 'var(--ink-muted)' }}>
        <span>{label(points[0].date)}</span>
        <span>{label(points[Math.floor(points.length / 2)].date)}</span>
        <span>{label(points[points.length - 1].date)}</span>
      </div>
    </div>
  )
}

/* ── Email KPI rows (shared by workspace and admin overview) ─────────────── */

interface EmailTotals {
  totalSent: number
  totalContacted: number
  totalReplies: number
  totalPositiveReplies: number
  totalBounces: number
  totalPipeline: number
}

function emailKpis(t: EmailTotals, daily: DailyPoint[]) {
  const series = lastDays(daily, TREND_DAYS, date => ({ date, sent: 0, replies: 0, positive: 0 }))
  const rRate = replyRate(t.totalSent, t.totalReplies)
  const pRate = positiveRate(t.totalReplies, t.totalPositiveReplies)
  const bRate = bounceRate(t.totalSent, t.totalBounces)
  const ratio = emailsPerLead(t.totalSent, t.totalPositiveReplies)

  const primary: Kpi[] = [
    {
      label: 'Emails sent',
      value: compact(t.totalSent),
      exact: t.totalSent.toLocaleString(),
      sub: `${compact(t.totalContacted)} unique prospects`,
      spark: series.map(d => d.sent),
      sparkColor: 'var(--navy)',
    },
    {
      label: 'Prospects',
      value: compact(t.totalContacted),
      exact: t.totalContacted.toLocaleString(),
      sub: 'Unique contacts',
    },
    {
      label: 'Replies',
      value: compact(t.totalReplies),
      exact: t.totalReplies.toLocaleString(),
      sub: 'Human replies',
      spark: series.map(d => d.replies),
    },
    {
      label: 'Positive',
      value: compact(t.totalPositiveReplies),
      sub: t.totalPipeline > 0 ? `$${t.totalPipeline.toLocaleString()} pipeline` : 'Interested leads',
      spark: series.map(d => d.positive),
      sparkColor: 'var(--green-ink)',
      valueColor: 'var(--green-ink)',
      badge: true,
    },
  ]

  const rates: Kpi[] = [
    {
      label: 'Reply rate',
      value: pct(rRate),
      chip: `${compact(t.totalReplies)}/${compact(t.totalSent)}`,
      bar: { pct: rRate * 10, color: 'var(--navy)' },
    },
    {
      label: 'Positive rate',
      value: pct(pRate),
      chip: `${compact(t.totalPositiveReplies)}/${compact(t.totalReplies)}`,
      bar: { pct: pRate, color: 'var(--green-ink)' },
    },
    {
      label: 'Email : lead ratio',
      value: ratio === undefined ? '—' : `${ratio.toLocaleString()}:1`,
      chip: `${compact(t.totalSent)}/${compact(t.totalPositiveReplies)}`,
      sub: 'Emails sent per positive reply',
      tone: 'highlight',
    },
    {
      label: 'Bounce rate',
      value: pct(bRate),
      chip: `${compact(t.totalBounces)}/${compact(t.totalSent)}`,
      bar: { pct: bRate * 10, color: bRate > 5 ? 'var(--amber-ink)' : 'var(--navy)' },
      valueColor: bRate > 5 ? 'var(--amber-ink)' : undefined,
    },
  ]

  const trend = series.map(d => ({ date: d.date, bar: d.sent, line: d.replies }))
  return { primary, rates, trend }
}

/* ── Admin: every client, every campaign ─────────────────────────────────── */

function AdminOverview({ overview, onOpenClient }: { overview: OverviewData; onOpenClient: (id: string) => void }) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const { primary, rates, trend } = emailKpis(overview, overview.daily)
  const failed = overview.clients.filter(c => c.error)

  const campaigns = filter === 'all' ? overview.campaigns : overview.campaigns.filter(c => c.status === filter)

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Agency overview"
        title="All clients"
        subtitle={`Live outbound performance across ${overview.clients.length} client workspaces.`}
        badges={failed.length > 0 ? <CountChip>{failed.length} failing to sync</CountChip> : undefined}
      />

      <KpiRow items={primary} cols="grid-cols-2 xl:grid-cols-4" />
      <KpiRow items={rates} cols="grid-cols-2 xl:grid-cols-4" />

      <Panel title="Sending trend" subtitle="Emails sent and replies per day, all clients" className="mt-5 mb-5">
        <TrendChart points={trend} barLabel="Sent" lineLabel="Replies" />
      </Panel>

      <Panel
        title="Clients"
        subtitle="Open a workspace to see its campaigns, LinkedIn and inboxes."
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
        subtitle="Grouped by client, each in the same order as its sending platform."
        right={<FilterToggle value={filter} onChange={setFilter} options={statusOptions(overview.campaigns.map(c => c.status))} />}>
        {campaigns.length === 0 ? (
          <Empty>No campaigns match this filter</Empty>
        ) : (
          <EmailCampaignTable key={filter} campaigns={campaigns} showClient />
        )}
      </Panel>
    </div>
  )
}

function ClientCard({ client, onOpen }: { client: ClientRollup; onOpen: () => void }) {
  const rate = replyRate(client.totalSent, client.totalReplies)
  const ratio = emailsPerLead(client.totalSent, client.totalPositiveReplies)

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
          <div className="mt-0.5 flex gap-1.5">
            <SourceBadge>{PROVIDER_LABEL[client.provider]}</SourceBadge>
            {client.linkedin && <SourceBadge>LinkedIn</SourceBadge>}
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
          Email sync failed: {client.error}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <BigMetric label="Reply rate" value={pct(rate)} />
            <BigMetric label="Positive" value={client.totalPositiveReplies.toLocaleString()} color="var(--green-ink)" />
            <BigMetric label="Email:lead" value={ratio === undefined ? '—' : `${ratio}:1`} />
          </div>
          <div className="grid grid-cols-4 gap-2 pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
            <Metric label="Sent" value={compact(client.totalSent)} />
            <Metric label="Bounce" value={pct(bounceRate(client.totalSent, client.totalBounces))} />
            <Metric label="Active" value={String(client.activeCampaigns)} />
            <Metric label="Warmup" value={client.avgWarmup === undefined ? '—' : String(client.avgWarmup)} />
          </div>
        </>
      )}

      {client.linkedin && (
        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
          <Metric label="LI connects" value={compact(client.linkedin.connectionsSent)} />
          <Metric label="LI replies" value={compact(client.linkedin.replies)} />
          <Metric label="LI interested" value={compact(client.linkedin.interested)} />
        </div>
      )}
    </button>
  )
}

function BigMetric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase font-medium" style={{ color: 'var(--ink-muted)', letterSpacing: '0.8px' }}>
        {label}
      </div>
      <div className="font-display tabular text-[22px] font-semibold leading-tight truncate" style={{ color: color ?? 'var(--ink)' }}>
        {value}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase font-medium mb-0.5 truncate" style={{ color: 'var(--ink-muted)', letterSpacing: '0.8px' }}>
        {label}
      </div>
      <div className="text-[13.5px] font-mono font-medium truncate" style={{ color: 'var(--ink)' }}>
        {value}
      </div>
    </div>
  )
}

/* ── Email campaigns table ───────────────────────────────────────────────── */

type EmailRow = CampaignAnalytics & { status: CampaignStatus; clientName?: string; clientId?: string }

function EmailCampaignTable({
  campaigns,
  showClient = false,
  limit,
}: {
  campaigns: EmailRow[]
  showClient?: boolean
  limit?: number
}) {
  const headers = [
    ...(showClient ? ['Client'] : []),
    'Campaign',
    'Status',
    'Prospects',
    'Sent',
    'Replies',
    'Reply %',
    'Positive',
    'Email:lead',
  ]

  return (
    <TableFrame
      headers={headers}
      leftAligned={['Client', 'Campaign']}
      limit={limit}
      rows={campaigns.map(c => {
        const ratio = emailsPerLead(c.sent, c.positiveReplies)
        return (
          <tr key={`${c.clientId ?? ''}:${c.campaignId}`} className="row-hover border-t" style={{ borderColor: 'var(--line)' }}>
            {showClient && (
              <td className="py-3.5 px-4 whitespace-nowrap font-medium" style={{ color: 'var(--ink)' }}>
                {c.clientName}
              </td>
            )}
            <td className="py-3.5 px-4 max-w-[320px]">
              <div className="truncate font-medium" style={{ color: showClient ? 'var(--ink-soft)' : 'var(--ink)' }}>
                {c.campaignName}
              </div>
            </td>
            <td className="py-3.5 px-4 text-right">
              <StatusPill status={c.status} />
            </td>
            <Cell>{c.contacted.toLocaleString()}</Cell>
            <Cell>{c.sent.toLocaleString()}</Cell>
            <Cell>{c.replies.toLocaleString()}</Cell>
            <Cell color="var(--ink)">{pct(replyRate(c.sent, c.replies))}</Cell>
            <Cell color={c.positiveReplies > 0 ? 'var(--green-ink)' : 'var(--ink-muted)'}>
              {c.positiveReplies.toLocaleString()}
              {c.opportunityValue > 0 && (
                <span className="ml-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  ${compact(c.opportunityValue)}
                </span>
              )}
            </Cell>
            <Cell color={ratio === undefined ? 'var(--ink-muted)' : 'var(--ink)'}>
              {ratio === undefined ? '—' : `${ratio}:1`}
            </Cell>
          </tr>
        )
      })}
    />
  )
}

/* ── Single client workspace ─────────────────────────────────────────────── */

function withStatus(data: DashboardData): EmailRow[] {
  const status = new Map(data.campaigns.map(c => [c.id, c.status]))
  return data.analytics.map(a => ({ ...a, status: status.get(a.campaignId) ?? 'error' }))
}

function Workspace({ data, view, onView }: { data: DashboardData; view: View; onView: (v: View) => void }) {
  // Each page names only the platform its numbers come from.
  const showEmail = view !== 'linkedin'
  const showLinkedIn = view === 'linkedin' || (view === 'overview' && Boolean(data.linkedin || data.linkedinError))
  const badges = (
    <div className="flex gap-1.5">
      {showEmail && <SourceBadge>{PROVIDER_LABEL[data.provider]}</SourceBadge>}
      {showLinkedIn && <SourceBadge>HeyReach</SourceBadge>}
    </div>
  )

  if (view === 'email') return <EmailView data={data} badges={badges} />
  if (view === 'linkedin') return <LinkedInView data={data} badges={badges} />
  if (view === 'inboxes') return <InboxesView data={data} badges={badges} />
  return <OverviewView data={data} badges={badges} onView={onView} />
}

function OverviewView({ data, badges, onView }: { data: DashboardData; badges: React.ReactNode; onView: (v: View) => void }) {
  const { primary, rates, trend } = emailKpis(data, data.daily)
  const rows = withStatus(data)
  const active = rows.filter(r => r.status === 'active')

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Workspace overview"
        title={data.clientName}
        subtitle={`Everything we ran for you, live from ${PROVIDER_LABEL[data.provider]}${data.linkedin ? ' and HeyReach' : ''}.`}
        badges={badges}
      />

      <KpiRow items={primary} cols="grid-cols-2 xl:grid-cols-4" />
      <KpiRow items={rates} cols="grid-cols-2 xl:grid-cols-4" />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mt-5 mb-5">
        <Panel title="Sending trend" subtitle="Emails sent and replies per day" className="xl:col-span-2">
          <TrendChart points={trend} barLabel="Sent" lineLabel="Replies" />
        </Panel>

        {data.linkedin ? (
          <LinkedInSummary linkedin={data.linkedin} onOpen={() => onView('linkedin')} />
        ) : (
          <InboxSummary data={data} onOpen={() => onView('inboxes')} />
        )}
      </div>

      {data.linkedinError && <InlineError>LinkedIn (HeyReach) failed to sync: {data.linkedinError}</InlineError>}

      <Panel
        title={active.length > 0 ? 'Active campaigns' : 'Campaigns'}
        subtitle={`In the same order as ${PROVIDER_LABEL[data.provider]}.`}
        right={<TextButton onClick={() => onView('email')}>All {rows.length} campaigns</TextButton>}>
        {rows.length === 0 ? (
          <Empty>No campaigns yet</Empty>
        ) : (
          <EmailCampaignTable campaigns={active.length > 0 ? active : rows} limit={8} />
        )}
      </Panel>
    </div>
  )
}

function EmailView({ data, badges }: { data: DashboardData; badges: React.ReactNode }) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const rows = withStatus(data)
  const shown = filter === 'all' ? rows : rows.filter(r => r.status === filter)
  const { rates } = emailKpis(data, data.daily)

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Email campaigns"
        title={data.clientName}
        subtitle={`${data.activeCampaigns} active of ${rows.length} campaigns, in the same order as ${PROVIDER_LABEL[data.provider]}.`}
        badges={badges}
      />
      <KpiRow items={rates} cols="grid-cols-2 xl:grid-cols-4" />
      <Panel
        title="Campaigns"
        className="mt-5"
        right={<FilterToggle value={filter} onChange={setFilter} options={statusOptions(rows.map(r => r.status))} />}>
        {shown.length === 0 ? <Empty>No campaigns match this filter</Empty> : <EmailCampaignTable key={filter} campaigns={shown} />}
      </Panel>
    </div>
  )
}

/* ── LinkedIn (HeyReach) ─────────────────────────────────────────────────── */

function linkedinSeries(daily: LinkedInDailyPoint[]) {
  return lastDays(daily, TREND_DAYS, date => ({ date, connectionsSent: 0, connectionsAccepted: 0, replies: 0 }))
}

function LinkedInSummary({ linkedin, onOpen }: { linkedin: LinkedInData; onOpen: () => void }) {
  const t = linkedin.totals
  const series = linkedinSeries(linkedin.daily)
  return (
    <Panel title="LinkedIn" subtitle="HeyReach outreach, all time" right={<TextButton onClick={onOpen}>Open</TextButton>}>
      <div className="grid grid-cols-2 gap-4">
        <MiniStat label="Connections sent" value={compact(t.connectionsSent)} spark={series.map(d => d.connectionsSent)} />
        <MiniStat label="Accepted" value={pct(acceptanceRate(t.connectionsSent, t.connectionsAccepted))} sub={`${t.connectionsAccepted} people`} />
        <MiniStat label="Replies" value={compact(t.replies)} spark={series.map(d => d.replies)} />
        <MiniStat label="Interested" value={compact(t.interested)} color="var(--green-ink)" />
      </div>
      <div className="mt-4 pt-4 border-t text-[12px] flex items-center justify-between" style={{ borderColor: 'var(--line)', color: 'var(--ink-muted)' }}>
        <span>
          {linkedin.campaigns.filter(c => c.status === 'active').length} active of {linkedin.campaigns.length} campaigns
        </span>
        <span>
          {linkedin.senders.length} sender{linkedin.senders.length !== 1 ? 's' : ''}
        </span>
      </div>
    </Panel>
  )
}

function MiniStat({ label, value, sub, spark, color }: { label: string; value: string; sub?: string; spark?: number[]; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase font-medium mb-1" style={{ color: 'var(--ink-muted)', letterSpacing: '1px' }}>
        {label}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="font-display tabular text-[22px] font-semibold leading-none" style={{ color: color ?? 'var(--ink)' }}>
          {value}
        </div>
        {spark && <Sparkline values={spark} />}
      </div>
      {sub && (
        <div className="text-[11.5px] mt-1" style={{ color: 'var(--ink-muted)' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function LinkedInView({ data, badges }: { data: DashboardData; badges: React.ReactNode }) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const li = data.linkedin

  if (!li) {
    return (
      <div className="animate-fade-in">
        <PageHeader eyebrow="LinkedIn" title={data.clientName} subtitle="LinkedIn outreach via HeyReach." badges={badges} />
        <InlineError>{data.linkedinError ? `HeyReach failed to sync: ${data.linkedinError}` : 'HeyReach is not connected for this client.'}</InlineError>
      </div>
    )
  }

  const t = li.totals
  const series = linkedinSeries(li.daily)
  const accRate = acceptanceRate(t.connectionsSent, t.connectionsAccepted)
  const msgReply = replyRate(t.messagesSent, t.replies)
  const posRate = positiveRate(t.replies, t.interested)
  const shown = filter === 'all' ? li.campaigns : li.campaigns.filter(c => c.status === filter)

  const primary: Kpi[] = [
    { label: 'Connections sent', value: compact(t.connectionsSent), sub: `${compact(t.leadsContacted)} leads contacted`, spark: series.map(d => d.connectionsSent), sparkColor: 'var(--navy)' },
    { label: 'Accepted', value: compact(t.connectionsAccepted), sub: 'New connections', spark: series.map(d => d.connectionsAccepted) },
    { label: 'Replies', value: compact(t.replies), sub: `${compact(t.messagesSent)} messages sent`, spark: series.map(d => d.replies) },
    { label: 'Interested', value: compact(t.interested), sub: 'Auto-tagged by HeyReach', valueColor: 'var(--green-ink)' },
  ]
  const rates: Kpi[] = [
    { label: 'Acceptance rate', value: pct(accRate), chip: `${t.connectionsAccepted}/${t.connectionsSent}`, bar: { pct: accRate, color: 'var(--navy)' } },
    { label: 'Message reply rate', value: pct(msgReply), chip: `${t.replies}/${t.messagesSent}`, bar: { pct: msgReply, color: 'var(--orange)' } },
    { label: 'Positive rate', value: pct(posRate), chip: `${t.interested}/${t.replies}`, bar: { pct: posRate, color: 'var(--green-ink)' } },
    { label: 'Profile views', value: compact(t.profileViews), sub: 'Warm-up touches' },
  ]

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="LinkedIn"
        title={data.clientName}
        subtitle={`LinkedIn outreach via HeyReach by ${li.senders.map(s => s.name).join(', ') || 'no senders'}.`}
        badges={badges}
      />

      <KpiRow items={primary} cols="grid-cols-2 xl:grid-cols-4" />
      <KpiRow items={rates} cols="grid-cols-2 xl:grid-cols-4" />

      <Panel title="Activity trend" subtitle="Connection requests and replies per day" className="mt-5 mb-5">
        <TrendChart
          points={series.map(d => ({ date: d.date, bar: d.connectionsSent, line: d.replies }))}
          barLabel="Connections"
          lineLabel="Replies"
        />
      </Panel>

      <Panel
        title="LinkedIn campaigns"
        subtitle="In the same order as HeyReach."
        right={<FilterToggle value={filter} onChange={setFilter} options={statusOptions(li.campaigns.map(c => c.status))} />}>
        {shown.length === 0 ? (
          <Empty>No campaigns match this filter</Empty>
        ) : (
          <TableFrame
            key={filter}
            headers={['Campaign', 'Status', 'Leads', 'Connections', 'Accepted', 'Accept %', 'Messages', 'Replies', 'Interested']}
            leftAligned={['Campaign']}
            rows={shown.map(c => (
              <tr key={c.id} className="row-hover border-t" style={{ borderColor: 'var(--line)' }}>
                <td className="py-3.5 px-4 max-w-[320px]">
                  <div className="truncate font-medium" style={{ color: 'var(--ink)' }}>
                    {c.name}
                  </div>
                </td>
                <td className="py-3.5 px-4 text-right">
                  <StatusPill status={c.status} />
                </td>
                <Cell>{c.leads.toLocaleString()}</Cell>
                <Cell>{c.connectionsSent.toLocaleString()}</Cell>
                <Cell>{c.connectionsAccepted.toLocaleString()}</Cell>
                <Cell color="var(--ink)">{pct(acceptanceRate(c.connectionsSent, c.connectionsAccepted))}</Cell>
                <Cell>{c.messagesSent.toLocaleString()}</Cell>
                <Cell>{c.replies.toLocaleString()}</Cell>
                <Cell color={c.interested > 0 ? 'var(--green-ink)' : 'var(--ink-muted)'}>{c.interested.toLocaleString()}</Cell>
              </tr>
            ))}
          />
        )}
      </Panel>
    </div>
  )
}

/* ── Sending inboxes ─────────────────────────────────────────────────────── */

function InboxSummary({ data, onOpen }: { data: DashboardData; onOpen: () => void }) {
  const avg = averageWarmupScore(data.accounts)
  const low = data.accounts.filter(a => a.warmupScore !== undefined && a.warmupScore < WARMUP_THRESHOLD).length
  return (
    <Panel title="Sending inboxes" subtitle={`${data.accounts.length} accounts`} right={<TextButton onClick={onOpen}>Open</TextButton>}>
      <div className="grid grid-cols-2 gap-4">
        <MiniStat label={data.provider === 'smartlead' ? 'Avg placement' : 'Avg warmup'} value={avg === undefined ? '—' : `${avg}`} sub="out of 100" />
        <MiniStat label="Below threshold" value={String(low)} color={low > 0 ? 'var(--amber-ink)' : 'var(--green-ink)'} sub={`under ${WARMUP_THRESHOLD}`} />
        <MiniStat label="Unread" value={data.unreadCount === undefined ? '—' : String(data.unreadCount)} sub="Awaiting reply" />
        <MiniStat label="Active campaigns" value={String(data.activeCampaigns)} />
      </div>
    </Panel>
  )
}

function InboxesView({ data, badges }: { data: DashboardData; badges: React.ReactNode }) {
  const avg = averageWarmupScore(data.accounts)
  const low = data.accounts.filter(a => a.warmupScore !== undefined && a.warmupScore < WARMUP_THRESHOLD)
  const scoreLabel = data.provider === 'smartlead' ? 'Inbox placement' : 'Warmup score'

  const kpis: Kpi[] = [
    { label: 'Sending accounts', value: String(data.accounts.length), sub: PROVIDER_LABEL[data.provider] },
    { label: `Avg ${scoreLabel.toLowerCase()}`, value: avg === undefined ? '—' : `${avg}/100`, bar: avg === undefined ? undefined : { pct: avg, color: 'var(--navy)' } },
    { label: 'Below threshold', value: String(low.length), sub: `Under ${WARMUP_THRESHOLD}`, valueColor: low.length > 0 ? 'var(--amber-ink)' : 'var(--green-ink)' },
    { label: 'Unread emails', value: data.unreadCount === undefined ? '—' : String(data.unreadCount), sub: data.unreadCount === undefined ? 'Not reported' : 'Awaiting reply' },
  ]

  // Weakest inboxes first, so problems surface at the top.
  const accounts = [...data.accounts].sort((a, b) => (a.warmupScore ?? 101) - (b.warmupScore ?? 101))

  return (
    <div className="animate-fade-in">
      <PageHeader eyebrow="Sending inboxes" title={data.clientName} subtitle={`${scoreLabel} for every sending account, weakest first.`} badges={badges} />
      <KpiRow items={kpis} cols="grid-cols-2 xl:grid-cols-4" />
      <Panel title="Accounts" className="mt-5" right={<CountChip>{data.accounts.length}</CountChip>}>
        {accounts.length === 0 ? (
          <Empty>No accounts found</Empty>
        ) : (
          <TableFrame
            headers={['Account', 'Health', scoreLabel]}
            leftAligned={['Account', 'Health']}
            noun="accounts"
            limit={20}
            rows={accounts.map(a => <AccountRow key={a.email} account={a} />)}
          />
        )}
      </Panel>
    </div>
  )
}

function AccountRow({ account }: { account: EmailAccount }) {
  const score = account.warmupScore
  const warn = score !== undefined && score < WARMUP_THRESHOLD
  return (
    <tr className="row-hover border-t" style={{ borderColor: 'var(--line)' }}>
      <td className="py-3 px-4 font-mono text-[12.5px] max-w-[360px]">
        <div className="truncate" style={{ color: 'var(--ink)' }}>
          {account.email}
        </div>
      </td>
      <td className="py-3 px-4 text-[12px] whitespace-nowrap" style={{ color: score === undefined ? 'var(--ink-muted)' : warn ? 'var(--amber-ink)' : 'var(--green-ink)' }}>
        {score === undefined ? 'No data' : warn ? 'Below threshold' : 'Healthy'}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center justify-end gap-3">
          <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-sunken)' }}>
            <div className="h-full rounded-full" style={{ width: `${score ?? 0}%`, background: warn ? 'var(--amber-ink)' : 'var(--navy)' }} />
          </div>
          <span className="font-mono text-[13px] font-medium w-8 text-right" style={{ color: warn ? 'var(--amber-ink)' : 'var(--ink)' }}>
            {score ?? '—'}
          </span>
        </div>
      </td>
    </tr>
  )
}

/* ── States ──────────────────────────────────────────────────────────────── */

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

function InlineError({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 px-4 py-3 rounded-xl text-[13px]" style={{ background: 'var(--red-wash)', color: 'var(--red-ink)' }}>
      {children}
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

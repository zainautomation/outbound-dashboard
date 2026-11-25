'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
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
  PositiveThread,
  ProviderId,
  RepliesData,
  Session,
} from '@/lib/types'

const SYNC_SECONDS = 30
const TREND_DAYS = 30

/** Sentinel for the admin's cross-client view. */
const ALL_CLIENTS = ''

type View = 'overview' | 'activity' | 'email' | 'linkedin' | 'inboxes'
const VIEWS: View[] = ['overview', 'activity', 'email', 'linkedin', 'inboxes']

/** The current screen lives in the URL hash (#/clientId/view) so a refresh lands on the same page. */
function readRoute(): { client: string; view: View } {
  const [, client = '', view = 'overview'] = (typeof window === 'undefined' ? '' : window.location.hash).split('/')
  return {
    client: client === 'all' ? ALL_CLIENTS : decodeURIComponent(client),
    view: (VIEWS as string[]).includes(view) ? (view as View) : 'overview',
  }
}

function writeRoute(client: string, view: View) {
  const hash = `#/${client === ALL_CLIENTS ? 'all' : encodeURIComponent(client)}/${view}`
  if (window.location.hash !== hash) window.history.replaceState(null, '', hash)
}

export default function Home() {
  // 'checking' until the session cookie has been looked up, so a refresh never flashes the login page.
  const [session, setSession] = useState<Session | null | 'checking'>('checking')
  const [selectedClient, setSelectedClient] = useState(ALL_CLIENTS)
  const [view, setView] = useState<View>('overview')
  /** Every workspace fetched this session — switching back is instant while a refresh runs. */
  const [workspaces, setWorkspaces] = useState<Record<string, DashboardData>>({})
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [repliesOpen, setRepliesOpen] = useState(false)
  const [repliesClient, setRepliesClient] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  const [authUser, setAuthUser] = useState('')
  const [authPass, setAuthPass] = useState('')
  const [authError, setAuthError] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  const signedIn = session !== null && session !== 'checking' ? session : null
  const isOverview = signedIn?.role === 'admin' && selectedClient === ALL_CLIENTS
  const data = workspaces[selectedClient] ?? null

  /** Lands a session on the route in the URL, or its natural home page. */
  const enter = useCallback((auth: Session) => {
    const route = readRoute()
    const allowed = auth.role === 'admin' ? [ALL_CLIENTS, ...auth.clients.map(c => c.id)] : [auth.clientId]
    const client = allowed.includes(route.client) ? route.client : auth.role === 'user' ? auth.clientId : ALL_CLIENTS
    setSession(auth)
    setSelectedClient(client)
    setView(client === ALL_CLIENTS ? 'overview' : route.view)
  }, [])

  // Restore the session from its cookie on page load.
  useEffect(() => {
    fetch('/api/auth')
      .then(res => (res.ok ? res.json() : null))
      .then(auth => (auth ? enter(auth) : setSession(null)))
      .catch(() => setSession(null))
  }, [enter])

  useEffect(() => {
    if (signedIn) writeRoute(selectedClient, view)
  }, [signedIn, selectedClient, view])

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
      setAuthPass('')
      enter(await res.json())
    } finally {
      setSigningIn(false)
    }
  }

  function logout() {
    clearInterval(intervalRef.current)
    fetch('/api/auth', { method: 'DELETE' }).catch(() => {})
    window.history.replaceState(null, '', window.location.pathname)
    setSession(null)
    setWorkspaces({})
    setOverview(null)
    setSelectedClient(ALL_CLIENTS)
    setView('overview')
    setRepliesOpen(false)
  }

  function selectClient(id: string) {
    setSelectedClient(id)
    setView(v => (id === ALL_CLIENTS ? 'overview' : v))
    setError('')
    setRepliesOpen(false)
  }

  const sync = useCallback(async (clientId: string, sess: Session) => {
    const wantsOverview = sess.role === 'admin' && clientId === ALL_CLIENTS
    setSyncing(true)
    try {
      const res = await fetch(wantsOverview ? '/api/overview' : '/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wantsOverview ? {} : { clientId }),
      })
      if (res.status === 401) {
        // Session expired or credentials changed — back to sign-in.
        setSession(null)
        return
      }
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Sync failed')
      setError('')
      if (wantsOverview) setOverview(json)
      else
        setWorkspaces(prev => {
          // A LinkedIn hiccup on one refresh shouldn't wipe LinkedIn data already on screen.
          const next = json as DashboardData
          const old = prev[clientId]
          const merged =
            next.linkedinError && old?.linkedin ? { ...next, linkedin: old.linkedin, linkedinError: undefined } : next
          return { ...prev, [clientId]: merged }
        })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    if (!signedIn) return
    if (signedIn.role === 'user' && !selectedClient) return

    sync(selectedClient, signedIn)
    // Auto-refresh quietly in the background.
    intervalRef.current = setInterval(() => sync(selectedClient, signedIn), SYNC_SECONDS * 1000)
    return () => clearInterval(intervalRef.current)
  }, [selectedClient, signedIn, sync])

  if (session === 'checking') return <BootScreen />

  if (!signedIn) {
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

  const clients: ClientSummary[] = signedIn.role === 'admin' ? signedIn.clients : [signedIn.client]
  const current = clients.find(c => c.id === selectedClient)
  const hasLinkedIn = Boolean(current?.hasLinkedIn)
  const activeView: View = view === 'linkedin' && !hasLinkedIn ? 'overview' : view
  const loaded = isOverview ? overview : data
  const navProps: NavProps = {
    session: signedIn,
    clients,
    selectedClient,
    onSelectClient: selectClient,
    view: activeView,
    onView: setView,
    hasLinkedIn,
    onLogout: logout,
    onOpenReplies: () => openReplies(),
  }

  /** Opens the replies panel on the current workspace; from All clients, on the busiest healthy one. */
  function openReplies() {
    const busiest = overview?.clients
      .filter(c => !c.error)
      .sort(
        (a, b) =>
          b.totalPositiveReplies + (b.linkedin?.interested ?? 0) - (a.totalPositiveReplies + (a.linkedin?.interested ?? 0)),
      )[0]?.clientId
    setRepliesClient(current?.id ?? busiest ?? clients[0]?.id ?? '')
    setRepliesOpen(true)
  }
  const repliesTarget = clients.find(c => c.id === repliesClient) ?? current ?? clients[0]

  return (
    <RepliesAction.Provider value={openReplies}>
    <div className="min-h-screen flex" style={{ background: 'var(--pearl)' }}>
      <TopProgress active={syncing} />
      <Sidebar {...navProps} />

      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav {...navProps} />

        <main className="flex-1 w-full max-w-[1320px] mx-auto px-4 sm:px-8 py-7 sm:py-9">
          {error && !loaded ? (
            <ErrorState message={error} onRetry={() => sync(selectedClient, signedIn)} />
          ) : isOverview && overview ? (
            <div key="overview" className="animate-fade-in">
              <AdminOverview overview={overview} onOpenClient={selectClient} />
            </div>
          ) : !isOverview && data ? (
            <div key={`${selectedClient}:${activeView}`} className="animate-fade-in">
              <Workspace data={data} view={activeView} onView={setView} onOpenReplies={openReplies} />
            </div>
          ) : (
            <SkeletonPage />
          )}
        </main>
      </div>

      {repliesTarget && (
        <RepliesDrawer
          open={repliesOpen}
          onClose={() => setRepliesOpen(false)}
          client={repliesTarget}
          // From All clients the panel can switch between workspaces.
          clients={isOverview ? clients : undefined}
          onClientChange={setRepliesClient}
        />
      )}
    </div>
    </RepliesAction.Provider>
  )
}

/** Lets any page header open the positive-replies panel without prop drilling. */
const RepliesAction = createContext<(() => void) | null>(null)

/** Thin orange bar along the top while a refresh is in flight. */
function TopProgress({ active }: { active: boolean }) {
  return (
    <div
      className="fixed top-0 left-0 right-0 h-[2px] z-[60] pointer-events-none overflow-hidden transition-opacity duration-300"
      style={{ opacity: active ? 1 : 0 }}>
      <div className="h-full progress-indeterminate" style={{ background: 'var(--orange)' }} />
    </div>
  )
}

function BootScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--navy)' }}>
      <div className="animate-pulse-soft">
        <Logo height={28} tone="light" />
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
const ICONS: Record<View | 'clients' | 'logout' | 'replies', string> = {
  overview: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  replies: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z',
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
  /** Opens the positive-replies panel; undefined on the all-clients view. */
  onOpenReplies?: () => void
}

function workspaceViews(hasLinkedIn: boolean): { id: View; label: string }[] {
  return [
    { id: 'overview', label: 'Overview' },
    { id: 'activity', label: 'Daily activity' },
    { id: 'email', label: 'Email campaigns' },
    ...(hasLinkedIn ? [{ id: 'linkedin' as View, label: 'LinkedIn' }] : []),
    { id: 'inboxes', label: 'Sending inboxes' },
  ]
}

function Sidebar({ session, clients, selectedClient, onSelectClient, view, onView, hasLinkedIn, onLogout, onOpenReplies }: NavProps) {
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
            {onOpenReplies && (
              <>
                <NavLabel>Conversations</NavLabel>
                <NavItem active={false} onClick={onOpenReplies} icon="replies">
                  Positive replies
                </NavItem>
              </>
            )}
          </>
        ) : (
          <>
            <NavLabel>Agency</NavLabel>
            <NavItem active onClick={() => onSelectClient(ALL_CLIENTS)} icon="clients">
              All clients overview
            </NavItem>
            {onOpenReplies && (
              <>
                <NavLabel>Conversations</NavLabel>
                <NavItem active={false} onClick={onOpenReplies} icon="replies">
                  Positive replies
                </NavItem>
              </>
            )}
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
                  className="press w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-[13.5px] text-left hover:bg-white/[0.07]"
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
      className="press relative w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] hover:bg-white/5 text-left"
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

function MobileNav({ session, clients, selectedClient, onSelectClient, view, onView, hasLinkedIn, onLogout, onOpenReplies }: NavProps) {
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
      {(current || onOpenReplies) && (
        <div className="flex gap-1 px-3 overflow-x-auto pb-2">
          {(current ? workspaceViews(hasLinkedIn) : []).map(v => (
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
          {onOpenReplies && (
            <button
              onClick={onOpenReplies}
              className="whitespace-nowrap text-[12.5px] px-3 py-1.5 rounded-full border press"
              style={{ borderColor: 'var(--orange)', color: '#fff' }}>
              Positive replies
            </button>
          )}
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
              className="btn-orange press w-full mt-2 py-3.5 rounded-full text-[15px] font-medium inline-flex items-center justify-center gap-2 disabled:opacity-70">
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
  const openReplies = useContext(RepliesAction)
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
        {openReplies && (
          <button
            onClick={openReplies}
            className="btn-orange press ml-auto inline-flex items-center gap-2 pl-3.5 pr-4 py-2.5 rounded-full text-[13.5px] font-medium shadow-[0_6px_18px_rgba(242,101,34,0.28)]">
            <Icon name="replies" size={16} />
            Positive replies
          </button>
        )}
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
      className="press inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full border hover:border-[var(--orange)]"
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
          className="press text-[12px] font-medium px-3 py-1 rounded-full whitespace-nowrap"
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
            className="press text-[12.5px] font-medium px-4 py-2 rounded-full border hover:border-[var(--orange)]"
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

/* ── Activity chart ──────────────────────────────────────────────────────── */

type Range = 7 | 30 | 90
const RANGES: { id: Range; label: string }[] = [
  { id: 7, label: '7 days' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
]

interface Series {
  key: string
  label: string
  color: string
  /** Bars read on the left scale; lines share the right scale. */
  kind: 'bar' | 'line'
  values: number[]
}

const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en', { ...opts, timeZone: 'UTC' })

function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  const n = v / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}

/** Interactive daily chart: toggleable series, hover crosshair with a value card. */
function ActivityChart({ dates, series, height = 280 }: { dates: string[]; series: Series[]; height?: number }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<number | null>(null)

  const shown = series.filter(s => !hidden.has(s.key))
  const bars = shown.filter(s => s.kind === 'bar')
  const lines = shown.filter(s => s.kind === 'line')
  const empty = series.every(s => s.values.every(v => v === 0))

  const W = 1000
  const H = height
  const pad = { t: 14, b: 8, l: 0, r: 0 }
  const plotH = H - pad.t - pad.b
  const slot = W / Math.max(dates.length, 1)
  const barMax = niceMax(Math.max(0, ...bars.flatMap(s => s.values)))
  const lineMax = niceMax(Math.max(0, ...lines.flatMap(s => s.values)))
  const y = (v: number, max: number) => pad.t + plotH * (1 - v / max)
  const cx = (i: number) => i * slot + slot / 2

  const toggle = (key: string) =>
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else if (series.length - next.size > 1) next.add(key) // keep at least one visible
      return next
    })

  const tickEvery = Math.ceil(dates.length / 7)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {series.map(s => {
          const off = hidden.has(s.key)
          return (
            <button
              key={s.key}
              onClick={() => toggle(s.key)}
              className="press inline-flex items-center gap-2 text-[12px] font-medium pl-2.5 pr-3 py-1.5 rounded-full border transition-all"
              style={{
                borderColor: off ? 'var(--line)' : 'var(--line-strong)',
                color: off ? 'var(--ink-muted)' : 'var(--ink)',
                background: off ? 'transparent' : 'var(--surface)',
                opacity: off ? 0.55 : 1,
              }}>
              <span
                className={s.kind === 'bar' ? 'w-2.5 h-2.5 rounded-[3px]' : 'w-3 h-[3px] rounded-full'}
                style={{ background: s.color }}
              />
              {s.label}
              <span className="font-mono text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {compact(s.values.reduce((a, b) => a + b, 0))}
              </span>
            </button>
          )
        })}
      </div>

      {empty ? (
        <Empty>No activity in this period yet</Empty>
      ) : (
        <div className="relative select-none" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ height: H }} preserveAspectRatio="none">
            <defs>
              {lines.map(s => (
                <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {[0, 0.25, 0.5, 0.75].map(f => (
              <line key={f} x1="0" x2={W} y1={pad.t + plotH * f} y2={pad.t + plotH * f} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            <line x1="0" x2={W} y1={H - pad.b} y2={H - pad.b} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />

            {hover !== null && <rect x={hover * slot} width={slot} y={pad.t} height={plotH} fill="var(--navy-wash)" />}

            {bars.map((s, bi) => {
              const width = (slot * 0.7) / bars.length
              return s.values.map((v, i) => {
                const top = y(v, barMax)
                return (
                  <rect
                    key={`${s.key}${i}`}
                    className="chart-bar"
                    x={i * slot + slot * 0.15 + bi * width}
                    width={Math.max(width, 1)}
                    y={top}
                    height={Math.max(H - pad.b - top, v > 0 ? 1.5 : 0)}
                    rx={Math.min(3, width / 3)}
                    fill={s.color}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                )
              })
            })}

            {lines.map((s, li) => {
              const pts = s.values.map((v, i) => `${cx(i).toFixed(1)},${y(v, lineMax).toFixed(1)}`)
              return (
                <g key={s.key}>
                  {li === 0 && (
                    <polygon
                      points={`${cx(0)},${H - pad.b} ${pts.join(' ')} ${cx(s.values.length - 1)},${H - pad.b}`}
                      fill={`url(#fill-${s.key})`}
                    />
                  )}
                  <polyline
                    points={pts.join(' ')}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="2.25"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )
            })}

            {dates.map((d, i) => (
              <rect key={`hit${d}`} x={i * slot} width={slot} y="0" height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
            ))}
          </svg>

          {/* Line markers in HTML so they stay round under the stretched SVG. */}
          {hover !== null &&
            lines.map(s => (
              <span
                key={`dot${s.key}`}
                className="absolute w-2.5 h-2.5 rounded-full border-2 pointer-events-none"
                style={{
                  left: `calc(${((hover + 0.5) / dates.length) * 100}% - 5px)`,
                  top: y(s.values[hover], lineMax) - 5,
                  background: 'var(--surface)',
                  borderColor: s.color,
                }}
              />
            ))}

          {hover !== null && (
            <div
              className="absolute top-2 z-10 pointer-events-none rounded-xl border px-3.5 py-3 min-w-[170px] animate-pop"
              style={{
                ...CARD_STYLE,
                boxShadow: 'var(--shadow-lift)',
                ...(hover / dates.length > 0.6
                  ? { right: `calc(${(1 - hover / dates.length) * 100}% + 12px)` }
                  : { left: `calc(${((hover + 1) / dates.length) * 100}% + 12px)` }),
              }}>
              <div className="text-[11.5px] font-medium mb-2" style={{ color: 'var(--ink)' }}>
                {dayLabel(dates[hover], { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
              {shown.map(s => (
                <div key={s.key} className="flex items-center justify-between gap-4 text-[12px] py-0.5">
                  <span className="flex items-center gap-2" style={{ color: 'var(--ink-soft)' }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="font-mono font-medium" style={{ color: 'var(--ink)' }}>
                    {s.values[hover].toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="relative h-5 mt-1.5 text-[11px] font-mono" style={{ color: 'var(--ink-muted)' }}>
            {dates.map((d, i) =>
              i % tickEvery === 0 || i === dates.length - 1 ? (
                <span
                  key={d}
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${((i + 0.5) / dates.length) * 100}%`, opacity: i === dates.length - 1 || dates.length - 1 - i >= tickEvery / 2 ? 1 : 0 }}>
                  {dayLabel(d)}
                </span>
              ) : null,
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Daily activity ──────────────────────────────────────────────────────── */

const emptyDay = (date: string): DailyPoint => ({ date, sent: 0, replies: 0, positive: 0 })
const emptyLiDay = (date: string): LinkedInDailyPoint => ({ date, connectionsSent: 0, connectionsAccepted: 0, replies: 0 })

/** Change vs the previous period of the same length, or undefined when there is no prior data. */
function delta(current: number, previous: number): number | undefined {
  if (previous <= 0) return undefined
  return ((current - previous) / previous) * 100
}

function DeltaChip({ value, invert = false }: { value?: number; invert?: boolean }) {
  if (value === undefined || !Number.isFinite(value)) return null
  const good = invert ? value < 0 : value >= 0
  return (
    <span
      className="inline-flex items-center text-[11px] font-mono font-medium px-1.5 py-0.5 rounded-md"
      style={{ background: good ? 'var(--green-wash)' : 'var(--red-wash)', color: good ? 'var(--green-ink)' : 'var(--red-ink)' }}>
      {value >= 0 ? '+' : ''}
      {value.toFixed(0)}%
    </span>
  )
}

function RangeToggle({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return <FilterToggle value={String(value)} onChange={v => onChange(Number(v) as Range)} options={RANGES.map(r => ({ id: String(r.id), label: r.label }))} />
}

function sumBy<T>(rows: T[], pick: (r: T) => number) {
  return rows.reduce((s, r) => s + pick(r), 0)
}

/**
 * The big daily view: range selector, period totals with change vs the
 * previous period, email chart, LinkedIn chart, and a day-by-day table.
 */
function DailyActivity({
  daily,
  linkedin,
  defaultRange = 30,
  showTable = true,
}: {
  daily: DailyPoint[]
  linkedin?: LinkedInDailyPoint[]
  defaultRange?: Range
  showTable?: boolean
}) {
  const [range, setRange] = useState<Range>(defaultRange)

  const both = lastDays(daily, range * 2, emptyDay)
  const days = both.slice(range)
  const prev = both.slice(0, range)
  const liBoth = linkedin ? lastDays(linkedin, range * 2, emptyLiDay) : []
  const liDays = liBoth.slice(range)
  const liPrev = liBoth.slice(0, range)

  const sent = sumBy(days, d => d.sent)
  const replies = sumBy(days, d => d.replies)
  const positive = sumBy(days, d => d.positive)
  const best = days.reduce<DailyPoint | null>((b, d) => (d.replies > (b?.replies ?? 0) ? d : b), null)
  const activeDays = days.filter(d => d.sent > 0).length

  const summary: { label: string; value: string; d?: number; color?: string; sub?: string }[] = [
    { label: 'Emails sent', value: compact(sent), d: delta(sent, sumBy(prev, d => d.sent)), sub: `${activeDays} sending day${activeDays !== 1 ? 's' : ''}` },
    { label: 'Replies', value: compact(replies), d: delta(replies, sumBy(prev, d => d.replies)), sub: `${pct(replyRate(sent, replies))} reply rate` },
    { label: 'Positive', value: compact(positive), d: delta(positive, sumBy(prev, d => d.positive)), color: 'var(--green-ink)', sub: `${pct(positiveRate(replies, positive))} of replies` },
    { label: 'Best day', value: best ? dayLabel(best.date) : '—', sub: best ? `${best.replies} replies` : 'No replies yet' },
  ]
  if (linkedin) {
    const conn = sumBy(liDays, d => d.connectionsSent)
    const liReplies = sumBy(liDays, d => d.replies)
    summary.push(
      { label: 'LinkedIn connects', value: compact(conn), d: delta(conn, sumBy(liPrev, d => d.connectionsSent)), sub: `${sumBy(liDays, d => d.connectionsAccepted)} accepted` },
      { label: 'LinkedIn replies', value: compact(liReplies), d: delta(liReplies, sumBy(liPrev, d => d.replies)) },
    )
  }

  const dates = days.map(d => d.date)

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl border" style={CARD_STYLE}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 pt-5">
          <div>
            <h2 className="font-display text-[17px] font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.3px' }}>
              Daily activity
            </h2>
            <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              Change shown against the previous {range} days
            </p>
          </div>
          <RangeToggle value={range} onChange={setRange} />
        </div>

        <div className={`grid gap-px mt-5 border-y grid-cols-2 ${linkedin ? 'md:grid-cols-3 xl:grid-cols-6' : 'md:grid-cols-4'}`} style={{ borderColor: 'var(--line)', background: 'var(--line)' }}>
          {summary.map(s => (
            <div key={s.label} className="px-5 sm:px-6 py-4" style={{ background: 'var(--surface)' }}>
              <div className="text-[10.5px] uppercase font-medium mb-1.5" style={{ color: 'var(--ink-muted)', letterSpacing: '1.1px' }}>
                {s.label}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-display tabular text-[22px] font-semibold leading-none" style={{ color: s.color ?? 'var(--ink)' }}>
                  {s.value}
                </span>
                <DeltaChip value={s.d} />
              </div>
              {s.sub && (
                <div className="text-[11.5px] mt-1.5" style={{ color: 'var(--ink-muted)' }}>
                  {s.sub}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="px-5 sm:px-6 py-5">
          <ActivityChart
            key={`email${range}`}
            dates={dates}
            series={[
              { key: 'sent', label: 'Emails sent', color: 'rgba(13,27,46,0.22)', kind: 'bar', values: days.map(d => d.sent) },
              { key: 'replies', label: 'Replies', color: 'var(--orange)', kind: 'line', values: days.map(d => d.replies) },
              { key: 'positive', label: 'Positive', color: 'var(--green-ink)', kind: 'line', values: days.map(d => d.positive) },
            ]}
          />
        </div>

        {linkedin && (
          <div className="px-5 sm:px-6 pb-6 pt-1 border-t" style={{ borderColor: 'var(--line)' }}>
            <div className="text-[12px] font-medium mt-5 mb-3" style={{ color: 'var(--ink-soft)' }}>
              LinkedIn (HeyReach)
            </div>
            <ActivityChart
              key={`li${range}`}
              height={200}
              dates={dates}
              series={[
                { key: 'conn', label: 'Connections sent', color: 'rgba(13,27,46,0.22)', kind: 'bar', values: liDays.map(d => d.connectionsSent) },
                { key: 'acc', label: 'Accepted', color: 'var(--navy)', kind: 'line', values: liDays.map(d => d.connectionsAccepted) },
                { key: 'lireplies', label: 'Replies', color: 'var(--orange)', kind: 'line', values: liDays.map(d => d.replies) },
              ]}
            />
          </div>
        )}
      </section>

      {showTable && (
        <Panel title="Day by day" subtitle="Newest first">
          <TableFrame
            key={range}
            noun="days"
            limit={14}
            headers={['Date', 'Sent', 'Replies', 'Reply %', 'Positive', ...(linkedin ? ['LI connects', 'LI accepted', 'LI replies'] : [])]}
            leftAligned={['Date']}
            rows={[...days].reverse().map((d, ri) => {
              const li = liDays[days.length - 1 - ri]
              const isToday = ri === 0
              return (
                <tr key={d.date} className="row-hover border-t" style={{ borderColor: 'var(--line)' }}>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className="font-medium" style={{ color: 'var(--ink)' }}>
                      {dayLabel(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    {isToday && (
                      <span className="ml-2 text-[10px] uppercase font-medium px-1.5 py-0.5 rounded" style={{ background: 'var(--orange-wash)', color: 'var(--orange-ink)', letterSpacing: '0.8px' }}>
                        Today
                      </span>
                    )}
                  </td>
                  <Cell color={d.sent ? undefined : 'var(--ink-muted)'}>{d.sent.toLocaleString()}</Cell>
                  <Cell color={d.replies ? 'var(--ink)' : 'var(--ink-muted)'}>{d.replies.toLocaleString()}</Cell>
                  <Cell color={d.sent ? 'var(--ink)' : 'var(--ink-muted)'}>{d.sent ? pct(replyRate(d.sent, d.replies)) : '—'}</Cell>
                  <Cell color={d.positive ? 'var(--green-ink)' : 'var(--ink-muted)'}>{d.positive.toLocaleString()}</Cell>
                  {linkedin && (
                    <>
                      <Cell color={li?.connectionsSent ? undefined : 'var(--ink-muted)'}>{(li?.connectionsSent ?? 0).toLocaleString()}</Cell>
                      <Cell color={li?.connectionsAccepted ? undefined : 'var(--ink-muted)'}>{(li?.connectionsAccepted ?? 0).toLocaleString()}</Cell>
                      <Cell color={li?.replies ? 'var(--ink)' : 'var(--ink-muted)'}>{(li?.replies ?? 0).toLocaleString()}</Cell>
                    </>
                  )}
                </tr>
              )
            })}
          />
        </Panel>
      )}
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

  return { primary, rates }
}

/* ── Admin: every client, every campaign ─────────────────────────────────── */

function AdminOverview({ overview, onOpenClient }: { overview: OverviewData; onOpenClient: (id: string) => void }) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const { primary, rates } = emailKpis(overview, overview.daily)
  const failed = overview.clients.filter(c => c.error)

  const campaigns = filter === 'all' ? overview.campaigns : overview.campaigns.filter(c => c.status === filter)

  return (
    <div>
      <PageHeader
        eyebrow="Agency overview"
        title="All clients"
        subtitle={`Live outbound performance across ${overview.clients.length} client workspaces.`}
        badges={failed.length > 0 ? <CountChip>{failed.length} failing to sync</CountChip> : undefined}
      />

      <KpiRow items={primary} cols="grid-cols-2 xl:grid-cols-4" />
      <KpiRow items={rates} cols="grid-cols-2 xl:grid-cols-4" />

      <div className="mt-5 mb-5">
        <DailyActivity daily={overview.daily} showTable={false} />
      </div>

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
      className="press group text-left rounded-2xl border p-5 transition-all hover:-translate-y-0.5"
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

function Workspace({
  data,
  view,
  onView,
  onOpenReplies,
}: {
  data: DashboardData
  view: View
  onView: (v: View) => void
  onOpenReplies: () => void
}) {
  // Each page names only the platform its numbers come from.
  const showEmail = view !== 'linkedin'
  const showLinkedIn =
    view === 'linkedin' || ((view === 'overview' || view === 'activity') && Boolean(data.linkedin || data.linkedinError))
  const badges = (
    <div className="flex gap-1.5">
      {showEmail && <SourceBadge>{PROVIDER_LABEL[data.provider]}</SourceBadge>}
      {showLinkedIn && <SourceBadge>HeyReach</SourceBadge>}
    </div>
  )

  if (view === 'email') return <EmailView data={data} badges={badges} />
  if (view === 'linkedin') return <LinkedInView data={data} badges={badges} />
  if (view === 'inboxes') return <InboxesView data={data} badges={badges} />
  if (view === 'activity') return <ActivityView data={data} badges={badges} />
  return <OverviewView data={data} badges={badges} onView={onView} onOpenReplies={onOpenReplies} />
}

function ActivityView({ data, badges }: { data: DashboardData; badges: React.ReactNode }) {
  return (
    <div>
      <PageHeader
        eyebrow="Daily activity"
        title={data.clientName}
        subtitle={`Day-by-day sending and replies${data.linkedin ? ', email and LinkedIn' : ''}.`}
        badges={badges}
      />
      <DailyActivity daily={data.daily} linkedin={data.linkedin?.daily} />
    </div>
  )
}

/** Positive-reply teaser on the overview: count, latest names, opens the side panel. */
function RepliesCard({ positive, onOpen }: { positive: number; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="press group text-left rounded-2xl border p-5 flex flex-col justify-between transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]"
      style={{ ...CARD_STYLE, background: 'linear-gradient(150deg, var(--navy-3), var(--navy))', borderColor: 'transparent' }}>
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] uppercase font-medium" style={{ color: 'var(--on-navy-soft)', letterSpacing: '1.2px' }}>
          Positive replies
        </span>
        <span className="w-8 h-8 rounded-full flex items-center justify-center transition-colors bg-white/10 group-hover:bg-[var(--orange)]">
          <Icon name="replies" size={15} />
        </span>
      </div>
      <div className="mt-6">
        <div className="font-display tabular text-[34px] font-semibold leading-none" style={{ color: 'var(--green-bright)' }}>
          {positive.toLocaleString()}
        </div>
        <div className="text-[13px] mt-2 text-white">Read every positive conversation</div>
        <div className="text-[12px] mt-0.5" style={{ color: 'var(--on-navy-muted)' }}>
          Email and LinkedIn, newest first
        </div>
      </div>
    </button>
  )
}

function OverviewView({
  data,
  badges,
  onView,
  onOpenReplies,
}: {
  data: DashboardData
  badges: React.ReactNode
  onView: (v: View) => void
  onOpenReplies: () => void
}) {
  const { primary, rates } = emailKpis(data, data.daily)
  const rows = withStatus(data)
  const active = rows.filter(r => r.status === 'active')

  return (
    <div>
      <PageHeader
        eyebrow="Workspace overview"
        title={data.clientName}
        subtitle={`Everything we ran for you, live from ${PROVIDER_LABEL[data.provider]}${data.linkedin ? ' and HeyReach' : ''}.`}
        badges={badges}
      />

      <KpiRow items={primary} cols="grid-cols-2 xl:grid-cols-4" />
      <KpiRow items={rates} cols="grid-cols-2 xl:grid-cols-4" />

      <div className="mt-5 mb-5">
        <DailyActivity daily={data.daily} linkedin={data.linkedin?.daily} showTable={false} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <RepliesCard positive={data.totalPositiveReplies + (data.linkedin?.totals.interested ?? 0)} onOpen={onOpenReplies} />
        {data.linkedin && <LinkedInSummary linkedin={data.linkedin} onOpen={() => onView('linkedin')} />}
        <div className={data.linkedin ? '' : 'lg:col-span-2'}>
          <InboxSummary data={data} onOpen={() => onView('inboxes')} />
        </div>
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
    <div>
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
    <div>
      <PageHeader
        eyebrow="LinkedIn"
        title={data.clientName}
        subtitle={`LinkedIn outreach via HeyReach by ${li.senders.map(s => s.name).join(', ') || 'no senders'}.`}
        badges={badges}
      />

      <KpiRow items={primary} cols="grid-cols-2 xl:grid-cols-4" />
      <KpiRow items={rates} cols="grid-cols-2 xl:grid-cols-4" />

      <Panel title="Activity" subtitle="Connection requests, acceptances and replies per day, last 30 days" className="mt-5 mb-5">
        <ActivityChart
          dates={series.map(d => d.date)}
          series={[
            { key: 'conn', label: 'Connections sent', color: 'rgba(13,27,46,0.22)', kind: 'bar', values: series.map(d => d.connectionsSent) },
            { key: 'acc', label: 'Accepted', color: 'var(--navy)', kind: 'line', values: series.map(d => d.connectionsAccepted) },
            { key: 'rep', label: 'Replies', color: 'var(--orange)', kind: 'line', values: series.map(d => d.replies) },
          ]}
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
    <div>
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

/* ── Positive replies panel ──────────────────────────────────────────────── */

function timeAgo(iso: string): string {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

function fullTime(iso: string): string {
  return iso
    ? new Date(iso).toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Earlier'
}

type ChannelFilter = 'all' | 'email' | 'linkedin'

/** Right-side slide-over with the workspace's positive-reply conversations. */
function RepliesDrawer({
  open,
  onClose,
  client,
  clients,
  onClientChange,
}: {
  open: boolean
  onClose: () => void
  client: ClientSummary
  /** When set (admin on All clients), a switcher moves the panel between workspaces. */
  clients?: ClientSummary[]
  onClientChange: (id: string) => void
}) {
  const clientId = client.id
  const clientName = client.name
  /** Loaded threads per workspace, so switching back is instant. */
  const [byClient, setByClient] = useState<Record<string, RepliesData>>({})
  const data = byClient[clientId] ?? null
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [channel, setChannel] = useState<ChannelFilter>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not load replies')
      setByClient(prev => ({ ...prev, [clientId]: json }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load replies')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  // A different workspace starts from its own list, unfiltered.
  useEffect(() => {
    setSelected(null)
    setQuery('')
    setChannel('all')
  }, [clientId])

  // Fetch on open; the server caches for a few minutes, so reopening is cheap.
  useEffect(() => {
    if (open) load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selected) setSelected(null)
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [open, selected, onClose])

  const threads = data?.threads ?? []
  const hasLinkedIn = threads.some(t => t.channel === 'linkedin')
  const q = query.trim().toLowerCase()
  const visible = threads.filter(
    t =>
      (channel === 'all' || t.channel === channel) &&
      (!q || [t.leadName, t.company, t.campaign, t.leadEmail].some(v => v?.toLowerCase().includes(q))),
  )
  const thread = threads.find(t => t.id === selected) ?? null

  return (
    <div className={`fixed inset-0 z-[70] ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{ background: 'rgba(13,27,46,0.42)', opacity: open ? 1 : 0, backdropFilter: open ? 'blur(2px)' : undefined }}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label="Positive replies"
        className="absolute right-0 top-0 h-full w-full sm:w-[500px] flex flex-col drawer-panel"
        style={{
          background: 'var(--pearl)',
          boxShadow: '-24px 0 60px rgba(13,27,46,0.22)',
          transform: open ? 'translateX(0)' : 'translateX(104%)',
        }}>
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase font-medium" style={{ color: 'var(--orange-ink)', letterSpacing: '1.4px' }}>
                {clientName}
              </div>
              <h2 className="font-display text-[22px] font-medium mt-0.5" style={{ color: 'var(--ink)', letterSpacing: '-0.5px' }}>
                Positive replies
                {data && (
                  <span className="ml-2 text-[13px] font-sans font-medium align-middle px-2 py-0.5 rounded-full" style={{ background: 'var(--green-wash)', color: 'var(--green-ink)' }}>
                    {threads.length}
                  </span>
                )}
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
              <IconButton label="Refresh replies" onClick={load} spinning={loading}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </IconButton>
              <IconButton label="Close" onClick={onClose}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </IconButton>
            </div>
          </div>

          {!thread && clients && clients.length > 1 && (
            <div className="flex gap-1.5 mt-4 overflow-x-auto pb-0.5">
              {clients.map(c => (
                <button
                  key={c.id}
                  onClick={() => onClientChange(c.id)}
                  className="press whitespace-nowrap text-[12.5px] font-medium px-3 py-1.5 rounded-full border"
                  style={
                    c.id === clientId
                      ? { background: 'var(--navy)', borderColor: 'var(--navy)', color: '#fff' }
                      : { borderColor: 'var(--line-strong)', color: 'var(--ink-soft)' }
                  }>
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {!thread && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <div className="relative flex-1 min-w-[180px]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-muted)' }} aria-hidden>
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search name, company, campaign"
                  className="zt-input w-full pl-9 pr-3 py-2 rounded-full text-[13px]"
                />
              </div>
              {hasLinkedIn && (
                <FilterToggle<ChannelFilter>
                  value={channel}
                  onChange={setChannel}
                  options={[
                    { id: 'all', label: 'All' },
                    { id: 'email', label: 'Email' },
                    { id: 'linkedin', label: 'LinkedIn' },
                  ]}
                />
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {thread ? (
            <ThreadView thread={thread} onBack={() => setSelected(null)} />
          ) : loading && !data ? (
            <div className="p-4 flex flex-col gap-2.5">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="rounded-xl p-4 flex gap-3" style={{ background: 'var(--surface)' }}>
                  <div className="skeleton w-10 h-10 rounded-full flex-shrink-0" />
                  <div className="flex-1 flex flex-col gap-2 pt-1">
                    <div className="skeleton h-3 w-1/2 rounded" />
                    <div className="skeleton h-2.5 w-4/5 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : error && !data ? (
            <div className="p-8 text-center">
              <div className="text-[14px] font-medium" style={{ color: 'var(--red-ink)' }}>
                Could not load replies
              </div>
              <div className="text-[12.5px] mt-1" style={{ color: 'var(--ink-muted)' }}>
                {error}
              </div>
              <button onClick={load} className="btn-orange press mt-4 px-4 py-2 rounded-full text-[13px] font-medium">
                Try again
              </button>
            </div>
          ) : (
            <div className="p-3 flex flex-col gap-1.5">
              {data?.errors.map(e => (
                <div key={e} className="mx-1 mb-1 px-3 py-2 rounded-lg text-[12px]" style={{ background: 'var(--amber-wash)', color: 'var(--amber-ink)' }}>
                  {e}
                </div>
              ))}
              {visible.length === 0 ? (
                <Empty>{threads.length === 0 ? 'No positive replies yet' : 'No conversations match'}</Empty>
              ) : (
                visible.map((t, i) => <ThreadRow key={t.id} thread={t} index={i} onOpen={() => setSelected(t.id)} />)
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  spinning = false,
  children,
}: {
  label: string
  onClick: () => void
  spinning?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="press w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--surface-sunken)]"
      style={{ color: 'var(--ink-soft)' }}>
      <span className={spinning ? 'animate-spin-slow inline-flex' : 'inline-flex'}>{children}</span>
    </button>
  )
}

function ChannelBadge({ channel }: { channel: PositiveThread['channel'] }) {
  return (
    <span
      className="text-[10px] uppercase font-medium px-1.5 py-0.5 rounded"
      style={
        channel === 'linkedin'
          ? { background: 'rgba(10,102,194,0.1)', color: '#0a66c2', letterSpacing: '0.8px' }
          : { background: 'var(--navy-wash)', color: 'var(--ink-soft)', letterSpacing: '0.8px' }
      }>
      {channel === 'linkedin' ? 'LinkedIn' : 'Email'}
    </span>
  )
}

function ThreadRow({ thread, index, onOpen }: { thread: PositiveThread; index: number; onOpen: () => void }) {
  const lastLead = [...thread.messages].reverse().find(m => m.from === 'lead')
  return (
    <button
      onClick={onOpen}
      className="press group w-full text-left rounded-xl p-3.5 flex gap-3 transition-all hover:shadow-[var(--shadow-card)] animate-fade-in"
      style={{ background: 'var(--surface)', animationDelay: `${Math.min(index, 12) * 25}ms` }}>
      <span
        className="w-10 h-10 rounded-full flex items-center justify-center font-display text-[13px] font-semibold flex-shrink-0 text-white"
        style={{ background: thread.channel === 'linkedin' ? '#0a66c2' : 'var(--navy)' }}>
        {initials(thread.leadName)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium truncate" style={{ color: 'var(--ink)' }}>
            {thread.leadName}
          </span>
          <span className="ml-auto text-[11.5px] whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
            {timeAgo(thread.lastAt)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[12px] min-w-0" style={{ color: 'var(--ink-muted)' }}>
          <ChannelBadge channel={thread.channel} />
          <span className="truncate">{[thread.company, thread.campaign].filter(Boolean).join(' · ') || thread.leadEmail}</span>
        </div>
        <div className="text-[12.5px] mt-1.5 line-clamp-2" style={{ color: 'var(--ink-soft)' }}>
          {lastLead?.body || <span style={{ color: 'var(--ink-muted)' }}>Marked {thread.label.toLowerCase()}, no reply text in the recent inbox</span>}
        </div>
      </div>
      <span
        className="self-center text-[10.5px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
        style={{ background: 'var(--green-wash)', color: 'var(--green-ink)' }}>
        {thread.label}
      </span>
    </button>
  )
}

function ThreadView({ thread, onBack }: { thread: PositiveThread; onBack: () => void }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [thread.id])

  return (
    <div className="animate-slide-in">
      <div className="sticky top-0 z-10 px-4 py-3 border-b flex items-center gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
        <button
          onClick={onBack}
          aria-label="Back to all replies"
          className="press w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--surface-sunken)] flex-shrink-0"
          style={{ color: 'var(--ink-soft)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span
          className="w-10 h-10 rounded-full flex items-center justify-center font-display text-[13px] font-semibold flex-shrink-0 text-white"
          style={{ background: thread.channel === 'linkedin' ? '#0a66c2' : 'var(--navy)' }}>
          {initials(thread.leadName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14.5px] font-medium truncate" style={{ color: 'var(--ink)' }}>
              {thread.leadName}
            </span>
            <ChannelBadge channel={thread.channel} />
          </div>
          <div className="text-[12px] truncate" style={{ color: 'var(--ink-muted)' }}>
            {[thread.title, thread.company].filter(Boolean).join(' at ') || thread.leadEmail}
          </div>
        </div>
      </div>

      <div className="px-4 pt-3 flex flex-wrap gap-1.5">
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--green-wash)', color: 'var(--green-ink)' }}>
          {thread.label}
        </span>
        {thread.campaign && (
          <span className="text-[11px] px-2 py-0.5 rounded-full truncate max-w-full" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-soft)' }}>
            {thread.campaign}
          </span>
        )}
        {thread.leadEmail && (
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-soft)' }}>
            {thread.leadEmail}
          </span>
        )}
      </div>

      <div className="px-4 py-4 flex flex-col gap-3">
        {thread.messages.length === 0 ? (
          <Empty>The reply text isn’t in the recent inbox, but this lead is marked {thread.label.toLowerCase()}.</Empty>
        ) : (
          thread.messages.map((m, i) => {
            const us = m.from === 'us'
            return (
              <div key={i} className={`flex flex-col max-w-[86%] animate-fade-in ${us ? 'self-end items-end' : 'self-start items-start'}`} style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                <div
                  className={`px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${us ? 'rounded-2xl rounded-br-md' : 'rounded-2xl rounded-bl-md'}`}
                  style={us ? { background: 'var(--navy)', color: '#fff' } : { background: 'var(--surface)', color: 'var(--ink)', boxShadow: 'var(--shadow-card)' }}>
                  {m.body}
                </div>
                <span className="text-[10.5px] mt-1 px-1" style={{ color: 'var(--ink-muted)' }}>
                  {us ? 'Us' : thread.leadName.split(' ')[0]} · {fullTime(m.at)}
                </span>
              </div>
            )
          })
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}

/* ── States ──────────────────────────────────────────────────────────────── */

/** Placeholder layout shown while a workspace loads for the first time. */
function SkeletonPage() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="skeleton h-3 w-28 rounded mb-3" />
      <div className="skeleton h-8 w-64 rounded-lg mb-2" />
      <div className="skeleton h-3.5 w-80 max-w-full rounded mb-8" />
      {[0, 1].map(row => (
        <div key={row} className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl border p-5" style={CARD_STYLE}>
              <div className="skeleton h-2.5 w-20 rounded mb-4" />
              <div className="skeleton h-7 w-24 rounded-md mb-3" />
              <div className="skeleton h-2.5 w-28 rounded" />
            </div>
          ))}
        </div>
      ))}
      <div className="rounded-2xl border p-6 mt-5" style={CARD_STYLE}>
        <div className="skeleton h-4 w-32 rounded mb-6" />
        <div className="flex items-end gap-1.5 h-[220px]">
          {Array.from({ length: 30 }, (_, i) => (
            <div key={i} className="skeleton flex-1 rounded-t" style={{ height: `${25 + ((i * 37) % 70)}%` }} />
          ))}
        </div>
      </div>
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

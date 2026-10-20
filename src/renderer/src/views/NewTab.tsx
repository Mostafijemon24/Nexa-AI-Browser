import { useEffect, type ReactNode } from 'react'
import {
  Sparkle,
  Plus,
  Detective,
  DownloadSimple,
  BookmarkSimple,
  ClockCounterClockwise,
  Stack,
  GoogleDriveLogo,
  Robot,
  ShieldCheck,
  Lightning,
  Shield,
  UserCircle,
  Globe,
  Gear,
  ArrowSquareOut,
  MagnifyingGlass,
  SlidersHorizontal,
  PuzzlePiece
} from '@phosphor-icons/react'
import { useNexa } from '../state/store'
import { DASHBOARD_WIDGETS, normalizeDashboardLayout, type DashboardWidgetSize } from '@shared/dashboard'
import { vpnUiProjection } from '@shared/vpn-ui'
import { resolveLocale, resolveTimeZone, languageLabel } from '@shared/regional'

/* ----------------------------- small helpers ----------------------------- */

type Tone = 'ok' | 'warn' | 'err' | 'idle' | 'accent'

function toneColor(t: Tone): string {
  switch (t) {
    case 'ok':
      return 'var(--success)'
    case 'warn':
      return 'var(--warning)'
    case 'err':
      return 'var(--error)'
    case 'accent':
      return 'var(--accent-2)'
    default:
      return 'var(--text-3)'
  }
}

function greeting(name: string): string {
  const h = new Date().getHours()
  const when = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return `${when}, ${name.split(' ')[0]}`
}

function gridColumnFor(size: DashboardWidgetSize): string {
  return size === 'large' ? '1 / -1' : size === 'medium' ? 'span 1' : 'span 1'
}

/** A single dashboard widget card. Honest, keyboard-accessible, token-driven. */
function WidgetCard(props: {
  title: string
  icon: ReactNode
  size: DashboardWidgetSize
  status?: { tone: Tone; text: string }
  onOpen?: () => void
  openLabel?: string
  children?: ReactNode
}) {
  const { title, icon, size, status, onOpen, openLabel, children } = props
  return (
    <section
      aria-label={title}
      className="card"
      style={{
        gridColumn: gridColumnFor(size),
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 14,
        minWidth: 0
      }}
    >
      <div className="row" style={{ gap: 8, minWidth: 0 }}>
        <span style={{ display: 'flex', color: 'var(--text-2)' }}>{icon}</span>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </h3>
        {status && (
          <span className="row" style={{ gap: 6, flexShrink: 0 }}>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: toneColor(status.tone) }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: toneColor(status.tone), textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {status.text}
            </span>
          </span>
        )}
      </div>
      {children}
      {onOpen && (
        <button
          onClick={onOpen}
          className="row"
          style={{ marginTop: 'auto', gap: 6, alignSelf: 'flex-start', height: 28, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 12, fontWeight: 500 }}
        >
          {openLabel || 'Open'} <ArrowSquareOut size={12} />
        </button>
      )}
    </section>
  )
}

/** A compact "label · value" row used inside widgets. */
function Metric({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="row" style={{ gap: 8, fontSize: 12 }}>
      <span style={{ color: 'var(--text-3)', flex: 1, minWidth: 0 }}>{label}</span>
      <span style={{ fontWeight: 600, color: tone ? toneColor(tone) : 'var(--text)' }}>{value}</span>
    </div>
  )
}

function EmptyNote({ text }: { text: string }) {
  return <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.4 }}>{text}</div>
}

/* --------------------------------- widgets -------------------------------- */

function QuickActionsWidget() {
  const st = useNexa
  const actions: { label: string; icon: ReactNode; run: () => void }[] = [
    { label: 'New Tab', icon: <Plus size={16} />, run: () => st.getState().newTab() },
    { label: 'Private Tab', icon: <Detective size={16} />, run: () => st.getState().newPrivateTab() },
    { label: 'Downloads', icon: <DownloadSimple size={16} />, run: () => st.getState().setView('downloads') },
    { label: 'Bookmarks', icon: <BookmarkSimple size={16} />, run: () => st.getState().setView('bookmarks') },
    { label: 'History', icon: <ClockCounterClockwise size={16} />, run: () => st.getState().setView('history') },
    { label: 'Collections', icon: <Stack size={16} />, run: () => st.getState().setView('collections') },
    { label: 'Worker', icon: <Robot size={16} />, run: () => st.getState().setWorkerOpen(true) },
    { label: 'Drive', icon: <GoogleDriveLogo size={16} />, run: () => st.getState().openDrive() },
    { label: 'Privacy', icon: <Shield size={16} />, run: () => st.getState().setView('privacy') },
    { label: 'VPN', icon: <ShieldCheck size={16} />, run: () => st.getState().setOverlay('vpn') },
    { label: 'Settings', icon: <Gear size={16} />, run: () => st.getState().setView('settings') }
  ]
  return (
    <WidgetCard title="Quick Actions" size="large" icon={<SlidersHorizontal size={15} />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.run}
            className="row"
            style={{ gap: 8, height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 12.5, fontWeight: 500 }}
          >
            <span style={{ display: 'flex', color: 'var(--accent-2)' }}>{a.icon}</span>
            {a.label}
          </button>
        ))}
      </div>
    </WidgetCard>
  )
}

function DownloadsWidget() {
  const downloads = useNexa((s) => s.downloads)
  const active = downloads.filter((d) => d.status === 'downloading').length
  const queued = downloads.filter((d) => d.status === 'queued' || d.status === 'paused').length
  const done = downloads.filter((d) => d.status === 'completed').length
  const failed = downloads.filter((d) => d.status === 'failed' || d.status === 'cancelled').length
  const status: { tone: Tone; text: string } = active > 0 ? { tone: 'accent', text: `${active} active` } : { tone: 'idle', text: 'Idle' }
  return (
    <WidgetCard
      title="Downloads"
      size="medium"
      icon={<DownloadSimple size={15} />}
      status={status}
      onOpen={() => useNexa.getState().setView('downloads')}
      openLabel="Open Downloads"
    >
      {downloads.length === 0 ? (
        <EmptyNote text="No downloads yet" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Metric label="Active" value={String(active)} tone={active ? 'accent' : undefined} />
          <Metric label="Queued" value={String(queued)} />
          <Metric label="Completed" value={String(done)} />
          <Metric label="Failed" value={String(failed)} tone={failed ? 'err' : undefined} />
        </div>
      )}
    </WidgetCard>
  )
}

function ProtectionWidget() {
  const snap = useNexa((s) => s.activeProtection())
  let status: { tone: Tone; text: string }
  let body: ReactNode
  if (!snap) {
    status = { tone: 'idle', text: 'Unknown' }
    body = <EmptyNote text="Protection status unavailable" />
  } else if (snap.state === 'error') {
    status = { tone: 'err', text: 'Error' }
    body = <EmptyNote text="Protection engine error" />
  } else if (!snap.settings.enabled) {
    status = { tone: 'idle', text: 'Off' }
    body = <EmptyNote text="Content protection is off" />
  } else {
    status = { tone: 'ok', text: 'On' }
    const t = snap.totals
    body =
      t.blocked === 0 && t.requests === 0 ? (
        <EmptyNote text="No blocked requests yet" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Metric label="Blocked" value={String(t.blocked)} tone={t.blocked ? 'ok' : undefined} />
          <Metric label="Allowed" value={String(t.allowed)} />
          <Metric label="Requests" value={String(t.requests)} />
        </div>
      )
  }
  return (
    <WidgetCard
      title="Protection"
      size="small"
      icon={<Shield size={15} />}
      status={status}
      onOpen={() => useNexa.getState().setView('protection')}
    >
      {body}
    </WidgetCard>
  )
}

function VpnWidget() {
  const vpn = useNexa((s) => s.vpn)
  const servers = useNexa((s) => s.vpnServers)
  const proj = vpnUiProjection({
    state: vpn?.state || 'not_configured',
    capability: vpn?.capability || 'unknown',
    hasServers: servers.length > 0
  })
  return (
    <WidgetCard
      title="VPN"
      size="small"
      icon={<ShieldCheck size={15} />}
      status={{ tone: proj.tone, text: proj.short }}
      onOpen={() => useNexa.getState().setOverlay('vpn')}
      openLabel={proj.primary === 'configure' ? 'Set up VPN' : 'VPN controls'}
    >
      <EmptyNote text={vpn?.state === 'protected' && vpn.serverName ? `Server · ${vpn.serverName}` : proj.ariaLabel} />
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{proj.ariaLabel}</span>
    </WidgetCard>
  )
}

function TurboWidget() {
  const state = useNexa((s) => s.turboState())
  const cls = useNexa((s) => s.turboLastClass)
  const map: Record<string, { tone: Tone; text: string }> = {
    ON: { tone: 'ok', text: 'On' },
    OFF: { tone: 'idle', text: 'Off' },
    OPTIMIZING: { tone: 'accent', text: 'Optimizing' },
    NOT_SUPPORTED: { tone: 'idle', text: 'N/A' }
  }
  const status = map[state] || map.OFF
  return (
    <WidgetCard
      title="Turbo"
      size="small"
      icon={<Lightning size={15} />}
      status={status}
      onOpen={() => useNexa.getState().setView('settings', 'turbo')}
      openLabel="Turbo settings"
    >
      <EmptyNote text={cls && cls !== 'Unavailable' ? `Last navigation: ${cls}` : 'Navigation metrics available after browsing'} />
    </WidgetCard>
  )
}

function AiWidget() {
  // The routed status is the single source of truth (same as the sidebar + AI panel).
  const ai = useNexa((s) => s.aiStatus)
  const state = ai?.state
  const providerName = ai?.providerName || 'Local AI'
  const status: { tone: Tone; text: string } =
    state === 'connected' ? { tone: 'ok', text: 'Connected' } : state === 'checking' || !ai ? { tone: 'warn', text: 'Checking' } : { tone: 'idle', text: 'Offline' }
  const modelName = ai?.modelLabel || ai?.chatModel
  const detail =
    state === 'connected'
      ? `${providerName} · ${modelName || 'ready'}`
      : state === 'checking' || !ai
        ? `Checking ${providerName}…`
        : ai.note || `${providerName} unavailable`
  return (
    <WidgetCard
      title="AI"
      size="small"
      icon={<Sparkle size={15} weight="fill" />}
      status={status}
      onOpen={() => useNexa.setState({ aiOpen: true })}
      openLabel="Open AI"
    >
      <EmptyNote text={detail} />
    </WidgetCard>
  )
}

function ExtensionsWidget() {
  const extensions = useNexa((s) => s.extensions)
  const enabled = extensions.filter((e) => e.enabled).length
  const disabled = extensions.length - enabled
  const status: { tone: Tone; text: string } = extensions.length === 0 ? { tone: 'idle', text: 'None installed' } : { tone: enabled > 0 ? 'ok' : 'idle', text: `${enabled} enabled` }
  return (
    <WidgetCard
      title="Extensions"
      size="small"
      icon={<PuzzlePiece size={15} weight="fill" />}
      status={status}
      onOpen={() => useNexa.getState().setView('settings', 'extensions')}
      openLabel="Manage"
    >
      <EmptyNote text={extensions.length === 0 ? 'No extensions installed' : `${enabled} enabled · ${disabled} disabled`} />
    </WidgetCard>
  )
}

function WorkerWidget() {
  const ws = useNexa((s) => s.workerState)
  const scan = useNexa((s) => s.workerScan)
  const map: Record<string, { tone: Tone; text: string }> = {
    idle: { tone: 'idle', text: 'Ready' },
    scanning: { tone: 'warn', text: 'Scanning' },
    scanned: { tone: 'accent', text: 'Page detected' },
    generating: { tone: 'warn', text: 'Working' },
    ready: { tone: 'ok', text: 'Ready' },
    filling: { tone: 'warn', text: 'Filling' },
    review: { tone: 'accent', text: 'Waiting for user' },
    blocked: { tone: 'warn', text: 'Waiting for user' },
    error: { tone: 'err', text: 'Error' }
  }
  const status = map[ws] || map.idle
  const detail =
    scan && (scan.questions?.length || scan.fields?.length)
      ? `${scan.questions?.length || 0} question(s) · ${scan.fields?.length || 0} field(s) detected`
      : 'Scan the current page to understand and fill it'
  return (
    <WidgetCard title="Worker Assistant" size="medium" icon={<Robot size={15} />} status={status}>
      <EmptyNote text={detail} />
      <div className="row" style={{ gap: 8, marginTop: 2 }}>
        <button
          onClick={() => void useNexa.getState().workerScanPage()}
          className="primary"
          style={{ height: 30, padding: '0 12px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}
        >
          Scan Page
        </button>
        <button
          onClick={() => useNexa.getState().setWorkerOpen(true)}
          style={{ height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 12, fontWeight: 500 }}
        >
          Open Worker
        </button>
      </div>
    </WidgetCard>
  )
}

function DriveWidget() {
  const meta = useNexa((s) => s.driveMeta)
  const state = meta?.state
  const connected = !!meta?.connected
  const map: Record<string, { tone: Tone; text: string }> = {
    NOT_CONFIGURED: { tone: 'idle', text: 'Not connected' },
    CHECKING: { tone: 'warn', text: 'Checking' },
    CONNECTED: { tone: 'ok', text: 'Connected' },
    OFFLINE: { tone: 'idle', text: 'Offline' },
    AUTH_REQUIRED: { tone: 'warn', text: 'Sign in' },
    AUTH_EXPIRED: { tone: 'warn', text: 'Reconnect' }
  }
  const status = (state && map[state]) || { tone: 'err', text: 'Error' }
  return (
    <WidgetCard title="Google Drive" size="medium" icon={<GoogleDriveLogo size={15} />} status={status}>
      {connected ? (
        <EmptyNote text={meta?.email ? `Signed in · ${meta.email}` : 'Drive is connected'} />
      ) : (
        <EmptyNote text="Drive isn't connected" />
      )}
      <div className="row" style={{ gap: 8, marginTop: 2 }}>
        {connected ? (
          <>
            <button
              onClick={() => useNexa.getState().openDrive()}
              style={{ height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 12, fontWeight: 500 }}
            >
              Open Drive
            </button>
            <button
              onClick={() => useNexa.getState().openDrive()}
              className="row"
              style={{ gap: 6, height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 12, fontWeight: 500 }}
            >
              <MagnifyingGlass size={13} /> Search
            </button>
          </>
        ) : (
          <button
            onClick={() => void useNexa.getState().driveConnect()}
            className="primary"
            style={{ height: 30, padding: '0 12px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}
          >
            Connect Drive
          </button>
        )}
      </div>
    </WidgetCard>
  )
}

function PrivacyWidget() {
  const report = useNexa((s) => s.privacyReport)
  return (
    <WidgetCard
      title="Privacy"
      size="medium"
      icon={<Shield size={15} />}
      onOpen={() => useNexa.getState().setView('privacy')}
      openLabel="Open Privacy Center"
    >
      {!report ? (
        <EmptyNote text="Run a privacy check to see IP, DNS, WebRTC and fingerprint status." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <Metric label="Protection" value={report.protection.status} tone={report.protection.status === 'ACTIVE' ? 'ok' : 'idle'} />
          <Metric label="VPN" value={report.vpn.status} tone={report.vpn.status === 'PROTECTED' ? 'ok' : 'idle'} />
          <Metric label="Public IP" value={report.ip.publicIp === 'NOT_CONFIGURED' ? 'Not configured' : report.ip.publicIp} />
          <Metric label="DNS" value={report.dns.status} />
        </div>
      )}
    </WidgetCard>
  )
}

function ProfileWidget() {
  const p = useNexa((s) => s.profiles[s.activeProfile])
  const r = useNexa((s) => s.prefs.regional)
  const isPrivate = useNexa((s) => {
    const t = s.session.tabs.find((x) => x.id === s.session.activeTab)
    return !!t?.private
  })
  if (!p) return null
  return (
    <WidgetCard
      title="Active Profile"
      size="small"
      icon={<UserCircle size={15} />}
      status={isPrivate ? { tone: 'accent', text: 'Private' } : undefined}
      onOpen={() => useNexa.getState().setOverlay('profile')}
      openLabel="Switch profile"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <Metric label="Profile" value={p.name} />
        <Metric label="Type" value={p.status} />
        <Metric label="Locale" value={resolveLocale(r)} />
        <Metric label="Timezone" value={resolveTimeZone(r)} />
      </div>
    </WidgetCard>
  )
}

function RegionalWidget() {
  const r = useNexa((s) => s.prefs.regional)
  const primary = r.languages[0]
  return (
    <WidgetCard
      title="Regional"
      size="small"
      icon={<Globe size={15} />}
      onOpen={() => useNexa.getState().setView('settings', 'regional')}
      openLabel="Language & Region"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <Metric label="Language" value={primary ? languageLabel(primary) : 'Browser default'} />
        <Metric label="Locale" value={resolveLocale(r)} />
        <Metric label="Timezone" value={resolveTimeZone(r)} />
      </div>
    </WidgetCard>
  )
}

function RecentSitesWidget() {
  const rows = useNexa((s) => s.historyRows)
  const recent = rows.slice(0, 5)
  return (
    <WidgetCard
      title="Recent Sites"
      size="medium"
      icon={<ClockCounterClockwise size={15} />}
      onOpen={() => useNexa.getState().setView('history')}
      openLabel="Open History"
    >
      {recent.length === 0 ? (
        <EmptyNote text="No recent activity" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {recent.map((h) => (
            <button
              key={h.id}
              onClick={() => useNexa.getState().openUrl(h.url)}
              className="row"
              style={{ gap: 8, height: 30, padding: '0 6px', borderRadius: 6, fontSize: 12, textAlign: 'left' }}
              title={h.url}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {h.title || h.url}
              </span>
            </button>
          ))}
        </div>
      )}
    </WidgetCard>
  )
}

function BookmarksWidget() {
  const store = useNexa((s) => s.bookmarks)
  const items = (store?.items || []).filter((b) => b.type === 'bookmark' && b.url).slice(0, 5)
  return (
    <WidgetCard
      title="Bookmarks"
      size="medium"
      icon={<BookmarkSimple size={15} />}
      onOpen={() => useNexa.getState().setView('bookmarks')}
      openLabel="Bookmark Manager"
    >
      {items.length === 0 ? (
        <EmptyNote text="No bookmarks yet" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map((b) => (
            <button
              key={b.id}
              onClick={() => b.url && useNexa.getState().openUrl(b.url)}
              className="row"
              style={{ gap: 8, height: 30, padding: '0 6px', borderRadius: 6, fontSize: 12, textAlign: 'left' }}
              title={b.url}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title || b.url}</span>
            </button>
          ))}
        </div>
      )}
    </WidgetCard>
  )
}

function HistoryWidget() {
  const rows = useNexa((s) => s.historyRows)
  return (
    <WidgetCard
      title="History"
      size="small"
      icon={<ClockCounterClockwise size={15} />}
      onOpen={() => useNexa.getState().setView('history')}
      openLabel="Open History"
    >
      {rows.length === 0 ? <EmptyNote text="No history yet" /> : <Metric label="Entries" value={String(rows.length)} />}
    </WidgetCard>
  )
}

function CollectionsWidget() {
  const store = useNexa((s) => s.collections)
  const cols = (store?.collections || []).slice(0, 4)
  return (
    <WidgetCard
      title="Collections"
      size="small"
      icon={<Stack size={15} />}
      onOpen={() => useNexa.getState().setView('collections')}
      openLabel="Open Collections"
    >
      {cols.length === 0 ? (
        <EmptyNote text="No collections yet" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {cols.map((c) => (
            <Metric key={c.id} label={c.name} value={`${c.items.length}`} />
          ))}
        </div>
      )}
    </WidgetCard>
  )
}

const WIDGET_COMPONENTS: Record<string, () => ReactNode> = {
  'quick-actions': QuickActionsWidget,
  downloads: DownloadsWidget,
  protection: ProtectionWidget,
  vpn: VpnWidget,
  turbo: TurboWidget,
  ai: AiWidget,
  worker: WorkerWidget,
  drive: DriveWidget,
  privacy: PrivacyWidget,
  profile: ProfileWidget,
  regional: RegionalWidget,
  'recent-sites': RecentSitesWidget,
  bookmarks: BookmarksWidget,
  history: HistoryWidget,
  collections: CollectionsWidget,
  extensions: ExtensionsWidget
}

/* ------------------------------- the view -------------------------------- */

export function NewTabView() {
  const prefs = useNexa((s) => s.prefs)
  const search = useNexa((s) => s.ntSearch)
  const p = useNexa((s) => s.profiles[s.activeProfile])
  // Validate persisted layout on every render (untrusted input, §43).
  const layout = normalizeDashboardLayout(p?.dash.visible).filter((id) => DASHBOARD_WIDGETS[id])

  // One-time lazy projection of existing history for the activity widgets.
  // Not a poll: fires once on mount and only when history is enabled and empty.
  useEffect(() => {
    const s = useNexa.getState()
    if (s.prefs.historyEnabled && s.historyRows.length === 0 && !s.historyLoading) {
      void s.refreshHistory()
    }
     
  }, [])

  return (
    <div style={{ position: 'relative', minHeight: 0, flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px clamp(16px, 3vw, 30px)' }}>
      {prefs.newtabBg === 'aurora' && (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', top: '-20%', left: '-10%', width: '60%', height: '70%', borderRadius: '50%', background: 'radial-gradient(circle, var(--accent) 0%, transparent 68%)', opacity: 0.28, filter: 'blur(30px)', animation: 'caurora 14s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', bottom: '-25%', right: '-8%', width: '55%', height: '65%', borderRadius: '50%', background: 'radial-gradient(circle, var(--accent-2) 0%, transparent 68%)', opacity: 0.24, filter: 'blur(34px)', animation: 'caurora 18s ease-in-out infinite reverse' }} />
        </div>
      )}
      {prefs.newtabBg === 'mesh' && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(at 18% 22%, var(--accent-weak) 0px, transparent 45%), radial-gradient(at 82% 18%, color-mix(in srgb, var(--accent) 30%, transparent) 0px, transparent 42%)' }} />
      )}
      {prefs.newtabBg === 'gradient' && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(140deg, var(--accent-weak), transparent 55%)' }} />
      )}

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 1280 }}>
        {/* Header + search */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <img src="./assets/nexa-icon.png" alt="NEXA" width={72} height={72} style={{ objectFit: 'contain' }} />
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.16em' }}>NEXA</span>
        </div>
        {p?.dash.greeting && <div style={{ textAlign: 'center', fontSize: 16, fontWeight: 600, marginBottom: 10 }}>{greeting(p.name)}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, maxWidth: 560, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '0 14px' }}>
          <MagnifyingGlass size={16} color="var(--text-3)" />
          <input
            value={search}
            onChange={(e) => useNexa.setState({ ntSearch: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && useNexa.getState().navigate(search)}
            placeholder="Ask AI, search the web, or type a command…"
            aria-label="Search or enter address"
            style={{ flex: 1, background: 'none', border: 'none', fontSize: 14 }}
          />
          <button onClick={() => useNexa.setState({ aiOpen: true })} className="row" style={{ gap: 5, height: 30, padding: '0 10px', borderRadius: 8, background: 'var(--accent-weak)', color: 'var(--accent-2)', fontSize: 12, fontWeight: 600 }}>
            <Sparkle size={13} weight="fill" /> AI
          </button>
        </div>

        {/* Dashboard header */}
        <div className="row" style={{ margin: '18px 0 12px' }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Dashboard</span>
          <button
            onClick={() => useNexa.getState().setOverlay('customize')}
            className="row"
            style={{ marginLeft: 'auto', gap: 6, height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 12, fontWeight: 500 }}
          >
            <SlidersHorizontal size={13} /> Customize
          </button>
        </div>

        {/* Widget grid */}
        {layout.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            All widgets are hidden. <button onClick={() => useNexa.getState().setOverlay('customize')} style={{ color: 'var(--accent-2)', fontWeight: 600 }}>Customize dashboard</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, alignItems: 'stretch' }}>
            {layout.map((id) => {
              const Comp = WIDGET_COMPONENTS[id]
              return Comp ? <Comp key={id} /> : null
            })}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11.5, color: 'var(--text-3)' }}>
          Private by default · open source · {p?.status} profile
        </div>
      </div>
    </div>
  )
}

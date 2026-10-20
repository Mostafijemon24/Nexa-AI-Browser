import { useEffect } from 'react'
import { ShieldStar, ArrowClockwise } from '@phosphor-icons/react'
import { useNexa } from '../state/store'
import { resolveLocale, resolveTimeZone } from '@shared/regional'

/** Map an honest status string to a semantic tone colour. Positive tones are only
 *  used for verified-positive labels; unverifiable states stay muted. */
function tone(status: string): string {
  switch (status) {
    case 'PROTECTED':
    case 'ACTIVE':
    case 'VERIFIED':
    case 'NO_LEAK_DETECTED':
    case 'NO_EXPOSURE_DETECTED':
    case 'ON':
    case 'STRONG':
      return 'var(--success)'
    case 'POTENTIAL_EXPOSURE':
    case 'POTENTIAL_LEAK':
    case 'NONE':
    case 'ATTENTION':
      return 'var(--warning)'
    case 'DETECTED':
    case 'BLOCKED':
    case 'MIXED':
      return 'var(--accent)'
    case 'UNAVAILABLE':
    case 'ERROR':
      return 'var(--error)'
    default:
      return 'var(--text-3)'
  }
}

function Pill({ status }: { status: string }) {
  return (
    <span
      className="row"
      style={{ gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: tone(status) }}
    >
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: tone(status) }} />
      {status}
    </span>
  )
}

function Line({ label, value, status }: { label: string; value?: string; status?: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 12, padding: '7px 0', fontSize: 12.5 }}>
      <span style={{ color: 'var(--text-2)' }}>{label}</span>
      {status ? <Pill status={status} /> : <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-1)' }}>{value ?? '—'}</span>}
    </div>
  )
}

/**
 * STEP 10 — Profile regional configuration shown as browser CONFIGURATION, not as
 * fingerprint protection. Regional preferences are observable characteristics; NEXA
 * neither hides nor randomizes them.
 */
function RegionalConfigCard() {
  const r = useNexa((s) => s.prefs.regional)
  return (
    <Card title="Regional Configuration">
      <Line label="Profile timezone" value={resolveTimeZone(r)} />
      <Line label="Profile locale" value={resolveLocale(r)} />
      <Line label="Preferred languages" value={r.languages.length ? r.languages.join(', ') : 'Browser default'} />
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.4 }}>
        These are normal browser preferences (not fingerprint protection). NEXA does not spoof or randomize them.
      </div>
    </Card>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="card"
      style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column' }}
      aria-label={title}
    >
      <h2 style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '0 0 6px' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

export function PrivacyCenterView() {
  const report = useNexa((s) => s.privacyReport)
  const state = useNexa((s) => s.privacyState)
  const step = useNexa((s) => s.privacyStep)
  const tab = useNexa((s) => s.session.tabs.find((t) => t.id === s.session.activeTab))
  const host = tab?.kind === 'web' && tab.url ? report?.host || '' : ''
  const checking = state === 'checking'

  // Auto-run once when the Privacy Center opens from idle.
  useEffect(() => {
    if (useNexa.getState().privacyState === 'idle') void useNexa.getState().runPrivacyCheck()
     
  }, [])

  const fp = report?.fingerprint
  const fpd = report?.fingerprintDetails
  const iface = report?.ip.interfaces

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="row" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', gap: 10 }}>
        <ShieldStar size={20} color="var(--accent)" weight="fill" />
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Privacy Center</h1>
        {report && <div style={{ marginLeft: 8 }}><Pill status={report.aggregate.headline} /></div>}
        {report?.private && <span className="pill" style={{ marginLeft: 6 }}>Private</span>}
        <div style={{ flex: 1 }} />
        <button
          className="ghost"
          style={{ height: 32 }}
          disabled={checking}
          onClick={() => void useNexa.getState().runPrivacyCheck()}
        >
          <ArrowClockwise size={14} /> {checking ? 'Checking…' : 'Run Privacy Check'}
        </button>
      </div>

      {/* Live scan status — screen-reader announced */}
      <div aria-live="polite" className="row" style={{ padding: '8px 24px', gap: 8, fontSize: 12, borderBottom: '1px solid var(--border)', minHeight: 34 }}>
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: checking ? 'var(--warning)' : report ? 'var(--success)' : 'var(--text-3)' }} />
        <span style={{ color: 'var(--text-2)' }}>
          {checking ? step || 'Checking…' : report ? `Last checked ${new Date(report.ranAt).toLocaleTimeString()}` : 'No check run yet.'}
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Current site</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{host || (report?.isWeb ? report?.host : 'No web page loaded')}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
            <Card title="Connection">
              <Line label="HTTPS" status={report ? (report.https === 'ACTIVE' ? 'ACTIVE' : report.https === 'NONE' ? 'NONE' : 'UNKNOWN') : 'CHECKING'} />
              <Line label="Public IP (site-visible)" value={report ? report.ip.publicIp : '—'} />
              <Line label="Local interfaces" value={iface ? `${iface.ipv4Count} IPv4 · ${iface.ipv6Count} IPv6` : '—'} />
              <Line label="IPv6 available" value={report ? (report.ip.ipv6Available ? 'Yes' : 'No') : '—'} />
            </Card>

            <Card title="DNS">
              <Line label="Leak status" status={report ? report.dns.status : 'CHECKING'} />
              <Line label="Resolvers" value={report ? String(report.dns.resolvers.length) : '—'} />
              {report?.dns.resolvers.slice(0, 3).map((r, i) => (
                <Line key={i} label={`Resolver ${i + 1}`} value={`${r.family} · ${r.kind}`} />
              ))}
            </Card>

            <Card title="WebRTC">
              <Line label="Exposure" status={report ? report.webrtc.status : 'CHECKING'} />
              <Line label="Local IP exposed" value={report ? (report.webrtc.localIpExposed ? 'Yes' : 'No') : '—'} />
              <Line label="Public IP exposed" value={report ? (report.webrtc.publicIpExposed ? 'Yes' : 'No') : '—'} />
              <Line label="Obfuscated (mDNS)" value={report ? String(report.webrtc.obfuscatedCount) : '—'} />
            </Card>

            <Card title="Fingerprint Surface">
              <Line label="Signal surface" status={fp ? fp.surface : 'CHECKING'} />
              <Line label="Readable signals" value={fp ? `${fp.availableCount} / ${fp.totalCount}` : '—'} />
              <Line label="Timezone" value={fpd?.timezone || '—'} />
              <Line label="Screen" value={fpd?.screen || '—'} />
              <Line label="GPU" value={fpd?.gpu ? fpd.gpu.slice(0, 32) : '—'} />
              <Line label="CPU cores" value={fpd?.hardwareConcurrency != null ? String(fpd.hardwareConcurrency) : '—'} />
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.4 }}>
                Protection: NOT_CONFIGURED — NEXA does not randomize or spoof fingerprint values (privacy audit only).
              </div>
            </Card>

            <RegionalConfigCard />


            <Card title="Content Protection">
              <Line label="Blocking" status={report ? report.protection.status : 'CHECKING'} />
              <Line label="Blocked (this site)" value={report ? String(report.protection.blocked) : '—'} />
              <Line label="Requests (this site)" value={report ? String(report.protection.requests) : '—'} />
              <button className="ghost" style={{ height: 28, marginTop: 8, justifyContent: 'center' }} onClick={() => useNexa.getState().setView('protection')}>
                Open Protection dashboard
              </button>
            </Card>

            <Card title="VPN">
              <Line label="Status" status={report ? report.vpn.status : 'CHECKING'} />
              <Line label="Handshake" status={report ? report.vpn.handshake : 'CHECKING'} />
              <Line label="Kill switch" status={report ? report.vpn.killSwitch : 'CHECKING'} />
              <Line label="IPv6 policy" value={report ? report.vpn.ipv6 : '—'} />
            </Card>

            <Card title="Permissions">
              {['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read'].map((p) => (
                <Line
                  key={p}
                  label={p.charAt(0).toUpperCase() + p.slice(1)}
                  value={report ? (report.permissions[p] || 'unknown') : '—'}
                />
              ))}
            </Card>

            <Card title="Site Privacy">
              <Line label="HTTPS" status={report ? (report.https === 'ACTIVE' ? 'ACTIVE' : report.https === 'NONE' ? 'NONE' : 'UNKNOWN') : 'CHECKING'} />
              <Line label="Cookies (count)" value={report && report.cookieCount != null ? String(report.cookieCount) : report ? 'UNKNOWN' : '—'} />
              <Line label="Trackers blocked" value={report ? String(report.protection.blocked) : '—'} />
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.4 }}>
                Cookie values are never shown. Counts only.
              </div>
            </Card>
          </div>

          <div style={{ marginTop: 18, fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
            Diagnostics are on-demand, session-only, and never persisted. Local interface addresses are
            not the public IP seen by websites. Site-visible public IP is <b>NOT_CONFIGURED</b> because
            NEXA ships no external IP-echo service. No results are transmitted to third parties.
          </div>
        </div>
      </div>
    </div>
  )
}

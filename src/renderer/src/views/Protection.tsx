import { useEffect, useState } from 'react'
import { Plus, ShieldStar, Trash } from '@phosphor-icons/react'
import { useNexa } from '../state/store'
import { cleanDomain, type ProtectionCategory } from '@shared/protection'
import type { ProtectionSnapshot } from '../nexa'

const CATEGORY_LABEL: Record<ProtectionCategory, string> = {
  ad: 'Advertisement',
  tracker: 'Tracker',
  annoyance: 'Annoyance',
  malicious: 'Malicious',
  'user-block': 'Blocklist',
  other: 'Filter rule'
}

function num(n: number): string {
  return n.toLocaleString()
}

function StateBadge({ snap }: { snap: ProtectionSnapshot | null }) {
  const state = snap?.state || 'not_configured'
  const enabled = snap?.settings.enabled
  const map: Record<string, { dot: string; label: string }> = {
    active: enabled ? { dot: 'var(--success)', label: 'ACTIVE' } : { dot: 'var(--text-3)', label: 'OFF' },
    off: { dot: 'var(--text-3)', label: 'OFF' },
    error: { dot: 'var(--error)', label: 'ERROR' },
    not_configured: { dot: 'var(--warning)', label: 'NOT CONFIGURED' }
  }
  const v = state === 'active' && !enabled ? map.off : map[state]
  return (
    <span className="row" style={{ gap: 7, fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: v.dot }} />
      {v.label}
    </span>
  )
}

export function ProtectionView() {
  const id = useNexa((s) => s.activeProfile)
  const snap = useNexa((s) => s.protection)
  const rules = useNexa((s) => s.protectionRules)

  useEffect(() => {
    useNexa.getState().loadProtection()
     
  }, [id])

  const totals = snap?.totals
  const cats = totals?.byCategory

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="row" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', gap: 10 }}>
        <ShieldStar size={20} color="var(--accent)" weight="fill" />
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Content Protection</h1>
        <div style={{ marginLeft: 8 }}>
          <StateBadge snap={snap} />
        </div>
        <div style={{ flex: 1 }} />
        <button
          className="ghost"
          style={{ height: 32 }}
          onClick={async () => {
            await window.nexa.protection.setEnabled({ profileId: id, enabled: !(snap?.settings.enabled ?? true) })
          }}
        >
          {snap?.settings.enabled ? 'Disable protection' : 'Enable protection'}
        </button>
        <button
          className="ghost"
          style={{ height: 32 }}
          onClick={async () => {
            await window.nexa.protection.resetStats({ profileId: id })
            useNexa.getState().toastMsg('Session statistics reset')
          }}
        >
          Reset stats
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          {/* Overview */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 22 }}>
            <Stat label="Requests seen" value={num(totals?.requests || 0)} />
            <Stat label="Blocked" value={num(totals?.blocked || 0)} tone="accent" />
            <Stat label="Trackers" value={num(cats?.tracker || 0)} />
            <Stat label="Ads" value={num(cats?.ad || 0)} />
            <Stat label="Annoyances" value={num(cats?.annoyance || 0)} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 22 }}>
            Statistics are session-scoped and stored in memory only — nothing is written to disk or sent anywhere.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 22, alignItems: 'start' }}>
            {/* Activity */}
            <section>
              <SectionTitle>Recent blocks</SectionTitle>
              <div className="card" style={{ overflow: 'hidden' }}>
                {!snap?.recent.length ? (
                  <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                    No blocked requests yet
                  </div>
                ) : (
                  snap.recent.slice(0, 40).map((e, i) => (
                    <div
                      key={i}
                      className="row"
                      style={{ padding: '9px 13px', borderBottom: i === Math.min(39, snap.recent.length - 1) ? 'none' : '1px solid var(--border)', gap: 10 }}
                    >
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--error)', width: 62, flex: 'none' }}>BLOCKED</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.host}>
                          {e.host}
                        </div>
                        <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {e.resourceType || 'other'}
                        </div>
                      </div>
                      <span className="pill">{e.category ? CATEGORY_LABEL[e.category] : 'Rule'}</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Site rules */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <DomainList
                title="Allowlist"
                desc="Protection is fully disabled for these sites"
                domains={rules?.allow || []}
                onAdd={async (d) => {
                  const r = await window.nexa.protection.addAllow({ profileId: id, domain: d })
                  if (r?.ok) useNexa.setState({ protectionRules: r.data })
                  else useNexa.getState().toastMsg(r?.error?.message || 'Invalid domain', 'err')
                }}
                onRemove={async (d) => {
                  const r = await window.nexa.protection.removeAllow({ profileId: id, domain: d })
                  if (r?.ok) useNexa.setState({ protectionRules: r.data })
                }}
              />
              <DomainList
                title="Blocklist"
                desc="Requests to these domains are always blocked"
                domains={rules?.block || []}
                onAdd={async (d) => {
                  const r = await window.nexa.protection.addBlock({ profileId: id, domain: d })
                  if (r?.ok) useNexa.setState({ protectionRules: r.data })
                  else useNexa.getState().toastMsg(r?.error?.message || 'Invalid domain', 'err')
                }}
                onRemove={async (d) => {
                  const r = await window.nexa.protection.removeBlock({ profileId: id, domain: d })
                  if (r?.ok) useNexa.setState({ protectionRules: r.data })
                }}
              />

              <section>
                <SectionTitle>Filter lists</SectionTitle>
                <div className="card" style={{ overflow: 'hidden' }}>
                  {(rules?.lists || []).map((l, i, arr) => (
                    <div key={l.id} className="row" style={{ padding: '10px 13px', borderBottom: i === arr.length - 1 ? 'none' : '1px solid var(--border)', gap: 10 }}>
                      <span style={{ flex: 1, fontSize: 13 }}>{l.name}</span>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{num(l.rules)} rules</span>
                      <span className="row" style={{ gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--success)' }}>
                        <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)' }} /> Active
                      </span>
                    </div>
                  ))}
                </div>
                <div className="honest" style={{ marginTop: 10 }}>
                  BUNDLED LISTS ACTIVE · EXTERNAL UPDATES NOT CONFIGURED · COSMETIC FILTERING NOT CONFIGURED · MALICIOUS-DOMAIN DB NOT CONFIGURED
                </div>
              </section>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'accent' }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone === 'accent' ? 'var(--accent-2)' : 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
      {children}
    </div>
  )
}

function DomainList({
  title,
  desc,
  domains,
  onAdd,
  onRemove
}: {
  title: string
  desc: string
  domains: string[]
  onAdd: (d: string) => void
  onRemove: (d: string) => void
}) {
  const [input, setInput] = useState('')
  function submit() {
    const d = cleanDomain(input)
    if (!d) {
      useNexa.getState().toastMsg('Enter a valid domain, e.g. example.com', 'warn')
      return
    }
    onAdd(d)
    setInput('')
  }
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 8 }}>{desc}</div>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <input
          aria-label={`Add domain to ${title}`}
          className="field"
          style={{ flex: 1, height: 32 }}
          value={input}
          placeholder="example.com"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className="ghost" style={{ height: 32 }} onClick={submit} aria-label={`Add to ${title}`}>
          <Plus size={15} /> Add
        </button>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {domains.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5 }}>No domains</div>
        ) : (
          domains.map((d, i) => (
            <div key={d} className="row" style={{ padding: '8px 13px', borderBottom: i === domains.length - 1 ? 'none' : '1px solid var(--border)', gap: 10 }}>
              <span className="mono" style={{ flex: 1, fontSize: 12.5 }}>{d}</span>
              <button className="icon-btn" aria-label={`Remove ${d}`} title="Remove" style={{ width: 26, height: 26, color: 'var(--error)' }} onClick={() => onRemove(d)}>
                <Trash size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

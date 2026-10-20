import { useState, useEffect, type ReactNode } from 'react'
import { Check, Key, LockKey, Plus, ShieldCheck, UserCircle, X } from '@phosphor-icons/react'
import { ACCENT_SWATCHES, THEME_PRESETS } from '../design-system/theme'
import { SETTINGS_NAV } from '../lib/catalogs'
import { useNexa } from '../state/store'
import type { AddrStyle, DensityMode, MotionMode, RadiusMode } from '@shared/types'
import {
  COMMON_LANGUAGES,
  formatDateTime,
  formatNumber,
  languageLabel,
  listTimeZones,
  measurementFor,
  resolveLocale,
  resolveTimeZone,
  timeZoneOffsetLabel,
  weekStartFor,
  type RegionalCapabilityState
} from '@shared/regional'

export function SettingsView() {
  const section = useNexa((s) => s.settingsSection)
  const nav = SETTINGS_NAV.find((s) => s.id === section) || SETTINGS_NAV[0]
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div style={{ width: 'clamp(150px, 26%, 220px)', flex: 'none', borderRight: '1px solid var(--border)', background: 'var(--chrome)', padding: 10, overflow: 'auto' }}>
        {SETTINGS_NAV.map((n) => {
          const active = n.id === section
          return (
            <button
              key={n.id}
              onClick={() => useNexa.setState({ settingsSection: n.id })}
              className="nav-btn"
              style={{ width: '100%', color: active ? 'var(--accent-2)' : 'var(--text-2)', background: active ? 'var(--accent-weak)' : 'transparent', fontWeight: active ? 600 : 400 }}
            >
              <span className="nav-label" style={{ fontSize: 13 }}>{n.title}</span>
            </button>
          )
        })}
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '26px clamp(16px, 3vw, 30px) 60px' }}>
        <div style={{ maxWidth: 600 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 4 }}>{nav.group}</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 22px' }}>{nav.title}</h1>
          {section === 'general' && <General />}
          {section === 'profile' && <ProfileSettings />}
          {section === 'passwords' && <Passwords />}
          {section === 'appearance' && <Appearance />}
          {section === 'browsing' && <Browsing />}
          {section === 'regional' && <RegionalSettings />}
          {section === 'turbo' && <TurboSettings />}
          {section === 'downloads' && <DownloadsSettings />}
          {section === 'ai' && <AiSettings />}
          {section === 'cloud' && <CloudSettings />}
          {section === 'privacy' && <Privacy />}
          {section === 'security' && <SecurityCenter />}
          {section === 'protection' && <Protection />}
          {section === 'vpn' && <VpnSettings />}
          {section === 'extensions' && <Extensions />}
          {section === 'advanced' && <Advanced />}
        </div>
      </div>
    </div>
  )
}

function Row({ label, desc, children }: { label: string; desc: string; children: ReactNode }) {
  return (
    <div className="row card" style={{ padding: '14px 16px', marginBottom: 10, gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>{desc}</div>
      </div>
      {children}
    </div>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={onClick}>
      <span />
    </button>
  )
}

function Cycle({ value, opts, onPick, fmt }: { value: string; opts: string[]; onPick: (v: string) => void; fmt?: (v: string) => string }) {
  return (
    <select
      value={value}
      onChange={(e) => onPick(e.target.value)}
      style={{ height: 32, borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text)', padding: '0 8px', fontSize: 12.5 }}
    >
      {opts.map((o) => (
        <option key={o} value={o}>{fmt ? fmt(o) : o}</option>
      ))}
    </select>
  )
}

function General() {
  const sv = useNexa((s) => s.prefs.sv)
  const theme = useNexa((s) => s.prefs.theme)
  const setSv = (key: keyof typeof sv, value: string) => {
    const prefs = useNexa.getState().prefs
    useNexa.getState().setPref('sv', { ...prefs.sv, [key]: value })
    useNexa.getState().toastMsg('Saved · ' + value)
  }
  return (
    <>
      <Row label="Startup" desc="What NEXA opens on launch">
        <Cycle value={sv.startup} opts={['Continue where I left off', 'Open the New Tab page', 'Reopen last session']} onPick={(v) => setSv('startup', v)} />
      </Row>
      <Row label="Default search engine" desc="Used in the address bar">
        <Cycle value={sv.search} opts={['DuckDuckGo', 'Google', 'Brave', 'Startpage']} onPick={(v) => setSv('search', v)} />
      </Row>
      <Row label="Theme" desc="Light or dark">
        <button className="ghost" onClick={() => useNexa.getState().toggleTheme()}>
          {theme === 'dark' ? 'Dark' : 'Light'}
        </button>
      </Row>
    </>
  )
}

function ProfileSettings() {
  const p = useNexa((s) => s.profiles[s.activeProfile])
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <button className="row" style={{ width: '100%', padding: '14px 16px', borderBottom: '1px solid var(--border)', textAlign: 'left', gap: 13 }} onClick={() => useNexa.setState({ overlay: 'editProfile', profileDraft: { ...p } })}>
        <UserCircle size={19} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>{p.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{p.status} · local profile</div>
        </div>
      </button>
      <button className="row" style={{ width: '100%', padding: '14px 16px', textAlign: 'left', gap: 13 }} onClick={() => useNexa.getState().setOverlay('customize')}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>Home dashboard</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Widgets, quick actions, layout & greeting</div>
        </div>
      </button>
    </div>
  )
}

function Passwords() {
  const exists = useNexa((s) => s.vaultExists)
  const unlocked = useNexa((s) => s.vaultUnlocked)
  const creds = useNexa((s) => s.vaultCreds)
  const master = useNexa((s) => s.masterInput)
  const err = useNexa((s) => s.unlockErr)
  const q = useNexa((s) => s.pmQuery)
  const id = useNexa((s) => s.activeProfile)
  const mins = useNexa((s) => s.prefs.autoLockMins)

  async function submit() {
    const fn = exists ? window.nexa.passwordManager.unlock : window.nexa.passwordManager.create
    const res = await fn({ profileId: id, password: master })
    if (!res?.ok) {
      useNexa.setState({ unlockErr: res?.error?.message || 'Failed', masterInput: '' })
      return
    }
        useNexa.setState({
          vaultUnlocked: true,
          vaultExists: true,
          vaultCreds: res.data.credentials as typeof creds,
          masterInput: '',
          unlockErr: ''
        })
  }

  if (!unlocked) {
    return (
      <div className="card" style={{ padding: 22 }}>
        <div className="row" style={{ gap: 10, marginBottom: 10 }}>
          <LockKey size={20} color="var(--accent)" />
          <div style={{ fontSize: 15, fontWeight: 600 }}>{exists ? 'Unlock vault' : 'Create master password'}</div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55 }}>PBKDF2 (210k) + AES-GCM 256. Plaintext is never written to disk. The derived key is sealed with OS secure storage while unlocked.</p>
        <input
          className="field"
          type="password"
          value={master}
          onChange={(e) => useNexa.setState({ masterInput: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Master password (8+ characters)"
        />
        {err && <div style={{ color: 'var(--error)', fontSize: 12, marginTop: 8 }}>{err}</div>}
        <button className="primary" style={{ marginTop: 14 }} onClick={submit}>
          {exists ? 'Unlock' : 'Create vault'}
        </button>
      </div>
    )
  }

  const shown = creds.filter((c) => !q || `${c.title} ${c.origin} ${c.username}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <div className="row" style={{ marginBottom: 14, gap: 8 }}>
        <input className="field" value={q} onChange={(e) => useNexa.setState({ pmQuery: e.target.value })} placeholder="Search credentials" style={{ flex: 1 }} />
        <button className="primary" onClick={() => useNexa.setState({ overlay: 'credential', draft: { origin: '', username: '', password: '', title: '' } })}>
          <Plus size={14} /> Add
        </button>
        <button
          className="ghost"
          onClick={async () => {
            await window.nexa.passwordManager.lock(id)
            useNexa.setState({ vaultUnlocked: false, vaultCreds: [], revealId: null, revealed: null })
          }}
        >
          Lock
        </button>
      </div>
      <Row label="Auto-lock" desc="Lock the in-memory vault after inactivity">
        <Cycle
          value={String(mins)}
          opts={['0', '1', '5', '15']}
          onPick={(v) => useNexa.getState().setPref('autoLockMins', Number(v))}
        />
      </Row>
      {shown.map((c) => (
        <div key={c.id} className="card" style={{ padding: '12px 14px', marginBottom: 8 }}>
          <div className="row">
            <Key size={16} color="var(--text-2)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.title}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {c.origin} · {c.username}
              </div>
            </div>
            <button
              className="ghost"
              style={{ height: 28 }}
              onClick={async () => {
                await window.nexa.passwordManager.copySecret({ profileId: id, id: c.id })
                useNexa.getState().toastMsg('Password copied · clipboard clears in 30s')
              }}
            >
              Copy
            </button>
            <button
              className="ghost"
              style={{ height: 28 }}
              onClick={async () => {
                const res = await window.nexa.passwordManager.reveal({ profileId: id, id: c.id })
                useNexa.setState({ revealId: c.id, revealed: res?.ok ? res.data.password : null })
              }}
            >
              Reveal
            </button>
            <button
              className="ghost"
              style={{ height: 28, color: 'var(--error)' }}
              onClick={async () => {
                const res = await window.nexa.passwordManager.deleteCredential({ profileId: id, id: c.id })
                if (res?.ok) useNexa.setState({ vaultCreds: res.data as typeof creds })
              }}
            >
              Delete
            </button>
          </div>
          {useNexa.getState().revealId === c.id && useNexa.getState().revealed && (
            <div className="mono" style={{ marginTop: 8, fontSize: 12, color: 'var(--accent-2)' }}>
              {useNexa.getState().revealed}
            </div>
          )}
        </div>
      ))}
      {!shown.length && <div style={{ color: 'var(--text-3)', fontSize: 13 }}>No credentials yet.</div>}
    </>
  )
}

function Appearance() {
  const prefs = useNexa((s) => s.prefs)
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 14 }}>Presets</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {THEME_PRESETS.map((p) => (
          <button
            key={p.name}
            className="ghost"
            onClick={() => {
              const st = useNexa.getState()
              st.setPref('themeName', p.name)
              st.setPref('theme', p.mode)
              st.setPref('accent', p.accent)
              st.setPref('newtabBg', p.bg)
            }}
          >
            {p.name}
          </button>
        ))}
      </div>
      <Row label="Accent" desc="Variants are mixed at runtime — not hardcoded">
        <div className="row" style={{ gap: 8 }}>
          {ACCENT_SWATCHES.map((c) => (
            <button key={c} onClick={() => useNexa.getState().setPref('accent', c)} style={{ width: 22, height: 22, borderRadius: '50%', background: c, boxShadow: prefs.accent === c ? '0 0 0 2px var(--accent)' : undefined }} />
          ))}
        </div>
      </Row>
      <Row label="Address bar" desc="Solid, gradient, or glass">
        <Cycle value={prefs.addrStyle} opts={['solid', 'gradient', 'glass']} onPick={(v) => useNexa.getState().setPref('addrStyle', v as AddrStyle)} />
      </Row>
      <Row label="Corner radius" desc="sharp · compact · balanced · rounded">
        <Cycle value={prefs.radius} opts={['sharp', 'compact', 'balanced', 'rounded']} onPick={(v) => useNexa.getState().setPref('radius', v as RadiusMode)} />
      </Row>
      <Row label="Density" desc="Card padding scale">
        <Cycle value={prefs.density} opts={['compact', 'comfortable', 'spacious']} onPick={(v) => useNexa.getState().setPref('density', v as DensityMode)} />
      </Row>
      <Row label="Motion" desc="Respects reduced-motion">
        <Cycle value={prefs.motion} opts={['none', 'minimal', 'smooth', 'expressive']} onPick={(v) => useNexa.getState().setPref('motion', v as MotionMode)} />
      </Row>
      <Row label="New Tab background" desc="Ambient styles">
        <Cycle value={prefs.newtabBg} opts={['default', 'aurora', 'mesh', 'gradient']} onPick={(v) => useNexa.getState().setPref('newtabBg', v)} />
      </Row>
    </>
  )
}

/**
 * STEP 9 — Turbo & Performance settings. One primary toggle (Turbo Mode) plus
 * advanced sub-controls that map to REAL behavior. Honest copy only — no speed
 * claims. Sub-toggles are disabled (greyed) when the master is off.
 */
function TurboSettings() {
  const prefs = useNexa((s) => s.prefs)
  const master = prefs.toggles.turbo
  const t = prefs.turbo
  return (
    <>
      <Row label="Turbo Mode" desc="Safe, on-device browser optimizations. Never changes remote server, network or DNS speed.">
        <Toggle on={master} onClick={() => useNexa.getState().setTurboEnabled(!master)} />
      </Row>
      <Row label="Safe navigation prediction" desc="Warm the connection (DNS/TCP/TLS) to a URL you're clearly about to open. Never for private tabs or login/payment pages.">
        <Toggle on={master && t.predict} onClick={() => master && useNexa.getState().setTurboPref('predict', !t.predict)} />
      </Row>
      <Row label="Progressive loading indicator" desc="A subtle, non-blocking navigation progress bar. No fake percentage or ETA.">
        <Toggle on={master && t.progress} onClick={() => master && useNexa.getState().setTurboPref('progress', !t.progress)} />
      </Row>
      <Row label="Local navigation metrics" desc="Measure real page timing (TTFB, DOMContentLoaded, Load) using standard browser APIs. Local-only, never uploaded, never persisted.">
        <Toggle on={master && t.metrics} onClick={() => master && useNexa.getState().setTurboPref('metrics', !t.metrics)} />
      </Row>
      <Row label="Connection & cache reuse" desc="NEXA relies on Chromium's built-in HTTP/2, HTTP/3, TLS session and cache reuse. Always on; nothing to configure.">
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Chromium-native</span>
      </Row>
      <div className="honest" style={{ marginTop: 6 }}>
        TURBO OPTIMIZES LOCAL BEHAVIOR ONLY · NO FAKE METRICS · METRICS ARE IN-MEMORY & PROFILE-SCOPED · PRIVATE MODE PERSISTS NOTHING
      </div>
    </>
  )
}

/**
 * STEP 10 — Language & Region. Per-profile regional preferences with honest,
 * layered capability reporting. Dense; reuses Row/Cycle/.field/.honest tokens.
 */
function capLabel(s: RegionalCapabilityState | undefined): string {
  switch (s) {
    case 'SUPPORTED':
      return 'Applied'
    case 'PARTIALLY_SUPPORTED':
      return 'Partial'
    case 'INVALID_CONFIGURATION':
      return 'Invalid'
    case 'NOT_SUPPORTED':
      return 'Not applied'
    default:
      return '—'
  }
}

function RegionalSettings() {
  const r = useNexa((s) => s.prefs.regional)
  const caps = useNexa((s) => s.regionalCaps)
  const [tzQuery, setTzQuery] = useState('')
  const [addLang, setAddLang] = useState('')
  const set = (patch: Partial<typeof r>) => useNexa.getState().setRegional(patch)

  const zones = listTimeZones()
  const filteredZones = tzQuery
    ? zones.filter((z) => z.toLowerCase().includes(tzQuery.toLowerCase())).slice(0, 200)
    : zones.slice(0, 200)
  const now = Date.now()
  const effLocale = resolveLocale(r)
  const effTz = resolveTimeZone(r)

  const moveLang = (i: number, dir: -1 | 1) => {
    const next = [...r.languages]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    set({ languages: next })
  }
  const removeLang = (i: number) => set({ languages: r.languages.filter((_, k) => k !== i) })
  const addLanguage = () => {
    if (!addLang) return
    if (r.languages.some((l) => l.toLowerCase() === addLang.toLowerCase())) return
    set({ languages: [...r.languages, addLang] })
    setAddLang('')
  }

  return (
    <>
      <Row label="Timezone" desc={`Profile preference (IANA). Effective: ${effTz} · ${timeZoneOffsetLabel(effTz) || ''}`}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="field"
            style={{ width: 130, height: 32 }}
            placeholder="Search…"
            aria-label="Search timezones"
            value={tzQuery}
            onChange={(e) => setTzQuery(e.target.value)}
          />
          <select
            aria-label="Timezone"
            value={r.timezone}
            onChange={(e) => set({ timezone: e.target.value })}
            style={{ height: 32, borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text)', padding: '0 8px', fontSize: 12.5, maxWidth: 220 }}
          >
            <option value="auto">Automatic (system)</option>
            {filteredZones.map((z) => (
              <option key={z} value={z}>
                {z} · {timeZoneOffsetLabel(z, now) || ''}
              </option>
            ))}
          </select>
        </div>
      </Row>

      <Row label="Display language (locale)" desc={`BCP-47. Effective: ${effLocale}. Used for NEXA formatting + Accept-Language.`}>
        <select
          aria-label="Locale"
          value={r.locale}
          onChange={(e) => set({ locale: e.target.value })}
          style={{ height: 32, borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text)', padding: '0 8px', fontSize: 12.5, maxWidth: 240 }}
        >
          <option value="auto">Automatic (system)</option>
          {COMMON_LANGUAGES.map((l) => (
            <option key={l.tag} value={l.tag}>
              {l.name}
            </option>
          ))}
        </select>
      </Row>

      <div className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>Preferred languages</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 10 }}>
          Ordered for the Accept-Language header (primary first). {caps?.acceptLanguageValue ? `Sent: ${caps.acceptLanguageValue}` : 'None set — Chromium default is used.'}
        </div>
        {r.languages.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 8 }}>No languages added.</div>}
        {r.languages.map((lang, i) => (
          <div key={lang} className="row" style={{ gap: 8, padding: '5px 0' }}>
            <span style={{ width: 18, fontSize: 11, color: 'var(--text-3)' }}>{i + 1}.</span>
            <span style={{ flex: 1, fontSize: 13 }}>{languageLabel(lang)}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{lang}</span>
            <button className="ghost" aria-label={`Move ${lang} up`} disabled={i === 0} onClick={() => moveLang(i, -1)} style={{ padding: '2px 6px' }}>↑</button>
            <button className="ghost" aria-label={`Move ${lang} down`} disabled={i === r.languages.length - 1} onClick={() => moveLang(i, 1)} style={{ padding: '2px 6px' }}>↓</button>
            <button className="ghost" aria-label={`Remove ${lang}`} onClick={() => removeLang(i)} style={{ padding: '2px 6px', color: 'var(--error)' }}>
              <X size={13} />
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <select
            aria-label="Add language"
            value={addLang}
            onChange={(e) => setAddLang(e.target.value)}
            style={{ flex: 1, height: 32, borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text)', padding: '0 8px', fontSize: 12.5 }}
          >
            <option value="">Add a language…</option>
            {COMMON_LANGUAGES.filter((l) => !r.languages.some((x) => x.toLowerCase() === l.tag.toLowerCase())).map((l) => (
              <option key={l.tag} value={l.tag}>
                {l.name}
              </option>
            ))}
          </select>
          <button className="ghost" onClick={addLanguage} disabled={!addLang}>
            <Plus size={13} /> Add
          </button>
        </div>
      </div>

      <Row label="Date format" desc="Used in NEXA's own UI where dates are shown">
        <Cycle value={r.dateFormat} opts={['auto', 'DMY', 'MDY', 'YMD']} onPick={(v) => set({ dateFormat: v as typeof r.dateFormat })} />
      </Row>
      <Row label="Time format" desc="12-hour or 24-hour clock in NEXA's own UI">
        <Cycle value={r.timeFormat} opts={['auto', '12h', '24h']} onPick={(v) => set({ timeFormat: v as typeof r.timeFormat })} />
      </Row>
      <Row label="Week starts on" desc={`Derived from locale when Automatic (currently ${weekStartFor(r) === 0 ? 'Sunday' : 'Monday'})`}>
        <select
          aria-label="Week starts on"
          value={String(r.weekStartsOn)}
          onChange={(e) => set({ weekStartsOn: e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as 0 | 1) })}
          style={{ height: 32, borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text)', padding: '0 8px', fontSize: 12.5 }}
        >
          <option value="auto">Automatic</option>
          <option value="0">Sunday</option>
          <option value="1">Monday</option>
        </select>
      </Row>
      <Row label="Measurement system" desc={`For NEXA-owned UI (currently ${measurementFor(r)}). Never rewrites websites.`}>
        <Cycle value={r.measurementSystem} opts={['auto', 'metric', 'imperial']} onPick={(v) => set({ measurementSystem: v as typeof r.measurementSystem })} />
      </Row>

      <div className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-3)', marginBottom: 8 }}>WHERE THIS APPLIES (HONEST)</div>
        {[
          ['Accept-Language (Chromium session)', caps?.acceptLanguage],
          ['NEXA UI formatting', caps?.appFormatting],
          ['Page locale (navigator.language)', caps?.locale],
          ['Page timezone (Date/Intl)', caps?.timezone]
        ].map(([label, state]) => (
          <div key={label as string} className="row" style={{ justifyContent: 'space-between', padding: '3px 0' }}>
            <span style={{ fontSize: 12.5 }}>{label as string}</span>
            <span className="pill" style={{ fontSize: 11 }}>{capLabel(state as RegionalCapabilityState)}</span>
          </div>
        ))}
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-2)' }}>
          Preview: {formatDateTime(now, r)} · {formatNumber(1234567.89, r)}
        </div>
      </div>
      <div className="honest" style={{ marginTop: 6 }}>
        REGIONAL PREFERENCES ARE NORMAL BROWSER SETTINGS — NOT FINGERPRINT PROTECTION · PAGE TIMEZONE/LOCALE ARE PROCESS-GLOBAL IN CHROMIUM (PARTIAL) · NO SPOOFING · NO NETWORK LOOKUPS · PROFILE-SCOPED
      </div>
    </>
  )
}

function Browsing() {
  const prefs = useNexa((s) => s.prefs)
  const id = useNexa((s) => s.activeProfile)
  return (
    <>
      <Row label="Show bookmark bar" desc="Toggle with ⌘⇧B. Shows Bookmark Bar folder items below the toolbar.">
        <Toggle on={prefs.bookmarkBar} onClick={() => useNexa.getState().setPref('bookmarkBar', !prefs.bookmarkBar)} />
      </Row>
      <Row label="Save browsing history" desc="Record pages you visit. Private tabs are never recorded.">
        <Toggle on={prefs.historyEnabled} onClick={() => useNexa.getState().setPref('historyEnabled', !prefs.historyEnabled)} />
      </Row>
      <Row label="History retention" desc="Older entries are pruned automatically on the next visit">
        <Cycle
          value={String(prefs.historyRetentionDays)}
          opts={['0', '7', '30', '90', '365']}
          onPick={(v) => useNexa.getState().setPref('historyRetentionDays', Number(v))}
        />
      </Row>
      <Row label="Clear browsing history" desc="Remove all locally stored history for this profile">
        <button
          className="ghost"
          style={{ color: 'var(--error)' }}
          onClick={async () => {
            const res = await window.nexa.history.clear({ profileId: id, range: 'all' })
            if (res?.ok) useNexa.getState().toastMsg('History cleared')
          }}
        >
          Clear all
        </button>
      </Row>
      <div className="honest" style={{ marginTop: 6 }}>
        RETENTION 0 = KEEP FOREVER · HISTORY IS LOCAL & PROFILE-SCOPED
      </div>
    </>
  )
}

function DownloadsSettings() {
  const sv = useNexa((s) => s.prefs.sv)
  const dir = useNexa((s) => s.downloadsDir)
  const settings = useNexa((s) => s.downloadSettings)
  const setSv = (k: keyof typeof sv, v: string) => useNexa.getState().setPref('sv', { ...sv, [k]: v })

  async function save(patch: Partial<NonNullable<typeof settings>>) {
    const base = settings || { askLocation: false, duplicatePolicy: 'rename' as const, maxConcurrent: 4, retryLimit: 3 }
    const next = { ...base, ...patch }
    useNexa.setState({ downloadSettings: next })
    const res = await window.nexa.downloads.saveSettings({ profileId: useNexa.getState().activeProfile, settings: next })
    if (res?.ok) useNexa.setState({ downloadSettings: res.data })
  }

  const s = settings || { askLocation: false, duplicatePolicy: 'rename' as const, maxConcurrent: 4, retryLimit: 3 }

  return (
    <>
      <Row label="Default folder" desc="Where downloads are saved when not asking each time">
        <button
          className="ghost"
          onClick={async () => {
            const res = await window.nexa.downloads.pickDirectory()
            if (res?.ok && res.data) {
              setSv('dlFolder', res.data)
              useNexa.setState({ downloadsDir: res.data })
            }
          }}
        >
          {sv.dlFolder === 'Downloads' ? dir || 'OS downloads folder' : sv.dlFolder}
        </button>
      </Row>
      <Row label="Ask where to save each file" desc="Show the native save dialog for every download instead of using the default folder">
        <Toggle on={s.askLocation} onClick={() => save({ askLocation: !s.askLocation })} />
      </Row>
      <Row label="Duplicate handling" desc="Rename keeps existing files safe; Replace overwrites the existing file">
        <Cycle
          value={s.duplicatePolicy === 'rename' ? 'Rename' : 'Replace'}
          opts={['Rename', 'Replace']}
          onPick={(v) => save({ duplicatePolicy: v === 'Replace' ? 'replace' : 'rename' })}
        />
      </Row>
      <Row label="Concurrent downloads" desc="Transfers that run at once — extras wait in the queue">
        <Cycle
          value={String(s.maxConcurrent)}
          opts={['1', '2', '3', '4', '5', '6', '8', '10']}
          onPick={(v) => save({ maxConcurrent: Number(v) })}
        />
      </Row>
      <Row label="Automatic retry limit" desc="How many times a failed download may be retried">
        <Cycle value={String(s.retryLimit)} opts={['0', '1', '3', '5', '10']} onPick={(v) => save({ retryLimit: Number(v) })} />
      </Row>
      <div className="honest" style={{ marginTop: 12 }}>
        NATIVE ENGINE ACTIVE · MULTI-CONNECTION / SEGMENTED TRANSFERS ARE A FUTURE ENGINE
      </div>
    </>
  )
}

function AiSettings() {
  const routed = useNexa((s) => s.aiStatus)
  // The Local AI controls always describe the Ollama runtime, whichever
  // provider chat is currently routed to.
  const status = routed?.local ?? routed
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<string | null>(null)

  useEffect(() => {
    void useNexa.getState().loadAiStatus()
  }, [])

  const connected = status?.state === 'connected'
  const models = status?.models || []
  const chatModels = models.filter((m) => !m.embedding)
  const embedModels = models.filter((m) => m.embedding)
  const chatInstalled = chatModels.some((m) => m.name === status?.chatModel)
  const embedInstalled = embedModels.some((m) => m.name === status?.embedModel)

  const selectLocalChat = async (name: string) => {
    if (!window.nexa) return
    await window.nexa.ai.selectModel({ profileId: useNexa.getState().activeProfile, chatModel: name })
    void useNexa.getState().loadAiStatus()
    useNexa.getState().toastMsg(`Local chat model · ${name}`)
  }

  const selectEmbed = async (name: string) => {
    if (!window.nexa) return
    await window.nexa.ai.selectModel({ profileId: useNexa.getState().activeProfile, embedModel: name })
    void useNexa.getState().loadAiStatus()
    useNexa.getState().toastMsg(`AI embedding model · ${name}`)
  }

  const test = async () => {
    if (!window.nexa) return
    setTesting(true)
    setTestMsg(null)
    const res = await window.nexa.ai.testConnection(useNexa.getState().activeProfile)
    await useNexa.getState().loadAiStatus()
    setTesting(false)
    setTestMsg(res?.ok && res.data.ok ? `Connected · ${res.data.models} models installed` : 'Ollama offline — start Ollama to use Local AI')
  }

  return (
    <>
      <div className="honest" style={{ marginBottom: 12 }}>
        NEXA FREE AI BY DEFAULT · PROVIDER KEYS NEVER STORED ON THIS DEVICE · PRIVATE TABS USE LOCAL AI ONLY · AI CANNOT READ THE VAULT
      </div>

      <AiGatewaySection />

      {/* Local AI connection */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', margin: '16px 2px 8px' }}>LOCAL AI · OLLAMA</div>
      <div className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
        <div className="row" style={{ gap: 9 }}>
          <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: connected ? 'var(--success)' : 'var(--text-3)' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Ollama</span>
          <span style={{ fontSize: 13, color: connected ? 'var(--success)' : 'var(--text-3)', fontWeight: 600 }}>{connected ? 'Connected' : 'Offline'}</span>
          <div style={{ flex: 1 }} />
          <button className="ghost" style={{ height: 30 }} disabled={testing} onClick={test}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button className="ghost" style={{ height: 30 }} onClick={() => void useNexa.getState().loadAiStatus()}>
            Refresh models
          </button>
        </div>
        {testMsg && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>{testMsg}</div>}
        {!connected && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
            Optional. Start Ollama to run AI fully on this device — required for AI in private tabs.
          </div>
        )}
      </div>
      <Row label="Endpoint" desc="Local loopback only — locked for security">
        <span style={{ fontSize: 12.5, color: 'var(--text-2)', fontFamily: 'var(--mono, monospace)' }}>{status?.endpoint || '127.0.0.1:11434'}</span>
      </Row>

      {/* Models */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', margin: '16px 2px 8px' }}>LOCAL MODELS</div>
      <Row label="Chat model" desc={chatInstalled ? 'Local model used when chat runs on Ollama' : 'MODEL NOT INSTALLED — choose an installed model'}>
        {chatModels.length > 0 ? (
          <Cycle value={status?.chatModel || ''} opts={chatModels.map((m) => m.name)} onPick={(v) => void selectLocalChat(v)} />
        ) : (
          <span className="honest">{connected ? 'NO CHAT MODEL' : 'NOT AVAILABLE'}</span>
        )}
      </Row>
      <Row label="Embedding model" desc={embedInstalled ? 'Model used for semantic features' : 'For semantic search features'}>
        {embedModels.length > 0 ? (
          <Cycle value={status?.embedModel || ''} opts={embedModels.map((m) => m.name)} onPick={(v) => void selectEmbed(v)} />
        ) : (
          <span className="honest">{connected ? 'NO EMBED MODEL' : 'NOT AVAILABLE'}</span>
        )}
      </Row>
      {connected && models.length > 0 && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', marginBottom: 8 }}>AVAILABLE MODELS</div>
          {models.map((m) => (
            <div key={m.name} className="row" style={{ padding: '5px 0', gap: 8, fontSize: 12.5 }}>
              <span style={{ flex: 1 }}>{m.name}</span>
              <span style={{ color: 'var(--text-3)' }}>{m.embedding ? 'embedding' : m.paramSize || 'chat'}</span>
            </div>
          ))}
        </div>
      )}

      {/* STEP 12 — Providers, privacy mode & fallback */}
      <AiProvidersSection />
    </>
  )
}

function StatusDot({ on, tone }: { on: boolean; tone?: string }) {
  return <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', flex: 'none', background: tone || (on ? 'var(--success)' : 'var(--text-3)') }} />
}

function AiGatewaySection() {
  const info = useNexa((s) => s.aiGateway)
  const config = useNexa((s) => s.aiConfig)
  const [connecting, setConnecting] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void Promise.all([useNexa.getState().loadAiGateway(), useNexa.getState().loadAiProviders()]).finally(() => setLoading(false))
  }, [])

  const configured = !!info?.configured
  const live = info?.configured === true && info.health === 'CONNECTED'
  const premium = info?.configured ? info.providers?.find((p) => p.id === 'openrouter') : undefined
  const usage = info?.configured ? info.usage : null
  const onNexa = config?.providerId === 'nexa'
  const mode = onNexa && config?.model?.startsWith('premium') ? 'premium' : onNexa ? 'free' : null
  const statusText = loading ? 'Checking…' : !configured ? 'Not configured' : live ? 'Connected' : info?.configured && info.health === 'NETWORK_OFFLINE' ? 'Offline' : 'Unavailable'

  const connect = async () => {
    const key = keyDraft.trim()
    if (!key) return
    setBusy(true)
    setError(null)
    const r = await useNexa.getState().connectPremiumAi(key)
    setKeyDraft('') // never retained in the renderer
    setBusy(false)
    if (r.ok) setConnecting(false)
    else setError(r.message || 'Could not connect OpenRouter.')
  }

  const disconnect = async () => {
    setBusy(true)
    await useNexa.getState().disconnectPremiumAi()
    setBusy(false)
  }

  const refresh = async () => {
    setLoading(true)
    await useNexa.getState().loadAiGateway()
    await useNexa.getState().loadAiStatus()
    setLoading(false)
  }

  return (
    <>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', margin: '4px 2px 8px' }}>AI PROVIDERS</div>

      {/* Default — NEXA Free AI */}
      <div className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.05em', marginBottom: 8 }}>DEFAULT AI</div>
        <div className="row" style={{ gap: 9, flexWrap: 'wrap' }}>
          <StatusDot on={live} tone={loading ? 'var(--warning)' : undefined} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>NEXA Free AI</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: live ? 'var(--success)' : 'var(--text-3)' }}>{statusText}</span>
          <div style={{ flex: 1 }} />
          {mode === 'free' ? (
            <span className="pill" style={{ fontSize: 11 }}>In use</span>
          ) : (
            <button className="ghost" style={{ height: 30 }} disabled={!live} onClick={() => void useNexa.getState().setNexaAiMode('free')}>
              Use NEXA Free AI
            </button>
          )}
          <button className="ghost" style={{ height: 30 }} disabled={loading} onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
          {!configured
            ? 'This build has no NEXA AI gateway configured. AI runs on Local AI (Ollama) when it is available.'
            : live
              ? 'No API key required. Requests go through the NEXA AI gateway, which chooses the model.'
              : (info?.configured && info.note) || 'NEXA AI is not reachable right now. Local AI is used as a fallback when available.'}
        </div>
        {live && usage && (
          <div className="row" style={{ gap: 14, marginTop: 8, fontSize: 12, color: 'var(--text-2)', flexWrap: 'wrap' }}>
            <span>
              Today: {usage.free.requests} of {usage.free.limit} free requests
            </span>
            <span style={{ color: 'var(--text-3)' }}>Resets at 00:00 UTC</span>
          </div>
        )}
      </div>

      {/* Premium — BYOK OpenRouter */}
      <div className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.05em', marginBottom: 8 }}>PREMIUM AI</div>
        <div className="row" style={{ gap: 9, flexWrap: 'wrap' }}>
          <StatusDot on={!!premium?.connected} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>OpenRouter</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: premium?.connected ? 'var(--success)' : 'var(--text-3)' }}>{premium?.connected ? 'Connected' : 'Not connected'}</span>
          <div style={{ flex: 1 }} />
          {premium?.connected ? (
            <>
              {mode === 'premium' ? (
                <span className="pill" style={{ fontSize: 11 }}>In use</span>
              ) : (
                <button className="ghost" style={{ height: 30 }} disabled={busy} onClick={() => void useNexa.getState().setNexaAiMode('premium')}>
                  Use Premium
                </button>
              )}
              <button className="ghost" style={{ height: 30 }} disabled={busy} onClick={() => void disconnect()}>
                Disconnect
              </button>
            </>
          ) : (
            !connecting && (
              <button className="primary" style={{ height: 30 }} disabled={!live} onClick={() => { setConnecting(true); setError(null) }}>
                Connect
              </button>
            )
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
          {premium?.connected
            ? `Key ${premium.keyHint || 'saved'} · encrypted on the NEXA server${premium.lastValidatedAt ? ` · verified ${new Date(premium.lastValidatedAt).toLocaleDateString()}` : ''}. Usage is billed to your OpenRouter account.`
            : 'Use your own OpenRouter API key for premium models. Optional — NEXA Free AI needs no key.'}
        </div>
        {connecting && !premium?.connected && (
          <form
            className="row"
            style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault()
              void connect()
            }}
          >
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="OpenRouter API key (sk-or-…)"
              aria-label="OpenRouter API key"
              autoFocus
              style={{ flex: '1 1 220px', minWidth: 0, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', padding: '0 10px', fontSize: 12.5 }}
            />
            <button type="submit" className="primary" style={{ height: 32 }} disabled={busy || keyDraft.trim().length < 20}>
              {busy ? 'Verifying…' : 'Connect'}
            </button>
            <button type="button" className="ghost" style={{ height: 32 }} disabled={busy} onClick={() => { setConnecting(false); setKeyDraft(''); setError(null) }}>
              Cancel
            </button>
          </form>
        )}
        {error && (
          <div role="alert" style={{ fontSize: 12, color: 'var(--error)', marginTop: 8 }}>
            {error}
          </div>
        )}
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
          Your key is sent once over HTTPS, verified with OpenRouter, encrypted with AES-256-GCM on the NEXA server, and never returned to this device.
        </div>
      </div>
    </>
  )
}

const PRIVACY_LABEL: Record<string, string> = {
  local_only: 'Local only',
  local_preferred: 'Local preferred',
  cloud_allowed: 'Cloud allowed'
}
const FALLBACK_LABEL: Record<string, string> = {
  none: 'No fallback',
  local_only: 'Local only',
  configured_provider: 'Configured provider'
}
const HEALTH_LABEL: Record<string, string> = {
  CONNECTED: 'Connected',
  CHECKING: 'Checking',
  OFFLINE: 'Offline',
  LOCAL_OFFLINE: 'Offline',
  NETWORK_OFFLINE: 'Network offline',
  NOT_CONFIGURED: 'Not configured',
  AUTH_ERROR: 'Auth error',
  RATE_LIMITED: 'Rate limited',
  UNSUPPORTED: 'Unsupported',
  ERROR: 'Error'
}
function healthTone(state: string): string {
  if (state === 'CONNECTED') return 'var(--success)'
  if (state === 'CHECKING') return 'var(--warning)'
  if (state === 'AUTH_ERROR' || state === 'ERROR') return 'var(--error)'
  return 'var(--text-3)'
}

function AiProvidersSection() {
  const providers = useNexa((s) => s.aiProviders)
  const config = useNexa((s) => s.aiConfig)
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void useNexa.getState().loadAiProviders(true)
  }, [])

  const direct = providers.filter((p) => p.id !== 'nexa')
  const cloud = direct.filter((p) => p.type === 'cloud')
  const chatProviders = providers.filter((p) => p.configured)
  const providerName = (id: string) => providers.find((p) => p.id === id)?.name || id

  const submitKey = async (id: string) => {
    const key = (keyDraft[id] || '').trim()
    if (!key) return
    setBusy(id)
    await useNexa.getState().configureAiProvider(id as never, key)
    setKeyDraft((d) => ({ ...d, [id]: '' })) // clear after submission — never retained
    setBusy(null)
  }

  return (
    <>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', margin: '16px 2px 8px' }}>DIRECT PROVIDERS</div>
      <div className="honest" style={{ marginBottom: 10 }}>OPTIONAL · KEYS STORED IN OS SECURE STORAGE · NEVER SENT TO THE RENDERER</div>
      {direct.map((p) => (
        <div key={p.id} className="card" style={{ padding: '12px 14px', marginBottom: 10 }}>
          <div className="row" style={{ gap: 9 }}>
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: healthTone(p.health) }} />
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.05em' }}>{p.type.toUpperCase()}</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: healthTone(p.health) }}>{HEALTH_LABEL[p.health] || p.health}</span>
          </div>
          {p.type === 'cloud' && (
            <div style={{ marginTop: 10 }}>
              {p.configured ? (
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', flex: 1 }}>Key configured · stored securely</span>
                  <button className="ghost" style={{ height: 30 }} disabled={busy === p.id} onClick={async () => { setBusy(p.id); await useNexa.getState().testAiProvider(p.id as never); setBusy(null) }}>
                    Test
                  </button>
                  <button className="ghost" style={{ height: 30 }} onClick={() => void useNexa.getState().removeAiProvider(p.id as never)}>
                    Remove
                  </button>
                </div>
              ) : (
                <div className="row" style={{ gap: 8 }}>
                  <input
                    type="password"
                    autoComplete="off"
                    value={keyDraft[p.id] || ''}
                    onChange={(e) => setKeyDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                    placeholder={`${p.name} API key`}
                    aria-label={`${p.name} API key`}
                    style={{ flex: 1, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', padding: '0 10px', fontSize: 12.5 }}
                  />
                  <button className="primary" style={{ height: 32 }} disabled={busy === p.id || !(keyDraft[p.id] || '').trim()} onClick={() => void submitKey(p.id)}>
                    {busy === p.id ? 'Saving…' : 'Save & Test'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', margin: '16px 2px 8px' }}>ROUTING & PRIVACY</div>
      <Row label="Active provider" desc="Provider used for AI tasks in this profile">
        <Cycle
          value={config?.providerId || 'nexa'}
          opts={(chatProviders.length ? chatProviders : providers).map((p) => p.id)}
          fmt={providerName}
          onPick={(v) => void useNexa.getState().updateAiConfig({ providerId: v as never })}
        />
      </Row>
      <Row label="Privacy mode" desc="Local only never sends data to the cloud. Cloud is opt-in.">
        <Cycle
          value={config?.privacyMode || 'cloud_allowed'}
          opts={['local_only', 'local_preferred', 'cloud_allowed']}
          fmt={(v) => PRIVACY_LABEL[v] || v}
          onPick={(v) => void useNexa.getState().updateAiConfig({ privacyMode: v as never })}
        />
      </Row>
      <Row label="Fallback" desc="Explicit fallback when the primary provider is unavailable">
        <Cycle
          value={config?.fallback || 'local_only'}
          opts={['none', 'local_only', 'configured_provider']}
          fmt={(v) => FALLBACK_LABEL[v] || v}
          onPick={(v) => void useNexa.getState().updateAiConfig({ fallback: v as never })}
        />
      </Row>
      <Row label="Vision" desc="Use the model's vision capability when available">
        <Cycle
          value={config?.vision || 'auto'}
          opts={['auto', 'off']}
          onPick={(v) => void useNexa.getState().updateAiConfig({ vision: v as never })}
        />
      </Row>
      <div style={{ fontSize: 11.5, color: 'var(--text-3)', margin: '4px 2px', lineHeight: 1.5 }}>
        {config?.privacyMode === 'local_only'
          ? 'Local only: AI runs only on this device through Ollama. Nothing is sent to NEXA AI or any cloud provider.'
          : cloud.some((p) => p.configured)
            ? 'A direct cloud provider is configured. It is used only when your privacy mode and fallback policy allow it.'
            : 'Chat uses NEXA AI unless you choose another provider. Private tabs always stay on Local AI.'}
      </div>
    </>
  )
}

function CloudSettings() {
  const drive = useNexa((s) => s.driveMeta)
  useEffect(() => {
    void useNexa.getState().driveRefreshStatus()
  }, [])
  const connected = !!drive?.connected
  const driveDesc = connected
    ? `Connected · ${drive?.email || 'Google account'}`
    : drive?.state === 'NOT_CONFIGURED'
      ? 'Not configured · requires OAuth credentials'
      : 'Read-only Drive access · downloads use NEXA’s download manager'
  return (
    <>
      <Row label="Google Drive" desc={driveDesc}>
        <div className="row" style={{ gap: 8 }}>
          <button className="ghost" style={{ height: 32 }} onClick={() => useNexa.getState().openDrive()}>
            {connected ? 'Open Drive' : 'Browse'}
          </button>
          {connected ? (
            <button className="ghost" style={{ height: 32 }} onClick={() => void useNexa.getState().driveDisconnect()}>
              Disconnect
            </button>
          ) : (
            <button
              className="ghost"
              style={{ height: 32 }}
              disabled={drive?.state === 'NOT_CONFIGURED'}
              onClick={() => void useNexa.getState().driveConnect()}
            >
              Connect
            </button>
          )}
        </div>
      </Row>
      {['Google Cloud Storage', 'Dropbox', 'OneDrive', 'Amazon S3'].map((name) => (
        <Row key={name} label={name} desc="Not configured · OAuth required">
          <button className="ghost" onClick={() => useNexa.getState().toastMsg(name + ' · not configured', 'warn')}>
            Connect
          </button>
        </Row>
      ))}
    </>
  )
}

function Privacy() {
  const t = useNexa((s) => s.prefs.toggles)
  const p = useNexa((s) => s.prefs.privacy)
  return (
    <>
      <Row label="Privacy diagnostics" desc="Real-time IP, DNS, WebRTC, fingerprint & permission checks. On-demand, session-only.">
        <button className="ghost" style={{ height: 32 }} onClick={() => useNexa.getState().openPrivacyCenter()}>
          Open Privacy Center
        </button>
      </Row>
      <Row label="Block trackers" desc="Preference saved. Enforcement needs the filter engine.">
        <Toggle on={t.trackerBlock} onClick={() => useNexa.getState().setPref('toggles', { ...t, trackerBlock: !t.trackerBlock })} />
      </Row>
      <Row label="Scan downloads" desc="Flag suspicious files before opening">
        <Toggle on={t.safeScan} onClick={() => useNexa.getState().setPref('toggles', { ...t, safeScan: !t.safeScan })} />
      </Row>
      <Row label="Telemetry" desc="Off by default. No NEXA analytics.">
        <Toggle on={p.telemetry} onClick={() => useNexa.getState().setPref('privacy', { ...p, telemetry: !p.telemetry })} />
      </Row>
      <Row label="Crash reports" desc="Off by default">
        <Toggle on={p.crash} onClick={() => useNexa.getState().setPref('privacy', { ...p, crash: !p.crash })} />
      </Row>
      <Row label="Data sharing" desc="Off by default">
        <Toggle on={p.dataSharing} onClick={() => useNexa.getState().setPref('privacy', { ...p, dataSharing: !p.dataSharing })} />
      </Row>
      <Row label="Secure DNS" desc="Preference only until a DNS module is wired">
        <Toggle on={p.secureDns} onClick={() => useNexa.getState().setPref('privacy', { ...p, secureDns: !p.secureDns })} />
      </Row>
    </>
  )
}

function contentFilterLabel() {
  const snap = useNexa.getState().protection
  if (!snap || snap.state === 'not_configured') return 'Not configured'
  if (snap.state === 'error') return 'Error'
  return snap.settings.enabled ? 'Active' : 'Off'
}
function contentFilterOk() {
  const snap = useNexa.getState().protection
  return !!snap && snap.state === 'active' && snap.settings.enabled
}
function vpnCenterLabel() {
  const v = useNexa.getState().vpn
  if (!v || v.state === 'not_configured') return 'Not configured'
  if (v.state === 'protected') return 'Protected'
  if (v.state === 'error') return 'Error'
  if (v.state === 'connecting') return 'Connecting'
  return 'Off'
}
function vpnCenterOk() {
  return useNexa.getState().vpn?.state === 'protected'
}

function SecurityCenter() {
  const vault = useNexa((s) => s.vaultExists)
  const unlocked = useNexa((s) => s.vaultUnlocked)
  const prot = useNexa((s) => s.protection)
  void prot
  const p = useNexa((s) => s.prefs.privacy)
  const items = [
    { k: 'Password vault', v: !vault ? 'Not created' : unlocked ? 'Unlocked' : 'Locked', ok: vault },
    { k: 'Telemetry', v: p.telemetry ? 'Enabled' : 'Off', ok: !p.telemetry },
    { k: 'Crash reports', v: p.crash ? 'Enabled' : 'Off', ok: !p.crash },
    { k: 'Data sharing', v: p.dataSharing ? 'Enabled' : 'Off', ok: !p.dataSharing },
    { k: 'VPN tunnel', v: vpnCenterLabel(), ok: vpnCenterOk() },
    { k: 'Content filter', v: contentFilterLabel(), ok: contentFilterOk() },
    { k: 'Update channel', v: 'Not configured', ok: false }
  ]
  return (
    <>
      {items.map((i) => (
        <div key={i.k} className="row card" style={{ padding: '14px 16px', marginBottom: 8 }}>
          {i.ok ? <Check size={16} color="var(--success)" /> : <ShieldCheck size={16} color="var(--text-3)" />}
          <div style={{ flex: 1, fontSize: 13.5 }}>{i.k}</div>
          <span className="mono" style={{ fontSize: 11, color: i.ok ? 'var(--success)' : 'var(--text-3)' }}>
            {i.v}
          </span>
        </div>
      ))}
    </>
  )
}

function Protection() {
  const snap = useNexa((s) => s.protection)
  const rules = useNexa((s) => s.protectionRules)
  const id = useNexa((s) => s.activeProfile)
  const s = snap?.settings || { enabled: true, ads: true, trackers: true, annoyances: true }

  async function save(patch: Partial<typeof s>) {
    const next = { ...s, ...patch }
    const res = await window.nexa.protection.saveSettings({ profileId: id, ...next })
    if (res?.ok) useNexa.getState().loadProtection()
  }

  return (
    <>
      <Row label="Content Protection" desc="Real network-level blocking via the browser session. Applies to all tabs in this profile.">
        <Toggle on={s.enabled} onClick={() => save({ enabled: !s.enabled })} />
      </Row>
      <Row label="Block trackers" desc="Analytics, telemetry and social trackers">
        <Toggle on={s.trackers} onClick={() => save({ trackers: !s.trackers })} />
      </Row>
      <Row label="Block ads" desc="Known advertising and ad-serving domains (network-level)">
        <Toggle on={s.ads} onClick={() => save({ ads: !s.ads })} />
      </Row>
      <Row label="Block annoyances" desc="Push-notification and pop-under networks">
        <Toggle on={s.annoyances} onClick={() => save({ annoyances: !s.annoyances })} />
      </Row>
      <Row label="Malicious domains" desc="No threat-intelligence source is configured">
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>NOT CONFIGURED</span>
      </Row>
      <Row label="Cosmetic filtering" desc="Element hiding is not implemented (network-level only)">
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>NOT CONFIGURED</span>
      </Row>

      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '18px 0 8px' }}>
        Filter lists
      </div>
      <div className="card" style={{ overflow: 'hidden', marginBottom: 12 }}>
        {(rules?.lists || []).map((l, i, arr) => (
          <div key={l.id} className="row" style={{ padding: '11px 14px', borderBottom: i === arr.length - 1 ? 'none' : '1px solid var(--border)', gap: 10 }}>
            <span style={{ flex: 1, fontSize: 13.5 }}>{l.name}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{l.rules.toLocaleString()} rules</span>
            <span className="row" style={{ gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--success)' }}>
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)' }} /> Active
            </span>
          </div>
        ))}
      </div>
      <Row label="External filter updates" desc="Downloading remote EasyList-style lists is not enabled in this build">
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>NOT CONFIGURED</span>
      </Row>
      <button className="ghost" style={{ marginTop: 8 }} onClick={() => useNexa.getState().setView('protection')}>
        Open Protection Dashboard
      </button>
      <div className="honest" style={{ marginTop: 12 }}>
        BUNDLED LISTS ACTIVE · {(rules?.totalRules || 0).toLocaleString()} RULES · EXTERNAL UPDATES / COSMETIC / MALICIOUS-DB NOT CONFIGURED
      </div>
    </>
  )
}

const VPN_STATE_LABEL: Record<string, string> = {
  protected: 'PROTECTED',
  connecting: 'CONNECTING',
  disconnecting: 'DISCONNECTING',
  error: 'ERROR',
  off: 'OFF',
  not_configured: 'NOT CONFIGURED'
}

const HELPER_STATE_LABEL: Record<string, string> = {
  installed: 'Installed',
  not_installed: 'Not installed',
  needs_authorization: 'Needs authorization',
  error: 'Error'
}

function DiagRow({ label, value, ok, last }: { label: string; value: string; ok: boolean; last?: boolean }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '7px 0', borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{label}</span>
      <span className="row" style={{ gap: 7, fontSize: 12.5, fontWeight: 600 }}>
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? 'var(--success)' : 'var(--text-3)' }} />
        {value}
      </span>
    </div>
  )
}

function VpnSettings() {
  const id = useNexa((s) => s.activeProfile)
  const vpn = useNexa((s) => s.vpn)
  const servers = useNexa((s) => s.vpnServers)
  const [settings, setSettings] = useState<import('../nexa').VpnSettings | null>(null)
  const [name, setName] = useState('')
  const [config, setConfig] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.nexa.vpn.getSettings(id).then((r) => r?.ok && setSettings(r.data))
    useNexa.getState().loadVpn()
  }, [id])

  const state = vpn?.state || 'not_configured'
  const capability = vpn?.capability || 'unknown'

  async function saveSettings(patch: Partial<NonNullable<typeof settings>>) {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    await window.nexa.vpn.updateSettings({
      profileId: id,
      autoConnect: next.autoConnect,
      killSwitch: next.killSwitch,
      dnsProtection: next.dnsProtection,
      ipv6: next.ipv6,
      disconnectOnExit: next.disconnectOnExit
    })
  }

  async function doImport() {
    if (!name.trim() || !config.trim()) {
      useNexa.getState().toastMsg('Enter a name and paste a WireGuard configuration', 'warn')
      return
    }
    setBusy(true)
    try {
      const r = await window.nexa.vpn.importConfig({ profileId: id, name: name.trim(), config })
      if (r?.ok) {
        setName('')
        setConfig('')
        useNexa.getState().toastMsg(`Imported · ${r.data.name}`)
        await useNexa.getState().loadVpn()
      } else {
        useNexa.getState().toastMsg(r?.error?.message || 'Invalid configuration', 'err')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* Status */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="row" style={{ gap: 8 }}>
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    state === 'protected' ? 'var(--success)' : state === 'error' ? 'var(--error)' : state === 'connecting' ? 'var(--warning)' : 'var(--text-3)'
                }}
              />
              <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.03em' }}>{VPN_STATE_LABEL[state]}</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3 }}>
              {vpn?.serverName ? `${vpn.serverName} · WireGuard` : 'System WireGuard'}
              {vpn?.lastError ? ` · ${vpn.lastError}` : ''}
            </div>
          </div>
          {state === 'protected' ? (
            <button className="ghost" disabled={busy} onClick={() => window.nexa.vpn.disconnect(id)}>
              Disconnect
            </button>
          ) : (
            <button
              className="primary"
              disabled={busy || capability === 'unavailable' || servers.length === 0}
              onClick={() => window.nexa.vpn.connect(id)}
            >
              Connect
            </button>
          )}
        </div>
      </div>

      {/* Native VPN diagnostics (P4.2) */}
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '4px 0 8px' }}>
        Native VPN diagnostics
      </div>
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <DiagRow
          label="WireGuard"
          value={capability === 'available' ? 'Available' : capability === 'unavailable' ? 'Not installed' : 'Detecting…'}
          ok={capability === 'available'}
        />
        <DiagRow label="Privileged helper" value={HELPER_STATE_LABEL[vpn?.helper?.state || 'not_installed']} ok={vpn?.helper?.state === 'installed'} />
        <DiagRow label="Helper version" value={vpn?.helper?.version != null ? String(vpn.helper.version) : '—'} ok={vpn?.helper?.version != null} />
        <DiagRow label="Transport" value={vpn?.helper?.installed ? 'Connected' : 'Unavailable'} ok={!!vpn?.helper?.installed} />
        <DiagRow label="Tunnel" value={state === 'protected' ? 'Active' : state === 'connecting' ? 'Connecting' : 'Disconnected'} ok={state === 'protected'} />
        <DiagRow
          label="Handshake"
          value={state === 'protected' && vpn?.health?.handshakeAgeSec != null ? `Verified · ${vpn.health.handshakeAgeSec}s ago` : 'Not verified'}
          ok={state === 'protected' && vpn?.health?.handshakeAgeSec != null}
        />
        <DiagRow label="Routing" value={state === 'protected' ? 'Applied (not verified)' : 'Not verified'} ok={false} />
        <DiagRow
          label="DNS"
          value={!settings?.dnsProtection ? 'Not configured' : vpn?.dnsProtection?.verified ? 'Verified' : 'Not verified'}
          ok={!!vpn?.dnsProtection?.verified}
        />
        <DiagRow label="Kill switch" value={vpn?.killSwitch?.enforced ? 'Active' : settings?.killSwitch ? 'Experimental' : 'Inactive'} ok={!!vpn?.killSwitch?.enforced} />
        <DiagRow label="IPv6" value={settings?.ipv6 === 'block' ? 'Blocked' : 'Allowed'} ok={settings?.ipv6 === 'block'} />
        <DiagRow label="Native test" value="Not executed" ok={false} last />
      </div>

      {/* Servers */}
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '4px 0 8px' }}>
        Servers
      </div>
      <div className="card" style={{ overflow: 'hidden', marginBottom: 12 }}>
        {servers.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5 }}>No VPN servers configured</div>
        ) : (
          servers.map((s, i) => (
            <div key={s.id} className="row" style={{ padding: '11px 14px', borderBottom: i === servers.length - 1 ? 'none' : '1px solid var(--border)', gap: 10 }}>
              <input
                type="radio"
                name="vpn-server"
                aria-label={`Select ${s.name}`}
                checked={vpn?.selectedServerId === s.id}
                onChange={() => window.nexa.vpn.selectServer({ profileId: id, serverId: s.id })}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{s.name}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.endpoint}</div>
              </div>
              <button
                className="icon-btn"
                aria-label={`Remove ${s.name}`}
                title="Remove"
                style={{ color: 'var(--error)' }}
                onClick={async () => {
                  await window.nexa.vpn.removeConfig({ profileId: id, serverId: s.id })
                  await useNexa.getState().loadVpn()
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Import */}
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '4px 0 8px' }}>
        Import WireGuard configuration
      </div>
      <input className="field" style={{ marginBottom: 8 }} placeholder="Server name" value={name} onChange={(e) => setName(e.target.value)} />
      <textarea
        className="field mono"
        style={{ width: '100%', minHeight: 120, resize: 'vertical', fontSize: 12 }}
        placeholder={'[Interface]\nPrivateKey = ...\nAddress = 10.0.0.2/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = ...\nEndpoint = host:51820\nAllowedIPs = 0.0.0.0/0'}
        value={config}
        onChange={(e) => setConfig(e.target.value)}
      />
      <button className="ghost" style={{ marginTop: 8, marginBottom: 16 }} disabled={busy} onClick={doImport}>
        Import configuration
      </button>

      {/* Privacy / advanced */}
      {settings && (
        <>
          <Row label="Auto-connect" desc="Conservative default. Only runs when a real tunnel can be created.">
            <select className="field" style={{ width: 180 }} value={settings.autoConnect} onChange={(e) => saveSettings({ autoConnect: e.target.value as never })}>
              <option value="never">Never</option>
              <option value="launch">On browser launch</option>
              <option value="profile">On profile activation</option>
            </select>
          </Row>
          <Row label="Kill switch" desc="EXPERIMENTAL — OS-level traffic enforcement is not verified in this build">
            <Toggle on={settings.killSwitch} onClick={() => saveSettings({ killSwitch: !settings.killSwitch })} />
          </Row>
          <Row label="DNS protection" desc="Applies the tunnel's DNS. Verification is not performed (shown UNVERIFIED).">
            <Toggle on={settings.dnsProtection} onClick={() => saveSettings({ dnsProtection: !settings.dnsProtection })} />
          </Row>
          <Row label="IPv6" desc="Block IPv6 to avoid leaks outside the tunnel, or allow it">
            <select className="field" style={{ width: 140 }} value={settings.ipv6} onChange={(e) => saveSettings({ ipv6: e.target.value as never })}>
              <option value="block">Block (recommended)</option>
              <option value="allow">Allow</option>
            </select>
          </Row>
          <Row label="Disconnect on exit" desc="Tear the tunnel down when NEXA closes">
            <Toggle on={settings.disconnectOnExit} onClick={() => saveSettings({ disconnectOnExit: !settings.disconnectOnExit })} />
          </Row>
        </>
      )}
      <div className="honest" style={{ marginTop: 12 }}>
        {capability === 'available'
          ? 'WIREGUARD DETECTED · KEYS IN OS SECURE STORAGE · TUNNEL REQUIRES ELEVATED PRIVILEGES'
          : capability === 'unavailable'
            ? 'WIREGUARD TOOLING NOT DETECTED · INSTALL WIREGUARD TO ENABLE · NEVER SHOWN AS PROTECTED'
            : 'DETECTING WIREGUARD CAPABILITY…'}
        {' · WEBRTC / KILL-SWITCH / DNS VERIFICATION: NOT CONFIGURED / EXPERIMENTAL'}
      </div>
    </>
  )
}

const RISK_COLOR: Record<string, string> = {
  LOW: 'var(--text-3)',
  MEDIUM: '#c98a2b',
  HIGH: '#d05a4a',
  BLOCKED: '#d05a4a'
}

function RiskPill({ risk }: { risk: string }) {
  return (
    <span
      title={`Risk indicator: ${risk}`}
      style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, padding: '2px 7px', borderRadius: 6, border: `1px solid ${RISK_COLOR[risk] || 'var(--border-2)'}`, color: RISK_COLOR[risk] || 'var(--text-3)' }}
    >
      {risk}
    </span>
  )
}

function Extensions() {
  const extensions = useNexa((s) => s.extensions)
  const [expanded, setExpanded] = useState<string | null>(null)
  useEffect(() => {
    void useNexa.getState().loadExtensions()
  }, [])
  const enabledCount = extensions.filter((e) => e.enabled).length

  return (
    <>
      <div className="honest" style={{ marginBottom: 12 }}>
        MANIFEST V3 · LOCAL UNPACKED ONLY · CHROMIUM SANDBOX · PER-PROFILE · NO NODE / NO SECRETS / NO GENERIC IPC
      </div>
      <div className="row card" style={{ padding: '12px 16px', marginBottom: 10, gap: 12, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>Installed extensions</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {extensions.length} installed · {enabledCount} enabled · {extensions.length - enabledCount} disabled
          </div>
        </div>
        <button className="primary" onClick={() => void useNexa.getState().installExtension()}>
          <Plus size={14} weight="bold" /> Install local extension
        </button>
      </div>

      {extensions.length === 0 && (
        <div className="honest" style={{ marginTop: 6 }}>
          NO EXTENSIONS INSTALLED — USE “INSTALL LOCAL EXTENSION” TO LOAD AN UNPACKED MV3 FOLDER
        </div>
      )}

      {extensions.map((x) => (
        <div key={x.id} className="card" style={{ padding: '12px 16px', marginBottom: 10 }}>
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{x.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>v{x.version}</span>
                <RiskPill risk={x.riskClass} />
                {x.lifecycle === 'ERROR' && <span className="honest" style={{ color: '#d05a4a' }}>ERROR</span>}
                {x.lifecycle === 'BLOCKED' && <span className="honest" style={{ color: '#d05a4a' }}>BLOCKED</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {x.permissions.length ? x.permissions.join(' · ') : 'No permissions'}
              </div>
            </div>
            <Toggle
              on={x.enabled}
              onClick={() => void useNexa.getState().setExtensionEnabled(x.id, !x.enabled)}
            />
          </div>

          <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="ghost" aria-expanded={expanded === x.id} onClick={() => setExpanded(expanded === x.id ? null : x.id)}>
              {expanded === x.id ? 'Hide details' : 'View permissions'}
            </button>
            <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Site access</span>
            <Cycle
              value={x.siteAccess}
              opts={['always', 'on_click', 'on_selected', 'never']}
              fmt={(v) => ({ always: 'Always', on_click: 'When clicked', on_selected: 'On selected sites', never: 'Never' })[v] || v}
              onPick={(v) => void useNexa.getState().setExtensionSiteAccess(x.id, v as never)}
            />
            <span style={{ flex: 1 }} />
            <label style={{ fontSize: 11.5, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={x.privateEnabled}
                disabled={!x.enabled}
                onChange={() => void useNexa.getState().setExtensionPrivate(x.id, !x.privateEnabled)}
              />
              Allow in private
            </label>
            <button className="ghost danger" onClick={() => void useNexa.getState().removeExtension(x.id)}>Remove</button>
          </div>

          {expanded === x.id && (
            <div style={{ marginTop: 10, borderTop: '1px solid var(--border-2)', paddingTop: 10, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7 }}>
              {x.description && <div style={{ marginBottom: 6 }}>{x.description}</div>}
              <div><strong>Permissions:</strong> {x.permissions.join(', ') || 'none'}</div>
              {x.highRisk.length > 0 && <div style={{ color: '#c98a2b' }}><strong>Elevated:</strong> {x.highRisk.join(', ')}</div>}
              <div><strong>Host access:</strong> {x.hostPermissions.join(', ') || 'none'}</div>
              {x.blockedPermissions.length > 0 && <div style={{ color: '#d05a4a' }}><strong>Blocked:</strong> {x.blockedPermissions.join(', ')}</div>}
              <div>
                <strong>Runtime:</strong>{' '}
                {[x.hasBackground && 'service worker', x.hasContentScripts && 'content scripts', x.hasAction && 'toolbar action'].filter(Boolean).join(', ') || 'none'}
              </div>
              <div className="honest" style={{ marginTop: 6 }}>SOURCE: {x.source} · STATUS: {x.lifecycle}</div>
            </div>
          )}
        </div>
      ))}
    </>
  )
}

function Advanced() {
  const t = useNexa((s) => s.prefs.toggles)
  const sv = useNexa((s) => s.prefs.sv)
  return (
    <>
      <Row label="Auto-update" desc="No channel configured — this toggle will not claim the app is up to date">
        <Toggle on={t.autoUpdate} onClick={() => useNexa.getState().setPref('toggles', { ...t, autoUpdate: !t.autoUpdate })} />
      </Row>
      <Row label="Update channel" desc="Stable when a signed feed exists">
        <Cycle value={sv.updateChannel} opts={['Stable', 'Beta']} onPick={(v) => useNexa.getState().setPref('sv', { ...sv, updateChannel: v })} />
      </Row>
      <Row label="Developer tools" desc="F12 opens Chromium DevTools once the inspector host is wired">
        <span className="honest">NOT CONFIGURED</span>
      </Row>
    </>
  )
}

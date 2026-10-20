import { useEffect, useRef, useState, createElement, type ReactNode } from 'react'
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  BookmarkSimple,
  Briefcase,
  CaretDown,
  CaretUp,
  Check,
  CheckCircle,
  ClipboardText,
  ClockCounterClockwise,
  Cloud,
  Copy,
  DownloadSimple,
  EyeSlash,
  Gear,
  Globe,
  House,
  Info,
  Key,
  Lightning,
  LockSimple,
  MagnifyingGlass,
  Minus,
  Moon,
  PaperPlaneRight,
  Palette as PaletteIcon,
  PencilSimple,
  Plus,
  PushPin,
  PuzzlePiece,
  StopCircle,
  Trash,
  ShieldCheck,
  ShieldSlash,
  ShieldStar,
  SidebarSimple,
  Sparkle,
  Square,
  SquaresFour,
  Stack,
  Star,
  Sun,
  TerminalWindow,
  UserCircle,
  UserPlus,
  Warning,
  X
} from '@phosphor-icons/react'
import { applyTheme, ACCENT_SWATCHES } from './design-system/theme'
import { activeProfile, useNexa, restoreOverlayFocus, type AiChatMessage, setAgentExecutor, setWorkerScanner, setVaultAutofill, setPrivacyProbe, type PrivacyProbeResult, type WorkerScanResult } from './state/store'
import { findLoginFields, type VaultFieldInput } from '@shared/vault-autofill'
import type { PermissionStatus, RawIceCandidate } from '@shared/privacy'
import { PrivacyCenterView } from './views/PrivacyCenter'
import { DriveView } from './views/Drive'
import { DASH_PRESETS, looksLikeUrl, normalizeUrl, type ChromeView, type VaultMetaCredential } from '@shared/types'
import {
  DASHBOARD_WIDGETS,
  hiddenDashboardWidgets,
  hideWidget,
  moveWidget,
  normalizeDashboardLayout,
  showWidget
} from '@shared/dashboard'
import { passwordStrength } from '@shared/strength'
import { SettingsView } from './views/Settings'
import { NewTabView } from './views/NewTab'
import { BookmarksView } from './views/Bookmarks'
import { HistoryView } from './views/History'
import { CollectionsView } from './views/Collections'
import { DownloadsView } from './views/Downloads'
import { ProtectionView } from './views/Protection'
import { ROOT_BAR, type BookmarkItem } from '@shared/library'
import { hostnameOf, registrableDomain } from '@shared/protection'
import { resolveClickToGo, NEXA_COMMANDS, type Suggestion } from '@shared/click-to-go'
import { vpnUiProjection, vpnToneColor } from '@shared/vpn-ui'
import { summarizePerf, turboStateLabel } from '@shared/turbo'
import { prettyModelName, aiErrorMessage, MAX_CONTEXT_CHARS, type RewriteMode } from '@shared/ai'
import { normalizePageExtract, type PageExtract, type RawPageExtract } from '@shared/page-content'
import {
  buildObservation,
  formatObservation,
  sanitizeExtractedLinks,
  type RawObservation
} from '@shared/observation'
import {
  scanObservation,
  WORKER_MAX_CONTEXT_CHARS,
  type WorkerAnswer,
  type WorkerButtonClass,
  type WorkerRawExtras,
  type WorkerState as WorkerStateT
} from '@shared/worker'
import {
  boundImageDims,
  formatFusedTargets,
  fuseVisualTargets,
  parseVisionResponse,
  VISION_INJECTION_GUARD
} from '@shared/vision'
import { agentErrorMessage } from '@shared/agent'
import type { SiteState } from './nexa'

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function Avatar({ size, src, name, accent }: { size: number; src: string | null; name: string; accent: string }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: accent,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--on-accent)',
        fontSize: size * 0.38,
        fontWeight: 700,
        overflow: 'hidden',
        flex: 'none'
      }}
    >
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(name)}
    </span>
  )
}

// macOS detection for native traffic-light spacing (synchronous, flash-free).
const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)

export function App() {
  const hydrated = useNexa((s) => s.hydrated)
  const hydrate = useNexa((s) => s.hydrate)
  const prefs = useNexa((s) => s.prefs)
  const global = useNexa((s) => s.global)
  const overlay = useNexa((s) => s.overlay)
  const toast = useNexa((s) => s.toast)
  const toastMsg = useNexa((s) => s.toastMsg)
  const workerOpen = useNexa((s) => s.workerOpen)
  const aiOpen = useNexa((s) => s.aiOpen)

  useEffect(() => {
    hydrate()
  }, [hydrate])

  useEffect(() => {
    applyTheme(document.documentElement, {
      theme: prefs.theme,
      accent: prefs.accent,
      radius: prefs.radius,
      addrStyle: prefs.addrStyle,
      motion: prefs.motion,
      density: prefs.density
    })
    document.documentElement.style.background = prefs.theme === 'dark' ? '#08090b' : '#e8eaed'
  }, [prefs])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      const st = useNexa.getState()
      if (mod && !e.shiftKey && k === 't') {
        e.preventDefault()
        st.newTab()
      } else if (mod && e.shiftKey && k === 't') {
        e.preventDefault()
        st.reopenClosedTab()
      } else if (mod && !e.shiftKey && k === 'w') {
        e.preventDefault()
        st.closeTab(st.session.activeTab)
      } else if (mod && !e.shiftKey && k === 'k') {
        e.preventDefault()
        st.setOverlay(st.overlay === 'palette' ? null : 'palette')
      } else if (mod && !e.shiftKey && k === 'd') {
        e.preventDefault()
        st.bookmarkCurrent()
      } else if (mod && e.shiftKey && k === 'b') {
        e.preventDefault()
        st.setPref('bookmarkBar', !st.prefs.bookmarkBar)
      } else if (mod && !e.shiftKey && k === 'h') {
        e.preventDefault()
        st.setView('history')
      } else if (mod && !e.shiftKey && k === 'l') {
        e.preventDefault()
        const el = document.querySelector('.omnibox input') as HTMLInputElement | null
        el?.focus()
        el?.select()
      } else if (mod && e.shiftKey && k === 'n') {
        e.preventDefault()
        st.newPrivateTab()
      } else if (mod && e.shiftKey && k === 'a') {
        e.preventDefault()
        useNexa.setState({ aiOpen: !st.aiOpen })
      } else if (mod && e.shiftKey && k === 'd') {
        e.preventDefault()
        st.setView('downloads')
      } else if (mod && e.shiftKey && k === 'c') {
        e.preventDefault()
        st.setView('cloud')
      } else if (mod && e.key === ',') {
        e.preventDefault()
        st.setView('settings')
      } else if (mod && e.shiftKey && k === 'h') {
        e.preventDefault()
        useNexa.setState({ global: { headerVisible: !st.global.headerVisible } })
        st.persistGlobal()
      } else if (k === 'escape') {
        st.setOverlay(null)
      } else if (k === 'f12') {
        e.preventDefault()
        toastMsg('DevTools require the Chromium inspector host — not configured in this build', 'warn')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toastMsg])

  useEffect(() => {
    if (!overlay) restoreOverlayFocus()
  }, [overlay])

  if (!hydrated) {
    return (
      <div className="app" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <img src="./assets/nexa-icon.png" alt="NEXA" width={64} height={64} />
      </div>
    )
  }

  return (
    <div className="app">
      {global.headerVisible && <TitleBar />}
      <TabStrip />
      <Toolbar />
      <BookmarkBar />
      <div className="body" data-panels={Number(aiOpen) + Number(workerOpen)}>
        {prefs.sidebarOpen && <Sidebar />}
        <div className="main">
          <NavProgress />
          <Content />
          <StatusBar />
        </div>
        {aiOpen && <AiPanel />}
        {workerOpen && <WorkerPanel />}
      </div>
      {overlay === 'palette' && <Palette />}
      {overlay === 'profile' && <ProfileMenu />}
      {overlay === 'vpn' && <VpnPanel />}
      {overlay === 'theme' && <ThemePicker />}
      {overlay === 'customize' && <CustomizeDash />}
      {overlay === 'editProfile' && <EditProfile />}
      {overlay === 'addProfile' && <AddProfile />}
      {overlay === 'ad' && <AdPanel />}
      {overlay === 'credential' && <CredentialModal />}
      {overlay === 'turbo' && <TurboPopover />}
      {toast && (
        <div className="toast">
          {toast.tone === 'warn' ? (
            <Warning size={18} color="var(--warning)" weight="fill" />
          ) : toast.tone === 'err' ? (
            <Warning size={18} color="var(--error)" weight="fill" />
          ) : (
            <CheckCircle size={18} color="var(--success)" weight="fill" />
          )}
          <span style={{ fontSize: 13, fontWeight: 500, minWidth: 0, overflowWrap: 'anywhere' }}>{toast.msg}</span>
          <button aria-label="Dismiss notification" onClick={() => useNexa.setState({ toast: null })}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

function TitleBar() {
  return (
    <div className="titlebar drag">
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <img src="./assets/nexa-icon.png" alt="NEXA" width={22} height={22} />
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.03em' }}>NEXA</span>
        <span className="pill">OPEN SOURCE</span>
      </div>
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <button className="icon-btn" onClick={() => useNexa.getState().toggleTheme()} title="Toggle theme">
          {useNexa.getState().prefs.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <div style={{ width: 1, height: 16, background: 'var(--border-2)', margin: '0 2px' }} />
        <button className="icon-btn" onClick={() => window.nexa.window.minimize()}>
          <Minus size={14} />
        </button>
        <button className="icon-btn" onClick={() => window.nexa.window.maximize()}>
          <Square size={12} />
        </button>
        <button
          className="icon-btn"
          onClick={() => window.nexa.window.close()}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--error)'
            e.currentTarget.style.color = 'var(--on-accent)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = ''
            e.currentTarget.style.color = ''
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

function TabStrip() {
  const session = useNexa((s) => s.session)
  const toggleTheme = useNexa((s) => s.toggleTheme)
  const theme = useNexa((s) => s.prefs.theme)
  const headerVisible = useNexa((s) => s.global.headerVisible)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])

  useEffect(() => {
    scrollRef.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [session.activeTab, session.tabs.length])

  return (
    <div className={`tabstrip drag${IS_MAC && !headerVisible ? ' mac-inset' : ''}`}>
      <div className="no-drag tabs-wrap">
        <div
          ref={scrollRef}
          className="tabs-scroll"
          role="tablist"
          aria-label="Tabs"
          onWheel={(e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
          }}
        >
        {session.tabs.map((t) => {
          const active = t.id === session.activeTab
          return (
            <div
              key={t.id}
              className={`tab ${active ? 'active' : ''}`}
              role="tab"
              tabIndex={active ? 0 : -1}
              aria-selected={active}
              title={t.title}
              onClick={() => useNexa.getState().activateTab(t.id)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  useNexa.getState().activateTab(t.id)
                } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault()
                  const sib = (e.key === 'ArrowRight' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling) as HTMLElement | null
                  sib?.focus()
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ id: t.id, x: e.clientX, y: e.clientY })
              }}
              onAuxClick={(e) => {
                // Middle-click closes the tab.
                if (e.button === 1) {
                  e.preventDefault()
                  useNexa.getState().closeTab(t.id)
                }
              }}
            >
              {t.pinned ? (
                <Star size={11} weight="fill" color="var(--accent)" style={{ flex: 'none' }} />
              ) : t.private ? (
                <EyeSlash size={12} color="var(--text-2)" style={{ flex: 'none' }} />
              ) : (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: t.kind === 'web' ? 'var(--accent)' : 'var(--text-3)',
                    flex: 'none'
                  }}
                />
              )}
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: active ? 600 : 500,
                  color: active ? 'var(--text)' : 'var(--text-2)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flex: 1
                }}
              >
                {t.title}
              </span>
              <button
                className="tab-x"
                title="Close tab (⌘W)"
                aria-label="Close tab"
                onClick={(e) => {
                  e.stopPropagation()
                  useNexa.getState().closeTab(t.id)
                }}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
        </div>
        <button className="icon-btn" title="New tab (⌘T)" aria-label="New tab" onClick={() => useNexa.getState().newTab()} style={{ flex: 'none', alignSelf: 'center' }}>
          <Plus size={15} />
        </button>
      </div>
      <button
        className="no-drag"
        onClick={() => useNexa.getState().setOverlay('palette')}
        style={{
          height: 28,
          marginLeft: 'auto',
          flex: 'none',
          alignSelf: 'center',
          marginBottom: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '0 10px',
          borderRadius: 7,
          color: 'var(--text-3)',
          border: '1px solid var(--border)'
        }}
      >
        <MagnifyingGlass size={13} />
        <span style={{ fontSize: 11.5 }}>Search tabs</span>
        <span className="mono" style={{ fontSize: 10, border: '1px solid var(--border-2)', borderRadius: 3, padding: '0 4px' }}>
          ⌘K
        </span>
      </button>
      <button className="icon-btn no-drag" onClick={toggleTheme} title="Toggle theme">
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <button
        className="icon-btn no-drag"
        title={headerVisible ? 'Hide title bar' : 'Show title bar'}
        onClick={() => {
          useNexa.setState({ global: { headerVisible: !headerVisible } })
          useNexa.getState().persistGlobal()
        }}
      >
        <SquaresFour size={15} />
      </button>
      {menu && (() => {
        const t = session.tabs.find((x) => x.id === menu.id)
        if (!t) return null
        const st = useNexa.getState()
        const run = (fn: () => void) => {
          fn()
          setMenu(null)
        }
        return (
          <>
            <div
              className="no-drag"
              onClick={() => setMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu(null)
              }}
              style={{ position: 'fixed', inset: 0, zIndex: 70 }}
            />
            <div
              className="menu no-drag"
              role="menu"
              style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 210) }}
            >
              <button role="menuitem" className="menu-item" onClick={() => run(() => st.newTab())}>
                <Plus size={14} /> New Tab <span className="kbd">⌘T</span>
              </button>
              {t.kind === 'web' && t.id === session.activeTab && (
                <button
                  role="menuitem"
                  className="menu-item"
                  onClick={() =>
                    run(() => {
                      const el = document.querySelector('webview') as HTMLElement & { reload?: () => void }
                      el?.reload?.()
                    })
                  }
                >
                  <ArrowClockwise size={14} /> Reload
                </button>
              )}
              <button role="menuitem" className="menu-item" onClick={() => run(() => st.pinTab(t.id))}>
                <PushPin size={14} weight={t.pinned ? 'fill' : 'regular'} /> {t.pinned ? 'Unpin Tab' : 'Pin Tab'}
              </button>
              <div className="menu-sep" />
              <button role="menuitem" className="menu-item" onClick={() => run(() => st.reopenClosedTab())}>
                <ClockCounterClockwise size={14} /> Reopen Closed Tab <span className="kbd">⌘⇧T</span>
              </button>
              <button role="menuitem" className="menu-item danger" onClick={() => run(() => st.closeTab(t.id))}>
                <X size={14} /> Close Tab <span className="kbd">⌘W</span>
              </button>
            </div>
          </>
        )
      })()}
    </div>
  )
}

function suggestionIcon(s: Suggestion) {
  switch (s.group) {
    case 'URL':
      return <Globe size={15} color="var(--text-2)" />
    case 'NEXA':
      return <Lightning size={15} weight="fill" color="var(--accent)" />
    case 'SERVICES':
      return <Globe size={15} color="var(--accent)" />
    case 'PAGE':
      return <Sparkle size={15} weight="fill" color="var(--accent)" />
    default:
      return <MagnifyingGlass size={15} color="var(--text-3)" />
  }
}

/**
 * Deterministic Click-to-Go execution. Maps a *resolved, registered* suggestion to an
 * existing capability-specific store action. There is intentionally no generic
 * execution path: only registered ids and http(s) URLs validated by the resolver reach
 * here. AI never routes navigation.
 */
function executeClickToGo(s: Suggestion) {
  const st = useNexa.getState()
  switch (s.kind) {
    case 'url':
    case 'search':
      // navigate() already handles URL-vs-search, private mode, profile + history prefs.
      st.navigate(s.url || s.query || '')
      break
    case 'service':
      if (s.url) st.navigate(s.url)
      break
    case 'command': {
      const def = NEXA_COMMANDS.find((c) => c.id === s.commandId)
      if (!def) break
      if (def.panel === 'worker') st.setWorkerOpen(true)
      else if (def.panel === 'vault') st.setVaultAutofillOpen(true)
      else if (def.overlay) st.setOverlay(def.overlay as Parameters<typeof st.setOverlay>[0])
      else if (def.settingsSection) st.setView('settings', def.settingsSection)
      else if (def.view) st.setView(def.view)
      break
    }
    case 'page_action':
      if (s.actionId === 'summarize') void aiSummarizePage()
      else if (s.actionId === 'ask') void aiAskAboutPage()
      else if (s.actionId === 'scan')
        void st.agentStart('Observe the current page and describe its structure and the main interactive elements.')
      else if (s.actionId === 'answer')
        void (async () => {
          await st.workerScanPage()
          await useNexa.getState().workerGenerate()
        })()
      break
  }
}

function Omnibox() {
  const addr = useNexa((s) => s.addr)
  const tab = useNexa((s) => s.session.tabs.find((t) => t.id === s.session.activeTab))
  const aiConnected = useNexa((s) => s.aiStatus?.state === 'connected')
  const searchEngine = useNexa((s) => s.prefs.sv.search)
  const [focused, setFocused] = useState(false)
  const [escHide, setEscHide] = useState(false)
  const [sel, setSel] = useState(0)

  const onWebPage = tab?.kind === 'web' && !!tab.url
  // Resolution is synchronous + deterministic (no debounce, no AI, no async work).
  const suggestions = resolveClickToGo(addr, { onWebPage, hasSelection: false, aiConnected, searchEngine })

  // STEP 9 — Turbo safe navigation prediction: when the user is typing a clear
  // URL, warm the connection to its origin (debounced, deduped, non-sensitive,
  // never in private mode). Store action re-checks all gates; main re-validates.
  useEffect(() => {
    if (!focused) return
    const raw = addr.trim()
    if (!raw || !looksLikeUrl(raw)) return
    const t = setTimeout(() => useNexa.getState().turboPreconnect(normalizeUrl(raw)), 220)
    return () => clearTimeout(t)
  }, [addr, focused])
  const show = focused && !escHide && suggestions.length > 0
  const selIdx = suggestions.length ? Math.min(sel, suggestions.length - 1) : 0

  const runAt = (i: number) => {
    const s = suggestions[i]
    if (!s) return
    setEscHide(true)
    executeClickToGo(s)
  }

  let lastGroup = ''
  return (
    <div className="omnibox" style={{ position: 'relative' }}>
      <LockSimple size={13} color={tab?.kind === 'web' ? 'var(--success)' : 'var(--text-3)'} />
      <input
        value={addr}
        placeholder="Search the web, enter a URL, ask AI, or run a command…"
        role="combobox"
        aria-expanded={show}
        aria-controls="omni-list"
        aria-activedescendant={show && suggestions[selIdx] ? `omni-opt-${selIdx}` : undefined}
        onChange={(e) => {
          useNexa.setState({ addr: e.target.value })
          setEscHide(false)
          setSel(0)
        }}
        onFocus={() => {
          setFocused(true)
          setEscHide(false)
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && show) {
            e.preventDefault()
            setSel((s) => Math.min(s + 1, suggestions.length - 1))
          } else if (e.key === 'ArrowUp' && show) {
            e.preventDefault()
            setSel((s) => Math.max(s - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (show) runAt(selIdx)
            else useNexa.getState().navigate(addr)
          } else if (e.key === 'Escape' && show) {
            e.preventDefault()
            setEscHide(true)
          }
        }}
        style={{ flex: 1, background: 'none', border: 'none', fontSize: 13 }}
      />
      <button
        onClick={() => useNexa.setState({ aiOpen: true })}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          height: 26,
          padding: '0 9px',
          borderRadius: 7,
          background: 'var(--accent-weak)',
          color: 'var(--accent-2)'
        }}
      >
        <Sparkle size={13} weight="fill" />
        <span style={{ fontSize: 11.5, fontWeight: 600 }}>Ask AI</span>
      </button>
      <BookmarkStar />
      {show && (
        <div id="omni-list" role="listbox" aria-label="Click-to-Go suggestions" className="omni-pop">
          {suggestions.map((s, i) => {
            const header = s.group !== lastGroup ? ((lastGroup = s.group), s.group) : null
            const selected = i === selIdx
            return (
              <div key={s.key}>
                {header && (
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      color: 'var(--text-3)',
                      padding: i === 0 ? '3px 10px 5px' : '9px 10px 5px'
                    }}
                  >
                    {header}
                  </div>
                )}
                <button
                  id={`omni-opt-${i}`}
                  role="option"
                  aria-selected={selected}
                  ref={(el) => {
                    if (selected && el) el.scrollIntoView({ block: 'nearest' })
                  }}
                  onMouseMove={() => sel !== i && setSel(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    runAt(i)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 8,
                    textAlign: 'left',
                    gap: 10,
                    background: selected ? 'var(--accent-weak)' : 'transparent'
                  }}
                >
                  {suggestionIcon(s)}
                  <span
                    style={{
                      fontSize: 13,
                      flex: 1,
                      color: selected ? 'var(--accent-2)' : 'var(--text)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {s.label}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--text-3)', flexShrink: 0 }}>{s.sublabel}</span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Toolbar() {
  const prof = useNexa((s) => s.profiles[s.activeProfile])
  const activeId = useNexa((s) => s.session.activeTab)
  const onWeb = useNexa((s) => {
    const t = s.session.tabs.find((x) => x.id === s.session.activeTab)
    return t?.kind === 'web' && !!t.url
  })
  const nav = useNexa((s) => s.webNav)
  const canBack = onWeb && nav?.tabId === activeId && nav.canBack
  const canForward = onWeb && nav?.tabId === activeId && nav.canForward
  const webview = () => document.querySelector('webview') as WebviewEl | null
  return (
    <div className="toolbar">
      <button
        className="icon-btn"
        title="Toggle sidebar"
        aria-label="Toggle sidebar"
        onClick={() => useNexa.getState().setPref('sidebarOpen', !useNexa.getState().prefs.sidebarOpen)}
      >
        <SidebarSimple size={16} />
      </button>
      <button className="icon-btn" disabled={!canBack} title="Back" aria-label="Back" onClick={() => webview()?.goBack?.()}>
        <ArrowLeft size={16} />
      </button>
      <button className="icon-btn" disabled={!canForward} title="Forward" aria-label="Forward" onClick={() => webview()?.goForward?.()}>
        <ArrowRight size={16} />
      </button>
      <button className="icon-btn" title="Reload" aria-label="Reload" disabled={!onWeb} onClick={() => webview()?.reload?.()}>
        <ArrowClockwise size={16} />
      </button>
      <Omnibox />
      <DownloadsButton />
      <button className="icon-btn" title="AI panel (⌘⇧A)" aria-label="Toggle AI panel" onClick={() => useNexa.setState({ aiOpen: !useNexa.getState().aiOpen })}>
        <Sparkle size={17} />
      </button>
      <button className="icon-btn" title="Worker Assistant" onClick={() => useNexa.getState().setWorkerOpen(!useNexa.getState().workerOpen)}>
        <Briefcase size={17} />
      </button>
      <VaultButton />
      <ProtectionButton />
      <VpnButton />
      <TurboButton />
      <button className="icon-btn" title="Extensions" onClick={() => useNexa.getState().setView('settings', 'extensions')}>
        <PuzzlePiece size={17} />
      </button>
      <button onClick={() => useNexa.getState().setOverlay('profile')} title={prof?.name}>
        <Avatar size={29} src={prof?.avatar ?? null} name={prof?.name || 'N'} accent={prof?.accent || '#4b57e6'} />
      </button>
    </div>
  )
}

function DownloadsButton() {
  const downloads = useNexa((s) => s.downloads)
  const active = downloads.filter((d) => d.status === 'downloading').length
  const queued = downloads.filter((d) => d.status === 'queued' || d.status === 'paused').length
  const badge = active + queued
  return (
    <button
      className="icon-btn"
      title={active ? `${active} active download${active === 1 ? '' : 's'}` : 'Downloads'}
      onClick={() => useNexa.getState().setView('downloads')}
      style={{ position: 'relative' }}
    >
      <DownloadSimple size={17} weight={active ? 'fill' : 'regular'} color={active ? 'var(--accent)' : undefined} />
      {badge > 0 && (
        <span
          aria-label={`${badge} download${badge === 1 ? '' : 's'} in progress`}
          style={{
            position: 'absolute',
            top: 1,
            right: 1,
            minWidth: 14,
            height: 14,
            padding: '0 3px',
            borderRadius: 7,
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            fontSize: 9,
            fontWeight: 700,
            lineHeight: '14px',
            textAlign: 'center'
          }}
        >
          {badge}
        </span>
      )}
    </button>
  )
}

function ProtectionButton() {
  const tab = useNexa((s) => s.session.tabs.find((t) => t.id === s.session.activeTab))
  const snap = useNexa((s) => (tab?.private ? s.protectionPrivate : s.protection))
  const state = snap?.state || 'not_configured'
  const enabled = snap?.settings.enabled ?? true
  const host = tab?.kind === 'web' && tab.url ? hostnameOf(tab.url) : ''
  const domain = host ? registrableDomain(host) : ''
  const blocked = domain && snap ? snap.perDomain[domain]?.blocked || 0 : 0
  const color =
    state === 'error' ? 'var(--error)' : !enabled || state === 'off' ? 'var(--text-2)' : state === 'not_configured' ? 'var(--warning)' : 'var(--success)'
  const label =
    state === 'error' ? 'Protection error' : !enabled ? 'Protection off' : state === 'not_configured' ? 'Protection not configured' : `Protection active · ${blocked} blocked here`
  return (
    <button
      className="icon-btn"
      title={label}
      aria-label={label}
      onClick={() => useNexa.getState().setOverlay('ad')}
      style={{ position: 'relative', color }}
    >
      <ShieldStar size={17} weight={enabled && state === 'active' ? 'fill' : 'regular'} />
      {enabled && state === 'active' && blocked > 0 && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            minWidth: 14,
            height: 14,
            padding: '0 3px',
            borderRadius: 7,
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            fontSize: 9,
            fontWeight: 700,
            lineHeight: '14px',
            textAlign: 'center'
          }}
        >
          {blocked > 99 ? '99+' : blocked}
        </span>
      )}
    </button>
  )
}

/**
 * STEP 6 — Secure vault autofill toolbar control. Shows a compact key indicator
 * only when relevant (on a web page with a configured vault). Clicking opens the
 * secure autofill popover. No continuous background scanning.
 */
function VaultButton() {
  const tab = useNexa((s) => s.session.tabs.find((t) => t.id === s.session.activeTab))
  const vaultExists = useNexa((s) => s.vaultExists)
  const open = useNexa((s) => s.vaultAutofillOpen)
  const isWeb = tab?.kind === 'web' && !!tab.url
  if (!isWeb || !vaultExists) return null
  return (
    <div style={{ position: 'relative', display: 'flex' }}>
      <button
        className="icon-btn"
        title="Saved logins"
        aria-label="Saved logins"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => useNexa.getState().setVaultAutofillOpen(!useNexa.getState().vaultAutofillOpen)}
        style={{ color: open ? 'var(--accent)' : undefined }}
      >
        <Key size={17} weight={open ? 'fill' : 'regular'} />
      </button>
      {open && <VaultAutofillPopover />}
    </div>
  )
}

function maskDots(len = 12): string {
  return '•'.repeat(Math.max(8, Math.min(16, len)))
}

function VaultAutofillPopover() {
  const state = useNexa((s) => s.vaultAutofillState)
  const matches = useNexa((s) => s.vaultMatches)
  const origin = useNexa((s) => s.vaultAutofillOrigin)
  const selectedId = useNexa((s) => s.vaultSelectedId)
  const error = useNexa((s) => s.vaultAutofillError)
  const mode = useNexa((s) => s.agentMode)
  const close = () => useNexa.getState().setVaultAutofillOpen(false)
  const askBlocked = mode === 'ask'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const doFill = () => {
    if (!selectedId) return
    void useNexa.getState().vaultAutofillFill(selectedId)
  }

  return (
    <div
      role="dialog"
      aria-label="NEXA Vault autofill"
      aria-modal="false"
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        right: 0,
        width: 288,
        zIndex: 60,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: 'var(--shadow-2, 0 12px 32px rgba(0,0,0,0.28))',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Key size={16} weight="fill" color="var(--accent)" />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)' }}>NEXA Vault</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" aria-label="Close" onClick={close} style={{ width: 22, height: 22 }}>
          <X size={13} />
        </button>
      </div>
      {origin && (
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', wordBreak: 'break-all' }} aria-live="polite">
          {origin}
        </div>
      )}

      {state === 'ineligible' && (
        <p style={{ fontSize: 12, color: 'var(--text-2)', margin: 0 }}>Vault autofill is unavailable for this page.</p>
      )}

      {state === 'unavailable' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 12, color: 'var(--text-2)', margin: 0 }}>No vault is set up for this profile.</p>
          <button
            className="btn"
            onClick={() => {
              close()
              useNexa.getState().setView('settings', 'passwords')
            }}
          >
            Set up vault
          </button>
        </div>
      )}

      {state === 'locked' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--warning)' }}>
            <LockSimple size={13} /> Vault locked
          </div>
          <button
            className="btn"
            onClick={() => {
              close()
              useNexa.getState().setView('settings', 'passwords')
            }}
          >
            Unlock vault
          </button>
        </div>
      )}

      {state === 'nomatch' && (
        <p style={{ fontSize: 12, color: 'var(--text-2)', margin: 0 }}>No saved login matches this site.</p>
      )}

      {(state === 'ready' || state === 'filling' || state === 'filled' || state === 'failed') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {matches.length > 1 && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }} id="vault-choose">
              Choose account
            </div>
          )}
          <div
            role={matches.length > 1 ? 'radiogroup' : undefined}
            aria-labelledby={matches.length > 1 ? 'vault-choose' : undefined}
            style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 168, overflowY: 'auto' }}
          >
            {matches.map((c) => {
              const active = c.id === selectedId
              return (
                <button
                  key={c.id}
                  role={matches.length > 1 ? 'radio' : undefined}
                  aria-checked={matches.length > 1 ? active : undefined}
                  onClick={() => useNexa.getState().vaultSelect(c.id)}
                  disabled={state === 'filling'}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 2,
                    padding: '8px 10px',
                    borderRadius: 8,
                    textAlign: 'left',
                    border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: active ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface-2, transparent)'
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.username || c.title || 'Saved login'}
                  </span>
                  <span aria-label="password hidden" style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: 1 }}>
                    {maskDots()}
                  </span>
                </button>
              )
            })}
          </div>

          {state === 'filled' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--success)' }} aria-live="polite">
              <CheckCircle size={14} weight="fill" /> Credential filled — review before submitting.
            </div>
          ) : askBlocked ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--warning)' }} aria-live="polite">
              <Warning size={13} /> Autofill is blocked in Ask mode.
            </div>
          ) : (
            <button
              className="btn btn-primary"
              disabled={!selectedId || state === 'filling'}
              onClick={doFill}
              style={{ width: '100%' }}
            >
              {state === 'filling' ? 'Filling…' : matches.length > 1 ? 'Fill selected login' : 'Fill login'}
            </button>
          )}

          {state === 'failed' && error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--error)' }} aria-live="assertive">
              <Warning size={13} /> {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BookmarkStar() {
  const tab = useNexa((s) => s.session.tabs.find((t) => t.id === s.session.activeTab))
  const bookmarks = useNexa((s) => s.bookmarks)
  const isWeb = tab?.kind === 'web' && !!tab.url
  const marked = isWeb && !!tab && useNexa.getState().isBookmarked(tab.url)
  void bookmarks // re-render when bookmarks change
  return (
    <button
      title={marked ? 'Remove bookmark (⌘D)' : 'Bookmark this page (⌘D)'}
      aria-label={marked ? 'Remove bookmark' : 'Bookmark this page'}
      disabled={!isWeb}
      onClick={() => useNexa.getState().bookmarkCurrent()}
      style={{ width: 24, height: 24, color: marked ? 'var(--accent)' : 'var(--text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Star size={15} weight={marked ? 'fill' : 'regular'} />
    </button>
  )
}

function BookmarkBar() {
  const bookmarks = useNexa((s) => s.bookmarks)
  const show = useNexa((s) => s.prefs.bookmarkBar)
  const items = (bookmarks?.items || [])
    .filter((i) => i.parentId === ROOT_BAR)
    .sort((a, b) => a.index - b.index)
  if (!show) return null
  return (
    <div
      style={{
        height: 34,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '0 8px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        overflow: 'hidden'
      }}
    >
      {items.length === 0 ? (
        <span style={{ fontSize: 11.5, color: 'var(--text-3)', padding: '0 6px' }}>
          Bookmark pages with ⌘D — they appear here.
        </span>
      ) : (
        items.map((b: BookmarkItem) => (
          <button
            key={b.id}
            onClick={() => (b.type === 'folder' ? useNexa.getState().setView('bookmarks') : useNexa.getState().openUrl(b.url || ''))}
            title={b.url || b.title}
            style={{
              height: 24,
              maxWidth: 180,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 8px',
              borderRadius: 6,
              color: 'var(--text-2)',
              fontSize: 12
            }}
          >
            {b.type === 'folder' ? <Stack size={13} /> : <Star size={12} weight="fill" color="var(--accent)" />}
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</span>
          </button>
        ))
      )}
    </div>
  )
}

function Sidebar() {
  const view = useNexa((s) => s.session.tabs.find((t) => t.id === s.session.activeTab)?.view)
  const ws = useNexa((s) => s.prefs.activeWorkspace)
  const aiState = useNexa((s) => s.aiStatus?.state)
  const aiCloud = useNexa((s) => s.aiStatus?.processing === 'cloud')
  const aiProviderName = useNexa((s) => s.aiStatus?.providerName)
  const aiNote = useNexa((s) => s.aiStatus?.note)
  const items: { id: string; icon: ReactNode; label: string; group: string; view?: ChromeView; action?: () => void }[] = [
    { id: 'home', icon: <House size={16} />, label: 'Home', group: 'MAIN', view: 'newtab' },
    { id: 'downloads', icon: <DownloadSimple size={16} />, label: 'Downloads', group: 'MAIN', view: 'downloads' },
    { id: 'bookmarks', icon: <BookmarkSimple size={16} />, label: 'Bookmarks', group: 'MAIN', view: 'bookmarks' },
    { id: 'history', icon: <ClockCounterClockwise size={16} />, label: 'History', group: 'MAIN', view: 'history' },
    { id: 'collections', icon: <Stack size={16} />, label: 'Collections', group: 'MAIN', view: 'collections' },
    { id: 'ai', icon: <Sparkle size={16} />, label: 'AI', group: 'TOOLS', action: () => useNexa.setState({ aiOpen: true }) },
    { id: 'cloud', icon: <Cloud size={16} />, label: 'Cloud', group: 'TOOLS', view: 'cloud' }
  ]
  const groupStyle = { fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--text-3)', padding: '2px 10px 6px' }
  let lastGroup = ''
  const workspaces = [
    { label: 'Research', color: 'var(--accent)' },
    { label: 'Development', color: '#e07b53' },
    { label: 'Personal', color: '#3cbf84' }
  ]
  return (
    <div className="sidebar">
      {items.map((n) => {
        const active = n.view && (view === n.view || (n.view === 'newtab' && (view === 'newtab' || view === 'web')))
        const header = n.group !== lastGroup ? ((lastGroup = n.group), n.group) : null
        return (
          <div key={n.id}>
            {header && <div className="nav-group" style={header === 'TOOLS' ? { ...groupStyle, marginTop: 8 } : groupStyle}>{header}</div>}
            <button
              className={`nav-btn ${active ? 'active' : ''}`}
              title={n.label}
              aria-label={n.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => (n.action ? n.action() : n.view && useNexa.getState().setView(n.view))}
            >
              {n.icon}
              <span className="nav-label" style={{ fontSize: 13 }}>{n.label}</span>
            </button>
          </div>
        )
      })}
      <div style={{ height: 1, background: 'var(--border)', margin: '10px 6px' }} />
      <div className="nav-group" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)', padding: '2px 10px 6px' }}>
        Workspaces
      </div>
      {workspaces.map((w) => {
        const on = ws === w.label
        return (
          <button
            key={w.label}
            className="nav-btn"
            title={`Workspace · ${w.label}`}
            aria-label={`Workspace ${w.label}`}
            aria-pressed={on}
            style={{ flex: 'none', height: 31, background: on ? 'var(--chrome-2)' : 'transparent', fontWeight: on ? 600 : 400, color: on ? 'var(--text)' : 'var(--text-2)' }}
            onClick={() => {
              useNexa.getState().setPref('activeWorkspace', w.label)
              useNexa.getState().setView('newtab')
              useNexa.getState().toastMsg('Workspace · ' + w.label)
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 3, background: w.color, flex: 'none' }} />
            <span className="nav-label" style={{ fontSize: 12.5 }}>{w.label}</span>
            {on && <Check className="nav-extra" size={12} weight="bold" style={{ flex: 'none' }} color="var(--accent)" />}
          </button>
        )
      })}
      <div style={{ height: 1, background: 'var(--border)', margin: '12px 6px 10px' }} />
      <button
        className={`nav-btn ${view === 'settings' ? 'active' : ''}`}
        title="Settings"
        aria-label="Settings"
        aria-current={view === 'settings' ? 'page' : undefined}
        onClick={() => useNexa.getState().setView('settings')}
      >
        <Gear size={16} />
        <span className="nav-label" style={{ fontSize: 13 }}>Settings</span>
      </button>
      {(() => {
        const connected = aiState === 'connected'
        const name = aiCloud ? aiProviderName || 'NEXA AI' : 'Local AI'
        const checking = aiState === 'checking'
        const dot = connected ? 'var(--success)' : checking ? 'var(--text-3)' : 'var(--warning)'
        const glow = connected ? 'var(--success-weak)' : checking ? 'transparent' : 'var(--warning-weak)'
        const label = connected ? 'CONNECTED' : checking ? 'CHECKING' : 'OFFLINE'
        return (
          <button
            className="row no-drag ai-status"
            title={connected ? `${name} connected` : checking ? `Checking ${name}…` : aiNote || `${name} offline`}
            aria-label={`${name} ${label.toLowerCase()}`}
            onClick={() => useNexa.setState({ aiOpen: true })}
            style={{ flex: 'none', minHeight: 34, padding: '0 10px', marginTop: 4, borderRadius: 8, border: '1px solid var(--border)', width: '100%' }}
          >
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: dot, boxShadow: `0 0 0 3px ${glow}`, flex: 'none' }} />
            <span className="nav-label" style={{ fontSize: 11, color: 'var(--text-2)' }}>{name}</span>
            <span className="pill nav-extra">{label}</span>
          </button>
        )
      })()}
    </div>
  )
}

function Content() {
  const tab = useNexa((s) => s.session.tabs.find((t) => t.id === s.session.activeTab))
  const profileId = useNexa((s) => s.activeProfile)
  if (!tab) return null
  if (tab.kind === 'web' && tab.url) {
    // Private tabs use an in-memory partition so nothing persists to disk.
    const partition = tab.private ? `nexa-private-${profileId}` : `persist:nexa-${profileId}`
    return <WebTab tabId={tab.id} url={tab.url} partition={partition} />
  }
  if (tab.view === 'settings') return <SettingsView />
  if (tab.view === 'downloads') return <DownloadsView />
  if (tab.view === 'cloud') return <PlaceholderPage icon={<Cloud size={28} />} title="Cloud Transfer" honest="REQUIRES OAUTH · NOT CONFIGURED" body="Drive, GCS, Dropbox, OneDrive and S3 are not connected. Tokens are never stored until you authorize a provider." />
  if (tab.view === 'about') return <AboutView />
  if (tab.view === 'bookmarks') return <BookmarksView />
  if (tab.view === 'history') return <HistoryView />
  if (tab.view === 'collections') return <CollectionsView />
  if (tab.view === 'protection') return <ProtectionView />
  if (tab.view === 'privacy') return <PrivacyCenterView />
  if (tab.view === 'drive') return <DriveView />
  return <NewTabView />
}

function WebTab({ tabId, url, partition }: { tabId: string; url: string; partition: string }) {
  // `src` is only the initial URL: later url changes that come from the page
  // itself (links, back/forward) must not re-trigger a load.
  const [initialSrc] = useState(url)
  const nodeRef = useRef<WebviewEl | null>(null)
  const guestUrl = useRef(url)
  useEffect(() => {
    if (url === guestUrl.current) return
    guestUrl.current = url
    nodeRef.current?.loadURL?.(url)?.catch(() => {})
  }, [url])
  const ref = (el: (HTMLElement & { addEventListener: WebviewEl['addEventListener'] }) | null) => {
    if (!el) return
    const node = el as unknown as WebviewEl
    nodeRef.current = node
    if ((node as unknown as { _nexaBound?: boolean })._nexaBound) return
    ;(node as unknown as { _nexaBound?: boolean })._nexaBound = true
    node.addEventListener('page-title-updated', (e) => {
      const title = (e as unknown as { title?: string }).title
      if (title) useNexa.getState().recordNavTitle(tabId, title)
    })
    const syncNav = () => {
      try {
        useNexa.getState().setWebNav({ tabId, canBack: !!node.canGoBack?.(), canForward: !!node.canGoForward?.() })
      } catch {
        /* guest not attached yet */
      }
    }
    node.addEventListener('did-navigate', (e) => {
      const u = (e as unknown as { url?: string }).url
      if (u) {
        guestUrl.current = u
        useNexa.getState().recordNavUrl(tabId, u)
      }
      syncNav()
    })
    node.addEventListener('did-navigate-in-page', (e) => {
      const ev = e as unknown as { url?: string; isMainFrame?: boolean }
      if (ev.isMainFrame === false) return
      const u = ev.url
      if (u) {
        guestUrl.current = u
        useNexa.getState().recordNavUrl(tabId, u)
        useNexa.getState().recordNavTitle(tabId, node.getTitle?.() || u)
      }
      syncNav()
    })
    node.addEventListener('did-stop-loading', syncNav)
    // STEP 9 — Turbo: subtle loading state + REAL, local-only navigation timing.
    node.addEventListener('did-start-loading', () => useNexa.getState().recordNavStart())
    node.addEventListener('did-finish-load', () => {
      const st = useNexa.getState()
      if (!st.prefs.toggles.turbo || !st.prefs.turbo.metrics) {
        st.recordNavPerf(null)
        return
      }
      // Runs in the guest page context only — no privileged access, no URL upload.
      node
        .executeJavaScript?.(NAV_PERF_SNIPPET)
        .then((raw) => {
          const r = raw as null | Record<string, number | boolean>
          useNexa.getState().recordNavPerf(
            r
              ? {
                  navigationId: `${tabId}:${Date.now()}`,
                  startedAt: Date.now(),
                  responseStart: num(r.responseStart),
                  domContentLoaded: num(r.domContentLoaded),
                  loadEventEnd: num(r.loadEventEnd),
                  transferSize: num(r.transferSize),
                  encodedBodySize: num(r.encodedBodySize),
                  decodedBodySize: num(r.decodedBodySize),
                  fromCache: r.fromCache === true
                }
              : null
          )
        })
        .catch(() => useNexa.getState().recordNavPerf(null))
    })
    node.addEventListener('did-fail-load', () => useNexa.getState().recordNavPerf(null))
    node.addEventListener('did-stop-loading', () => {
      // Ensure the indicator always clears even if metrics are off / load never fires.
      if (!useNexa.getState().prefs.turbo.metrics) useNexa.getState().recordNavPerf(null)
    })
  }
  return createElement('webview', { key: tabId, ref, src: initialSrc, partition, style: { flex: 1, width: '100%' } })
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : undefined)

// Reads standard PerformanceNavigationTiming from the guest page. Values are
// durations from navigation start (ms). `fromCache` is inferred from transferSize.
const NAV_PERF_SNIPPET = `(() => { try {
  var n = performance.getEntriesByType('navigation')[0];
  if (!n) return null;
  return {
    responseStart: n.responseStart,
    domContentLoaded: n.domContentLoadedEventEnd,
    loadEventEnd: n.loadEventEnd,
    transferSize: n.transferSize,
    encodedBodySize: n.encodedBodySize,
    decodedBodySize: n.decodedBodySize,
    fromCache: (typeof n.transferSize === 'number' && n.transferSize === 0 && n.encodedBodySize > 0)
  };
} catch (e) { return null; } })()`

interface WebviewEl extends HTMLElement {
  reload?: () => void
  canGoBack?: () => boolean
  canGoForward?: () => boolean
  goBack?: () => void
  goForward?: () => void
  loadURL?: (url: string) => Promise<void>
  getURL?: () => string
  getTitle?: () => string
  executeJavaScript?: (code: string) => Promise<unknown>
}

function PlaceholderPage({ icon, title, honest, body }: { icon: ReactNode; title: string; honest: string; body: string }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: 'var(--text-2)' }}>{icon}</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>{title}</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6 }}>{body}</p>
        <div className="honest" style={{ marginTop: 12 }}>
          {honest}
        </div>
        <button className="primary" style={{ marginTop: 18 }} onClick={() => useNexa.getState().setView('newtab')}>
          Back to browsing
        </button>
      </div>
    </div>
  )
}

function AboutView() {
  const info = useNexa((s) => s.info)
  const rows = [
    { k: 'NEXA', v: info?.version ?? '0.1.0' },
    { k: 'Chromium', v: info?.chrome ?? '—' },
    { k: 'Electron', v: info?.electron ?? '—' },
    { k: 'Platform', v: info ? `${info.platform} · ${info.arch}` : '—' }
  ]
  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 40px 70px' }}>
        <div className="row" style={{ gap: 16, marginBottom: 10 }}>
          <img src="./assets/nexa-icon.png" width={58} height={58} alt="NEXA" />
          <div>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '0.04em', lineHeight: 1 }}>NEXA</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>Open-Source AI Download Browser · {info?.version}</div>
          </div>
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, margin: '18px 0 28px' }}>Browse. Protect. Download. Understand. Transfer.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
          {rows.map((r) => (
            <div key={r.k} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 4 }}>{r.k}</div>
              <div className="mono" style={{ fontSize: 13 }}>
                {r.v}
              </div>
            </div>
          ))}
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <AboutLink icon={<ArrowClockwise size={19} />} label="Check for updates" desc="No update channel configured" onClick={() => useNexa.getState().toastMsg('Update channel not configured — cannot claim up to date', 'warn')} />
          <AboutLink icon={<Info size={19} />} label="Open source licenses" desc="MIT · bundled Chromium notices" onClick={() => useNexa.getState().toastMsg('License viewer ships with the installer build')} />
          <AboutLink icon={<TerminalWindow size={19} />} label="System information" desc="Copied from this process" onClick={() => useNexa.getState().toastMsg(`${info?.platform} ${info?.arch} · Chromium ${info?.chrome}`)} />
        </div>
      </div>
    </div>
  )
}

function AboutLink({ icon, label, desc, onClick }: { icon: ReactNode; label: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="row" style={{ width: '100%', padding: '13px 16px', borderBottom: '1px solid var(--border)', textAlign: 'left', gap: 13 }}>
      <span style={{ width: 22, color: 'var(--text-2)' }}>{icon}</span>
      <span style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{desc}</div>
      </span>
      <span style={{ color: 'var(--text-3)' }}>›</span>
    </button>
  )
}

function StatusBar() {
  const tab = useNexa((s) => s.session.tabs.find((t) => t.id === s.session.activeTab))
  const snap = useNexa((s) => (tab?.private ? s.protectionPrivate : s.protection))
  const vpn = useNexa((s) => s.vpn)
  const servers = useNexa((s) => s.vpnServers)
  const enabled = snap?.settings.enabled ?? true
  const state = snap?.state || 'not_configured'
  const blocked = snap?.totals.blocked || 0
  const protLabel =
    state === 'error'
      ? 'Protection error'
      : !enabled
        ? 'Protection off'
        : state === 'not_configured'
          ? 'Protection not configured'
          : `Protection active · ${blocked.toLocaleString()} blocked this session`
  const vp = vpnUiProjection({ state: vpn?.state || 'not_configured', capability: vpn?.capability || 'unknown', hasServers: servers.length > 0 })
  return (
    <div className="statusbar">
      <span className="row" style={{ gap: 6, flex: '0 1 auto' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', flex: 'none' }} />
        <span className="truncate" title={tab?.kind === 'web' ? tab.url : undefined}>{tab?.kind === 'web' ? tab.url : 'New Tab'}</span>
      </span>
      <span className="truncate" style={{ marginLeft: 'auto', flex: '0 1 auto' }} title={protLabel}>{protLabel}</span>
      <span className="row" style={{ gap: 6, flex: '0 1 auto' }}>
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: vpnToneColor(vp.tone), flex: 'none' }} />
        <span className="truncate">VPN · {vp.label.replace('…', '').toLowerCase()}</span>
      </span>
    </div>
  )
}

type WebviewExec = HTMLElement & {
  executeJavaScript?: (code: string) => Promise<unknown>
  getTitle?: () => string
  getURL?: () => string
  getWebContentsId?: () => number
}

function activeWebview(): WebviewExec | null {
  const st = useNexa.getState()
  const tab = st.session.tabs.find((t) => t.id === st.session.activeTab)
  if (!tab || tab.kind !== 'web') return null
  return document.querySelector('webview') as WebviewExec | null
}

// Readability-style extraction script. Runs IN the page and returns ONLY
// readable text + headings (no HTML, cookies, storage, tokens, scripts, styles,
// nav/ads/footers/hidden elements). Generic strategy — no site-specific selectors.
const EXTRACT_SCRIPT = `(() => {
  try {
    const strip = ['script','style','noscript','iframe','svg','canvas','nav','footer','header','form','aside','button','[aria-hidden="true"]','[role="navigation"]','[role="banner"]','[role="contentinfo"]','.ad','.ads','.advert','.cookie','.cookies','.newsletter','.promo'];
    const pickRoot = () => document.querySelector('article, main, [role="main"]') || document.querySelector('#content, #main, .post, .article') || document.body;
    const root = pickRoot();
    if (!root) return { title: document.title || '', url: location.href, headings: [], text: '' };
    const clone = root.cloneNode(true);
    strip.forEach(sel => { try { clone.querySelectorAll(sel).forEach(n => n.remove()) } catch (e) {} });
    const headings = Array.from(clone.querySelectorAll('h1,h2,h3')).map(h => (h.innerText||h.textContent||'').trim()).filter(Boolean).slice(0, 40);
    const text = (clone.innerText || clone.textContent || '').replace(/[\\t ]+/g,' ').replace(/\\n{3,}/g,'\\n\\n').trim();
    return { title: document.title || '', url: location.href, headings: headings, text: text.slice(0, 120000) };
  } catch (e) { return { title: document.title || '', url: '', headings: [], text: '' } }
})()`

// Returns a sanitized, size-bounded PageExtract, or null if not enough readable text.
async function extractReadable(): Promise<PageExtract | null> {
  const wv = activeWebview()
  if (!wv?.executeJavaScript) return null
  try {
    const raw = (await wv.executeJavaScript(EXTRACT_SCRIPT)) as RawPageExtract
    if (raw && typeof raw === 'object') return normalizePageExtract(raw, MAX_CONTEXT_CHARS)
  } catch {
    /* extraction failed */
  }
  return null
}

async function getSelectionText(): Promise<string> {
  const wv = activeWebview()
  if (!wv?.executeJavaScript) return ''
  try {
    const s = await wv.executeJavaScript('String(window.getSelection ? window.getSelection().toString() : "")')
    return typeof s === 'string' ? s : ''
  } catch {
    return ''
  }
}

function aiConnectedOrWarn(): boolean {
  const st = useNexa.getState()
  if (st.aiStatus?.state !== 'connected') {
    st.toastMsg(st.aiStatus?.note || 'AI unavailable — start Ollama or check NEXA AI in Settings', 'warn')
    return false
  }
  return true
}

/* ======================= P5.1 Browser Agent tool executor ======================= */
/**
 * Executes ONE validated agent tool against the live active <webview> / tabs.
 * Runs in the renderer (that is where the webview lives). It only uses semantic
 * targeting + the existing extraction script — never arbitrary model JS, never
 * passwords, never credentials/cookies/storage. Returns a ToolObservation; the
 * main-process AgentService fences page-derived text as untrusted data.
 */
interface CapturedImage {
  getSize?: () => { width: number; height: number }
  resize?: (o: { width: number; height: number }) => CapturedImage
  toDataURL?: () => string
  isEmpty?: () => boolean
}
type AgentWebview = WebviewExec & {
  loadURL?: (u: string) => void
  goBack?: () => void
  goForward?: () => void
  reload?: () => void
  canGoBack?: () => boolean
  canGoForward?: () => boolean
  capturePage?: () => Promise<CapturedImage>
  addEventListener: HTMLElement['addEventListener']
}

// P5.3 — bounded, memory-only viewport capture. Never persisted, never uploaded,
// never logged. Downscaled to VISION_MAX_DIM before it leaves the renderer.
async function captureScreenshot(): Promise<string | null> {
  const wv = activeWebview() as AgentWebview | null
  if (!wv?.capturePage) return null
  try {
    const img = await wv.capturePage()
    if (!img || (img.isEmpty && img.isEmpty())) return null
    const size = img.getSize ? img.getSize() : { width: 0, height: 0 }
    const bounded = boundImageDims(size.width, size.height)
    const scaled = img.resize ? img.resize(bounded) : img
    const url = scaled.toDataURL ? scaled.toDataURL() : null
    return url && url.length > 32 ? url : null
  } catch {
    return null
  }
}

const VISION_SYSTEM = 'You are NEXA\u2019s browser vision assistant. Describe only what is visibly present in the screenshot; communicate uncertainty and never invent exact numbers. ' + VISION_INJECTION_GUARD

/** Capability gate: returns an honest error observation, or null when vision is usable. */
async function visionGate(profileId: string): Promise<Obs | null> {
  const vs = await window.nexa.ai.visionStatus({ profileId })
  const cap = vs?.ok ? vs.data.capability : 'ERROR'
  if (cap === 'VISION_CAPABLE') return null
  const model = vs?.ok ? vs.data.model : 'model'
  if (cap === 'UNAVAILABLE') return { ok: false, observation: 'VISION_UNAVAILABLE — local AI unavailable. Start Ollama.', error: 'vision_unavailable', page: agentSnapshot() }
  if (cap === 'ERROR') return { ok: false, observation: 'VISION_PROVIDER_ERROR — could not determine vision capability.', error: 'vision_provider_error', page: agentSnapshot() }
  return { ok: false, observation: `VISION_NOT_CONFIGURED — the current model (${model}) is text-only. Use observe / read_page / extract_* instead.`, error: 'vision_not_configured', page: agentSnapshot() }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function agentSnapshot(): { url: string; title: string } {
  const wv = activeWebview() as AgentWebview | null
  const st = useNexa.getState()
  const tab = st.session.tabs.find((t) => t.id === st.session.activeTab)
  const url = (wv?.getURL && wv.getURL()) || tab?.url || ''
  const title = (wv?.getTitle && wv.getTitle()) || tab?.title || ''
  return { url, title }
}

function waitForLoad(wv: AgentWebview, ms = 8000): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    try {
      wv.addEventListener('did-finish-load', finish as EventListener, { once: true })
      wv.addEventListener('did-fail-load', finish as EventListener, { once: true })
    } catch {
      /* ignore */
    }
    setTimeout(finish, ms)
  })
}

// Element resolver injected into the page. Semantic-first; coordinates are a
// last-resort fallback. Rejects ambiguous matches instead of guessing.
const RESOLVER_SRC = `
function __nxVis(el){ if(!el||!el.getBoundingClientRect) return false; const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0'; }
function __nxNorm(s){ return (s||'').toString().trim().toLowerCase().replace(/\\s+/g,' '); }
function __nxFind(t){
  if(t.eid){ const e=document.querySelector('[data-nx-eid="'+String(t.eid).replace(/[^a-z0-9_]/gi,'')+'"]'); return {els: e&&__nxVis(e)?[e]:[], tie:false}; }
  if(t.selector){ const els=Array.from(document.querySelectorAll(t.selector)).filter(__nxVis); return {els:els, tie: els.length>1}; }
  if(t.x!=null&&t.y!=null){ const e=document.elementFromPoint(t.x,t.y); return {els: e?[e]:[], tie:false}; }
  let els=Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[onclick],label,summary,[tabindex],[contenteditable]')).filter(__nxVis);
  if(t.role){ const r=__nxNorm(t.role); els=els.filter(e=>__nxNorm(e.getAttribute('role'))===r||e.tagName.toLowerCase()===r); }
  const want=__nxNorm(t.text||t.name||t.label||t.placeholder||'');
  if(!want){ return {els:els, tie: els.length>1}; }
  const score=e=>{ const c=[e.innerText,e.value,e.getAttribute&&e.getAttribute('aria-label'),e.getAttribute&&e.getAttribute('placeholder'),e.getAttribute&&e.getAttribute('name'),e.getAttribute&&e.getAttribute('title')]; let b=0; for(const x of c){ const v=__nxNorm(x); if(!v) continue; if(v===want) b=Math.max(b,4); else if(v.startsWith(want)) b=Math.max(b,3); else if(v.includes(want)) b=Math.max(b,2);} return b; };
  const scored=els.map(e=>[e,score(e)]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
  return {els:scored.map(x=>x[0]), tie: scored.length>1 && scored[0][1]===scored[1][1]};
}
`

// Fixed, non-model observation capture. Assigns ephemeral data-nx-eid=element_N
// in DOM order (clearing any prior ids first) and returns raw descriptors. The
// pure buildObservation() then bounds + redacts them. Never returns secret values.
const OBSERVE_SRC = `${RESOLVER_SRC}
(()=>{ try{
  document.querySelectorAll('[data-nx-eid]').forEach(function(e){ e.removeAttribute('data-nx-eid'); });
  var sel='a[href],button,input,textarea,select,summary,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="radio"],[role="combobox"],[role="tab"],[role="menuitem"],[role="switch"],[contenteditable]';
  var nodes=Array.from(document.querySelectorAll(sel)).filter(__nxVis);
  var els=[]; var n=0;
  for(var i=0;i<nodes.length && n<60;i++){ var el=nodes[i]; var eid='element_'+(n+1); el.setAttribute('data-nx-eid',eid); n++;
    var tag=el.tagName.toLowerCase();
    var lbl=''; try{ if(el.labels&&el.labels.length){ lbl=el.labels[0].innerText||''; } }catch(_){}
    els.push({ id:eid, tag:tag, role:el.getAttribute('role')||'', name:(el.getAttribute('name')||''), text:((el.innerText||el.value||'')+'').slice(0,160), label:lbl.slice(0,160), placeholder:el.getAttribute('placeholder')||'', ariaLabel:el.getAttribute('aria-label')||'', value:(tag==='input'||tag==='textarea'||tag==='select')?((el.value||'')+'').slice(0,160):'', href:(tag==='a'?(el.href||''):''), type:(el.getAttribute('type')||'').toLowerCase(), autocomplete:el.getAttribute('autocomplete')||'', disabled:!!el.disabled, checked:(el.type==='checkbox'||el.type==='radio')?!!el.checked:undefined, required:!!el.required, visible:true });
  }
  var lm=[]; ['header','nav','main','aside','footer'].forEach(function(t){ if(document.querySelector(t)) lm.push(t); });
  document.querySelectorAll('[role="banner"],[role="navigation"],[role="main"],[role="complementary"],[role="contentinfo"],[role="search"]').forEach(function(e){ var r=e.getAttribute('role'); if(lm.indexOf(r)<0) lm.push(r); });
  var dialogs=Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open]')).map(function(d){ return ((d.getAttribute('aria-label')||d.innerText||'dialog')+'').trim().slice(0,120); }).slice(0,6);
  return JSON.stringify({ url:location.href, title:document.title, elements:els,
    structure:{ hasHeader:!!document.querySelector('header,[role="banner"]'), hasNav:!!document.querySelector('nav,[role="navigation"]'), hasMain:!!document.querySelector('main,[role="main"]'), hasAside:!!document.querySelector('aside,[role="complementary"]'), hasFooter:!!document.querySelector('footer,[role="contentinfo"]'), hasSearch:!!document.querySelector('[role="search"],input[type="search"]'), forms:document.querySelectorAll('form').length, tables:document.querySelectorAll('table').length, dialogs:dialogs.length, landmarks:lm },
    dialogs:dialogs });
}catch(e){ return JSON.stringify({ url:location.href, title:document.title, elements:[] }); } })()`

async function runJs(code: string): Promise<unknown> {
  const wv = activeWebview() as AgentWebview | null
  if (!wv?.executeJavaScript) throw Object.assign(new Error('not_ready'), { code: 'not_ready' })
  return wv.executeJavaScript(code)
}

type Obs = { ok: boolean; observation: string; page?: { url: string; title: string }; error?: string }

async function executeAgentTool(tool: string, args: Record<string, unknown>): Promise<Obs> {
  const st = useNexa.getState()
  const wv = () => activeWebview() as AgentWebview | null
  try {
    switch (tool) {
      /* ---- Navigation ---- */
      case 'navigate': {
        st.navigate(String(args.url))
        await delay(250)
        const el = wv()
        if (el) await waitForLoad(el)
        return { ok: true, observation: `Navigated. ${describeSnap()}`, page: agentSnapshot() }
      }
      case 'go_back': {
        const el = wv()
        if (!el?.goBack) return { ok: false, observation: '', error: 'not_ready' }
        el.goBack()
        await waitForLoad(el, 6000)
        return { ok: true, observation: `Went back. ${describeSnap()}`, page: agentSnapshot() }
      }
      case 'go_forward': {
        const el = wv()
        if (!el?.goForward) return { ok: false, observation: '', error: 'not_ready' }
        el.goForward()
        await waitForLoad(el, 6000)
        return { ok: true, observation: `Went forward. ${describeSnap()}`, page: agentSnapshot() }
      }
      case 'reload': {
        const el = wv()
        if (!el?.reload) return { ok: false, observation: '', error: 'not_ready' }
        el.reload()
        await waitForLoad(el, 8000)
        return { ok: true, observation: `Reloaded. ${describeSnap()}`, page: agentSnapshot() }
      }
      case 'open_tab': {
        if (args.url) st.openUrl(String(args.url), { newTab: true })
        else st.newTab()
        await delay(250)
        const el = wv()
        if (el && args.url) await waitForLoad(el)
        return { ok: true, observation: `Opened a new tab. ${describeSnap()}`, page: agentSnapshot() }
      }
      case 'close_tab': {
        const id = (args.tabId as string) || st.session.activeTab
        st.closeTab(id)
        return { ok: true, observation: `Closed tab ${id}.`, page: agentSnapshot() }
      }
      case 'switch_tab': {
        st.activateTab(String(args.tabId))
        await delay(150)
        return { ok: true, observation: `Switched tab. ${describeSnap()}`, page: agentSnapshot() }
      }
      case 'list_tabs': {
        const tabs = st.session.tabs.map((t) => `${t.id}: ${t.title || t.url || 'New Tab'} <${t.kind === 'web' ? t.url : t.view}>`)
        return { ok: true, observation: `Open tabs (${tabs.length}):\n${tabs.join('\n')}`, page: agentSnapshot() }
      }

      /* ---- Content ---- */
      case 'read_page': {
        const page = await extractReadable()
        if (!page) return { ok: false, observation: '', error: 'no_content' }
        const head = page.headings.length ? `Headings: ${page.headings.slice(0, 12).join(' | ')}\n\n` : ''
        return { ok: true, observation: `Title: ${page.title}\n${head}${page.text}`, page: agentSnapshot() }
      }
      case 'observe': {
        const raw = JSON.parse(String((await runJs(OBSERVE_SRC)) || '{}')) as RawObservation
        const obs = buildObservation(raw)
        return { ok: true, observation: formatObservation(obs), page: agentSnapshot() }
      }
      case 'page_structure': {
        const raw = JSON.parse(String((await runJs(OBSERVE_SRC)) || '{}')) as RawObservation
        const obs = buildObservation(raw)
        const s = obs.structure
        if (!s) return { ok: true, observation: 'No structural landmarks detected.', page: agentSnapshot() }
        const parts = [s.hasHeader && 'header', s.hasNav && 'nav', s.hasMain && 'main', s.hasAside && 'sidebar', s.hasFooter && 'footer', s.hasSearch && 'search'].filter(Boolean)
        return { ok: true, observation: `Landmarks: ${parts.join(', ') || 'none'}\nForms: ${s.forms} · Tables: ${s.tables} · Dialogs: ${s.dialogs}${obs.dialogs.length ? `\nDialogs: ${obs.dialogs.join(' | ')}` : ''}`, page: agentSnapshot() }
      }
      case 'extract_data': {
        const kind = String(args.kind)
        const code = `(()=>{ try{
          const body=(document.body&&(document.body.innerText||document.body.textContent))||'';
          if(${JSON.stringify(kind)}==='emails'){ const m=body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/g)||[]; return Array.from(new Set(m)).slice(0,200).join('\\n'); }
          if(${JSON.stringify(kind)}==='links'){ const a=Array.from(document.querySelectorAll('a[href]')).map(x=>x.href).filter(h=>/^https?:/.test(h)); return Array.from(new Set(a)).slice(0,200).join('\\n'); }
          if(${JSON.stringify(kind)}==='headings'){ return Array.from(document.querySelectorAll('h1,h2,h3')).map(h=>(h.innerText||'').trim()).filter(Boolean).slice(0,80).join('\\n'); }
          return body.slice(0,6000);
        }catch(e){ return ''; } })()`
        const out = String((await runJs(code)) || '')
        return { ok: true, observation: out ? `${kind} extracted:\n${out}` : `No ${kind} found.`, page: agentSnapshot() }
      }
      case 'extract_table': {
        const idx = Number.isFinite(Number(args.index)) ? Number(args.index) : -1
        const code = `(()=>{ try{
          var tables=Array.from(document.querySelectorAll('table'));
          if(!tables.length) return JSON.stringify({ok:false});
          var t=${JSON.stringify(idx)}>=0?tables[${JSON.stringify(idx)}]:tables.slice().sort(function(a,b){return b.rows.length-a.rows.length;})[0];
          if(!t) return JSON.stringify({ok:false});
          var rows=Array.from(t.rows).slice(0,100).map(function(r){ return Array.from(r.cells).slice(0,20).map(function(c){ return ((c.innerText||'')+'').trim().slice(0,200); }); });
          var headers=[]; if(rows.length){ var hr=t.querySelector('thead tr'); if(hr){ headers=Array.from(hr.cells).slice(0,20).map(function(c){return ((c.innerText||'')+'').trim().slice(0,200);}); } else { headers=rows[0]; rows=rows.slice(1); } }
          return JSON.stringify({ok:true,headers:headers,rows:rows});
        }catch(e){ return JSON.stringify({ok:false}); } })()`
        const r = JSON.parse(String((await runJs(code)) || '{"ok":false}')) as { ok: boolean; headers?: string[]; rows?: string[][] }
        if (!r.ok) return { ok: false, observation: '', error: 'no_table' }
        const hdr = (r.headers || []).join(' | ')
        const body = (r.rows || []).slice(0, 60).map((row) => row.join(' | ')).join('\n')
        return { ok: true, observation: `Table (${r.rows?.length || 0} rows):\n${hdr}\n${'-'.repeat(Math.min(60, hdr.length))}\n${body}`, page: agentSnapshot() }
      }
      case 'extract_list': {
        const idx = Number.isFinite(Number(args.index)) ? Number(args.index) : -1
        const code = `(()=>{ try{
          var lists=Array.from(document.querySelectorAll('ul,ol'));
          if(!lists.length) return JSON.stringify({ok:false});
          var l=${JSON.stringify(idx)}>=0?lists[${JSON.stringify(idx)}]:lists.slice().sort(function(a,b){return b.children.length-a.children.length;})[0];
          if(!l) return JSON.stringify({ok:false});
          var items=Array.from(l.querySelectorAll(':scope > li')).slice(0,100).map(function(li){ return ((li.innerText||'')+'').trim().replace(/\\s+/g,' ').slice(0,300); }).filter(Boolean);
          return JSON.stringify({ok:true,items:items});
        }catch(e){ return JSON.stringify({ok:false}); } })()`
        const r = JSON.parse(String((await runJs(code)) || '{"ok":false}')) as { ok: boolean; items?: string[] }
        if (!r.ok || !r.items?.length) return { ok: false, observation: '', error: 'no_list' }
        return { ok: true, observation: `List (${r.items.length} items):\n${r.items.map((it) => `- ${it}`).join('\n')}`, page: agentSnapshot() }
      }
      case 'extract_links': {
        const sameOrigin = !!args.sameOrigin
        const code = `(()=>{ try{
          var origin=location.origin;
          var arr=Array.from(document.querySelectorAll('a[href]')).map(function(a){ return { text:((a.innerText||'')+'').trim().slice(0,200), href:a.href, rel:a.getAttribute('rel')||'', target:a.getAttribute('target')||'', visible:true }; });
          if(${JSON.stringify(sameOrigin)}) arr=arr.filter(function(l){ try{ return new URL(l.href).origin===origin; }catch(_){ return false; } });
          return JSON.stringify(arr.slice(0,400));
        }catch(e){ return JSON.stringify([]); } })()`
        const rawLinks = JSON.parse(String((await runJs(code)) || '[]')) as { text?: string; href?: string; rel?: string; target?: string }[]
        const links = sanitizeExtractedLinks(rawLinks)
        if (!links.length) return { ok: true, observation: 'No http(s) links found.', page: agentSnapshot() }
        return { ok: true, observation: `Links (${links.length}):\n${links.map((l) => `- ${l.text || '(no text)'} -> ${l.href}`).join('\n')}`, page: agentSnapshot() }
      }
      case 'find_text': {
        const q = String(args.query)
        const fmode = String(args.mode || 'ci')
        const code = `(()=>{ try{
          var raw=((document.body&&document.body.innerText)||'');
          var mode=${JSON.stringify(fmode)};
          var hay=mode==='exact'?raw:raw.toLowerCase();
          var q=mode==='exact'?${JSON.stringify(q)}:(mode==='partial'?${JSON.stringify(q.toLowerCase())}:${JSON.stringify(q.toLowerCase())});
          if(mode==='ci'){ hay=hay.replace(/\\s+/g,' '); q=q.replace(/\\s+/g,' '); }
          var i=hay.indexOf(q); if(i<0) return JSON.stringify({found:false});
          var cnt=hay.split(q).length-1;
          return JSON.stringify({found:true,count:cnt,ctx:raw.slice(Math.max(0,i-40),i+q.length+40)});
        }catch(e){ return JSON.stringify({found:false}); } })()`
        const r = JSON.parse(String((await runJs(code)) || '{"found":false}')) as { found: boolean; count?: number; ctx?: string }
        return { ok: true, observation: r.found ? `Found "${q}" (${r.count}x, ${fmode}). Context: …${(r.ctx || '').replace(/\s+/g, ' ')}…` : `"${q}" not found on this page.`, page: agentSnapshot() }
      }
      case 'observe_visual':
      case 'analyze_visual': {
        const gate = await visionGate(st.activeProfile)
        if (gate) return gate
        const image = await captureScreenshot()
        if (!image) return { ok: false, observation: 'VISION_UNAVAILABLE — screenshot capture failed on this page.', error: 'screenshot_failed', page: agentSnapshot() }
        const prompt =
          tool === 'analyze_visual'
            ? String(args.question)
            : 'Describe the main visual sections, the most prominent controls, and any charts, images, or cards on this page. Be concise.'
        const r = await window.nexa.ai.visionAnalyze({ profileId: st.activeProfile, image, prompt, system: VISION_SYSTEM })
        if (!r?.ok || !r.data.ok) return { ok: false, observation: '', error: (r?.ok && r.data.error) || 'vision_provider_error', page: agentSnapshot() }
        const parsed = parseVisionResponse(r.data.text || '')
        if (!parsed.ok) return { ok: false, observation: '', error: 'vision_invalid_response', page: agentSnapshot() }
        return { ok: true, observation: parsed.description || '(no visual description produced)', page: agentSnapshot() }
      }
      case 'locate_visual': {
        const gate = await visionGate(st.activeProfile)
        if (gate) return gate
        const image = await captureScreenshot()
        if (!image) return { ok: false, observation: 'VISION_UNAVAILABLE — screenshot capture failed on this page.', error: 'screenshot_failed', page: agentSnapshot() }
        const desc = String(args.description)
        const prompt = `Find this control in the screenshot: "${desc}". Respond ONLY with JSON: {"targets":[{"label":"<what you see>","role":"button|link|textbox|checkbox","name":"<the visible text label>"}]}. List up to 5 likely matches, most prominent first. Do not invent controls that are not visible.`
        const r = await window.nexa.ai.visionAnalyze({ profileId: st.activeProfile, image, prompt, system: VISION_SYSTEM })
        if (!r?.ok || !r.data.ok) return { ok: false, observation: '', error: (r?.ok && r.data.error) || 'vision_provider_error', page: agentSnapshot() }
        const parsed = parseVisionResponse(r.data.text || '')
        if (!parsed.ok) return { ok: false, observation: '', error: 'vision_invalid_response', page: agentSnapshot() }
        // Fuse vision suggestions with the deterministic DOM element map → real eids.
        const raw = JSON.parse(String((await runJs(OBSERVE_SRC)) || '{}')) as RawObservation
        const domObs = buildObservation(raw)
        const fused = fuseVisualTargets(parsed.targets, domObs.elements)
        const resolvable = fused.filter((f) => f.status === 'EXACT' || f.status === 'STRONG')
        if (!resolvable.length && !parsed.targets.length) {
          return { ok: false, observation: `VISUAL_TARGET_NOT_FOUND — vision could not identify "${desc}".`, error: 'visual_target_not_found', page: agentSnapshot() }
        }
        return { ok: true, observation: `Visual match for "${desc}" fused to real DOM elements — act via the eid:\n${formatFusedTargets(fused)}`, page: agentSnapshot() }
      }

      /* ---- Interaction ---- */
      case 'click': {
        const code = `(()=>{ ${RESOLVER_SRC} const t=${JSON.stringify(args.target)}; const f=__nxFind(t); if(!f.els.length) return JSON.stringify({ok:false,error:'element_not_found'}); if(f.els.length>1&&t.index==null&&f.tie) return JSON.stringify({ok:false,error:'ambiguous',count:f.els.length}); const el=t.index!=null?f.els[t.index]:f.els[0]; if(!el) return JSON.stringify({ok:false,error:'element_not_found'}); el.scrollIntoView({block:'center'}); el.click(); return JSON.stringify({ok:true,tag:el.tagName.toLowerCase(),text:((el.innerText||el.value||'')+'').slice(0,80)}); })()`
        const r = JSON.parse(String(await runJs(code))) as { ok: boolean; error?: string; tag?: string; text?: string; count?: number }
        if (!r.ok) return { ok: false, observation: '', error: r.error === 'ambiguous' ? `ambiguous_target (${r.count} matches)` : r.error || 'click_failed' }
        await delay(200)
        return { ok: true, observation: `Clicked <${r.tag}> ${r.text ? '“' + r.text + '”' : ''}. ${describeSnap()}`, page: agentSnapshot() }
      }
      case 'type': {
        const code = `(()=>{ ${RESOLVER_SRC} const t=${JSON.stringify(args.target)}; const val=${JSON.stringify(String(args.text ?? ''))}; const f=__nxFind(t); if(!f.els.length) return JSON.stringify({ok:false,error:'element_not_found'}); const el=t.index!=null?f.els[t.index]:f.els[0]; if(!el) return JSON.stringify({ok:false,error:'element_not_found'}); if(el.tagName==='INPUT'&&(el.type==='password')) return JSON.stringify({ok:false,error:'password_field_blocked'}); el.focus(); if(el.isContentEditable){ el.textContent=val; } else { const proto=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype; const setter=Object.getOwnPropertyDescriptor(proto,'value').set; setter.call(el,val); } el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return JSON.stringify({ok:true}); })()`
        const r = JSON.parse(String(await runJs(code))) as { ok: boolean; error?: string }
        if (!r.ok) return { ok: false, observation: '', error: r.error || 'type_failed' }
        return { ok: true, observation: 'Typed text into the field.', page: agentSnapshot() }
      }
      case 'select_option': {
        const code = `(()=>{ ${RESOLVER_SRC} const t=${JSON.stringify(args.target)}; const val=${JSON.stringify(String(args.value ?? ''))}; const f=__nxFind(t); const el=(t.index!=null?f.els[t.index]:f.els[0]); if(!el||el.tagName!=='SELECT') return JSON.stringify({ok:false,error:'select_not_found'}); const opt=Array.from(el.options).find(o=>o.value===val||__nxNorm(o.text)===__nxNorm(val)); if(!opt) return JSON.stringify({ok:false,error:'option_not_found'}); el.value=opt.value; el.dispatchEvent(new Event('change',{bubbles:true})); return JSON.stringify({ok:true,value:opt.value}); })()`
        const r = JSON.parse(String(await runJs(code))) as { ok: boolean; error?: string; value?: string }
        if (!r.ok) return { ok: false, observation: '', error: r.error || 'select_failed' }
        return { ok: true, observation: `Selected “${r.value}”.`, page: agentSnapshot() }
      }
      case 'set_checkbox': {
        const want = args.checked === true
        const code = `(()=>{ ${RESOLVER_SRC} const t=${JSON.stringify(args.target)}; const want=${JSON.stringify(want)}; const f=__nxFind(t); const el=(t.index!=null?f.els[t.index]:f.els[0]); if(!el) return JSON.stringify({ok:false,error:'element_not_found'}); if(el.type!=='checkbox'&&el.type!=='radio'&&el.getAttribute('role')!=='checkbox'&&el.getAttribute('role')!=='radio') return JSON.stringify({ok:false,error:'not_a_checkbox'}); if(!!el.checked!==want){ el.click(); } return JSON.stringify({ok:true,checked:!!el.checked}); })()`
        const r = JSON.parse(String(await runJs(code))) as { ok: boolean; error?: string; checked?: boolean }
        if (!r.ok) return { ok: false, observation: '', error: r.error || 'checkbox_failed' }
        return { ok: true, observation: `Checkbox is now ${r.checked ? 'checked' : 'unchecked'}.`, page: agentSnapshot() }
      }
      case 'scroll': {
        const dir = String(args.direction)
        const amt = Number(args.amount) || 800
        const code = `(()=>{ try{ if(${JSON.stringify(dir)}==='top') window.scrollTo(0,0); else if(${JSON.stringify(dir)}==='bottom') window.scrollTo(0,document.body.scrollHeight); else window.scrollBy(0, ${JSON.stringify(dir)}==='up'?-${amt}:${amt}); return true; }catch(e){ return false; } })()`
        await runJs(code)
        return { ok: true, observation: `Scrolled ${dir}.`, page: agentSnapshot() }
      }
      case 'scroll_to': {
        if (args.target) {
          const code = `(()=>{ ${RESOLVER_SRC} const t=${JSON.stringify(args.target)}; const f=__nxFind(t); const el=(t.index!=null?f.els[t.index]:f.els[0]); if(!el) return JSON.stringify({ok:false}); el.scrollIntoView({block:'center'}); return JSON.stringify({ok:true,text:((el.innerText||'')+'').slice(0,80)}); })()`
          const r = JSON.parse(String(await runJs(code))) as { ok: boolean; text?: string }
          if (!r.ok) return { ok: false, observation: '', error: 'element_not_found' }
          return { ok: true, observation: `Scrolled to element ${r.text ? '“' + r.text + '”' : ''}.`, page: agentSnapshot() }
        }
        const q = String(args.text || '')
        const code = `(()=>{ try{ const q=${JSON.stringify(q.toLowerCase())}; const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let n; while(n=w.nextNode()){ if((n.nodeValue||'').toLowerCase().includes(q)){ const el=n.parentElement; if(el){ el.scrollIntoView({block:'center'}); return JSON.stringify({ok:true}); } } } return JSON.stringify({ok:false}); }catch(e){ return JSON.stringify({ok:false}); } })()`
        const r = JSON.parse(String(await runJs(code))) as { ok: boolean }
        if (!r.ok) return { ok: false, observation: '', error: 'text_not_found' }
        return { ok: true, observation: `Scrolled to "${q}".`, page: agentSnapshot() }
      }
      case 'wait': {
        await delay(Math.min(5000, Number(args.ms) || 500))
        return { ok: true, observation: `Waited ${Math.min(5000, Number(args.ms) || 500)}ms.`, page: agentSnapshot() }
      }
      case 'wait_for': {
        const condition = String(args.condition)
        const timeoutMs = Math.min(15000, Number(args.timeoutMs) || 8000)
        const deadline = Date.now() + timeoutMs
        if (condition === 'navigation') {
          const el = wv()
          if (el) await waitForLoad(el, timeoutMs)
          return { ok: true, observation: `Navigation settled. ${describeSnap()}`, page: agentSnapshot() }
        }
        const q = String(args.text || '')
        const targetJson = JSON.stringify(args.target || null)
        while (Date.now() < deadline) {
          let hit = false
          if (condition === 'text') {
            const code = `(()=>{ try{ return ((document.body&&document.body.innerText)||'').toLowerCase().includes(${JSON.stringify(q.toLowerCase())}); }catch(e){ return false; } })()`
            hit = !!(await runJs(code))
          } else if (condition === 'element') {
            const code = `(()=>{ ${RESOLVER_SRC} const t=${targetJson}; if(!t) return false; const f=__nxFind(t); return f.els.length>0; })()`
            hit = !!(await runJs(code))
          } else if (condition === 'idle') {
            const code = `(()=>{ return document.readyState==='complete'; })()`
            hit = !!(await runJs(code))
          }
          if (hit) return { ok: true, observation: `Condition met: ${condition}${q ? ` ("${q}")` : ''}. FOUND.`, page: agentSnapshot() }
          await delay(300)
        }
        return { ok: false, observation: `Wait timed out after ${timeoutMs}ms (${condition}). TIMEOUT.`, error: 'timeout', page: agentSnapshot() }
      }

      /* ---- Forms ---- */
      case 'inspect_forms': {
        const code = `(()=>{ try{ const forms=Array.from(document.querySelectorAll('form')); const out=forms.slice(0,10).map((f,i)=>{ const fields=Array.from(f.querySelectorAll('input,textarea,select')).slice(0,40).map(el=>{ const type=(el.type||el.tagName).toLowerCase(); const label=(el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.getAttribute('name')||'').slice(0,60); return type+(label?(' ['+label+']'):'')+(type==='password'?' (SECURE)':''); }); return 'Form '+(i+1)+': '+fields.join(', '); }); return out.join('\\n')||'No forms found.'; }catch(e){ return 'No forms found.'; } })()`
        const out = String((await runJs(code)) || 'No forms found.')
        return { ok: true, observation: out, page: agentSnapshot() }
      }
      case 'fill_form': {
        const fields = (args.fields as { target: Record<string, unknown>; value: string }[]) || []
        let filled = 0
        for (const fld of fields) {
          const r = await executeAgentTool('type', { target: fld.target, text: fld.value })
          if (r.ok) filled++
        }
        return { ok: filled > 0, observation: `Filled ${filled}/${fields.length} field(s). The form was NOT submitted.`, page: agentSnapshot(), error: filled === 0 ? 'no_fields_filled' : undefined }
      }

      /* ---- Downloads (existing P2 engine via navigation) ---- */
      case 'download': {
        st.openUrl(String(args.url), { newTab: true })
        return { ok: true, observation: `Requested download of ${args.url} through NEXA's download engine. Check the Downloads panel.`, page: agentSnapshot() }
      }

      /* ---- Output ---- */
      case 'summarize': {
        const page = await extractReadable()
        if (!page) return { ok: false, observation: '', error: 'no_content' }
        return { ok: true, observation: `Readable content to summarize (Title: ${page.title}):\n${page.text}`, page: agentSnapshot() }
      }
      case 'save_result': {
        return { ok: true, observation: `Saved result "${String(args.label)}".`, page: agentSnapshot() }
      }

      case 'screenshot':
        return { ok: false, observation: '', error: 'capability_unavailable' }

      default:
        return { ok: false, observation: '', error: 'unknown_tool' }
    }
  } catch (e) {
    return { ok: false, observation: '', error: String((e as Error)?.message || 'exec_failed').slice(0, 200) }
  }
}

function describeSnap(): string {
  const s = agentSnapshot()
  return `Now on "${s.title || '(untitled)'}" <${s.url || 'about:blank'}>`
}

// Register the executor once at module load (drives the live webview).
setAgentExecutor(executeAgentTool)

/* ======================= P5 STEP 5 — Worker Assistant scanner ======================= */
// Extra structured capture (runs AFTER OBSERVE_SRC, so data-nx-eid ids exist and
// align with buildObservation's element_N map). Fixed, non-model script. Captures
// radio/checkbox groups (by control name) and select option lists — never page
// prose, never secret values.
const WORKER_EXTRAS_SRC = `(()=>{ try{
  var choices=[]; var selects=[];
  document.querySelectorAll('input[type="radio"][data-nx-eid],input[type="checkbox"][data-nx-eid],[role="radio"][data-nx-eid],[role="checkbox"][data-nx-eid]').forEach(function(el){
    var eid=el.getAttribute('data-nx-eid'); if(!eid) return;
    var kind=(el.type==='radio'||el.getAttribute('role')==='radio')?'radio':'checkbox';
    var lbl=''; try{ if(el.labels&&el.labels.length) lbl=el.labels[0].innerText||''; }catch(_){}
    lbl=lbl||el.getAttribute('aria-label')||el.getAttribute('value')||el.getAttribute('name')||'';
    choices.push({ eid:eid, kind:kind, label:(lbl+'').slice(0,160), checked:!!el.checked, group:(el.getAttribute('name')||'').slice(0,80) });
  });
  document.querySelectorAll('select[data-nx-eid]').forEach(function(el){
    var eid=el.getAttribute('data-nx-eid'); if(!eid) return;
    var lbl=''; try{ if(el.labels&&el.labels.length) lbl=el.labels[0].innerText||''; }catch(_){}
    lbl=lbl||el.getAttribute('aria-label')||el.getAttribute('name')||'';
    var opts=Array.from(el.options||[]).map(function(o){ return ((o.text||o.value||'')+'').trim().slice(0,160); }).filter(Boolean).slice(0,40);
    selects.push({ eid:eid, label:(lbl+'').slice(0,160), options:opts });
  });
  return JSON.stringify({ choices:choices, selects:selects });
}catch(e){ return JSON.stringify({}); } })()`

/**
 * Live Worker scan: reuses the existing P5.2 OBSERVE_SRC capture + buildObservation
 * (bounded + secret-redacted) then the pure scanObservation() to detect questions,
 * fields, options and buttons. Also returns bounded readable page text used ONLY
 * for local AI suggestions (never persisted). Deterministic; no model involved.
 */
async function workerScanLive(): Promise<WorkerScanResult | null> {
  const wv = activeWebview()
  if (!wv?.executeJavaScript) return null
  const raw = JSON.parse(String((await runJs(OBSERVE_SRC)) || '{}')) as RawObservation
  const obs = buildObservation(raw)
  if (!obs.url && obs.elements.length === 0) return null
  let extras: WorkerRawExtras = {}
  try {
    extras = JSON.parse(String((await runJs(WORKER_EXTRAS_SRC)) || '{}')) as WorkerRawExtras
  } catch {
    extras = {}
  }
  const scan = scanObservation(obs, extras)
  const page = await extractReadable()
  const contextText = page?.text ? page.text.slice(0, WORKER_MAX_CONTEXT_CHARS) : ''
  return { scan, contextText }
}

setWorkerScanner(workerScanLive)

/** Map a raw observed element to the deterministic vault field classifier input. */
function toVaultField(e: NonNullable<RawObservation['elements']>[number]): VaultFieldInput {
  return {
    id: String(e.id || ''),
    tag: e.tag,
    role: e.role,
    type: e.type,
    name: e.name,
    autocomplete: e.autocomplete,
    ariaLabel: e.ariaLabel,
    label: e.label,
    placeholder: e.placeholder
  }
}

/**
 * Secure vault autofill runner (renderer side ONLY). Observes the live page to
 * assign ephemeral data-nx-eid ids, deterministically resolves the username +
 * password targets, and calls the capability-specific IPC with the guest
 * webContents id. The secret is decrypted + injected in MAIN; this function
 * NEVER sees or returns it — only { ok, filled }. Never submits.
 */
async function vaultAutofillLive(req: {
  credentialId: string
  mode: 'ask' | 'assist' | 'agent'
}): Promise<{ ok: boolean; filled?: boolean; error?: string }> {
  const st = useNexa.getState()
  const wv = activeWebview()
  if (!wv?.executeJavaScript || typeof wv.getWebContentsId !== 'function') {
    return { ok: false, error: 'not_ready' }
  }
  let fields: VaultFieldInput[]
  try {
    const raw = JSON.parse(String((await runJs(OBSERVE_SRC)) || '{}')) as RawObservation
    fields = (raw.elements || []).map(toVaultField)
  } catch {
    return { ok: false, error: 'not_ready' }
  }
  const targets = findLoginFields(fields)
  if (!targets.passwordEid) return { ok: false, error: 'no_password_field' }
  const webContentsId = wv.getWebContentsId()
  if (!window.nexa) return { ok: false, error: 'not_ready' }
  const res = await window.nexa.passwordManager.autofill({
    profileId: st.activeProfile,
    credentialId: req.credentialId,
    webContentsId,
    usernameEid: targets.usernameEid,
    passwordEid: targets.passwordEid,
    mode: req.mode
  })
  if (res?.ok) return { ok: true, filled: !!res.data.filled }
  return { ok: false, error: res?.error?.code || 'autofill_failed' }
}

setVaultAutofill(vaultAutofillLive)

/* ======================= P7 STEP 7 — Privacy Center probe ======================= */

/** Parse the address + type out of an SDP ICE candidate string (fallback). */
function parseCandidate(candidate: string): { address: string | null; type: string | null } {
  const parts = String(candidate || '').split(' ')
  // candidate:<foundation> <component> <proto> <priority> <address> <port> typ <type> ...
  const address = parts.length > 4 ? parts[4] : null
  const typIdx = parts.indexOf('typ')
  const type = typIdx >= 0 && parts.length > typIdx + 1 ? parts[typIdx + 1] : null
  return { address, type }
}

/**
 * Bounded WebRTC diagnostic. Uses an EMPTY iceServers list (no external STUN),
 * so only host candidates gather — this detects local-IP exposure with ZERO
 * external network calls. Public-candidate detection would require a STUN server
 * (documented as NOT_CONFIGURED). Never disables WebRTC; diagnostic only.
 */
function probeWebrtc(): Promise<{ available: boolean; candidates: RawIceCandidate[] }> {
  if (typeof RTCPeerConnection === 'undefined') return Promise.resolve({ available: false, candidates: [] })
  return new Promise((resolve) => {
    const candidates: RawIceCandidate[] = []
    let done = false
    let pc: RTCPeerConnection | null = null
    const finish = () => {
      if (done) return
      done = true
      try {
        pc?.close()
      } catch {
        /* ignore */
      }
      resolve({ available: true, candidates })
    }
    try {
      pc = new RTCPeerConnection({ iceServers: [] })
      pc.createDataChannel('nexa-privacy-probe')
      pc.onicecandidate = (e) => {
        if (!e.candidate) return finish()
        const c = e.candidate as RTCIceCandidate & { address?: string | null; protocol?: string | null }
        const parsed = parseCandidate(c.candidate)
        candidates.push({
          address: c.address ?? parsed.address,
          type: c.type ?? parsed.type,
          protocol: c.protocol ?? null
        })
      }
      pc.createOffer()
        .then((o) => pc!.setLocalDescription(o))
        .catch(() => finish())
      setTimeout(finish, 1500)
    } catch {
      resolve({ available: false, candidates: [] })
    }
  })
}

/**
 * Deterministic fingerprint-surface probe: reports which high-entropy signals are
 * READABLE (adds to the surface). Values shown are the user's OWN device info,
 * displayed locally only — never transmitted, persisted, randomized, or spoofed.
 */
function probeFingerprint(): { signals: Record<string, boolean>; details: PrivacyProbeResult['fingerprintDetails'] } {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { brands?: { brand: string }[] } }
  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    } catch {
      return ''
    }
  })()
  const gpu = (() => {
    try {
      const cv = document.createElement('canvas')
      const gl = (cv.getContext('webgl') || cv.getContext('experimental-webgl')) as WebGLRenderingContext | null
      if (!gl) return ''
      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      return dbg ? String(gl.getParameter((dbg as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL)) : ''
    } catch {
      return ''
    }
  })()
  const canvasCap = (() => {
    try {
      return !!document.createElement('canvas').getContext('2d')
    } catch {
      return false
    }
  })()
  const audioCap =
    typeof (window as unknown as { AudioContext?: unknown }).AudioContext !== 'undefined' ||
    typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined'
  const scr = typeof screen !== 'undefined' ? screen : ({} as Screen)
  const signals: Record<string, boolean> = {
    userAgent: !!nav.userAgent,
    platform: !!nav.platform,
    language: !!nav.language,
    timezone: !!tz,
    screen: !!(scr && scr.width),
    devicePixelRatio: typeof window.devicePixelRatio === 'number',
    hardwareConcurrency: typeof nav.hardwareConcurrency === 'number',
    deviceMemory: typeof nav.deviceMemory === 'number',
    webglRenderer: !!gpu,
    colorDepth: typeof scr.colorDepth === 'number',
    touch: typeof nav.maxTouchPoints === 'number',
    canvas: canvasCap,
    audio: audioCap
  }
  const details: PrivacyProbeResult['fingerprintDetails'] = {
    timezone: tz,
    language: nav.language,
    screen: scr && scr.width ? `${scr.width}×${scr.height}` : '',
    devicePixelRatio: typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : undefined,
    hardwareConcurrency: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : undefined,
    deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
    gpu,
    colorDepth: typeof scr.colorDepth === 'number' ? scr.colorDepth : undefined,
    touch: typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints > 0 : undefined,
    userAgentBrand: (nav.userAgentData?.brands || []).map((b) => b.brand).join(', ') || ''
  }
  return { signals, details }
}

/** Query supported permission states (read-only; never requests access). */
async function probePermissions(): Promise<Record<string, PermissionStatus>> {
  const names = ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read']
  const out: Record<string, PermissionStatus> = {}
  const perms = (navigator as Navigator & { permissions?: { query?: (d: { name: string }) => Promise<{ state: string }> } }).permissions
  for (const name of names) {
    try {
      if (!perms?.query) {
        out[name] = 'unavailable'
        continue
      }
      const res = await perms.query({ name })
      out[name] = (res.state as PermissionStatus) || 'unknown'
    } catch {
      out[name] = 'unavailable'
    }
  }
  return out
}

/**
 * Privacy Center browser-native probe (renderer). Bounded + on-demand. Returns
 * RAW signals for the pure `@shared/privacy` classifiers. No AI, no persistence,
 * no external calls.
 */
async function privacyProbeLive(): Promise<PrivacyProbeResult> {
  const wv = activeWebview()
  const webContentsId = wv && typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null
  const [webrtc, fp] = await Promise.all([probeWebrtc(), Promise.resolve(probeFingerprint())])
  const permissions = await probePermissions()
  return {
    webContentsId,
    webrtcAvailable: webrtc.available,
    webrtcCandidates: webrtc.candidates,
    fingerprint: fp.signals,
    fingerprintDetails: fp.details,
    permissions
  }
}

setPrivacyProbe(privacyProbeLive)

async function aiSummarizePage() {
  const st = useNexa.getState()
  if (!aiConnectedOrWarn()) return
  const page = await extractReadable()
  if (!page) {
    st.toastMsg('Page content unavailable', 'warn')
    return
  }
  st.aiRunOp('summarize', { title: page.title, content: page.text }, `Summarize this page${page.title ? ` — ${page.title}` : ''}`)
}

// "Ask About This Page": load the page as persistent context for multi-turn Q&A.
async function aiAskAboutPage() {
  const st = useNexa.getState()
  if (!aiConnectedOrWarn()) return
  const page = await extractReadable()
  if (!page) {
    st.toastMsg('Page content unavailable', 'warn')
    return
  }
  st.setAiPageContext({ title: page.title, url: page.url, text: page.text })
  useNexa.setState({ aiOpen: true })
  st.toastMsg(`Page context added${page.truncated ? ' (truncated to fit)' : ''} — ask anything about it`)
}

async function aiSelectionOp(op: 'explain' | 'translate' | 'rewrite', mode?: RewriteMode) {
  const st = useNexa.getState()
  if (!aiConnectedOrWarn()) return
  const sel = await getSelectionText()
  if (!sel.trim()) {
    st.toastMsg('Select some text on the page first', 'warn')
    return
  }
  const labels: Record<string, string> = {
    explain: 'Explain selection',
    translate: 'Translate selection to English',
    rewrite: `Rewrite selection${mode ? ` · ${mode}` : ''}`
  }
  st.aiRunOp(op, { selection: sel, targetLang: op === 'translate' ? 'English' : undefined, mode }, labels[op])
}

async function vpnAction(kind: 'connect' | 'disconnect' | 'reconnect') {
  const st = useNexa.getState()
  const id = st.activeProfile
  const r = await window.nexa.vpn[kind](id)
  if (!r?.ok && r?.error) st.toastMsg(r.error.message, 'err')
}

async function protectionForSite(enabled: boolean) {
  const st = useNexa.getState()
  const tab = st.session.tabs.find((t) => t.id === st.session.activeTab)
  if (!tab || tab.kind !== 'web' || !tab.url) {
    st.toastMsg('Open a website first', 'warn')
    return
  }
  const domain = registrableDomain(hostnameOf(tab.url))
  const r = await window.nexa.protection.setSiteEnabled({ profileId: st.activeProfile, domain, enabled })
  if (r?.ok) st.toastMsg(enabled ? `Protection on · ${domain}` : `Protection off · ${domain}`)
  else st.toastMsg(r?.error?.message || 'Could not update site', 'err')
}

const PALETTE_GROUPS: string[] = ['Browser', 'Turbo', 'Library', 'Downloads', 'Protection', 'Privacy', 'Cloud', 'AI', 'Agent', 'Worker', 'VPN', 'Region', 'Extensions', 'Appearance', 'Privacy & Vault', 'App']
function paletteGroup(label: string): string {
  if (label.startsWith('AI:')) return 'AI'
  if (label === 'Extensions' || label.startsWith('Extensions:')) return 'Extensions'
  if (label.startsWith('Agent:')) return 'Agent'
  if (label.startsWith('Worker:')) return 'Worker'
  if (label.startsWith('VPN:')) return 'VPN'
  if (label.startsWith('Privacy:')) return 'Privacy'
  if (label.startsWith('Drive:')) return 'Cloud'
  if (label.startsWith('Turbo')) return 'Turbo'
  if (label.startsWith('Region:')) return 'Region'
  if (label.startsWith('Theme:')) return 'Appearance'
  if (/download/i.test(label)) return 'Downloads'
  if (/protection/i.test(label)) return 'Protection'
  if (/bookmark|history|collection/i.test(label)) return 'Library'
  if (/\btab\b/i.test(label)) return 'Browser'
  if (/vault|password/i.test(label)) return 'Privacy & Vault'
  return 'App'
}

function Palette() {
  const query = useNexa((s) => s.query)
  const [sel, setSel] = useState(0)
  useEffect(() => setSel(0), [query])
  const vpn = useNexa((s) => s.vpn)
  const vpnServers = useNexa((s) => s.vpnServers)
  const vp = vpnUiProjection({ state: vpn?.state || 'not_configured', capability: vpn?.capability || 'unknown', hasServers: vpnServers.length > 0 })
  const aiStatus = useNexa((s) => s.aiStatus)
  const aiActiveTab = useNexa((s) => s.session.tabs.find((t) => t.id === s.session.activeTab))
  const aiConnected = aiStatus?.state === 'connected'
  const onWebPage = aiActiveTab?.kind === 'web' && !!aiActiveTab.url
  const agentState = useNexa((s) => s.agentState)
  const agentRunning = ['planning', 'awaiting_permission', 'executing', 'observing'].includes(agentState)
  const agentPaused = agentState === 'paused'
  const agentCmds: { label: string; kbd?: string; act: () => void }[] = aiConnected
    ? [
        { label: 'Agent: Start Browser Agent', act: () => useNexa.setState({ aiOpen: true, agentMode: 'agent' }) },
        { label: 'Agent: Assist Mode (confirm each action)', act: () => useNexa.setState({ aiOpen: true, agentMode: 'assist' }) },
        ...(onWebPage ? [{ label: 'Agent: Run Agent on This Page (summarize)', act: () => void useNexa.getState().agentStart('Read the current page and give me a concise summary.') }] : []),
        ...(onWebPage && !agentRunning && !agentPaused
          ? [
              { label: 'Agent: Observe Page Structure', act: () => void useNexa.getState().agentStart('Observe the page and describe its structure and the main interactive elements.') },
              { label: 'Agent: Extract Table', act: () => void useNexa.getState().agentStart('Extract the main table on this page as structured rows.') },
              { label: 'Agent: Extract Links', act: () => void useNexa.getState().agentStart('Extract the links on this page.') },
              { label: 'Agent: Find Text on Page', act: () => void useNexa.getState().agentStart('Find where the requested text appears on this page.') },
              { label: 'Agent: Scroll to Text', act: () => void useNexa.getState().agentStart('Scroll to the requested text on this page.') },
              { label: 'Agent: Describe Page Visually (vision)', act: () => void useNexa.getState().agentStart('Use visual observation to describe the main visual sections of this page.') },
              { label: 'Agent: Find Control Visually (vision)', act: () => void useNexa.getState().agentStart('Use visual observation to locate the visually prominent primary control on this page.') }
            ]
          : []),
        ...(agentRunning ? [{ label: 'Agent: Pause Agent', act: () => useNexa.getState().agentPause() }] : []),
        ...(agentPaused ? [{ label: 'Agent: Resume Agent', act: () => useNexa.getState().agentResume() }] : []),
        ...(agentRunning || agentPaused ? [{ label: 'Agent: Stop Agent', act: () => useNexa.getState().agentCancel() }] : [])
      ]
    : []
  // State-aware: page/selection commands only appear when a web page is open and
  // AI is connected. When AI is offline only the recovery commands are shown.
  const aiCmds: { label: string; kbd?: string; act: () => void }[] = aiConnected
    ? [
        { label: 'AI: Ask AI', act: () => useNexa.setState({ aiOpen: true }) },
        ...(onWebPage
          ? [
              { label: 'AI: Ask About Page', act: () => void aiAskAboutPage() },
              { label: 'AI: Summarize Page', act: () => void aiSummarizePage() },
              { label: 'AI: Explain Selection', act: () => void aiSelectionOp('explain') },
              { label: 'AI: Translate Selection', act: () => void aiSelectionOp('translate') },
              { label: 'AI: Rewrite Selection (Clearer)', act: () => void aiSelectionOp('rewrite', 'clearer') }
            ]
          : []),
        { label: 'AI: Select AI Model', act: () => useNexa.setState({ aiOpen: true }) },
        { label: 'AI: Open AI Settings', act: () => useNexa.getState().setView('settings', 'ai') }
      ]
    : [
        { label: 'AI: AI unavailable — check status', act: () => { useNexa.setState({ aiOpen: true }); void useNexa.getState().loadAiStatus() } },
        { label: 'AI: Check AI Status', act: async () => { await useNexa.getState().loadAiStatus(); const s = useNexa.getState().aiStatus; const name = s?.providerName || 'AI'; useNexa.getState().toastMsg(s?.state === 'connected' ? `${name} connected` : s?.note || `${name} offline`, s?.state === 'connected' ? 'ok' : 'warn') } },
        { label: 'AI: Open AI Settings', act: () => useNexa.getState().setView('settings', 'ai') }
      ]
  // STEP 12 — provider-management commands (always available).
  const aiProviderCmds: { label: string; kbd?: string; act: () => void }[] = [
    { label: 'AI: Choose Provider', act: () => useNexa.getState().setView('settings', 'ai') },
    { label: 'AI: Choose Model', act: () => useNexa.getState().setView('settings', 'ai') },
    { label: 'AI: Test Provider', act: async () => { const id = useNexa.getState().aiConfig?.providerId || 'nexa'; const r = await useNexa.getState().testAiProvider(id as never); useNexa.getState().toastMsg(`${id} · ${r.state}`, r.ok ? 'ok' : 'warn') } },
    { label: 'AI: AI Settings', act: () => useNexa.getState().setView('settings', 'ai') },
    { label: 'AI: Use NEXA Free AI', act: () => { void useNexa.getState().setNexaAiMode('free'); useNexa.getState().toastMsg('AI · NEXA Free AI') } },
    { label: 'AI: Use Local AI', act: () => { void useNexa.getState().updateAiConfig({ providerId: 'ollama', privacyMode: 'local_only' }).then(() => useNexa.getState().loadAiStatus()); useNexa.getState().toastMsg('AI · local Ollama') } },
    { label: 'AI: Enable Cloud AI', act: () => useNexa.getState().setView('settings', 'ai') }
  ]
  const workerCmds: { label: string; kbd?: string; act: () => void }[] = [
    { label: 'Worker: Open Worker Assistant', act: () => useNexa.getState().setWorkerOpen(true) },
    ...(onWebPage
      ? [
          { label: 'Worker: Scan Page', act: () => void useNexa.getState().workerScanPage() },
          ...(aiConnected
            ? [{ label: 'Worker: Generate Page Answers', act: async () => { await useNexa.getState().workerScanPage(); await useNexa.getState().workerGenerate() } }]
            : []),
          { label: 'Worker: Fill Approved Fields', act: () => void useNexa.getState().workerFill() }
        ]
      : []),
    { label: 'Worker: Clear Worker Session', act: () => useNexa.getState().workerClearSession() }
  ]
  const driveConnected = !!useNexa.getState().driveMeta?.connected
  const turboEnabled = useNexa.getState().prefs.toggles.turbo
  const driveCmds: { label: string; kbd?: string; act: () => void }[] = [
    { label: 'Drive: Open Google Drive', act: () => useNexa.getState().openDrive() },
    ...(driveConnected
      ? [{ label: 'Drive: Disconnect Google Drive', act: () => void useNexa.getState().driveDisconnect() }]
      : [{ label: 'Drive: Connect Google Drive', act: () => void useNexa.getState().driveConnect() }]),
    { label: 'Drive: Search Google Drive', act: () => useNexa.getState().openDrive() }
  ]
  const privacyCmds: { label: string; kbd?: string; act: () => void }[] = [
    { label: 'Privacy: Open Privacy Center', act: () => useNexa.getState().openPrivacyCenter() },
    { label: 'Privacy: Run Privacy Check', act: () => { useNexa.getState().setView('privacy'); void useNexa.getState().runPrivacyCheck() } },
    { label: 'Privacy: Check IP & Connection', act: () => useNexa.getState().openPrivacyCenter() },
    { label: 'Privacy: Check DNS', act: () => useNexa.getState().openPrivacyCenter() },
    { label: 'Privacy: Check WebRTC', act: () => useNexa.getState().openPrivacyCenter() },
    { label: 'Privacy: Check Fingerprint', act: () => useNexa.getState().openPrivacyCenter() }
  ]
  const vpnCmds: { label: string; kbd?: string; act: () => void }[] = [
    ...(vp.commands.includes('connect') ? [{ label: 'VPN: Connect', act: () => vpnAction('connect') }] : []),
    ...(vp.commands.includes('disconnect') ? [{ label: 'VPN: Disconnect', act: () => vpnAction('disconnect') }] : []),
    ...(vp.commands.includes('reconnect') ? [{ label: 'VPN: Reconnect', act: () => vpnAction('reconnect') }] : []),
    ...(vp.commands.includes('configure') ? [{ label: 'VPN: Configure VPN', act: () => useNexa.getState().setView('settings', 'vpn') }] : []),
    { label: 'VPN: Open VPN Settings', act: () => useNexa.getState().setView('settings', 'vpn') }
  ]
  const turboCmds: { label: string; kbd?: string; act: () => void }[] = [
    ...(turboEnabled
      ? [{ label: 'Turbo Mode: Off', act: () => useNexa.getState().setTurboEnabled(false) }]
      : [{ label: 'Turbo Mode: On', act: () => useNexa.getState().setTurboEnabled(true) }]),
    { label: 'Turbo: Open Turbo Settings', act: () => useNexa.getState().setView('settings', 'turbo') },
    { label: 'Turbo: Show Last Navigation Performance', act: () => useNexa.getState().openTurbo() }
  ]
  const regionalCmds: { label: string; kbd?: string; act: () => void }[] = [
    { label: 'Region: Open Language & Region', act: () => useNexa.getState().setView('settings', 'regional') },
    { label: 'Region: Change Timezone', act: () => useNexa.getState().setView('settings', 'regional') },
    { label: 'Region: Change Language', act: () => useNexa.getState().setView('settings', 'regional') }
  ]
  const extensionCmds: { label: string; kbd?: string; act: () => void }[] = [
    { label: 'Extensions', act: () => useNexa.getState().setView('settings', 'extensions') },
    { label: 'Extensions: Manage', act: () => useNexa.getState().setView('settings', 'extensions') },
    { label: 'Extensions: Install Local Extension', act: () => { useNexa.getState().setView('settings', 'extensions'); void useNexa.getState().installExtension() } },
    { label: 'Extensions: View Permissions', act: () => useNexa.getState().setView('settings', 'extensions') }
  ]
  const cmds = [
    { label: 'Bookmark this page', kbd: '⌘D', act: () => useNexa.getState().bookmarkCurrent() },
    { label: 'Open Bookmarks', act: () => useNexa.getState().setView('bookmarks') },
    { label: 'Toggle bookmark bar', kbd: '⌘⇧B', act: () => useNexa.getState().setPref('bookmarkBar', !useNexa.getState().prefs.bookmarkBar) },
    { label: 'Open History', kbd: '⌘H', act: () => useNexa.getState().setView('history') },
    { label: 'Clear browsing history (all time)', act: async () => { const id = useNexa.getState().activeProfile; await window.nexa.history.clear({ profileId: id, range: 'all' }); useNexa.getState().refreshHistory(); useNexa.getState().toastMsg('History cleared') } },
    { label: 'Open Collections', act: () => useNexa.getState().setView('collections') },
    { label: 'New Collection', act: async () => { const name = window.prompt('Collection name', 'New Collection'); if (name === null) return; const id = useNexa.getState().activeProfile; const res = await window.nexa.collections.create({ profileId: id, name }); if (res?.ok) { useNexa.setState({ collections: res.data }); useNexa.getState().setView('collections') } } },
    { label: 'Reopen closed tab', kbd: '⌘⇧T', act: () => useNexa.getState().reopenClosedTab() },
    { label: 'New private tab', kbd: '⌘⇧N', act: () => useNexa.getState().newPrivateTab() },
    { label: 'Open Downloads', kbd: '⌘⇧D', act: () => useNexa.getState().setView('downloads') },
    { label: 'Pause all downloads', act: async () => { await window.nexa.downloads.pauseAll(useNexa.getState().activeProfile); useNexa.getState().toastMsg('Paused active downloads') } },
    { label: 'Resume all downloads', act: async () => { await window.nexa.downloads.resumeAll(useNexa.getState().activeProfile); useNexa.getState().toastMsg('Resuming paused downloads') } },
    { label: 'Clear completed downloads', act: async () => { const r = await window.nexa.downloads.clearCompleted(useNexa.getState().activeProfile); if (r?.ok) { useNexa.setState({ downloads: r.data }); useNexa.getState().toastMsg('Cleared completed downloads') } } },
    { label: 'Open downloads folder', act: async () => { await window.nexa.downloads.openFolder(useNexa.getState().activeProfile) } },
    { label: 'Open Protection Dashboard', act: () => useNexa.getState().setView('protection') },
    { label: 'Enable Protection', act: async () => { await window.nexa.protection.setEnabled({ profileId: useNexa.getState().activeProfile, enabled: true }); useNexa.getState().toastMsg('Protection enabled') } },
    { label: 'Disable Protection', act: async () => { await window.nexa.protection.setEnabled({ profileId: useNexa.getState().activeProfile, enabled: false }); useNexa.getState().toastMsg('Protection disabled') } },
    { label: 'Disable Protection for This Site', act: () => protectionForSite(false) },
    { label: 'Enable Protection for This Site', act: () => protectionForSite(true) },
    { label: 'Open Protection Settings', act: () => useNexa.getState().setView('settings', 'protection') },
    { label: 'Open Cloud Transfer', kbd: '⌘⇧C', act: () => useNexa.getState().setView('cloud') },
    { label: 'Open Password Manager', act: () => useNexa.getState().setView('settings', 'passwords') },
    { label: 'Open Settings', kbd: '⌘,', act: () => useNexa.getState().setView('settings') },
    { label: 'Open Dashboard', act: () => useNexa.getState().setView('newtab') },
    { label: 'Customize Dashboard', act: () => { useNexa.getState().setView('newtab'); useNexa.getState().setOverlay('customize') } },
    { label: 'Theme: Toggle light / dark', act: () => useNexa.getState().toggleTheme() },
    ...aiCmds,
    ...aiProviderCmds,
    ...agentCmds,
    ...workerCmds,
    ...privacyCmds,
    ...driveCmds,
    ...vpnCmds,
    ...turboCmds,
    ...regionalCmds,
    ...extensionCmds,
    { label: 'Lock password vault', act: async () => { await window.nexa.passwordManager.lock(useNexa.getState().activeProfile); useNexa.setState({ vaultUnlocked: false, vaultCreds: [] }); useNexa.getState().toastMsg('Vault locked') } },
    { label: 'About NEXA', act: () => useNexa.getState().setView('about') }
  ].filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase()))
  // Stable group ordering; within a group original order is preserved (stable sort).
  const ordered = cmds
    .map((c) => ({ ...c, group: paletteGroup(c.label) }))
    .sort((a, b) => PALETTE_GROUPS.indexOf(a.group) - PALETTE_GROUPS.indexOf(b.group))
  const selIdx = ordered.length ? Math.min(sel, ordered.length - 1) : 0
  const runAt = (i: number) => {
    const c = ordered[i]
    if (!c) return
    useNexa.getState().setOverlay(null)
    c.act()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, ordered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runAt(selIdx)
    }
    // Escape is handled by the global overlay key handler.
  }
  let lastGroup = ''
  return (
    <div className="overlay" style={{ alignItems: 'flex-start', paddingTop: 110 }} onClick={() => useNexa.getState().setOverlay(null)}>
      <div className="modal" style={{ width: 600 }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ padding: '15px 18px', borderBottom: '1px solid var(--border)', gap: 11 }}>
          <MagnifyingGlass size={18} color="var(--text-3)" />
          <input
            autoFocus
            value={query}
            onChange={(e) => useNexa.setState({ query: e.target.value })}
            onKeyDown={onKey}
            placeholder="Search, ask AI, or run a command…"
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={ordered[selIdx] ? `palette-cmd-${selIdx}` : undefined}
            style={{ flex: 1, background: 'none', border: 'none', fontSize: 15 }}
          />
          <span className="pill">esc</span>
        </div>
        <div id="palette-list" role="listbox" style={{ maxHeight: 360, overflow: 'auto', padding: 7 }}>
          {ordered.map((c, i) => {
            const header = c.group !== lastGroup ? ((lastGroup = c.group), c.group) : null
            const selected = i === selIdx
            return (
              <div key={c.label}>
                {header && (
                  <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)', padding: i === 0 ? '4px 12px 6px' : '12px 12px 6px' }}>
                    {header}
                  </div>
                )}
                <button
                  id={`palette-cmd-${i}`}
                  role="option"
                  aria-selected={selected}
                  ref={(el) => {
                    if (selected && el) el.scrollIntoView({ block: 'nearest' })
                  }}
                  onMouseMove={() => sel !== i && setSel(i)}
                  onClick={() => runAt(i)}
                  className="row"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 9, textAlign: 'left', gap: 12, background: selected ? 'var(--accent-weak)' : 'transparent' }}
                >
                  <Lightning size={16} color={selected ? 'var(--accent-2)' : 'var(--accent)'} />
                  <span style={{ fontSize: 13.5, flex: 1, color: selected ? 'var(--accent-2)' : 'var(--text)', fontWeight: selected ? 600 : 400 }}>{c.label}</span>
                  {c.kbd && <span className="pill">{c.kbd}</span>}
                </button>
              </div>
            )
          })}
          {!ordered.length && <div style={{ padding: 22, textAlign: 'center', color: 'var(--text-3)' }}>No commands match “{query}”</div>}
        </div>
      </div>
    </div>
  )
}

function ProfileMenu() {
  const profiles = useNexa((s) => s.profiles)
  const active = useNexa((s) => s.activeProfile)
  const p = profiles[active]
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, zIndex: 44 }} onClick={() => useNexa.getState().setOverlay(null)} />
      <div className="popover" style={{ top: 130, right: 14, width: 272 }}>
        <div className="row" style={{ gap: 11, padding: '14px 15px', borderBottom: '1px solid var(--border)' }}>
          <Avatar size={38} src={p.avatar} name={p.name} accent={p.accent} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{p.status} profile · local</div>
          </div>
        </div>
        <div style={{ padding: '7px 8px 3px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)', padding: '2px 8px 6px' }}>Switch profile</div>
          {Object.values(profiles).map((x) => (
            <button key={x.id} className="row" style={{ width: '100%', padding: '7px 8px', borderRadius: 8, gap: 10, textAlign: 'left' }} onClick={() => useNexa.getState().switchProfile(x.id)}>
              <Avatar size={26} src={x.avatar} name={x.name} accent={x.accent} />
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: x.id === active ? 600 : 400 }}>{x.status}</span>
              {x.id === active && <Check size={13} weight="bold" color="var(--accent)" />}
            </button>
          ))}
          <button className="row" style={{ width: '100%', padding: '7px 8px', borderRadius: 8, gap: 10, color: 'var(--accent-2)', textAlign: 'left' }} onClick={() => useNexa.getState().setOverlay('addProfile')}>
            <span style={{ width: 26, height: 26, borderRadius: '50%', border: '1px dashed var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plus size={13} />
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>Add profile</span>
          </button>
        </div>
        <div style={{ padding: 6 }}>
          <MenuRow icon={<UserCircle size={16} />} label="Edit profile" onClick={() => useNexa.setState({ overlay: 'editProfile', profileDraft: { ...p } })} />
          <MenuRow icon={<SquaresFour size={16} />} label="Customize dashboard" onClick={() => { useNexa.getState().setView('newtab'); useNexa.getState().setOverlay('customize') }} />
          <MenuRow icon={<UserCircle size={16} />} label="Manage account" onClick={() => useNexa.getState().toastMsg('Local profile · NEXA account not configured', 'warn')} />
          <MenuRow icon={<Gear size={16} />} label="Settings" kbd="⌘," onClick={() => useNexa.getState().setView('settings')} />
          <MenuRow icon={<Info size={16} />} label="About NEXA" onClick={() => useNexa.getState().setView('about')} />
        </div>
      </div>
    </>
  )
}

function MenuRow({ icon, label, kbd, onClick }: { icon: ReactNode; label: string; kbd?: string; onClick: () => void }) {
  return (
    <button className="row" onClick={onClick} style={{ width: '100%', height: 36, padding: '0 10px', borderRadius: 8, gap: 11, textAlign: 'left' }}>
      <span style={{ width: 18, display: 'flex', justifyContent: 'center' }}>{icon}</span>
      <span style={{ fontSize: 13, flex: 1 }}>{label}</span>
      {kbd && <span className="pill">{kbd}</span>}
    </button>
  )
}

const VPN_VISUAL: Record<string, { dot: string; label: string }> = {
  protected: { dot: 'var(--success)', label: 'PROTECTED' },
  connecting: { dot: 'var(--warning)', label: 'CONNECTING' },
  disconnecting: { dot: 'var(--warning)', label: 'DISCONNECTING' },
  error: { dot: 'var(--error)', label: 'ERROR' },
  off: { dot: 'var(--text-3)', label: 'OFF' },
  not_configured: { dot: 'var(--text-3)', label: 'NOT CONFIGURED' }
}

function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${u[i]}`
}

function fmtDuration(since: number | null): string {
  if (!since) return '—'
  const s = Math.floor((Date.now() - since) / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${sec}s`
  return `${sec}s`
}

function VpnButton() {
  const vpn = useNexa((s) => s.vpn)
  const servers = useNexa((s) => s.vpnServers)
  const state = vpn?.state || 'not_configured'
  const vp = vpnUiProjection({ state, capability: vpn?.capability || 'unknown', hasServers: servers.length > 0 })
  const short = vp.label === 'NOT CONFIGURED' ? 'SET UP' : vp.label.replace('…', '')
  return (
    <button
      title={`${vp.ariaLabel} — click for options`}
      aria-label={vp.ariaLabel}
      onClick={() => useNexa.getState().setOverlay('vpn')}
      style={{
        height: 34,
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '0 10px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--surface-2)',
        color: vp.tone === 'ok' ? 'var(--success)' : 'var(--text-2)'
      }}
    >
      {state === 'protected' ? <ShieldCheck size={16} weight="fill" /> : <ShieldSlash size={16} />}
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: vpnToneColor(vp.tone) }} />
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em' }}>VPN</span>
      <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-3)' }}>{short}</span>
    </button>
  )
}

/**
 * STEP 9 — Turbo toolbar indicator. Compact, honest state only. Uses existing
 * tokens (no neon/glass). Clicking opens the Turbo popover.
 */
function TurboButton() {
  const state = useNexa((s) => s.turboState())
  const label = turboStateLabel(state)
  const on = state === 'ON' || state === 'OPTIMIZING'
  const optimizing = state === 'OPTIMIZING'
  const color = state === 'NOT_SUPPORTED' ? 'var(--text-3)' : on ? 'var(--accent)' : 'var(--text-2)'
  return (
    <button
      className="icon-btn"
      title={`${label} — click for details`}
      aria-label={label}
      onClick={() => useNexa.getState().openTurbo()}
      style={{ color }}
    >
      <Lightning size={17} weight={on ? 'fill' : 'regular'} className={optimizing ? 'spin' : undefined} />
    </button>
  )
}

/**
 * Subtle, non-blocking navigation progress indicator. No fake percentage/ETA.
 * It only reflects Chromium's real did-start/did-stop loading window and clears
 * when navigation completes. Respects the Turbo progress sub-toggle + reduced motion.
 */
function NavProgress() {
  const loading = useNexa((s) => s.navLoading)
  const show = useNexa((s) => s.prefs.toggles.turbo && s.prefs.turbo.progress && s.navLoading)
  if (!show) return null
  return (
    <div
      role="progressbar"
      aria-label="Page loading"
      aria-busy={loading}
      style={{ position: 'relative', height: 2, overflow: 'hidden', background: 'transparent', flexShrink: 0 }}
    >
      <div className="nav-progress-bar" />
    </div>
  )
}

/** Turbo popover — honest state + real last-navigation timing (or "Not available"). */
function TurboPopover() {
  const state = useNexa((s) => s.turboState())
  const enabled = useNexa((s) => s.prefs.toggles.turbo)
  const tp = useNexa((s) => s.prefs.turbo)
  const perf = useNexa((s) => s.turboLastPerf)
  const sum = summarizePerf(perf)
  const active = enabled
  const row = (label: string, ok: boolean) => (
    <div className="row" style={{ gap: 8, padding: '4px 0', color: ok ? 'var(--text)' : 'var(--text-3)' }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? 'var(--success)' : 'var(--border)' }} />
      <span style={{ fontSize: 12.5 }}>{label}</span>
    </div>
  )
  const stat = (k: string, v: string) => (
    <div className="row" style={{ justifyContent: 'space-between', padding: '3px 0' }}>
      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{k}</span>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{v}</span>
    </div>
  )
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, zIndex: 44 }} onClick={() => useNexa.getState().setOverlay(null)} />
      <div className="popover" style={{ top: 130, right: 122, width: 300 }} role="dialog" aria-label="NEXA Turbo">
        <div className="row" style={{ padding: '15px 16px', borderBottom: '1px solid var(--border)', gap: 11 }}>
          <Lightning size={19} weight={active ? 'fill' : 'regular'} color={active ? 'var(--accent)' : 'var(--text-2)'} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Turbo Mode</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{turboStateLabel(state)}</div>
          </div>
          <button
            className={`toggle ${enabled ? 'on' : ''}`}
            aria-label="Toggle Turbo Mode"
            onClick={() => useNexa.getState().setTurboEnabled(!enabled)}
          >
            <span />
          </button>
        </div>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          {row('Safe navigation prediction', enabled && tp.predict)}
          {row('Connection & cache reuse (Chromium)', enabled)}
          {row('Progressive rendering', enabled && tp.progress)}
        </div>
        <div style={{ padding: '10px 16px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 4 }}>
            LAST NAVIGATION · {sum.classification.toUpperCase()}
          </div>
          {stat('TTFB', sum.ttfb)}
          {stat('DOMContentLoaded', sum.domContentLoaded)}
          {stat('Load', sum.load)}
          {sum.fromCache != null && stat('Served from cache', sum.fromCache ? 'Yes' : 'No')}
        </div>
        <div className="row" style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
          <button className="ghost" style={{ flex: 1 }} onClick={() => useNexa.getState().setView('settings', 'turbo')}>
            Turbo settings
          </button>
        </div>
        <div className="honest" style={{ margin: '0 16px 14px' }}>
          Turbo optimizes NEXA&apos;s local behavior. It can&apos;t change remote server, network, DNS, TLS or third-party
          script time.
        </div>
      </div>
    </>
  )
}

function VpnPanel() {
  const id = useNexa((s) => s.activeProfile)
  const vpn = useNexa((s) => s.vpn)
  const servers = useNexa((s) => s.vpnServers)
  const [busy, setBusy] = useState(false)
  const state = vpn?.state || 'not_configured'
  const v = VPN_VISUAL[state] || VPN_VISUAL.not_configured
  const capability = vpn?.capability || 'unknown'
  const hasServers = servers.length > 0

  async function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setBusy(true)
    try {
      const r = await fn()
      if (!r.ok && r.error) useNexa.getState().toastMsg(r.error.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const close = () => useNexa.getState().setOverlay(null)
  const goSettings = () => {
    close()
    useNexa.getState().setView('settings', 'vpn')
  }

  return (
    <>
      <div style={{ position: 'absolute', inset: 0, zIndex: 44 }} onClick={close} />
      <div className="popover" style={{ top: 130, right: 96, width: 320 }} role="dialog" aria-label="NEXA VPN">
        <div style={{ padding: '15px 16px 14px', borderBottom: '1px solid var(--border)' }}>
          <div className="row" style={{ gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {state === 'protected' ? <ShieldCheck size={19} color="var(--success)" /> : <ShieldSlash size={19} color="var(--text-2)" />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.03em' }}>NEXA VPN</div>
              <div className="row" style={{ gap: 6, marginTop: 2 }}>
                <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: v.dot }} />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{v.label}</span>
              </div>
            </div>
          </div>
        </div>

        {state === 'protected' && vpn ? (
          <div style={{ padding: '13px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 12px' }}>
            <Kv k="Server" val={vpn.serverName || '—'} />
            <Kv k="Connected" val={fmtDuration(vpn.connectedSince)} />
            <Kv k="Received" val={fmtBytes(vpn.health?.rxBytes)} />
            <Kv k="Sent" val={fmtBytes(vpn.health?.txBytes)} />
            <Kv k="Handshake" val={vpn.health?.handshakeAgeSec != null ? `${vpn.health.handshakeAgeSec}s ago` : '—'} />
            <Kv k="Endpoint" val={vpn.health?.endpoint || '—'} />
          </div>
        ) : state === 'error' ? (
          <div style={{ padding: 15, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
            {vpn?.lastError || 'The VPN tunnel could not be established.'}
          </div>
        ) : capability === 'unavailable' ? (
          <div style={{ padding: 15, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
            WireGuard tooling was not detected on this system. Install WireGuard to enable the VPN engine.
          </div>
        ) : !hasServers ? (
          <div style={{ padding: 15, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
            No WireGuard configuration has been added.
          </div>
        ) : (
          <div style={{ padding: '13px 16px' }}>
            <Kv k="Server" val={vpn?.serverName || servers[0]?.name || '—'} />
          </div>
        )}

        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {state === 'protected' ? (
            <button className="ghost" disabled={busy} onClick={() => run(() => window.nexa.vpn.disconnect(id))}>
              Disconnect
            </button>
          ) : state === 'connecting' || state === 'disconnecting' ? (
            <button className="ghost" disabled={busy} onClick={() => run(() => window.nexa.vpn.disconnect(id))}>
              Cancel
            </button>
          ) : state === 'error' ? (
            <button className="primary" disabled={busy} onClick={() => run(() => window.nexa.vpn.reconnect(id))}>
              Retry
            </button>
          ) : capability !== 'unavailable' && hasServers ? (
            <button className="primary" disabled={busy} onClick={() => run(() => window.nexa.vpn.connect(id))}>
              Connect
            </button>
          ) : (
            <button className="primary" onClick={goSettings}>
              Import configuration
            </button>
          )}
          <button className="ghost" onClick={goSettings}>
            Open VPN settings
          </button>
          {state === 'protected' && (
            <div className="row" style={{ gap: 12, fontSize: 11, color: 'var(--text-3)', justifyContent: 'center' }}>
              <span>Kill switch: {vpn?.killSwitch.enabled ? (vpn.killSwitch.enforced ? 'ON' : 'EXPERIMENTAL') : 'OFF'}</span>
              <span>DNS: {vpn?.dnsProtection.enabled ? (vpn.dnsProtection.verified ? 'VERIFIED' : 'UNVERIFIED') : 'OFF'}</span>
            </div>
          )}
          <div className="honest" style={{ textAlign: 'center' }}>
            SYSTEM WIREGUARD · TUNNEL REQUIRES PRIVILEGED HELPER
          </div>
        </div>
      </div>
    </>
  )
}

function Kv({ k, val }: { k: string; val: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
      <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={val}>
        {val}
      </div>
    </div>
  )
}

function ThemePicker() {
  const prefs = useNexa((s) => s.prefs)
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, zIndex: 47, background: 'rgba(8,10,14,.28)' }} onClick={() => useNexa.getState().setOverlay(null)} />
      <div className="popover" style={{ top: 150, left: '50%', transform: 'translateX(-50%)', width: 400 }}>
        <div className="row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', gap: 9 }}>
          <PaletteIcon size={17} color="var(--accent)" />
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Appearance</span>
          <button className="icon-btn" onClick={() => useNexa.getState().setOverlay(null)}>
            <X size={14} />
          </button>
        </div>
        <div style={{ padding: '14px 16px' }}>
          <Label>Mode</Label>
          <div className="row" style={{ gap: 8, marginBottom: 16 }}>
            {(['light', 'dark'] as const).map((m) => (
              <button
                key={m}
                onClick={() => useNexa.getState().setPref('theme', m)}
                style={{
                  flex: 1,
                  height: 34,
                  borderRadius: 9,
                  border: `1.5px solid ${prefs.theme === m ? 'var(--accent)' : 'var(--border)'}`,
                  background: prefs.theme === m ? 'var(--accent-weak)' : 'var(--surface)',
                  fontWeight: prefs.theme === m ? 600 : 400
                }}
              >
                {m === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
          <Label>Accent</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginBottom: 16 }}>
            {ACCENT_SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => useNexa.getState().setPref('accent', c)}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: c,
                  boxShadow: `0 0 0 2px var(--elevated), 0 0 0 ${prefs.accent === c ? '2px' : '0'} var(--accent)`
                }}
              />
            ))}
          </div>
          <button className="primary" style={{ width: '100%' }} onClick={() => useNexa.getState().setView('settings', 'appearance')}>
            Open Theme Builder
          </button>
        </div>
      </div>
    </>
  )
}

function Label({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>{children}</div>
}

function CustomizeDash() {
  const p = activeProfile()
  if (!p) return null
  const visible = normalizeDashboardLayout(p.dash.visible)
  const hidden = hiddenDashboardWidgets(visible)
  const st = useNexa.getState()
  return (
    <div className="overlay" onClick={() => useNexa.getState().setOverlay(null)}>
      <div className="modal" style={{ width: 560, maxHeight: 660, display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ padding: '15px 18px', borderBottom: '1px solid var(--border)', gap: 10 }}>
          <SquaresFour size={18} color="var(--accent)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Customize Dashboard</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{p.status} profile · changes save automatically</div>
          </div>
          <button className="icon-btn" onClick={() => useNexa.getState().setOverlay(null)}>
            <X size={15} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px' }}>
          <div className="row" style={{ padding: '11px 0 15px' }}>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Show greeting</span>
            <button className={`toggle ${p.dash.greeting ? 'on' : ''}`} onClick={() => useNexa.getState().setDashGreeting(!p.dash.greeting)}>
              <span />
            </button>
          </div>
          <Label>Visible widgets</Label>
          <div className="card" style={{ overflow: 'hidden' }}>
            {visible.map((id, i) => (
              <div key={id} className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', gap: 11 }}>
                <span style={{ fontSize: 13, flex: 1 }}>{DASHBOARD_WIDGETS[id]?.title || id}</span>
                <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => st.setDashLayout(moveWidget(visible, id, -1))}>
                  <CaretUp size={14} />
                </button>
                <button className="icon-btn" aria-label="Move down" disabled={i === visible.length - 1} onClick={() => st.setDashLayout(moveWidget(visible, id, 1))}>
                  <CaretDown size={14} />
                </button>
                <button className="icon-btn" aria-label="Hide widget" onClick={() => st.setDashLayout(hideWidget(visible, id))}>
                  <EyeSlash size={14} />
                </button>
              </div>
            ))}
          </div>
          {hidden.length > 0 && (
            <>
              <Label>Hidden widgets</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {hidden.map((id) => (
                  <button
                    key={id}
                    onClick={() => st.setDashLayout(showWidget(visible, id))}
                    style={{ height: 32, padding: '0 12px', borderRadius: 18, border: '1px dashed var(--border-2)', fontSize: 12, color: 'var(--text-2)' }}
                  >
                    {DASHBOARD_WIDGETS[id]?.title || id} +
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="row" style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <button onClick={() => useNexa.getState().resetDashLayout()} style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
            Reset Layout
          </button>
          <button className="primary" style={{ marginLeft: 'auto' }} onClick={() => useNexa.getState().setOverlay(null)}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function EditProfile() {
  const d = useNexa((s) => s.profileDraft)
  if (!d) return null
  return (
    <div className="overlay" onClick={() => useNexa.getState().setOverlay(null)}>
      <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
        <Header title="Edit profile" icon={<UserCircle size={18} color="var(--accent)" />} />
        <div style={{ padding: 18 }}>
          <div className="row" style={{ gap: 16, marginBottom: 18 }}>
            <Avatar size={64} src={d.avatar} name={d.name} accent={d.accent} />
            <label className="primary" style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
              Upload photo
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  if (f.size > 2_000_000) {
                    useNexa.getState().toastMsg('Image must be under 2 MB', 'warn')
                    return
                  }
                  const reader = new FileReader()
                  reader.onload = () => useNexa.setState({ profileDraft: { ...d, avatar: String(reader.result) } })
                  reader.readAsDataURL(f)
                }}
              />
            </label>
          </div>
          <Label>Name</Label>
          <input className="field" value={d.name} onChange={(e) => useNexa.setState({ profileDraft: { ...d, name: e.target.value } })} />
          <div style={{ height: 14 }} />
          <Label>Status</Label>
          <input className="field" value={d.status} onChange={(e) => useNexa.setState({ profileDraft: { ...d, status: e.target.value } })} />
          <div style={{ height: 14 }} />
          <Label>Accent</Label>
          <div className="row" style={{ gap: 10 }}>
            {ACCENT_SWATCHES.slice(0, 6).map((c) => (
              <button key={c} onClick={() => useNexa.setState({ profileDraft: { ...d, accent: c } })} style={{ width: 30, height: 30, borderRadius: '50%', background: c, boxShadow: d.accent === c ? '0 0 0 2px var(--elevated), 0 0 0 4px var(--accent)' : undefined }} />
            ))}
          </div>
        </div>
        <Footer onCancel={() => useNexa.getState().setOverlay(null)} onSave={() => useNexa.getState().saveProfileEdit()} save="Save profile" />
      </div>
    </div>
  )
}

function AddProfile() {
  const name = useNexa((s) => s.newProfileName)
  const preset = useNexa((s) => s.newProfilePreset)
  return (
    <div className="overlay" onClick={() => useNexa.getState().setOverlay(null)}>
      <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
        <Header title="Create profile" icon={<UserPlus size={18} color="var(--accent)" />} />
        <div style={{ padding: 18 }}>
          <Label>Profile name</Label>
          <input className="field" value={name} onChange={(e) => useNexa.setState({ newProfileName: e.target.value })} placeholder="e.g. Work" />
          <div style={{ height: 16 }} />
          <Label>Dashboard preset</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.keys(DASH_PRESETS).map((p) => (
              <button
                key={p}
                onClick={() => useNexa.setState({ newProfilePreset: p })}
                style={{
                  height: 32,
                  padding: '0 13px',
                  borderRadius: 18,
                  border: `1.5px solid ${preset === p ? 'var(--accent)' : 'var(--border)'}`,
                  background: preset === p ? 'var(--accent-weak)' : 'var(--surface)',
                  fontWeight: preset === p ? 600 : 400
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <Footer onCancel={() => useNexa.getState().setOverlay(null)} onSave={() => useNexa.getState().createProfile()} save="Create profile" />
      </div>
    </div>
  )
}

function AdPanel() {
  const tab = useNexa((s) => s.session.tabs.find((t) => t.id === s.session.activeTab))
  const isPrivate = !!tab?.private
  const snap = useNexa((s) => (isPrivate ? s.protectionPrivate : s.protection))
  const activeProfile = useNexa((s) => s.activeProfile)
  const globalOn = snap?.settings.enabled ?? true
  const state = snap?.state || 'not_configured'
  const isWeb = tab?.kind === 'web' && !!tab.url
  const host = isWeb ? hostnameOf(tab!.url) : ''
  const domain = host ? registrableDomain(host) : ''
  const [site, setSite] = useState<SiteState | null>(null)

  useEffect(() => {
    let alive = true
    if (isWeb && domain) {
      window.nexa.protection.getSiteState({ profileId: activeProfile, domain }).then((r) => {
        if (alive && r?.ok) setSite(r.data)
      })
    } else {
      setSite(null)
    }
    return () => {
      alive = false
    }
  }, [isWeb, domain, activeProfile, snap])

  const ds = domain && snap ? snap.perDomain[domain] : undefined
  const blocked = ds?.blocked || 0
  const cats = ds?.byCategory
  const stateLabel = state === 'error' ? 'ERROR' : !globalOn ? 'OFF' : state === 'not_configured' ? 'NOT CONFIGURED' : 'ACTIVE'
  const stateDot = state === 'error' ? 'var(--error)' : !globalOn ? 'var(--text-3)' : state === 'not_configured' ? 'var(--warning)' : 'var(--success)'

  async function toggleSite() {
    if (!domain) return
    const next = !(site?.enabled ?? true)
    const r = await window.nexa.protection.setSiteEnabled({ profileId: activeProfile, domain, enabled: next })
    if (r?.ok) {
      setSite(r.data)
      useNexa.getState().toastMsg(next ? `Protection on · ${domain}` : `Protection off · ${domain}`)
    }
  }

  return (
    <>
      <div style={{ position: 'absolute', inset: 0, zIndex: 44 }} onClick={() => useNexa.getState().setOverlay(null)} />
      <div className="popover" style={{ top: 130, right: 150, width: 316 }} role="dialog" aria-label="Site protection">
        <div className="row" style={{ padding: '15px 16px', borderBottom: '1px solid var(--border)', gap: 11 }}>
          <ShieldStar size={19} color={stateDot} weight={globalOn && state === 'active' ? 'fill' : 'regular'} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 7 }}>
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: stateDot }} />
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}>{stateLabel}</span>
              {isPrivate && <span className="pill">Private</span>}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isWeb ? domain : 'No site loaded'}
            </div>
          </div>
        </div>

        {isWeb && globalOn && state === 'active' ? (
          <>
            <div className="row" style={{ padding: '12px 16px', gap: 12 }}>
              <SiteStat label="Blocked" value={blocked} />
              <SiteStat label="Trackers" value={cats?.tracker || 0} />
              <SiteStat label="Ads" value={cats?.ad || 0} />
              <SiteStat label="Other" value={(cats?.annoyance || 0) + (cats?.['user-block'] || 0) + (cats?.other || 0)} />
            </div>
            <div className="row" style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', gap: 10 }}>
              <span style={{ flex: 1, fontSize: 13 }}>Protection on this site</span>
              <button
                className={`toggle ${site?.enabled ? 'on' : ''}`}
                aria-label="Toggle protection for this site"
                onClick={toggleSite}
              >
                <span />
              </button>
            </div>
          </>
        ) : (
          <div style={{ padding: 14, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
            {state === 'error'
              ? 'The protection engine could not initialize.'
              : !globalOn
                ? 'Content protection is turned off. Enable it to block trackers and ads.'
                : state === 'not_configured'
                  ? 'No filter rules are loaded.'
                  : 'Open a website to see per-site protection.'}
          </div>
        )}

        <div style={{ padding: 12, borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', gap: 8 }}>
          <button
            className={`toggle ${globalOn ? 'on' : ''}`}
            aria-label="Toggle content protection"
            style={{ flex: 'none' }}
            onClick={() => window.nexa.protection.setEnabled({ profileId: activeProfile, enabled: !globalOn })}
          >
            <span />
          </button>
          <button className="ghost" style={{ flex: 1 }} onClick={() => { useNexa.getState().setOverlay(null); useNexa.getState().openPrivacyCenter() }}>
            Privacy Center
          </button>
          <button className="ghost" style={{ flex: 1 }} onClick={() => useNexa.getState().setView('protection')}>
            Dashboard
          </button>
        </div>
      </div>
    </>
  )
}

function SiteStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{label}</div>
    </div>
  )
}

function CredentialModal() {
  const draft = useNexa((s) => s.draft)
  const gen = useNexa((s) => s.gen)
  const st = passwordStrength(draft.password)
  return (
    <div className="overlay" onClick={() => useNexa.getState().setOverlay(null)}>
      <div className="modal" style={{ width: 460, maxHeight: 660, overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <Header title={draft.id ? 'Edit credential' : 'Add password'} icon={<Key size={18} color="var(--accent)" />} />
        <div style={{ padding: 18 }}>
          <Label>Website</Label>
          <input className="field" value={draft.origin} onChange={(e) => useNexa.setState({ draft: { ...draft, origin: e.target.value } })} placeholder="https://example.com" />
          <div style={{ height: 12 }} />
          <Label>Username</Label>
          <input className="field" value={draft.username} onChange={(e) => useNexa.setState({ draft: { ...draft, username: e.target.value } })} />
          <div style={{ height: 12 }} />
          <Label>Password</Label>
          <input className="field mono" value={draft.password} onChange={(e) => useNexa.setState({ draft: { ...draft, password: e.target.value } })} />
          <div className="row" style={{ marginTop: 7, gap: 8 }}>
            <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${st.score}%`, background: st.color }} />
            </div>
            <span style={{ fontSize: 11, color: st.color, minWidth: 70, textAlign: 'right' }}>{st.label}</span>
          </div>
          <div className="card" style={{ padding: 13, marginTop: 14 }}>
            <div className="row" style={{ gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>Password generator</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                len {gen.length}
              </span>
            </div>
            <input type="range" min={8} max={40} value={gen.length} onChange={(e) => useNexa.setState({ gen: { ...gen, length: Number(e.target.value) } })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button className="ghost" onClick={async () => {
                const res = await window.nexa.passwordManager.generate(gen)
                if (res?.ok) useNexa.setState({ gen: { ...gen, value: res.data.value } })
              }}>Generate</button>
              <button className="primary" onClick={() => gen.value && useNexa.setState({ draft: { ...draft, password: gen.value } })}>Use</button>
            </div>
            {gen.value && <div className="mono" style={{ marginTop: 8, fontSize: 12, color: 'var(--accent-2)' }}>{gen.value}</div>}
          </div>
        </div>
        <Footer
          onCancel={() => useNexa.getState().setOverlay(null)}
          save="Save credential"
          onSave={async () => {
            const { activeProfile, draft } = useNexa.getState()
            const payload = { profileId: activeProfile, ...draft }
            const res = draft.id ? await window.nexa.passwordManager.updateCredential(payload) : await window.nexa.passwordManager.saveCredential(payload)
            if (!res?.ok) {
              useNexa.getState().toastMsg(res?.error?.message || 'Save failed', 'err')
              return
            }
            const list = await window.nexa.passwordManager.list(activeProfile)
            useNexa.setState({ overlay: null, vaultCreds: list?.ok ? (list.data as VaultMetaCredential[]) : useNexa.getState().vaultCreds })
            useNexa.getState().toastMsg('Credential saved · encrypted')
          }}
        />
      </div>
    </div>
  )
}

const AI_STATE_LABEL: Record<string, { text: string; tone: string }> = {
  idle: { text: 'Ready', tone: 'var(--success)' },
  checking: { text: 'Checking…', tone: 'var(--warning)' },
  generating: { text: 'Generating…', tone: 'var(--accent)' },
  complete: { text: 'Ready', tone: 'var(--success)' },
  cancelled: { text: 'Cancelled', tone: 'var(--text-3)' },
  error: { text: 'Error', tone: 'var(--error)' },
  ollama_offline: { text: 'Ollama offline', tone: 'var(--error)' },
  model_not_installed: { text: 'Model not installed', tone: 'var(--error)' }
}

/** Keep a scroll container pinned to the bottom unless the user scrolled up to read. */
function useStickToBottom<T extends HTMLElement>(deps: unknown[]) {
  const ref = useRef<T>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

/** Close a popover on Escape or a pointer press outside its container. */
function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

function AiPanel() {
  const status = useNexa((s) => s.aiStatus)
  const messages = useNexa((s) => s.aiMessages)
  const run = useNexa((s) => s.aiRun)
  const error = useNexa((s) => s.aiError)
  const lastPrompt = useNexa((s) => s.aiLastPrompt)
  const pageContext = useNexa((s) => s.aiPageContext)
  const mode = useNexa((s) => s.agentMode)
  const [input, setInput] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const modelRef = useDismiss<HTMLDivElement>(modelOpen, () => setModelOpen(false))
  const rewriteRef = useDismiss<HTMLDivElement>(rewriteOpen, () => setRewriteOpen(false))
  const lastMessage = messages[messages.length - 1]
  const listRef = useStickToBottom<HTMLDivElement>([messages.length, lastMessage?.content.length, run, error])

  // Poll status while the panel is open so Ollama offline/online is detected
  // without a restart.
  useEffect(() => {
    void useNexa.getState().loadAiStatus()
    const t = setInterval(() => {
      if (useNexa.getState().aiRun !== 'generating') void useNexa.getState().loadAiStatus()
    }, 5000)
    return () => clearInterval(t)
  }, [])

  const connected = status?.state === 'connected'
  const generating = run === 'generating' || run === 'checking'
  const chatModels = (status?.models || []).filter((m) => !m.embedding)
  const cloud = status?.processing === 'cloud'
  const providerName = cloud ? status?.providerName || 'NEXA AI' : 'Local AI'
  const modelName = (name: string) => status?.models.find((m) => m.name === name)?.displayName || (cloud ? name : prettyModelName(name))
  const activeModelLabel = status?.chatModel ? status.modelLabel || modelName(status.chatModel) : 'No model'

  const send = () => {
    const text = input.trim()
    if (!text || generating) return
    setInput('')
    useNexa.getState().aiSend(text)
  }

  return (
    <div className="side-panel" role="complementary" aria-label="AI panel">
      {/* Header */}
      <div className="row panel-head">
        <Sparkle size={16} color="var(--accent)" weight="fill" style={{ flex: 'none' }} />
        <div className="row" style={{ gap: 2, background: 'var(--surface-2)', borderRadius: 8, padding: 2 }}>
          <ModeTab label="Ask" active={mode === 'ask'} onClick={() => useNexa.getState().setAgentMode('ask')} />
          <ModeTab label="Assist" active={mode === 'assist'} onClick={() => useNexa.getState().setAgentMode('assist')} />
          <ModeTab label="Agent" active={mode === 'agent'} onClick={() => useNexa.getState().setAgentMode('agent')} />
        </div>
        <div style={{ flex: 1 }} />
        <div className="row" style={{ gap: 5 }} title={connected ? `${providerName} connected` : status?.note || `${providerName} offline`}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? 'var(--success)' : 'var(--text-3)' }} />
          <span className="panel-status-label" style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>{connected ? 'Connected' : 'Offline'}</span>
        </div>
        <button className="icon-btn" title="Clear conversation" aria-label="Clear conversation" onClick={() => useNexa.getState().aiClear()}>
          <Trash size={15} />
        </button>
        <button className="icon-btn" title="Close AI panel" aria-label="Close AI panel" onClick={() => useNexa.setState({ aiOpen: false })}>
          <X size={15} />
        </button>
      </div>

      {(mode === 'agent' || mode === 'assist') && <AgentPanelBody connected={connected} mode={mode} />}

      {mode === 'ask' && (
      <>
      {/* Model selector + quick actions */}
      <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div ref={modelRef} style={{ position: 'relative' }}>
          <button
            className="ghost"
            disabled={!connected || generating}
            aria-haspopup="listbox"
            aria-expanded={modelOpen}
            aria-label={`AI model: ${activeModelLabel}`}
            onClick={() => setModelOpen((v) => !v)}
            style={{ width: '100%', height: 30, justifyContent: 'space-between', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 12.5 }}
          >
            <span style={{ color: 'var(--text-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={activeModelLabel}>
              {activeModelLabel}
            </span>
            <CaretDown size={13} />
          </button>
          {modelOpen && connected && chatModels.length > 0 && (
            <div className="popover" style={{ position: 'absolute', top: 34, left: 0, right: 0, zIndex: 20, padding: 5, maxHeight: 280, overflowY: 'auto' }}>
              {chatModels.map((m) => (
                <button
                  key={m.name}
                  onClick={() => {
                    setModelOpen(false)
                    void useNexa.getState().aiSelectModel(m.name)
                  }}
                  style={{ width: '100%', textAlign: 'left', padding: '7px 9px', borderRadius: 7, fontSize: 12.5, display: 'flex', justifyContent: 'space-between', color: m.name === status?.chatModel ? 'var(--accent)' : 'var(--text-1)' }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{modelName(m.name)}</span>
                  {m.name === status?.chatModel && <Check size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <AiChip label="Ask about page" onClick={() => void aiAskAboutPage()} disabled={generating || !connected} />
          <AiChip label="Summarize page" onClick={() => void aiSummarizePage()} disabled={generating || !connected} />
          <AiChip label="Explain selection" onClick={() => void aiSelectionOp('explain')} disabled={generating || !connected} />
          <AiChip label="Translate" onClick={() => void aiSelectionOp('translate')} disabled={generating || !connected} />
          <div ref={rewriteRef} style={{ position: 'relative' }}>
            <AiChip label="Rewrite ▾" onClick={() => setRewriteOpen((v) => !v)} disabled={generating || !connected} />
            {rewriteOpen && (
              <div className="popover" style={{ position: 'absolute', top: 30, left: 0, zIndex: 20, padding: 5, minWidth: 130 }}>
                {(['professional', 'simple', 'shorter', 'clearer'] as RewriteMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setRewriteOpen(false)
                      void aiSelectionOp('rewrite', m)
                    }}
                    style={{ width: '100%', textAlign: 'left', padding: '6px 9px', borderRadius: 6, fontSize: 12, textTransform: 'capitalize', color: 'var(--text-1)' }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {pageContext && (
          <div className="row" style={{ gap: 7, padding: '7px 9px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <Sparkle size={13} color="var(--accent)" />
            <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Context: {pageContext.title || pageContext.url || 'Current page'}
            </span>
            <button className="icon-btn" title="Clear page context" onClick={() => useNexa.getState().setAiPageContext(null)}>
              <X size={13} />
            </button>
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={listRef} aria-live="polite" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.55, marginTop: 6 }}>
            {connected
              ? cloud
                ? `Ask anything, or use a quick action on the current page. Answers come from ${providerName} through the NEXA AI gateway. Private tabs stay on Local AI.`
                : 'Ask anything, or use a quick action on the current page. Everything runs locally through Ollama — no page data leaves your machine.'
              : status?.note || 'AI is unavailable. Start Ollama for Local AI, or check NEXA AI in Settings → AI.'}
          </div>
        )}
        {messages.map((m) => (
          <AiBubble key={m.id} role={m.role} content={m.content} meta={m.meta} streaming={generating && m === messages[messages.length - 1] && m.role === 'assistant'} />
        ))}
        {(run === 'error' || run === 'ollama_offline' || run === 'model_not_installed') && (
          <div style={{ fontSize: 12, color: 'var(--error)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span>{error || aiErrorMessage(run)}</span>
            {lastPrompt && (
              <button className="ghost" style={{ alignSelf: 'flex-start', height: 28 }} onClick={() => useNexa.getState().aiRetry()}>
                <ArrowClockwise size={13} /> Retry
              </button>
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={connected ? `Ask ${providerName}…` : 'AI unavailable'}
            rows={1}
            disabled={!connected && run !== 'generating'}
            style={{ flex: 1, resize: 'none', maxHeight: 120, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 11px', fontSize: 13, lineHeight: 1.4, color: 'var(--text-1)', fontFamily: 'inherit' }}
          />
          {generating ? (
            <button className="icon-btn" title="Stop generation" aria-label="Stop generation" onClick={() => useNexa.getState().aiCancel()} style={{ color: 'var(--error)' }}>
              <StopCircle size={22} weight="fill" />
            </button>
          ) : (
            <button className="icon-btn" title="Send" aria-label="Send message" disabled={!input.trim() || !connected} onClick={send} style={{ color: input.trim() && connected ? 'var(--accent)' : 'var(--text-3)' }}>
              <PaperPlaneRight size={20} weight="fill" />
            </button>
          )}
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="row" style={{ gap: 5, fontSize: 10.5, color: 'var(--text-3)' }}>
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: AI_STATE_LABEL[run]?.tone || 'var(--text-3)' }} />
            {AI_STATE_LABEL[run]?.text || 'Ready'}
          </span>
          <span style={{ fontSize: 10.5, color: 'var(--text-3)', letterSpacing: '0.04em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {cloud ? `${providerName.toUpperCase()} · VIA NEXA GATEWAY` : 'LOCAL · OLLAMA'}
          </span>
        </div>
      </div>
      </>
      )}
    </div>
  )
}

const WORKER_STATE_LABEL: Record<WorkerStateT, { text: string; tone: string }> = {
  idle: { text: 'Ready', tone: 'var(--text-3)' },
  scanning: { text: 'Scanning…', tone: 'var(--accent)' },
  scanned: { text: 'Page scanned', tone: 'var(--text-2)' },
  generating: { text: 'Generating…', tone: 'var(--accent)' },
  ready: { text: 'Suggestions ready', tone: 'var(--success)' },
  filling: { text: 'Filling…', tone: 'var(--accent)' },
  review: { text: 'Review required', tone: 'var(--warning)' },
  blocked: { text: 'Needs confirmation', tone: 'var(--warning)' },
  error: { text: 'Error', tone: 'var(--error)' }
}

function btnClassTone(c: WorkerButtonClass): string {
  if (c === 'submit' || c === 'send' || c === 'purchase' || c === 'delete') return 'var(--warning)'
  if (c === 'save' || c === 'continue') return 'var(--accent-2)'
  return 'var(--text-3)'
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    useNexa.getState().toastMsg('Copied')
  } catch {
    useNexa.getState().toastMsg('Copy failed', 'warn')
  }
}

function WorkerAnswerCard({ answer }: { answer: WorkerAnswer }) {
  const scan = useNexa((s) => s.workerScan)
  const approved = useNexa((s) => !!s.workerApproved[answer.questionId])
  const [editing, setEditing] = useState(false)
  const q = scan?.questions.find((x) => x.id === answer.questionId)
  if (!q) return null
  const fillable = !!q.fieldId
  return (
    <div style={{ padding: '9px 10px', borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600, lineHeight: 1.35 }}>{q.text}</div>
      {editing ? (
        <textarea
          value={answer.suggestedText}
          aria-label={`Edit answer for ${q.text}`}
          onChange={(e) => useNexa.getState().workerEditAnswer(answer.questionId, e.target.value)}
          rows={3}
          style={{ resize: 'vertical', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '7px 9px', fontSize: 12.5, lineHeight: 1.45, color: 'var(--text-1)', fontFamily: 'inherit' }}
        />
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{answer.suggestedText}</div>
      )}
      <div className="row" style={{ gap: 6, justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.04em' }}>{answer.source} · {answer.confidence}</span>
        <div className="row" style={{ gap: 5 }}>
          <button className="icon-btn" title={editing ? 'Done editing' : 'Edit'} aria-label="Edit answer" onClick={() => setEditing((v) => !v)}>
            {editing ? <Check size={14} /> : <PencilSimple size={14} />}
          </button>
          <button className="icon-btn" title="Copy answer" aria-label="Copy answer" onClick={() => void copyText(answer.suggestedText)}>
            <Copy size={14} />
          </button>
          <button
            className="ghost"
            title={fillable ? 'Approve this answer for filling' : 'No fillable field linked'}
            disabled={!fillable}
            onClick={() => (approved ? useNexa.getState().workerUnapproveAnswer(answer.questionId) : useNexa.getState().workerApproveAnswer(answer.questionId))}
            style={{ height: 26, padding: '0 9px', fontSize: 11.5, color: approved ? 'var(--success)' : 'var(--text-2)' }}
          >
            {approved ? <><Check size={13} /> Approved</> : 'Use Answer'}
          </button>
        </div>
      </div>
    </div>
  )
}

function WorkerHistoryList() {
  const history = useNexa((s) => s.workerHistory)
  const profile = useNexa((s) => s.activeProfile)
  const rows = history.filter((h) => h.profileId === profile)
  if (!rows.length) return null
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()
  const dayLabel = (ts: number) => {
    const d = new Date(ts).toDateString()
    return d === today ? 'Today' : d === yesterday ? 'Yesterday' : new Date(ts).toLocaleDateString()
  }
  let lastDay = ''
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map((h) => {
        const day = dayLabel(h.createdAt)
        const header = day !== lastDay ? ((lastDay = day), day) : null
        return (
          <div key={h.id}>
            {header && <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-3)', padding: '6px 2px 3px' }}>{header.toUpperCase()}</div>}
            <div className="row" style={{ gap: 8, padding: '5px 2px', fontSize: 11.5, color: 'var(--text-2)' }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.site || h.title || 'page'}</span>
              <span style={{ color: 'var(--text-3)' }}>{h.questionsAnswered}Q · {h.fieldsFilled} filled</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WorkerPanel() {
  const state = useNexa((s) => s.workerState)
  const scan = useNexa((s) => s.workerScan)
  const answers = useNexa((s) => s.workerAnswers)
  const approvedCount = useNexa((s) => Object.keys(s.workerApproved).length)
  const pending = useNexa((s) => s.workerPendingFill)
  const error = useNexa((s) => s.workerError)
  const mode = useNexa((s) => s.agentMode)
  const connected = useNexa((s) => s.aiStatus?.state === 'connected')
  const tab = useNexa((s) => s.session.tabs.find((t) => t.id === s.session.activeTab))
  const vaultExists = useNexa((s) => s.vaultExists)
  const onWebPage = tab?.kind === 'web' && !!tab.url
  const busy = state === 'scanning' || state === 'generating' || state === 'filling'
  // Worker may DETECT a login form (never the secret). Filling routes to the vault.
  const loginDetected = !!scan && scan.fields.some((f) => f.secret || f.type === 'password')

  useEffect(() => {
    void useNexa.getState().loadAiStatus()
  }, [])

  const stateLabel = WORKER_STATE_LABEL[state]

  return (
    <div className="side-panel" role="complementary" aria-label="Worker Assistant">
      {/* Header */}
      <div className="row panel-head">
        <Briefcase size={16} color="var(--accent)" weight="fill" style={{ flex: 'none' }} />
        <span className="panel-status-label" style={{ fontSize: 13, fontWeight: 600 }}>Worker</span>
        <div className="row" style={{ gap: 2, background: 'var(--surface-2)', borderRadius: 8, padding: 2, marginLeft: 4 }}>
          <ModeTab label="Ask" active={mode === 'ask'} onClick={() => useNexa.getState().setAgentMode('ask')} />
          <ModeTab label="Assist" active={mode === 'assist'} onClick={() => useNexa.getState().setAgentMode('assist')} />
          <ModeTab label="Agent" active={mode === 'agent'} onClick={() => useNexa.getState().setAgentMode('agent')} />
        </div>
        <div style={{ flex: 1 }} />
        <button className="icon-btn" title="Clear worker session" aria-label="Clear worker session" onClick={() => useNexa.getState().workerClearSession()}>
          <Trash size={15} />
        </button>
        <button className="icon-btn" aria-label="Close Worker Assistant" onClick={() => useNexa.getState().setWorkerOpen(false)}>
          <X size={15} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Scan control */}
        <div className="row" style={{ gap: 8 }}>
          <button
            className="primary"
            disabled={!onWebPage || busy}
            onClick={() => void useNexa.getState().workerScanPage()}
            style={{ flex: 1, height: 34, justifyContent: 'center' }}
          >
            <MagnifyingGlass size={15} /> {scan ? 'Re-scan Page' : 'Scan Page'}
          </button>
        </div>
        {!onWebPage && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>Open a website to scan its questions, forms and options.</div>
        )}

        {/* Live status (screen-reader announced) */}
        <div aria-live="polite" className="row" style={{ gap: 6, fontSize: 11.5 }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: stateLabel.tone }} />
          <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>{stateLabel.text}</span>
        </div>

        {/* Detected summary */}
        {scan && (
          <div style={{ padding: '9px 10px', borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="row" style={{ gap: 12, fontSize: 12, color: 'var(--text-2)' }}>
              <span><b style={{ color: 'var(--text-1)' }}>{scan.counts.questions}</b> questions</span>
              <span><b style={{ color: 'var(--text-1)' }}>{scan.counts.fields}</b> fields</span>
              <span><b style={{ color: 'var(--text-1)' }}>{scan.counts.options}</b> options</span>
            </div>
            {scan.buttons.length > 0 && (
              <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
                {scan.buttons.slice(0, 8).map((b) => (
                  <span key={b.id} title={b.highImpact ? 'High-impact — never auto-actioned' : b.classification} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: btnClassTone(b.classification), display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    {b.highImpact && <Warning size={10} />}{b.label.slice(0, 22)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Login form detected → route to the secure vault (worker never sees the secret) */}
        {loginDetected && vaultExists && (
          <div style={{ padding: '9px 10px', borderRadius: 9, background: 'color-mix(in srgb, var(--accent) 8%, var(--surface-2))', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row" style={{ gap: 6, fontSize: 12, color: 'var(--text-1)', fontWeight: 600 }}>
              <Key size={14} color="var(--accent)" weight="fill" /> Login form detected
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.45 }}>
              Use a saved credential from your vault. The password is handled securely and never shown here.
            </div>
            <button
              className="ghost"
              onClick={() => useNexa.getState().setVaultAutofillOpen(true)}
              style={{ height: 30, justifyContent: 'center' }}
            >
              <Key size={13} /> Open saved logins
            </button>
          </div>
        )}

        {/* Generate suggestions */}
        {scan && (state === 'scanned' || state === 'ready' || state === 'generating') && (
          <>
            <button className="ghost" disabled={busy || !connected || scan.questions.length === 0} onClick={() => void useNexa.getState().workerGenerate()} style={{ height: 32, justifyContent: 'center' }}>
              <Sparkle size={14} weight="fill" /> {state === 'generating' ? 'Generating…' : Object.keys(answers).length ? 'Regenerate Suggestions' : 'Generate Suggestions'}
            </button>
            {!connected && <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>AI suggestions unavailable right now. Scanning works offline.</div>}
            {scan.questions.length === 0 && connected && <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>No questions detected to answer on this page.</div>}
          </>
        )}

        {/* Answer cards */}
        {scan?.questions.map((q) => (answers[q.id] ? <WorkerAnswerCard key={q.id} answer={answers[q.id]} /> : null))}

        {/* Option groups (explicit, mode-gated set) */}
        {scan && scan.optionGroups.length > 0 && (state === 'scanned' || state === 'ready') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {scan.optionGroups.map((g) => (
              <div key={g.id} style={{ padding: '8px 10px', borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 5 }}>{g.label} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· {g.kind}</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {g.options.slice(0, 8).map((o, i) => (
                    <div key={`${g.id}_${i}`} className="row" style={{ gap: 8, fontSize: 12, color: 'var(--text-2)' }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.checked ? '☑ ' : '☐ '}{o.label || '(option)'}</span>
                      {g.kind !== 'select' && (
                        <button className="ghost" disabled={mode === 'ask'} title={mode === 'ask' ? 'Read-only in Ask mode' : 'Set on the page'} onClick={() => void useNexa.getState().workerSetOption(o.eid, !o.checked)} style={{ height: 22, padding: '0 8px', fontSize: 10.5 }}>Set</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Fill control */}
        {scan && (state === 'ready' || state === 'scanned') && approvedCount > 0 && (
          <button className="primary" disabled={busy} onClick={() => void useNexa.getState().workerFill()} style={{ height: 34, justifyContent: 'center' }}>
            <ClipboardText size={15} /> Fill Selected ({approvedCount})
          </button>
        )}

        {/* Confirmation gate */}
        {state === 'blocked' && pending.length > 0 && (
          <div style={{ padding: '10px 11px', borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--warning)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row" style={{ gap: 7, fontSize: 12.5, color: 'var(--text-1)', fontWeight: 600 }}>
              <ShieldStar size={15} color="var(--warning)" /> Confirm before filling
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.45 }}>
              {pending.length} field{pending.length > 1 ? 's' : ''} require your confirmation{pending.some((p) => p.secret) ? ' (includes a sensitive field)' : ''}. NEXA will not submit the form.
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="primary" onClick={() => void useNexa.getState().workerConfirmFill()} style={{ height: 30 }}>Confirm & Fill</button>
              <button className="ghost" onClick={() => useNexa.getState().workerCancelFill()} style={{ height: 30 }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Review */}
        {state === 'review' && (
          <div style={{ padding: '10px 11px', borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="row" style={{ gap: 7, fontSize: 12.5, color: 'var(--text-1)', fontWeight: 600 }}>
              <CheckCircle size={15} color="var(--success)" weight="fill" /> Fields filled — review required
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.45 }}>Review the page, then submit yourself. NEXA never submits, sends, or pays on your behalf.</div>
          </div>
        )}

        {/* Errors / blocked messages */}
        {error && state !== 'blocked' && <div style={{ fontSize: 12, color: state === 'error' ? 'var(--error)' : 'var(--text-2)', lineHeight: 1.5 }}>{error}</div>}
        {state === 'blocked' && pending.length === 0 && error && <div style={{ fontSize: 12, color: 'var(--warning)', lineHeight: 1.5 }}>{error}</div>}

        {/* Task history */}
        <WorkerHistoryList />
      </div>

      {/* Footer */}
      <div className="row" style={{ padding: '9px 12px', borderTop: '1px solid var(--border)', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>Never auto-submits · you stay in control</span>
        <span style={{ fontSize: 10.5, color: 'var(--text-3)', letterSpacing: '0.04em' }}>LOCAL · OLLAMA</span>
      </div>
    </div>
  )
}

function ModeTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ height: 24, padding: '0 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: active ? 'var(--surface)' : 'transparent', color: active ? 'var(--text-1)' : 'var(--text-3)', border: active ? '1px solid var(--border)' : '1px solid transparent' }}
    >
      {label}
    </button>
  )
}

const AGENT_STATE_LABEL: Record<string, { text: string; tone: string }> = {
  idle: { text: 'Idle', tone: 'var(--text-3)' },
  planning: { text: 'Planning…', tone: 'var(--accent)' },
  awaiting_permission: { text: 'Awaiting permission', tone: 'var(--warning)' },
  executing: { text: 'Executing…', tone: 'var(--accent)' },
  observing: { text: 'Observing…', tone: 'var(--accent)' },
  paused: { text: 'Paused', tone: 'var(--warning)' },
  completed: { text: 'Completed', tone: 'var(--success)' },
  cancelled: { text: 'Cancelled', tone: 'var(--text-3)' },
  failed: { text: 'Failed', tone: 'var(--error)' }
}

const STEP_ICON: Record<string, string> = { done: '✓', failed: '⚠', denied: '⛔', skipped: '↷', running: '→', awaiting_permission: '?', pending: '·' }

function AgentPanelBody({ connected, mode }: { connected: boolean; mode: 'assist' | 'agent' }) {
  const state = useNexa((s) => s.agentState)
  const steps = useNexa((s) => s.agentSteps)
  const logRef = useStickToBottom<HTMLDivElement>([steps.length])
  const result = useNexa((s) => s.agentResult)
  const error = useNexa((s) => s.agentError)
  const perm = useNexa((s) => s.agentPermission)
  const taskId = useNexa((s) => s.agentTaskId)
  const [instruction, setInstruction] = useState('')
  const vision = useNexa((s) => s.visionCapability)
  const running = ['planning', 'awaiting_permission', 'executing', 'observing', 'paused'].includes(state)
  const meta = AGENT_STATE_LABEL[state] || AGENT_STATE_LABEL.idle

  useEffect(() => {
    if (connected && vision === null) void useNexa.getState().loadVisionStatus()
  }, [connected, vision])

  const start = () => {
    const text = instruction.trim()
    if (!text || running || !connected) return
    setInstruction('')
    void useNexa.getState().agentStart(text)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Instruction composer */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.03em' }}>
            {mode === 'assist' ? 'ASSIST · Reads & navigates automatically; every page interaction asks first' : 'AGENT · Multi-step; sensitive actions still require your approval'}
          </div>
          {connected && vision && (
            <span
              title={vision === 'VISION_CAPABLE' ? 'A multimodal model is available for visual observation' : 'The current model is text-only — vision is not configured'}
              style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', padding: '2px 7px', borderRadius: 6, whiteSpace: 'nowrap', color: vision === 'VISION_CAPABLE' ? 'var(--accent)' : 'var(--text-3)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              {vision === 'VISION_CAPABLE' ? '● Vision available' : vision === 'UNAVAILABLE' ? '○ AI offline' : '○ Vision not configured'}
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                start()
              }
            }}
            placeholder={connected ? 'Describe a browser task…' : 'AI unavailable'}
            rows={2}
            disabled={!connected || running}
            style={{ flex: 1, resize: 'none', maxHeight: 120, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 11px', fontSize: 13, lineHeight: 1.4, color: 'var(--text-1)', fontFamily: 'inherit' }}
          />
          <button className="primary" style={{ height: 32 }} disabled={!instruction.trim() || !connected || running} onClick={start}>
            Run
          </button>
        </div>
      </div>

      {/* Activity log */}
      <div ref={logRef} style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
        {steps.length === 0 && !running && (
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.55 }}>
            {connected
              ? 'Try: “Open example.com, read the page and summarize it.” The agent takes one step at a time; you can Stop, Pause, or approve sensitive actions.'
              : 'AI is unavailable. Start Ollama for Local AI, or check NEXA AI in Settings → AI.'}
          </div>
        )}
        {steps.map((s) => (
          <div key={s.id} style={{ display: 'flex', gap: 8, fontSize: 12.5, alignItems: 'flex-start' }}>
            <span style={{ width: 14, textAlign: 'center', color: s.status === 'failed' || s.status === 'denied' ? 'var(--error)' : s.status === 'done' ? 'var(--success)' : 'var(--text-3)' }}>{STEP_ICON[s.status] || '·'}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{s.tool}</span>
              {s.observation && <span style={{ color: 'var(--text-3)', display: 'block', fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 66, overflow: 'hidden' }}>{s.observation.slice(0, 300)}</span>}
            </span>
          </div>
        ))}
        {result && (
          <div style={{ marginTop: 8, padding: '9px 11px', borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{result}</div>
        )}
        {error && state === 'failed' && <div style={{ fontSize: 12, color: 'var(--error)' }}>{agentErrorMsg(error)}</div>}
      </div>

      {/* Permission prompt */}
      {perm && (
        <div style={{ padding: '11px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.45 }}>{perm.summary}</div>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="ghost" style={{ height: 30 }} onClick={() => useNexa.getState().agentAnswerPermission('deny')}>Cancel</button>
            <button className="primary" style={{ height: 30 }} onClick={() => useNexa.getState().agentAnswerPermission('allow')}>Allow Once</button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="row" style={{ padding: 12, borderTop: '1px solid var(--border)', justifyContent: 'space-between' }}>
        <span className="row" style={{ gap: 5, fontSize: 10.5, color: 'var(--text-3)' }}>
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: meta.tone }} />
          {meta.text}
        </span>
        <div className="row" style={{ gap: 6 }}>
          {running && state !== 'paused' && (
            <button className="ghost" style={{ height: 28 }} onClick={() => useNexa.getState().agentPause()} disabled={!taskId}>Pause</button>
          )}
          {state === 'paused' && (
            <button className="ghost" style={{ height: 28 }} onClick={() => useNexa.getState().agentResume()} disabled={!taskId}>Resume</button>
          )}
          {running && (
            <button className="ghost" style={{ height: 28, color: 'var(--error)' }} onClick={() => useNexa.getState().agentCancel()} disabled={!taskId}>Stop</button>
          )}
        </div>
      </div>
    </div>
  )
}

function agentErrorMsg(code: string): string {
  return agentErrorMessage(code)
}

function AiChip({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ height: 26, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', opacity: disabled ? 0.5 : 1 }}
    >
      {label}
    </button>
  )
}

function AiBubble({ role, content, streaming, meta }: { role: 'user' | 'assistant'; content: string; streaming?: boolean; meta?: AiChatMessage['meta'] }) {
  const isUser = role === 'user'
  const [copied, setCopied] = useState(false)
  const copy = () => {
    if (!content) return
    void navigator.clipboard?.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 3 }}>
      <div
        style={{
          maxWidth: '86%',
          padding: '9px 12px',
          borderRadius: 12,
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: isUser ? 'var(--accent)' : 'var(--surface-2)',
          color: isUser ? 'var(--on-accent)' : 'var(--text)',
          border: isUser ? 'none' : '1px solid var(--border)'
        }}
      >
        {content}
        {streaming && <span style={{ opacity: 0.6 }}>▋</span>}
      </div>
      {!isUser && !streaming && content && (
        <div className="row" style={{ gap: 8, maxWidth: '86%', minWidth: 0 }}>
          <button onClick={copy} title="Copy" style={{ fontSize: 10.5, color: 'var(--text-3)', padding: '1px 4px', background: 'none', flex: 'none' }}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          {meta && (meta.model || meta.usage) && (
            <span
              className="truncate"
              style={{ fontSize: 10.5, color: 'var(--text-3)' }}
              title={[meta.model, meta.usage ? `${meta.usage.inputTokens} in · ${meta.usage.outputTokens} out tokens` : ''].filter(Boolean).join(' · ')}
            >
              {[meta.model, meta.usage ? `${meta.usage.inputTokens + meta.usage.outputTokens} tokens` : ''].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function Header({ title, icon }: { title: string; icon: ReactNode }) {
  return (
    <div className="row" style={{ padding: '15px 18px', borderBottom: '1px solid var(--border)', gap: 10 }}>
      {icon}
      <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{title}</span>
      <button className="icon-btn" onClick={() => useNexa.getState().setOverlay(null)}>
        <X size={15} />
      </button>
    </div>
  )
}

function Footer({ onCancel, onSave, save }: { onCancel: () => void; onSave: () => void; save: string }) {
  return (
    <div className="row" style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', justifyContent: 'flex-end', gap: 10 }}>
      <button className="ghost" onClick={onCancel}>
        Cancel
      </button>
      <button className="primary" onClick={onSave}>
        {save}
      </button>
    </div>
  )
}


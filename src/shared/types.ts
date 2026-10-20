import { DASHBOARD_LAYOUT_VERSION, defaultDashboardLayout } from './dashboard'

export const PROFILE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/

export type ThemeMode = 'light' | 'dark'
export type MotionMode = 'none' | 'minimal' | 'smooth' | 'expressive'
export type RadiusMode = 'sharp' | 'compact' | 'balanced' | 'rounded'
export type DensityMode = 'compact' | 'comfortable' | 'spacious'
export type AddrStyle = 'solid' | 'gradient' | 'glass'
export type ChromeView =
  | 'newtab'
  | 'downloads'
  | 'cloud'
  | 'settings'
  | 'about'
  | 'bookmarks'
  | 'history'
  | 'collections'
  | 'protection'
  | 'privacy'
  | 'drive'
  | 'web'

export type VpnStatus = 'not_configured' | 'off' | 'connecting' | 'protected' | 'error'

export interface DashboardPrefs {
  greeting: boolean
  layout: DensityMode
  /** Ordered list of enabled dashboard widget ids (see src/shared/dashboard.ts). */
  visible: string[]
  quick: string[]
  /** Dashboard layout schema version, for safe migration of persisted layouts. */
  v?: number
}

export interface Profile {
  id: string
  name: string
  status: string
  accent: string
  avatar: string | null
  dash: DashboardPrefs
}

export interface PrivacyPrefs {
  aiPageData: boolean
  telemetry: boolean
  crash: boolean
  secureDns: boolean
  dataSharing: boolean
}

/** STEP 9 — Turbo advanced sub-settings (master on/off is `toggles.turbo`). */
export interface TurboPrefs {
  /** Safe navigation prediction: warm DNS/TCP/TLS for a strongly-intended target. */
  predict: boolean
  /** Subtle navigation progress indicator in the shell. */
  progress: boolean
  /** Capture real, local-only navigation timing (Performance API). */
  metrics: boolean
}

/**
 * STEP 10 — Per-profile regional preferences. Legitimate regional customization
 * only (timezone/locale/language/formatting) — NOT fingerprint spoofing. Shape
 * mirrors `ProfileRegionalPreferences` in `shared/regional.ts` (the validator).
 */
export interface RegionalPrefs {
  timezone: string // IANA id or 'auto'
  locale: string // BCP-47 tag or 'auto'
  languages: string[] // ordered BCP-47 tags
  dateFormat: 'auto' | 'DMY' | 'MDY' | 'YMD'
  timeFormat: 'auto' | '12h' | '24h'
  weekStartsOn: 'auto' | 0 | 1
  measurementSystem: 'auto' | 'metric' | 'imperial'
}

export interface FeatureToggles {
  turbo: boolean
  localAI: boolean
  autoOrganize: boolean
  trackerBlock: boolean
  safeScan: boolean
  autoUpdate: boolean
}

export interface VpnToggles {
  killSwitch: boolean
  dns: boolean
  webrtc: boolean
  ipv6: boolean
  autoReconnect: boolean
  networkLock: boolean
  systemVpn: boolean
}

export interface AdCategories {
  ads: boolean
  trackers: boolean
  malware: boolean
  popups: boolean
  cookies: boolean
  social: boolean
  annoyances: boolean
}

export interface SettingsValues {
  startup: string
  search: string
  dlFolder: string
  maxConn: string
  concurrent: string
  provider: string
  updateChannel: string
}

export interface VpnLocation {
  country: string
  city: string
  code: string
  ms: number | null
  mode: 'Official' | 'Third-party' | 'Self-hosted'
}

export interface GlobalState {
  headerVisible: boolean
}

export interface ProfilePrefs {
  theme: ThemeMode
  accent: string
  themeName: string
  newtabBg: string
  addrStyle: AddrStyle
  motion: MotionMode
  radius: RadiusMode
  density: DensityMode
  glass: string
  toggles: FeatureToggles
  turbo: TurboPrefs
  regional: RegionalPrefs
  vpnToggles: VpnToggles
  adOn: boolean
  adMode: string
  adCats: AdCategories
  activeWorkspace: string
  sv: SettingsValues
  autoLockMins: number
  privacy: PrivacyPrefs
  /**
   * DOC-1 (retained): legacy per-profile extension enable/disable map from before
   * the P13 live extension runtime. No longer read by any code (extension state is
   * now owned by ExtensionService). Retained in the persisted schema to avoid a
   * profile-prefs migration; safe to remove in a future dedicated migration pass.
   */
  extState: Record<string, boolean>
  sidebarOpen: boolean
  bookmarkBar: boolean
  historyEnabled: boolean
  historyRetentionDays: number
  downloads: {
    askLocation: boolean
    duplicatePolicy: 'rename' | 'replace'
    maxConcurrent: number
    retryLimit: number
  }
}

export interface TabRecord {
  id: string
  title: string
  url: string
  kind: 'chrome' | 'web'
  view: ChromeView
  pinned?: boolean
  private?: boolean
}

export interface SessionState {
  tabs: TabRecord[]
  activeTab: string
  workspaces: { id: string; label: string; color: string }[]
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  channel: 'dev'
}

export interface VaultMetaCredential {
  id: string
  title: string
  origin: string
  username: string
  notes: string
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
}

export interface SafeError {
  code: string
  message: string
}

export const DASH_PRESETS: Record<string, string[]> = {
  Personal: ['bookmarks', 'recent', 'downloads', 'private-tab', 'google-drive'],
  Research: ['ask-ai', 'research', 'downloads', 'bookmarks', 'google-drive', 'collections'],
  Development: ['devtools', 'extensions', 'downloads', 'bookmarks', 'vpn'],
  Minimal: ['bookmarks', 'private-tab'],
  Downloads: ['download-manager', 'cloud-transfer', 'google-drive', 'downloads', 'vpn']
}

export const WIDGETS: Record<string, { title: string; icon: string; desc: string }> = {
  'download-manager': { title: 'Download Manager', icon: 'download-simple', desc: 'Queue, turbo & history' },
  downloads: { title: 'Downloads', icon: 'download-simple', desc: 'Active & recent files' },
  'ask-ai': { title: 'Ask AI', icon: 'sparkle', desc: 'Summarize, extract, automate' },
  'google-drive': { title: 'Google Drive', icon: 'google-drive-logo', desc: 'Cloud destination' },
  'private-tab': { title: 'New Private Tab', icon: 'detective', desc: 'No history · trackers blocked' },
  bookmarks: { title: 'Bookmarks', icon: 'bookmark-simple', desc: 'Saved pages' },
  recent: { title: 'Recent Sites', icon: 'clock-counter-clockwise', desc: 'Recently visited' },
  vpn: { title: 'VPN', icon: 'shield-check', desc: 'Secure network' },
  'cloud-transfer': { title: 'Cloud Transfer', icon: 'arrows-left-right', desc: 'Move between clouds' },
  research: { title: 'AI Research', icon: 'flask', desc: 'Research across tabs' },
  devtools: { title: 'Developer Tools', icon: 'terminal-window', desc: 'Inspect · console · network' },
  extensions: { title: 'Extensions', icon: 'puzzle-piece', desc: 'Installed add-ons' },
  collections: { title: 'Collections', icon: 'stack', desc: 'Saved research' },
  history: { title: 'History', icon: 'clock-counter-clockwise', desc: 'Browsing history' },
  notes: { title: 'Notes', icon: 'note', desc: 'Quick notes' },
  security: { title: 'Security Center', icon: 'shield-star', desc: 'Protection status' },
  passwords: { title: 'Password Manager', icon: 'key', desc: 'Encrypted local vault' }
}

export function defaultProfile(partial: Partial<Profile> & Pick<Profile, 'id' | 'name' | 'status' | 'accent'>): Profile {
  const preset = DASH_PRESETS[partial.status] ?? DASH_PRESETS.Personal
  return {
    avatar: null,
    dash: {
      greeting: true,
      layout: partial.status === 'Development' ? 'compact' : 'comfortable',
      // STEP 11 — validated control-center layout of real status widgets.
      visible: defaultDashboardLayout(),
      quick: preset.slice(0, 4),
      v: DASHBOARD_LAYOUT_VERSION
    },
    ...partial
  }
}

export function defaultProfiles(): Record<string, Profile> {
  return {
    personal: defaultProfile({ id: 'personal', name: 'Alex Rivera', status: 'Personal', accent: '#4b57e6' }),
    research: defaultProfile({ id: 'research', name: 'Alex Rivera', status: 'Research', accent: '#0f9d6b' }),
    development: defaultProfile({ id: 'development', name: 'Alex Rivera', status: 'Development', accent: '#e0851b' })
  }
}

export function defaultProfilePrefs(accent = '#4b57e6'): ProfilePrefs {
  return {
    theme: 'light',
    accent,
    themeName: 'Pure Light',
    newtabBg: 'default',
    addrStyle: 'solid',
    motion: 'smooth',
    radius: 'balanced',
    density: 'comfortable',
    glass: 'subtle',
    turbo: { predict: true, progress: true, metrics: true },
    // Regional: inherit system defaults (all 'auto'); languages seeded at load.
    regional: {
      timezone: 'auto',
      locale: 'auto',
      languages: [],
      dateFormat: 'auto',
      timeFormat: 'auto',
      weekStartsOn: 'auto',
      measurementSystem: 'auto'
    },
    toggles: {
      turbo: true,
      localAI: true,
      autoOrganize: true,
      trackerBlock: true,
      safeScan: true,
      autoUpdate: false
    },
    vpnToggles: {
      killSwitch: true,
      dns: true,
      webrtc: true,
      ipv6: true,
      autoReconnect: true,
      networkLock: false,
      systemVpn: false
    },
    adOn: true,
    adMode: 'balanced',
    adCats: { ads: true, trackers: true, malware: true, popups: true, cookies: true, social: false, annoyances: true },
    activeWorkspace: 'Research',
    sv: {
      startup: 'Open the New Tab page',
      search: 'DuckDuckGo',
      dlFolder: 'Downloads',
      maxConn: '12',
      concurrent: '4',
      provider: 'Local · Llama 3',
      updateChannel: 'Stable'
    },
    autoLockMins: 5,
    privacy: { aiPageData: false, telemetry: false, crash: false, secureDns: true, dataSharing: false },
    extState: { 'nexa-protection': true, 'dark-reader': false, 'json-viewer': false },
    sidebarOpen: true,
    bookmarkBar: true,
    historyEnabled: true,
    historyRetentionDays: 90,
    downloads: { askLocation: false, duplicatePolicy: 'rename', maxConcurrent: 4, retryLimit: 3 }
  }
}

export function defaultGlobal(): GlobalState {
  return { headerVisible: false }
}

export function defaultSession(): SessionState {
  return {
    tabs: [{ id: 't1', title: 'New Tab', url: '', kind: 'chrome', view: 'newtab' }],
    activeTab: 't1',
    workspaces: [
      { id: 'research', label: 'Research', color: 'var(--accent)' },
      { id: 'development', label: 'Development', color: '#e07b53' },
      { id: 'personal', label: 'Personal', color: '#3cbf84' }
    ]
  }
}

export function searchUrl(engine: string, q: string): string {
  const query = encodeURIComponent(q)
  switch (engine) {
    case 'Google':
      return `https://www.google.com/search?q=${query}`
    case 'Brave':
      return `https://search.brave.com/search?q=${query}`
    case 'Startpage':
      return `https://www.startpage.com/sp/search?query=${query}`
    default:
      return `https://duckduckgo.com/?q=${query}`
  }
}

export function looksLikeUrl(input: string): boolean {
  const t = input.trim()
  if (!t) return false
  if (/^https?:\/\//i.test(t)) return true
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(t)) return true
  return false
}

export function normalizeUrl(input: string): string {
  const t = input.trim()
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

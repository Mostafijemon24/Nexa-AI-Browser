import { create } from 'zustand'
import {
  defaultGlobal,
  defaultProfile,
  defaultProfilePrefs,
  defaultProfiles,
  defaultSession,
  looksLikeUrl,
  normalizeUrl,
  searchUrl,
  type AppInfo,
  type ChromeView,
  type GlobalState,
  type Profile,
  type ProfilePrefs,
  type SessionState,
  type TabRecord,
  type VaultMetaCredential
} from '@shared/types'
import { DASHBOARD_LAYOUT_VERSION, defaultDashboardLayout, migrateDashboardLayout, normalizeDashboardLayout } from '@shared/dashboard'
import type { AIProviderInfo, AIProviderId, ProfileAIConfig } from '@shared/ai-providers'
import type { GatewayInfo } from '@shared/ai-gateway'
import type { ExtensionInfo, SiteAccessMode } from '@shared/extensions'
import { validateBookmarkUrl, type BookmarkStore, type CollectionStore, type HistoryEntry } from '@shared/library'
import { summarize, type DownloadItem, type DownloadSettings, type DownloadSummary } from '@shared/downloads'
import type { ProtectionSnapshot, ProtectionRules, VpnStatus, VpnServer } from '../nexa'
import {
  buildActionMessages,
  pageContextSystemMessage,
  CHAT_TIMEOUT_MS,
  type AiStatus,
  type AiRunState,
  type AiMessage,
  type AiStreamEvent,
  type AiOp,
  type RewriteMode
} from '@shared/ai'

import type {
  AgentEvent,
  AgentTask,
  AgentStep,
  AgentState,
  AgentMode,
  RiskLevel,
  ToolObservation
} from '@shared/agent'

import {
  buildFillPlan,
  buildWorkerSuggestionMessages,
  sanitizeSuggestion,
  WORKER_MAX_QUESTIONS,
  type WorkerAnswer,
  type WorkerFillAction,
  type WorkerScan,
  type WorkerState,
  type WorkerUserContext
} from '@shared/worker'
import {
  displayOrigin,
  isEligibleOrigin,
  matchCredentials
} from '@shared/vault-autofill'
import { hostnameOf, registrableDomain } from '@shared/protection'
import type { DriveConnectionMeta, DriveFileMetadata } from '@shared/drive'
import {
  classifyNavigation,
  deriveTurboState,
  isDuplicateNavigation,
  preconnectTarget,
  type NavClass,
  type NavGuardEntry,
  type NavigationPerformance,
  type TurboState
} from '@shared/turbo'
import { describeRegional, validateRegional, type RegionalCapabilityReport } from '@shared/regional'
import type { RegionalPrefs } from '@shared/types'
import {
  aggregatePrivacy,
  buildFingerprint,
  classifyHttps,
  normalizeDns,
  normalizeWebrtc,
  summarizeInterfaces,
  type DiagStatus,
  type DnsResult,
  type FingerprintResult,
  type FingerprintSignalKey,
  type HttpsState,
  type InterfaceSummary,
  type PermissionStatus,
  type PrivacyAggregate,
  type RawIceCandidate,
  type WebrtcResult
} from '@shared/privacy'

export interface AiPageContext {
  title: string
  url: string
  text: string
  /** Captured from a private tab — requests carrying it stay local-only. */
  private?: boolean
}

/** Renderer browser-tool executor, registered by App.tsx (drives the webview). */
export type AgentExecutor = (tool: string, args: Record<string, unknown>) => Promise<ToolObservation>
let agentExecutor: AgentExecutor | null = null
export function setAgentExecutor(fn: AgentExecutor | null): void {
  agentExecutor = fn
}

/**
 * Worker Assistant live scanner, registered by App.tsx. Captures a bounded,
 * redacted observation from the active <webview> (reusing the existing P5.2
 * capture + buildObservation) and returns a deterministic WorkerScan plus the
 * bounded readable page text used ONLY for AI suggestions (never persisted).
 */
export interface WorkerScanResult {
  scan: WorkerScan
  contextText: string
}
export type WorkerScanner = () => Promise<WorkerScanResult | null>
let workerScanner: WorkerScanner | null = null
export function setWorkerScanner(fn: WorkerScanner | null): void {
  workerScanner = fn
}

/** Ephemeral, non-persisted page text for suggestions. Cleared with the session. */
let workerCtx: { text: string; url: string } | null = null

/**
 * STEP 9 — Turbo ephemeral guards (module-scoped, never persisted, reset on
 * profile switch). `lastNav` bounds duplicate navigation; `lastPreconnect`
 * dedupes connection warm-ups so we never hammer the same origin.
 */
let lastNav: NavGuardEntry | null = null
let lastPreconnect = ''

/**
 * Secure vault autofill runner, registered by App.tsx. It performs the
 * renderer-side steps ONLY (observe → classify → resolve target eids →
 * webContentsId) and calls the capability-specific IPC. The secret is decrypted
 * and injected in MAIN; this runner NEVER sees or returns it — only { filled }.
 */
export type VaultAutofillRunner = (req: {
  credentialId: string
  mode: 'ask' | 'assist' | 'agent'
}) => Promise<{ ok: boolean; filled?: boolean; error?: string }>
let vaultAutofillRunner: VaultAutofillRunner | null = null
export function setVaultAutofill(fn: VaultAutofillRunner | null): void {
  vaultAutofillRunner = fn
}

export type VaultAutofillState =
  | 'idle'
  | 'unavailable'
  | 'locked'
  | 'ineligible'
  | 'nomatch'
  | 'ready'
  | 'filling'
  | 'filled'
  | 'failed'

/**
 * Privacy Center browser-native probe, registered by App.tsx. Runs bounded,
 * on-demand WebRTC / fingerprint / permission checks in the renderer and returns
 * RAW signals for the pure `@shared/privacy` classifiers. NO AI, no persistence,
 * no external network calls. Returns the guest webContents id (if any) so main can
 * scope cookie-count to the authoritative live origin.
 */
export interface PrivacyFingerprintDetails {
  timezone?: string
  language?: string
  screen?: string
  devicePixelRatio?: number
  hardwareConcurrency?: number
  deviceMemory?: number
  gpu?: string
  colorDepth?: number
  touch?: boolean
  userAgentBrand?: string
}
export interface PrivacyProbeResult {
  webContentsId: number | null
  webrtcAvailable: boolean
  webrtcCandidates: RawIceCandidate[]
  fingerprint: Partial<Record<FingerprintSignalKey, boolean>>
  fingerprintDetails: PrivacyFingerprintDetails
  permissions: Record<string, PermissionStatus>
}
export type PrivacyProbe = () => Promise<PrivacyProbeResult>
let privacyProbe: PrivacyProbe | null = null
export function setPrivacyProbe(fn: PrivacyProbe | null): void {
  privacyProbe = fn
}

export type PrivacyRunState = 'idle' | 'checking' | 'done' | 'error'

export interface PrivacyReport {
  origin: string
  host: string
  isWeb: boolean
  private: boolean
  https: HttpsState
  protection: { status: DiagStatus; blocked: number; requests: number }
  vpn: { status: DiagStatus; handshake: 'VERIFIED' | 'NOT_VERIFIED' | 'UNKNOWN'; killSwitch: 'ON' | 'OFF' | 'NOT_CONFIGURED'; ipv6: string }
  ip: { publicIp: 'UNKNOWN' | 'NOT_CONFIGURED'; interfaces: InterfaceSummary | null; ipv6Available: boolean }
  dns: DnsResult
  webrtc: WebrtcResult
  fingerprint: FingerprintResult
  fingerprintDetails: PrivacyFingerprintDetails
  permissions: Record<string, PermissionStatus>
  cookieCount: number | null
  aggregate: PrivacyAggregate
  ranAt: number
}

/** Lightweight, in-memory, profile-scoped Worker task-history entry (no secrets). */
export interface WorkerHistoryEntry {
  id: string
  profileId: string
  createdAt: number
  site: string
  title: string
  questionsAnswered: number
  fieldsFilled: number
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/**
 * Execute Worker fill actions via the EXISTING agent browser executor (type /
 * select_option / set_checkbox). No new execution path; the executor already
 * blocks password inputs and resolves targets semantically by ephemeral eid.
 * Returns the number of fields successfully filled. Never submits.
 */
async function runWorkerActions(actions: WorkerFillAction[]): Promise<number> {
  if (!agentExecutor) return 0
  let filled = 0
  for (const a of actions) {
    if (a.decision === 'block') continue
    const args =
      a.tool === 'set_checkbox'
        ? { target: { eid: a.eid }, checked: a.type === 'radio' ? true : a.value === 'true' || a.value === 'on' || a.value === 'yes' }
        : a.tool === 'select_option'
          ? { target: { eid: a.eid }, value: a.value }
          : { target: { eid: a.eid }, text: a.value }
    try {
      const obs = await agentExecutor(a.tool, args)
      if (obs?.ok) filled++
    } catch {
      /* skip a single failed field; never throw the whole fill */
    }
  }
  return filled
}

/** Move to REVIEW and record a lightweight, non-secret task-history entry (skipped in private mode). */
function finalizeWorkerFill(url: string, title: string, questionsAnswered: number, fieldsFilled: number, isPrivate: boolean): void {
  const st = useNexa.getState()
  if (!isPrivate) {
    const entry: WorkerHistoryEntry = {
      id: newRequestId(),
      profileId: st.activeProfile,
      createdAt: Date.now(),
      site: hostOf(url),
      title: String(title).slice(0, 120),
      questionsAnswered,
      fieldsFilled
    }
    useNexa.setState({ workerHistory: [entry, ...st.workerHistory].slice(0, 50) })
  }
  useNexa.setState({ workerState: 'review' })
}

export interface AgentPermissionPrompt {
  stepId: string
  tool: string
  origin: string
  risk: RiskLevel
  summary: string
}

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  error?: boolean
  /** Sent from (or answered for) a private tab — never forwarded as cloud context. */
  private?: boolean
  /** Model that answered + token usage, when the provider reports them. */
  meta?: { model?: string; usage?: { inputTokens: number; outputTokens: number } }
}

function activeTabPrivate(st: { session: { tabs: TabRecord[]; activeTab: string | null } }): boolean {
  return !!st.session.tabs.find((t) => t.id === st.session.activeTab)?.private
}

function newRequestId(): string {
  const rnd = Math.random().toString(36).slice(2, 10)
  return `r${Date.now().toString(36)}${rnd}`
}

export type SessionStatus = 'none' | 'restoring' | 'restored' | 'recovered'

export type Overlay =
  | null
  | 'palette'
  | 'profile'
  | 'vpn'
  | 'vpnPicker'
  | 'theme'
  | 'customize'
  | 'editProfile'
  | 'addProfile'
  | 'ad'
  | 'credential'
  | 'turbo'

type Toast = { msg: string; tone?: 'ok' | 'warn' | 'err' } | null

interface Store {
  hydrated: boolean
  info: AppInfo | null
  global: GlobalState
  profiles: Record<string, Profile>
  activeProfile: string
  prefs: ProfilePrefs
  session: SessionState
  overlay: Overlay
  query: string
  ntSearch: string
  addr: string
  toast: Toast
  settingsSection: string
  aiOpen: boolean
  aiTab: string
  vaultExists: boolean
  vaultUnlocked: boolean
  vaultCreds: VaultMetaCredential[]
  masterInput: string
  unlockErr: string
  pmQuery: string
  revealId: string | null
  revealed: string | null
  draft: { id?: string; origin: string; username: string; password: string; title: string }
  gen: { length: number; upper: boolean; lower: boolean; num: boolean; sym: boolean; noAmbig: boolean; value: string }
  vpnLoc: { country: string; city: string; code: string }
  vpnQuery: string
  profileDraft: Profile | null
  newProfileName: string
  newProfilePreset: string
  downloadsDir: string
  bookmarks: BookmarkStore | null
  collections: CollectionStore | null
  historyRows: HistoryEntry[]
  historyLoading: boolean
  closedTabs: TabRecord[]
  sessionStatus: SessionStatus
  addToColUrl: { title: string; url: string } | null
  downloads: DownloadItem[]
  downloadSettings: DownloadSettings | null
  protection: ProtectionSnapshot | null
  protectionPrivate: ProtectionSnapshot | null
  protectionRules: ProtectionRules | null
  vpn: VpnStatus | null
  vpnServers: VpnServer[]
  aiStatus: AiStatus | null
  // STEP 12 — multi-provider metadata (never secrets) + profile AI config.
  aiProviders: AIProviderInfo[]
  aiConfig: ProfileAIConfig | null
  aiGateway: GatewayInfo | null
  // STEP 13 — installed browser extensions (per-profile, metadata only).
  extensions: ExtensionInfo[]
  aiMessages: AiChatMessage[]
  aiRun: AiRunState
  aiRequestId: string | null
  aiError: string | null
  aiLastPrompt: AiMessage[] | null
  /** Privacy of the last request, so Retry keeps the same routing constraint. */
  aiLastPrivate: boolean
  aiPageContext: AiPageContext | null
  agentMode: 'ask' | 'assist' | 'agent'
  agentTaskId: string | null
  agentTask: AgentTask | null
  agentSteps: AgentStep[]
  agentState: AgentState
  agentResult: string | null
  agentError: string | null
  agentPermission: AgentPermissionPrompt | null
  visionCapability: 'VISION_CAPABLE' | 'TEXT_ONLY' | 'UNAVAILABLE' | 'ERROR' | null
  workerOpen: boolean
  workerState: WorkerState
  workerScan: WorkerScan | null
  workerAnswers: Record<string, WorkerAnswer>
  workerApproved: Record<string, { fieldId: string; value: string }>
  workerPendingFill: WorkerFillAction[]
  workerError: string | null
  workerHistory: WorkerHistoryEntry[]
  workerUserContext: WorkerUserContext | null
  vaultAutofillOpen: boolean
  vaultAutofillState: VaultAutofillState
  vaultMatches: VaultMetaCredential[]
  vaultAutofillOrigin: string
  vaultSelectedId: string | null
  vaultAutofillError: string | null
  privacyState: PrivacyRunState
  privacyStep: string
  privacyReport: PrivacyReport | null
  privacyError: string | null
  driveMeta: DriveConnectionMeta | null
  driveBusy: '' | 'checking' | 'connecting' | 'listing' | 'searching' | 'downloading'
  driveFiles: DriveFileMetadata[]
  driveNextPageToken: string | null
  driveCategory: 'my-drive' | 'shared' | 'recent'
  driveQuery: string
  driveFolder: { id: string; name: string } | null
  driveError: string | null
  // Back/forward availability of the mounted web tab's history (in-memory only).
  webNav: { tabId: string; canBack: boolean; canForward: boolean } | null
  setWebNav: (nav: { tabId: string; canBack: boolean; canForward: boolean } | null) => void
  // STEP 9 — Turbo. `turboLastPerf` is in-memory only; never persisted (private-safe).
  navLoading: boolean
  turboLastPerf: NavigationPerformance | null
  turboLastClass: NavClass
  turboState: () => TurboState
  // STEP 10 — Regional. Honest capability report from main (Accept-Language etc.).
  regionalCaps: RegionalCapabilityReport | null
  setRegional: (patch: Partial<RegionalPrefs>) => void
  regionalApply: () => Promise<void>
  setTurboEnabled: (on: boolean) => void
  setTurboPref: (key: 'predict' | 'progress' | 'metrics', on: boolean) => void
  turboPreconnect: (url: string) => void
  recordNavStart: () => void
  recordNavPerf: (perf: NavigationPerformance | null) => void
  openTurbo: () => void
  hydrate: () => Promise<void>
  loadDownloads: () => Promise<void>
  initDownloadStream: () => void
  downloadSummary: () => DownloadSummary
  loadProtection: () => Promise<void>
  initProtectionStream: () => void
  activeProtection: () => ProtectionSnapshot | null
  loadVpn: () => Promise<void>
  initVpnStream: () => void
  loadAiStatus: () => Promise<void>
  loadAiProviders: (refresh?: boolean) => Promise<void>
  updateAiConfig: (patch: Partial<ProfileAIConfig>) => Promise<void>
  configureAiProvider: (providerId: AIProviderId, apiKey: string) => Promise<{ ok: boolean; note?: string }>
  removeAiProvider: (providerId: AIProviderId) => Promise<void>
  testAiProvider: (providerId: AIProviderId) => Promise<{ ok: boolean; state: string; note?: string }>
  loadAiGateway: () => Promise<void>
  connectPremiumAi: (apiKey: string) => Promise<{ ok: boolean; message?: string }>
  disconnectPremiumAi: () => Promise<void>
  /** Switch chat to NEXA AI in the given mode (server decides the model). */
  setNexaAiMode: (mode: 'free' | 'premium') => Promise<void>
  // STEP 13 — extensions
  loadExtensions: () => Promise<void>
  installExtension: () => Promise<void>
  setExtensionEnabled: (extensionId: string, enabled: boolean) => Promise<void>
  setExtensionPrivate: (extensionId: string, enabled: boolean) => Promise<void>
  setExtensionSiteAccess: (extensionId: string, mode: SiteAccessMode) => Promise<void>
  removeExtension: (extensionId: string) => Promise<void>
  initAiStream: () => void
  aiSend: (text: string) => void
  aiRunOp: (op: Exclude<AiOp, 'ask'>, input: { title?: string; content?: string; selection?: string; question?: string; targetLang?: string; mode?: RewriteMode }, label: string) => void
  aiStartStream: (messages: AiMessage[], opts?: { private?: boolean }) => void
  aiCancel: () => void
  aiClear: () => void
  aiRetry: () => void
  aiSelectModel: (chatModel: string) => Promise<void>
  setAiPageContext: (ctx: AiPageContext | null) => void
  setAgentMode: (m: 'ask' | 'assist' | 'agent') => void
  initAgentStream: () => void
  agentStart: (instruction: string) => Promise<void>
  agentCancel: () => void
  agentPause: () => void
  agentResume: () => void
  agentAnswerPermission: (decision: 'allow' | 'deny') => void
  aiComplete: (messages: AiMessage[], opts?: { private?: boolean }) => Promise<{ ok: boolean; text?: string; error?: string }>
  setWorkerOpen: (open: boolean) => void
  workerScanPage: () => Promise<void>
  workerGenerate: () => Promise<void>
  workerEditAnswer: (questionId: string, text: string) => void
  workerApproveAnswer: (questionId: string) => void
  workerUnapproveAnswer: (questionId: string) => void
  workerFill: () => Promise<void>
  workerConfirmFill: () => Promise<void>
  workerCancelFill: () => void
  workerSetOption: (eid: string, checked: boolean) => Promise<void>
  workerClearSession: () => void
  setWorkerUserContext: (ctx: WorkerUserContext | null) => void
  setVaultAutofillOpen: (open: boolean) => void
  vaultAutofillDetect: () => Promise<void>
  vaultAutofillFill: (credentialId: string) => Promise<void>
  vaultSelect: (credentialId: string) => void
  openPrivacyCenter: () => void
  runPrivacyCheck: () => Promise<void>
  openDrive: () => void
  driveRefreshStatus: () => Promise<void>
  driveConnect: () => Promise<void>
  driveDisconnect: () => Promise<void>
  driveList: (opts?: { category?: 'my-drive' | 'shared' | 'recent'; folder?: { id: string; name: string } | null }) => Promise<void>
  driveSearch: (query: string) => Promise<void>
  driveDownload: (file: DriveFileMetadata) => Promise<void>
  loadVisionStatus: () => Promise<void>
  loadLibrary: () => Promise<void>
  refreshHistory: (opts?: { search?: string; range?: string }) => Promise<void>
  bookmarkCurrent: () => Promise<void>
  isBookmarked: (url: string) => boolean
  openUrl: (url: string, opts?: { newTab?: boolean }) => void
  reopenClosedTab: () => void
  pinTab: (id: string) => void
  newPrivateTab: () => void
  recordNavTitle: (id: string, title: string) => void
  recordNavUrl: (id: string, url: string) => void
  persistPrefs: () => void
  persistGlobal: () => void
  persistSession: () => void
  persistIndex: () => Promise<void>
  /** STEP 11 — update the active profile's dashboard layout (validated + persisted). */
  setDashLayout: (visible: string[]) => void
  /** STEP 11 — reset the active profile's dashboard to the default layout. */
  resetDashLayout: () => void
  /** STEP 11 — toggle the greeting on the dashboard for the active profile. */
  setDashGreeting: (on: boolean) => void
  toastMsg: (msg: string, tone?: Toast extends infer T ? T extends { tone?: infer X } ? X : never : never) => void
  setOverlay: (o: Overlay) => void
  setView: (view: ChromeView, section?: string) => void
  newTab: (view?: ChromeView) => void
  closeTab: (id: string) => void
  activateTab: (id: string) => void
  navigate: (input: string) => void
  toggleTheme: () => void
  switchProfile: (id: string) => Promise<void>
  createProfile: () => Promise<void>
  saveProfileEdit: () => Promise<void>
  setPref: <K extends keyof ProfilePrefs>(key: K, value: ProfilePrefs[K]) => void
}

let downloadStreamBound = false
let protectionStreamBound = false
let vpnStreamBound = false
let aiStreamBound = false
let agentStreamBound = false
let persistTimer: ReturnType<typeof setTimeout> | null = null
function debounce(fn: () => void) {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(fn, 200)
}

function nextTabId(tabs: TabRecord[]) {
  const n = tabs.reduce((m, t) => Math.max(m, Number(t.id.replace(/\D/g, '')) || 0), 0)
  return 't' + (n + 1)
}

let overlayOpener: HTMLElement | null = null

export function restoreOverlayFocus(): void {
  const opener = overlayOpener
  overlayOpener = null
  const focusLost = !document.activeElement || document.activeElement === document.body
  if (focusLost && opener?.isConnected) opener.focus()
}

export const useNexa = create<Store>((set, get) => ({
  hydrated: false,
  info: null,
  global: defaultGlobal(),
  profiles: defaultProfiles(),
  activeProfile: 'research',
  prefs: defaultProfilePrefs('#0f9d6b'),
  session: defaultSession(),
  overlay: null,
  query: '',
  ntSearch: '',
  addr: '',
  toast: null,
  settingsSection: 'general',
  aiOpen: false,
  aiTab: 'ASK',
  vaultExists: false,
  vaultUnlocked: false,
  vaultCreds: [],
  masterInput: '',
  unlockErr: '',
  pmQuery: '',
  revealId: null,
  revealed: null,
  draft: { origin: '', username: '', password: '', title: '' },
  gen: { length: 20, upper: true, lower: true, num: true, sym: true, noAmbig: true, value: '' },
  vpnLoc: { country: 'United States', city: 'New York', code: 'US' },
  vpnQuery: '',
  profileDraft: null,
  newProfileName: '',
  newProfilePreset: 'Personal',
  downloadsDir: '',
  bookmarks: null,
  collections: null,
  historyRows: [],
  historyLoading: false,
  closedTabs: [],
  sessionStatus: 'none',
  addToColUrl: null,
  downloads: [],
  downloadSettings: null,
  protection: null,
  protectionPrivate: null,
  protectionRules: null,
  vpn: null,
  vpnServers: [],
  aiStatus: null,
  aiProviders: [],
  aiConfig: null,
  aiGateway: null,
  extensions: [],
  aiMessages: [],
  aiRun: 'idle',
  aiRequestId: null,
  aiError: null,
  aiLastPrompt: null,
  aiLastPrivate: false,
  aiPageContext: null,
  agentMode: 'ask',
  agentTaskId: null,
  agentTask: null,
  agentSteps: [],
  agentState: 'idle',
  agentResult: null,
  agentError: null,
  agentPermission: null,
  visionCapability: null,
  workerOpen: false,
  workerState: 'idle',
  workerScan: null,
  workerAnswers: {},
  workerApproved: {},
  workerPendingFill: [],
  workerError: null,
  workerHistory: [],
  workerUserContext: null,
  vaultAutofillOpen: false,
  vaultAutofillState: 'idle',
  vaultMatches: [],
  vaultAutofillOrigin: '',
  vaultSelectedId: null,
  vaultAutofillError: null,
  privacyState: 'idle',
  privacyStep: '',
  privacyReport: null,
  privacyError: null,
  driveMeta: null,
  driveBusy: '',
  driveFiles: [],
  driveNextPageToken: null,
  driveCategory: 'my-drive',
  driveQuery: '',
  driveFolder: null,
  driveError: null,
  webNav: null,
  navLoading: false,
  turboLastPerf: null,
  turboLastClass: 'Unavailable',
  regionalCaps: null,

  toastMsg: (msg, tone = 'ok') => {
    set({ toast: { msg, tone } })
    setTimeout(() => {
      if (get().toast?.msg === msg) set({ toast: null })
    }, 3200)
  },

  setOverlay: (overlay) => {
    const prev = get().overlay
    if (overlay && !prev) overlayOpener = document.activeElement as HTMLElement | null
    set({ overlay, query: overlay === 'palette' ? '' : get().query })
  },

  async hydrate() {
    if (!window.nexa) {
      set({ hydrated: true })
      return
    }
    try {
      const res = await window.nexa.settings.load()
      if (!res?.ok) {
        set({ hydrated: true })
        return
      }
      const d = res.data as {
        global: GlobalState
        index: { activeProfile: string; profiles: Record<string, Profile> }
        prefs: ProfilePrefs
        session: SessionState
        vault: { exists: boolean; unlocked: boolean }
        downloadsDir: string
      }
      const infoRes = await window.nexa.app.info()
      const restored = !!d.session?.tabs?.length
      // STEP 11 — validate/migrate each profile's persisted dashboard layout
      // (untrusted input). Unknown widgets dropped, new widgets appended once.
      const migratedProfiles: Record<string, Profile> = {}
      for (const [pid, prof] of Object.entries(d.index.profiles || {})) {
        migratedProfiles[pid] = {
          ...prof,
          dash: {
            ...prof.dash,
            visible: migrateDashboardLayout(prof.dash?.visible, prof.dash?.v),
            v: DASHBOARD_LAYOUT_VERSION
          }
        }
      }
      set({
        hydrated: true,
        global: d.global,
        profiles: migratedProfiles,
        activeProfile: d.index.activeProfile,
        prefs: d.prefs,
        session: restored ? d.session : defaultSession(),
        sessionStatus: restored && d.session.tabs.some((t) => t.kind === 'web') ? 'restored' : 'none',
        vaultExists: d.vault.exists,
        vaultUnlocked: d.vault.unlocked,
        downloadsDir: d.downloadsDir,
        info: infoRes?.ok ? (infoRes.data as unknown as AppInfo) : null,
        addr: (d.session?.tabs?.find((t: TabRecord) => t.id === d.session.activeTab) as TabRecord | undefined)?.url || ''
      })
      await get().loadLibrary()
      get().initDownloadStream()
      get().initProtectionStream()
      get().initVpnStream()
      get().initAiStream()
      get().initAgentStream()
      if (window.nexa?.extensions?.onEvent) {
        window.nexa.extensions.onEvent((event) => {
          if (event?.type === 'list' && event.profileId === get().activeProfile) set({ extensions: event.items })
        })
      }
      await get().loadDownloads()
      await get().loadProtection()
      await get().loadVpn()
      void get().loadAiStatus()
      void get().loadAiProviders()
      void get().loadExtensions()
      void get().regionalApply()
    } catch {
      set({ hydrated: true })
    }
  },

  async loadLibrary() {
    if (!window.nexa) return
    const id = get().activeProfile
    const [bm, col] = await Promise.all([window.nexa.bookmarks.load(id), window.nexa.collections.load(id)])
    set({
      bookmarks: bm?.ok ? bm.data : null,
      collections: col?.ok ? col.data : null
    })
  },

  async loadDownloads() {
    if (!window.nexa) return
    const id = get().activeProfile
    const [list, settings] = await Promise.all([window.nexa.downloads.list(id), window.nexa.downloads.getSettings(id)])
    set({
      downloads: list?.ok ? list.data : [],
      downloadSettings: settings?.ok ? settings.data : null
    })
  },

  initDownloadStream() {
    if (!window.nexa || downloadStreamBound) return
    downloadStreamBound = true
    window.nexa.downloads.onEvent((event) => {
      const st = get()
      if (!event || event.profileId !== st.activeProfile) return
      if (event.type === 'update' && event.item) {
        const idx = st.downloads.findIndex((d) => d.id === event.item!.id)
        const next = idx >= 0 ? st.downloads.slice() : [event.item, ...st.downloads]
        if (idx >= 0) next[idx] = event.item
        set({ downloads: next })
      } else if (event.type === 'removed' && event.id) {
        set({ downloads: st.downloads.filter((d) => d.id !== event.id) })
      } else if (event.type === 'list' && event.items) {
        set({ downloads: event.items })
      }
    })
  },

  downloadSummary() {
    return summarize(get().downloads)
  },

  async loadProtection() {
    if (!window.nexa) return
    const id = get().activeProfile
    const [state, rules] = await Promise.all([window.nexa.protection.getState(id), window.nexa.protection.getRules(id)])
    set({
      protection: state?.ok ? state.data : null,
      protectionRules: rules?.ok ? rules.data : null
    })
  },

  initProtectionStream() {
    if (!window.nexa || protectionStreamBound) return
    protectionStreamBound = true
    window.nexa.protection.onEvent((event) => {
      const st = get()
      if (!event || event.type !== 'snapshot') return
      const snap = event.snapshot
      if (snap.profileId !== st.activeProfile) return
      if (snap.private) set({ protectionPrivate: snap })
      else set({ protection: snap })
    })
  },

  activeProtection() {
    const st = get()
    const tab = st.session.tabs.find((t) => t.id === st.session.activeTab)
    return tab?.private ? st.protectionPrivate : st.protection
  },

  async loadVpn() {
    if (!window.nexa) return
    const id = get().activeProfile
    const [status, servers] = await Promise.all([window.nexa.vpn.getStatus(id), window.nexa.vpn.getServers(id)])
    set({
      vpn: status?.ok ? status.data : null,
      vpnServers: servers?.ok ? servers.data : []
    })
  },

  initVpnStream() {
    if (!window.nexa || vpnStreamBound) return
    vpnStreamBound = true
    window.nexa.vpn.onEvent((event) => {
      if (!event || event.type !== 'status') return
      if (event.status.profileId !== get().activeProfile) return
      set({ vpn: event.status })
    })
  },

  async loadAiStatus() {
    if (!window.nexa) return
    const res = await window.nexa.ai.status(get().activeProfile)
    set({ aiStatus: res?.ok ? res.data : null })
  },

  async loadAiProviders(refresh) {
    if (!window.nexa?.ai?.providers) return
    const id = get().activeProfile
    const [providers, config] = await Promise.all([
      window.nexa.ai.providers(id, refresh),
      window.nexa.ai.getConfig(id)
    ])
    set({
      aiProviders: providers?.ok ? providers.data : [],
      aiConfig: config?.ok ? config.data : null
    })
  },

  async updateAiConfig(patch) {
    if (!window.nexa?.ai?.updateConfig) return
    const res = await window.nexa.ai.updateConfig({ profileId: get().activeProfile, patch })
    if (res?.ok) set({ aiConfig: res.data })
    void get().loadAiProviders()
  },

  async configureAiProvider(providerId, apiKey) {
    if (!window.nexa?.ai?.configureProvider) return { ok: false }
    const res = await window.nexa.ai.configureProvider({ profileId: get().activeProfile, providerId, apiKey })
    await get().loadAiProviders(true)
    if (res?.ok) {
      const healthy = res.data.health === 'CONNECTED'
      get().toastMsg(healthy ? `${providerId} connected` : `${providerId} saved · ${res.data.health}`, healthy ? 'ok' : 'warn')
      return { ok: healthy, note: res.data.note }
    }
    get().toastMsg('Could not save provider key', 'err')
    return { ok: false }
  },

  async removeAiProvider(providerId) {
    if (!window.nexa?.ai?.removeProvider) return
    await window.nexa.ai.removeProvider({ profileId: get().activeProfile, providerId })
    await get().loadAiProviders(true)
    get().toastMsg(`${providerId} removed`)
  },

  async testAiProvider(providerId) {
    if (!window.nexa?.ai?.testProvider) return { ok: false, state: 'ERROR' }
    const res = await window.nexa.ai.testProvider({ profileId: get().activeProfile, providerId })
    await get().loadAiProviders()
    if (res?.ok) return { ok: res.data.health === 'CONNECTED', state: res.data.health, note: res.data.note }
    return { ok: false, state: 'ERROR' }
  },

  async loadAiGateway() {
    if (!window.nexa?.ai?.gatewayInfo) return
    const res = await window.nexa.ai.gatewayInfo(get().activeProfile)
    set({ aiGateway: res?.ok ? res.data : null })
  },

  async connectPremiumAi(apiKey) {
    if (!window.nexa?.ai?.connectPremium) return { ok: false }
    const res = await window.nexa.ai.connectPremium({ profileId: get().activeProfile, apiKey })
    await Promise.all([get().loadAiGateway(), get().loadAiProviders(true)])
    if (res?.ok && res.data.ok) {
      get().toastMsg('OpenRouter connected · Premium AI available', 'ok')
      return { ok: true }
    }
    const message = res?.ok ? (res.data.ok ? undefined : res.data.message) : res?.error?.message
    return { ok: false, message: message || 'Could not connect OpenRouter.' }
  },

  async disconnectPremiumAi() {
    if (!window.nexa?.ai?.disconnectPremium) return
    const res = await window.nexa.ai.disconnectPremium(get().activeProfile)
    await Promise.all([get().loadAiGateway(), get().loadAiProviders(true)])
    await get().loadAiStatus()
    if (res?.ok && res.data.ok) get().toastMsg('OpenRouter disconnected')
    else get().toastMsg((res?.ok && !res.data.ok && res.data.message) || 'Could not disconnect OpenRouter', 'err')
  },

  async setNexaAiMode(mode) {
    await get().updateAiConfig({ providerId: 'nexa', model: mode })
    await get().loadAiStatus()
  },

  /* --------------------------- STEP 13: extensions -------------------------- */
  async loadExtensions() {
    if (!window.nexa?.extensions?.list) return
    const res = await window.nexa.extensions.list(get().activeProfile)
    set({ extensions: res?.ok ? res.data : [] })
  },

  async installExtension() {
    if (!window.nexa?.extensions?.pickFolder) return
    const picked = await window.nexa.extensions.pickFolder(get().activeProfile)
    if (!picked?.ok || picked.data.cancelled || !picked.data.path) return
    if (picked.data.ok === false || !picked.data.preview) {
      get().toastMsg(`Extension rejected: ${picked.data.error || 'invalid manifest'}`, 'err')
      return
    }
    const p = picked.data.preview
    const risk = p.riskClass
    const perms = p.permissions.map((x) => x).join(', ') || 'none'
    const summary = `Install "${p.name}" v${p.version}?\n\nRisk: ${risk}\nPermissions: ${perms}\nHost access: ${p.hostPermissions.join(', ') || 'none'}${p.highRisk.length ? `\n\nElevated: ${p.highRisk.join(', ')}` : ''}`
    // Explicit user confirmation before any code is loaded.
    if (!window.confirm(summary)) return
    const res = await window.nexa.extensions.install({ profileId: get().activeProfile, path: picked.data.path })
    if (res?.ok && res.data.ok) get().toastMsg(`Installed ${res.data.info?.name}`, 'ok')
    else get().toastMsg(`Install failed: ${res?.ok ? res.data.error : 'error'}`, 'err')
    await get().loadExtensions()
  },

  async setExtensionEnabled(extensionId, enabled) {
    if (!window.nexa?.extensions?.setEnabled) return
    await window.nexa.extensions.setEnabled({ profileId: get().activeProfile, extensionId, enabled })
    await get().loadExtensions()
  },

  async setExtensionPrivate(extensionId, enabled) {
    if (!window.nexa?.extensions?.setPrivate) return
    await window.nexa.extensions.setPrivate({ profileId: get().activeProfile, extensionId, enabled })
    await get().loadExtensions()
  },

  async setExtensionSiteAccess(extensionId, mode) {
    if (!window.nexa?.extensions?.setSiteAccess) return
    await window.nexa.extensions.setSiteAccess({ profileId: get().activeProfile, extensionId, mode })
    await get().loadExtensions()
  },

  async removeExtension(extensionId) {
    if (!window.nexa?.extensions?.remove) return
    await window.nexa.extensions.remove({ profileId: get().activeProfile, extensionId })
    await get().loadExtensions()
  },

  initAiStream() {
    if (!window.nexa || aiStreamBound) return
    aiStreamBound = true
    window.nexa.ai.onEvent((event) => {
      const st = get()
      // Only accept events for the active profile + the in-flight request.
      if (!event || event.profileId !== st.activeProfile) return
      if (st.aiRequestId && event.requestId !== st.aiRequestId) return
      if (event.type === 'start') {
        set({ aiRun: 'generating', aiError: null })
      } else if (event.type === 'delta') {
        const msgs = st.aiMessages.slice()
        const last = msgs[msgs.length - 1]
        if (last && last.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, content: last.content + event.delta }
          set({ aiMessages: msgs })
        }
      } else if (event.type === 'done') {
        const msgs = st.aiMessages.slice()
        const last = msgs[msgs.length - 1]
        if (last && last.role === 'assistant') {
          const meta = event.model || event.usage ? { model: event.model, usage: event.usage } : undefined
          msgs[msgs.length - 1] = { ...last, content: event.content, ...(meta ? { meta } : {}) }
        }
        set({ aiMessages: msgs, aiRun: 'complete', aiRequestId: null })
      } else if (event.type === 'cancelled') {
        set({ aiRun: 'cancelled', aiRequestId: null })
      } else if (event.type === 'error') {
        const msgs = st.aiMessages.slice()
        const last = msgs[msgs.length - 1]
        // Remove an empty placeholder assistant bubble on error.
        if (last && last.role === 'assistant' && !last.content) msgs.pop()
        const runState: AiRunState =
          event.code === 'ollama_offline'
            ? 'ollama_offline'
            : event.code === 'model_not_installed'
              ? 'model_not_installed'
              : 'error'
        set({ aiMessages: msgs, aiRun: runState, aiError: event.message, aiRequestId: null })
      }
    })
  },

  aiStartStream(messages, opts = {}) {
    if (!window.nexa) return
    const st = get()
    if (st.aiRun === 'generating' || st.aiRun === 'checking') return // guard duplicate
    const requestId = newRequestId()
    // Private if the active tab is private OR the caller carries private-origin content.
    const isPrivate = !!opts.private || activeTabPrivate(st)
    const model = st.aiStatus?.chatModel
    // Add an empty assistant bubble that streaming deltas will fill.
    set({
      aiMessages: [...st.aiMessages, { id: requestId, role: 'assistant', content: '', ...(isPrivate ? { private: true } : {}) }],
      aiRun: 'checking',
      aiRequestId: requestId,
      aiError: null,
      aiLastPrompt: messages,
      aiLastPrivate: isPrivate
    })
    window.nexa.ai
      .chat({ profileId: st.activeProfile, requestId, model, messages, private: isPrivate })
      .then((r) => {
        if (!r?.ok) set({ aiRun: 'error', aiError: r?.error?.message || 'AI request failed.', aiRequestId: null })
      })
  },

  aiSend(text) {
    const body = text.trim()
    if (!body) return
    const st = get()
    const tabPrivate = activeTabPrivate(st)
    const userMsg: AiChatMessage = { id: newRequestId(), role: 'user', content: body, ...(tabPrivate ? { private: true } : {}) }
    // Build conversation history (user/assistant turns) for context. Turns from
    // a private tab are never forwarded from a normal tab.
    const turns: AiMessage[] = [...st.aiMessages, userMsg]
      .filter((m) => m.content && !m.error && (tabPrivate || !m.private))
      .map((m) => ({ role: m.role, content: m.content }))
    // Page Q&A: prepend the untrusted, fenced page context as a system message
    // so the whole conversation stays grounded in the current page.
    const messages: AiMessage[] = st.aiPageContext
      ? [pageContextSystemMessage(st.aiPageContext), ...turns]
      : turns
    set({ aiMessages: [...st.aiMessages, userMsg] })
    get().aiStartStream(messages, { private: tabPrivate || !!st.aiPageContext?.private })
  },

  aiRunOp(op, input, label) {
    const st = get()
    const messages = buildActionMessages(op, input)
    const userMsg: AiChatMessage = { id: newRequestId(), role: 'user', content: label, ...(activeTabPrivate(st) ? { private: true } : {}) }
    set({ aiMessages: [...st.aiMessages, userMsg], aiOpen: true })
    get().aiStartStream(messages)
  },

  setAiPageContext(ctx) {
    set({ aiPageContext: ctx ? { ...ctx, private: activeTabPrivate(get()) } : null })
  },

  setAgentMode(m) {
    set({ agentMode: m })
  },

  initAgentStream() {
    if (agentStreamBound || !window.nexa) return
    agentStreamBound = true
    window.nexa.agent.onEvent((event: AgentEvent) => {
      const st = get()
      // Ignore events for other profiles (isolation).
      if ('profileId' in event && event.profileId !== st.activeProfile) return
      switch (event.type) {
        case 'task-created':
          set({ agentTask: event.task, agentTaskId: event.task.id, agentSteps: [], agentState: event.task.status, agentResult: null, agentError: null, agentPermission: null })
          break
        case 'state':
          set({ agentState: event.state })
          break
        case 'step': {
          const steps = get().agentSteps.slice()
          const idx = steps.findIndex((s) => s.id === event.step.id)
          if (idx >= 0) steps[idx] = event.step
          else steps.push(event.step)
          set({ agentSteps: steps })
          break
        }
        case 'permission-request':
          set({ agentPermission: { stepId: event.stepId, tool: event.tool, origin: event.origin, risk: event.risk, summary: event.summary } })
          break
        case 'tool-request': {
          const reply = (obs: ToolObservation) =>
            window.nexa?.agent.toolResult({ profileId: event.profileId, taskId: event.taskId, stepId: event.stepId, ok: obs.ok, observation: obs.observation, page: obs.page, error: obs.error })
          const exec = agentExecutor
          if (!exec) {
            void reply({ ok: false, observation: '', error: 'no_executor' })
            break
          }
          exec(event.tool, event.arguments).then(reply, (err: unknown) =>
            reply({ ok: false, observation: '', error: String((err as Error)?.message || 'exec_failed').slice(0, 200) })
          )
          break
        }
        case 'done':
          set({ agentState: event.status, agentResult: event.result ?? null, agentError: event.error ?? null, agentPermission: null })
          if (event.status === 'failed' && event.error) get().toastMsg(`Agent: ${event.error}`, 'warn')
          break
        default:
          break
      }
    })
  },

  async agentStart(instruction) {
    const body = instruction.trim()
    if (!body || !window.nexa) return
    const st = get()
    if (st.aiStatus?.state !== 'connected') {
      get().toastMsg(st.aiStatus?.note || 'AI unavailable — start Ollama or check NEXA AI', 'warn')
      return
    }
    // Terminate any running task before starting a new one.
    if (st.agentTaskId && !['completed', 'cancelled', 'failed', 'idle'].includes(st.agentState)) {
      window.nexa.agent.cancel({ profileId: st.activeProfile, taskId: st.agentTaskId })
    }
    const taskId = newRequestId()
    const tab = st.session.tabs.find((t) => t.id === st.session.activeTab)
    const page = tab && tab.kind === 'web' && tab.url ? { url: tab.url, title: tab.title } : undefined
    // Ask mode is chat-only; agent tasks run as assist or agent.
    const mode: 'assist' | 'agent' = st.agentMode === 'assist' ? 'assist' : 'agent'
    set({ agentMode: mode, aiOpen: true, agentTaskId: taskId, agentSteps: [], agentResult: null, agentError: null, agentPermission: null, agentState: 'planning' })
    const res = await window.nexa.agent.start({ profileId: st.activeProfile, taskId, instruction: body, mode, privateMode: !!tab?.private, page })
    if (!res?.ok) set({ agentState: 'failed', agentError: res?.error?.message || 'Agent could not start.' })
  },

  agentCancel() {
    const st = get()
    if (!window.nexa || !st.agentTaskId) return
    window.nexa.agent.cancel({ profileId: st.activeProfile, taskId: st.agentTaskId })
  },

  agentPause() {
    const st = get()
    if (!window.nexa || !st.agentTaskId) return
    window.nexa.agent.pause({ profileId: st.activeProfile, taskId: st.agentTaskId })
  },

  agentResume() {
    const st = get()
    if (!window.nexa || !st.agentTaskId) return
    window.nexa.agent.resume({ profileId: st.activeProfile, taskId: st.agentTaskId })
  },

  agentAnswerPermission(decision) {
    const st = get()
    if (!window.nexa || !st.agentTaskId || !st.agentPermission) return
    window.nexa.agent.permission({ profileId: st.activeProfile, taskId: st.agentTaskId, stepId: st.agentPermission.stepId, decision })
    set({ agentPermission: null })
  },

  /* ------------------------- Worker Assistant (STEP 5) ------------------------- */

  /**
   * One-shot local AI completion, scoped to its own requestId + listener. Does
   * NOT touch the chat panel state (aiMessages/aiRequestId). Used by the Worker
   * to generate answer suggestions. Respects private mode via the chat IPC flag.
   */
  aiComplete(messages, opts = {}) {
    if (!window.nexa) return Promise.resolve({ ok: false, error: 'unavailable' })
    const st = get()
    if (st.aiStatus?.state !== 'connected') return Promise.resolve({ ok: false, error: 'ollama_offline' })
    const requestId = newRequestId()
    const model = st.aiStatus?.chatModel
    const profileId = st.activeProfile
    return new Promise<{ ok: boolean; text?: string; error?: string }>((resolve) => {
      let acc = ''
      let settled = false
      let off: (() => void) | null = null
      let timer: ReturnType<typeof setTimeout> | null = null
      function finish(r: { ok: boolean; text?: string; error?: string }) {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (off) off()
        resolve(r)
      }
      off = window.nexa!.ai.onEvent((event: AiStreamEvent) => {
        if (!event || event.profileId !== profileId || event.requestId !== requestId) return
        if (event.type === 'delta') acc += event.delta
        else if (event.type === 'done') finish({ ok: true, text: event.content || acc })
        else if (event.type === 'cancelled') finish({ ok: false, error: 'cancelled' })
        else if (event.type === 'error') finish({ ok: false, error: event.code || 'error' })
      })
      timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), CHAT_TIMEOUT_MS + 5000)
      window.nexa!.ai.chat({ profileId, requestId, model, messages, private: !!opts.private }).then((res) => {
        if (!res?.ok) finish({ ok: false, error: res?.error?.code || 'error' })
      })
    })
  },

  setWorkerOpen(open) {
    set({ workerOpen: open })
  },

  async workerScanPage() {
    set({ workerOpen: true, workerState: 'scanning', workerError: null })
    const scanner = workerScanner
    if (!scanner) {
      set({ workerState: 'error', workerError: 'Worker scanner is unavailable.' })
      return
    }
    try {
      const res = await scanner()
      if (!res || !res.scan) {
        set({ workerState: 'error', workerError: 'Couldn’t scan this page. Open a website first.' })
        return
      }
      workerCtx = { text: res.contextText || '', url: res.scan.url }
      set({ workerScan: res.scan, workerAnswers: {}, workerApproved: {}, workerPendingFill: [], workerState: 'scanned', workerError: null })
    } catch {
      set({ workerState: 'error', workerError: 'Worker couldn’t safely scan this page.' })
    }
  },

  async workerGenerate() {
    const st = get()
    const scan = st.workerScan
    if (!scan) return
    if (st.aiStatus?.state !== 'connected') {
      set({ workerError: 'AI suggestions unavailable right now. Scanning still works without AI.' })
      get().toastMsg('AI suggestions unavailable', 'warn')
      return
    }
    const tab = st.session.tabs.find((t) => t.id === st.session.activeTab)
    const isPrivate = !!tab?.private
    set({ workerState: 'generating', workerError: null })
    const answers: Record<string, WorkerAnswer> = { ...st.workerAnswers }
    for (const q of scan.questions.slice(0, WORKER_MAX_QUESTIONS)) {
      // Bail cleanly if the session was cleared / a new scan started.
      if (get().workerScan !== scan) return
      const field = q.fieldId ? scan.fields.find((f) => f.id === q.fieldId) : undefined
      if (field?.secret) continue // never generate suggestions for secret fields
      // STEP 10 — attach a short, honest regional descriptor so the assistant can
      // interpret ambiguous dates/numbers. Never triggers auto-submit (confirm-gated).
      const regionalDesc = describeRegional(st.prefs.regional)
      const userContext =
        st.workerUserContext || regionalDesc ? { ...(st.workerUserContext || {}), regional: regionalDesc || undefined } : undefined
      const messages = buildWorkerSuggestionMessages({
        question: q.text,
        fieldType: field?.type,
        pageTitle: scan.title,
        pageContext: workerCtx?.text,
        userContext
      })
      const r = await get().aiComplete(messages, { private: isPrivate })
      if (get().workerScan !== scan) return
      if (r.ok && r.text) {
        const text = sanitizeSuggestion(r.text)
        if (text) {
          answers[q.id] = {
            id: newRequestId(),
            questionId: q.id,
            suggestedText: text,
            confidence: 'medium',
            source: st.workerUserContext ? 'COMBINED' : 'LOCAL_AI',
            editable: true
          }
          set({ workerAnswers: { ...answers } })
        }
      }
    }
    const any = Object.keys(get().workerAnswers).length > 0
    set({ workerState: any ? 'ready' : 'scanned', workerError: any ? null : 'No suggestions could be generated for this page.' })
  },

  workerEditAnswer(questionId, text) {
    const st = get()
    const ans = st.workerAnswers[questionId]
    if (!ans) return
    const suggestedText = String(text).slice(0, 4000)
    const answers = { ...st.workerAnswers, [questionId]: { ...ans, suggestedText, source: 'COMBINED' as const } }
    // Keep an already-approved value in sync with the edit.
    const approved = st.workerApproved[questionId] ? { ...st.workerApproved, [questionId]: { ...st.workerApproved[questionId], value: suggestedText } } : st.workerApproved
    set({ workerAnswers: answers, workerApproved: approved })
  },

  workerApproveAnswer(questionId) {
    const st = get()
    const scan = st.workerScan
    const ans = st.workerAnswers[questionId]
    if (!scan || !ans) return
    const q = scan.questions.find((x) => x.id === questionId)
    if (!q?.fieldId) {
      get().toastMsg('No fillable field is linked to this answer', 'warn')
      return
    }
    set({ workerApproved: { ...st.workerApproved, [questionId]: { fieldId: q.fieldId, value: ans.suggestedText } } })
  },

  workerUnapproveAnswer(questionId) {
    const st = get()
    if (!st.workerApproved[questionId]) return
    const approved = { ...st.workerApproved }
    delete approved[questionId]
    set({ workerApproved: approved })
  },

  async workerFill() {
    const st = get()
    const scan = st.workerScan
    if (!scan) return
    const mode = st.agentMode as AgentMode
    const approved = Object.entries(st.workerApproved).map(([questionId, v]) => ({ questionId, fieldId: v.fieldId, value: v.value }))
    if (!approved.length) {
      get().toastMsg('Approve at least one answer first', 'warn')
      return
    }
    const plan = buildFillPlan(mode, scan.fields, approved)
    const autos = plan.filter((p) => p.decision === 'auto')
    const confirms = plan.filter((p) => p.decision === 'confirm')
    if (!autos.length && !confirms.length) {
      set({ workerState: 'blocked', workerError: mode === 'ask' ? 'Filling is read-only in Ask mode. Switch to Assist or Agent to fill fields.' : 'These fields require your confirmation.' })
      return
    }
    set({ workerState: 'filling', workerError: null })
    const filled = await runWorkerActions(autos)
    if (get().workerScan !== scan) return
    if (confirms.length) {
      set({ workerPendingFill: confirms, workerState: 'blocked' })
      return
    }
    finalizeWorkerFill(scan.url, scan.title, Object.keys(st.workerApproved).length, filled, !!st.session.tabs.find((t) => t.id === st.session.activeTab)?.private)
  },

  async workerConfirmFill() {
    const st = get()
    const scan = st.workerScan
    const pending = st.workerPendingFill
    if (!scan || !pending.length) return
    set({ workerState: 'filling', workerError: null })
    const filled = await runWorkerActions(pending)
    if (get().workerScan !== scan) return
    set({ workerPendingFill: [] })
    finalizeWorkerFill(scan.url, scan.title, Object.keys(st.workerApproved).length, filled, !!st.session.tabs.find((t) => t.id === st.session.activeTab)?.private)
  },

  workerCancelFill() {
    set({ workerPendingFill: [], workerState: get().workerScan ? 'ready' : 'idle', workerError: null })
  },

  async workerSetOption(eid, checked) {
    const st = get()
    if (st.agentMode === 'ask') {
      get().toastMsg('Read-only in Ask mode — switch to Assist or Agent to change options', 'warn')
      return
    }
    const filled = await runWorkerActions([{ questionId: '', fieldId: '', eid, type: 'checkbox', value: checked ? 'true' : 'false', tool: 'set_checkbox', decision: 'auto', secret: false }])
    get().toastMsg(filled ? 'Option updated on the page' : 'Couldn’t update that option', filled ? 'ok' : 'warn')
  },

  workerClearSession() {
    workerCtx = null
    set({ workerScan: null, workerAnswers: {}, workerApproved: {}, workerPendingFill: [], workerState: 'idle', workerError: null })
  },

  setWorkerUserContext(ctx) {
    set({ workerUserContext: ctx })
  },

  setVaultAutofillOpen(open) {
    set({ vaultAutofillOpen: open })
    if (open) void get().vaultAutofillDetect()
    else set({ vaultAutofillState: 'idle', vaultAutofillError: null })
  },

  async vaultAutofillDetect() {
    const st = get()
    const tab = st.session.tabs.find((t) => t.id === st.session.activeTab)
    const url = tab?.url || ''
    const origin = displayOrigin(url)
    set({ vaultAutofillOrigin: origin, vaultAutofillError: null })
    if (!isEligibleOrigin(url)) {
      set({ vaultAutofillState: 'ineligible', vaultMatches: [], vaultSelectedId: null })
      return
    }
    if (!st.vaultExists) {
      set({ vaultAutofillState: 'unavailable', vaultMatches: [], vaultSelectedId: null })
      return
    }
    if (!st.vaultUnlocked) {
      set({ vaultAutofillState: 'locked', vaultMatches: [], vaultSelectedId: null })
      return
    }
    // Load safe metadata only (no passwords). Match against the LIVE tab origin
    // for display; the actual fill re-verifies origin authoritatively in main.
    let creds: VaultMetaCredential[] = st.vaultCreds
    if (window.nexa) {
      const res = await window.nexa.passwordManager.list(st.activeProfile)
      if (res?.ok) creds = res.data as VaultMetaCredential[]
    }
    const matches = matchCredentials(url, creds) as VaultMetaCredential[]
    set({
      vaultMatches: matches,
      vaultSelectedId: matches[0]?.id ?? null,
      vaultAutofillState: matches.length ? 'ready' : 'nomatch'
    })
  },

  vaultSelect(credentialId) {
    set({ vaultSelectedId: credentialId })
  },

  async vaultAutofillFill(credentialId) {
    const st = get()
    // ASK mode: vault interaction is blocked (defense-in-depth; main also rejects).
    if (st.agentMode === 'ask') {
      get().toastMsg('Vault autofill is blocked in Ask mode', 'warn')
      return
    }
    if (!vaultAutofillRunner) {
      set({ vaultAutofillState: 'failed', vaultAutofillError: 'Autofill is not ready on this page' })
      return
    }
    set({ vaultAutofillState: 'filling', vaultAutofillError: null, vaultSelectedId: credentialId })
    let res: { ok: boolean; filled?: boolean; error?: string }
    try {
      res = await vaultAutofillRunner({ credentialId, mode: st.agentMode })
    } catch {
      res = { ok: false, error: 'autofill_failed' }
    }
    if (res.ok && res.filled) {
      set({ vaultAutofillState: 'filled', vaultAutofillError: null })
      get().toastMsg('Credential filled — review before submitting')
    } else {
      const msg =
        res.error === 'no_password_field'
          ? 'No login field detected on this page'
          : res.error === 'origin_mismatch'
            ? 'This site does not match the saved credential'
            : res.error === 'vault_locked'
              ? 'Unlock the vault to autofill'
              : res.error === 'not_ready'
                ? 'Open a web page to autofill'
                : 'Autofill could not complete'
      set({ vaultAutofillState: 'failed', vaultAutofillError: msg })
      get().toastMsg(msg, 'warn')
    }
  },

  openPrivacyCenter() {
    get().setView('privacy')
    if (get().privacyState === 'idle') void get().runPrivacyCheck()
  },

  async runPrivacyCheck() {
    set({ privacyState: 'checking', privacyStep: 'Detecting current origin…', privacyError: null })
    const st = get()
    const tab = st.session.tabs.find((t) => t.id === st.session.activeTab)
    const isWeb = tab?.kind === 'web' && !!tab.url
    const url = isWeb ? (tab!.url || '') : ''
    const isPrivate = !!tab?.private

    // HTTPS (from the live URL only).
    const https = classifyHttps(url)
    const host = url ? hostnameOf(url) : ''
    const domain = host ? registrableDomain(host) : ''

    // Content protection — reuse the existing P3 telemetry (no second engine).
    const snap = isPrivate ? st.protectionPrivate : st.protection
    const ds = domain && snap ? snap.perDomain[domain] : undefined
    const protStatus: DiagStatus = !snap
      ? 'UNKNOWN'
      : snap.state === 'error'
        ? 'UNAVAILABLE'
        : !snap.settings.enabled
          ? 'NOT_CONFIGURED'
          : snap.state === 'active'
            ? 'ACTIVE'
            : 'NOT_CONFIGURED'
    const protection = { status: protStatus, blocked: ds?.blocked || 0, requests: ds?.requests || 0 }

    // VPN — reuse the existing P4 status (only PROTECTED when verified upstream).
    set({ privacyStep: 'Reading VPN status…' })
    const v = st.vpn
    const vpnStatus: DiagStatus = !v || v.state === 'not_configured'
      ? 'NOT_CONFIGURED'
      : v.state === 'protected'
        ? 'PROTECTED'
        : v.state === 'connecting'
          ? 'CHECKING'
          : v.state === 'error'
            ? 'UNAVAILABLE'
            : 'DETECTED'
    const handshake: 'VERIFIED' | 'NOT_VERIFIED' | 'UNKNOWN' =
      v?.state === 'protected'
        ? v.health && v.health.handshakeAgeSec != null
          ? 'VERIFIED'
          : 'NOT_VERIFIED'
        : 'UNKNOWN'
    const killSwitch: 'ON' | 'OFF' | 'NOT_CONFIGURED' = !v
      ? 'NOT_CONFIGURED'
      : v.killSwitch?.enabled
        ? 'ON'
        : 'OFF'
    const vpnSummary = { status: vpnStatus, handshake, killSwitch, ipv6: v?.ipv6 ? String(v.ipv6) : 'UNKNOWN' }

    // Browser-native probe (renderer): WebRTC / fingerprint / permissions.
    set({ privacyStep: 'Running browser diagnostics…' })
    let probe: PrivacyProbeResult | null = null
    if (privacyProbe) {
      try {
        probe = await privacyProbe()
      } catch {
        probe = null
      }
    }

    // Main network diagnostics (interfaces + DNS resolvers + cookie count).
    set({ privacyStep: 'Checking connection & DNS…' })
    let interfaces: InterfaceSummary | null = null
    let dnsServers: string[] = []
    let cookieCount: number | null = null
    let ipv6Available = false
    if (window.nexa) {
      const res = await window.nexa.privacy.diagnose({
        profileId: st.activeProfile,
        url,
        webContentsId: probe?.webContentsId ?? undefined
      })
      if (res?.ok) {
        interfaces = summarizeInterfaces(res.data.interfaces)
        ipv6Available = interfaces.ipv6Available
        dnsServers = res.data.dnsServers
        cookieCount = res.data.cookieCount
      }
    }

    const dns = normalizeDns(dnsServers, { vpnConnected: vpnStatus === 'PROTECTED' })
    const webrtc = probe
      ? normalizeWebrtc(probe.webrtcCandidates, { available: probe.webrtcAvailable })
      : normalizeWebrtc([], { available: false })
    const fingerprint = buildFingerprint(probe?.fingerprint || {})

    const aggregate = aggregatePrivacy({
      https,
      protection: { status: protection.status, blocked: protection.blocked, requests: protection.requests },
      vpn: { status: vpnSummary.status, handshakeVerified: handshake === 'VERIFIED', killSwitch: vpnSummary.killSwitch },
      dns: dns.status,
      webrtc: webrtc.status
    })

    const report: PrivacyReport = {
      origin: url,
      host,
      isWeb: !!isWeb,
      private: isPrivate,
      https,
      protection,
      vpn: vpnSummary,
      // Website-visible public IP requires an external echo we do not ship → honest.
      ip: { publicIp: 'NOT_CONFIGURED', interfaces, ipv6Available },
      dns,
      webrtc,
      fingerprint,
      fingerprintDetails: probe?.fingerprintDetails || {},
      permissions: probe?.permissions || {},
      cookieCount,
      aggregate,
      ranAt: Date.now()
    }
    // Session-only. Never persisted; private-mode leaves no trace on disk.
    set({ privacyReport: report, privacyState: 'done', privacyStep: '' })
  },

  /* --------------------------- Google Drive (STEP 8) --------------------------- */

  openDrive() {
    get().setView('drive')
    void get().driveRefreshStatus().then(() => {
      const m = get().driveMeta
      if (m?.connected && get().driveFiles.length === 0) void get().driveList()
    })
  },

  async driveRefreshStatus() {
    if (!window.nexa) return
    set({ driveBusy: 'checking', driveError: null })
    const res = await window.nexa.drive.getStatus({ profileId: get().activeProfile })
    if (res?.ok) set({ driveMeta: res.data })
    set({ driveBusy: '' })
  },

  async driveConnect() {
    if (!window.nexa) return
    // OAuth requires explicit user action + the official Google UI (opened by main).
    set({ driveBusy: 'connecting', driveError: null })
    get().toastMsg('Opening Google sign-in…')
    const res = await window.nexa.drive.connect({ profileId: get().activeProfile })
    if (res?.ok) {
      set({ driveMeta: res.data, driveBusy: '' })
      if (res.data.connected) {
        get().toastMsg(`Connected · ${res.data.email || 'Google Drive'}`)
        void get().driveList()
      } else if (res.data.error === 'timeout' || res.data.error === 'cancelled') {
        get().toastMsg('Google Drive sign-in was not completed', 'warn')
      } else if (res.data.state === 'NOT_CONFIGURED') {
        get().toastMsg('Google Drive is not configured', 'warn')
      }
    } else {
      set({ driveBusy: '', driveError: res?.error?.message || 'Could not connect' })
      get().toastMsg(res?.error?.message || 'Could not connect to Google Drive', 'warn')
    }
  },

  async driveDisconnect() {
    if (!window.nexa) return
    const res = await window.nexa.drive.disconnect({ profileId: get().activeProfile })
    if (res?.ok) {
      set({ driveMeta: res.data, driveFiles: [], driveNextPageToken: null, driveFolder: null, driveQuery: '' })
      get().toastMsg('Disconnected NEXA from Google Drive')
    }
  },

  async driveList(opts) {
    if (!window.nexa) return
    const category = opts?.category ?? get().driveCategory
    const folder = opts?.folder ?? null
    set({ driveBusy: 'listing', driveError: null, driveCategory: category, driveFolder: folder, driveQuery: '' })
    const res = await window.nexa.drive.list({
      profileId: get().activeProfile,
      category: folder ? 'folder' : category,
      folderId: folder?.id
    })
    if (res?.ok) {
      set({ driveFiles: res.data.files, driveNextPageToken: res.data.nextPageToken || null, driveBusy: '' })
    } else {
      set({ driveBusy: '', driveError: res?.error?.message || 'Could not load files' })
      void get().driveRefreshStatus()
    }
  },

  async driveSearch(query) {
    if (!window.nexa) return
    const q = query.trim()
    set({ driveQuery: query })
    if (!q) return void get().driveList()
    set({ driveBusy: 'searching', driveError: null, driveFolder: null })
    const res = await window.nexa.drive.search({ profileId: get().activeProfile, query: q })
    if (res?.ok) {
      set({ driveFiles: res.data.files, driveNextPageToken: res.data.nextPageToken || null, driveBusy: '' })
    } else {
      set({ driveBusy: '', driveError: res?.error?.message || 'Search failed' })
      void get().driveRefreshStatus()
    }
  },

  async driveDownload(file) {
    if (!window.nexa) return
    if (file.isFolder) return void get().driveList({ folder: { id: file.id, name: file.name } })
    set({ driveBusy: 'downloading' })
    // Private-mode policy: a Drive download inherits the active tab's private flag.
    const tab = get().session.tabs.find((t) => t.id === get().session.activeTab)
    const isPrivate = !!tab?.private
    const res = await window.nexa.drive.download({ profileId: get().activeProfile, fileId: file.id, isPrivate })
    set({ driveBusy: '' })
    if (res?.ok) {
      if ('export' in res.data) {
        get().toastMsg('This Google file type cannot be exported for download', 'warn')
      } else {
        get().toastMsg(`Downloading ${res.data.filename}`)
      }
    } else {
      get().toastMsg(res?.error?.message || 'Could not start the download', 'warn')
      void get().driveRefreshStatus()
    }
  },

  async loadVisionStatus() {
    const st = get()
    if (!window.nexa) return
    const res = await window.nexa.ai.visionStatus({ profileId: st.activeProfile })
    set({ visionCapability: res?.ok ? res.data.capability : 'ERROR' })
  },

  aiCancel() {
    const st = get()
    if (!window.nexa || !st.aiRequestId) return
    window.nexa.ai.cancel({ profileId: st.activeProfile, requestId: st.aiRequestId })
  },

  aiClear() {
    const st = get()
    if (st.aiRequestId) get().aiCancel()
    set({ aiMessages: [], aiRun: 'idle', aiRequestId: null, aiError: null, aiLastPrompt: null, aiLastPrivate: false, aiPageContext: null })
  },

  aiRetry() {
    const st = get()
    if (!st.aiLastPrompt) return
    // Drop a trailing errored/empty assistant bubble before retrying.
    const msgs = st.aiMessages.slice()
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'assistant') msgs.pop()
    set({ aiMessages: msgs })
    get().aiStartStream(st.aiLastPrompt, { private: st.aiLastPrivate })
  },

  async aiSelectModel(chatModel) {
    if (!window.nexa) return
    const st = get()
    if (st.aiStatus?.providerId && st.aiStatus.providerId !== 'ollama') {
      // Non-local providers take a routed model ref from the profile config.
      await get().updateAiConfig({ model: chatModel })
      await get().loadAiStatus()
      const label = get().aiStatus?.models.find((m) => m.name === chatModel)?.displayName || chatModel
      get().toastMsg(`AI model · ${label}`)
      return
    }
    const res = await window.nexa.ai.selectModel({ profileId: get().activeProfile, chatModel })
    if (res?.ok) {
      set({ aiStatus: get().aiStatus ? { ...get().aiStatus!, chatModel: res.data.chatModel } : null })
      await get().loadAiStatus()
      get().toastMsg(`AI chat model · ${chatModel}`)
    }
  },

  async refreshHistory(opts = {}) {
    if (!window.nexa) return
    set({ historyLoading: true })
    const res = await window.nexa.history.query({
      profileId: get().activeProfile,
      search: opts.search,
      range: opts.range || 'all',
      limit: 500
    })
    set({ historyRows: res?.ok ? res.data : [], historyLoading: false })
  },

  async bookmarkCurrent() {
    const tab = get().session.tabs.find((t) => t.id === get().session.activeTab)
    if (!tab || tab.kind !== 'web' || !tab.url) {
      get().toastMsg('Open a web page first to bookmark it', 'warn')
      return
    }
    const existing = get().isBookmarked(tab.url)
    if (existing) {
      const item = get().bookmarks?.items.find((i) => i.type === 'bookmark' && i.url === validateBookmarkUrl(tab.url))
      if (item) {
        const res = await window.nexa.bookmarks.remove({ profileId: get().activeProfile, id: item.id })
        if (res?.ok) {
          set({ bookmarks: res.data })
          get().toastMsg('Bookmark removed')
        }
      }
      return
    }
    const res = await window.nexa.bookmarks.create({
      profileId: get().activeProfile,
      title: tab.title,
      url: tab.url,
      parentId: 'bar'
    })
    if (res?.ok) {
      set({ bookmarks: res.data })
      get().toastMsg('Bookmarked · saved to Bookmark Bar')
    } else {
      get().toastMsg(res?.error?.message || 'Could not bookmark', 'err')
    }
  },

  isBookmarked(url) {
    const norm = validateBookmarkUrl(url)
    if (!norm) return false
    return !!get().bookmarks?.items.some((i) => i.type === 'bookmark' && i.url === norm)
  },

  openUrl(url, opts = {}) {
    const norm = validateBookmarkUrl(url)
    if (!norm) {
      get().toastMsg('That link is not a valid web address', 'warn')
      return
    }
    if (opts.newTab) {
      const { session } = get()
      const id = nextTabId(session.tabs)
      const tab: TabRecord = { id, title: hostTitle(norm), url: norm, kind: 'web', view: 'web' }
      set({ session: { ...session, tabs: [...session.tabs, tab], activeTab: id }, addr: norm, overlay: null })
      get().persistSession()
    } else {
      get().navigate(norm)
    }
  },

  reopenClosedTab() {
    const { closedTabs, session } = get()
    if (!closedTabs.length) {
      get().toastMsg('No recently closed tabs', 'warn')
      return
    }
    const last = closedTabs[closedTabs.length - 1]
    const id = nextTabId(session.tabs)
    const tab: TabRecord = { ...last, id }
    set({
      closedTabs: closedTabs.slice(0, -1),
      session: { ...session, tabs: [...session.tabs, tab], activeTab: id },
      addr: tab.url
    })
    get().persistSession()
  },

  pinTab(id) {
    const { session } = get()
    const tabs = session.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t))
    set({ session: { ...session, tabs } })
    get().persistSession()
  },

  newPrivateTab() {
    const { session } = get()
    const id = nextTabId(session.tabs)
    const tab: TabRecord = { id, title: 'Private Tab', url: '', kind: 'chrome', view: 'newtab', private: true }
    set({ session: { ...session, tabs: [...session.tabs, tab], activeTab: id }, addr: '', overlay: null })
    get().toastMsg('Private tab · not saved to history or session')
    get().persistSession()
  },

  persistPrefs() {
    if (!window.nexa) return
    const { activeProfile, prefs } = get()
    debounce(() => {
      window.nexa.settings.saveProfile({ profileId: activeProfile, prefs })
    })
  },

  persistGlobal() {
    if (!window.nexa) return
    window.nexa.settings.saveGlobal(get().global)
  },

  persistSession() {
    if (!window.nexa) return
    const { activeProfile, session } = get()
    debounce(() => {
      window.nexa.settings.saveSession({ profileId: activeProfile, session })
    })
  },

  async persistIndex() {
    if (!window.nexa) return
    const { activeProfile, profiles } = get()
    await window.nexa.settings.saveProfilesIndex({ activeProfile, profiles })
  },

  setDashLayout(visible) {
    const st = get()
    const cur = st.profiles[st.activeProfile]
    if (!cur) return
    // Validate untrusted / caller-supplied ids before persisting.
    const next: Profile = {
      ...cur,
      dash: { ...cur.dash, visible: normalizeDashboardLayout(visible), v: DASHBOARD_LAYOUT_VERSION }
    }
    set({ profiles: { ...st.profiles, [cur.id]: next } })
    void get().persistIndex()
  },

  resetDashLayout() {
    get().setDashLayout(defaultDashboardLayout())
  },

  setDashGreeting(on) {
    const st = get()
    const cur = st.profiles[st.activeProfile]
    if (!cur) return
    const next: Profile = { ...cur, dash: { ...cur.dash, greeting: on } }
    set({ profiles: { ...st.profiles, [cur.id]: next } })
    void get().persistIndex()
  },

  setView(view, section) {
    const { session } = get()
    const tabs = session.tabs.map((t) =>
      t.id === session.activeTab
        ? { ...t, view, kind: (view === 'web' ? 'web' : 'chrome') as TabRecord['kind'], title: titleFor(view, t) }
        : t
    )
    set({
      session: { ...session, tabs },
      settingsSection: section || get().settingsSection,
      overlay: null
    })
    get().persistSession()
  },

  newTab(view = 'newtab') {
    const { session } = get()
    const id = nextTabId(session.tabs)
    const tab: TabRecord = { id, title: 'New Tab', url: '', kind: 'chrome', view }
    set({
      session: { ...session, tabs: [...session.tabs, tab], activeTab: id },
      addr: '',
      overlay: null
    })
    get().persistSession()
  },

  closeTab(id) {
    const { session, closedTabs } = get()
    if (session.tabs.length <= 1) return
    const idx = session.tabs.findIndex((t) => t.id === id)
    const closing = session.tabs[idx]
    const tabs = session.tabs.filter((t) => t.id !== id)
    let activeTab = session.activeTab
    if (session.activeTab === id) activeTab = tabs[Math.min(idx, tabs.length - 1)].id
    const active = tabs.find((t) => t.id === activeTab)
    // Track recently closed web tabs (non-private) for reopen.
    const nextClosed =
      closing && closing.kind === 'web' && closing.url && !closing.private
        ? [...closedTabs, closing].slice(-10)
        : closedTabs
    set({ session: { ...session, tabs, activeTab }, addr: active?.url || '', closedTabs: nextClosed })
    get().persistSession()
  },

  activateTab(id) {
    const { session } = get()
    const t = session.tabs.find((x) => x.id === id)
    if (!t) return
    set({ session: { ...session, activeTab: id }, addr: t.url || '' })
    get().persistSession()
  },

  navigate(input) {
    const raw = input.trim()
    if (!raw) return
    const { prefs, session } = get()
    const url = looksLikeUrl(raw) ? normalizeUrl(raw) : searchUrl(prefs.sv.search, raw)
    // STEP 9 — bounded duplicate-navigation guard (double-Enter / repeated commands).
    const now = Date.now()
    if (isDuplicateNavigation(lastNav, { url, at: now })) return
    lastNav = { url, at: now }
    const id = session.activeTab
    const current = session.tabs.find((t) => t.id === id)
    const title = hostTitle(url)
    const tabs = session.tabs.map((t) =>
      t.id === id ? { ...t, url, kind: 'web' as const, view: 'web' as const, title } : t
    )
    set({ session: { ...session, tabs }, addr: url, overlay: null, ntSearch: '' })
    get().persistSession()
    // Real navigation -> record in history (skipped for private tabs / disabled).
    if (window.nexa && prefs.historyEnabled) {
      window.nexa.history.record({ profileId: get().activeProfile, url, title, private: !!current?.private })
    }
  },

  recordNavUrl(id, url) {
    const { session } = get()
    const tab = session.tabs.find((t) => t.id === id)
    if (!tab || tab.kind !== 'web' || tab.url === url || !/^https?:\/\//i.test(url)) return
    const tabs = session.tabs.map((t) => (t.id === id ? { ...t, url } : t))
    const editing = !!(document.activeElement as HTMLElement | null)?.closest?.('.omnibox')
    set({ session: { ...session, tabs }, ...(session.activeTab === id && !editing ? { addr: url } : {}) })
    get().persistSession()
  },

  recordNavTitle(id, title) {
    const { session } = get()
    const tab = session.tabs.find((t) => t.id === id)
    if (!tab || tab.kind !== 'web' || !tab.url) return
    const tabs = session.tabs.map((t) => (t.id === id ? { ...t, title } : t))
    set({ session: { ...session, tabs } })
    get().persistSession()
    if (window.nexa && get().prefs.historyEnabled) {
      window.nexa.history.record({ profileId: get().activeProfile, url: tab.url, title, private: !!tab.private })
    }
  },

  /* --------------------------- Turbo (STEP 9) --------------------------- */
  turboState() {
    const { prefs } = get()
    // Supported wherever the preload bridge exists. Never fabricated.
    const supported = !!window.nexa?.turbo
    return deriveTurboState({ supported, enabled: !!prefs.toggles.turbo, optimizing: get().navLoading && !!prefs.toggles.turbo })
  },

  setTurboEnabled(on) {
    const prefs = get().prefs
    set({ prefs: { ...prefs, toggles: { ...prefs.toggles, turbo: on } } })
    get().persistPrefs()
  },

  setTurboPref(key, on) {
    const prefs = get().prefs
    set({ prefs: { ...prefs, turbo: { ...prefs.turbo, [key]: on } } })
    get().persistPrefs()
  },

  turboPreconnect(url) {
    const { prefs, session } = get()
    if (!window.nexa?.turbo) return
    if (!prefs.toggles.turbo || !prefs.turbo.predict) return
    const active = session.tabs.find((t) => t.id === session.activeTab)
    // Never warm connections for private tabs (hard privacy boundary).
    if (active?.private) return
    const origin = preconnectTarget(url, { enabled: true, privateMode: false })
    if (!origin || origin === lastPreconnect) return
    lastPreconnect = origin
    // Fire-and-forget; failure is silent and never blocks navigation.
    void window.nexa.turbo.preconnect({ profileId: get().activeProfile, url }).catch(() => {})
  },

  setWebNav(nav) {
    const cur = get().webNav
    if (cur && nav && cur.tabId === nav.tabId && cur.canBack === nav.canBack && cur.canForward === nav.canForward) return
    set({ webNav: nav })
  },

  recordNavStart() {
    if (!get().navLoading) set({ navLoading: true })
  },

  recordNavPerf(perf) {
    // In-memory only. Metrics disabled → keep classification honest ("Unavailable").
    if (!get().prefs.turbo.metrics) {
      set({ navLoading: false, turboLastPerf: null, turboLastClass: 'Unavailable' })
      return
    }
    set({ navLoading: false, turboLastPerf: perf, turboLastClass: classifyNavigation(perf) })
  },

  openTurbo() {
    set({ overlay: 'turbo' })
  },

  /* --------------------------- Regional (STEP 10) --------------------------- */
  setRegional(patch) {
    const prefs = get().prefs
    const next = { ...prefs.regional, ...patch }
    // Reject an obviously invalid explicit value before persisting (honest UI).
    const v = validateRegional(next)
    if (!v.ok) {
      get().toastMsg('Invalid regional value', 'warn')
      return
    }
    set({ prefs: { ...prefs, regional: next } })
    get().persistPrefs()
    void get().regionalApply()
  },

  async regionalApply() {
    if (!window.nexa?.regional) return
    const res = await window.nexa.regional.apply({ profileId: get().activeProfile }).catch(() => null)
    if (res?.ok) set({ regionalCaps: res.data })
  },

  toggleTheme() {
    const theme = get().prefs.theme === 'dark' ? 'light' : 'dark'
    set({ prefs: { ...get().prefs, theme, themeName: theme === 'dark' ? 'Midnight' : 'Pure Light' } })
    get().persistPrefs()
  },

  async switchProfile(id) {
    const { profiles, activeProfile, agentTaskId } = get()
    const p = profiles[id]
    if (!p) return
    // Terminate any running agent task in the outgoing profile (no cross-profile context).
    if (agentTaskId) window.nexa.agent.cancel({ profileId: activeProfile, taskId: agentTaskId })
    await window.nexa.passwordManager.lock(get().activeProfile)
    await window.nexa.settings.saveProfilesIndex({ activeProfile: id, profiles })
    const res = await window.nexa.settings.load()
    if (!res?.ok) return
    const loaded = res.data as {
      index: { activeProfile: string; profiles: Record<string, Profile> }
      prefs: ProfilePrefs
      session: SessionState
      vault: { exists: boolean; unlocked: boolean }
    }
    set({
      activeProfile: id,
      profiles: loaded.index.profiles,
      prefs: { ...loaded.prefs, accent: p.accent },
      session: loaded.session?.tabs?.length ? loaded.session : defaultSession(),
      vaultExists: loaded.vault.exists,
      vaultUnlocked: false,
      vaultCreds: [],
      overlay: null,
      revealId: null,
      revealed: null,
      bookmarks: null,
      collections: null,
      historyRows: [],
      closedTabs: [],
      downloads: [],
      downloadSettings: null,
      protection: null,
      protectionPrivate: null,
      protectionRules: null,
      vpn: null,
      vpnServers: [],
      aiStatus: null,
      aiProviders: [],
      aiConfig: null,
      aiGateway: null,
      extensions: [],
      aiMessages: [],
      aiRun: 'idle',
      aiRequestId: null,
      aiError: null,
      aiLastPrompt: null,
      aiLastPrivate: false,
      aiPageContext: null,
      agentTaskId: null,
      agentTask: null,
      agentSteps: [],
      agentState: 'idle',
      agentResult: null,
      agentError: null,
      agentPermission: null,
      visionCapability: null,
      workerOpen: false,
      workerState: 'idle',
      workerScan: null,
      workerAnswers: {},
      workerApproved: {},
      workerPendingFill: [],
      workerError: null,
      workerHistory: [],
      workerUserContext: null,
      vaultAutofillOpen: false,
      vaultAutofillState: 'idle',
      vaultMatches: [],
      vaultAutofillOrigin: '',
      vaultSelectedId: null,
      vaultAutofillError: null,
      privacyState: 'idle',
      privacyStep: '',
      privacyReport: null,
      privacyError: null,
      // Drive state is profile-scoped — discard the previous profile's state.
      driveMeta: null,
      driveBusy: '',
      driveFiles: [],
      driveNextPageToken: null,
      driveCategory: 'my-drive',
      driveQuery: '',
      driveFolder: null,
      driveError: null,
      // Turbo prediction/metrics are profile-scoped + ephemeral — never carried across.
      navLoading: false,
      turboLastPerf: null,
      turboLastClass: 'Unavailable',
      // Regional caps belong to the previous profile — clear then re-derive below.
      regionalCaps: null
    })
    lastNav = null
    lastPreconnect = ''
    workerCtx = null
    await get().loadLibrary()
    await get().loadDownloads()
    await get().loadProtection()
    await get().loadVpn()
    void get().loadAiStatus()
    void get().loadAiProviders()
    void get().loadExtensions()
    // Apply the newly-active profile's regional prefs (Accept-Language) at session level.
    void get().regionalApply()
    get().toastMsg(`Profile · ${p.name} (${p.status})`)
  },

  async createProfile() {
    const name = get().newProfileName.trim()
    if (!name) {
      get().toastMsg('Enter a profile name', 'warn')
      return
    }
    const id = 'p' + Date.now()
    const preset = get().newProfilePreset
    const accents: Record<string, string> = {
      Personal: '#4b57e6',
      Research: '#0f9d6b',
      Development: '#e0851b',
      Minimal: '#7c8698',
      Downloads: '#0891b2'
    }
    const prof = defaultProfile({ id, name, status: preset, accent: accents[preset] || '#4b57e6' })
    const profiles = { ...get().profiles, [id]: prof }
    set({ profiles, overlay: null, newProfileName: '' })
    await get().switchProfile(id)
  },

  async saveProfileEdit() {
    const d = get().profileDraft
    if (!d?.name.trim()) {
      get().toastMsg('Name cannot be empty', 'warn')
      return
    }
    const profiles = { ...get().profiles, [d.id]: d }
    set({ profiles, overlay: null, profileDraft: null, prefs: { ...get().prefs, accent: d.accent } })
    await get().persistIndex()
    get().persistPrefs()
    get().toastMsg('Profile saved')
  },

  setPref(key, value) {
    set({ prefs: { ...get().prefs, [key]: value } })
    get().persistPrefs()
  }
}))

function titleFor(view: ChromeView, t: TabRecord) {
  if (view === 'newtab') return 'New Tab'
  if (view === 'settings') return 'Settings'
  if (view === 'downloads') return 'Downloads'
  if (view === 'cloud') return 'Cloud Transfer'
  if (view === 'about') return 'About NEXA'
  if (view === 'bookmarks') return 'Bookmarks'
  if (view === 'history') return 'History'
  if (view === 'collections') return 'Collections'
  if (view === 'protection') return 'Content Protection'
  if (view === 'privacy') return 'Privacy Center'
  if (view === 'drive') return 'Google Drive'
  return t.title
}

function hostTitle(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function activeTab() {
  const s = useNexa.getState().session
  return s.tabs.find((t) => t.id === s.activeTab)
}

export function activeProfile() {
  const st = useNexa.getState()
  return st.profiles[st.activeProfile]
}

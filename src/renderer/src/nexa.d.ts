import type { BookmarkStore, CollectionStore, HistoryEntry } from '@shared/library'
import type { DownloadItem, DownloadSettings } from '@shared/downloads'
import type { ProtectionSettings, ProtectionStats, ProtectionEventRecord, ProtectionRuntimeState } from '@shared/protection'
import type { VpnStatus, VpnServer, VpnSettings } from '@shared/vpn'
import type { AiStatus, AiModel, AiSettings, AiStreamEvent } from '@shared/ai'
import type { AIProviderInfo, AIProviderId, ProfileAIConfig } from '@shared/ai-providers'
import type { GatewayInfo, ProviderConnectionInfo } from '@shared/ai-gateway'
import type { VisionStatus } from '@shared/vision'
import type { AgentEvent, AgentTaskHistoryEntry } from '@shared/agent'
import type { ExtensionInfo, ExtensionPreview, SiteAccessMode } from '@shared/extensions'

export type DownloadEvent =
  | { type: 'update'; profileId: string; item: DownloadItem }
  | { type: 'removed'; profileId: string; id: string }
  | { type: 'list'; profileId: string; items: DownloadItem[] }

export interface ProtectionSnapshot {
  profileId: string
  private: boolean
  state: ProtectionRuntimeState
  settings: ProtectionSettings
  totals: ProtectionStats
  perDomain: Record<string, ProtectionStats>
  recent: ProtectionEventRecord[]
}
export type ProtectionEvent = { type: 'snapshot'; snapshot: ProtectionSnapshot }
export type VpnEvent = { type: 'status'; status: VpnStatus }
export type { VpnStatus, VpnServer, VpnSettings } from '@shared/vpn'
export interface SiteState {
  domain: string
  applicable: boolean
  enabled: boolean
  allowlisted: boolean
  blocklisted: boolean
  override?: boolean | null
}
export interface ProtectionRules {
  allow: string[]
  block: string[]
  overrides: Record<string, boolean>
  lists: { id: string; name: string; rules: number; active: boolean }[]
  totalRules: number
}

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

type PremiumResult = { ok: true; providers: ProviderConnectionInfo[] } | { ok: false; code: string; message: string }

declare global {
  interface Window {
    nexa: {
      app: { info: () => Promise<Result<Record<string, string>>> }
      window: {
        minimize: () => Promise<Result<boolean>>
        maximize: () => Promise<Result<boolean>>
        close: () => Promise<Result<boolean>>
      }
      settings: {
        load: () => Promise<Result<Record<string, unknown>>>
        saveGlobal: (payload: unknown) => Promise<Result<boolean>>
        saveProfile: (payload: unknown) => Promise<Result<boolean>>
        saveProfilesIndex: (payload: unknown) => Promise<Result<unknown>>
        saveSession: (payload: unknown) => Promise<Result<boolean>>
      }
      downloads: {
        pickDirectory: () => Promise<Result<string | null>>
        list: (profileId: string) => Promise<Result<DownloadItem[]>>
        get: (payload: { profileId: string; id: string }) => Promise<Result<DownloadItem>>
        pause: (payload: { profileId: string; id: string }) => Promise<Result<DownloadItem>>
        resume: (payload: { profileId: string; id: string }) => Promise<Result<DownloadItem>>
        cancel: (payload: { profileId: string; id: string }) => Promise<Result<DownloadItem>>
        retry: (payload: { profileId: string; id: string }) => Promise<Result<DownloadItem>>
        remove: (payload: { profileId: string; id: string }) => Promise<Result<boolean>>
        clearCompleted: (profileId: string) => Promise<Result<DownloadItem[]>>
        clearFailed: (profileId: string) => Promise<Result<DownloadItem[]>>
        open: (payload: { profileId: string; id: string }) => Promise<Result<boolean>>
        showInFolder: (payload: { profileId: string; id: string }) => Promise<Result<boolean>>
        copyUrl: (payload: { profileId: string; id: string }) => Promise<Result<{ url: string }>>
        pauseAll: (profileId: string) => Promise<Result<boolean>>
        resumeAll: (profileId: string) => Promise<Result<boolean>>
        openFolder: (profileId: string) => Promise<Result<boolean>>
        getSettings: (profileId: string) => Promise<Result<DownloadSettings>>
        saveSettings: (payload: { profileId: string; settings: DownloadSettings }) => Promise<Result<DownloadSettings>>
        onEvent: (cb: (event: DownloadEvent) => void) => () => void
      }
      protection: {
        getState: (profileId: string) => Promise<Result<ProtectionSnapshot>>
        getStats: (payload: { profileId: string; private?: boolean }) => Promise<Result<ProtectionSnapshot>>
        getSettings: (profileId: string) => Promise<Result<ProtectionSettings>>
        saveSettings: (payload: { profileId: string; enabled: boolean; ads: boolean; trackers: boolean; annoyances: boolean }) => Promise<Result<ProtectionSettings>>
        setEnabled: (payload: { profileId: string; enabled: boolean }) => Promise<Result<ProtectionSettings>>
        getSiteState: (payload: { profileId: string; domain: string }) => Promise<Result<SiteState>>
        setSiteEnabled: (payload: { profileId: string; domain: string; enabled: boolean }) => Promise<Result<SiteState>>
        addAllow: (payload: { profileId: string; domain: string }) => Promise<Result<ProtectionRules>>
        removeAllow: (payload: { profileId: string; domain: string }) => Promise<Result<ProtectionRules>>
        addBlock: (payload: { profileId: string; domain: string }) => Promise<Result<ProtectionRules>>
        removeBlock: (payload: { profileId: string; domain: string }) => Promise<Result<ProtectionRules>>
        getRules: (profileId: string) => Promise<Result<ProtectionRules>>
        resetStats: (payload: { profileId: string; private?: boolean }) => Promise<Result<boolean>>
        onEvent: (cb: (event: ProtectionEvent) => void) => () => void
      }
      vpn: {
        getStatus: (profileId: string) => Promise<Result<VpnStatus>>
        connect: (profileId: string) => Promise<Result<VpnStatus>>
        disconnect: (profileId: string) => Promise<Result<VpnStatus>>
        reconnect: (profileId: string) => Promise<Result<VpnStatus>>
        importConfig: (payload: { profileId: string; name: string; config: string }) => Promise<Result<VpnServer>>
        removeConfig: (payload: { profileId: string; serverId: string }) => Promise<Result<VpnStatus>>
        getServers: (profileId: string) => Promise<Result<VpnServer[]>>
        selectServer: (payload: { profileId: string; serverId: string }) => Promise<Result<VpnStatus>>
        getSettings: (profileId: string) => Promise<Result<VpnSettings>>
        updateSettings: (payload: { profileId: string; autoConnect: string; killSwitch: boolean; dnsProtection: boolean; ipv6: string; disconnectOnExit: boolean }) => Promise<Result<VpnStatus>>
        getStatistics: (profileId: string) => Promise<Result<VpnStatus>>
        onEvent: (cb: (event: VpnEvent) => void) => () => void
      }
      ai: {
        status: (profileId: string) => Promise<Result<AiStatus>>
        models: (profileId: string) => Promise<Result<AiModel[]>>
        testConnection: (profileId: string) => Promise<Result<{ ok: boolean; models: number; note?: string }>>
        getSettings: (profileId: string) => Promise<Result<AiSettings>>
        selectModel: (payload: { profileId: string; chatModel?: string; embedModel?: string }) => Promise<Result<AiSettings>>
        chat: (payload: { profileId: string; requestId: string; model?: string; messages: { role: string; content: string }[]; private?: boolean }) => Promise<Result<{ requestId: string; started: boolean }>>
        cancel: (payload: { profileId: string; requestId: string }) => Promise<Result<{ cancelled: boolean }>>
        embed: (payload: { profileId: string; model?: string; input: string | string[] }) => Promise<Result<{ vectors: number[][]; dim: number; count: number }>>
        visionStatus: (payload: { profileId: string; model?: string }) => Promise<Result<VisionStatus>>
        visionAnalyze: (payload: { profileId: string; requestId?: string; model?: string; image: string; prompt: string; system?: string; private?: boolean }) => Promise<Result<{ ok: boolean; text?: string; error?: string }>>
        onEvent: (cb: (event: AiStreamEvent) => void) => () => void
        // STEP 12 — multi-provider metadata (never any secret).
        providers: (profileId: string, refresh?: boolean) => Promise<Result<AIProviderInfo[]>>
        configureProvider: (payload: { profileId: string; providerId: AIProviderId; apiKey: string }) => Promise<Result<{ configured: boolean; health: string; note?: string }>>
        removeProvider: (payload: { profileId: string; providerId: AIProviderId }) => Promise<Result<{ configured: boolean }>>
        testProvider: (payload: { profileId: string; providerId: AIProviderId }) => Promise<Result<{ health: string; note?: string }>>
        getConfig: (profileId: string) => Promise<Result<ProfileAIConfig | null>>
        updateConfig: (payload: { profileId: string; patch: Partial<ProfileAIConfig> }) => Promise<Result<ProfileAIConfig>>
        gatewayInfo: (profileId: string) => Promise<Result<GatewayInfo>>
        connectPremium: (payload: { profileId: string; apiKey: string }) => Promise<Result<PremiumResult>>
        disconnectPremium: (profileId: string) => Promise<Result<PremiumResult>>
      }
      agent: {
        start: (payload: { profileId: string; taskId: string; instruction: string; mode?: 'ask' | 'assist' | 'agent'; privateMode?: boolean; model?: string; page?: { url: string; title: string } }) => Promise<Result<{ taskId: string; status: string }>>
        cancel: (payload: { profileId: string; taskId: string }) => Promise<Result<{ cancelled: boolean }>>
        pause: (payload: { profileId: string; taskId: string }) => Promise<Result<{ paused: boolean }>>
        resume: (payload: { profileId: string; taskId: string }) => Promise<Result<{ resumed: boolean }>>
        permission: (payload: { profileId: string; taskId: string; stepId: string; decision: 'allow' | 'deny' }) => Promise<Result<{ ok: boolean }>>
        toolResult: (payload: { profileId: string; taskId: string; stepId: string; ok: boolean; observation: string; page?: { url: string; title: string }; error?: string }) => Promise<Result<{ ok: boolean }>>
        history: (profileId: string) => Promise<Result<AgentTaskHistoryEntry[]>>
        onEvent: (cb: (event: AgentEvent) => void) => () => void
      }
      extensions: {
        list: (profileId: string) => Promise<Result<ExtensionInfo[]>>
        get: (payload: { profileId: string; extensionId: string }) => Promise<Result<ExtensionInfo | null>>
        pickFolder: (profileId: string) => Promise<Result<{ cancelled: boolean; path?: string; ok?: boolean; error?: string; preview?: ExtensionPreview }>>
        install: (payload: { profileId: string; path: string }) => Promise<Result<{ ok: boolean; info?: ExtensionInfo; error?: string }>>
        remove: (payload: { profileId: string; extensionId: string }) => Promise<Result<{ ok: boolean }>>
        setEnabled: (payload: { profileId: string; extensionId: string; enabled: boolean }) => Promise<Result<{ ok: boolean; info?: ExtensionInfo; error?: string }>>
        setPrivate: (payload: { profileId: string; extensionId: string; enabled: boolean }) => Promise<Result<{ ok: boolean; info?: ExtensionInfo }>>
        setSiteAccess: (payload: { profileId: string; extensionId: string; mode: SiteAccessMode }) => Promise<Result<{ ok: boolean; info?: ExtensionInfo }>>
        onEvent: (cb: (event: { type: 'list'; profileId: string; items: ExtensionInfo[] }) => void) => () => void
      }
      shell: { openExternal: (url: string) => Promise<Result<boolean>> }
      secureStorage: { available: () => Promise<Result<{ available: boolean }>> }
      passwordManager: {
        status: (profileId: string) => Promise<Result<{ exists: boolean; unlocked: boolean }>>
        create: (payload: unknown) => Promise<Result<{ unlocked: boolean; credentials: unknown[] }>>
        unlock: (payload: unknown) => Promise<Result<{ unlocked: boolean; credentials: unknown[] }>>
        lock: (profileId: string) => Promise<Result<{ unlocked: boolean }>>
        list: (profileId: string) => Promise<Result<unknown[]>>
        reveal: (payload: unknown) => Promise<Result<{ password: string }>>
        saveCredential: (payload: unknown) => Promise<Result<unknown>>
        updateCredential: (payload: unknown) => Promise<Result<unknown[]>>
        deleteCredential: (payload: unknown) => Promise<Result<unknown[]>>
        copySecret: (payload: unknown) => Promise<Result<boolean>>
        generate: (payload: unknown) => Promise<Result<{ value: string }>>
        autofill: (payload: {
          profileId: string
          credentialId: string
          webContentsId: number
          usernameEid?: string
          passwordEid: string
          mode: 'ask' | 'assist' | 'agent'
        }) => Promise<Result<{ filled: boolean }>>
      }
      privacy: {
        diagnose: (payload: { profileId: string; url?: string; webContentsId?: number }) => Promise<
          Result<{
            interfaces: { address: string; family: string; internal: boolean }[]
            dnsServers: string[]
            cookieCount: number | null
            liveUrl: string
          }>
        >
      }
      drive: {
        getStatus: (payload: { profileId: string }) => Promise<Result<import('@shared/drive').DriveConnectionMeta>>
        connect: (payload: { profileId: string }) => Promise<Result<import('@shared/drive').DriveConnectionMeta>>
        disconnect: (payload: { profileId: string }) => Promise<Result<import('@shared/drive').DriveConnectionMeta>>
        list: (payload: {
          profileId: string
          category?: 'my-drive' | 'shared' | 'recent' | 'folder'
          folderId?: string
          pageToken?: string
        }) => Promise<Result<import('@shared/drive').DriveListPage>>
        search: (payload: { profileId: string; query: string; pageToken?: string }) => Promise<
          Result<import('@shared/drive').DriveListPage>
        >
        download: (payload: { profileId: string; fileId: string; isPrivate?: boolean }) => Promise<
          Result<{ id: string; filename: string } | { export: 'EXPORT_NOT_SUPPORTED' }>
        >
      }
      turbo: {
        preconnect: (payload: { profileId: string; url: string }) => Promise<Result<{ preconnected: boolean }>>
      }
      regional: {
        apply: (payload: { profileId: string }) => Promise<Result<import('@shared/regional').RegionalCapabilityReport>>
      }
      bookmarks: {
        load: (profileId: string) => Promise<Result<BookmarkStore>>
        create: (payload: unknown) => Promise<Result<BookmarkStore>>
        createFolder: (payload: unknown) => Promise<Result<BookmarkStore>>
        update: (payload: unknown) => Promise<Result<BookmarkStore>>
        remove: (payload: unknown) => Promise<Result<BookmarkStore>>
        move: (payload: unknown) => Promise<Result<BookmarkStore>>
        reorder: (payload: unknown) => Promise<Result<BookmarkStore>>
        importFile: (profileId: string) => Promise<Result<{ imported: number; store: BookmarkStore }>>
        exportFile: (profileId: string) => Promise<Result<{ saved: boolean }>>
      }
      history: {
        query: (payload: unknown) => Promise<Result<HistoryEntry[]>>
        record: (payload: unknown) => Promise<Result<{ recorded: boolean }>>
        remove: (payload: unknown) => Promise<Result<boolean>>
        clear: (payload: unknown) => Promise<Result<boolean>>
      }
      collections: {
        load: (profileId: string) => Promise<Result<CollectionStore>>
        create: (payload: unknown) => Promise<Result<CollectionStore>>
        rename: (payload: unknown) => Promise<Result<CollectionStore>>
        remove: (payload: unknown) => Promise<Result<CollectionStore>>
        addItem: (payload: unknown) => Promise<Result<CollectionStore>>
        removeItem: (payload: unknown) => Promise<Result<CollectionStore>>
        reorderItem: (payload: unknown) => Promise<Result<CollectionStore>>
      }
    }
  }
}

export {}

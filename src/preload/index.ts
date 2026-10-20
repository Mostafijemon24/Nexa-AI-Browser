import { contextBridge, ipcRenderer } from 'electron'
import { channels } from '../shared/channels'

const nexa = {
  app: {
    info: () => ipcRenderer.invoke(channels.appInfo)
  },
  window: {
    minimize: () => ipcRenderer.invoke(channels.windowMin),
    maximize: () => ipcRenderer.invoke(channels.windowMax),
    close: () => ipcRenderer.invoke(channels.windowClose)
  },
  settings: {
    load: () => ipcRenderer.invoke(channels.loadState),
    saveGlobal: (payload: unknown) => ipcRenderer.invoke(channels.saveGlobal, payload),
    saveProfile: (payload: unknown) => ipcRenderer.invoke(channels.saveProfile, payload),
    saveProfilesIndex: (payload: unknown) => ipcRenderer.invoke(channels.saveProfilesIndex, payload),
    saveSession: (payload: unknown) => ipcRenderer.invoke(channels.saveSession, payload)
  },
  downloads: {
    pickDirectory: () => ipcRenderer.invoke(channels.pickDirectory),
    list: (profileId: string) => ipcRenderer.invoke(channels.dlList, { profileId }),
    get: (payload: unknown) => ipcRenderer.invoke(channels.dlGet, payload),
    pause: (payload: unknown) => ipcRenderer.invoke(channels.dlPause, payload),
    resume: (payload: unknown) => ipcRenderer.invoke(channels.dlResume, payload),
    cancel: (payload: unknown) => ipcRenderer.invoke(channels.dlCancel, payload),
    retry: (payload: unknown) => ipcRenderer.invoke(channels.dlRetry, payload),
    remove: (payload: unknown) => ipcRenderer.invoke(channels.dlRemove, payload),
    clearCompleted: (profileId: string) => ipcRenderer.invoke(channels.dlClearCompleted, { profileId }),
    clearFailed: (profileId: string) => ipcRenderer.invoke(channels.dlClearFailed, { profileId }),
    open: (payload: unknown) => ipcRenderer.invoke(channels.dlOpen, payload),
    showInFolder: (payload: unknown) => ipcRenderer.invoke(channels.dlShowInFolder, payload),
    copyUrl: (payload: unknown) => ipcRenderer.invoke(channels.dlCopyUrl, payload),
    pauseAll: (profileId: string) => ipcRenderer.invoke(channels.dlPauseAll, { profileId }),
    resumeAll: (profileId: string) => ipcRenderer.invoke(channels.dlResumeAll, { profileId }),
    openFolder: (profileId: string) => ipcRenderer.invoke(channels.dlOpenFolder, { profileId }),
    getSettings: (profileId: string) => ipcRenderer.invoke(channels.dlGetSettings, { profileId }),
    saveSettings: (payload: unknown) => ipcRenderer.invoke(channels.dlSaveSettings, payload),
    onEvent: (cb: (event: unknown) => void) => {
      const listener = (_e: unknown, event: unknown) => cb(event)
      ipcRenderer.on(channels.dlEvent, listener)
      return () => ipcRenderer.removeListener(channels.dlEvent, listener)
    }
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke(channels.openExternal, { url })
  },
  secureStorage: {
    available: () => ipcRenderer.invoke(channels.secureAvailable)
  },
  passwordManager: {
    status: (profileId: string) => ipcRenderer.invoke(channels.vaultStatus, profileId),
    create: (payload: unknown) => ipcRenderer.invoke(channels.vaultCreate, payload),
    unlock: (payload: unknown) => ipcRenderer.invoke(channels.vaultUnlock, payload),
    lock: (profileId: string) => ipcRenderer.invoke(channels.vaultLock, profileId),
    list: (profileId: string) => ipcRenderer.invoke(channels.vaultList, profileId),
    reveal: (payload: unknown) => ipcRenderer.invoke(channels.vaultReveal, payload),
    saveCredential: (payload: unknown) => ipcRenderer.invoke(channels.vaultSave, payload),
    updateCredential: (payload: unknown) => ipcRenderer.invoke(channels.vaultUpdate, payload),
    deleteCredential: (payload: unknown) => ipcRenderer.invoke(channels.vaultDelete, payload),
    copySecret: (payload: unknown) => ipcRenderer.invoke(channels.vaultCopy, payload),
    generate: (payload: unknown) => ipcRenderer.invoke(channels.vaultGenerate, payload),
    // Secure autofill: request-only. Returns { filled } — never a secret.
    autofill: (payload: unknown) => ipcRenderer.invoke(channels.vaultAutofill, payload)
  },
  privacy: {
    // Bounded local network diagnostics. Returns safe metadata only.
    diagnose: (payload: unknown) => ipcRenderer.invoke(channels.privacyDiagnose, payload)
  },
  drive: {
    // Read/download only. All auth + tokens stay in main; renderer gets safe metadata.
    getStatus: (payload: unknown) => ipcRenderer.invoke(channels.driveStatus, payload),
    connect: (payload: unknown) => ipcRenderer.invoke(channels.driveConnect, payload),
    disconnect: (payload: unknown) => ipcRenderer.invoke(channels.driveDisconnect, payload),
    list: (payload: unknown) => ipcRenderer.invoke(channels.driveList, payload),
    search: (payload: unknown) => ipcRenderer.invoke(channels.driveSearch, payload),
    download: (payload: unknown) => ipcRenderer.invoke(channels.driveDownload, payload)
  },
  turbo: {
    // Safe navigation prediction only. Cannot fetch/exec/read; main validates.
    preconnect: (payload: unknown) => ipcRenderer.invoke(channels.turboPreconnect, payload)
  },
  regional: {
    // Applies the active profile's Accept-Language at the session level. Prefs
    // persist via saveProfilePrefs. No generic header/network mutation.
    apply: (payload: unknown) => ipcRenderer.invoke(channels.regionalApply, payload)
  },
  vpn: {
    getStatus: (profileId: string) => ipcRenderer.invoke(channels.vpnGetStatus, { profileId }),
    connect: (profileId: string) => ipcRenderer.invoke(channels.vpnConnect, { profileId }),
    disconnect: (profileId: string) => ipcRenderer.invoke(channels.vpnDisconnect, { profileId }),
    reconnect: (profileId: string) => ipcRenderer.invoke(channels.vpnReconnect, { profileId }),
    importConfig: (payload: unknown) => ipcRenderer.invoke(channels.vpnImportConfig, payload),
    removeConfig: (payload: unknown) => ipcRenderer.invoke(channels.vpnRemoveConfig, payload),
    getServers: (profileId: string) => ipcRenderer.invoke(channels.vpnGetServers, { profileId }),
    selectServer: (payload: unknown) => ipcRenderer.invoke(channels.vpnSelectServer, payload),
    getSettings: (profileId: string) => ipcRenderer.invoke(channels.vpnGetSettings, { profileId }),
    updateSettings: (payload: unknown) => ipcRenderer.invoke(channels.vpnUpdateSettings, payload),
    getStatistics: (profileId: string) => ipcRenderer.invoke(channels.vpnGetStatistics, { profileId }),
    onEvent: (cb: (event: unknown) => void) => {
      const listener = (_e: unknown, event: unknown) => cb(event)
      ipcRenderer.on(channels.vpnEvent, listener)
      return () => ipcRenderer.removeListener(channels.vpnEvent, listener)
    }
  },
  ai: {
    status: (profileId: string) => ipcRenderer.invoke(channels.aiStatus, { profileId }),
    models: (profileId: string) => ipcRenderer.invoke(channels.aiModels, { profileId }),
    testConnection: (profileId: string) => ipcRenderer.invoke(channels.aiTest, { profileId }),
    getSettings: (profileId: string) => ipcRenderer.invoke(channels.aiGetSettings, { profileId }),
    selectModel: (payload: unknown) => ipcRenderer.invoke(channels.aiSelectModel, payload),
    chat: (payload: unknown) => ipcRenderer.invoke(channels.aiChat, payload),
    cancel: (payload: unknown) => ipcRenderer.invoke(channels.aiCancel, payload),
    embed: (payload: unknown) => ipcRenderer.invoke(channels.aiEmbed, payload),
    visionStatus: (payload: unknown) => ipcRenderer.invoke(channels.aiVisionStatus, payload),
    visionAnalyze: (payload: unknown) => ipcRenderer.invoke(channels.aiVisionAnalyze, payload),
    // STEP 12 — multi-provider metadata (no secrets ever cross this bridge).
    providers: (profileId: string, refresh?: boolean) => ipcRenderer.invoke(channels.aiProviders, { profileId, refresh }),
    configureProvider: (payload: unknown) => ipcRenderer.invoke(channels.aiProviderConfigure, payload),
    removeProvider: (payload: unknown) => ipcRenderer.invoke(channels.aiProviderRemove, payload),
    testProvider: (payload: unknown) => ipcRenderer.invoke(channels.aiProviderTest, payload),
    getConfig: (profileId: string) => ipcRenderer.invoke(channels.aiConfigGet, { profileId }),
    updateConfig: (payload: unknown) => ipcRenderer.invoke(channels.aiConfigUpdate, payload),
    gatewayInfo: (profileId: string) => ipcRenderer.invoke(channels.aiGatewayInfo, { profileId }),
    connectPremium: (payload: unknown) => ipcRenderer.invoke(channels.aiPremiumConnect, payload),
    disconnectPremium: (profileId: string) => ipcRenderer.invoke(channels.aiPremiumDisconnect, { profileId }),
    onEvent: (cb: (event: unknown) => void) => {
      const listener = (_e: unknown, event: unknown) => cb(event)
      ipcRenderer.on(channels.aiEvent, listener)
      return () => ipcRenderer.removeListener(channels.aiEvent, listener)
    }
  },
  agent: {
    start: (payload: unknown) => ipcRenderer.invoke(channels.agentStart, payload),
    cancel: (payload: unknown) => ipcRenderer.invoke(channels.agentCancel, payload),
    pause: (payload: unknown) => ipcRenderer.invoke(channels.agentPause, payload),
    resume: (payload: unknown) => ipcRenderer.invoke(channels.agentResume, payload),
    permission: (payload: unknown) => ipcRenderer.invoke(channels.agentPermission, payload),
    toolResult: (payload: unknown) => ipcRenderer.invoke(channels.agentToolResult, payload),
    history: (profileId: string) => ipcRenderer.invoke(channels.agentHistory, { profileId }),
    onEvent: (cb: (event: unknown) => void) => {
      const listener = (_e: unknown, event: unknown) => cb(event)
      ipcRenderer.on(channels.agentEvent, listener)
      return () => ipcRenderer.removeListener(channels.agentEvent, listener)
    }
  },
  // STEP 13 — Extensions: capability-specific, metadata-only bridge. No generic
  // execute/invoke/fetch/fs/shell. Identity is resolved main-side.
  extensions: {
    list: (profileId: string) => ipcRenderer.invoke(channels.extList, { profileId }),
    get: (payload: unknown) => ipcRenderer.invoke(channels.extGet, payload),
    pickFolder: (profileId: string) => ipcRenderer.invoke(channels.extPickFolder, { profileId }),
    install: (payload: unknown) => ipcRenderer.invoke(channels.extInstall, payload),
    remove: (payload: unknown) => ipcRenderer.invoke(channels.extRemove, payload),
    setEnabled: (payload: unknown) => ipcRenderer.invoke(channels.extSetEnabled, payload),
    setPrivate: (payload: unknown) => ipcRenderer.invoke(channels.extSetPrivate, payload),
    setSiteAccess: (payload: unknown) => ipcRenderer.invoke(channels.extSetSiteAccess, payload),
    onEvent: (cb: (event: unknown) => void) => {
      const listener = (_e: unknown, event: unknown) => cb(event)
      ipcRenderer.on(channels.extEvent, listener)
      return () => ipcRenderer.removeListener(channels.extEvent, listener)
    }
  },
  protection: {
    getState: (profileId: string) => ipcRenderer.invoke(channels.protGetState, { profileId }),
    getStats: (payload: unknown) => ipcRenderer.invoke(channels.protGetStats, payload),
    getSettings: (profileId: string) => ipcRenderer.invoke(channels.protGetSettings, { profileId }),
    saveSettings: (payload: unknown) => ipcRenderer.invoke(channels.protSaveSettings, payload),
    setEnabled: (payload: unknown) => ipcRenderer.invoke(channels.protSetEnabled, payload),
    getSiteState: (payload: unknown) => ipcRenderer.invoke(channels.protGetSiteState, payload),
    setSiteEnabled: (payload: unknown) => ipcRenderer.invoke(channels.protSetSiteEnabled, payload),
    addAllow: (payload: unknown) => ipcRenderer.invoke(channels.protAddAllow, payload),
    removeAllow: (payload: unknown) => ipcRenderer.invoke(channels.protRemoveAllow, payload),
    addBlock: (payload: unknown) => ipcRenderer.invoke(channels.protAddBlock, payload),
    removeBlock: (payload: unknown) => ipcRenderer.invoke(channels.protRemoveBlock, payload),
    getRules: (profileId: string) => ipcRenderer.invoke(channels.protGetRules, { profileId }),
    resetStats: (payload: unknown) => ipcRenderer.invoke(channels.protResetStats, payload),
    onEvent: (cb: (event: unknown) => void) => {
      const listener = (_e: unknown, event: unknown) => cb(event)
      ipcRenderer.on(channels.protEvent, listener)
      return () => ipcRenderer.removeListener(channels.protEvent, listener)
    }
  },
  bookmarks: {
    load: (profileId: string) => ipcRenderer.invoke(channels.bmLoad, profileId),
    create: (payload: unknown) => ipcRenderer.invoke(channels.bmCreate, payload),
    createFolder: (payload: unknown) => ipcRenderer.invoke(channels.bmCreateFolder, payload),
    update: (payload: unknown) => ipcRenderer.invoke(channels.bmUpdate, payload),
    remove: (payload: unknown) => ipcRenderer.invoke(channels.bmDelete, payload),
    move: (payload: unknown) => ipcRenderer.invoke(channels.bmMove, payload),
    reorder: (payload: unknown) => ipcRenderer.invoke(channels.bmReorder, payload),
    importFile: (profileId: string) => ipcRenderer.invoke(channels.bmImport, profileId),
    exportFile: (profileId: string) => ipcRenderer.invoke(channels.bmExport, profileId)
  },
  history: {
    query: (payload: unknown) => ipcRenderer.invoke(channels.histQuery, payload),
    record: (payload: unknown) => ipcRenderer.invoke(channels.histRecord, payload),
    remove: (payload: unknown) => ipcRenderer.invoke(channels.histDelete, payload),
    clear: (payload: unknown) => ipcRenderer.invoke(channels.histClear, payload)
  },
  collections: {
    load: (profileId: string) => ipcRenderer.invoke(channels.colLoad, profileId),
    create: (payload: unknown) => ipcRenderer.invoke(channels.colCreate, payload),
    rename: (payload: unknown) => ipcRenderer.invoke(channels.colRename, payload),
    remove: (payload: unknown) => ipcRenderer.invoke(channels.colDelete, payload),
    addItem: (payload: unknown) => ipcRenderer.invoke(channels.colAddItem, payload),
    removeItem: (payload: unknown) => ipcRenderer.invoke(channels.colRemoveItem, payload),
    reorderItem: (payload: unknown) => ipcRenderer.invoke(channels.colReorderItem, payload)
  }
}

contextBridge.exposeInMainWorld('nexa', nexa)

export type NexaApi = typeof nexa

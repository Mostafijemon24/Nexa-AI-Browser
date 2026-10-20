import { app, BrowserWindow, powerMonitor, session, shell } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPlatformAdapter } from '../platform'
import { Persistence } from './services/persistence'
import { SecureStorage } from './services/secure-storage'
import { VaultService } from './services/vault'
import { Library } from './services/library'
import { DownloadService } from './services/downloads'
import { DriveService } from './services/drive'
import { RegionalService } from './services/regional'
import { ExtensionService } from './services/extensions'
import { ProtectionService } from './services/protection'
import { VpnService } from './services/vpn'
import { AIService } from './services/ai'
import { AIProviderRegistry } from './services/ai-registry'
import { GatewayClient, resolveGatewayUrl } from './services/ai-gateway-client'
import { AgentService, createAIPlanner } from './services/agent'
import { IpcAgentToolHost } from './services/agent-ipc-host'
import { vpnPlatformKind } from './services/vpn-platform'
import { HelperVpnAdapter } from './services/vpn-helper/adapter'
import { createProductionHelperClient } from './services/vpn-helper/install'
import { registerIpc } from './ipc/register'
import { channels } from '../shared/channels'
import { applyPermissionPolicy } from './security/permissions'
import { persistPartition, privatePartition } from '../shared/permissions'

const here = dirname(fileURLToPath(import.meta.url))

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
  "form-action 'self'"
].join('; ')

let mainWindow: BrowserWindow | null = null

function appInfo() {
  return {
    name: 'NEXA',
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    // Honest release channel: packaged builds report 'stable', dev runs 'dev'.
    channel: (app.isPackaged ? 'stable' : 'dev') as 'stable' | 'dev'
  }
}

function preloadPath() {
  for (const name of ['index.js', 'index.mjs', 'index.cjs']) {
    const p = join(here, '../preload', name)
    if (existsSync(p)) return p
  }
  return join(here, '../preload/index.js')
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#e8eaed',
    title: 'NEXA',
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: true,
      spellcheck: true
    }
  })

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const isAppFrame = details.resourceType === 'mainFrame' && !details.url.startsWith('https://') && !details.url.startsWith('http://')
    if (isAppFrame) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [CSP]
        }
      })
      return
    }
    callback({ responseHeaders: details.responseHeaders })
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('https:') || details.url.startsWith('http:')) {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(here, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('org.nexa.browser')

  // SEC-1: deny-by-default permission policy. Applied to defaultSession here and
  // to every profile partition (persistent + private) in attachAll(), so tab
  // content can never fall back to Electron's permissive defaults.
  applyPermissionPolicy(session.defaultSession)

  // SEC: Electron hardening checklist — enforce webview webPreferences,
  // confine the app shell, and route new-window requests to the OS browser.
  app.on('web-contents-created', (_e, contents) => {
    // Lock down every <webview> the app shell creates: no Node, isolated,
    // sandboxed, and no app-side preload can be injected via a guest attribute.
    contents.on('will-attach-webview', (_evt, webPreferences, params) => {
      delete (webPreferences as { preload?: string }).preload
      delete (webPreferences as { preloadURL?: string }).preloadURL
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      ;(webPreferences as { sandbox?: boolean }).sandbox = true
      // Guests may only ever be pointed at http(s) content.
      const src = typeof params.src === 'string' ? params.src : ''
      if (src && !/^https?:\/\//i.test(src)) params.src = 'about:blank'
    })
    // The app shell itself must never navigate away from its own bundle (a
    // stray link or injected navigation opens externally instead). Guest
    // <webview> contents are a separate type and keep full navigation.
    contents.on('will-navigate', (evt, url) => {
      if (contents.getType() === 'webview') return
      const devUrl = process.env.ELECTRON_RENDERER_URL
      const inShell = url.startsWith('file://') || (!!devUrl && url.startsWith(devUrl))
      if (!inShell) {
        evt.preventDefault()
        if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
      }
    })
    // Deny in-app popups everywhere; hand http(s) targets to the OS browser.
    contents.setWindowOpenHandler((details) => {
      if (details.url.startsWith('https://') || details.url.startsWith('http://')) void shell.openExternal(details.url)
      return { action: 'deny' }
    })
  })

  const platform = createPlatformAdapter()
  const persist = new Persistence(platform)
  const secure = new SecureStorage()
  const vault = new VaultService(persist, secure)
  const library = new Library(persist)
  const downloads = new DownloadService(
    persist,
    (title, body) => platform.notify(title, body),
    (event) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.webContents.send(channels.dlEvent, event)
    }
  )
  const protection = new ProtectionService(persist, (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(channels.protEvent, event)
  })
  // P4.2: all privileged VPN ops go through the PRODUCTION helper transport
  // (unix domain socket / Windows named pipe) to the installed privileged
  // helper. If no signed helper is installed, the client honestly reports
  // NOT_CONFIGURED — it never falls back to a fake/simulated capability.
  // Installing + signing the helper is documented in
  // NEXA_P4_2_SIGNING_AND_INSTALLER.md.
  const vpnHelper = createProductionHelperClient(vpnPlatformKind())
  const vpnAdapter = new HelperVpnAdapter(vpnPlatformKind(), vpnHelper)
  const vpn = new VpnService(
    persist,
    secure,
    (event) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.webContents.send(channels.vpnEvent, event)
    },
    { adapter: vpnAdapter, helper: vpnHelper }
  )
  // Multi-provider AI. Default: NEXA Free AI via the NEXA AI Gateway (no
  // provider key on this machine — the gateway holds it server-side), with
  // local Ollama as the only fallback. Optional OpenAI/Anthropic keys stay in
  // SecureStorage. The registry owns routing/health/config.
  const aiGateway = new GatewayClient({
    baseUrl: resolveGatewayUrl({ packaged: app.isPackaged }),
    allowLoopbackHttp: !app.isPackaged,
    secure,
    platform: process.platform,
    appVersion: app.getVersion()
  })
  const aiRegistry = new AIProviderRegistry(persist, secure, { gateway: aiGateway })
  // Local AI + provider router: main-process only. Streams to renderer.
  const ai = new AIService(
    persist,
    (event) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.webContents.send(channels.aiEvent, event)
    },
    { registry: aiRegistry }
  )
  // Browser Agent (P5.1): main-process orchestrator. The AI plans (via AIService),
  // NEXA authorizes (PermissionEngine), Chromium acts (via the renderer tool host).
  const sendAgentEvent = (event: import('../shared/agent').AgentEvent): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(channels.agentEvent, event)
  }
  const agentHost = new IpcAgentToolHost(sendAgentEvent)
  const agent = new AgentService(createAIPlanner(ai), agentHost, sendAgentEvent)
  // STEP 8: Google Drive provider. Owns OAuth + tokens in main; hands downloads to
  // the EXISTING P2 engine (downloads.enqueueUrl). No second download manager.
  const drive = new DriveService(secure, persist, (a) => downloads.enqueueUrl(a))
  // STEP 10: per-profile regional prefs → session Accept-Language (only real
  // browser-level action). Timezone/locale runtime stay honest (process-global).
  const regional = new RegionalService(persist)
  // STEP 13: Browser extensions. Drives the REAL Chromium runtime via
  // session.extensions on the existing per-profile partitions. Metadata-only to
  // the renderer; identity resolved main-side; failure-isolated.
  const extensions = new ExtensionService(persist, (event) => {
    mainWindow?.webContents.send(channels.extEvent, event)
  })
  // Re-validate active tunnels after the machine wakes from sleep.
  try {
    powerMonitor.on('resume', () => {
      const ids = Object.keys(persist.loadProfilesIndex().profiles)
      for (const id of ids) void vpn.revalidate(id)
    })
  } catch {
    /* powerMonitor unavailable */
  }
  // Attach session listeners (downloads + protection) on every profile partition.
  const attachAll = () => {
    try {
      const ids = Object.keys(persist.loadProfilesIndex().profiles)
      // SEC-1: enforce NEXA's permission policy on the exact partitions tabs use.
      for (const id of ids) {
        try {
          applyPermissionPolicy(session.fromPartition(persistPartition(id)))
          applyPermissionPolicy(session.fromPartition(privatePartition(id)))
        } catch {
          /* per-profile session unavailable; skip */
        }
      }
      downloads.attachForProfiles(ids)
      protection.attachForProfiles(ids)
      regional.applyForProfiles(ids)
      extensions.applyForProfiles(ids)
    } catch {
      /* ignore */
    }
  }
  attachAll()

  registerIpc({
    getWindow: () => mainWindow,
    persist,
    secure,
    vault,
    library,
    downloads,
    protection,
    vpn,
    ai,
    agent,
    agentHost,
    drive,
    regional,
    extensions,
    onProfilesChanged: attachAll,
    appInfo
  })

  createWindow()

  app.on('before-quit', () => {
    void vpn.shutdown()
    ai.dispose()
    agent.dispose()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

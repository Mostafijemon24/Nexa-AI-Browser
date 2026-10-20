import { BrowserWindow, dialog, ipcMain, session as electronSession, shell, webContents as electronWebContents } from 'electron'
import { preconnectTarget } from '../../shared/turbo'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  channels,
  credentialDraftSchema,
  credentialIdSchema,
  credentialUpdateSchema,
  generateSchema,
  masterPasswordSchema,
  vaultAutofillSchema,
  privacyDiagnoseSchema,
  driveProfileSchema,
  driveListSchema,
  driveSearchSchema,
  driveDownloadSchema,
  turboPreconnectSchema,
  regionalApplySchema,
  ok,
  openExternalSchema,
  profileIdSchema,
  safeError,
  saveGlobalSchema,
  saveProfileSchema,
  saveProfilesIndexSchema,
  saveSessionSchema,
  bmCreateSchema,
  bmCreateFolderSchema,
  bmUpdateSchema,
  bmIdSchema,
  bmMoveSchema,
  bmReorderSchema,
  histQuerySchema,
  histRecordSchema,
  histDeleteSchema,
  histClearSchema,
  colCreateSchema,
  colRenameSchema,
  colIdSchema,
  colAddItemSchema,
  colRemoveItemSchema,
  colReorderItemSchema,
  dlIdSchema,
  dlProfileSchema,
  dlSaveSettingsSchema,
  protProfileSchema,
  protStatsSchema,
  protSiteQuerySchema,
  protSetEnabledSchema,
  protDomainSchema,
  protSiteEnabledSchema,
  protectionSettingsSchema,
  vpnImportSchema,
  vpnServerIdSchema,
  vpnProfileSchema,
  vpnSettingsSchema
} from '../../shared/ipc'
import {
  aiProfileSchema,
  aiChatSchema,
  aiCancelSchema,
  aiEmbedSchema,
  aiVisionStatusSchema,
  aiVisionAnalyzeSchema,
  aiSelectModelSchema,
  aiErrorMessage
} from '../../shared/ai'
import {
  aiProvidersListSchema,
  aiProviderConfigureSchema,
  aiProviderRefSchema,
  aiPremiumConnectSchema,
  aiConfigUpdateSchema
} from '../../shared/ai-providers'
import {
  agentStartSchema,
  agentControlSchema,
  agentPermissionSchema,
  agentToolResultSchema,
  agentErrorMessage
} from '../../shared/agent'
import type { AgentService } from '../services/agent'
import type { IpcAgentToolHost } from '../services/agent-ipc-host'
import type { Profile, ProfilePrefs, SessionState } from '../../shared/types'
import type { Persistence } from '../services/persistence'
import type { SecureStorage } from '../services/secure-storage'
import type { Library } from '../services/library'
import type { DownloadService } from '../services/downloads'
import type { ProtectionService } from '../services/protection'
import type { VpnService } from '../services/vpn'
import type { AIService } from '../services/ai'
import type { DriveService } from '../services/drive'
import type { RegionalService } from '../services/regional'
import type { ExtensionService } from '../services/extensions'
import { extListSchema, extInstallSchema, extRefSchema, extEnableSchema, extPrivateSchema, extSiteAccessSchema } from '../../shared/extensions'
import { networkInterfaces } from 'node:os'
import { getServers as dnsGetServers } from 'node:dns'
import { generatePassword, VaultService } from '../services/vault'
import { isEligibleOrigin, matchCredentialOrigin } from '../../shared/vault-autofill'
import { friendlyVpnError } from '../../shared/vpn'
import { assertSafeProfileId } from '../../platform'

/**
 * Inject a credential into the live guest page via a FIXED (non-model) snippet
 * executed on the guest webContents from the MAIN process. The secret is only
 * ever embedded in the code string in main memory and set on the target field;
 * it never crosses back to the embedder renderer, the AI, or any readable IPC.
 * Targets are resolved by the existing observation ephemeral eid. Never submits.
 */
async function injectCredential(
  guest: Electron.WebContents,
  args: { usernameEid?: string; passwordEid: string; username: string; secret: string }
): Promise<boolean> {
  const code = `(() => { try {
    var setVal = function(eid, val){
      if(!eid) return false;
      var el = document.querySelector('[data-nx-eid="' + String(eid).replace(/[^a-z0-9_]/gi,'') + '"]');
      if(!el) return false;
      el.focus();
      var proto = el.tagName==='TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      var d = Object.getOwnPropertyDescriptor(proto,'value');
      if(d && d.set) d.set.call(el, val); else el.value = val;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    };
    var u = setVal(${JSON.stringify(args.usernameEid || '')}, ${JSON.stringify(args.username || '')});
    var p = setVal(${JSON.stringify(args.passwordEid)}, ${JSON.stringify(args.secret)});
    return JSON.stringify({ u: u, p: p });
  } catch(e){ return JSON.stringify({ u:false, p:false }); } })()`
  let filled = false
  try {
    const out = await guest.executeJavaScript(code, true)
    const r = JSON.parse(String(out || '{}')) as { u?: boolean; p?: boolean }
    filled = !!r.p
  } catch {
    filled = false
  }
  // The secret is referenced only by `code`; it goes out of scope on return.
  return filled
}

function wrap(fn: (...args: unknown[]) => unknown) {
  return async (_e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      return await fn(...args)
    } catch (err) {
      const code = err instanceof Error ? err.message : 'internal'
      // VPN / WireGuard errors: sanitized, user-facing messages.
      const configParse = new Set([
        'invalid_config',
        'malformed_line',
        'missing_interface',
        'missing_peer',
        'invalid_private_key',
        'invalid_public_key',
        'invalid_preshared_key',
        'invalid_endpoint',
        'invalid_address',
        'invalid_dns',
        'invalid_mtu',
        'invalid_allowed_ips',
        'invalid_keepalive'
      ])
      const vpnCodes = new Set([
        'wg_unavailable',
        'no_server',
        'no_config',
        'permission_denied',
        'handshake_timeout',
        'interface_failed',
        'route_failed',
        'dns_failed',
        'endpoint_unreachable',
        'busy',
        'teardown_failed'
      ])
      if (configParse.has(code)) return safeError('invalid_config', friendlyVpnError('invalid_config'))
      if (vpnCodes.has(code)) return safeError(code, friendlyVpnError(code))
      const aiCodes = new Set([
        'ollama_offline',
        'model_not_installed',
        'bad_response',
        'timeout',
        'cancelled',
        'invalid_model',
        'invalid_request_id',
        'busy'
      ])
      if (aiCodes.has(code)) return safeError(code, aiErrorMessage(code))
      const agentCodes = new Set([
        'unknown_tool',
        'not_configured',
        'capability_unavailable',
        'invalid_arguments',
        'arguments_too_large',
        'invalid_tool_call',
        'no_tool_call',
        'invalid_json',
        'max_steps',
        'no_progress',
        'task_timeout',
        'permission_denied',
        'invalid_task_id',
        'invalid_step_id'
      ])
      if (agentCodes.has(code)) return safeError(code, agentErrorMessage(code))
      const allowed = new Set([
        'invalid_profile_id',
        'vault_exists',
        'vault_missing',
        'vault_locked',
        'incorrect_password',
        'tampered_vault',
        'not_found',
        'secure_storage_unavailable',
        'denied',
        'unsupported_scheme',
        'invalid_url',
        'retry_limit',
        'invalid_domain',
        'profile_mismatch',
        'vault_blocked_ask',
        'target_unavailable',
        'origin_ineligible',
        'origin_mismatch',
        'not_configured',
        'auth_required',
        'auth_expired',
        'invalid_file_id',
        'invalid_file',
        'is_folder'
      ])
      const message = allowed.has(code)
        ? code === 'incorrect_password'
          ? 'Incorrect master password'
          : code === 'denied'
            ? 'Blocked by security policy'
            : code === 'tampered_vault'
              ? 'Vault could not be opened'
              : code === 'invalid_url'
                ? 'That URL is not valid'
                : code === 'not_found'
                  ? 'Item not found'
                  : code === 'vault_blocked_ask'
                    ? 'Vault autofill is blocked in Ask mode'
                    : code === 'origin_mismatch'
                      ? 'This site does not match the saved credential'
                      : code === 'origin_ineligible'
                        ? 'Vault autofill is unavailable for this page'
                        : code === 'target_unavailable'
                          ? 'The login field could not be reached'
                          : code === 'profile_mismatch'
                            ? 'Profile mismatch'
                            : code === 'not_configured'
                              ? 'Google Drive is not configured'
                              : code === 'auth_required'
                                ? 'Connect Google Drive to continue'
                                : code === 'auth_expired'
                                  ? 'Your Google Drive connection needs attention'
                                  : code === 'is_folder'
                                    ? 'That item is a folder'
                                    : code === 'invalid_file_id' || code === 'invalid_file'
                                      ? 'That Drive file is not valid'
                                      : 'Request rejected'
        : 'Request rejected'
      return safeError(allowed.has(code) ? code : 'internal', message)
    }
  }
}

export function registerIpc(opts: {
  getWindow: () => BrowserWindow | null
  persist: Persistence
  secure: SecureStorage
  vault: VaultService
  library: Library
  downloads: DownloadService
  protection: ProtectionService
  vpn: VpnService
  ai: AIService
  agent: AgentService
  agentHost: IpcAgentToolHost
  drive: DriveService
  regional: RegionalService
  extensions: ExtensionService
  onProfilesChanged?: () => void
  appInfo: () => unknown
}) {
  const { persist, secure, vault, library, downloads, protection, vpn, ai, agent, agentHost, drive, regional, extensions } = opts

  ipcMain.handle(channels.appInfo, wrap(() => ok(opts.appInfo())))
  ipcMain.handle(channels.windowMin, wrap(() => {
    opts.getWindow()?.minimize()
    return ok(true)
  }))
  ipcMain.handle(channels.windowMax, wrap(() => {
    const w = opts.getWindow()
    if (!w) return ok(false)
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
    return ok(true)
  }))
  ipcMain.handle(channels.windowClose, wrap(() => {
    opts.getWindow()?.close()
    return ok(true)
  }))

  ipcMain.handle(
    channels.loadState,
    wrap(() => {
      const index = persist.loadProfilesIndex()
      const prefs = persist.loadProfilePrefs(index.activeProfile)
      const session = persist.loadSession(index.activeProfile)
      const global = persist.loadGlobal()
      return ok({
        global,
        index,
        prefs,
        session,
        vault: vault.status(index.activeProfile),
        secureAvailable: secure.available(),
        downloadsDir: persist.downloadsDir()
      })
    })
  )

  ipcMain.handle(
    channels.saveGlobal,
    wrap((raw) => {
      const data = saveGlobalSchema.parse(raw)
      persist.saveGlobal(data)
      return ok(true)
    })
  )

  ipcMain.handle(
    channels.saveProfile,
    wrap((raw) => {
      const data = saveProfileSchema.parse(raw)
      assertSafeProfileId(data.profileId)
      persist.saveProfilePrefs(data.profileId, data.prefs as unknown as ProfilePrefs)
      return ok(true)
    })
  )

  ipcMain.handle(
    channels.saveProfilesIndex,
    wrap((raw) => {
      const data = saveProfilesIndexSchema.parse(raw)
      persist.saveProfilesIndex(data.activeProfile, data.profiles as unknown as Record<string, Profile>)
      vault.lockAll()
      opts.onProfilesChanged?.()
      return ok({ vault: vault.status(data.activeProfile) })
    })
  )

  ipcMain.handle(
    channels.saveSession,
    wrap((raw) => {
      const data = saveSessionSchema.parse(raw)
      persist.saveSession(data.profileId, data.session as unknown as SessionState)
      return ok(true)
    })
  )

  ipcMain.handle(
    channels.pickDirectory,
    wrap(async () => {
      const w = opts.getWindow()
      const res = await dialog.showOpenDialog(w ?? undefined!, {
        properties: ['openDirectory', 'createDirectory']
      })
      if (res.canceled || !res.filePaths[0]) return ok(null)
      return ok(res.filePaths[0])
    })
  )

  ipcMain.handle(
    channels.openExternal,
    wrap(async (raw) => {
      const { url } = openExternalSchema.parse(raw)
      await shell.openExternal(url)
      return ok(true)
    })
  )

  ipcMain.handle(channels.secureAvailable, wrap(() => ok({ available: secure.available() })))

  ipcMain.handle(
    channels.vaultStatus,
    wrap((raw) => {
      const profileId = profileIdSchema.parse(raw)
      return ok(vault.status(profileId))
    })
  )

  ipcMain.handle(
    channels.vaultCreate,
    wrap((raw) => {
      const data = masterPasswordSchema.parse(raw)
      const prefs = persist.loadProfilePrefs(data.profileId)
      const list = vault.create(data.profileId, data.password, prefs.autoLockMins)
      return ok({ unlocked: true, credentials: list })
    })
  )

  ipcMain.handle(
    channels.vaultUnlock,
    wrap((raw) => {
      const data = masterPasswordSchema.parse(raw)
      const prefs = persist.loadProfilePrefs(data.profileId)
      const list = vault.unlock(data.profileId, data.password, prefs.autoLockMins)
      return ok({ unlocked: true, credentials: list })
    })
  )

  ipcMain.handle(
    channels.vaultLock,
    wrap((raw) => {
      const profileId = profileIdSchema.parse(raw)
      vault.lock(profileId)
      return ok({ unlocked: false })
    })
  )

  ipcMain.handle(
    channels.vaultList,
    wrap((raw) => {
      const profileId = profileIdSchema.parse(raw)
      return ok(vault.list(profileId))
    })
  )

  ipcMain.handle(
    channels.vaultReveal,
    wrap((raw) => {
      const data = credentialIdSchema.parse(raw)
      return ok({ password: vault.reveal(data.profileId, data.id) })
    })
  )

  ipcMain.handle(
    channels.vaultSave,
    wrap((raw) => {
      const data = credentialDraftSchema.parse(raw)
      const { profileId, ...draft } = data
      return ok(vault.save(profileId, draft))
    })
  )

  ipcMain.handle(
    channels.vaultUpdate,
    wrap((raw) => {
      const data = credentialUpdateSchema.parse(raw)
      const { profileId, ...draft } = data
      return ok(vault.update(profileId, draft))
    })
  )

  ipcMain.handle(
    channels.vaultDelete,
    wrap((raw) => {
      const data = credentialIdSchema.parse(raw)
      return ok(vault.delete(data.profileId, data.id))
    })
  )

  ipcMain.handle(
    channels.vaultCopy,
    wrap(async (raw) => {
      const data = credentialIdSchema.parse(raw)
      await vault.copySecret(data.profileId, data.id)
      return ok(true)
    })
  )

  ipcMain.handle(
    channels.vaultGenerate,
    wrap((raw) => {
      const data = generateSchema.parse(raw)
      return ok({ value: generatePassword(data) })
    })
  )

  /**
   * Secure vault autofill (STEP 6). The secret is decrypted in main and injected
   * DIRECTLY into the live guest webContents. It NEVER returns to the renderer,
   * the AI, or any IPC payload the renderer can read — only { filled } is sent.
   */
  ipcMain.handle(
    channels.vaultAutofill,
    wrap(async (raw) => {
      const data = vaultAutofillSchema.parse(raw)
      // 1) Revalidate profile identity in main — must be the persisted active profile.
      const active = persist.loadProfilesIndex().activeProfile
      if (data.profileId !== active) throw new Error('profile_mismatch')
      // 2) ASK mode is read-only for the vault. Sensitive insertion is never silent.
      if (data.mode === 'ask') throw new Error('vault_blocked_ask')
      // 3) Vault must be unlocked for this profile.
      if (!vault.isUnlocked(data.profileId)) throw new Error('vault_locked')
      // 4) Resolve the LIVE guest webContents and verify it belongs to our window.
      const guest = electronWebContents.fromId(data.webContentsId)
      const win = opts.getWindow()
      if (!guest || guest.isDestroyed() || !win) throw new Error('target_unavailable')
      const embedder = guest.hostWebContents
      if (!embedder || embedder.id !== win.webContents.id) throw new Error('target_unavailable')
      // 5) Authoritative origin = the live guest URL (never renderer/model supplied).
      const liveUrl = guest.getURL()
      if (!isEligibleOrigin(liveUrl)) throw new Error('origin_ineligible')
      // 6) Select the credential (metadata only) and confirm origin match.
      const cred = vault.list(data.profileId).find((c) => c.id === data.credentialId)
      if (!cred) throw new Error('not_found')
      if (!matchCredentialOrigin(liveUrl, cred.origin).ok) throw new Error('origin_mismatch')
      // 7) Decrypt in main + inject on the guest. The secret is confined to this call.
      const filled = await injectCredential(guest, {
        usernameEid: data.usernameEid,
        passwordEid: data.passwordEid,
        username: cred.username,
        secret: vault.reveal(data.profileId, data.credentialId)
      })
      return ok({ filled })
    })
  )

  /**
   * Privacy Center network diagnostics (STEP 7). Local, bounded, no external
   * probing: host interface addresses (`os.networkInterfaces`), OS DNS resolvers
   * (`dns.getServers`), and a cookie COUNT for the live origin (never values).
   * Returns only safe metadata. No secrets, no cookie contents, no page data.
   */
  ipcMain.handle(
    channels.privacyDiagnose,
    wrap(async (raw) => {
      const data = privacyDiagnoseSchema.parse(raw)
      // Revalidate profile identity in main (never trust the renderer blindly).
      const active = persist.loadProfilesIndex().activeProfile
      if (data.profileId !== active) throw new Error('profile_mismatch')

      // Host interface addresses — classified downstream; never labelled public here.
      const interfaces: { address: string; family: string; internal: boolean }[] = []
      try {
        const nifs = networkInterfaces()
        for (const name of Object.keys(nifs)) {
          for (const a of nifs[name] || []) {
            interfaces.push({ address: a.address, family: String(a.family), internal: !!a.internal })
          }
        }
      } catch {
        /* leave empty on platforms that restrict this */
      }

      // OS resolver addresses (no query is performed).
      let dnsServers: string[] = []
      try {
        dnsServers = dnsGetServers()
      } catch {
        dnsServers = []
      }

      // Cookie COUNT only, for the authoritative live origin when available.
      let cookieCount: number | null = null
      let liveUrl = typeof data.url === 'string' ? data.url : ''
      try {
        if (typeof data.webContentsId === 'number') {
          const guest = electronWebContents.fromId(data.webContentsId)
          const win = opts.getWindow()
          if (guest && !guest.isDestroyed() && win && guest.hostWebContents?.id === win.webContents.id) {
            liveUrl = guest.getURL() // authoritative
            const cookies = await guest.session.cookies.get({ url: liveUrl })
            cookieCount = Array.isArray(cookies) ? cookies.length : null
          }
        }
      } catch {
        cookieCount = null
      }

      return ok({ interfaces, dnsServers, cookieCount, liveUrl: liveUrl.startsWith('http') ? liveUrl : '' })
    })
  )

  /* ---------------- Google Drive (STEP 8) ----------------
   * Read/download only. Main is the sole authority for auth + tokens; the renderer
   * receives only safe connection metadata and normalized file metadata. Downloads
   * are handed to the existing P2 engine (no second download manager). */
  ipcMain.handle(
    channels.driveStatus,
    wrap((raw) => {
      const d = driveProfileSchema.parse(raw)
      return ok(drive.status(d.profileId))
    })
  )
  ipcMain.handle(
    channels.driveConnect,
    wrap(async (raw) => {
      const d = driveProfileSchema.parse(raw)
      return ok(await drive.connect(d.profileId))
    })
  )
  ipcMain.handle(
    channels.driveDisconnect,
    wrap(async (raw) => {
      const d = driveProfileSchema.parse(raw)
      return ok(await drive.disconnect(d.profileId))
    })
  )
  ipcMain.handle(
    channels.driveList,
    wrap(async (raw) => {
      const d = driveListSchema.parse(raw)
      return ok(await drive.list(d.profileId, { category: d.category, folderId: d.folderId, pageToken: d.pageToken }))
    })
  )
  ipcMain.handle(
    channels.driveSearch,
    wrap(async (raw) => {
      const d = driveSearchSchema.parse(raw)
      return ok(await drive.search(d.profileId, { query: d.query, pageToken: d.pageToken }))
    })
  )
  ipcMain.handle(
    channels.driveDownload,
    wrap(async (raw) => {
      const d = driveDownloadSchema.parse(raw)
      return ok(await drive.download(d.profileId, { fileId: d.fileId, isPrivate: d.isPrivate }))
    })
  )

  /* ---------------- Turbo (STEP 9): safe navigation prediction ---------------- */
  // Warm DNS/TCP/TLS for a strongly-intended destination using the profile's OWN
  // (VPN-routed, protection-enabled) Chromium session. Main re-validates the
  // active profile and rejects sensitive/unsafe origins. Never a generic bridge:
  // it only accepts a URL and can only preconnect — never fetch/exec/read.
  ipcMain.handle(
    channels.turboPreconnect,
    wrap((raw) => {
      const d = turboPreconnectSchema.parse(raw)
      // Only the active profile may warm connections (no cross-profile leakage).
      const active = persist.loadProfilesIndex().activeProfile
      if (d.profileId !== active) return ok({ preconnected: false })
      const origin = preconnectTarget(d.url, { enabled: true, privateMode: false })
      if (!origin) return ok({ preconnected: false })
      try {
        electronSession.fromPartition(`persist:nexa-${d.profileId}`).preconnect({ url: origin, numSockets: 1 })
        return ok({ preconnected: true })
      } catch {
        return ok({ preconnected: false })
      }
    })
  )

  /* ---------------- Regional (STEP 10): apply Accept-Language at session level ---------------- */
  // Only the active profile may (re)apply. Prefs are persisted via saveProfilePrefs;
  // this reads them, applies Accept-Language to the profile's sessions, and returns
  // an honest capability report. No generic header/network mutation is exposed.
  ipcMain.handle(
    channels.regionalApply,
    wrap((raw) => {
      regionalApplySchema.parse(raw)
      // Main is authoritative for the active profile only (no cross-profile apply).
      const active = persist.loadProfilesIndex().activeProfile
      return ok(regional.apply(active))
    })
  )

  /* ---------------- Library: bookmarks ---------------- */
  ipcMain.handle(channels.bmLoad, wrap((raw) => ok(library.loadBookmarks(profileIdSchema.parse(raw)))))
  ipcMain.handle(
    channels.bmCreate,
    wrap((raw) => {
      const d = bmCreateSchema.parse(raw)
      return ok(library.createBookmark(d.profileId, { title: d.title, url: d.url, parentId: d.parentId }))
    })
  )
  ipcMain.handle(
    channels.bmCreateFolder,
    wrap((raw) => {
      const d = bmCreateFolderSchema.parse(raw)
      return ok(library.createFolder(d.profileId, { title: d.title, parentId: d.parentId }))
    })
  )
  ipcMain.handle(
    channels.bmUpdate,
    wrap((raw) => {
      const d = bmUpdateSchema.parse(raw)
      return ok(library.updateBookmark(d.profileId, { id: d.id, title: d.title, url: d.url }))
    })
  )
  ipcMain.handle(
    channels.bmDelete,
    wrap((raw) => {
      const d = bmIdSchema.parse(raw)
      return ok(library.deleteBookmark(d.profileId, d.id))
    })
  )
  ipcMain.handle(
    channels.bmMove,
    wrap((raw) => {
      const d = bmMoveSchema.parse(raw)
      return ok(library.moveBookmark(d.profileId, { id: d.id, parentId: d.parentId, index: d.index }))
    })
  )
  ipcMain.handle(
    channels.bmReorder,
    wrap((raw) => {
      const d = bmReorderSchema.parse(raw)
      return ok(library.reorderBookmark(d.profileId, { id: d.id, index: d.index }))
    })
  )
  ipcMain.handle(
    channels.bmExport,
    wrap(async (raw) => {
      const profileId = profileIdSchema.parse(raw)
      const html = library.exportBookmarks(profileId)
      const w = opts.getWindow()
      const res = await dialog.showSaveDialog(w ?? undefined!, {
        title: 'Export bookmarks',
        defaultPath: 'nexa-bookmarks.html',
        filters: [{ name: 'HTML', extensions: ['html'] }]
      })
      if (res.canceled || !res.filePath) return ok({ saved: false })
      writeFileSync(res.filePath, html, 'utf8')
      return ok({ saved: true })
    })
  )
  ipcMain.handle(
    channels.bmImport,
    wrap(async (raw) => {
      const profileId = profileIdSchema.parse(raw)
      const w = opts.getWindow()
      const res = await dialog.showOpenDialog(w ?? undefined!, {
        title: 'Import bookmarks',
        properties: ['openFile'],
        filters: [{ name: 'HTML', extensions: ['html', 'htm'] }]
      })
      if (res.canceled || !res.filePaths[0]) return ok({ imported: 0, store: library.loadBookmarks(profileId) })
      // Read as untrusted text; parser never executes content.
      const html = readFileSync(res.filePaths[0], 'utf8').slice(0, 20_000_000)
      const out = library.importBookmarks(profileId, html)
      return ok(out)
    })
  )

  /* ---------------- Library: history ---------------- */
  ipcMain.handle(
    channels.histQuery,
    wrap((raw) => {
      const d = histQuerySchema.parse(raw)
      return ok(library.queryHistory(d.profileId, { search: d.search, range: d.range, limit: d.limit, offset: d.offset }))
    })
  )
  ipcMain.handle(
    channels.histRecord,
    wrap((raw) => {
      const d = histRecordSchema.parse(raw)
      const prefs = persist.loadProfilePrefs(d.profileId)
      if (!prefs.historyEnabled) return ok({ recorded: false })
      library.recordVisit(d.profileId, {
        url: d.url,
        title: d.title,
        private: d.private,
        retentionDays: prefs.historyRetentionDays
      })
      return ok({ recorded: !d.private })
    })
  )
  ipcMain.handle(
    channels.histDelete,
    wrap((raw) => {
      const d = histDeleteSchema.parse(raw)
      library.deleteHistory(d.profileId, d.id)
      return ok(true)
    })
  )
  ipcMain.handle(
    channels.histClear,
    wrap((raw) => {
      const d = histClearSchema.parse(raw)
      library.clearHistory(d.profileId, d.range)
      return ok(true)
    })
  )

  /* ---------------- Library: collections ---------------- */
  ipcMain.handle(channels.colLoad, wrap((raw) => ok(library.loadCollections(profileIdSchema.parse(raw)))))
  ipcMain.handle(
    channels.colCreate,
    wrap((raw) => {
      const d = colCreateSchema.parse(raw)
      return ok(library.createCollection(d.profileId, d.name))
    })
  )
  ipcMain.handle(
    channels.colRename,
    wrap((raw) => {
      const d = colRenameSchema.parse(raw)
      return ok(library.renameCollection(d.profileId, d.id, d.name))
    })
  )
  ipcMain.handle(
    channels.colDelete,
    wrap((raw) => {
      const d = colIdSchema.parse(raw)
      return ok(library.deleteCollection(d.profileId, d.id))
    })
  )
  ipcMain.handle(
    channels.colAddItem,
    wrap((raw) => {
      const d = colAddItemSchema.parse(raw)
      return ok(library.addCollectionItem(d.profileId, { collectionId: d.collectionId, title: d.title, url: d.url, note: d.note }))
    })
  )
  ipcMain.handle(
    channels.colRemoveItem,
    wrap((raw) => {
      const d = colRemoveItemSchema.parse(raw)
      return ok(library.removeCollectionItem(d.profileId, { collectionId: d.collectionId, itemId: d.itemId }))
    })
  )
  ipcMain.handle(
    channels.colReorderItem,
    wrap((raw) => {
      const d = colReorderItemSchema.parse(raw)
      return ok(library.reorderCollectionItem(d.profileId, { collectionId: d.collectionId, itemId: d.itemId, index: d.index }))
    })
  )

  /* ---------------- Downloads ---------------- */
  ipcMain.handle(channels.dlList, wrap((raw) => ok(downloads.list(dlProfileSchema.parse(raw).profileId))))
  ipcMain.handle(
    channels.dlGet,
    wrap((raw) => {
      const d = dlIdSchema.parse(raw)
      const item = downloads.get(d.profileId, d.id)
      if (!item) throw new Error('not_found')
      return ok(item)
    })
  )
  ipcMain.handle(channels.dlPause, wrap((raw) => { const d = dlIdSchema.parse(raw); return ok(downloads.pause(d.profileId, d.id)) }))
  ipcMain.handle(channels.dlResume, wrap((raw) => { const d = dlIdSchema.parse(raw); return ok(downloads.resume(d.profileId, d.id)) }))
  ipcMain.handle(channels.dlCancel, wrap((raw) => { const d = dlIdSchema.parse(raw); return ok(downloads.cancel(d.profileId, d.id)) }))
  ipcMain.handle(channels.dlRetry, wrap((raw) => { const d = dlIdSchema.parse(raw); return ok(downloads.retry(d.profileId, d.id)) }))
  ipcMain.handle(channels.dlRemove, wrap((raw) => { const d = dlIdSchema.parse(raw); return ok(downloads.remove(d.profileId, d.id)) }))
  ipcMain.handle(channels.dlClearCompleted, wrap((raw) => ok(downloads.clear(dlProfileSchema.parse(raw).profileId, 'completed'))))
  ipcMain.handle(channels.dlClearFailed, wrap((raw) => ok(downloads.clear(dlProfileSchema.parse(raw).profileId, 'failed'))))
  ipcMain.handle(channels.dlOpen, wrap((raw) => { const d = dlIdSchema.parse(raw); return ok(downloads.open(d.profileId, d.id)) }))
  ipcMain.handle(channels.dlShowInFolder, wrap((raw) => { const d = dlIdSchema.parse(raw); return ok(downloads.showInFolder(d.profileId, d.id)) }))
  ipcMain.handle(channels.dlCopyUrl, wrap((raw) => { const d = dlIdSchema.parse(raw); return ok({ url: downloads.copyUrl(d.profileId, d.id) }) }))
  ipcMain.handle(channels.dlPauseAll, wrap((raw) => { downloads.pauseAll(dlProfileSchema.parse(raw).profileId); return ok(true) }))
  ipcMain.handle(channels.dlResumeAll, wrap((raw) => { downloads.resumeAll(dlProfileSchema.parse(raw).profileId); return ok(true) }))
  ipcMain.handle(channels.dlOpenFolder, wrap((raw) => ok(downloads.openDownloadsFolder(dlProfileSchema.parse(raw).profileId))))
  ipcMain.handle(channels.dlGetSettings, wrap((raw) => ok(downloads.getSettingsPublic(dlProfileSchema.parse(raw).profileId))))
  ipcMain.handle(channels.dlSaveSettings, wrap((raw) => { const d = dlSaveSettingsSchema.parse(raw); return ok(downloads.saveSettings(d.profileId, d.settings)) }))

  /* ---------------- Content Protection ---------------- */
  ipcMain.handle(channels.protGetState, wrap((raw) => ok(protection.getState(protProfileSchema.parse(raw).profileId))))
  ipcMain.handle(channels.protGetStats, wrap((raw) => { const d = protStatsSchema.parse(raw); return ok(protection.getStats(d.profileId, d.private)) }))
  ipcMain.handle(channels.protGetSettings, wrap((raw) => ok(protection.getSettings(protProfileSchema.parse(raw).profileId))))
  ipcMain.handle(
    channels.protSaveSettings,
    wrap((raw) => {
      const d = protectionSettingsSchema.parse(raw)
      return ok(protection.saveSettings(d.profileId, { enabled: d.enabled, ads: d.ads, trackers: d.trackers, annoyances: d.annoyances }))
    })
  )
  ipcMain.handle(channels.protSetEnabled, wrap((raw) => { const d = protSetEnabledSchema.parse(raw); return ok(protection.setEnabled(d.profileId, d.enabled)) }))
  ipcMain.handle(channels.protGetSiteState, wrap((raw) => { const d = protSiteQuerySchema.parse(raw); return ok(protection.getSiteState(d.profileId, d.domain)) }))
  ipcMain.handle(channels.protSetSiteEnabled, wrap((raw) => { const d = protSiteEnabledSchema.parse(raw); return ok(protection.setSiteEnabled(d.profileId, d.domain, d.enabled)) }))
  ipcMain.handle(channels.protAddAllow, wrap((raw) => { const d = protDomainSchema.parse(raw); return ok(protection.addAllow(d.profileId, d.domain)) }))
  ipcMain.handle(channels.protRemoveAllow, wrap((raw) => { const d = protDomainSchema.parse(raw); return ok(protection.removeAllow(d.profileId, d.domain)) }))
  ipcMain.handle(channels.protAddBlock, wrap((raw) => { const d = protDomainSchema.parse(raw); return ok(protection.addBlock(d.profileId, d.domain)) }))
  ipcMain.handle(channels.protRemoveBlock, wrap((raw) => { const d = protDomainSchema.parse(raw); return ok(protection.removeBlock(d.profileId, d.domain)) }))
  ipcMain.handle(channels.protGetRules, wrap((raw) => ok(protection.getRules(protProfileSchema.parse(raw).profileId))))
  ipcMain.handle(channels.protResetStats, wrap((raw) => { const d = protStatsSchema.parse(raw); return ok(protection.resetStats(d.profileId, d.private)) }))

  /* ---------------- VPN ---------------- */
  ipcMain.handle(channels.vpnGetStatus, wrap((raw) => ok(vpn.getStatus(vpnProfileSchema.parse(raw).profileId))))
  ipcMain.handle(channels.vpnConnect, wrap(async (raw) => ok(await vpn.connect(vpnProfileSchema.parse(raw).profileId))))
  ipcMain.handle(channels.vpnDisconnect, wrap(async (raw) => ok(await vpn.disconnect(vpnProfileSchema.parse(raw).profileId))))
  ipcMain.handle(channels.vpnReconnect, wrap(async (raw) => ok(await vpn.reconnect(vpnProfileSchema.parse(raw).profileId))))
  ipcMain.handle(channels.vpnImportConfig, wrap((raw) => { const d = vpnImportSchema.parse(raw); return ok(vpn.importConfig(d.profileId, d.name, d.config)) }))
  ipcMain.handle(channels.vpnRemoveConfig, wrap(async (raw) => { const d = vpnServerIdSchema.parse(raw); return ok(await vpn.removeConfig(d.profileId, d.serverId)) }))
  ipcMain.handle(channels.vpnGetServers, wrap((raw) => ok(vpn.getServers(vpnProfileSchema.parse(raw).profileId))))
  ipcMain.handle(channels.vpnSelectServer, wrap((raw) => { const d = vpnServerIdSchema.parse(raw); return ok(vpn.selectServerById(d.profileId, d.serverId)) }))
  ipcMain.handle(channels.vpnGetSettings, wrap((raw) => ok(vpn.getSettings(vpnProfileSchema.parse(raw).profileId))))
  ipcMain.handle(
    channels.vpnUpdateSettings,
    wrap((raw) => {
      const d = vpnSettingsSchema.parse(raw)
      return ok(vpn.updateSettings(d.profileId, { autoConnect: d.autoConnect, killSwitch: d.killSwitch, dnsProtection: d.dnsProtection, ipv6: d.ipv6, disconnectOnExit: d.disconnectOnExit }))
    })
  )
  ipcMain.handle(channels.vpnGetStatistics, wrap(async (raw) => ok(await vpn.getStatistics(vpnProfileSchema.parse(raw).profileId))))

  /* ---------------- Local AI (Ollama) ---------------- */
  ipcMain.handle(channels.aiStatus, wrap(async (raw) => ok(await ai.status(aiProfileSchema.parse(raw).profileId))))
  ipcMain.handle(channels.aiModels, wrap(async (raw) => ok(await ai.models(aiProfileSchema.parse(raw).profileId))))
  ipcMain.handle(channels.aiTest, wrap(async (raw) => ok(await ai.testConnection(aiProfileSchema.parse(raw).profileId))))
  ipcMain.handle(channels.aiGetSettings, wrap((raw) => ok(ai.getSettings(aiProfileSchema.parse(raw).profileId))))
  ipcMain.handle(
    channels.aiSelectModel,
    wrap((raw) => {
      const d = aiSelectModelSchema.parse(raw)
      return ok(ai.saveSettings(d.profileId, { chatModel: d.chatModel, embedModel: d.embedModel }))
    })
  )
  ipcMain.handle(
    channels.aiChat,
    wrap((raw) => {
      const d = aiChatSchema.parse(raw)
      // Fire-and-forget: results stream over channels.aiEvent.
      void ai.chat(d.profileId, d.requestId, d.messages, d.model, { private: !!d.private })
      return ok({ requestId: d.requestId, started: true })
    })
  )
  ipcMain.handle(
    channels.aiCancel,
    wrap((raw) => {
      const d = aiCancelSchema.parse(raw)
      return ok({ cancelled: ai.cancel(d.profileId, d.requestId) })
    })
  )
  ipcMain.handle(
    channels.aiEmbed,
    wrap(async (raw) => {
      const d = aiEmbedSchema.parse(raw)
      const vectors = await ai.embed(d.profileId, d.input, d.model)
      return ok({ vectors, dim: vectors[0]?.length ?? 0, count: vectors.length })
    })
  )
  /* ---------------- P5.3 Vision (multimodal) ---------------- */
  ipcMain.handle(
    channels.aiVisionStatus,
    wrap(async (raw) => {
      const d = aiVisionStatusSchema.parse(raw)
      return ok(await ai.visionStatus(d.profileId, d.model))
    })
  )
  ipcMain.handle(
    channels.aiVisionAnalyze,
    wrap(async (raw) => {
      const d = aiVisionAnalyzeSchema.parse(raw)
      return ok(await ai.visionAnalyze(d.profileId, { image: d.image, prompt: d.prompt, system: d.system, model: d.model }))
    })
  )

  /* ---------------- STEP 12 Multi-provider AI (metadata only) ---------------- */
  ipcMain.handle(
    channels.aiProviders,
    wrap(async (raw) => {
      const d = aiProvidersListSchema.parse(raw)
      return ok(await ai.listProviders(d.profileId, { refresh: d.refresh }))
    })
  )
  ipcMain.handle(
    channels.aiProviderConfigure,
    wrap(async (raw) => {
      const d = aiProviderConfigureSchema.parse(raw)
      // The key is consumed here and stored in SecureStorage; only non-secret
      // status is returned to the renderer.
      return ok(await ai.configureProvider(d.profileId, d.providerId, d.apiKey))
    })
  )
  ipcMain.handle(
    channels.aiProviderRemove,
    wrap(async (raw) => {
      const d = aiProviderRefSchema.parse(raw)
      return ok(await ai.removeProvider(d.profileId, d.providerId))
    })
  )
  ipcMain.handle(
    channels.aiProviderTest,
    wrap(async (raw) => {
      const d = aiProviderRefSchema.parse(raw)
      return ok(await ai.testProvider(d.profileId, d.providerId))
    })
  )
  ipcMain.handle(
    channels.aiConfigGet,
    wrap((raw) => ok(ai.getAIConfig(aiProfileSchema.parse(raw).profileId)))
  )
  ipcMain.handle(
    channels.aiConfigUpdate,
    wrap((raw) => {
      const d = aiConfigUpdateSchema.parse(raw)
      return ok(ai.updateAIConfig(d.profileId, d.patch))
    })
  )

  /* ---------------- NEXA AI Gateway (metadata only) ---------------- */
  ipcMain.handle(channels.aiGatewayInfo, wrap(async (raw) => ok(await ai.gatewayInfo(aiProfileSchema.parse(raw).profileId))))
  ipcMain.handle(
    channels.aiPremiumConnect,
    wrap(async (raw) => {
      const d = aiPremiumConnectSchema.parse(raw)
      // Forwarded once over HTTPS to the gateway; never persisted or echoed here.
      return ok(await ai.connectPremium(d.profileId, d.apiKey))
    })
  )
  ipcMain.handle(channels.aiPremiumDisconnect, wrap(async (raw) => ok(await ai.disconnectPremium(aiProfileSchema.parse(raw).profileId))))

  /* ---------------- Browser Extensions (STEP 13) ---------------- */
  ipcMain.handle(channels.extList, wrap((raw) => ok(extensions.list(extListSchema.parse(raw).profileId))))
  ipcMain.handle(
    channels.extGet,
    wrap((raw) => {
      const d = extRefSchema.parse(raw)
      return ok(extensions.get(d.profileId, d.extensionId))
    })
  )
  // Pick a local unpacked extension folder + return a dry-run permission preview
  // (validated main-side; no code is loaded until the user confirms install).
  ipcMain.handle(
    channels.extPickFolder,
    wrap(async (raw) => {
      extListSchema.parse(raw) // validate { profileId } shape (authorization surface)
      const w = opts.getWindow()
      const res = await dialog.showOpenDialog(w ?? undefined!, { properties: ['openDirectory'], title: 'Select unpacked extension folder' })
      if (res.canceled || !res.filePaths[0]) return ok({ cancelled: true })
      const path = res.filePaths[0]
      const preview = extensions.preview(path)
      return ok({ cancelled: false, path, ...preview })
    })
  )
  ipcMain.handle(
    channels.extInstall,
    wrap(async (raw) => {
      const d = extInstallSchema.parse(raw)
      return ok(await extensions.install(d.profileId, d.path))
    })
  )
  ipcMain.handle(
    channels.extRemove,
    wrap((raw) => {
      const d = extRefSchema.parse(raw)
      return ok(extensions.remove(d.profileId, d.extensionId))
    })
  )
  ipcMain.handle(
    channels.extSetEnabled,
    wrap(async (raw) => {
      const d = extEnableSchema.parse(raw)
      return ok(await extensions.setEnabled(d.profileId, d.extensionId, d.enabled))
    })
  )
  ipcMain.handle(
    channels.extSetPrivate,
    wrap(async (raw) => {
      const d = extPrivateSchema.parse(raw)
      return ok(await extensions.setPrivate(d.profileId, d.extensionId, d.enabled))
    })
  )
  ipcMain.handle(
    channels.extSetSiteAccess,
    wrap((raw) => {
      const d = extSiteAccessSchema.parse(raw)
      return ok(extensions.setSiteAccess(d.profileId, d.extensionId, d.mode))
    })
  )

  /* ---------------- Browser Agent (P5.1) ---------------- */
  ipcMain.handle(
    channels.agentStart,
    wrap((raw) => {
      const d = agentStartSchema.parse(raw)
      const task = agent.start({ profileId: d.profileId, taskId: d.taskId, instruction: d.instruction, mode: d.mode, privateMode: d.privateMode, model: d.model, page: d.page })
      return ok({ taskId: task.id, status: task.status })
    })
  )
  ipcMain.handle(
    channels.agentCancel,
    wrap((raw) => {
      const d = agentControlSchema.parse(raw)
      const cancelled = agent.cancel(d.profileId, d.taskId)
      agentHost.abortTask(d.taskId)
      return ok({ cancelled })
    })
  )
  ipcMain.handle(channels.agentPause, wrap((raw) => { const d = agentControlSchema.parse(raw); return ok({ paused: agent.pause(d.profileId, d.taskId) }) }))
  ipcMain.handle(channels.agentResume, wrap((raw) => { const d = agentControlSchema.parse(raw); return ok({ resumed: agent.resume(d.profileId, d.taskId) }) }))
  ipcMain.handle(
    channels.agentPermission,
    wrap((raw) => {
      const d = agentPermissionSchema.parse(raw)
      return ok({ ok: agentHost.resolvePermission(d.taskId, d.stepId, d.decision) })
    })
  )
  ipcMain.handle(
    channels.agentToolResult,
    wrap((raw) => {
      const d = agentToolResultSchema.parse(raw)
      return ok({ ok: agentHost.resolveToolResult(d.taskId, d.stepId, { ok: d.ok, observation: d.observation, page: d.page, error: d.error }) })
    })
  )
  ipcMain.handle(channels.agentHistory, wrap((raw) => ok(agent.listHistory(aiProfileSchema.parse(raw).profileId))))

  const deny = wrap(() => {
    throw new Error('denied')
  })
  ipcMain.handle(channels.firewallAiVault, deny)
  ipcMain.handle(channels.firewallCloudVault, deny)
  ipcMain.handle(channels.firewallExtVault, deny)
}

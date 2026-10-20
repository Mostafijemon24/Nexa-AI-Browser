import { shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { assertSafeProfileId } from '../../platform'
import type { SecureStorage } from './secure-storage'
import type { Persistence } from './persistence'
import {
  buildAuthUrl,
  buildDownloadUrl,
  buildExportUrl,
  buildListUrl,
  DRIVE_API_FILES,
  DRIVE_SCOPE,
  exportFormatFor,
  expiryFromExpiresIn,
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO,
  isTokenExpired,
  isValidFileId,
  normalizeDriveFile,
  normalizeGoogleError,
  parseCallback,
  validateState,
  type DriveConnectionMeta,
  type DriveFileMetadata,
  type DriveListPage,
  type ListParams
} from '../../shared/drive'

/** Tokens live ONLY here + in OS-backed SecureStorage. Never returned to renderer. */
interface StoredTokens {
  accessToken: string
  refreshToken?: string
  expiry: number
  scope: string
  email?: string
  displayName?: string
}

/** Handoff into the existing P2 download engine. */
export type DriveDownloadEnqueue = (args: {
  profileId: string
  url: string
  filename: string
  isPrivate?: boolean
  headers?: Record<string, string>
}) => { id: string }

interface DriveConfig {
  clientId: string
  clientSecret?: string
}

const TOKEN_KEY = (profileId: string) => `drive:tokens:${profileId}`
const AUTH_TIMEOUT_MS = 5 * 60_000

/**
 * Main-process Google Drive provider (STEP 8). Owns the authenticated client,
 * the OAuth 2.0 + PKCE loopback flow, OS-backed token storage and profile
 * validation. The renderer only ever receives safe metadata; it can never supply
 * a token or an arbitrary download URL. Read-only: no write/delete operations.
 */
export class DriveService {
  private pendingAuth = new Map<string, { server: Server; cancel: () => void }>()

  constructor(
    private secure: SecureStorage,
    private persist: Persistence,
    private enqueue: DriveDownloadEnqueue
  ) {}

  /* ----------------------------- config ----------------------------- */

  private config(): DriveConfig | null {
    const clientId = process.env.NEXA_GOOGLE_CLIENT_ID?.trim()
    if (!clientId) return null
    const clientSecret = process.env.NEXA_GOOGLE_CLIENT_SECRET?.trim() || undefined
    return { clientId, clientSecret }
  }

  private assertActive(profileId: string): void {
    assertSafeProfileId(profileId)
    const active = this.persist.loadProfilesIndex().activeProfile
    if (profileId !== active) throw new Error('profile_mismatch')
  }

  /* ----------------------------- token store ----------------------------- */

  private readTokens(profileId: string): StoredTokens | null {
    try {
      const raw = this.secure.get(TOKEN_KEY(profileId))
      if (!raw) return null
      const t = JSON.parse(raw) as StoredTokens
      if (!t || typeof t.accessToken !== 'string') return null
      return t
    } catch {
      return null
    }
  }

  private writeTokens(profileId: string, t: StoredTokens): void {
    this.secure.set(TOKEN_KEY(profileId), JSON.stringify(t))
  }

  private clearTokens(profileId: string): void {
    try {
      this.secure.delete(TOKEN_KEY(profileId))
    } catch {
      /* ignore */
    }
  }

  /* ----------------------------- status ----------------------------- */

  /** Safe connection metadata — no network, no tokens. */
  status(profileId: string): DriveConnectionMeta {
    this.assertActive(profileId)
    if (!this.config()) return { state: 'NOT_CONFIGURED', connected: false }
    const t = this.readTokens(profileId)
    if (!t) return { state: 'AUTH_REQUIRED', connected: false }
    if (isTokenExpired(t.expiry) && !t.refreshToken) {
      return { state: 'AUTH_EXPIRED', connected: false, email: t.email, displayName: t.displayName }
    }
    return { state: 'CONNECTED', connected: true, email: t.email, displayName: t.displayName }
  }

  /* ----------------------------- OAuth connect ----------------------------- */

  async connect(profileId: string): Promise<DriveConnectionMeta> {
    this.assertActive(profileId)
    const cfg = this.config()
    if (!cfg) return { state: 'NOT_CONFIGURED', connected: false }

    // PKCE + state.
    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = randomBytes(24).toString('base64url')

    // Cancel a previous in-flight auth for this profile.
    this.cancelAuth(profileId)

    return await new Promise<DriveConnectionMeta>((resolveOuter) => {
      let settled = false
      const finish = (meta: DriveConnectionMeta) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          server.close()
        } catch {
          /* ignore */
        }
        this.pendingAuth.delete(profileId)
        resolveOuter(meta)
      }

      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        void this.handleCallback(req, res, { profileId, cfg, verifier, state, redirectUri, finish })
      })
      server.on('error', () => finish({ state: 'ERROR', connected: false, error: 'server_error' }))

      const timer = setTimeout(() => finish({ state: 'AUTH_REQUIRED', connected: false, error: 'timeout' }), AUTH_TIMEOUT_MS)
      let redirectUri = ''

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        const port = typeof addr === 'object' && addr ? addr.port : 0
        if (!port) return finish({ state: 'ERROR', connected: false, error: 'no_port' })
        redirectUri = `http://127.0.0.1:${port}/oauth2/callback`
        this.pendingAuth.set(profileId, { server, cancel: () => finish({ state: 'AUTH_REQUIRED', connected: false, error: 'cancelled' }) })
        const url = buildAuthUrl({ clientId: cfg.clientId, redirectUri, scope: DRIVE_SCOPE, state, codeChallenge: challenge })
        // Authorize in Google's OFFICIAL UI (system browser). Never in-app password entry.
        void shell.openExternal(url)
      })
    })
  }

  private async handleCallback(
    req: IncomingMessage,
    res: ServerResponse,
    ctx: {
      profileId: string
      cfg: DriveConfig
      verifier: string
      state: string
      redirectUri: string
      finish: (m: DriveConnectionMeta) => void
    }
  ): Promise<void> {
    const full = `http://127.0.0.1${req.url || ''}`
    const parsed = parseCallback(full, ctx.redirectUri)
    const reply = (msg: string) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><meta charset="utf-8"><title>NEXA</title><body style="font:15px system-ui;padding:40px;color:#111">${msg} — you can close this tab and return to NEXA.</body>`)
    }
    if (!parsed) {
      res.writeHead(404)
      res.end()
      return
    }
    if (parsed.error) {
      reply('Google Drive authorization was cancelled')
      ctx.finish({ state: 'AUTH_REQUIRED', connected: false, error: 'access_denied' })
      return
    }
    if (!validateState(ctx.state, parsed.state) || !parsed.code) {
      reply('Authorization could not be verified')
      ctx.finish({ state: 'ERROR', connected: false, error: 'state_mismatch' })
      return
    }
    try {
      const tokens = await this.exchangeCode(ctx.cfg, parsed.code, ctx.verifier, ctx.redirectUri)
      const info = await this.fetchUserInfo(tokens.accessToken)
      const stored: StoredTokens = { ...tokens, email: info.email, displayName: info.displayName }
      this.writeTokens(ctx.profileId, stored)
      reply('Connected to Google Drive')
      ctx.finish({ state: 'CONNECTED', connected: true, email: stored.email, displayName: stored.displayName })
    } catch (e) {
      reply('Could not complete Google Drive authorization')
      const norm = normalizeGoogleError({ oauthError: e instanceof Error ? e.message : '' })
      ctx.finish({ state: norm.state, connected: false, error: 'token_exchange_failed' })
    }
  }

  private async exchangeCode(cfg: DriveConfig, code: string, verifier: string, redirectUri: string): Promise<StoredTokens> {
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    })
    if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret)
    const r = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    const json = (await r.json().catch(() => ({}))) as Record<string, unknown>
    if (!r.ok || typeof json.access_token !== 'string') {
      throw new Error(typeof json.error === 'string' ? json.error : 'token_error')
    }
    return {
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
      expiry: expiryFromExpiresIn(json.expires_in),
      scope: typeof json.scope === 'string' ? json.scope : DRIVE_SCOPE
    }
  }

  private async fetchUserInfo(accessToken: string): Promise<{ email?: string; displayName?: string }> {
    try {
      const r = await fetch(GOOGLE_USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!r.ok) return {}
      const j = (await r.json()) as Record<string, unknown>
      return {
        email: typeof j.email === 'string' ? j.email : undefined,
        displayName: typeof j.name === 'string' ? j.name : undefined
      }
    } catch {
      return {}
    }
  }

  /* ----------------------------- token refresh ----------------------------- */

  /** Return a valid access token, refreshing if needed. Throws a safe error code. */
  private async ensureAccessToken(profileId: string): Promise<string> {
    const cfg = this.config()
    if (!cfg) throw new Error('not_configured')
    const t = this.readTokens(profileId)
    if (!t) throw new Error('auth_required')
    if (!isTokenExpired(t.expiry)) return t.accessToken
    if (!t.refreshToken) throw new Error('auth_expired')

    const body = new URLSearchParams({
      client_id: cfg.clientId,
      refresh_token: t.refreshToken,
      grant_type: 'refresh_token'
    })
    if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret)
    const r = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    const json = (await r.json().catch(() => ({}))) as Record<string, unknown>
    if (!r.ok || typeof json.access_token !== 'string') {
      // invalid_grant → the authorization was revoked; drop tokens.
      if (typeof json.error === 'string' && json.error === 'invalid_grant') this.clearTokens(profileId)
      throw new Error('auth_expired')
    }
    const updated: StoredTokens = {
      ...t,
      accessToken: json.access_token,
      expiry: expiryFromExpiresIn(json.expires_in),
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : t.refreshToken
    }
    this.writeTokens(profileId, updated)
    return updated.accessToken
  }

  /* ----------------------------- disconnect ----------------------------- */

  async disconnect(profileId: string): Promise<DriveConnectionMeta> {
    this.assertActive(profileId)
    this.cancelAuth(profileId)
    const t = this.readTokens(profileId)
    // Best-effort revoke. This ONLY revokes NEXA's authorization — it NEVER deletes
    // any Drive files. Failure to revoke still clears local tokens.
    if (t?.refreshToken || t?.accessToken) {
      try {
        await fetch(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(t.refreshToken || t.accessToken)}`, {
          method: 'POST'
        })
      } catch {
        /* ignore network errors on revoke */
      }
    }
    this.clearTokens(profileId)
    return this.config() ? { state: 'AUTH_REQUIRED', connected: false } : { state: 'NOT_CONFIGURED', connected: false }
  }

  private cancelAuth(profileId: string): void {
    const pending = this.pendingAuth.get(profileId)
    if (pending) pending.cancel()
  }

  /* ----------------------------- list / search ----------------------------- */

  private async apiList(profileId: string, params: ListParams): Promise<DriveListPage> {
    const token = await this.ensureAccessToken(profileId)
    const url = buildListUrl(params)
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) {
      if (r.status === 401) this.markExpiredMaybe(profileId)
      throw new Error(`http_${r.status}`)
    }
    const json = (await r.json()) as { files?: unknown[]; nextPageToken?: string }
    const files: DriveFileMetadata[] = Array.isArray(json.files)
      ? json.files.map((f) => normalizeDriveFile(f)).filter((f): f is DriveFileMetadata => f !== null)
      : []
    return { files, nextPageToken: typeof json.nextPageToken === 'string' ? json.nextPageToken : undefined }
  }

  async list(
    profileId: string,
    opts: { category?: ListParams['category']; folderId?: string; pageToken?: string }
  ): Promise<DriveListPage> {
    this.assertActive(profileId)
    return this.apiList(profileId, {
      category: opts.category || 'my-drive',
      folderId: opts.folderId,
      pageToken: opts.pageToken,
      pageSize: 50
    })
  }

  async search(profileId: string, opts: { query: string; pageToken?: string }): Promise<DriveListPage> {
    this.assertActive(profileId)
    const query = String(opts.query || '').trim().slice(0, 256)
    if (!query) return { files: [] }
    return this.apiList(profileId, { query, pageToken: opts.pageToken, pageSize: 50 })
  }

  private markExpiredMaybe(profileId: string): void {
    const t = this.readTokens(profileId)
    if (t && !t.refreshToken) this.clearTokens(profileId)
  }

  /* ----------------------------- download (→ P2) ----------------------------- */

  /**
   * Authorize + hand a Drive file to the EXISTING P2 engine. The Drive API
   * response (files.get) is authoritative for name + mimeType; renderer-supplied
   * metadata is never trusted. Returns the P2 download id. Never returns a token
   * or a raw download URL.
   */
  async download(
    profileId: string,
    args: { fileId: string; isPrivate?: boolean }
  ): Promise<{ id: string; filename: string } | { export: 'EXPORT_NOT_SUPPORTED' }> {
    this.assertActive(profileId)
    if (!isValidFileId(args.fileId)) throw new Error('invalid_file_id')
    const token = await this.ensureAccessToken(profileId)

    // Authoritative metadata straight from Drive.
    const metaUrl = `${DRIVE_API_FILES}/${encodeURIComponent(args.fileId)}?fields=id,name,mimeType,size&supportsAllDrives=true`
    const metaRes = await fetch(metaUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!metaRes.ok) {
      if (metaRes.status === 401) this.markExpiredMaybe(profileId)
      throw new Error(`http_${metaRes.status}`)
    }
    const meta = normalizeDriveFile(await metaRes.json())
    if (!meta) throw new Error('invalid_file')
    if (meta.isFolder) throw new Error('is_folder')

    let downloadUrl: string
    let filename: string
    if (meta.isWorkspace) {
      const fmt = exportFormatFor(meta.mimeType)
      if (!fmt) return { export: 'EXPORT_NOT_SUPPORTED' }
      downloadUrl = buildExportUrl(meta.id, fmt.exportMimeType)
      filename = `${stripExt(meta.name)}.${fmt.extension}`
    } else {
      downloadUrl = buildDownloadUrl(meta.id)
      filename = meta.name
    }

    // Hand off to P2 with the bearer attached in MAIN only. P2 owns everything else.
    const { id } = this.enqueue({
      profileId,
      url: downloadUrl,
      filename,
      isPrivate: !!args.isPrivate,
      headers: { Authorization: `Bearer ${token}` }
    })
    return { id, filename }
  }
}

function stripExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

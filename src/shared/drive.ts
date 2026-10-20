/**
 * NEXA P8 STEP 8 — Google Drive integration core (pure, dependency-light, testable).
 *
 * This module holds the DETERMINISTIC, side-effect-free logic behind the Drive
 * provider: OAuth callback/state/redirect validation, Drive API response
 * normalization, MIME → export mapping, file-id / URL / filename validation, and
 * Google-error normalization into safe NEXA states.
 *
 * SECURITY INVARIANTS (enforced + tested):
 *  - No secrets live here. Access/refresh tokens, client secrets and auth codes
 *    are handled ONLY in the main process; this module never stores or returns them.
 *  - The Drive API response is authoritative — renderer-supplied name/mime/size are
 *    never trusted for a download decision.
 *  - Never fabricate a "connected" state. Unconfigured → NOT_CONFIGURED.
 *  - Read-only: no upload/delete/rename/move/share URL builders exist.
 */

/* --------------------------------- Scopes --------------------------------- */

/** Minimum scope — read-only Drive. No Gmail/Calendar/Contacts/Photos/write. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
export const DRIVE_API_FILES = 'https://www.googleapis.com/drive/v3/files'
export const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo'

/* --------------------------------- States --------------------------------- */

export type DriveConnectionState =
  | 'NOT_CONFIGURED'
  | 'CHECKING'
  | 'CONNECTED'
  | 'OFFLINE'
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'ERROR'

/** Safe connection metadata — the ONLY shape the renderer ever receives. */
export interface DriveConnectionMeta {
  state: DriveConnectionState
  connected: boolean
  email?: string
  displayName?: string
  /** last error code (safe, normalized) if state is an error state */
  error?: string
}

/* ------------------------------ File metadata ------------------------------ */

export interface DriveFileMetadata {
  id: string
  name: string
  mimeType: string
  size?: number
  modifiedTime?: string
  createdTime?: string
  parents?: string[]
  webViewLink?: string
  thumbnailLink?: string
  iconLink?: string
  isFolder: boolean
  isWorkspace: boolean
}

export interface DriveListPage {
  files: DriveFileMetadata[]
  nextPageToken?: string
}

/* ------------------------------ ID / URL guards ------------------------------ */

// Google Drive file IDs are URL-safe base64-ish tokens, typically >= 10 chars.
const FILE_ID_RE = /^[A-Za-z0-9_-]{10,256}$/

export function isValidFileId(id: unknown): id is string {
  return typeof id === 'string' && FILE_ID_RE.test(id)
}

/** Strict HTTPS validation for "Open in Google Drive" links (webViewLink). */
export function isSafeHttpsUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  // Only allow google-owned hosts for Drive links.
  const host = u.hostname.toLowerCase()
  return (
    host === 'drive.google.com' ||
    host === 'docs.google.com' ||
    host.endsWith('.google.com') ||
    host.endsWith('.googleusercontent.com')
  )
}

/* --------------------------------- PKCE / OAuth --------------------------------- */

export interface OAuthAuthParams {
  clientId: string
  redirectUri: string
  scope: string
  state: string
  codeChallenge: string
}

/** Build the Google authorization URL (pure). Uses S256 PKCE + offline access. */
export function buildAuthUrl(p: OAuthAuthParams): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: p.scope,
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true'
  })
  return `${GOOGLE_AUTH_ENDPOINT}?${q.toString()}`
}

/** Only loopback (127.0.0.1 / [::1]) redirect URIs are accepted (desktop flow). */
export function isValidRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== 'string' || !uri) return false
  let u: URL
  try {
    u = new URL(uri)
  } catch {
    return false
  }
  if (u.protocol !== 'http:') return false
  return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]' || u.hostname === '::1'
}

/** Constant-time-ish state comparison (both must be non-empty and equal). */
export function validateState(expected: string, got: unknown): boolean {
  if (typeof got !== 'string' || !expected || expected.length !== got.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}

export interface ParsedCallback {
  code?: string
  state?: string
  error?: string
}

/**
 * Parse an OAuth redirect URL. Rejects anything that is not a valid loopback
 * redirect. Returns `{ error }` for an explicit provider error (e.g. access_denied).
 */
export function parseCallback(rawUrl: unknown, expectedRedirect: string): ParsedCallback | null {
  if (typeof rawUrl !== 'string' || !rawUrl) return null
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return null
  }
  if (!isValidRedirectUri(expectedRedirect)) return null
  let exp: URL
  try {
    exp = new URL(expectedRedirect)
  } catch {
    return null
  }
  // Path must match the expected redirect path (host/port already loopback).
  if (u.pathname !== exp.pathname) return null
  const error = u.searchParams.get('error') || undefined
  const code = u.searchParams.get('code') || undefined
  const state = u.searchParams.get('state') || undefined
  if (error) return { error }
  if (!code) return null
  return { code, state }
}

/* --------------------------------- Token expiry --------------------------------- */

/** True when an access token is expired (with a 60s safety skew). */
export function isTokenExpired(expiryEpochMs: number | undefined, now: number = Date.now()): boolean {
  if (typeof expiryEpochMs !== 'number' || !isFinite(expiryEpochMs)) return true
  return now >= expiryEpochMs - 60_000
}

/** Compute an absolute expiry (ms) from a token endpoint `expires_in` (seconds). */
export function expiryFromExpiresIn(expiresIn: unknown, now: number = Date.now()): number {
  const secs = typeof expiresIn === 'number' && isFinite(expiresIn) ? expiresIn : 3600
  return now + Math.max(0, secs) * 1000
}

/* --------------------------------- Normalization --------------------------------- */

export const FOLDER_MIME = 'application/vnd.google-apps.folder'

export function isFolderMime(m: unknown): boolean {
  return m === FOLDER_MIME
}

export function isWorkspaceMime(m: unknown): boolean {
  return typeof m === 'string' && m.startsWith('application/vnd.google-apps.') && m !== FOLDER_MIME
}

/**
 * Normalize a raw Drive API file object into NEXA's safe contract. Drops unknown
 * fields; coerces size; never carries tokens/content. Returns null if no valid id.
 */
export function normalizeDriveFile(raw: unknown): DriveFileMetadata | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = o.id
  if (!isValidFileId(id)) return null
  const mimeType = typeof o.mimeType === 'string' ? o.mimeType : 'application/octet-stream'
  const sizeNum = typeof o.size === 'string' ? Number(o.size) : typeof o.size === 'number' ? o.size : NaN
  const parents = Array.isArray(o.parents) ? o.parents.filter((p): p is string => typeof p === 'string') : undefined
  const webViewLink = isSafeHttpsUrl(o.webViewLink) ? (o.webViewLink as string) : undefined
  const thumbnailLink = isSafeHttpsUrl(o.thumbnailLink) ? (o.thumbnailLink as string) : undefined
  const iconLink = isSafeHttpsUrl(o.iconLink) ? (o.iconLink as string) : undefined
  return {
    id,
    name: typeof o.name === 'string' && o.name ? o.name : 'Untitled',
    mimeType,
    size: isFinite(sizeNum) && sizeNum >= 0 ? sizeNum : undefined,
    modifiedTime: typeof o.modifiedTime === 'string' ? o.modifiedTime : undefined,
    createdTime: typeof o.createdTime === 'string' ? o.createdTime : undefined,
    parents,
    webViewLink,
    thumbnailLink,
    iconLink,
    isFolder: isFolderMime(mimeType),
    isWorkspace: isWorkspaceMime(mimeType)
  }
}

/** The fields we request from the Drive API (bounded, metadata-only). */
export const DRIVE_FILE_FIELDS =
  'id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink,thumbnailLink,iconLink'

/* --------------------------------- Export mapping --------------------------------- */

export interface ExportFormat {
  exportMimeType: string
  extension: string
}

/**
 * Map a Google Workspace MIME type to a safe binary export format. Returns null
 * (→ EXPORT_NOT_SUPPORTED) for Workspace types we do not support (forms/sites/etc).
 */
export function exportFormatFor(workspaceMime: string): ExportFormat | null {
  switch (workspaceMime) {
    case 'application/vnd.google-apps.document':
      return { exportMimeType: 'application/pdf', extension: 'pdf' }
    case 'application/vnd.google-apps.spreadsheet':
      return {
        exportMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: 'xlsx'
      }
    case 'application/vnd.google-apps.presentation':
      return {
        exportMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        extension: 'pptx'
      }
    case 'application/vnd.google-apps.drawing':
      return { exportMimeType: 'image/png', extension: 'png' }
    case 'application/vnd.google-apps.script':
      return { exportMimeType: 'application/vnd.google-apps.script+json', extension: 'json' }
    default:
      return null // EXPORT_NOT_SUPPORTED (forms, sites, maps, shortcuts, …)
  }
}

/** Kind label for the UI from a MIME type (never affects the download decision). */
export function mimeToKind(m: string): string {
  if (isFolderMime(m)) return 'Folder'
  if (m === 'application/vnd.google-apps.document') return 'Docs'
  if (m === 'application/vnd.google-apps.spreadsheet') return 'Sheets'
  if (m === 'application/vnd.google-apps.presentation') return 'Slides'
  if (m === 'application/vnd.google-apps.drawing') return 'Drawing'
  if (m === 'application/vnd.google-apps.form') return 'Form'
  if (isWorkspaceMime(m)) return 'Google'
  if (m === 'application/pdf') return 'PDF'
  if (m.startsWith('image/')) return 'Image'
  if (m.startsWith('video/')) return 'Video'
  if (m.startsWith('audio/')) return 'Audio'
  if (m.startsWith('text/')) return 'Text'
  if (m.includes('zip') || m.includes('compressed') || m.includes('tar')) return 'Archive'
  if (m.includes('word')) return 'DOCX'
  if (m.includes('sheet') || m.includes('excel')) return 'XLSX'
  if (m.includes('presentation') || m.includes('powerpoint')) return 'PPTX'
  return 'File'
}

/* --------------------------------- Download URLs --------------------------------- */

/** Direct binary download URL for an ordinary (non-Workspace) Drive file. */
export function buildDownloadUrl(fileId: string): string {
  if (!isValidFileId(fileId)) throw new Error('invalid_file_id')
  return `${DRIVE_API_FILES}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`
}

/** Export URL for a Workspace file to a concrete binary format. */
export function buildExportUrl(fileId: string, exportMimeType: string): string {
  if (!isValidFileId(fileId)) throw new Error('invalid_file_id')
  const q = new URLSearchParams({ mimeType: exportMimeType, supportsAllDrives: 'true' })
  return `${DRIVE_API_FILES}/${encodeURIComponent(fileId)}/export?${q.toString()}`
}

/** Build a bounded files.list URL. Category maps to a Drive `q`/ordering. */
export interface ListParams {
  category?: 'my-drive' | 'shared' | 'recent' | 'folder'
  folderId?: string
  query?: string
  pageToken?: string
  pageSize?: number
}
export function buildListUrl(p: ListParams): string {
  const size = Math.min(Math.max(p.pageSize || 50, 1), 100)
  const params = new URLSearchParams({
    pageSize: String(size),
    fields: `nextPageToken,files(${DRIVE_FILE_FIELDS})`,
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'user'
  })
  const clauses: string[] = ['trashed = false']
  if (p.query) {
    // Escape single quotes/backslashes to keep the q expression well-formed.
    const safe = p.query.replace(/\\/g, '\\\\').replace(/'/g, "\\'").slice(0, 256)
    clauses.push(`name contains '${safe}'`)
  }
  if (p.category === 'shared') clauses.push('sharedWithMe = true')
  else if (p.category === 'folder' && isValidFileId(p.folderId)) clauses.push(`'${p.folderId}' in parents`)
  else if (p.category === 'my-drive' && !p.query) clauses.push("'root' in parents")
  params.set('q', clauses.join(' and '))
  if (p.category === 'recent') params.set('orderBy', 'modifiedTime desc')
  else params.set('orderBy', 'folder,name')
  if (p.pageToken) params.set('pageToken', p.pageToken)
  return `${DRIVE_API_FILES}?${params.toString()}`
}

/* --------------------------------- Error normalization --------------------------------- */

/**
 * Map an HTTP status / OAuth error string into a safe NEXA connection state.
 * NEVER surfaces tokens, headers, codes or stack traces.
 */
export function normalizeGoogleError(input: { status?: number; oauthError?: string }): {
  state: DriveConnectionState
  message: string
} {
  const oauth = (input.oauthError || '').toLowerCase()
  if (oauth === 'invalid_grant' || oauth === 'access_denied') {
    return { state: 'AUTH_EXPIRED', message: 'Your Google Drive connection needs attention. Please reconnect.' }
  }
  switch (input.status) {
    case 401:
      return { state: 'AUTH_EXPIRED', message: 'Your Google Drive connection needs attention. Please reconnect.' }
    case 403:
      return { state: 'RATE_LIMITED', message: 'Google Drive access was refused or rate-limited. Try again shortly.' }
    case 404:
      return { state: 'ERROR', message: 'The requested Drive item was not found.' }
    case 429:
      return { state: 'RATE_LIMITED', message: 'Too many Drive requests. Please wait a moment and retry.' }
    default:
      if (typeof input.status === 'number' && input.status >= 500) {
        return { state: 'ERROR', message: 'Google Drive is temporarily unavailable.' }
      }
      return { state: 'ERROR', message: 'The Google Drive request could not be completed.' }
  }
}

/* --------------------------------- Backoff --------------------------------- */

/** Bounded exponential backoff (ms) for retryable Drive responses. */
export function backoffMs(attempt: number): number {
  const n = Math.max(0, Math.min(attempt, 5))
  return Math.min(500 * 2 ** n, 15_000)
}

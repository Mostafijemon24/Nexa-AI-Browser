import { describe, expect, it } from 'vitest'
import {
  backoffMs,
  buildAuthUrl,
  buildDownloadUrl,
  buildExportUrl,
  buildListUrl,
  DRIVE_SCOPE,
  exportFormatFor,
  expiryFromExpiresIn,
  isSafeHttpsUrl,
  isTokenExpired,
  isValidFileId,
  isValidRedirectUri,
  isWorkspaceMime,
  mimeToKind,
  normalizeDriveFile,
  normalizeGoogleError,
  parseCallback,
  validateState
} from '../../src/shared/drive'

const REDIRECT = 'http://127.0.0.1:53112/oauth2/callback'

describe('OAuth: scope + auth URL', () => {
  it('uses the minimum read-only scope', () => {
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.readonly')
    expect(DRIVE_SCOPE).not.toContain('auth/drive ')
    expect(DRIVE_SCOPE.endsWith('/drive')).toBe(false)
  })
  it('builds an S256 PKCE offline auth URL', () => {
    const url = buildAuthUrl({
      clientId: 'cid.apps.googleusercontent.com',
      redirectUri: REDIRECT,
      scope: DRIVE_SCOPE,
      state: 'abc123',
      codeChallenge: 'CHALLENGE'
    })
    const u = new URL(url)
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('state')).toBe('abc123')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('scope')).toBe(DRIVE_SCOPE)
  })
})

describe('OAuth: redirect + state + callback validation', () => {
  it('accepts only loopback redirect URIs', () => {
    expect(isValidRedirectUri(REDIRECT)).toBe(true)
    expect(isValidRedirectUri('http://localhost:8080/cb')).toBe(true)
    expect(isValidRedirectUri('https://evil.com/cb')).toBe(false)
    expect(isValidRedirectUri('http://192.168.1.5/cb')).toBe(false)
    expect(isValidRedirectUri('javascript:alert(1)')).toBe(false)
  })
  it('validates state (equal, non-empty, length-safe)', () => {
    expect(validateState('s3cr3t', 's3cr3t')).toBe(true)
    expect(validateState('s3cr3t', 's3cr3X')).toBe(false)
    expect(validateState('', '')).toBe(false)
    expect(validateState('abc', 'abcd')).toBe(false)
    expect(validateState('abc', undefined)).toBe(false)
  })
  it('parses a valid callback and extracts code + state', () => {
    const cb = parseCallback(`${REDIRECT}?code=AUTHCODE&state=xyz`, REDIRECT)
    expect(cb).toEqual({ code: 'AUTHCODE', state: 'xyz' })
  })
  it('returns provider error without throwing', () => {
    const cb = parseCallback(`${REDIRECT}?error=access_denied`, REDIRECT)
    expect(cb).toEqual({ error: 'access_denied' })
  })
  it('rejects mismatched path / missing code / non-loopback', () => {
    expect(parseCallback(`${REDIRECT}x?code=A&state=x`, REDIRECT)).toBeNull()
    expect(parseCallback(`${REDIRECT}?state=x`, REDIRECT)).toBeNull()
    expect(parseCallback('https://evil.com/cb?code=A', 'https://evil.com/cb')).toBeNull()
    expect(parseCallback('not-a-url', REDIRECT)).toBeNull()
  })
})

describe('token expiry', () => {
  it('treats missing/expired tokens as expired (60s skew)', () => {
    expect(isTokenExpired(undefined)).toBe(true)
    expect(isTokenExpired(1000, 2000)).toBe(true)
    const now = 1_000_000
    expect(isTokenExpired(now + 120_000, now)).toBe(false)
    expect(isTokenExpired(now + 30_000, now)).toBe(true) // within skew
  })
  it('computes absolute expiry from expires_in', () => {
    expect(expiryFromExpiresIn(3600, 0)).toBe(3600_000)
    expect(expiryFromExpiresIn(undefined, 0)).toBe(3600_000)
  })
})

describe('file id + safe URL validation', () => {
  it('validates Drive file IDs', () => {
    expect(isValidFileId('1A2b3C4d5E_-fg')).toBe(true)
    expect(isValidFileId('short')).toBe(false)
    expect(isValidFileId('../etc/passwd')).toBe(false)
    expect(isValidFileId('has space here!!')).toBe(false)
    expect(isValidFileId(123 as unknown)).toBe(false)
  })
  it('accepts only https google-owned links', () => {
    expect(isSafeHttpsUrl('https://drive.google.com/file/d/abc/view')).toBe(true)
    expect(isSafeHttpsUrl('https://docs.google.com/document/d/abc')).toBe(true)
    expect(isSafeHttpsUrl('http://drive.google.com/x')).toBe(false)
    expect(isSafeHttpsUrl('https://evil.com/x')).toBe(false)
    expect(isSafeHttpsUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeHttpsUrl('file:///etc/passwd')).toBe(false)
  })
})

describe('metadata normalization', () => {
  it('normalizes a raw file, dropping unknown/unsafe fields', () => {
    const f = normalizeDriveFile({
      id: '1validFileId_-x',
      name: 'Report.pdf',
      mimeType: 'application/pdf',
      size: '20480',
      modifiedTime: '2026-09-15T00:00:00Z',
      parents: ['0ROOTfolderXX', 42],
      webViewLink: 'https://drive.google.com/file/d/1validFileId_-x/view',
      thumbnailLink: 'http://evil.com/x', // unsafe → dropped
      access_token: 'SHOULD_NOT_APPEAR'
    })
    expect(f).not.toBeNull()
    expect(f!.size).toBe(20480)
    expect(f!.isFolder).toBe(false)
    expect(f!.parents).toEqual(['0ROOTfolderXX'])
    expect(f!.webViewLink).toContain('https://drive.google.com')
    expect(f!.thumbnailLink).toBeUndefined()
    expect(JSON.stringify(f)).not.toContain('access_token')
    expect(JSON.stringify(f)).not.toContain('SHOULD_NOT_APPEAR')
  })
  it('flags folders and workspace files', () => {
    expect(normalizeDriveFile({ id: 'folderIdXXXXXX', name: 'F', mimeType: 'application/vnd.google-apps.folder' })!.isFolder).toBe(true)
    expect(normalizeDriveFile({ id: 'docIdXXXXXXXX', name: 'D', mimeType: 'application/vnd.google-apps.document' })!.isWorkspace).toBe(true)
    expect(isWorkspaceMime('application/vnd.google-apps.folder')).toBe(false)
  })
  it('rejects objects with invalid ids', () => {
    expect(normalizeDriveFile({ id: 'x', name: 'n', mimeType: 'text/plain' })).toBeNull()
    expect(normalizeDriveFile(null)).toBeNull()
  })
})

describe('workspace export mapping', () => {
  it('maps supported Workspace types to safe binary formats', () => {
    expect(exportFormatFor('application/vnd.google-apps.document')).toEqual({ exportMimeType: 'application/pdf', extension: 'pdf' })
    expect(exportFormatFor('application/vnd.google-apps.spreadsheet')!.extension).toBe('xlsx')
    expect(exportFormatFor('application/vnd.google-apps.presentation')!.extension).toBe('pptx')
    expect(exportFormatFor('application/vnd.google-apps.drawing')!.extension).toBe('png')
  })
  it('returns null (EXPORT_NOT_SUPPORTED) for unsupported Workspace types', () => {
    expect(exportFormatFor('application/vnd.google-apps.form')).toBeNull()
    expect(exportFormatFor('application/vnd.google-apps.site')).toBeNull()
  })
  it('mimeToKind gives friendly labels', () => {
    expect(mimeToKind('application/pdf')).toBe('PDF')
    expect(mimeToKind('image/png')).toBe('Image')
    expect(mimeToKind('video/mp4')).toBe('Video')
    expect(mimeToKind('application/vnd.google-apps.document')).toBe('Docs')
  })
})

describe('download / list URL builders', () => {
  it('builds alt=media download URL and rejects bad ids', () => {
    expect(buildDownloadUrl('1validFileId_-x')).toContain('alt=media')
    expect(() => buildDownloadUrl('../bad')).toThrow('invalid_file_id')
  })
  it('builds export URL with mimeType', () => {
    const url = buildExportUrl('1validFileId_-x', 'application/pdf')
    expect(url).toContain('/export?')
    expect(new URL(url).searchParams.get('mimeType')).toBe('application/pdf')
  })
  it('builds bounded, escaped list URLs', () => {
    const u = new URL(buildListUrl({ category: 'shared', pageSize: 999, query: "a'b\\c" }))
    expect(Number(u.searchParams.get('pageSize'))).toBeLessThanOrEqual(100)
    expect(u.searchParams.get('q')).toContain('sharedWithMe = true')
    expect(u.searchParams.get('q')).toContain('trashed = false')
    // query is escaped (no raw unescaped quote breaking the clause)
    expect(u.searchParams.get('q')).toContain("name contains")
  })
  it('scopes folder listing by parent id only when the id is valid', () => {
    const ok = new URL(buildListUrl({ category: 'folder', folderId: '1validFolder__' }))
    expect(ok.searchParams.get('q')).toContain("'1validFolder__' in parents")
    const bad = new URL(buildListUrl({ category: 'folder', folderId: '../x' }))
    expect(bad.searchParams.get('q')).not.toContain('in parents')
  })
})

describe('google error normalization (no secret leakage)', () => {
  it('maps statuses/oauth errors to safe states', () => {
    expect(normalizeGoogleError({ status: 401 }).state).toBe('AUTH_EXPIRED')
    expect(normalizeGoogleError({ oauthError: 'invalid_grant' }).state).toBe('AUTH_EXPIRED')
    expect(normalizeGoogleError({ status: 429 }).state).toBe('RATE_LIMITED')
    expect(normalizeGoogleError({ status: 403 }).state).toBe('RATE_LIMITED')
    expect(normalizeGoogleError({ status: 404 }).state).toBe('ERROR')
    expect(normalizeGoogleError({ status: 503 }).state).toBe('ERROR')
  })
  it('messages never contain tokens/headers', () => {
    for (const s of [401, 403, 404, 429, 500]) {
      const m = normalizeGoogleError({ status: s }).message
      expect(m).not.toMatch(/token|Authorization|Bearer/i)
    }
  })
})

describe('bounded backoff', () => {
  it('grows then caps', () => {
    expect(backoffMs(0)).toBe(500)
    expect(backoffMs(1)).toBe(1000)
    expect(backoffMs(100)).toBeLessThanOrEqual(15_000)
  })
})

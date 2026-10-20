import { z } from 'zod'
import { PROFILE_ID_RE } from './types'

export { channels, type IpcChannel } from './channels'

export const profileIdSchema = z.string().regex(PROFILE_ID_RE, 'invalid_profile_id')

export const saveGlobalSchema = z.object({
  headerVisible: z.boolean()
})

export const saveProfileSchema = z.object({
  profileId: profileIdSchema,
  prefs: z.record(z.unknown())
})

export const saveProfilesIndexSchema = z.object({
  activeProfile: profileIdSchema,
  profiles: z.record(z.unknown())
})

export const saveSessionSchema = z.object({
  profileId: profileIdSchema,
  session: z.object({
    tabs: z.array(z.unknown()),
    activeTab: z.string(),
    workspaces: z.array(z.unknown()).optional()
  })
})

export const masterPasswordSchema = z.object({
  profileId: profileIdSchema,
  password: z.string().min(8).max(200)
})

export const credentialDraftSchema = z.object({
  profileId: profileIdSchema,
  title: z.string().max(200).optional(),
  origin: z.string().min(1).max(500),
  username: z.string().max(300),
  password: z.string().max(500),
  notes: z.string().max(2000).optional()
})

export const credentialUpdateSchema = credentialDraftSchema.extend({
  id: z.string().min(1).max(80)
})

export const credentialIdSchema = z.object({
  profileId: profileIdSchema,
  id: z.string().min(1).max(80)
})

const eidSchema = z.string().regex(/^element_\d{1,4}$/, 'invalid_eid')

/**
 * Secure vault autofill request. Intentionally carries NO secret — only the
 * credential id, the live guest webContents id (main resolves the authoritative
 * origin from it), and the resolved target field eids. Main decrypts + injects.
 */
export const vaultAutofillSchema = z.object({
  profileId: profileIdSchema,
  credentialId: z.string().min(1).max(80),
  webContentsId: z.number().int().min(0).max(1_000_000_000),
  usernameEid: eidSchema.optional(),
  passwordEid: eidSchema,
  mode: z.enum(['ask', 'assist', 'agent'])
})

/**
 * Privacy Center network diagnostic request. Bounded, request-only. `url` is used
 * only for cookie-count scoping; when `webContentsId` is provided, main prefers the
 * authoritative LIVE guest origin. Never returns secrets, cookie values, or PII.
 */
export const privacyDiagnoseSchema = z.object({
  profileId: profileIdSchema,
  url: z.string().max(2048).optional(),
  webContentsId: z.number().int().min(0).max(1_000_000_000).optional()
})

/* ------------------------------- Google Drive (STEP 8) ------------------------------- */

// Drive file IDs are URL-safe tokens; bound length and charset (never a path).
const driveFileIdSchema = z.string().regex(/^[A-Za-z0-9_-]{10,256}$/)

export const driveProfileSchema = z.object({ profileId: profileIdSchema })

export const driveListSchema = z.object({
  profileId: profileIdSchema,
  category: z.enum(['my-drive', 'shared', 'recent', 'folder']).optional(),
  folderId: driveFileIdSchema.optional(),
  pageToken: z.string().max(4096).optional()
})

export const driveSearchSchema = z.object({
  profileId: profileIdSchema,
  query: z.string().min(1).max(256),
  pageToken: z.string().max(4096).optional()
})

export const driveDownloadSchema = z.object({
  profileId: profileIdSchema,
  fileId: driveFileIdSchema,
  isPrivate: z.boolean().optional()
})

/* ------------------------------- Turbo (STEP 9) ------------------------------- */

/**
 * Safe navigation prediction: warm a connection (DNS/TCP/TLS) to a strongly-
 * intended destination. Request-only; main re-validates the origin + rejects
 * sensitive/unsafe URLs and uses the profile's own (VPN-routed) session.
 */
export const turboPreconnectSchema = z.object({
  profileId: profileIdSchema,
  url: z.string().max(2048)
})

/* ------------------------------ Regional (STEP 10) ------------------------------ */

/**
 * Apply the active profile's regional preferences (Accept-Language) at the session
 * level and return an honest capability report. Request-only, capability-specific —
 * NOT a generic header/network mutation channel. Prefs themselves are persisted via
 * the existing `saveProfilePrefs` flow.
 */
export const regionalApplySchema = z.object({ profileId: profileIdSchema })

export const generateSchema = z.object({
  length: z.number().int().min(8).max(40),
  upper: z.boolean(),
  lower: z.boolean(),
  num: z.boolean(),
  sym: z.boolean(),
  noAmbig: z.boolean()
})

export const openExternalSchema = z.object({
  url: z.string().url().refine((u) => u.startsWith('https:') || u.startsWith('http:'), 'unsupported_scheme')
})

/* ---------------- Library schemas ---------------- */

const idStr = z.string().min(1).max(80)
const urlStr = z.string().min(1).max(4000)
const titleStr = z.string().max(500)

export const bmCreateSchema = z.object({
  profileId: profileIdSchema,
  title: titleStr,
  url: urlStr,
  parentId: idStr.nullable().optional()
})
export const bmCreateFolderSchema = z.object({
  profileId: profileIdSchema,
  title: titleStr,
  parentId: idStr.nullable().optional()
})
export const bmUpdateSchema = z.object({
  profileId: profileIdSchema,
  id: idStr,
  title: titleStr.optional(),
  url: urlStr.optional()
})
export const bmIdSchema = z.object({ profileId: profileIdSchema, id: idStr })
export const bmMoveSchema = z.object({
  profileId: profileIdSchema,
  id: idStr,
  parentId: idStr.nullable(),
  index: z.number().int().min(0).max(100000).optional()
})
export const bmReorderSchema = z.object({
  profileId: profileIdSchema,
  id: idStr,
  index: z.number().int().min(0).max(100000)
})

export const histQuerySchema = z.object({
  profileId: profileIdSchema,
  search: z.string().max(300).optional(),
  range: z.enum(['hour', 'day', 'week', 'month', 'all']).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  offset: z.number().int().min(0).max(1000000).optional()
})
export const histRecordSchema = z.object({
  profileId: profileIdSchema,
  url: urlStr,
  title: titleStr,
  private: z.boolean().optional()
})
export const histDeleteSchema = z.object({ profileId: profileIdSchema, id: idStr })
export const histClearSchema = z.object({
  profileId: profileIdSchema,
  range: z.enum(['hour', 'day', 'week', 'month', 'all'])
})

export const colCreateSchema = z.object({ profileId: profileIdSchema, name: z.string().max(200) })
export const colRenameSchema = z.object({ profileId: profileIdSchema, id: idStr, name: z.string().max(200) })
export const colIdSchema = z.object({ profileId: profileIdSchema, id: idStr })
export const colAddItemSchema = z.object({
  profileId: profileIdSchema,
  collectionId: idStr,
  title: titleStr,
  url: urlStr,
  note: z.string().max(2000).optional()
})
export const colRemoveItemSchema = z.object({
  profileId: profileIdSchema,
  collectionId: idStr,
  itemId: idStr
})
export const colReorderItemSchema = z.object({
  profileId: profileIdSchema,
  collectionId: idStr,
  itemId: idStr,
  index: z.number().int().min(0).max(100000)
})

/* ---------------- Downloads schemas ---------------- */
export const dlIdSchema = z.object({ profileId: profileIdSchema, id: idStr })
export const dlProfileSchema = z.object({ profileId: profileIdSchema })
export const dlSaveSettingsSchema = z.object({
  profileId: profileIdSchema,
  settings: z.object({
    askLocation: z.boolean(),
    duplicatePolicy: z.enum(['rename', 'replace']),
    maxConcurrent: z.number().int().min(1).max(10),
    retryLimit: z.number().int().min(0).max(20)
  })
})

/* ---------------- Protection schemas ---------------- */
export {
  domainPayloadSchema as protDomainSchema,
  siteEnabledSchema as protSiteEnabledSchema,
  protectionSettingsSchema
} from './protection'
export const protProfileSchema = z.object({ profileId: profileIdSchema })
export const protStatsSchema = z.object({ profileId: profileIdSchema, private: z.boolean().optional() })
export const protSiteQuerySchema = z.object({ profileId: profileIdSchema, domain: z.string().min(1).max(255) })
export const protSetEnabledSchema = z.object({ profileId: profileIdSchema, enabled: z.boolean() })

/* ---------------- VPN schemas ---------------- */
export {
  vpnImportSchema,
  vpnServerIdSchema,
  vpnProfileSchema,
  vpnSettingsSchema
} from './vpn'

export function safeError(code: string, message: string) {
  return { ok: false as const, error: { code, message } }
}

export function ok<T>(data: T) {
  return { ok: true as const, data }
}

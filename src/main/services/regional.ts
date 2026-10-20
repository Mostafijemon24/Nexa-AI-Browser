import { session as electronSession } from 'electron'
import type { Persistence } from './persistence'
import { assertSafeProfileId } from '../../platform'
import {
  buildAcceptLanguage,
  capabilityReport,
  validateRegional,
  type ProfileRegionalPreferences,
  type RegionalCapabilityReport
} from '../../shared/regional'

const PARTITION_PERSIST = (id: string) => `persist:nexa-${id}`
const PARTITION_PRIVATE = (id: string) => `nexa-private-${id}`

/**
 * STEP 10 — RegionalService. The ONLY main-process boundary that applies profile
 * regional preferences to Chromium. It performs exactly one real browser-level
 * action: setting the profile session's **Accept-Language** header via the
 * capability-specific `session.setUserAgent(ua, acceptLanguages)` API — never a
 * generic header interceptor, never JS injection, never fingerprint spoofing.
 *
 * Chromium's runtime timezone/locale are process-global and cannot be overridden
 * per session through a stable Electron API; the service reports that honestly via
 * `capabilityReport()` and does NOT fake it.
 */
export class RegionalService {
  constructor(private persist: Persistence) {}

  /** Load, validate and apply the profile's regional prefs. Returns an honest report. */
  apply(profileId: string): RegionalCapabilityReport {
    const id = assertSafeProfileId(profileId)
    const prefs = this.persist.loadProfilePrefs(id)
    const regional = (prefs as { regional?: Partial<ProfileRegionalPreferences> }).regional
    const v = validateRegional(regional)
    const report = capabilityReport(v.ok ? v.value : null)
    if (!v.ok) return report // INVALID_CONFIGURATION — apply nothing.

    const accept = buildAcceptLanguage(v.value.languages)
    if (accept) {
      for (const part of [PARTITION_PERSIST(id), PARTITION_PRIVATE(id)]) {
        try {
          const sess = electronSession.fromPartition(part)
          // Preserve the existing UA; only set the Accept-Language list.
          sess.setUserAgent(sess.getUserAgent(), accept)
        } catch {
          /* a partition may not exist yet; it will be applied on next attach */
        }
      }
    }
    return report
  }

  /** Apply for many profiles at startup (best-effort, never throws). */
  applyForProfiles(ids: string[]): void {
    for (const id of ids) {
      try {
        this.apply(id)
      } catch {
        /* ignore per-profile failure */
      }
    }
  }
}

/**
 * NEXA browser permission policy — pure, dependency-free, and shared so the exact
 * same decision logic can be unit-tested and applied to EVERY session NEXA uses
 * (defaultSession, persistent profile partitions, and private profile partitions).
 *
 * Principle: DENY BY DEFAULT. Only a small set of low-risk, browsing-essential
 * permissions are granted automatically. Sensitive/device/privacy permissions
 * (camera, microphone, geolocation, media, HID/serial/USB, display-capture, etc.)
 * are DENIED because NEXA has no in-product consent prompt; granting them without
 * explicit consent would violate the deny-by-default principle. When a consent UI
 * is introduced in a future phase, those permissions can be elevated to
 * "prompt" rather than "deny".
 *
 * This policy is applied identically to all sessions, so a tab in a profile
 * partition can never fall back to Electron's permissive defaults.
 */

/**
 * Low-risk, browsing-essential permissions granted automatically.
 * - clipboard-sanitized-write: sanitized clipboard write (safe, no read access).
 * - notifications: pre-existing NEXA behavior; low-risk, no data exfiltration.
 * - fullscreen: user-gesture initiated; required for normal video/site UX.
 * - pointerLock: user-gesture initiated; required for canvas/game/site UX.
 */
export const NEXA_ALLOWED_PERMISSIONS = [
  'clipboard-sanitized-write',
  'notifications',
  'fullscreen',
  'pointerLock'
] as const

export type NexaAllowedPermission = (typeof NEXA_ALLOWED_PERMISSIONS)[number]

/**
 * Sensitive permissions explicitly denied (documented for auditability). This is
 * NOT the enforcement list — enforcement is deny-by-default via
 * {@link isPermissionAllowed}. This list documents the intent for the
 * high-risk capabilities so reviewers can see they are consciously blocked.
 */
export const NEXA_DENIED_SENSITIVE_PERMISSIONS = [
  'geolocation',
  'media', // camera + microphone
  'mediaKeySystem', // EME / DRM
  'midi',
  'midiSysex',
  'hid',
  'serial',
  'usb',
  'openExternal',
  'idle-detection',
  'display-capture',
  'speaker-selection',
  'window-management',
  'keyboardLock',
  'clipboard-read',
  'storage-access',
  'top-level-storage-access',
  'fileSystem',
  'unknown'
] as const

/**
 * The single source of truth for every NEXA permission decision.
 * Deny-by-default: only members of {@link NEXA_ALLOWED_PERMISSIONS} return true.
 */
export function isPermissionAllowed(permission: string): boolean {
  return (NEXA_ALLOWED_PERMISSIONS as readonly string[]).includes(permission)
}

/** Persistent (on-disk) partition name for a profile. */
export function persistPartition(profileId: string): string {
  return `persist:nexa-${profileId}`
}

/** Private (in-memory, non-persistent) partition name for a profile. */
export function privatePartition(profileId: string): string {
  return `nexa-private-${profileId}`
}

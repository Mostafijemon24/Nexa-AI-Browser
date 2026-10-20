import type { Session } from 'electron'
import { isPermissionAllowed } from '../../shared/permissions'

/**
 * Install NEXA's deny-by-default permission policy on a single Electron session.
 *
 * Both handlers are set so the policy is enforced for the two paths Chromium
 * uses: the async request path (setPermissionRequestHandler) and the synchronous
 * check path (setPermissionCheckHandler, consulted by many Web APIs before they
 * even raise a request). The decision itself comes from the shared, unit-tested
 * `isPermissionAllowed` — the origin/URL supplied by the renderer is never used
 * to widen the decision.
 */
export function applyPermissionPolicy(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(isPermissionAllowed(permission))
  })
  ses.setPermissionCheckHandler((_wc, permission) => isPermissionAllowed(permission))
}

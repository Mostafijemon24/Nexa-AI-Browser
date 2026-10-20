import type { VpnCapability, VpnState } from './vpn'

/**
 * Pure UI projection for the VPN control. This is the SINGLE source of truth for
 * how the authoritative backend `VpnStatus` maps to renderer presentation +
 * available actions. The toolbar, popover, dashboard widget, and command
 * palette all derive from this so they can never disagree, and it is fully unit
 * testable without React.
 *
 * It never invents state: it only projects (state, capability, hasServers) that
 * already come from the main process. It cannot produce `PROTECTED` — that word
 * only appears when the backend state is already `protected`.
 */
export type VpnPrimaryAction = 'connect' | 'disconnect' | 'cancel' | 'retry' | 'configure' | 'none'
export type VpnTone = 'ok' | 'warn' | 'err' | 'idle'
export type VpnCommand = 'connect' | 'disconnect' | 'reconnect' | 'configure' | 'settings'

export interface VpnUiInput {
  state: VpnState
  capability: VpnCapability
  hasServers: boolean
}

export interface VpnUiProjection {
  /** Full status label, e.g. "PROTECTED", "CONNECTING…", "NOT CONFIGURED". */
  label: string
  /** Short toolbar label (same words, glanceable). */
  short: string
  tone: VpnTone
  /** The primary button's action in the popover / dashboard. */
  primary: VpnPrimaryAction
  primaryLabel: string
  canConnect: boolean
  canDisconnect: boolean
  canReconnect: boolean
  busy: boolean
  /** Command-palette actions valid for the current state. */
  commands: VpnCommand[]
  /** Accessible label announced to assistive tech. */
  ariaLabel: string
}

const LABELS: Record<VpnState, string> = {
  not_configured: 'NOT CONFIGURED',
  off: 'OFF',
  connecting: 'CONNECTING…',
  protected: 'PROTECTED',
  disconnecting: 'DISCONNECTING…',
  error: 'ERROR'
}

const ARIA: Record<VpnState, string> = {
  not_configured: 'VPN not configured',
  off: 'VPN disconnected',
  connecting: 'VPN connecting',
  protected: 'VPN protected',
  disconnecting: 'VPN disconnecting',
  error: 'VPN connection error'
}

export function vpnUiProjection(input: VpnUiInput): VpnUiProjection {
  const { state, capability, hasServers } = input
  // "Configured" means the engine can actually run AND a server exists.
  const configurable = capability !== 'unavailable' && hasServers

  const base = {
    label: LABELS[state],
    short: LABELS[state],
    ariaLabel: ARIA[state]
  }

  // NOT_CONFIGURED (or capability missing / no server) always routes to setup.
  if (state === 'not_configured' || (state === 'off' && !configurable)) {
    return {
      ...base,
      label: 'NOT CONFIGURED',
      short: 'NOT CONFIGURED',
      ariaLabel: 'VPN not configured',
      tone: 'idle',
      primary: 'configure',
      primaryLabel: capability === 'unavailable' ? 'Open VPN settings' : 'Import configuration',
      canConnect: false,
      canDisconnect: false,
      canReconnect: false,
      busy: false,
      commands: ['configure', 'settings']
    }
  }

  switch (state) {
    case 'off':
      return {
        ...base,
        tone: 'idle',
        primary: 'connect',
        primaryLabel: 'Connect',
        canConnect: true,
        canDisconnect: false,
        canReconnect: false,
        busy: false,
        commands: ['connect', 'settings']
      }
    case 'connecting':
      return {
        ...base,
        tone: 'warn',
        primary: 'cancel',
        primaryLabel: 'Cancel',
        canConnect: false,
        canDisconnect: true,
        canReconnect: false,
        busy: true,
        commands: ['disconnect', 'settings']
      }
    case 'protected':
      return {
        ...base,
        tone: 'ok',
        primary: 'disconnect',
        primaryLabel: 'Disconnect',
        canConnect: false,
        canDisconnect: true,
        canReconnect: true,
        busy: false,
        commands: ['disconnect', 'reconnect', 'settings']
      }
    case 'disconnecting':
      return {
        ...base,
        tone: 'warn',
        primary: 'none',
        primaryLabel: 'Disconnecting…',
        canConnect: false,
        canDisconnect: false,
        canReconnect: false,
        busy: true,
        commands: ['settings']
      }
    case 'error':
      return {
        ...base,
        tone: 'err',
        primary: 'retry',
        primaryLabel: 'Retry',
        canConnect: true,
        canDisconnect: false,
        canReconnect: true,
        busy: false,
        commands: ['reconnect', 'settings']
      }
    default:
      return {
        ...base,
        tone: 'idle',
        primary: 'none',
        primaryLabel: '',
        canConnect: false,
        canDisconnect: false,
        canReconnect: false,
        busy: false,
        commands: ['settings']
      }
  }
}

/** Map tone → existing NEXA color token for the status dot. */
export function vpnToneColor(tone: VpnTone): string {
  switch (tone) {
    case 'ok':
      return 'var(--success)'
    case 'warn':
      return 'var(--warning)'
    case 'err':
      return 'var(--error)'
    default:
      return 'var(--text-3)'
  }
}

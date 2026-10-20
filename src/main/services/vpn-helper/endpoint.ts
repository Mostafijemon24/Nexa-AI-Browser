/**
 * Canonical privileged-helper IPC endpoint per platform. Kept short (macOS unix
 * socket paths are limited to ~104 chars) and in a root-owned location so an
 * unprivileged local process cannot pre-create/hijack it.
 *
 * These are the PRODUCTION endpoints. The socket/pipe is created by the
 * installed privileged helper (see NEXA_P4_2_SIGNING_AND_INSTALLER.md); the
 * main process only ever connects as a client.
 */
export type HelperPlatform = 'macos' | 'windows' | 'linux'

export interface HelperEndpoint {
  /** Kind of transport used to reach the helper. */
  kind: 'unix-socket' | 'named-pipe'
  /** Socket path or pipe name passed to node:net. */
  path: string
}

const WINDOWS_PIPE = '\\\\.\\pipe\\nexa-vpn-helper'
const MAC_SOCKET = '/var/run/nexa-vpn-helper.sock'
const LINUX_SOCKET = '/run/nexa-vpn-helper.sock'

export function helperEndpoint(platform: HelperPlatform): HelperEndpoint {
  if (platform === 'windows') return { kind: 'named-pipe', path: WINDOWS_PIPE }
  if (platform === 'macos') return { kind: 'unix-socket', path: MAC_SOCKET }
  return { kind: 'unix-socket', path: LINUX_SOCKET }
}

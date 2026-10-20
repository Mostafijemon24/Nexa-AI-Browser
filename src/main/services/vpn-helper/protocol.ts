import type { HelperRequest, HelperResponse } from '../../../shared/vpn-helper'

/**
 * Wire framing for the privileged-helper channel: newline-delimited JSON. This
 * is deliberately trivial and transport-agnostic (works over stdio, a unix
 * socket, or a Windows named pipe). Pure + easily testable.
 */

export function encodeMessage(msg: HelperRequest | HelperResponse): string {
  return JSON.stringify(msg) + '\n'
}

/**
 * Decode as many complete newline-terminated JSON messages as are present in
 * `buffer`, returning the parsed messages plus any trailing partial fragment.
 * Malformed lines are skipped (never throw across the boundary).
 */
export function decodeMessages(buffer: string): { messages: unknown[]; rest: string } {
  const messages: unknown[] = []
  let rest = buffer
  let idx: number
  while ((idx = rest.indexOf('\n')) >= 0) {
    const line = rest.slice(0, idx).trim()
    rest = rest.slice(idx + 1)
    if (!line) continue
    try {
      messages.push(JSON.parse(line))
    } catch {
      // Skip corrupt frame; the client correlates by requestId so a dropped
      // frame simply times out rather than crashing the channel.
    }
  }
  return { messages, rest }
}

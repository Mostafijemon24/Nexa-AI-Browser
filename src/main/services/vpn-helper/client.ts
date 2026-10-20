import { randomUUID } from 'node:crypto'
import {
  HelperRequestError,
  HELPER_PROTOCOL_VERSION,
  notInstalledHelper,
  type HelperErrorCode,
  type HelperInfo,
  type HelperOp,
  type HelperRequest,
  type HelperResponse
} from '../../../shared/vpn-helper'
import { decodeMessages, encodeMessage } from './protocol'

/**
 * Renderer NEVER sees this. The main VPN service is the only caller. The client
 * speaks the newline-JSON protocol to whatever transport connects it to the
 * installed privileged helper (unix socket / named pipe / stdio of a privileged
 * process). The transport is injected so it is fully testable via loopback.
 */
export interface VpnHelperClient {
  detect(): Promise<HelperInfo>
  request<T = unknown>(op: HelperOp, payload: unknown, timeoutMs?: number): Promise<T>
  close(): void
}

export interface HelperTransport {
  send(line: string): void
  onMessage(cb: (line: string) => void): void
  onClose(cb: () => void): void
  close(): void
}

/** Production default when no privileged helper is installed/wired. Honest. */
export class UninstalledHelperClient implements VpnHelperClient {
  async detect(): Promise<HelperInfo> {
    return notInstalledHelper()
  }
  async request<T = unknown>(): Promise<T> {
    throw new HelperRequestError('VPN_HELPER_NOT_INSTALLED')
  }
  close(): void {
    /* no-op */
  }
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: HelperRequestError) => void
  timer: ReturnType<typeof setTimeout>
}

export interface StdioHelperClientOptions {
  defaultTimeoutMs?: number
}

/**
 * Correlated request/response client over a line-delimited transport. Handles
 * timeouts, protocol-version checks, transport failure, and cleanup.
 */
export class StdioHelperClient implements VpnHelperClient {
  private transport: HelperTransport | null = null
  private buffer = ''
  private pending = new Map<string, Pending>()
  private defaultTimeoutMs: number
  private closed = false

  constructor(private connect: () => HelperTransport, opts: StdioHelperClientOptions = {}) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 25_000
  }

  private ensure(): HelperTransport {
    if (this.transport) return this.transport
    const t = this.connect()
    t.onMessage((line) => this.onData(line))
    t.onClose(() => this.onClosed())
    this.transport = t
    return t
  }

  private onData(chunk: string) {
    this.buffer += chunk
    const { messages, rest } = decodeMessages(this.buffer)
    this.buffer = rest
    for (const msg of messages) this.dispatch(msg as HelperResponse)
  }

  private dispatch(res: HelperResponse) {
    if (!res || typeof res !== 'object' || typeof res.requestId !== 'string') return
    const p = this.pending.get(res.requestId)
    if (!p) return
    this.pending.delete(res.requestId)
    clearTimeout(p.timer)
    if (res.protocol !== HELPER_PROTOCOL_VERSION) return p.reject(new HelperRequestError('VPN_HELPER_VERSION_MISMATCH'))
    if (res.ok) return p.resolve(res.result)
    p.reject(new HelperRequestError((res.error?.code as HelperErrorCode) || 'VPN_HELPER_PROTOCOL_ERROR'))
  }

  private onClosed() {
    this.transport = null
    const err = new HelperRequestError('VPN_HELPER_UNAVAILABLE')
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  async detect(): Promise<HelperInfo> {
    try {
      await this.request('probeWireGuard', {}, 6000)
      return { installed: true, authorized: true, version: HELPER_PROTOCOL_VERSION, state: 'installed' }
    } catch (e) {
      const code = e instanceof HelperRequestError ? e.code : 'VPN_HELPER_UNAVAILABLE'
      if (code === 'VPN_HELPER_UNAUTHORIZED') return { installed: true, authorized: false, version: null, state: 'needs_authorization' }
      if (code === 'VPN_HELPER_VERSION_MISMATCH') return { installed: true, authorized: false, version: null, state: 'error' }
      return notInstalledHelper()
    }
  }

  request<T = unknown>(op: HelperOp, payload: unknown, timeoutMs?: number): Promise<T> {
    if (this.closed) return Promise.reject(new HelperRequestError('VPN_HELPER_UNAVAILABLE'))
    let transport: HelperTransport
    try {
      transport = this.ensure()
    } catch {
      return Promise.reject(new HelperRequestError('VPN_HELPER_NOT_INSTALLED'))
    }
    const requestId = randomUUID()
    const req: HelperRequest = { protocol: HELPER_PROTOCOL_VERSION, requestId, op, payload }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new HelperRequestError('VPN_HELPER_TIMEOUT'))
      }, timeoutMs ?? this.defaultTimeoutMs)
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer })
      try {
        transport.send(encodeMessage(req))
      } catch {
        this.pending.delete(requestId)
        clearTimeout(timer)
        reject(new HelperRequestError('VPN_HELPER_UNAVAILABLE'))
      }
    })
  }

  close(): void {
    this.closed = true
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new HelperRequestError('VPN_HELPER_UNAVAILABLE'))
    }
    this.pending.clear()
    this.transport?.close()
    this.transport = null
  }
}

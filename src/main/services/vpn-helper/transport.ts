import net from 'node:net'
import type { HelperTransport } from './client'

export interface SocketTransportOptions {
  /** Unix socket path or Windows named-pipe name. */
  path: string
  /** Milliseconds to wait for the initial connection before giving up. */
  connectTimeoutMs?: number
}

/**
 * Production transport to the privileged helper over a unix domain socket
 * (macOS/Linux) or a Windows named pipe. Both are handled by `node:net`, which
 * accepts a pipe path of the form `\\.\pipe\...` on Windows.
 *
 * The main process only ever CONNECTS as a client; the socket/pipe is created
 * and owned by the installed privileged helper. If the endpoint does not exist
 * (no helper installed) the connection fails and the client reports the helper
 * as not installed — it never falls back to a fake capability.
 */
export class SocketHelperTransport implements HelperTransport {
  private socket: net.Socket | null = null
  private msgCb?: (line: string) => void
  private closeCb?: () => void
  private connectTimeoutMs: number

  constructor(private opts: SocketTransportOptions) {
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 5000
  }

  /** Lazily open the connection on first send; StdioHelperClient reconnects on close. */
  private ensure(): net.Socket {
    if (this.socket) return this.socket
    const s = net.createConnection({ path: this.opts.path })
    s.setEncoding('utf8')
    // Guard against a hung connect that never errors or connects.
    const connectTimer = setTimeout(() => s.destroy(new Error('connect_timeout')), this.connectTimeoutMs)
    s.once('connect', () => clearTimeout(connectTimer))
    s.on('data', (d: string) => this.msgCb?.(d))
    s.on('error', () => this.fail(connectTimer))
    s.on('close', () => this.fail(connectTimer))
    this.socket = s
    return s
  }

  private fail(connectTimer: ReturnType<typeof setTimeout>) {
    clearTimeout(connectTimer)
    if (!this.socket) return
    this.socket = null
    this.closeCb?.()
  }

  send(line: string): void {
    this.ensure().write(line)
  }

  onMessage(cb: (line: string) => void): void {
    this.msgCb = cb
  }

  onClose(cb: () => void): void {
    this.closeCb = cb
  }

  close(): void {
    const s = this.socket
    this.socket = null
    s?.destroy()
  }
}

import { describe, expect, it } from 'vitest'
import { HELPER_PROTOCOL_VERSION } from '../../src/shared/vpn-helper'
import { handleHelperRequest, type CommandResult, type CommandRunner, type HelperDeps, type TempConfig } from '../../src/main/services/vpn-helper/handler'

const KEY = 'A'.repeat(42) + 'A='
const KEY2 = 'B'.repeat(42) + 'E='

interface Call {
  cmd: string
  args: string[]
}

class FakeRunner implements CommandRunner {
  calls: Call[] = []
  // Map by the second arg (up/down/show/--version) to a scripted result.
  script: Record<string, CommandResult> = {}
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    this.calls.push({ cmd, args })
    const key = args[0] // up | down | show | --version
    return this.script[key] || { code: 0, stdout: '', stderr: '' }
  }
}

class FakeTempConfig implements TempConfig {
  written: { path: string; contents: string }[] = []
  cleaned: string[] = []
  write(interfaceName: string, contents: string): string {
    const path = `/tmp/nexa-vpn-helper/${interfaceName}.conf`
    this.written.push({ path, contents })
    return path
  }
  cleanup(path: string): void {
    this.cleaned.push(path)
  }
}

class RecordingLogger {
  entries: { event: string; meta?: Record<string, unknown> }[] = []
  info(event: string, meta?: Record<string, unknown>) {
    this.entries.push({ event, meta })
  }
  warn(event: string, meta?: Record<string, unknown>) {
    this.entries.push({ event, meta })
  }
}

function makeDeps(runner = new FakeRunner(), tempConfig = new FakeTempConfig(), logger = new RecordingLogger()): HelperDeps & { runner: FakeRunner; tempConfig: FakeTempConfig; logger: RecordingLogger } {
  return { runner, tempConfig, logger, paths: { wg: '/usr/bin/wg', wgQuick: '/usr/bin/wg-quick' }, platform: 'linux' }
}

function upReq() {
  return {
    protocol: HELPER_PROTOCOL_VERSION,
    requestId: 'up1',
    op: 'bringTunnelUp',
    payload: {
      interfaceName: 'nexaalpha',
      config: {
        privateKey: KEY,
        address: ['10.0.0.2/32'],
        dns: ['1.1.1.1'],
        peerPublicKey: KEY2,
        endpoint: 'vpn.example.com:51820',
        allowedIPs: ['0.0.0.0/0', '::/0'],
        ipv6: 'block',
        persistentKeepalive: 25
      }
    }
  }
}

describe('helper handler — bringTunnelUp', () => {
  it('runs wg-quick up with an argument array (no shell) and cleans the temp config', async () => {
    const deps = makeDeps()
    const res = await handleHelperRequest(upReq(), deps)
    expect(res.ok).toBe(true)
    expect(res.result).toMatchObject({ interfaceName: 'nexaalpha', up: true })
    const call = deps.runner.calls.find((c) => c.args[0] === 'up')!
    expect(call.cmd).toBe('/usr/bin/wg-quick')
    expect(call.args).toEqual(['up', '/tmp/nexa-vpn-helper/nexaalpha.conf'])
    // temp config removed regardless of outcome
    expect(deps.tempConfig.cleaned).toContain('/tmp/nexa-vpn-helper/nexaalpha.conf')
  })

  it('drops IPv6 AllowedIPs when ipv6=block', async () => {
    const deps = makeDeps()
    await handleHelperRequest(upReq(), deps)
    const contents = deps.tempConfig.written[0].contents
    expect(contents).toContain('AllowedIPs = 0.0.0.0/0')
    expect(contents).not.toContain('::/0')
  })

  it('never writes secrets to the logger', async () => {
    const deps = makeDeps()
    await handleHelperRequest(upReq(), deps)
    const log = JSON.stringify(deps.logger.entries)
    expect(log).not.toContain(KEY)
    expect(log).not.toContain(KEY2)
  })

  it('rolls back (brings the tunnel down) and cleans up when wg-quick up fails', async () => {
    const deps = makeDeps()
    deps.runner.script['up'] = { code: 1, stdout: '', stderr: 'RTNETLINK answers: operation failed' }
    const res = await handleHelperRequest(upReq(), deps)
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('VPN_INTERFACE_FAILED')
    expect(deps.runner.calls.some((c) => c.args[0] === 'down')).toBe(true)
    expect(deps.tempConfig.cleaned).toHaveLength(1)
  })

  it('maps a permission failure to VPN_PERMISSION_DENIED', async () => {
    const deps = makeDeps()
    deps.runner.script['up'] = { code: 1, stdout: '', stderr: 'wg-quick: must be run as root' }
    const res = await handleHelperRequest(upReq(), deps)
    expect(res.error?.code).toBe('VPN_PERMISSION_DENIED')
  })

  it('maps a missing binary to VPN_WIREGUARD_UNAVAILABLE', async () => {
    const deps = makeDeps()
    deps.runner.script['up'] = { code: 127, stdout: '', stderr: '', spawnError: 'enoent' }
    const res = await handleHelperRequest(upReq(), deps)
    expect(res.error?.code).toBe('VPN_WIREGUARD_UNAVAILABLE')
  })
})

describe('helper handler — validation is enforced helper-side', () => {
  it('rejects an unknown operation without touching the runner', async () => {
    const deps = makeDeps()
    const res = await handleHelperRequest({ protocol: HELPER_PROTOCOL_VERSION, requestId: 'x', op: 'exec', payload: { cmd: 'rm -rf /' } }, deps)
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('VPN_UNKNOWN_OPERATION')
    expect(deps.runner.calls).toHaveLength(0)
  })

  it('rejects an injection-style interface name without touching the runner', async () => {
    const deps = makeDeps()
    const req = { protocol: HELPER_PROTOCOL_VERSION, requestId: 'x', op: 'bringTunnelDown', payload: { interfaceName: 'nexa; reboot' } }
    const res = await handleHelperRequest(req, deps)
    expect(res.ok).toBe(false)
    expect(deps.runner.calls).toHaveLength(0)
  })

  it('rejects a malformed config as VPN_INVALID_CONFIG before running anything', async () => {
    const deps = makeDeps()
    const req = upReq()
    ;(req.payload.config as { endpoint: string }).endpoint = 'no-port-here'
    const res = await handleHelperRequest(req, deps)
    expect(res.error?.code).toBe('VPN_INVALID_CONFIG')
    expect(deps.runner.calls).toHaveLength(0)
  })
})

describe('helper handler — probe / handshake / down', () => {
  it('probes WireGuard availability', async () => {
    const deps = makeDeps()
    deps.runner.script['--version'] = { code: 0, stdout: 'wireguard-tools v1.0.20210914', stderr: '' }
    const res = await handleHelperRequest({ protocol: HELPER_PROTOCOL_VERSION, requestId: 'p', op: 'probeWireGuard', payload: {} }, deps)
    expect(res.ok).toBe(true)
    expect(res.result).toMatchObject({ available: true, implementation: 'wireguard-tools' })
  })

  it('reports unavailable when wg is missing', async () => {
    const deps = makeDeps()
    deps.runner.script['--version'] = { code: 127, stdout: '', stderr: '', spawnError: 'enoent' }
    const res = await handleHelperRequest({ protocol: HELPER_PROTOCOL_VERSION, requestId: 'p', op: 'probeWireGuard', payload: {} }, deps)
    expect(res.result).toMatchObject({ available: false })
  })

  it('parses a real handshake dump', async () => {
    const deps = makeDeps()
    const now = Math.floor(Date.now() / 1000)
    const dump = `PRIV\tPUB\t51820\toff\nPEERPUB\t(none)\t1.2.3.4:51820\t0.0.0.0/0\t${now - 10}\t2048\t1024\t25`
    deps.runner.script['show'] = { code: 0, stdout: dump, stderr: '' }
    const res = await handleHelperRequest({ protocol: HELPER_PROTOCOL_VERSION, requestId: 'h', op: 'queryHandshakeState', payload: { interfaceName: 'nexaalpha' } }, deps)
    expect(res.ok).toBe(true)
    expect(res.result).toMatchObject({ interfaceUp: true, rxBytes: 2048, txBytes: 1024, endpoint: '1.2.3.4:51820' })
    expect((res.result as { handshakeAgeSec: number }).handshakeAgeSec).toBeGreaterThanOrEqual(10)
  })

  it('reports interface down when wg show fails', async () => {
    const deps = makeDeps()
    deps.runner.script['show'] = { code: 1, stdout: '', stderr: 'No such device' }
    const res = await handleHelperRequest({ protocol: HELPER_PROTOCOL_VERSION, requestId: 'h', op: 'queryHandshakeState', payload: { interfaceName: 'nexaalpha' } }, deps)
    expect(res.ok).toBe(true)
    expect(res.result).toMatchObject({ interfaceUp: false })
  })

  it('treats an already-down interface as an idempotent success', async () => {
    const deps = makeDeps()
    deps.runner.script['down'] = { code: 1, stdout: '', stderr: '`nexaalpha` is not a WireGuard interface' }
    const res = await handleHelperRequest({ protocol: HELPER_PROTOCOL_VERSION, requestId: 'd', op: 'bringTunnelDown', payload: { interfaceName: 'nexaalpha' } }, deps)
    expect(res.ok).toBe(true)
    expect(res.result).toMatchObject({ down: true })
  })
})

describe('helper handler — kill switch honesty', () => {
  it('reports kill switch as experimental / not enforced', async () => {
    const deps = makeDeps()
    const res = await handleHelperRequest({ protocol: HELPER_PROTOCOL_VERSION, requestId: 'k', op: 'enableKillSwitch', payload: { interfaceName: 'nexaalpha' } }, deps)
    expect(res.ok).toBe(true)
    expect(res.result).toMatchObject({ enforced: false, experimental: true })
  })
})

export type VpnEngineStatus = 'not_configured'

export const vpnEngine = {
  status: (): VpnEngineStatus => 'not_configured',
  isProtected: () => false
}

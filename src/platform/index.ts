import { MacOSPlatformAdapter } from './macos/index'
import { WindowsPlatformAdapter } from './windows/index'
import { LinuxPlatformAdapter } from './linux/index'
import type { PlatformAdapter } from './types'

export function createPlatformAdapter(platform = process.platform): PlatformAdapter {
  if (platform === 'darwin') return new MacOSPlatformAdapter()
  if (platform === 'win32') return new WindowsPlatformAdapter()
  return new LinuxPlatformAdapter()
}

export type { PlatformAdapter } from './types'
export { assertSafeProfileId } from './types'

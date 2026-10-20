import { app, Notification, shell } from 'electron'
import { join } from 'node:path'
import type { PlatformAdapter } from '../types'
import { assertSafeProfileId } from '../types'

export class LinuxPlatformAdapter implements PlatformAdapter {
  readonly kind = 'linux' as const
  appDataDir() {
    return app.getPath('userData')
  }
  profileDir(profileId: string) {
    return join(this.appDataDir(), 'profiles', assertSafeProfileId(profileId))
  }
  downloadsDir() {
    return app.getPath('downloads')
  }
  notify(title: string, body: string) {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  }
  async openPath(target: string) {
    return shell.openPath(target)
  }
}

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PlatformAdapter } from '../../platform/types'
import { assertSafeProfileId } from '../../platform/types'
import {
  defaultGlobal,
  defaultProfilePrefs,
  defaultProfiles,
  type GlobalState,
  type Profile,
  type ProfilePrefs,
  type SessionState
} from '../../shared/types'
import { fromSessionState, migrateSession, toSessionState } from '../../shared/session'
import { readJsonSafe, writeJsonAtomic } from './fs-atomic'

const readJson = readJsonSafe
const writeJson = writeJsonAtomic

export class Persistence {
  constructor(private platform: PlatformAdapter) {}

  private globalPath() {
    return join(this.platform.appDataDir(), 'global.json')
  }

  private indexPath() {
    return join(this.platform.appDataDir(), 'profiles.json')
  }

  loadGlobal(): GlobalState {
    return { ...defaultGlobal(), ...readJson(this.globalPath(), {}) }
  }

  saveGlobal(state: GlobalState) {
    mkdirSync(this.platform.appDataDir(), { recursive: true })
    writeJson(this.globalPath(), state)
  }

  loadProfilesIndex(): { activeProfile: string; profiles: Record<string, Profile> } {
    const defaults = defaultProfiles()
    const saved = readJson(this.indexPath(), { activeProfile: 'research', profiles: defaults })
    return {
      activeProfile: saved.activeProfile || 'research',
      profiles: { ...defaults, ...saved.profiles }
    }
  }

  saveProfilesIndex(activeProfile: string, profiles: Record<string, Profile>) {
    assertSafeProfileId(activeProfile)
    for (const id of Object.keys(profiles)) assertSafeProfileId(id)
    mkdirSync(this.platform.appDataDir(), { recursive: true })
    writeJson(this.indexPath(), { activeProfile, profiles })
  }

  loadProfilePrefs(profileId: string): ProfilePrefs {
    const id = assertSafeProfileId(profileId)
    const index = this.loadProfilesIndex()
    const accent = index.profiles[id]?.accent ?? '#4b57e6'
    const path = join(this.platform.profileDir(id), 'prefs.json')
    mkdirSync(this.platform.profileDir(id), { recursive: true })
    return { ...defaultProfilePrefs(accent), ...readJson(path, {}) }
  }

  saveProfilePrefs(profileId: string, prefs: ProfilePrefs) {
    const id = assertSafeProfileId(profileId)
    mkdirSync(this.platform.profileDir(id), { recursive: true })
    writeJson(join(this.platform.profileDir(id), 'prefs.json'), prefs)
  }

  loadSession(profileId: string): SessionState {
    const id = assertSafeProfileId(profileId)
    const raw = readJson<unknown>(join(this.platform.profileDir(id), 'session.json'), null)
    return toSessionState(migrateSession(raw, id))
  }

  saveSession(profileId: string, session: SessionState) {
    const id = assertSafeProfileId(profileId)
    mkdirSync(this.platform.profileDir(id), { recursive: true })
    writeJson(join(this.platform.profileDir(id), 'session.json'), fromSessionState(session, id))
  }

  profileDir(profileId: string): string {
    return this.platform.profileDir(assertSafeProfileId(profileId))
  }

  vaultPath(profileId: string) {
    return join(this.platform.profileDir(assertSafeProfileId(profileId)), 'vault.json')
  }

  downloadsDir() {
    return this.platform.downloadsDir()
  }
}

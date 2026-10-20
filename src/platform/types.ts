export interface PlatformAdapter {
  readonly kind: 'macos' | 'windows' | 'linux'
  appDataDir(): string
  profileDir(profileId: string): string
  downloadsDir(): string
  notify(title: string, body: string): void
  openPath(target: string): Promise<string>
}

export function assertSafeProfileId(id: string): string {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    throw new Error('invalid_profile_id')
  }
  return id
}

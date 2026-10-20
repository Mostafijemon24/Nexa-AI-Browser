import type { AddrStyle, MotionMode, RadiusMode, ThemeMode } from '@shared/types'

const RADIUS: Record<string, string> = {
  sharp: '0px',
  compact: '6px',
  balanced: '9px',
  rounded: '14px'
}

const DENSITY_PAD: Record<string, string> = {
  compact: '12px',
  comfortable: '15px',
  spacious: '19px'
}

export function applyTheme(root: HTMLElement, opts: {
  theme: ThemeMode
  accent: string
  radius: RadiusMode
  addrStyle: AddrStyle
  motion: MotionMode
  density: string
}) {
  const dark = opts.theme === 'dark'
  root.setAttribute('data-theme', opts.theme)
  root.setAttribute('data-motion', opts.motion)
  root.style.setProperty('--accent', opts.accent)
  root.style.setProperty(
    '--accent-2',
    dark ? `color-mix(in srgb, ${opts.accent} 68%, #fff)` : `color-mix(in srgb, ${opts.accent} 82%, #000)`
  )
  root.style.setProperty(
    '--accent-weak',
    dark ? `color-mix(in srgb, ${opts.accent} 22%, #0f131a)` : `color-mix(in srgb, ${opts.accent} 12%, #fff)`
  )
  root.style.setProperty('--r', RADIUS[opts.radius] || '9px')
  root.style.setProperty('--dash-pad', DENSITY_PAD[opts.density] || '15px')
  if (opts.addrStyle === 'gradient') {
    root.style.setProperty('--addr-bg', 'linear-gradient(90deg, var(--accent-weak), var(--surface-2))')
    root.style.setProperty('--addr-backdrop', 'none')
  } else if (opts.addrStyle === 'glass') {
    root.style.setProperty('--addr-bg', dark ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.55)')
    root.style.setProperty('--addr-backdrop', 'blur(10px) saturate(1.4)')
  } else {
    root.style.setProperty('--addr-bg', 'var(--surface-2)')
    root.style.setProperty('--addr-backdrop', 'none')
  }
}

export const ACCENT_SWATCHES = ['#4b57e6', '#0891b2', '#7c3aed', '#0f9d6b', '#e0851b', '#e0447a', '#7c8698', '#0f766e']

export const THEME_PRESETS = [
  { name: 'Pure Light', mode: 'light' as const, accent: '#4b57e6', bg: 'default' },
  { name: 'Midnight', mode: 'dark' as const, accent: '#7c84f5', bg: 'default' },
  { name: 'Research Green', mode: 'light' as const, accent: '#0f9d6b', bg: 'mesh' },
  { name: 'Dev Ember', mode: 'dark' as const, accent: '#e0851b', bg: 'aurora' }
]

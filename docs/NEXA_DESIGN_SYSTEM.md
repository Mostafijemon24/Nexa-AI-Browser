# NEXA Design System

One token system. Do not scatter literal values — define these centrally and consume them.

## Typography
- **UI font:** `IBM Plex Sans`, fallback `system-ui, sans-serif`.
- **Technical/numeric font:** `IBM Plex Mono` — used for sizes, speeds, IPs, counts, hashes, badges.
- Antialiased. `text-wrap: pretty` on long headings/paragraphs.
- Scale (px): page title 22 / 700; section title 15–17 / 600; body 13–14.5 / 400; label 11–12.5; meta/mono 10–11.5; badges 8.5–10 mono, letter-spacing .02–.06em uppercase.

## Color tokens (semantic — light / dark)
| Token | Light | Dark |
|---|---|---|
| `--bg` | `#e8eaed` | `#08090b` |
| `--chrome` | `#e6e8eb` | `#141619` |
| `--chrome-2` | `#dde0e4` | `#1a1d21` |
| `--surface` | `#ffffff` | `#141619` |
| `--surface-2` | `#f5f6f8` | `#1b1f25` |
| `--elevated` | `#ffffff` | `#20242b` |
| `--border` | `#dde0e4` | `#282d34` |
| `--border-2` | `#c9ced4` | `#373d46` |
| `--text` | `#161a20` | `#eef1f5` |
| `--text-2` | `#565e6b` | `#9aa3b1` |
| `--text-3` | `#8b93a1` | `#646d7a` |
| `--accent` | `#4b57e6` | `#7c84f5` |
| `--success` | `#12905a` | `#3cbf84` |
| `--warning` | `#a76a09` | `#e0a340` |
| `--error` | `#cf423e` | `#f0605c` |

Each status has a `-weak` background variant (e.g. `--success-weak`, `--accent-weak`).

### Accent-variant generation (color intelligence)
From any chosen `--accent` (preset or custom), derive at runtime — do NOT hardcode:
- Light mode: `--accent-2 = color-mix(in srgb, accent 82%, #000)`, `--accent-weak = color-mix(in srgb, accent 12%, #fff)`.
- Dark mode: `--accent-2 = color-mix(in srgb, accent 68%, #fff)`, `--accent-weak = color-mix(in srgb, accent 22%, #0f131a)`.
Enforce ≥4.5:1 text contrast; surface a contrast warning + auto-fix when custom accents fail.

## Radius scale (`--r`, user-selectable)
sharp `0px` · compact `6px` · balanced `9px` (default) · rounded `14px`. Cards/modals 11–14px.

## Elevation / shadow
- `--shadow`: `0 1px 2px rgba(16,20,28,.05), 0 6px 20px rgba(16,20,28,.07)` (light) / heavier dark equivalents.
- `--shadow-lg`: popovers/modals — `0 18px 50px rgba(16,20,28,.20)` (light) / `0 22px 60px rgba(0,0,0,.66)` (dark).

## Spacing & density
4px base. Row heights: tab 32, toolbar control 32–34, list row 44+ (min touch), settings row ~14px vertical padding. Density modes scale card padding: compact 12 / comfortable 15 / spacious 19.

## Motion (`data-motion`, respect reduced-motion)
none / minimal / smooth (default) / expressive. Transitions .12–.22s ease. Keyframes: `cpop` (popover in), `cslide` (view in), `caurora`/`cdrift` (ambient bg), `cbar` (progress stripe). `@media (prefers-reduced-motion: reduce)` forces ~0 durations.

## Component states (every interactive element)
default · hover · active · selected · focus (visible ring) · disabled (explained) · loading · success · error · empty · unavailable · requires-auth · requires-permission.

## Layout primitives
Flex/grid with `gap` (not margin-per-child) so drag-reorder/delete survive. Fixed 1360×852 desktop window frame in the prototype; production uses the OS window. Address-bar styles: solid / gradient / glass (via `--addr-bg` + `--addr-backdrop`).

## Iconography
Phosphor Icons, single family, consistent optical sizes (13–22px). Each icon: canonical name, size, weight (regular/bold/fill), a11y label.

## Do-not
No second design system. No arbitrary radius/gradient/neon/glassmorphism beyond the tokens. No color as sole state signal (pair with icon/text).

/**
 * In-process rate limiting. Per-minute windows live in memory (single gateway
 * process); the persistent daily quota lives in the database (`usage_daily`).
 * Running several gateway replicas requires a shared store for these windows.
 */

export interface LimitResult {
  ok: boolean
  retryAfterSeconds: number
}

/** Sliding-window-log limiter keyed by an arbitrary string. */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>()
  private lastSweep = 0

  constructor(private windowMs: number) {}

  check(key: string, limit: number, now: number): LimitResult {
    this.sweep(now)
    const from = now - this.windowMs
    const arr = (this.hits.get(key) || []).filter((t) => t > from)
    if (arr.length >= limit) {
      this.hits.set(key, arr)
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((arr[0] + this.windowMs - now) / 1000)) }
    }
    arr.push(now)
    this.hits.set(key, arr)
    return { ok: true, retryAfterSeconds: 0 }
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return
    this.lastSweep = now
    const from = now - this.windowMs
    for (const [k, arr] of this.hits) {
      const kept = arr.filter((t) => t > from)
      if (kept.length) this.hits.set(k, kept)
      else this.hits.delete(k)
    }
  }
}

/** Caps simultaneous in-flight generations per user. */
export class ConcurrencyGate {
  private active = new Map<string, number>()

  acquire(key: string, max: number): (() => void) | null {
    const n = this.active.get(key) || 0
    if (n >= max) return null
    this.active.set(key, n + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const cur = (this.active.get(key) || 1) - 1
      if (cur <= 0) this.active.delete(key)
      else this.active.set(key, cur)
    }
  }
}

/** UTC day bucket for daily quotas. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/** Deterministic, provider-agnostic token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  return text ? Math.ceil(text.length / 4) : 0
}

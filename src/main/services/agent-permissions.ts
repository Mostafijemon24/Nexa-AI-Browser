import {
  isSafeHttpUrl,
  type AgentMode,
  type PermissionDecision,
  type RiskLevel,
  type ToolDef,
  type ToolSecurityClass
} from '../../shared/agent'

/**
 * NEXA P5.1 — centralized Browser Agent permission engine.
 *
 * All permission decisions live here (never scattered across UI components).
 * The engine is a pure function of (tool, arguments, live origin, profile,
 * private mode). It NEVER trusts a model-supplied domain — callers must pass
 * the origin resolved from the live Chromium page.
 */

export interface PermissionInput {
  tool: ToolDef
  arguments: Record<string, unknown>
  /** Authoritative origin resolved from the live browser (scheme://host[:port]). */
  origin: string
  profileId: string
  privateMode: boolean
  /** Operating mode; changes whether INTERACTION is automatic or confirm-gated. */
  mode: AgentMode
}

export interface PermissionResult {
  decision: PermissionDecision
  risk: RiskLevel
  /** Human-readable, specific summary for the confirmation UI. Never vague. */
  summary: string
}

/** Parse an origin into scheme/host/port; never trusts model-provided URLs. */
export function parseOrigin(url: string): { scheme: string; host: string; port: string } | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return { scheme: u.protocol.replace(':', ''), host: u.hostname, port: u.port }
  } catch {
    return null
  }
}

function originLabel(origin: string): string {
  const p = parseOrigin(origin)
  return p ? `${p.host}${p.port ? ':' + p.port : ''}` : 'this page'
}

export class PermissionEngine {
  /**
   * Decide allow / deny / ask for a validated tool call.
   *
   * Policy (P5.1 defaults):
   *   READ, NAVIGATION, low/medium INTERACTION  → allow (automatic)
   *   type into a field flagged secret           → ask
   *   fill_form (SENSITIVE)                       → ask
   *   download (DATA, writes to disk)             → ask
   *   DESTRUCTIVE / high risk                     → deny (not implemented)
   */
  evaluate(input: PermissionInput): PermissionResult {
    const { tool, arguments: args, origin, mode } = input
    const risk = tool.risk
    const where = originLabel(origin)

    // ASK mode performs no browser actions beyond reading.
    if (mode === 'ask' && tool.security !== 'READ') {
      return { decision: 'deny', risk, summary: 'Ask mode does not perform browser actions. Switch to Assist or Agent.' }
    }

    // Navigation: validate the DESTINATION url shape, but the permission decision
    // still uses the actual browser origin for context. Never trust model URL blindly.
    if (tool.security === 'NAVIGATION') {
      if ((tool.name === 'navigate' || tool.name === 'open_tab') && typeof args.url === 'string' && !isSafeHttpUrl(args.url)) {
        return { decision: 'deny', risk, summary: 'Refused: the requested URL is not a valid http(s) address.' }
      }
      const dest = typeof args.url === 'string' ? originLabel(args.url) : where
      return { decision: 'allow', risk, summary: `Navigate/manage tabs (${dest}).` }
    }

    if (tool.security === 'READ') {
      return { decision: 'allow', risk, summary: `Read page content on ${where}.` }
    }

    if (tool.security === 'DESTRUCTIVE') {
      return { decision: 'deny', risk: 'high', summary: `Refused: destructive actions are not permitted.` }
    }

    if (tool.security === 'INTERACTION') {
      // Typing into a field that looks like a secret → always require confirmation.
      if (tool.name === 'type' && looksSecret(args)) {
        return { decision: 'ask', risk: 'high', summary: `Type into a sensitive field on ${where}. NEXA will not enter stored passwords automatically.` }
      }
      // Assist mode confirms every page interaction; Agent mode runs low-risk interaction automatically.
      if (mode === 'assist') {
        return { decision: 'ask', risk, summary: `NEXA (Assist) wants to ${tool.name} on ${where}.` }
      }
      return { decision: 'allow', risk, summary: `Interact with the page on ${where} (${tool.name}).` }
    }

    if (tool.security === 'SENSITIVE') {
      // fill_form is user-controlled by default.
      return { decision: 'ask', risk, summary: `NEXA wants to fill a form on ${where}. It will not submit it.` }
    }

    if (tool.security === 'DATA') {
      if (tool.name === 'download' && typeof args.url === 'string') {
        if (!isSafeHttpUrl(args.url)) return { decision: 'deny', risk, summary: 'Refused: the download URL is not a valid http(s) address.' }
        return { decision: 'ask', risk, summary: `NEXA wants to download a file from ${originLabel(args.url)} using your download settings.` }
      }
      // summarize / save_result / finish — output only, no side effects.
      return { decision: 'allow', risk, summary: `Produce agent output (${tool.name}).` }
    }

    // Unknown class → fail safe.
    return { decision: 'ask', risk: 'high', summary: `Confirm action ${tool.name} on ${where}.` }
  }
}

/** Heuristic: does a `type` call target a secret/password-ish field? */
function looksSecret(args: Record<string, unknown>): boolean {
  const t = args.target as Record<string, unknown> | undefined
  if (!t) return false
  const hay = [t.name, t.label, t.placeholder, t.selector, t.role, t.text]
    .filter((v) => typeof v === 'string')
    .join(' ')
    .toLowerCase()
  return /pass\s*word|passwd|\bpwd\b|\botp\b|one[-\s]?time|\bcvv\b|\bpin\b|secret|security code|card number|credit card/.test(hay)
}

export function riskFor(security: ToolSecurityClass): RiskLevel {
  switch (security) {
    case 'DESTRUCTIVE':
    case 'SENSITIVE':
      return 'high'
    case 'INTERACTION':
    case 'DATA':
      return 'medium'
    default:
      return 'low'
  }
}

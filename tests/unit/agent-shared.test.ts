import { describe, expect, it } from 'vitest'
import {
  parseToolCall,
  validateToolCall,
  extractJsonObject,
  stepSignature,
  isRepeatedLoop,
  canTransition,
  buildPlannerMessages,
  fenceObservation,
  TOOL_REGISTRY,
  HIGH_RISK_UNAVAILABLE,
  AGENT_MAX_ARG_CHARS,
  AGENT_PLANNER_SYSTEM,
  isSafeHttpUrl,
  type AgentToolCall
} from '../../src/shared/agent'
import { UNTRUSTED_OPEN, INJECTION_GUARD } from '../../src/shared/page-content'

describe('extractJsonObject', () => {
  it('extracts a balanced object from surrounding prose', () => {
    expect(extractJsonObject('sure! {"tool":"reload","arguments":{}} done')).toBe('{"tool":"reload","arguments":{}}')
  })
  it('handles braces inside strings', () => {
    expect(extractJsonObject('{"t":"a {b} c"}')).toBe('{"t":"a {b} c"}')
  })
  it('returns null when no object', () => {
    expect(extractJsonObject('no json here')).toBeNull()
  })
})

describe('parseToolCall', () => {
  it('parses a valid tool call', () => {
    const r = parseToolCall('{"thought":"go","tool":"navigate","arguments":{"url":"https://a.com"}}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.call.tool).toBe('navigate')
  })
  it('tolerates prose around the JSON', () => {
    const r = parseToolCall('I will read the page.\n{"tool":"read_page","arguments":{}}')
    expect(r.ok).toBe(true)
  })
  it('rejects empty / non-JSON / arbitrary prose (not treated as command)', () => {
    expect(parseToolCall('').ok).toBe(false)
    expect(parseToolCall('please click the button').ok).toBe(false)
    expect(parseToolCall('{bad json').ok).toBe(false)
  })
})

describe('validateToolCall — registry allowlist', () => {
  const call = (tool: string, args: Record<string, unknown> = {}): AgentToolCall => ({ tool, arguments: args })

  it('accepts a known tool with valid args', () => {
    const r = validateToolCall(call('navigate', { url: 'https://example.com' }))
    expect(r.ok).toBe(true)
  })
  it('rejects unknown tools', () => {
    expect(validateToolCall(call('hack_the_planet')).ok).toBe(false)
    const r = validateToolCall(call('hack_the_planet'))
    if (!r.ok) expect(r.error).toBe('unknown_tool')
  })
  it('rejects high-risk unimplemented intents as not_configured', () => {
    for (const name of ['submit', 'login', 'pay', 'upload', 'send', 'delete_account']) {
      const r = validateToolCall(call(name))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toBe('not_configured')
    }
  })
  it('rejects unavailable tools (screenshot on text model)', () => {
    const r = validateToolCall(call('screenshot'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('capability_unavailable')
  })
  it('rejects invalid arguments and bad URLs', () => {
    expect(validateToolCall(call('navigate', { url: 'javascript:alert(1)' })).ok).toBe(false)
    expect(validateToolCall(call('navigate', { url: 'file:///etc/passwd' })).ok).toBe(false)
    expect(validateToolCall(call('navigate', {})).ok).toBe(false)
    expect(validateToolCall(call('click', {})).ok).toBe(false) // empty target
  })
  it('rejects unexpected/extra fields (strict schemas)', () => {
    expect(validateToolCall(call('reload', { evil: true })).ok).toBe(false)
  })
  it('rejects oversized arguments', () => {
    const big = 'x'.repeat(AGENT_MAX_ARG_CHARS + 100)
    expect(validateToolCall(call('type', { target: { selector: 'input' }, text: big })).ok).toBe(false)
  })
  it('every registered tool has a security class, risk and timeout', () => {
    for (const t of Object.values(TOOL_REGISTRY)) {
      expect(t.security).toBeTruthy()
      expect(t.risk).toBeTruthy()
      expect(t.timeoutMs).toBeGreaterThan(0)
      expect(t.version).toBeTruthy()
    }
  })
})

describe('loop detection', () => {
  it('stable signature is order-independent for args', () => {
    const a = stepSignature('type', { text: 'x', target: { selector: 'a' } })
    const b = stepSignature('type', { target: { selector: 'a' }, text: 'x' })
    expect(a).toBe(b)
  })
  it('detects repeated identical calls', () => {
    const sig = stepSignature('reload', {})
    expect(isRepeatedLoop([sig, sig], sig)).toBe(true) // 2 prior + this = 3
    expect(isRepeatedLoop([sig], sig)).toBe(false)
  })
})

describe('state machine', () => {
  it('allows documented transitions and rejects invalid ones', () => {
    expect(canTransition('idle', 'planning')).toBe(true)
    expect(canTransition('planning', 'executing')).toBe(true)
    expect(canTransition('executing', 'observing')).toBe(true)
    expect(canTransition('observing', 'completed')).toBe(true)
    expect(canTransition('completed', 'planning')).toBe(false)
    expect(canTransition('idle', 'completed')).toBe(false)
  })
})

describe('planner prompt safety', () => {
  it('system prompt carries the injection guard and JSON contract', () => {
    expect(AGENT_PLANNER_SYSTEM).toContain(INJECTION_GUARD)
    expect(AGENT_PLANNER_SYSTEM).toMatch(/single JSON object/i)
  })
  it('builds messages with the tool catalogue and fenced page log', () => {
    const msgs = buildPlannerMessages({
      instruction: 'summarize',
      history: [{ tool: 'read_page', arguments: {}, observation: fenceObservation('hello', true), ok: true }],
      currentPage: { url: 'https://a.com', title: 'A' }
    })
    expect(msgs[0].content).toContain('navigate')
    expect(msgs[1].content).toContain('summarize')
    expect(msgs[1].content).toContain(UNTRUSTED_OPEN) // page-derived observation stays fenced
  })
})

describe('fenceObservation', () => {
  it('fences page-derived text but not internal status', () => {
    expect(fenceObservation('page text', true)).toContain(UNTRUSTED_OPEN)
    expect(fenceObservation('Navigated.', false)).toBe('Navigated.')
  })
})

describe('isSafeHttpUrl', () => {
  it('accepts http/https only', () => {
    expect(isSafeHttpUrl('https://a.com')).toBe(true)
    expect(isSafeHttpUrl('http://a.com')).toBe(true)
    expect(isSafeHttpUrl('ftp://a.com')).toBe(false)
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
  })
})

describe('HIGH_RISK_UNAVAILABLE', () => {
  it('covers the documented high-risk intents', () => {
    for (const n of ['submit', 'login', 'payment', 'upload', 'send', 'delete_account']) {
      expect(HIGH_RISK_UNAVAILABLE.has(n)).toBe(true)
    }
  })
})

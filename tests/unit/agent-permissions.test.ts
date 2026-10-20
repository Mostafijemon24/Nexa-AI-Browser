import { describe, expect, it } from 'vitest'
import { PermissionEngine, parseOrigin } from '../../src/main/services/agent-permissions'
import { TOOL_REGISTRY, type AgentMode } from '../../src/shared/agent'

const engine = new PermissionEngine()

function evalTool(name: string, args: Record<string, unknown>, origin = 'https://example.com', mode: AgentMode = 'agent', privateMode = false) {
  return engine.evaluate({ tool: TOOL_REGISTRY[name], arguments: args, origin, profileId: 'research', privateMode, mode })
}

describe('parseOrigin', () => {
  it('extracts scheme/host/port and rejects non-http', () => {
    expect(parseOrigin('https://a.com:8443/x')).toEqual({ scheme: 'https', host: 'a.com', port: '8443' })
    expect(parseOrigin('file:///x')).toBeNull()
  })
})

describe('PermissionEngine — policy', () => {
  it('auto-allows READ', () => {
    expect(evalTool('read_page', {}).decision).toBe('allow')
    expect(evalTool('extract_data', { kind: 'emails' }).decision).toBe('allow')
    expect(evalTool('list_tabs', {}).decision).toBe('allow')
    expect(evalTool('inspect_forms', {}).decision).toBe('allow')
  })

  it('auto-allows NAVIGATION and validates destination URL', () => {
    expect(evalTool('navigate', { url: 'https://a.com' }).decision).toBe('allow')
    expect(evalTool('go_back', {}).decision).toBe('allow')
    expect(evalTool('navigate', { url: 'javascript:alert(1)' }).decision).toBe('deny')
  })

  it('auto-allows low/medium INTERACTION', () => {
    expect(evalTool('click', { target: { text: 'Search' } }).decision).toBe('allow')
    expect(evalTool('scroll', { direction: 'down' }).decision).toBe('allow')
  })

  it('asks before typing into a secret/password field', () => {
    const r = evalTool('type', { target: { name: 'password' }, text: 'x' })
    expect(r.decision).toBe('ask')
    expect(r.risk).toBe('high')
    expect(evalTool('type', { target: { placeholder: 'Card number' }, text: '1' }).decision).toBe('ask')
    // normal field
    expect(evalTool('type', { target: { name: 'search' }, text: 'x' }).decision).toBe('allow')
  })

  it('asks before fill_form (SENSITIVE) and download (writes to disk)', () => {
    expect(evalTool('fill_form', { fields: [{ target: { name: 'email' }, value: 'a@b.com' }] }).decision).toBe('ask')
    expect(evalTool('download', { url: 'https://a.com/f.zip' }).decision).toBe('ask')
    expect(evalTool('download', { url: 'file:///etc/passwd' }).decision).toBe('deny')
  })

  it('produces a specific, non-vague summary containing the live origin', () => {
    const r = evalTool('fill_form', { fields: [{ target: { name: 'email' }, value: 'a@b.com' }] }, 'https://forms.example.com')
    expect(r.summary).toContain('forms.example.com')
    expect(r.summary.toLowerCase()).not.toBe('allow?')
  })

  it('uses the LIVE origin, never the model-supplied navigate URL, for the decision context', () => {
    // model claims example.com, but the browser is really on evil.example.com
    const r = evalTool('click', { target: { text: 'OK' } }, 'https://evil.example.com')
    expect(r.summary).toContain('evil.example.com')
  })
})

describe('PermissionEngine — mode awareness (Ask / Assist / Agent)', () => {
  it('AGENT mode auto-allows low-risk interaction', () => {
    expect(evalTool('click', { target: { text: 'Search' } }, 'https://a.com', 'agent').decision).toBe('allow')
    expect(evalTool('type', { target: { name: 'q' }, text: 'x' }, 'https://a.com', 'agent').decision).toBe('allow')
  })

  it('ASSIST mode confirms every page interaction but still auto-navigates/reads', () => {
    expect(evalTool('click', { target: { text: 'Search' } }, 'https://a.com', 'assist').decision).toBe('ask')
    expect(evalTool('type', { target: { name: 'q' }, text: 'x' }, 'https://a.com', 'assist').decision).toBe('ask')
    expect(evalTool('scroll', { direction: 'down' }, 'https://a.com', 'assist').decision).toBe('ask')
    expect(evalTool('navigate', { url: 'https://a.com' }, 'https://a.com', 'assist').decision).toBe('allow')
    expect(evalTool('read_page', {}, 'https://a.com', 'assist').decision).toBe('allow')
  })

  it('ASK mode performs no browser actions beyond reading', () => {
    expect(evalTool('read_page', {}, 'https://a.com', 'ask').decision).toBe('allow')
    expect(evalTool('click', { target: { text: 'x' } }, 'https://a.com', 'ask').decision).toBe('deny')
    expect(evalTool('navigate', { url: 'https://a.com' }, 'https://a.com', 'ask').decision).toBe('deny')
  })

  it('secret-field typing always asks, regardless of mode', () => {
    expect(evalTool('type', { target: { name: 'password' }, text: 'x' }, 'https://a.com', 'agent').decision).toBe('ask')
    expect(evalTool('type', { target: { name: 'password' }, text: 'x' }, 'https://a.com', 'assist').decision).toBe('ask')
  })
})

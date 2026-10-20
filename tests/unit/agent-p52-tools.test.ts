import { describe, expect, it } from 'vitest'
import {
  TOOL_REGISTRY,
  parseToolCall,
  validateToolCall,
  targetSchema,
  type AgentMode
} from '../../src/shared/agent'
import { PermissionEngine } from '../../src/main/services/agent-permissions'

/* ------------------------- Registry additions ------------------------- */

describe('P5.2 tool registry additions', () => {
  const NEW_TOOLS = [
    'observe',
    'page_structure',
    'extract_table',
    'extract_list',
    'extract_links',
    'observe_visual',
    'scroll_to',
    'wait_for',
    'set_checkbox'
  ]

  it('registers every new tool with a security class + schema', () => {
    for (const name of NEW_TOOLS) {
      const t = TOOL_REGISTRY[name]
      expect(t, name).toBeDefined()
      expect(t.security).toBeTruthy()
      expect(t.input).toBeTruthy()
      expect(typeof t.timeoutMs).toBe('number')
    }
  })

  it('read/observe tools are READ; scroll_to & set_checkbox are INTERACTION', () => {
    expect(TOOL_REGISTRY.observe.security).toBe('READ')
    expect(TOOL_REGISTRY.page_structure.security).toBe('READ')
    expect(TOOL_REGISTRY.extract_table.security).toBe('READ')
    expect(TOOL_REGISTRY.extract_links.security).toBe('READ')
    expect(TOOL_REGISTRY.wait_for.security).toBe('READ')
    expect(TOOL_REGISTRY.observe_visual.security).toBe('READ')
    expect(TOOL_REGISTRY.scroll_to.security).toBe('INTERACTION')
    expect(TOOL_REGISTRY.set_checkbox.security).toBe('INTERACTION')
  })
})

/* ------------------------- Schema validation ------------------------- */

describe('P5.2 tool schemas — strict validation', () => {
  it('targetSchema accepts a valid ephemeral eid and rejects malformed ones', () => {
    expect(targetSchema.safeParse({ eid: 'element_12' }).success).toBe(true)
    expect(targetSchema.safeParse({ eid: 'element_x' }).success).toBe(false)
    expect(targetSchema.safeParse({ eid: 'evil; DROP TABLE' }).success).toBe(false)
  })

  it('wait_for requires a known condition and bounds the timeout', () => {
    expect(validateToolCall({ tool: 'wait_for', arguments: { condition: 'text', text: 'Loaded' } }).ok).toBe(true)
    expect(validateToolCall({ tool: 'wait_for', arguments: { condition: 'navigation' } }).ok).toBe(true)
    expect(validateToolCall({ tool: 'wait_for', arguments: { condition: 'nope' } }).ok).toBe(false)
    expect(validateToolCall({ tool: 'wait_for', arguments: { condition: 'text', text: 'x', timeoutMs: 999999 } }).ok).toBe(false)
  })

  it('scroll_to requires at least text or target', () => {
    expect(validateToolCall({ tool: 'scroll_to', arguments: { text: 'Reviews' } }).ok).toBe(true)
    expect(validateToolCall({ tool: 'scroll_to', arguments: { target: { eid: 'element_3' } } }).ok).toBe(true)
    expect(validateToolCall({ tool: 'scroll_to', arguments: {} }).ok).toBe(false)
  })

  it('extract_table / extract_list accept optional index; reject unknown fields', () => {
    expect(validateToolCall({ tool: 'extract_table', arguments: { index: 0 } }).ok).toBe(true)
    expect(validateToolCall({ tool: 'extract_list', arguments: {} }).ok).toBe(true)
    expect(validateToolCall({ tool: 'extract_table', arguments: { foo: 1 } }).ok).toBe(false)
  })

  it('find_text accepts a search mode; set_checkbox requires a boolean', () => {
    expect(validateToolCall({ tool: 'find_text', arguments: { query: 'hi', mode: 'exact' } }).ok).toBe(true)
    expect(validateToolCall({ tool: 'set_checkbox', arguments: { target: { eid: 'element_2' }, checked: true } }).ok).toBe(true)
    expect(validateToolCall({ tool: 'set_checkbox', arguments: { target: { eid: 'element_2' } } }).ok).toBe(false)
  })

  it('click can target by eid produced by observe', () => {
    const p = parseToolCall('{"tool":"click","arguments":{"target":{"eid":"element_5"}}}')
    expect(p.ok).toBe(true)
    if (p.ok) expect(validateToolCall(p.call).ok).toBe(true)
  })
})

/* ------------------------- Permission behavior ------------------------- */

const engine = new PermissionEngine()
function evalTool(name: string, args: Record<string, unknown>, mode: AgentMode = 'agent') {
  return engine.evaluate({ tool: TOOL_REGISTRY[name], arguments: args, origin: 'https://example.com', profileId: 'research', privateMode: false, mode })
}

describe('P5.2 tools — permission behavior', () => {
  it('observation & extraction tools auto-allow in agent AND assist modes (read-only)', () => {
    for (const t of ['observe', 'page_structure', 'extract_table', 'extract_list', 'extract_links', 'wait_for', 'observe_visual']) {
      expect(evalTool(t, {}, 'agent').decision, t).toBe('allow')
      expect(evalTool(t, {}, 'assist').decision, t).toBe('allow')
    }
  })

  it('scroll_to / set_checkbox are auto in Agent but confirm-gated in Assist', () => {
    expect(evalTool('scroll_to', { text: 'x' }, 'agent').decision).toBe('allow')
    expect(evalTool('scroll_to', { text: 'x' }, 'assist').decision).toBe('ask')
    expect(evalTool('set_checkbox', { target: { eid: 'element_1' }, checked: true }, 'agent').decision).toBe('allow')
    expect(evalTool('set_checkbox', { target: { eid: 'element_1' }, checked: true }, 'assist').decision).toBe('ask')
  })

  it('read-only observation is denied in Ask mode (no browser actions)', () => {
    // observe is READ → allowed even in ask (safe reading); scroll_to is not.
    expect(evalTool('observe', {}, 'ask').decision).toBe('allow')
    expect(evalTool('scroll_to', { text: 'x' }, 'ask').decision).toBe('deny')
  })
})

/* ------------------------- P5.3 vision tools ------------------------- */

describe('P5.3 vision tools — registry, schema, permission', () => {
  it('registers observe_visual / analyze_visual / locate_visual as READ', () => {
    for (const t of ['observe_visual', 'analyze_visual', 'locate_visual']) {
      expect(TOOL_REGISTRY[t], t).toBeDefined()
      expect(TOOL_REGISTRY[t].security).toBe('READ')
      expect(TOOL_REGISTRY[t].available).toBe(true)
    }
  })

  it('validates vision tool schemas strictly', () => {
    expect(validateToolCall({ tool: 'observe_visual', arguments: { scope: 'viewport' } }).ok).toBe(true)
    expect(validateToolCall({ tool: 'observe_visual', arguments: {} }).ok).toBe(true)
    expect(validateToolCall({ tool: 'observe_visual', arguments: { scope: 'nope' } }).ok).toBe(false)
    expect(validateToolCall({ tool: 'analyze_visual', arguments: { question: 'what chart is this?' } }).ok).toBe(true)
    expect(validateToolCall({ tool: 'analyze_visual', arguments: {} }).ok).toBe(false)
    expect(validateToolCall({ tool: 'locate_visual', arguments: { description: 'the blue Continue button' } }).ok).toBe(true)
    expect(validateToolCall({ tool: 'locate_visual', arguments: {} }).ok).toBe(false)
  })

  it('vision observation is read-only: allowed in Agent/Assist, denied in Ask', () => {
    for (const t of ['observe_visual', 'analyze_visual', 'locate_visual']) {
      expect(evalTool(t, { question: 'x', description: 'x' }, 'agent').decision, t).toBe('allow')
      expect(evalTool(t, { question: 'x', description: 'x' }, 'assist').decision, t).toBe('allow')
      expect(evalTool(t, { question: 'x', description: 'x' }, 'ask').decision, t).toBe('allow')
    }
  })

  it('there is NO coordinate-based click tool (no unrestricted computer control)', () => {
    for (const banned of ['click_xy', 'mouse_click', 'desktop_click', 'screen_click', 'key_press', 'execute_javascript', 'eval']) {
      expect(TOOL_REGISTRY[banned], banned).toBeUndefined()
    }
  })
})

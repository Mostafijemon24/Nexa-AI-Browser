import {
  AGENT_MAX_CONSECUTIVE_FAILURES,
  AGENT_NO_PROGRESS_REPEAT,
  AGENT_MAX_RETRIES,
  AGENT_MAX_STEPS,
  AGENT_MAX_TASK_MS,
  buildPlannerMessages,
  fenceObservation,
  isRepeatedLoop,
  parseToolCall,
  stepSignature,
  validateToolCall,
  TOOL_REGISTRY,
  type AgentEvent,
  type AgentMode,
  type AgentState,
  type AgentStep,
  type AgentTask,
  type AgentTaskHistoryEntry,
  type RiskLevel,
  type ToolObservation
} from '../../shared/agent'
import type { AiMessage } from '../../shared/ai'
import { PermissionEngine } from './agent-permissions'
import { assertSafeProfileId } from '../../platform'
import type { AIService } from './ai'

/** Model planner abstraction — reuses AIService in production, fakeable in tests. */
export interface Planner {
  plan(input: { profileId: string; messages: AiMessage[]; model?: string; signal: AbortSignal; privateMode?: boolean }): Promise<string>
}

/** Browser tool host — bridges to the renderer/Chromium in production, fakeable in tests. */
export interface AgentToolHost {
  execute(req: { taskId: string; profileId: string; stepId: string; tool: string; arguments: Record<string, unknown> }): Promise<ToolObservation>
  requestPermission(req: { taskId: string; profileId: string; stepId: string; tool: string; origin: string; risk: RiskLevel; summary: string }): Promise<'allow' | 'deny'>
}

type Emit = (event: AgentEvent) => void

/** Tools whose observation is derived from (untrusted) page content → must be fenced. */
const PAGE_DERIVED = new Set([
  'read_page', 'observe', 'page_structure', 'extract_data', 'extract_table', 'extract_list', 'extract_links',
  'find_text', 'inspect_forms', 'list_tabs', 'navigate', 'reload', 'go_back', 'go_forward', 'open_tab', 'switch_tab', 'click', 'wait_for',
  'observe_visual', 'analyze_visual', 'locate_visual'
])
/** Tools that are safe to auto-retry on transient errors. */
const RETRIABLE_TOOLS = new Set([
  'read_page', 'observe', 'page_structure', 'extract_data', 'extract_table', 'extract_list', 'extract_links',
  'find_text', 'inspect_forms', 'list_tabs', 'navigate', 'reload', 'go_back', 'go_forward', 'scroll', 'scroll_to', 'wait', 'wait_for'
])
const RETRIABLE_ERRORS = new Set(['timeout', 'navigation_failed', 'load_failed', 'stale', 'not_ready'])

interface Runtime {
  controller: AbortController
  paused: boolean
  resume?: () => void
  signatures: string[]
  consecutiveFailures: number
  planFailures: number
  /** Consecutive INTERACTION steps that produced no observable page change. */
  noChangeStreak: number
  lastPageSig?: string
  currentPage?: { url: string; title: string }
  history: { tool: string; arguments: Record<string, unknown>; observation: string; ok: boolean }[]
  startedAt: number
}

function codeOf(e: unknown): string {
  const c = (e as { code?: string })?.code
  if (c) return c
  const m = e instanceof Error ? e.message : ''
  return m || 'error'
}

/**
 * NEXA P5.1 — Browser Agent orchestrator (main process).
 *
 * Runs a bounded, cancellable, pausable plan→permission→execute→observe loop.
 * The model only ever produces a validated JSON tool call; the PermissionEngine
 * decides allow/deny/ask against the LIVE browser origin; the AgentToolHost (a
 * typed IPC bridge) performs the actual Chromium action. No page content, secret
 * or prompt is ever logged.
 */
export class AgentService {
  private engine = new PermissionEngine()
  private tasks = new Map<string, AgentTask>()
  private rt = new Map<string, Runtime>()
  private history = new Map<string, AgentTaskHistoryEntry[]>()

  constructor(
    private planner: Planner,
    private host: AgentToolHost,
    private emit: Emit
  ) {}

  /** Create and start a task. Returns immediately; progress streams via agent.event. */
  start(input: { profileId: string; taskId: string; instruction: string; mode?: AgentMode; privateMode?: boolean; model?: string; page?: { url: string; title: string } }): AgentTask {
    assertSafeProfileId(input.profileId)
    if (this.tasks.has(input.taskId)) return this.tasks.get(input.taskId)!
    const task: AgentTask = {
      id: input.taskId,
      profileId: input.profileId,
      privateMode: !!input.privateMode,
      mode: input.mode || 'agent',
      instruction: input.instruction,
      createdAt: Date.now(),
      status: 'idle',
      steps: [],
      currentStep: 0,
      maxSteps: AGENT_MAX_STEPS
    }
    this.tasks.set(task.id, task)
    this.rt.set(task.id, {
      controller: new AbortController(),
      paused: false,
      signatures: [],
      consecutiveFailures: 0,
      planFailures: 0,
      noChangeStreak: 0,
      currentPage: input.page,
      history: [],
      startedAt: Date.now()
    })
    this.emit({ type: 'task-created', task })
    void this.run(task, input.model)
    return task
  }

  getTask(profileId: string, taskId: string): AgentTask | null {
    const t = this.tasks.get(taskId)
    return t && t.profileId === profileId ? t : null
  }

  listHistory(profileId: string): AgentTaskHistoryEntry[] {
    return this.history.get(profileId) ?? []
  }

  cancel(profileId: string, taskId: string): boolean {
    const t = this.tasks.get(taskId)
    const rt = this.rt.get(taskId)
    if (!t || t.profileId !== profileId || !rt) return false
    rt.controller.abort(new Error('cancelled'))
    if (rt.resume) rt.resume()
    return true
  }

  pause(profileId: string, taskId: string): boolean {
    const t = this.tasks.get(taskId)
    const rt = this.rt.get(taskId)
    if (!t || t.profileId !== profileId || !rt) return false
    if (['completed', 'cancelled', 'failed'].includes(t.status)) return false
    rt.paused = true
    return true
  }

  resume(profileId: string, taskId: string): boolean {
    const t = this.tasks.get(taskId)
    const rt = this.rt.get(taskId)
    if (!t || t.profileId !== profileId || !rt) return false
    rt.paused = false
    if (rt.resume) {
      rt.resume()
      rt.resume = undefined
    }
    return true
  }

  /** Cancel and clear everything for a profile (profile switch). */
  cancelProfile(profileId: string): void {
    for (const t of this.tasks.values()) {
      if (t.profileId === profileId) this.cancel(profileId, t.id)
    }
  }

  dispose(): void {
    for (const rt of this.rt.values()) rt.controller.abort(new Error('cancelled'))
    this.rt.clear()
  }

  private setState(task: AgentTask, state: AgentState): void {
    task.status = state
    this.emit({ type: 'state', taskId: task.id, profileId: task.profileId, state })
  }

  private emitStep(task: AgentTask, step: AgentStep): void {
    this.emit({ type: 'step', taskId: task.id, profileId: task.profileId, step: { ...step } })
  }

  private aborted(rt: Runtime): boolean {
    return rt.controller.signal.aborted
  }

  private async pauseGate(rt: Runtime, task: AgentTask): Promise<void> {
    if (!rt.paused || this.aborted(rt)) return
    this.setState(task, 'paused')
    await new Promise<void>((resolve) => {
      rt.resume = resolve
      if (this.aborted(rt)) resolve()
    })
  }

  private async run(task: AgentTask, model?: string): Promise<void> {
    const rt = this.rt.get(task.id)!
    const deadline = Date.now() + AGENT_MAX_TASK_MS
    let finalError: string | undefined

    try {
      this.setState(task, 'planning')
      while (true) {
        if (this.aborted(rt)) {
          finalError = 'cancelled'
          break
        }
        await this.pauseGate(rt, task)
        if (this.aborted(rt)) {
          finalError = 'cancelled'
          break
        }
        if (Date.now() > deadline) {
          finalError = 'task_timeout'
          break
        }
        if (task.steps.length >= task.maxSteps) {
          finalError = 'max_steps'
          break
        }

        // ---- PLAN ----
        this.setState(task, 'planning')
        let raw: string
        try {
          raw = await this.planner.plan({
            profileId: task.profileId,
            model,
            signal: rt.controller.signal,
            privateMode: task.privateMode,
            messages: buildPlannerMessages({ instruction: task.instruction, history: rt.history, currentPage: rt.currentPage })
          })
        } catch (e) {
          finalError = this.aborted(rt) ? 'cancelled' : codeOf(e)
          break
        }

        const parsed = parseToolCall(raw)
        if (!parsed.ok) {
          rt.planFailures++
          if (rt.planFailures >= 2) {
            finalError = 'invalid_tool_call'
            break
          }
          rt.history.push({ tool: 'plan', arguments: {}, observation: 'Your previous response was not a valid JSON tool call. Respond with exactly one JSON tool call.', ok: false })
          continue
        }

        const step: AgentStep = {
          id: `s${task.steps.length + 1}`,
          index: task.steps.length,
          thought: parsed.call.thought,
          tool: parsed.call.tool,
          arguments: parsed.call.arguments,
          status: 'pending',
          retryCount: 0
        }
        task.steps.push(step)
        task.currentStep = step.index

        // Terminal: finish
        if (parsed.call.tool === 'finish') {
          const v = validateToolCall(parsed.call)
          const result = v.ok ? String((v.arguments as { result?: string }).result ?? '') : ''
          step.status = 'done'
          step.observation = result
          this.emitStep(task, step)
          task.result = result
          this.setState(task, 'completed')
          break
        }

        // ---- VALIDATE ----
        const v = validateToolCall(parsed.call)
        if (!v.ok) {
          step.status = v.error === 'not_configured' || v.error === 'unknown_tool' ? 'skipped' : 'failed'
          step.error = v.error
          step.observation = `Rejected (${v.error}). Choose a different, available tool.`
          this.emitStep(task, step)
          rt.history.push({ tool: parsed.call.tool, arguments: parsed.call.arguments, observation: step.observation, ok: false })
          rt.consecutiveFailures++
          if (rt.consecutiveFailures >= AGENT_MAX_CONSECUTIVE_FAILURES) {
            finalError = 'no_progress'
            break
          }
          continue
        }

        // ---- LOOP DETECTION ----
        const sig = stepSignature(v.tool.name, v.arguments)
        if (isRepeatedLoop(rt.signatures, sig)) {
          step.status = 'failed'
          step.error = 'no_progress'
          this.emitStep(task, step)
          finalError = 'no_progress'
          break
        }

        // ---- PERMISSION (against LIVE origin, never model URL) ----
        const origin = rt.currentPage?.url || ''
        const perm = this.engine.evaluate({ tool: v.tool, arguments: v.arguments, origin, profileId: task.profileId, privateMode: task.privateMode, mode: task.mode })
        step.security = v.tool.security
        step.risk = perm.risk
        step.permission = perm.decision

        if (perm.decision === 'deny') {
          step.status = 'denied'
          step.observation = `Denied by policy: ${perm.summary}`
          this.emitStep(task, step)
          rt.history.push({ tool: v.tool.name, arguments: v.arguments, observation: step.observation, ok: false })
          rt.consecutiveFailures++
          if (rt.consecutiveFailures >= AGENT_MAX_CONSECUTIVE_FAILURES) {
            finalError = 'no_progress'
            break
          }
          continue
        }

        if (perm.decision === 'ask') {
          step.status = 'awaiting_permission'
          this.setState(task, 'awaiting_permission')
          this.emitStep(task, step)
          this.emit({ type: 'permission-request', taskId: task.id, profileId: task.profileId, stepId: step.id, tool: v.tool.name, origin, risk: perm.risk, summary: perm.summary })
          let answer: 'allow' | 'deny'
          try {
            answer = await this.raceAbort(rt, this.host.requestPermission({ taskId: task.id, profileId: task.profileId, stepId: step.id, tool: v.tool.name, origin, risk: perm.risk, summary: perm.summary }))
          } catch {
            finalError = 'cancelled'
            break
          }
          if (answer === 'deny') {
            step.status = 'denied'
            step.observation = 'User declined this action.'
            this.emitStep(task, step)
            rt.history.push({ tool: v.tool.name, arguments: v.arguments, observation: step.observation, ok: false })
            continue
          }
        }

        // ---- EXECUTE (with bounded retries for safe tools) ----
        let obs: ToolObservation
        for (;;) {
          step.status = 'running'
          step.startedAt = Date.now()
          this.setState(task, 'executing')
          this.emitStep(task, step)
          try {
            obs = await this.raceAbort(rt, this.withTimeout(this.host.execute({ taskId: task.id, profileId: task.profileId, stepId: step.id, tool: v.tool.name, arguments: v.arguments }), v.tool.timeoutMs))
          } catch (e) {
            if (this.aborted(rt)) {
              finalError = 'cancelled'
              obs = { ok: false, observation: '', error: 'cancelled' }
              break
            }
            obs = { ok: false, observation: '', error: codeOf(e) }
          }
          if (!obs.ok && RETRIABLE_TOOLS.has(v.tool.name) && RETRIABLE_ERRORS.has(obs.error || '') && step.retryCount < AGENT_MAX_RETRIES) {
            step.retryCount++
            continue
          }
          break
        }
        if (finalError === 'cancelled') break

        // ---- OBSERVE ----
        this.setState(task, 'observing')
        if (obs.page) rt.currentPage = obs.page
        rt.signatures.push(sig)

        // Observation-aware loop detection: repeated INTERACTIONS that never change
        // the page (url+title) are going nowhere → stop instead of spinning.
        const pageSig = `${rt.currentPage?.url || ''}|${rt.currentPage?.title || ''}`
        if (v.tool.security === 'INTERACTION' && obs.ok) {
          if (rt.lastPageSig !== undefined && rt.lastPageSig === pageSig) rt.noChangeStreak++
          else rt.noChangeStreak = 0
        } else if (obs.ok) {
          rt.noChangeStreak = 0
        }
        rt.lastPageSig = pageSig
        if (rt.noChangeStreak >= AGENT_NO_PROGRESS_REPEAT + 1) {
          step.observation = 'No page change after repeated interactions (loop detected).'
          this.emitStep(task, step)
          finalError = 'no_progress'
          break
        }
        const fromPage = PAGE_DERIVED.has(v.tool.name) || !!obs.page
        const observation = obs.ok ? fenceObservation(obs.observation, fromPage) : `Action failed: ${obs.error || 'unknown_error'}`
        step.observation = observation
        step.status = obs.ok ? 'done' : 'failed'
        step.completedAt = Date.now()
        this.emitStep(task, step)
        rt.history.push({ tool: v.tool.name, arguments: v.arguments, observation, ok: obs.ok })
        rt.consecutiveFailures = obs.ok ? 0 : rt.consecutiveFailures + 1
        if (rt.consecutiveFailures >= AGENT_MAX_CONSECUTIVE_FAILURES) {
          finalError = 'no_progress'
          break
        }
      }
    } finally {
      this.finalize(task, finalError)
    }
  }

  private finalize(task: AgentTask, finalError?: string): void {
    const rt = this.rt.get(task.id)
    if (task.status !== 'completed') {
      if (finalError === 'cancelled' || this.aborted(rt as Runtime)) {
        this.setState(task, 'cancelled')
      } else if (finalError) {
        task.error = finalError
        this.setState(task, 'failed')
      } else {
        task.error = 'incomplete'
        this.setState(task, 'failed')
      }
    }
    this.emit({ type: 'done', taskId: task.id, profileId: task.profileId, status: task.status, result: task.result, error: task.error })

    // Safe, non-sensitive task history (never for private mode; no page contents).
    if (!task.privateMode) {
      const entry: AgentTaskHistoryEntry = {
        id: task.id,
        profileId: task.profileId,
        createdAt: task.createdAt,
        durationMs: Date.now() - (rt?.startedAt ?? task.createdAt),
        instruction: task.instruction,
        status: task.status,
        stepCount: task.steps.length,
        toolSummary: task.steps.map((s) => s.tool),
        result: task.result
      }
      const list = this.history.get(task.profileId) ?? []
      list.unshift(entry)
      this.history.set(task.profileId, list.slice(0, 50))
    }
    this.rt.delete(task.id)
  }

  private raceAbort<T>(rt: Runtime, p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new Error('cancelled'))
      if (rt.controller.signal.aborted) return reject(new Error('cancelled'))
      rt.controller.signal.addEventListener('abort', onAbort, { once: true })
      p.then(
        (v) => {
          rt.controller.signal.removeEventListener('abort', onAbort)
          resolve(v)
        },
        (e) => {
          rt.controller.signal.removeEventListener('abort', onAbort)
          reject(e)
        }
      )
    })
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), ms)
      p.then(
        (v) => {
          clearTimeout(t)
          resolve(v)
        },
        (e) => {
          clearTimeout(t)
          reject(e)
        }
      )
    })
  }
}

/** Production planner backed by the existing AIService (reuses Ollama; no 2nd runtime). */
export function createAIPlanner(ai: AIService): Planner {
  return {
    plan: (input) => ai.complete(input.profileId, { messages: input.messages, model: input.model, signal: input.signal, private: input.privateMode })
  }
}

// The concrete tool list is exported for docs/tests.
export const AGENT_TOOL_NAMES = Object.keys(TOOL_REGISTRY)

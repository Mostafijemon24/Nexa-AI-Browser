import type { AgentEvent, RiskLevel, ToolObservation } from '../../shared/agent'
import type { AgentToolHost } from './agent'

/**
 * Production AgentToolHost: bridges the main-process AgentService to the renderer
 * over typed IPC. It emits `tool-request` events (the renderer executes the tool
 * on the live <webview>) and awaits the renderer's `agent.toolResult` reply. It
 * also awaits `agent.permission` answers for ask-decisions.
 *
 * The main process never touches the DOM directly; the renderer never receives
 * generic IPC — only these capability-specific, validated channels.
 */
export class IpcAgentToolHost implements AgentToolHost {
  private pendingTool = new Map<string, { resolve: (o: ToolObservation) => void; reject: (e: unknown) => void }>()
  private pendingPerm = new Map<string, { resolve: (d: 'allow' | 'deny') => void; reject: (e: unknown) => void }>()

  constructor(private send: (event: AgentEvent) => void) {}

  private key(taskId: string, stepId: string): string {
    return `${taskId}::${stepId}`
  }

  execute(req: { taskId: string; profileId: string; stepId: string; tool: string; arguments: Record<string, unknown> }): Promise<ToolObservation> {
    return new Promise<ToolObservation>((resolve, reject) => {
      this.pendingTool.set(this.key(req.taskId, req.stepId), { resolve, reject })
      this.send({ type: 'tool-request', taskId: req.taskId, profileId: req.profileId, stepId: req.stepId, tool: req.tool, arguments: req.arguments })
    })
  }

  requestPermission(req: { taskId: string; profileId: string; stepId: string; tool: string; origin: string; risk: RiskLevel; summary: string }): Promise<'allow' | 'deny'> {
    // The AgentService already emits the `permission-request` event; here we just
    // register the pending answer keyed by task/step.
    return new Promise<'allow' | 'deny'>((resolve, reject) => {
      this.pendingPerm.set(this.key(req.taskId, req.stepId), { resolve, reject })
    })
  }

  /** Called by the IPC handler when the renderer returns a tool observation. */
  resolveToolResult(taskId: string, stepId: string, obs: ToolObservation): boolean {
    const k = this.key(taskId, stepId)
    const p = this.pendingTool.get(k)
    if (!p) return false
    this.pendingTool.delete(k)
    p.resolve(obs)
    return true
  }

  /** Called by the IPC handler when the user answers a permission prompt. */
  resolvePermission(taskId: string, stepId: string, decision: 'allow' | 'deny'): boolean {
    const k = this.key(taskId, stepId)
    const p = this.pendingPerm.get(k)
    if (!p) return false
    this.pendingPerm.delete(k)
    p.resolve(decision)
    return true
  }

  /** Reject and clear all pending waits for a task (on cancel). */
  abortTask(taskId: string): void {
    const prefix = `${taskId}::`
    for (const [k, p] of this.pendingTool) {
      if (k.startsWith(prefix)) {
        p.reject(new Error('cancelled'))
        this.pendingTool.delete(k)
      }
    }
    for (const [k, p] of this.pendingPerm) {
      if (k.startsWith(prefix)) {
        p.resolve('deny')
        this.pendingPerm.delete(k)
      }
    }
  }
}

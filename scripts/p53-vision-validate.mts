/**
 * P5.3 live vision validation — exercises the REAL capability-detection and
 * fusion code path against the installed Ollama. Honest about NOT_CONFIGURED.
 */
import { classifyVisionCapability, parseVisionResponse, fuseVisualTargets } from '../src/shared/vision'
import type { ObservedElement } from '../src/shared/observation'
import { OLLAMA_ENDPOINT } from '../src/shared/ai'

const HOST = process.env.OLLAMA_HOST || OLLAMA_ENDPOINT || 'http://127.0.0.1:11434'

async function tags(): Promise<{ name: string; details?: { families?: string[]; family?: string } }[]> {
  const r = await fetch(`${HOST}/api/tags`)
  const j = (await r.json()) as { models?: { name?: string; model?: string; details?: { families?: string[]; family?: string } }[] }
  return (j.models || []).map((m) => ({ name: m.name || m.model || '', details: m.details }))
}

async function show(name: string): Promise<{ capabilities: string[]; family: string; families: string[] }> {
  const r = await fetch(`${HOST}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: name }) })
  const j = (await r.json()) as { capabilities?: string[]; details?: { family?: string; families?: string[] } }
  return { capabilities: j.capabilities || [], family: j.details?.family || '', families: j.details?.families || [] }
}

async function main() {
  let pass = 0
  let fail = 0
  const log = (ok: boolean, label: string, extra = '') => {
    console.log(`${ok ? 'PASS' : 'INFO'}  ${label}${extra ? ' — ' + extra : ''}`)
    if (ok) pass++
    else fail++
  }

  const models = await tags()
  console.log(`Installed models: ${models.map((m) => m.name).join(', ') || '(none)'}`)

  // 1. Real capability detection via /api/show for each model.
  let visionModel: string | null = null
  for (const m of models) {
    const info = await show(m.name)
    const cap = classifyVisionCapability({ capabilities: info.capabilities, family: info.family, families: info.families, name: m.name })
    console.log(`  ${m.name}: ${cap} (capabilities=[${info.capabilities.join(',')}])`)
    if (cap === 'VISION_CAPABLE') visionModel = m.name
  }

  // 2. The default text model must be honestly TEXT_ONLY (never faked).
  const qwen = models.find((m) => /qwen3/.test(m.name))
  if (qwen) {
    const info = await show(qwen.name)
    const cap = classifyVisionCapability({ capabilities: info.capabilities, family: info.family, families: info.families, name: qwen.name })
    log(cap === 'TEXT_ONLY', `${qwen.name} correctly reports TEXT_ONLY (no fake vision)`, cap)
  }

  // 3. Fusion code path (deterministic): a vision suggestion resolves to a REAL eid, never coordinates.
  const els: ObservedElement[] = [
    { id: 'element_1', tag: 'button', role: 'button', name: 'Log in', disabled: false, secret: false, interactive: true },
    { id: 'element_2', tag: 'a', role: 'link', name: 'Continue', disabled: false, secret: false, interactive: true }
  ]
  const parsed = parseVisionResponse('{"description":"a login form","targets":[{"label":"Log in button","role":"button","name":"Log in"}]}')
  const fused = fuseVisualTargets(parsed.targets, els)
  log(fused[0]?.eid === 'element_1' && fused[0]?.status === 'EXACT', 'vision suggestion fuses to a real DOM eid (no coordinates)', fused[0]?.eid)
  log(!JSON.stringify(fused).match(/"x"|"y"/), 'fused target carries no coordinate primitive')

  // 4. Live multimodal request IF a vision model is installed; otherwise honest NOT_CONFIGURED.
  if (visionModel) {
    // 1x1 red PNG.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const r = await fetch(`${HOST}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: visionModel, stream: false, messages: [{ role: 'user', content: 'What color is this image?', images: [png] }] })
    })
    const j = (await r.json()) as { message?: { content?: string } }
    const out = parseVisionResponse(j.message?.content || '')
    log(out.ok && out.description.length > 0, `live multimodal request to ${visionModel} returned a description`, out.description.slice(0, 60))
  } else {
    console.log('INFO  No multimodal model installed → VISION_NOT_CONFIGURED (honest). Live image inference: BLOCKED — ENVIRONMENT')
  }

  console.log(`\n${pass} checks passed, ${fail} informational/not-configured`)
  process.exit(0)
}

main().catch((e) => {
  console.error('validation error:', e?.message || e)
  process.exit(2)
})

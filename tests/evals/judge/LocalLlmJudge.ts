// LocalLlmJudge — wraps an LlmBridge to score generated answers locally.
// Uses the eval-side LlmBridge instead of the production LlamaService , so
// the judge keeps working when the production code switches to a worker
// process.
//
// Judge is loaded once at warm() and reused across all sweep iterations —
// reloading the model per question would dominate runtime.
//
// Model resolution priority:
//   1. opts.modelPath (explicit caller override , wins everything)
//   2. LOKLM_JUDGE_PATH env (CLI-driven judge override , distinct from
//      LOKLM_LLM_PATH so under-test sweeps and judge selection are independent)
//   3. resolveLlmPath(opts.profile ?? 'xl') (legacy auto-discover via patterns)

import { existsSync } from 'node:fs'
import { LlmBridge, resolveLlmPath, type Placement } from '../bridges/LlmBridge'
import {
  buildJudgePrompt,
  parseJudgeOutput,
  type Judge,
  type JudgeInput,
  type JudgeScore,
} from './Judge'

export interface LocalLlmJudgeOpts {
  /** explicit GGUF path. Wins over env + profile. Use this when the judge is
   *  a fixed model file (e.g. Mistral-Small-3.2-24B) that does not match any
   *  of the legacy profile patterns. */
  modelPath?: string
  /** which profile to load as judge when modelPath + LOKLM_JUDGE_PATH are both
   *  absent. defaults to 'xl'. */
  profile?: 'lite' | 'full' | 'xl' | 'auto'
  /** judge prompts run ~3-5 K tokens; 8192 is comfortable with headroom. */
  contextSize?: number
  placement?: Placement
  /** human-readable label for reports. Defaults to `judge:<filename>` so
   *  ranking.md / summary.md show which model judged. */
  label?: string
}

export class LocalLlmJudge implements Judge {
  readonly name: string
  private readonly llm: LlmBridge

  constructor(opts: LocalLlmJudgeOpts = {}) {
    const envPath = process.env.LOKLM_JUDGE_PATH
    let resolved: string | null = null
    let source: 'opts' | 'env' | 'profile' = 'profile'
    if (opts.modelPath) {
      resolved = opts.modelPath
      source = 'opts'
    } else if (envPath && existsSync(envPath)) {
      resolved = envPath
      source = 'env'
    } else {
      const profile = opts.profile ?? 'xl'
      resolved = resolveLlmPath(profile)
    }
    if (!resolved) {
      throw new Error(
        `LocalLlmJudge: no GGUF found. Set LOKLM_JUDGE_PATH , pass opts.modelPath , or place an ${opts.profile ?? 'xl'}-class .gguf in models/.`,
      )
    }
    const label =
      opts.label ??
      `judge:${source === 'opts' || source === 'env' ? basename(resolved) : (opts.profile ?? 'xl')}`
    // Pass modelPath to LlmBridge so it skips its own LOKLM_LLM_PATH lookup —
    // the judge must never accidentally load the under-test model when a
    // sweep sets LOKLM_LLM_PATH.
    this.llm = new LlmBridge({
      modelPath: resolved,
      contextSize: opts.contextSize ?? 8192,
      ...(opts.placement ? { placement: opts.placement } : {}),
      // judge prompts are in German; matching session language keeps the
      // model from flipping to English mid-response.
      language: 'de',
      label,
    })
    this.name = this.llm.label
  }

  async warm(): Promise<void> {
    await this.llm.warm()
  }

  async score(input: JudgeInput): Promise<JudgeScore> {
    const prompt = buildJudgePrompt(input)
    const raw = await this.llm.generateRaw(prompt)
    return parseJudgeOutput(raw)
  }

  async unload(): Promise<void> {
    await this.llm.unload()
  }
}

function basename(p: string): string {
  const m = p.match(/[^\\/]+$/)
  return m ? m[0]! : p
}

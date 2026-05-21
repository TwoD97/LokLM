// LocalLlmJudge — wraps an LlmBridge (loaded with the XL profile by default,
// i.e. Nemotron 3 Nano 30B-A3B) to score generated answers locally. Uses the
// eval-side LlmBridge instead of the production LlamaService, so the judge
// keeps working when the production code switches to a worker process.
//
// Judge is loaded once at warm() and reused across all sweep iterations —
// reloading the XL model per question would dominate runtime.

import { LlmBridge, resolveLlmPath, type Placement } from '../bridges/LlmBridge'
import {
  buildJudgePrompt,
  parseJudgeOutput,
  type Judge,
  type JudgeInput,
  type JudgeScore,
} from './Judge'

export interface LocalLlmJudgeOpts {
  /** which profile to load as judge. defaults to 'xl' (largest on disk —
   *  Nemotron 3 Nano 30B-A3B if present). */
  profile?: 'lite' | 'full' | 'xl' | 'auto'
  /** judge prompts run ~3-5 K tokens; 8192 is comfortable with headroom. */
  contextSize?: number
  placement?: Placement
}

export class LocalLlmJudge implements Judge {
  readonly name: string
  private readonly llm: LlmBridge

  constructor(opts: LocalLlmJudgeOpts = {}) {
    const profile = opts.profile ?? 'xl'
    // Resolve the judge model file EXPLICITLY via the profile patterns , then
    // pass modelPath to LlmBridge. Reason: LlmBridge respects LOKLM_LLM_PATH
    // for under-test multi-model sweeps , but the judge must stay locked to
    // its profile no matter what env vars are set. Passing modelPath wins
    // over env in LlmBridge.warm()'s priority order.
    const resolved = resolveLlmPath(profile)
    if (!resolved) {
      throw new Error(
        `LocalLlmJudge: no GGUF found for profile=${profile}. Make sure an ${profile}-class .gguf is in models/.`,
      )
    }
    this.llm = new LlmBridge({
      modelPath: resolved,
      contextSize: opts.contextSize ?? 8192,
      ...(opts.placement ? { placement: opts.placement } : {}),
      // judge prompts are in German; matching session language keeps the
      // model from flipping to English mid-response.
      language: 'de',
      label: `judge:${profile}`,
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

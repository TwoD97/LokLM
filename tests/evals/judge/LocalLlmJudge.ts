// LocalLlmJudge — wraps an LlmBridge (loaded with the XL profile by default,
// i.e. Nemotron 3 Nano 30B-A3B) to score generated answers locally. Uses the
// eval-side LlmBridge instead of the production LlamaService, so the judge
// keeps working when the production code switches to a worker process.
//
// Judge is loaded once at warm() and reused across all sweep iterations —
// reloading the XL model per question would dominate runtime.

import { LlmBridge, type Placement } from '../bridges/LlmBridge'
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
    this.llm = new LlmBridge({
      profile,
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

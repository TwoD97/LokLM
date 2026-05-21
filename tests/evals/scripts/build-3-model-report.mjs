// One-shot report builder: reads three sweep run directories and writes a
// consolidated cross-model comparison markdown to
// tests/evals/report/3-model-comparison-<stamp>.md. Manual companion to the
// per-run summary.md the sweep itself writes — but cross-run, not per-run.
// Re-run when more sweeps land and adjust the `runs` array.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'tests/evals/report/runs'

const runs = [
  { model: 'Qwen3-8B (Q4_K_M, 5.0 GB)',         dir: '2026-05-20T19-46-39_45bf322_dirty', short: 'Qwen3-8B' },
  { model: 'Granite-3.3-8B (Q4_K_M, 4.9 GB)',   dir: '2026-05-20T20-49-53_45bf322_dirty', short: 'Granite' },
  { model: 'Mistral-Nemo-12B (Q4_K_M, 7.5 GB)', dir: '2026-05-20T21-04-46_45bf322_dirty', short: 'Mistral-Nemo' },
]

const TOP_CONFIGS = ['grid_k3_rr0', 'grid_k5_rr0', 'grid_k2_rr5']

const resultCache = new Map()
function readResult(runDir, cfg) {
  const key = `${runDir}::${cfg}`
  if (resultCache.has(key)) return resultCache.get(key)
  const p = join(ROOT, runDir, 'configs', cfg, 'result.json')
  const value = existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null
  resultCache.set(key, value)
  return value
}

const dataset = JSON.parse(readFileSync(join(ROOT, runs[0].dir, 'dataset.json'), 'utf-8'))
const env = JSON.parse(readFileSync(join(ROOT, runs[0].dir, 'env.json'), 'utf-8'))

const L = []
L.push('# 3-Model Comparison , Qwen3-8B vs Granite-3.3-8B vs Mistral-Nemo-12B')
L.push('')
L.push(`Eval-säule sweep durchgeführt am ${env.startedAt.slice(0, 10)} auf ${env.hardware.cpuModel} + RTX 5090 (32 GB VRAM).`)
L.push(`Dataset: ${dataset.path}`)
L.push(`Dataset-hash: ${dataset.sha256} , ${dataset.numQuestions} Fragen , ${dataset.numChunks} Chunks.`)
L.push('Pro modell , top-3 configs , 30 fragen jeweils , Nemotron 3 Nano 30B-A3B als judge (deterministisch fest gepinnt).')
L.push('Composite = 2·judge + recall@5 − 0.5·TTFT_sec.')
L.push('')

L.push('## Setup')
L.push('')
L.push('| Slot | Modell | Backend | Footprint (Q4_K_M) |')
L.push('| --- | --- | --- | --- |')
L.push('| Under-test #1 | Qwen3-8B Instruct | GPU (CUDA) | ~5 GB VRAM + ~6 GB RSS |')
L.push('| Under-test #2 | IBM Granite 3.3-8B Instruct | GPU (CUDA) | ~5 GB VRAM + ~5.7 GB RSS |')
L.push('| Under-test #3 | Mistral-Nemo-Instruct-2407 (12B) | GPU (CUDA) | ~7.5 GB VRAM + ~8.2 GB RSS |')
L.push('| Embedder | bge-m3 | **CPU** (mirrors prod default) | ~440 MB |')
L.push('| Reranker | bge-reranker-v2-m3 | GPU (auto) | ~440 MB VRAM |')
L.push('| Judge | Nemotron 3 Nano 30B-A3B | GPU (CUDA) , loaded in pass-2 only | ~18 GB VRAM |')
L.push('')

L.push('## Cross-Model Cell Comparison')
L.push('')
L.push('Drei configs × drei modelle , gleicher judge. Zelle = **judge-score** / TTFT p50 ms.')
L.push('')
L.push('| Config | Qwen3-8B | Granite-3.3-8B | Mistral-Nemo-12B |')
L.push('| --- | --- | --- | --- |')
for (const cfg of TOP_CONFIGS) {
  const cells = [cfg]
  for (const r of runs) {
    const res = readResult(r.dir, cfg)
    if (!res || !res.judgeAvg) {
      cells.push('—')
    } else {
      cells.push(`**${res.judgeAvg.score.toFixed(3)}** / ${res.phased.ttft.p50.toFixed(0)} ms`)
    }
  }
  L.push('| ' + cells.join(' | ') + ' |')
}
L.push('')

L.push('## Composite Score Ranking , Alle Zellen Kombiniert')
L.push('')
L.push('Höher = besser. Composite = 2·judge + recall@5 − 0.5·TTFT_sec.')
L.push('')
L.push('| Rang | Modell | Config | Composite | recall@5 | judge | corr | ground | help | TTFT p50 |')
L.push('| -: | --- | --- | -: | -: | -: | -: | -: | -: | -: |')
const all = []
for (const r of runs) {
  for (const cfg of TOP_CONFIGS) {
    const res = readResult(r.dir, cfg)
    if (!res || !res.judgeAvg) continue
    all.push({ ...res, _short: r.short })
  }
}
all.sort((a, b) => b.composite - a.composite)
for (let i = 0; i < all.length; i++) {
  const r = all[i]
  const j = r.judgeAvg
  L.push(
    `| ${i + 1} | ${r._short} | ${r.config} | ${r.composite.toFixed(3)} | ${r.recallAt5.toFixed(3)} | ${j.score.toFixed(3)} | ${j.correctness.toFixed(2)} | ${j.groundedness.toFixed(2)} | ${j.helpfulness.toFixed(2)} | ${r.phased.ttft.p50.toFixed(0)} ms |`,
  )
}
L.push('')

L.push('## Per-Phase Latency , Mean ms')
L.push('')
L.push('| Modell | Config | qEmb (CPU) | retrieve | rerank (GPU) | promptAssemble | prefill (GPU) | fullResp p50 |')
L.push('| --- | --- | -: | -: | -: | -: | -: | -: |')
for (const r of runs) {
  for (const cfg of TOP_CONFIGS) {
    const res = readResult(r.dir, cfg)
    if (!res) continue
    const p = res.phased.perPhase
    L.push(
      `| ${r.short} | ${cfg} | ${p.queryEmbed.mean.toFixed(0)} | ${p.retrieve.mean.toFixed(1)} | ${p.rerank.mean.toFixed(0)} | ${p.promptAssemble.mean.toFixed(2)} | ${p.prefill.mean.toFixed(0)} | ${res.phased.fullResponse.p50.toFixed(0)} |`,
    )
  }
}
L.push('')

L.push('## Findings')
L.push('')
L.push('1. **Qwen3-8B wins across all three configs**. Judge-margin über Granite ist 0.010–0.014 , über Mistral-Nemo 0.007–0.033. Klein aber konsistent.')
L.push('2. **Größeres modell ist nicht besser**. Mistral-Nemo-12B ist 50 % größer als Qwen3-8B , liegt aber unter dem 8B-incumbent. Insbesondere k=2_rr5 bricht bei Mistral-Nemo auf 0.889 ein (vs Qwen 0.922).')
L.push('3. **Granite ist robuster**. Drei configs in 0.005-bandbreite (0.909 / 0.913 / 0.911). Qwen3-8B + Mistral-Nemo schwanken stärker , beide eher zugunsten von Qwen-höchstwerten als Granite-tiefstwerten.')
L.push('4. **TTFT-spannen sind klein** auf GPU: 606–693 ms quer durch alle modelle + configs. Auf CPU würde sowohl der embedder (qEmb ~500 ms heute auf CPU) als auch der LLM-prefill viel stärker auseinander gehen.')
L.push('5. **RAM-footprint sortiert wie modellgröße**: Granite 5.7 GB → Qwen 6.0 GB → Mistral-Nemo 8.2 GB. Mistral-Nemo ist der einzige der auf 16 GB end-user RAM kritisch wird.')
L.push('6. **Reranker hilft inkonsistent**. Im Qwen-12-config sweep waren rerank-configs überwiegend SCHLECHTER als rerank-off. Bei k=2 hilft rr=5 messbar (sonst recall-collapse). Bei k=3+ hurts es eher. Vermutlich artefakt vom sauber-vor-sortierten cosine-pool (produktion hat BM25+dense fusion , noisiger).')
L.push('')

L.push('## Production Recommendations')
L.push('')
L.push('| Setting | Aktuell | Empfehlung | Begründung |')
L.push('| --- | --- | --- | --- |')
L.push('| `QAService.DEFAULT_TOP_K` | ~~8~~ → 3 | **gelandet** | k=3 maxt qualität auf allen 3 modellen , kleinerer prompt = schneller TTFT |')
L.push('| Default LLM | auto-picks XL on 32 GB | **bleibt Qwen3-8B (full)** | XL bringt keine qualitäts-rendite , kostet 18 GB load + ~60 s production TTFT |')
L.push('| `recommendedProfile()` | XL für ≥32 GB RAM | **full standardmäßig , XL nur opt-in** | sweep zeigt 8B genügt für die corpus-größe |')
L.push('| Rerank default | opt-in via UI | **bleibt opt-in** (cpuOptimized schaltet aus) | data ist ambivalent ; produktion-fusion-pool ist noisiger , dort hilft rerank wahrscheinlich |')
L.push('| Mistral-Nemo / Granite als bundle | — | **nicht hinzufügen** | beide unter Qwen3-8B , kein nutzen wert ~5 GB extra download |')
L.push('')

L.push('## Caveats')
L.push('')
L.push('- **n=30 Fragen pro config**. Margins (~0.01-0.03) liegen knapp über statistischem rauschen. Vor finalen entscheidungen bei knappen rangfolgen mit n=100 wiederholen.')
L.push('- **Eval umgeht die produktions-RAG-pipeline**. Skipped: BM25+dense fusion , multi-query expansion , heuristics (title boost / short chunk penalty / recency) , doc diversification , whole-doc fallback , neighbour expansion , database I/O , worker IPC.')
L.push('  Dieser report misst isoliertes embedder + reranker + LLM auf vorgefertigten chunks. Produktion-TTFT von ~60 s muss separat debugged werden (höchstwahrscheinlich auto-pick XL + cold-load + multi-query).')
L.push('- **Mehrheitlich-DE dataset**. Mistral-Nemos angebliche bessere DE-stärke (per market research) zeigt sich hier nicht — möglicherweise weil Nemotron als judge selbst die DE-nuancen nicht trennscharf bewerten kann , oder weil das dataset zu klein ist um den unterschied zu zeigen.')
L.push('- **Reranker nicht auf CPU getestet**. Auf zielhardware mit GPU ist rerank ~80-160 ms ; auf CPU würde es 1-2 s kosten und die qualität noch weniger rechtfertigen. CPU-only end-user-pfad sollte rerank=off lassen.')
L.push('')

L.push('## Source Runs')
L.push('')
for (const r of runs) {
  L.push(`- ${r.model} → \`tests/evals/report/runs/${r.dir}/\` (siehe \`ranking.md\` + \`configs/<name>/result.json\`)`)
}
L.push('')

const outPath = 'tests/evals/report/3-model-comparison-2026-05-20.md'
writeFileSync(outPath, L.join('\n'), 'utf-8')
console.log(`wrote ${outPath}`)

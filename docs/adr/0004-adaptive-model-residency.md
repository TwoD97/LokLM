# ADR-0004 — Adaptive Modell-Residency: Usage-Lernen + kostenbewusstes Caching (CPU/GPU/VRAM)

**Status:** proposed
**Datum:** 2026-06-13
**Owner:** Denys
**Bezug:** [PH] Pflichtenheft (Runtime/Modell-Lifecycle, AP-9 `runtime.conversationSwitch`) ; [ADR-0002](0002-envelope-encryption-aes-gcm.md) (Vault, in dem das Usage-Journal verschlüsselt liegt) ; [ADR-0003](0003-query-routing-und-summary-index.md) (teilt sich den einen LLM-Worker, dessen Residency diese Policy steuert)
**Implementierung (geplant, neu sofern nicht anders vermerkt):**
[src/main/services/placement/ResidencyCoordinator.ts](../../src/main/services/placement/ResidencyCoordinator.ts),
[src/main/services/placement/ManagedModel.ts](../../src/main/services/placement/ManagedModel.ts),
[src/main/services/placement/UsageJournal.ts](../../src/main/services/placement/UsageJournal.ts),
[src/main/services/placement/DemandModel.ts](../../src/main/services/placement/DemandModel.ts),
[src/main/services/placement/PlacementPolicy.ts](../../src/main/services/placement/PlacementPolicy.ts),
[src/main/services/placement/SpeculativePreloader.ts](../../src/main/services/placement/SpeculativePreloader.ts) (Phase 4),
[src/main/services/embeddings/ResourcePlanner.ts](../../src/main/services/embeddings/ResourcePlanner.ts) (**erweitern** — Live-Budget),
[src/main/services/workers/ModelsWorkerClient.ts](../../src/main/services/workers/ModelsWorkerClient.ts) (**vorhanden** — `llmUnload`/`embedderUnload`/`rerankerUnload` werden erstmals von einer Policy getrieben),
[src/main/services/concurrency/ModelLoadLock.ts](../../src/main/services/concurrency/ModelLoadLock.ts) (**vorhanden** — Reconciler serialisiert hierüber),
[src/shared/settings.ts](../../src/shared/settings.ts) (**erweitern** — `placement`-Policy-Block, ersetzt den AP-9-Platzhalter `runtime.conversationSwitch`),
[src/main/db/migrations/00NN_usage_events.sql](../../src/main/db/migrations/00NN_usage_events.sql) (**neu**)

## Context

LokLM hostet **fünf Runtimes** mit unterschiedlichem Lade- und Geräteprofil:

| Modell                     | Runtime                          | Gerätewahl heute                                                 | Footprint-Quelle                   |
| -------------------------- | -------------------------------- | ---------------------------------------------------------------- | ---------------------------------- |
| LLM (Qwen3.5 2B/4B/9B)     | node-llama-cpp, geteilter Worker | `LLAMA_GPU` bei Init, sonst auto ; CPU-Downgrade falls keine GPU | `ggufWeightBytes` + KV (`planLlm`) |
| Embedder (BGE-M3)          | node-llama-cpp, geteilter Worker | `planAux` zur Ladezeit                                           | `ggufWeightBytes` + 0.3 GB         |
| Reranker (BGE-v2-M3)       | node-llama-cpp, geteilter Worker | `planAux` zur Ladezeit                                           | `ggufWeightBytes` + 0.3 GB         |
| Translator (MADLAD-400-3B) | CTranslate2-Sidecar (.exe)       | Binärwahl `-cuda` vs CPU beim Spawn                              | Manifest                           |
| Transcription (Whisper)    | eigener utilityProcess-Worker    | Binär/Build                                                      | Manifest                           |

**Der heutige Zustand ist statisch und einmalig.** [`ResourcePlanner`](../../src/main/services/embeddings/ResourcePlanner.ts) entscheidet Placement **genau einmal, zur Ladezeit** (`planAux`/`planLlm`), und revidiert es nie. Embedder und Reranker bleiben nach dem ersten Load **für immer** warm (bewusst — GGUF-Reload kostet Sekunden) ; nur `LlamaService` hat eine Idle-Eviction (Default 30 min, `LOKLM_LLM_IDLE_MS`). Es gibt **kein Usage-Signal**: nirgends wird protokolliert, welches Feature (QA, Translation, Writing, Quiz, Transcription) wann benutzt wird. `runtime.conversationSwitch: 'unload' | 'keep'` ([settings.ts:69](../../src/shared/settings.ts#L69)) ist als „AP-9 Partner-Ticket, der den Modell-Lifecycle verdrahtet" markiert — und genau dieser Lifecycle ist hier zu spezifizieren.

**Die Aufgabe:** _Was_ wird _wann_ _wohin_ geladen — gelernt aus dem tatsächlichen Nutzungsverhalten, mit Prioritäten, unter dem VRAM/RAM-Budget, das `ResourcePlanner` bereits berechnet.

### Warum der Kern _kein_ Multi-Armed-Bandit ist

Der naheliegende Reiz war „Multi-Armed Bandit: ein Arm pro Modell, Pull = Laden". Diese Rahmung ist falsch, und das ist die zentrale Designentscheidung dieses ADR — sie bestimmt, was gebaut wird:

1. **Wir beobachten Demand unabhängig vom Placement (full feedback).** Ob die Übersetzung warm war oder nicht — wir sehen, dass der Nutzer sie geöffnet hat. Ein Bandit verwirft genau diese Information (Bandit-Feedback = nur der gezogene Arm). Wer das Nutzungsverhalten direkt lernt, hat strikt mehr Daten.
2. **Die Entscheidung ist eine Menge, kein Einzelzug.** „Welche Modelle passen gemeinsam in VRAM" ist ein Rucksack-/Caching-Problem, kein arg-max über _einen_ Arm.
3. **Der Reward ist strukturiert, nicht opak.** Er ist _vermiedene Latenz_ = gesparter Cold-Load + GPU-Speedup × erwartete Nutzungen — berechenbar aus Größen, die wir messen, nicht eine Black-Box-Skalar, die man nur durch Ziehen erfährt.

Korrekt zerlegt ist das Problem **kostenbewusstes Caching mit Demand-Prädiktion**. Ein Bandit ist höchstens eine schmale obere Schicht für die _eine_ Entscheidung, die echtes Bandit-Feedback hat: **spekulatives Vorladen** (man zahlt reale Ladekosten und erfährt den Nutzen nur, wenn man handelt — der kontrafaktische Fall bleibt unbeobachtet).

### Per-Maschine, per-User — und wo es zählt

Die Policy ist **inhärent lokal**: sie liest das Live-Budget _dieser_ Maschine (`ResourcePlanner` probet die echte Karte) und das Journal _dieses_ Users (im Vault). Nichts ist global oder geteilt — zwei Installationen mit gleichem Tier, aber 8 GB vs 32 GB VRAM verhalten sich völlig unterschiedlich, und das ist gewollt.

Auf der Dev-Box (RTX 5090, 32 GB) passt **alles gleichzeitig** — die Policy lädt schlicht alles und evictioniert nie. Das ist **kein No-Op-Unfall, sondern das spezifizierte korrekte Verhalten**: bei reichlich VRAM ist „Admit-all" die optimale Lösung der Wertfunktion (jeder Kandidat passt ⇒ jeder wird aufgenommen). Die Policy _skaliert_ mit der Hardware, statt eine feste Regel zu erzwingen.

Die eigentliche Arbeit passiert auf der **constrained** Zielmaschine — **6 / 8 / 12 GB VRAM** oder CPU-only —, wo Modelle real um VRAM konkurrieren und die dominante Kostengröße der **Cold-Load-Stall** ist (genau deshalb halten wir Embedder/Reranker heute warm). Daraus drei Design-prägende Konsequenzen:

- Das Optimierungsziel ist „minimiere wahrgenommene Cold-Load-Stalls unter VRAM-Budget" — ein **Caching**-Ziel. Deshalb passt die Cache-Rahmung und nicht der Bandit.
- Entwickelt und evaluiert wird **gegen ein constrained Budget**, nicht gegen die 32 GB der Dev-Box. Damit der contended Pfad auf _jeder_ Karte (inkl. 5090) reproduzierbar ist, klemmt `LOKLM_VRAM_CAP_GB` / `placement.simulateVramCapGB` das nutzbare VRAM künstlich auf z.B. 6/8/12 GB — `ResourcePlanner` rechnet dann, als wäre nur so viel da. Ohne diesen Cap „sieht man nichts", weil die Hardware das Problem wegabsorbiert.
- Konsistent mit dem Eval-Grundsatz „miss, was Endnutzer sehen" — die 32-GB-Box ist die Ausnahme, nicht die Referenz.

## Decision

### Schichtenarchitektur

```
L5  SpeculativePreloader   ── kontextueller Bandit, nur Idle, bounded  (Phase 4, flag-gated)
L4  ResidencyManager       ── Reconciler: diff(current, target) → load/unload via ModelLoadLock
L3  PlacementPolicy        ── kostenbewusstes Caching (GDSF), rein, liefert ResidencyPlan
L2  DemandModel            ── full-feedback Online-Prädiktor (Recency·Frequency·Markov·ToD)
L1  UsageJournal           ── append-only Event-Log, vault-verschlüsselt
L0  ManagedModel + ResourcePlanner(Live-Budget)   ── einheitliches Handle + Budget-Substrat
```

`ResidencyCoordinator` ist der Eigentümer von L1–L4 und der einzige Akteur, der lädt/entlädt. L0 ist das Substrat (großteils vorhanden).

### L0 — `ManagedModel`: einheitliches Handle

Jede Runtime liefert einen Adapter. Der Coordinator behandelt alle fünf uniform — er kennt weder node-llama-cpp noch den CT2-Sidecar.

```ts
export type Device = 'gpu' | 'cpu'

// One adapter per runtime: LlamaService, EmbeddingService, RerankerService,
// TranslationService, TranscriptionService. The coordinator only ever sees this.
export interface ManagedModel {
  readonly id: string // 'llm', 'embedder', 'reranker', 'translator', 'whisper'
  readonly devices: readonly Device[] // placements the runtime can actually serve
  /** Resident footprint on a device, in bytes. Reuses ResourcePlanner math
   *  (ggufWeightBytes + KV for worker models; manifest size for sidecar/whisper). */
  footprintBytes(device: Device): number
  residentOn(): Device | null // null = cold
  load(device: Device): Promise<void>
  unload(): Promise<void>
  /** Refcount lease. A held lease pins the model resident (the reconciler
   *  never unloads a leased model) and bumps lastUsed. The returned disposer
   *  releases it. Every inference call wraps itself in acquire()/release(). */
  acquire(): () => void
}
```

Geräte­wechsel ist _nicht_ gratis: Der Translator wechselt das Gerät nur durch Kill + Respawn des anderen Binaries, die Worker-Modelle durch Unload + Reload. Der Adapter kapselt das ; die Policy sieht es über `loadCost` (unten) als reale Kosten und meidet Flapping.

### L1 — `UsageJournal`: das Signal, das heute fehlt

Append-only Event-Log. Jeder Feature-Aufruf emittiert ein Event; daraus speist sich alles Lernen.

```ts
export interface UsageEvent {
  modelId: string
  t: number // epoch ms (vom Aufrufer übergeben — Date.now() im Hot Path ist ok)
  sessionId: string // zur Markov-Sequenzbildung pro Sitzung
  device: Device | null // wo es lief (für Speedup-Messung)
  loadWasCold: boolean // musste vor diesem Aufruf geladen werden? (Stall-Metrik)
  loadMs?: number // gemessene Ladezeit, falls kalt → speist ModelStats.loadCost
  serviceMs?: number // Inferenzdauer → speist ModelStats.speedup
}
```

**Privacy ist eine harte Anforderung, keine Fußnote.** Nutzungsverhalten ist Verhaltensdaten. Das Journal liegt **verschlüsselt im bestehenden Vault** ([ADR-0002], neue Tabelle `usage_events`), verlässt die Maschine **nie** (Lastenheft-Offline-Grundsatz), und ist über die Settings **vollständig löschbar**. Kein Netzwerkpfad berührt diese Tabelle.

### L2 — `DemandModel`: full-feedback Prädiktor (kein Bandit)

Wird bei _jedem_ Event aktualisiert, läuft synchron auf dem Main-Thread (reines Zählen mit Decay, kein ML-Inferenzkosten). Liefert pro Modell eine Wahrscheinlichkeit, „bald" gebraucht zu werden.

```ts
export interface DemandSignal {
  modelId: string
  demand: number // P(used within horizon H), [0,1]
  expectedUses: number // erwartete Aufrufe in H
}

export interface DemandModel {
  observe(ev: UsageEvent): void
  scoreAll(nowMs: number): DemandSignal[]
}
```

Vier interpretierbare Signale, gewichtet kombiniert:

- **Recency** — exponentieller Decay seit letztem Aufruf (Halbwertszeit `RECENCY_HALFLIFE`).
- **Frequency** — EWMA der Aufrufrate (Aufrufe/Stunde).
- **Markov(prev → m)** — Übergangswahrscheinlichkeit erster Ordnung über die Feature-Sequenz der Sitzung. (Beispiel: „User indexiert → fast immer folgt QA"; „User schreibt → oft folgt Translation".) Das ist der klassische Markov-Prefetcher, auf Feature-Granularität.
- **ToD-Prior** — Tageszeit-Bucket (manche nutzen Translation morgens, Quiz abends).

Bewusst **kein** schweres Modell: interpretierbar, billig, robust gegen Cold-Start (siehe Risiken). Das ist das „Lernen aus Nutzung" der ursprünglichen Anfrage — und es ist Zählen mit Decay, kein Bandit.

### L3 — `PlacementPolicy`: kostenbewusstes Caching (die eigentliche Entscheidung)

Rein gegeben die Inputs (wie `ResourcePlanner.plan*()` — kein verstecktes State, damit nach jedem Load re-evaluierbar). Liefert das **Ziel** an Residency + Gerätezuteilung.

```ts
export type Priority = 'pinned' | 'active' | 'normal' | 'background'

export interface ModelStats {
  // gemessen, in `model_stats` persistiert
  loadCostMs: Record<Device, number> // EWMA Cold-Load-Wallclock
  serviceMs: Record<Device, number> // EWMA Inferenzdauer pro Aufruf
}

export interface ResidencyPlan {
  target: Map<string, Device> // gewünschtes Gerät ; fehlt = evict (unload sobald kalt)
  reason: Map<string, string> // menschenlesbar, wie ResourcePlanner.reason
}

export function planResidency(inp: {
  models: ManagedModel[]
  demand: DemandSignal[]
  stats: ModelStats[]
  priority: Map<string, Priority>
  budget: LiveBudget // ResourcePlanner-Erweiterung: usableVram/Ram − committed
  current: Map<string, Device | null>
}): ResidencyPlan
```

**Wertfunktion.** Für Modell `m` auf Gerät `d`:

```
benefit(m, d) = loadCostMs(m, d)                          // bei nächster Nutzung gesparter Cold-Load-Stall
              + speedupValueMs(m, d) · expectedUses(m)    // pro-Nutzung gesparte Latenz (GPU vs CPU)

   wobei speedupValueMs(m, gpu) = max(0, serviceMs(m, cpu) − serviceMs(m, gpu))
         speedupValueMs(m, cpu) = 0

value(m, d)   = priorityWeight(m) · demand(m) · benefit(m, d)
densityVram(m) = value(m, gpu) / footprintGB(m, gpu)      // Wert pro GB — der GDSF-Kern
```

**Algorithmus (GreedyDual-Size-Frequency-artig):**

1. **Harte Locks zuerst.** `active` (laufende Inferenz, geleast) → resident auf aktuellem Gerät erzwungen (kann mitten in der Inferenz nicht wandern). `pinned` (User) → resident, GPU bevorzugt ; sein Footprint wird vorab vom Budget abgezogen (Reservierung).
2. **GPU füllen.** Restliche Kandidaten nach `densityVram` absteigend ; aufnehmen solange `footprintGB(m, gpu)` ins Rest-VRAM passt.
3. **CPU-Tier.** Modelle, die nicht auf die GPU kamen, aber positiven `value(m, cpu)` haben, bleiben/laden auf CPU, solange RAM (`usableRam`) reicht.
4. **Evict.** Alles ohne Platz und ohne Lock → nicht im `target` → wird entladen, **sobald es kalt** ist (nie unter Lease).

**Hysterese gegen Thrashing.** Ein bereits residentes Modell bekommt einen Stickiness-Bonus: seine Ladekosten sind _bezahlt_, Evict-dann-Reload verbrennt `2 × loadCost`. Konkret: Evict-Schwelle = `EVICT_HYSTERESIS × Admit-Schwelle` **und** eine `MIN_RESIDENCY_MS`-Mindesthaltedauer. Das ist GreedyDuals Aging-Idee, übersetzt in „flappe nicht zwischen zwei knapp konkurrierenden Modellen".

### L4 — `ResidencyManager`: Reconciler

Diff `current → target`, ausgeführt über den **vorhandenen** [`ModelLoadLock`](../../src/main/services/concurrency/ModelLoadLock.ts) (Loads bleiben serialisiert — drei native Inits gleichzeitig crashen auf knappen Maschinen). Invarianten:

- **Nie ein geleastes Modell entladen.** Lease-Refcount > 0 ⇒ pin. Verallgemeinert die heutige LLM-Idle-Eviction auf alle Runtimes.
- **Der aktive Request gewinnt immer (Admission).** Braucht eine laufende Anfrage ein kaltes Modell und VRAM ist voll, macht der Reconciler durch Evict des kältesten/niedrigst-density Modells Platz, _bevor_ er lädt — synchron im Pfad des Aufrufers.
- **Geräte-Move = Unload + Reload** (bzw. Sidecar Kill + Respawn). Wird als teuer behandelt ; die Wertfunktion bevorzugt Gerät-halten.
- **Kein Anstieg gleichzeitiger Inferenz.** Residency ≠ Inferenz: Der geteilte Worker verträgt heute keine _parallele_ Inferenz (0xC0000005, siehe [ModelsWorkerClient.ts:99-108](../../src/main/services/workers/ModelsWorkerClient.ts#L99-L108)). Die Policy erhöht nur gemeinsame _Residency_, nie gleichzeitige Forward-Pässe — die bestehende Inferenz-Serialisierung bleibt unangetastet.

### L5 — `SpeculativePreloader`: hier (und nur hier) ein Bandit

Die eine Entscheidung mit echtem Bandit-Feedback: „Modell X jetzt vorladen, _bevor_ es angefragt wird, auf Signal S?" Man zahlt reale Ladekosten ; der Reward (wurde es vor Eviction genutzt? Stall gespart?) ist nur beobachtbar, wenn man handelt.

- **Kontextueller Bandit** (LinUCB oder Thompson) ; Kontext = Demand-Signale + Tageszeit + zuletzt genutztes Feature ; Reward = `+gesparter Stall` bei Treffer, `−verschwendete Ladekosten` bei Miss vor Eviction.
- **Bounded:** feuert nur, wenn (a) freies VRAM > Footprint des Kandidaten **und** (b) keine Inferenz in den letzten `IDLE_BEFORE_SPECULATE_MS`. Verdrängt nie ein nützliches Modell.
- **Default off** auf dem constrained Pfad — die L3-Cache-Schicht holt die deterministischen Gewinne ; der Bandit kommt erst, wenn die Eval zeigt, dass ungenutztes VRAM brachliegt.

### Integration in vorhandenen Code

- **`ResourcePlanner` → Live-Budget.** Die `plan*()`-Helfer bleiben rein. Neu: ein `LiveBudget`, das die Footprints aktuell residenter Modelle vom freien Pool abzieht (statt jedes Mal neu zu proben) — macht aus dem Einmal-Advisor einen lebenden Pool. Der Klassen-Header antizipiert das bereits („callers can rerun a plan after a model loads").
- **`ModelsWorkerClient`.** `llmUnload`/`embedderUnload`/`rerankerUnload` existieren ([Z. 224-258](../../src/main/services/workers/ModelsWorkerClient.ts#L224)) — sie werden erstmals von einer Policy getrieben statt nur bei Shutdown. Keine neue Worker-Op nötig außer optional einem `planner.commit(residencySet)` für das Live-Budget.
- **`settings.ts`.** Neuer `placement`-Block ersetzt den Platzhalter `runtime.conversationSwitch`:

  ```ts
  placement: {
    mode: 'adaptive' | 'manual' // manual = heutiges statisches Verhalten (Default bis Phase 2 grün)
    vramHeadroomFraction: number // an ResourcePlanner durchgereicht
    enableSpeculative: boolean // L5, default false
    pins: Record<string, 'gpu' | 'cpu'> // User-Pins → Priority 'pinned'
    simulateVramCapGB: number | null // Dev/Eval: clamp usable VRAM (LOKLM_VRAM_CAP_GB override) so the
    // contended path is reproducible on a big card; null = real hardware
  }
  ```

  Die bestehenden `embedder.placement`/`reranker.placement: 'auto'|'cpu'|'gpu'` bleiben als **harte Constraints** erhalten — „manual wins", exakt wie `planAux` es heute behandelt. `adaptive` füllt nur, was auf `auto` steht.

### Schlüsselparameter

| Parameter                                 | Default                | Begründung                                                                                                                         |
| ----------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `RECENCY_HALFLIFE`                        | 30 min                 | Spiegelt die heutige LLM-Idle-Eviction — ein 30 min ungenutztes Feature ist „kalt".                                                |
| `HORIZON_H`                               | 15 min                 | Fenster für `expectedUses` ; lang genug für eine Arbeitssitzung, kurz genug gegen Stale-Demand.                                    |
| Markov-Ordnung                            | 1                      | Übergang prev→next reicht für Feature-Sequenzen ; höhere Ordnung braucht mehr Daten als ein Single-User-Journal liefert.           |
| `EVICT_HYSTERESIS`                        | 1.5×                   | Evict-Schwelle über Admit-Schwelle — verhindert Flapping zweier knapp konkurrierender Modelle.                                     |
| `MIN_RESIDENCY_MS`                        | 60 s                   | Mindesthaltedauer nach Load, unabhängig vom Score.                                                                                 |
| `COLD_TTL`                                | 30 min                 | Idle-Floor ; übernimmt `LOKLM_LLM_IDLE_MS`, generalisiert auf alle Runtimes.                                                       |
| VRAM-Headroom                             | 10 % + Plattform-Floor | Unverändert aus `ResourcePlanner` (DWM/Browser-GPU nicht aushungern).                                                              |
| `LOKLM_VRAM_CAP_GB` / `simulateVramCapGB` | unset                  | Klemmt nutzbares VRAM künstlich (Dev/Eval), damit der contended Pfad auf großen Karten reproduzierbar ist. Unset = echte Hardware. |
| `IDLE_BEFORE_SPECULATE_MS`                | 20 s                   | L5 feuert nur bei echter Ruhe.                                                                                                     |
| Replan-Debounce                           | 250 ms                 | Bündelt Event-Bursts zu einem Plan-Lauf.                                                                                           |

### Trigger

Re-Plan läuft (debounced) bei: **Usage-Event** (Demand ändert sich) · **VRAM-Druck** (Load passt nicht → Platz schaffen) · **Idle-Tick** (Decay erlaubt Evict kalter Modelle + erlaubt L5) · **Settings-Change** (Pin/Placement/Tier) · **Ressourcen-Change** (GPU erscheint/verschwindet, großer RAM-Swing).

## Adopt / Reject — Prior Art aus Produktion

| Pattern                                                                                                     | Quelle                                               | Verdikt                         | Begründung (LokLM-Constraint)                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kostenbewusstes Caching mit Size + Frequency + Aging (GreedyDual-Size-Frequency)                            | Cao/Irani, Young (kanonische Cache-Theorie)          | **adopt**                       | Exakt unser Problem: heterogene Objektgrößen (Footprint), heterogene Miss-Kosten (Cold-Load), Frequency-Gewichtung. `densityVram` = Wert/GB ist GDSFs Kernformel.                                    |
| TTL-basierte Idle-Eviction (`keep_alive`) + On-Demand-Load + `num_gpu`-Offload                              | Ollama (produktiv, wir fallen ohnehin auf es zurück) | **adopt**                       | `COLD_TTL` ist genau Ollamas `keep_alive` als Floor. Das `DemandModel` verallgemeinert Ollamas _flaches_ `keep_alive` zu einem _gelernten_ Per-Modell-TTL.                                           |
| Explizites Modell-Cache mit Prioritäten + Rate-Limiter (`--model-control-mode=explicit`, instance priority) | NVIDIA Triton                                        | **adopt**                       | Genau das Priority-+-LRU-Cache-Muster. Unsere `Priority`-Stufen + density-Eviction = Tritons Prioritäts-Cache, um Demand-Lernen erweitert.                                                           |
| Partial-Offload / `n_gpu_layers` (Modell teilbar über CPU/GPU)                                              | llama.cpp                                            | **adapt**                       | Liefert die Geräte-Granularität. v1 hält Placement _binär_ (gpu/cpu) ; fraktionales Offload als Future (Open Questions) — sonst explodiert der Suchraum.                                             |
| Markov-Next-Access-Prädiktion                                                                               | HW-/SW-Prefetcher (Joseph/Grunwald)                  | **adopt**                       | Der `Markov(prev→m)`-Term. Feature-Sequenzen sind stark korreliert (Index→QA, Write→Translate).                                                                                                      |
| Belady-MIN (Offline-Optimum)                                                                                | Cache-Theorie                                        | **adopt (nur als Eval-Orakel)** | Braucht Zukunftswissen → untaugbar als Policy, aber die _Untergrenze_ der Stall-Rate auf einem aufgezeichneten Trace. Unser Replay-Harness misst gegen diese Grenze.                                 |
| Kontextuelle Bandits (LinUCB, Thompson)                                                                     | Empfehlungs-/Prefetch-Systeme                        | **adopt (eng, nur L5)**         | Passt für Speculative Preload, wo der kontrafaktische Fall unbeobachtet bleibt. **Nicht** als Kern-Framing.                                                                                          |
| Ein-Modell-Serving mit Continuous Batching / PagedAttention als _Placement_-Modell                          | vLLM / TGI                                           | **reject**                      | Lösen ein anderes Problem (Durchsatz _eines_ Modells), nicht Cross-Modell-Residency. KV-Budgetierung haben wir bereits in `planLlm`.                                                                 |
| Bandit als Kern-Framing („1 Arm pro Modell, Pull = Laden")                                                  | —                                                    | **reject**                      | Verwirft Full-Feedback-Demand, modelliert ein kombinatorisches Set als Einzelzug, behandelt strukturierten Reward als opak. Der teuerste der drei Fehler ist der erste.                              |
| Reinforcement Learning end-to-end (Policy-Netz über Lade-Aktionen)                                          | —                                                    | **reject**                      | Single-User-Journal liefert zu wenig Daten ; nicht interpretierbar ; Reward = das, was die GDSF-Wertfunktion bereits _geschlossen_ berechnet. Keine Exploration nötig, wo der Reward analytisch ist. |

**Disagreement, das wir explizit entscheiden:** Ollama/Triton evictionieren nach _flachem_ TTL bzw. _reiner_ LRU ; die Cache-Theorie sagt size-+-cost-aware (GDSF). → **Seite GDSF**, weil unsere Objekte extrem heterogen sind (2 GB Embedder vs 9 GB LLM, Sekunden- vs Sub-Sekunden-Load) — flaches LRU/TTL ignoriert genau die Heterogenität, die hier den Ausschlag gibt.

## Evaluation (Eval-Säule, Owner Dominik)

**Gemessen wird gegen ein constrained Budget** (6/8/12-GB-Cap via `LOKLM_VRAM_CAP_GB` und CPU-only), **nicht gegen die 32 GB der Dev-Box** — sonst misst man den Admit-all-Fall, der nie evictioniert. Der VRAM-Cap macht den contended Pfad auf der 5090 reproduzierbar, ohne physisch eine kleine Karte zu brauchen.

- **Offline-Replay-Harness** als primäres Fixture: ein aufgezeichneter `usage_events`-Trace wird gegen Policy-Varianten abgespielt. Baselines: (a) heutiges statisches Keep-Warm, (b) flaches LRU, (c) unsere GDSF-Policy, (d) **Belady-MIN-Orakel** (Untergrenze). Die Lücke (c)→(d) ist die Bewertungszahl.
- **Metriken:** Cold-Load-Stall-Rate (Anteil Aufrufe auf kaltes Modell) · p50/p95 Time-to-First-Use · GPU-Sekunden-Auslastung · Thrash-Rate (Loads/Stunde) · „Evict-dann-Reload-innerhalb-T"-Verschwendung.
- **A/B hinter Flag**, gleicher Stil wie `routing: false` aus [ADR-0003] — `placement.mode: 'manual'` reproduziert exakt das heutige Verhalten und ist die Kontrollgruppe.

## Hardening / Risiken (vor Bau zu adressieren)

- **Thrashing auf knappem VRAM** → Hysterese + `MIN_RESIDENCY_MS` + Thrash-Rate als Eval-Gate (Merge nur wenn ≤ Baseline).
- **Cold-Start (keine Historie)** → `DemandModel` und `ModelStats` mit statischen Priors geseedet = exakt heutiges Verhalten. Die Policy _degradiert sauber_ zu „warm halten + manuelles Placement", bis Daten da sind. Kein Regressions-Cliff am ersten Tag.
- **Geräte-Move-Kosten beim Sidecar** (Kill+Respawn) → in `loadCostMs` gemessen, nicht geschätzt ; die Wertfunktion meidet sinnlose Moves selbst.
- **Privacy** → `usage_events` vault-verschlüsselt, nie übertragen, User-löschbar (Settings). Audit-Punkt im Security-Review.
- **Konkurrenz** → Residency-Anstieg darf nie zu _paralleler_ Inferenz auf dem geteilten Worker führen (0xC0000005-Falle). Reconciler ändert nur Residency, nicht die Inferenz-Serialisierung.
- **Komplexität / Audit-Surface** → phasenweiser, flag-gateter Rollout (unten) ; jede Phase ist allein nützlich und ohne die nächste sicher.

## Consequences

**Positiv**

- „Was wird wann wohin geladen" wird aus echter Nutzung gelernt, statt statisch zur Ladezeit geraten — der eigentliche Wunsch.
- **Per-Maschine adaptiv**: dieselbe Binary skaliert vom 6-GB-Laptop bis zur 32-GB-Workstation ohne Tier-Sonderfälle — reichlich VRAM ⇒ alles warm, knappes VRAM ⇒ wertbasierte Auswahl. Beides ist dieselbe Wertfunktion an unterschiedlichem Budget.
- Auf constrained Maschinen sinkt die Cold-Load-Stall-Rate gegen die Belady-Untergrenze ; knappes VRAM geht an die Modelle mit dem höchsten Wert/GB.
- `runtime.conversationSwitch` (AP-9-Platzhalter) und die brachliegenden `*Unload`-Ops bekommen endlich ihren Treiber.
- `ResourcePlanner` wird vom Einmal-Advisor zum lebenden Budget — nützlich auch unabhängig von der Policy.
- Manual-Mode = heutiges Verhalten als sauberer Fallback und Eval-Kontrollgruppe.

**Negativ**

- **Der Nutzen ist auf der Dev-Box unsichtbar** — bei 32 GB ist Admit-all korrekt und nichts evictioniert (gewolltes Verhalten, kein Bug). Heißt aber: Reviews/Evals müssen den `LOKLM_VRAM_CAP_GB`-Cap setzen oder auf echter constrained Hardware laufen, sonst testet man den degenerierten Fall.
- **Neue verschlüsselte Verhaltens-Tabelle** → Privacy-/Audit-Pflicht, Migration, Lösch-UI.
- **Mehr bewegliche Teile im Hot Path** (Lease, Reconcile, Re-Plan) → mehr Tests, mehr Audit-Surface ; Leasing muss wasserdicht sein, sonst entlädt der Reconciler ein Modell mitten in der Inferenz.
- **Bandit (L5) ist echte Exploration** → kann kurzfristig „daneben" vorladen ; deshalb bounded, idle-only, default-off.

## Open Questions

- **Fraktionales Offload** (`n_gpu_layers` als kontinuierliche statt binäre Geräte-Achse) — größerer Suchraum, erst nach binärer v1 evaluieren.
- **Speculative-Preload-Default** — bleibt off, bis der Replay-Harness brachliegendes VRAM nachweist (A/B gegen L3-only).
- **Cross-Session-Demand** — lohnt ein persistenter ToD-/Wochentag-Prior über Sitzungen hinweg, oder reicht das Pro-Sitzungs-Markov? Datenfrage, nach Phase 1 mit echtem Journal zu beantworten.
- **Tier-Wechsel zur Laufzeit** — heute Install-Zeit-fix ; eine adaptive Policy macht laufzeit-switchbare Profile erst sinnvoll, aber das ist ein eigenes ADR.

## Rollout (jede Phase allein nützlich, flag-gated)

0. **Substrat** — `ManagedModel`-Adapter + Leasing + Idle-Eviction auf alle Runtimes verallgemeinern + `ResourcePlanner` Live-Budget. Kein Lernen, keine Verhaltensänderung.
1. **Beobachtung** — `UsageJournal` + `model_stats` (gemessene loadCost/speedup/footprint) + Replay-Harness. Reines Logging, null Verhaltensänderung. Liefert die Daten, gegen die Phase 2 evaluiert.
2. **Policy** — `DemandModel` + `PlacementPolicy` + `ResidencyManager`, hinter `placement.mode`. A/B auf Replay-Harness + constrained Profil gegen Manual-Baseline.
3. **Priorität/Pinning** — Settings-UI für Pins + Priority.
4. **Speculative** — `SpeculativePreloader`, idle-only, bounded, default-off.

# LokLM — Demo-Runbook (3 Akte)

**Zweck:** Bühnen-tauglicher Demo-Ablauf für die Schul-Abgabe. Erzählung: *„LokLM
indexiert nicht das Internet — es indexiert genau das, was zählt, offline, privat, mit
klickbaren Quellenverweisen."* Die Embed-Limitierung (großer Korpus zu langsam) ist hier
**kein Mangel, sondern der Pitch**: kuratiert > breit.

> Status: Arbeitsdokument (EN/DE gemischt). Kann später als Handbuch-Anhang nach `dom/doku`
> übernommen werden. Liegt bewusst unter `docs/`, nicht unter `docs/project-handbook/`.

Annahme: **Live auf der Bühne** (Examiner stellt selbst Fragen). Dient gleichzeitig als
Screencast-Skript. Gesamtdauer ≈ **8–10 min**.

---

## Pre-Flight — VOR dem Auftritt erledigen

Embedding ist der langsame Schritt — **niemals live auf der Bühne embedden.**

- [ ] **Modelle geladen & gecacht:** LLM-Tier (qwen3.5-4b), Embedder (bge-m3),
      Reranker (bge-reranker-v2-m3) — in den Settings prüfen, dass alle „bereit" sind.
- [ ] **Beide Korpora vor-ingestiert und vollständig embedded:**
  - *Workspace A „Handbuch"*: die Markdown-Kapitel aus `docs/project-handbook/*.md`
    (ingestiert `.md` direkt — `DocumentService`, kein PDF-Export nötig).
  - *Workspace B „Survival"*: der kuratierte Slice (50 Artikel / ~2 900 Chunks) aus
    `tests/evals/data/corpora/wikipedia-survival/`.
- [ ] **Offline-Pre-Flight (kritisch):** Wi-Fi AUS → App starten → Tresor entsperren →
      eine Testfrage stellen. Muss komplett ohne Netz funktionieren. (Entsperren ist rein
      lokal — Argon2id, keine Netz-Calls in `AuthService`. Falls eine Lizenz-/Aktivierungs-
      prüfung existiert: einmal offline gegenchecken.)
- [ ] **Modell warmlaufen:** Backstage eine Wegwerf-Frage stellen, damit das LLM im RAM
      liegt — die erste Antwort sonst spürbar langsam (Modell-Load).
- [ ] **Plan B aufgenommen:** kompletter Durchlauf als Screen-Recording (Maschinen-Ausfall-
      Versicherung).
- [ ] **Das gebundene Handbuch liegt physisch auf dem Tisch** (für den Citation-Klick-Payoff
      in Akt 2).
- [ ] **Pro Akt eine „known-good" Frage** auswendig, die ihr vorher getestet habt.

---

## Akt 1 — „Wi-Fi aus" (Privacy-Proof) · ~1 min

1. **Claim aussprechen:** „Alles, was Sie gleich sehen, läuft ohne Netzwerk. Nutzerinhalte
   verlassen diese Maschine nie."
2. **Sichtbar Wi-Fi / Flugmodus einschalten** — OS-Netzwerk-Indikator zeigen.
3. **Ehrlicher Vorgriff** (entwaffnet die kritische Nachfrage): „Die Modelle wurden einmalig
   bei der Installation geladen — ab hier: null Netzwerk." (Beleg: Handbuch §21.6,
   Offline-Grundsatz; einzige Netzpfade sind einmaliger Modell-Download + optionales Remote-
   Ollama.)
4. Mit ausgeschaltetem Wi-Fi direkt in Akt 2.

---

## Akt 2 — Dogfood: die App erklärt sich selbst · ~3–4 min

Workspace **„Handbuch"** öffnen. Eskalierende Fragen (Wortlaut + Erwartung):

1. **„Wie verschlüsselt LokLM den Tresor?"**
   → AES-256-GCM Envelope, DEK unter Argon2id-KEK gewrappt. Zitiert Kap. 21.
2. **„Warum wurde Argon2id statt PBKDF2 gewählt?"**
   → Begründung aus dem Decision Log. Zitiert ADR-0001 / Kap. 23.
3. **„Welches Antwort-Modell liefert die beste Qualität?"**
   → qwen3-4b-instruct gewinnt; Retrieval dominiert. Zitiert Eval-Kapitel.
4. **Bewusst außerhalb des Korpus** (zeigt Ehrlichkeit, kein Halluzinieren):
   z. B. **„Wie viele Nutzer hat LokLM?"** → erwartet „steht nicht in den Dokumenten" /
   keine erfundene Zahl. *Groundedness-Beweis — Prüfer lieben das.*

**Der Payoff:** Auf einen Quellenverweis **klicken** → App springt zum exakten Chunk →
**das gebundene Buch zur selben Seite aufschlagen.** „Die Antwort ist nachvollziehbar bis
zu Seite X des Werks, das Sie in der Hand halten."

---

## Akt 3 — Survival-Slice: Generalisierung · ~2–3 min

Workspace **„Survival"** (neutrale Domäne → beweist, dass nicht auf das Handbuch
overfittet wurde). 2–3 praktische Fragen:

1. **„How do I purify water without electricity?"**
   → zitiert solar-water-disinfection / boiling / water-chlorination.
2. **„What are the first steps to treat hypothermia?"**
   → zitiert den Hypothermia-Artikel.
3. *(Optional, nur wenn vorher getestet)* **Cross-lingual:** Frage auf Deutsch stellen,
   Antwort zitiert die englische Quelle. Stark vor einem deutschsprachigen Panel.

**Abschluss-Slide — echte Zahlen** (eine Variante wählen, **keine erfundene Zahl**):

- **(a) Committed (sofort verfügbar):** `recall@5 = 0,973` (xquad-de-300q) bzw. `0,804`
  (focused-260q) über **15** Antwort-Modelle identisch → *„Retrieval dominiert, das
  Antwort-LLM kaum"*; das ausgelieferte qwen3.5-4b ist Top-3. Quelle:
  `tests/evals/results/eval-bericht-2026-06-07.md`.
- **(b) On-Narrative (Lauf nötig):** Survival-Eval auf dem 1 255-Fragen-Set
  (`wikipedia-survival-1255q-2026-06-13`) fahren → survival-spezifisches recall@k. Passt
  besser zu Akt 3, ist aber noch nicht committet (Report-Dir gitignored).

---

## Fallbacks (Live-Demo-Versicherung)

- **Frage liefert Müll** → die memorierte „known-good"-Frage des Akts nutzen.
- **Maschine stirbt** → auf das Screen-Recording schneiden.
- **Erste Antwort langsam** → Modell war pre-flight warmgelaufen (siehe Checkliste).
- **Examiner bohrt zur Privacy nach** → der ehrliche Vorgriff aus Akt 1 + Handbuch §21.6.

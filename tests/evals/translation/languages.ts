// languages , die sprach-achse der translation-eval.
//
// 35 sprachen: alle EU-amts-sprachen die der mirror hat + nordische +
// baltische + die größten community-/welt-sprachen (tr / ar / fa / ur / he /
// hi / zh / ja / ko / vi). Quelle ist der öffentliche FLORES-200 devtest-mirror
// haoranxu/FLORES-200 (parquet per sprachpaar , ungated) — der originale
// meta-tarball (dl.fbaipublicfiles.com) ist seit 2026 tot und FLORES+
// (openlanguagedata/flores_plus) ist HF-token-gated.
//
// Fehlen bewusst (nicht im mirror): sk / hr / sl / ga / mt (EU-amts-sprachen) ,
// dazu die long-tail (af/gu/ky/mg/mr/ne/uz …). Wer eine davon braucht , zieht
// den slice aus FLORES+ (HF-token , siehe README) — das format hier bleibt
// gleich , nur LANGUAGES + data/flores200-slice.json erweitern.
//
// `promptName` ist was ins übersetzungs-prompt geht. Für sr / mk explizit
// "(Cyrillic script)" — die FLORES-referenzen sind srp_Cyrl / mkd_Cyrl und
// modelle schreiben sonst gern latein-schrift , was chrF/COMET als totalausfall
// werten würde obwohl die übersetzung stimmt (genau der 9B-sr-effekt aus dem
// ersten lauf). zh ist auf "(Simplified)" gepinnt , weil die referenz zho_Hans
// ist und ein modell sonst traditionell antworten könnte.

export interface EvalLanguage {
  /** ISO-639-1 code wie im mirror (config-name `<code>-en` / `en-<code>`). */
  code: string
  /** sprach-name fürs prompt (englisch , wie in MT-eval üblich). */
  promptName: string
  /** anzeige-name für reports. */
  label: string
}

export const LANGUAGES: EvalLanguage[] = [
  // west-/südeuropa
  { code: 'de', promptName: 'German', label: 'Deutsch' },
  { code: 'fr', promptName: 'French', label: 'Französisch' },
  { code: 'it', promptName: 'Italian', label: 'Italienisch' },
  { code: 'es', promptName: 'Spanish', label: 'Spanisch' },
  { code: 'pt', promptName: 'Portuguese', label: 'Portugiesisch' },
  { code: 'nl', promptName: 'Dutch', label: 'Niederländisch' },
  { code: 'ca', promptName: 'Catalan', label: 'Katalanisch' },
  // nordeuropa
  { code: 'da', promptName: 'Danish', label: 'Dänisch' },
  { code: 'sv', promptName: 'Swedish', label: 'Schwedisch' },
  { code: 'no', promptName: 'Norwegian (Bokmål)', label: 'Norwegisch' },
  { code: 'fi', promptName: 'Finnish', label: 'Finnisch' },
  { code: 'is', promptName: 'Icelandic', label: 'Isländisch' },
  // mittel-/osteuropa + baltikum
  { code: 'pl', promptName: 'Polish', label: 'Polnisch' },
  { code: 'cs', promptName: 'Czech', label: 'Tschechisch' },
  { code: 'hu', promptName: 'Hungarian', label: 'Ungarisch' },
  { code: 'ro', promptName: 'Romanian', label: 'Rumänisch' },
  { code: 'et', promptName: 'Estonian', label: 'Estnisch' },
  { code: 'lt', promptName: 'Lithuanian', label: 'Litauisch' },
  { code: 'lv', promptName: 'Latvian', label: 'Lettisch' },
  // balkan + kyrillisch
  { code: 'bg', promptName: 'Bulgarian', label: 'Bulgarisch' },
  { code: 'el', promptName: 'Greek', label: 'Griechisch' },
  { code: 'sr', promptName: 'Serbian (Cyrillic script)', label: 'Serbisch' },
  { code: 'mk', promptName: 'Macedonian (Cyrillic script)', label: 'Mazedonisch' },
  { code: 'uk', promptName: 'Ukrainian', label: 'Ukrainisch' },
  { code: 'ru', promptName: 'Russian', label: 'Russisch' },
  // community-sprachen (AT) + welt
  { code: 'tr', promptName: 'Turkish', label: 'Türkisch' },
  { code: 'ar', promptName: 'Arabic', label: 'Arabisch' },
  { code: 'fa', promptName: 'Persian (Farsi)', label: 'Persisch' },
  { code: 'ur', promptName: 'Urdu', label: 'Urdu' },
  { code: 'he', promptName: 'Hebrew', label: 'Hebräisch' },
  { code: 'hi', promptName: 'Hindi', label: 'Hindi' },
  { code: 'zh', promptName: 'Chinese (Simplified)', label: 'Chinesisch' },
  { code: 'ja', promptName: 'Japanese', label: 'Japanisch' },
  { code: 'ko', promptName: 'Korean', label: 'Koreanisch' },
  { code: 'vi', promptName: 'Vietnamese', label: 'Vietnamesisch' },
]

/** direction-id im format `en-de` / `de-en`. en→xx misst "kann das modell in
 *  sprache X schreiben" (der für LokLM relevante fall: antwort in der sprache
 *  des users) , xx→en misst verständnis. */
export type Direction = `en-${string}` | `${string}-en`

export function directionsFor(code: string): [Direction, Direction] {
  return [`en-${code}` as Direction, `${code}-en` as Direction]
}

export function languageOf(direction: string): EvalLanguage {
  const code = direction.startsWith('en-') ? direction.slice(3) : direction.slice(0, -3)
  const lang = LANGUAGES.find((l) => l.code === code)
  if (!lang) throw new Error(`unbekannte direction ${direction}`)
  return lang
}

/** default-stichprobe pro richtung. devtest hat 1012 sätze , 100 reichen für
 *  stabile corpus-chrF/COMET-mittel (±1-2 punkte). Bei 35 sprachen × 2
 *  richtungen × 5 modellen sind das 35k segmente — ein paar stunden auf dem
 *  5090 ; mit `--limit` / `--langs` runterskalieren für schnellere durchläufe. */
export const DEFAULT_SAMPLE_SIZE = 100

/** deterministische stride-indizes: gleichmäßig über die 1012 devtest-sätze
 *  verteilt statt der ersten N (die clustern thematisch nach quell-artikel). */
export function strideIndices(total: number, n: number): number[] {
  const count = Math.min(n, total)
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(Math.floor((i * total) / count))
  return out
}

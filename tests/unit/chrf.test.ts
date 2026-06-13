import { describe, expect, it } from 'vitest'
import { chrfCorpus, chrfSegment } from '../evals/translation/chrf'

// chrF++ invarianten , keine sacrebleu-bit-parität (siehe kommentar in chrf.ts).
// getestet wird was die eval braucht: identität = 100 , disjunkt = 0 ,
// monotonie bei wachsendem überlapp , und dass corpus-aggregation leere
// hypothesen nicht zu NaN macht.

describe('chrfSegment', () => {
  it('identische strings geben 100', () => {
    expect(chrfSegment('Der Hund läuft schnell.', 'Der Hund läuft schnell.')).toBeCloseTo(100, 5)
  })

  it('disjunkte strings geben 0', () => {
    expect(chrfSegment('xxxxx yyyyy', 'aaaaa bbbbb')).toBe(0)
  })

  it('leere hypothese gibt 0 , kein NaN', () => {
    expect(chrfSegment('', 'Der Hund läuft.')).toBe(0)
  })

  it('mehr überlapp = höherer score', () => {
    const ref = 'Die Katze sitzt auf der Matte und schläft.'
    const good = chrfSegment('Die Katze sitzt auf der Matte und döst.', ref)
    const mid = chrfSegment('Die Katze liegt irgendwo im Haus.', ref)
    const bad = chrfSegment('Völlig anderer Satz ohne Bezug.', ref)
    expect(good).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(bad)
  })

  it('wortstellung zählt über wort-n-gramme , aber char-überlapp dominiert', () => {
    const ref = 'alpha beta gamma delta'
    const reordered = chrfSegment('delta gamma beta alpha', ref)
    // gleiche zeichen , andere reihenfolge: deutlich unter 100 aber weit über 0.
    expect(reordered).toBeGreaterThan(40)
    expect(reordered).toBeLessThan(95)
  })

  it('whitespace ist für char-n-gramme egal', () => {
    // char-orders sind perfekt (100) , wort-orders nicht (8 wörter vs 1) —
    // macht (6×100 + 0 + 0) / 8 = 75.
    expect(chrfSegment('a b c d e f g h', 'abcdefgh')).toBeCloseTo(75, 1)
  })

  it('nicht-lateinische schrift funktioniert (kyrillisch)', () => {
    const ref = 'Собака быстро бежит по улице.'
    expect(chrfSegment(ref, ref)).toBeCloseTo(100, 5)
    expect(chrfSegment('Кошка спит дома.', ref)).toBeLessThan(30)
  })
})

describe('chrfCorpus', () => {
  it('leeres corpus gibt 0', () => {
    expect(chrfCorpus([])).toBe(0)
  })

  it('corpus aus identischen paaren gibt 100', () => {
    const pairs = [
      { hyp: 'Der Hund läuft.', ref: 'Der Hund läuft.' },
      { hyp: 'Die Katze schläft.', ref: 'Die Katze schläft.' },
    ]
    expect(chrfCorpus(pairs)).toBeCloseTo(100, 5)
  })

  it('eine leere hypothese drückt den score , erzeugt aber kein NaN', () => {
    const pairs = [
      {
        hyp: 'Der Hund läuft schnell durch den Park.',
        ref: 'Der Hund läuft schnell durch den Park.',
      },
      { hyp: '', ref: 'Die Katze schläft auf dem Sofa.' },
    ]
    const score = chrfCorpus(pairs)
    expect(Number.isFinite(score)).toBe(true)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(100)
  })

  it('corpus-aggregation gewichtet nach n-gramm-masse , nicht pro segment', () => {
    // ein langes perfektes + ein kurzes falsches segment: corpus-score liegt
    // näher an 100 als das arithmetische mittel der segment-scores.
    const long =
      'Ein sehr langer Satz mit vielen Wörtern der die Statistik dominiert weil er so lang ist.'
    const pairs = [
      { hyp: long, ref: long },
      { hyp: 'xxx', ref: 'kurz' },
    ]
    const corpus = chrfCorpus(pairs)
    const meanOfSegments = (chrfSegment(long, long) + chrfSegment('xxx', 'kurz')) / 2
    expect(corpus).toBeGreaterThan(meanOfSegments)
  })
})

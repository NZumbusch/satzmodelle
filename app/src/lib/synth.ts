// Render a parsed score to an AudioBuffer (offline). Transposition is exact (no time-stretching).
import { beatToSeconds, type Score } from './musicxml';

export type Voice = 'piano' | 'harpsichord' | 'organ';

const HARMONICS: Record<Voice, number[]> = {
  piano: [0, 1, 0.45, 0.22, 0.12, 0.06, 0.03],
  harpsichord: [0, 1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.22, 0.15, 0.1],
  organ: [0, 1, 0.6, 0.15, 0.3, 0.05, 0.12],
};

export async function renderScore(score: Score, semitones = 0, voice: Voice = 'piano', sampleRate = 44100): Promise<AudioBuffer> {
  const end = beatToSeconds(score, score.beats) + 1.2;
  const ctx = new OfflineAudioContext(2, Math.ceil(end * sampleRate), sampleRate);
  const h = HARMONICS[voice];
  const wave = ctx.createPeriodicWave(new Float32Array(h), new Float32Array(h.length), { disableNormalization: false });
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  comp.connect(master).connect(ctx.destination);
  const parts = Math.max(1, score.parts.length);
  const pans = Array.from({ length: parts }, (_, i) => {
    const p = ctx.createStereoPanner();
    p.pan.value = parts === 1 ? 0 : -0.35 + (0.7 * i) / (parts - 1);
    p.connect(comp);
    return p;
  });
  // rough loudness normalisation by the maximum polyphony
  let poly = 1;
  for (const n of score.notes) {
    const c = score.notes.filter((m) => m.start <= n.start && m.start + m.dur > n.start).length;
    if (c > poly) poly = c;
  }
  const level = Math.min(0.35, 0.9 / poly);
  for (const n of score.notes) {
    const t0 = beatToSeconds(score, n.start);
    const t1 = beatToSeconds(score, n.start + n.dur);
    const f = 440 * 2 ** ((n.midi + semitones - 69) / 12);
    if (f < 20 || f > 8000) continue;
    const o = ctx.createOscillator();
    o.setPeriodicWave(wave);
    o.frequency.value = f;
    const g = ctx.createGain();
    const len = Math.max(0.05, t1 - t0);
    g.gain.setValueAtTime(0, t0);
    if (voice === 'organ') {
      g.gain.linearRampToValueAtTime(level, t0 + 0.02);
      g.gain.setValueAtTime(level, t0 + len - 0.03);
    } else {
      g.gain.linearRampToValueAtTime(level, t0 + 0.004);
      // piano-like decay, faster for high notes
      g.gain.setTargetAtTime(level * 0.25, t0 + 0.004, voice === 'harpsichord' ? 0.25 : 0.5 * (440 / Math.max(110, f)) ** 0.3);
    }
    g.gain.setTargetAtTime(0, t0 + len - 0.01, voice === 'harpsichord' ? 0.03 : 0.06);
    o.connect(g).connect(pans[n.part] ?? pans[0]);
    o.start(t0);
    o.stop(t0 + len + 0.5);
  }
  return ctx.startRendering();
}

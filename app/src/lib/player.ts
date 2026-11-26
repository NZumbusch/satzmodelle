// Audio engine: decoded buffer -> SoundTouch (tempo without pitch change, pitch in semitones)
// -> gain -> speakers. Supports seek, A-B loop with repeat count, count-in clicks.
import { SimpleFilter, SoundTouch, WebAudioBufferSource } from 'soundtouchjs';

const BUFFER = 4096;
let sharedCtx: AudioContext | null = null;

export function audioContext(): AudioContext {
  if (!sharedCtx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedCtx = new C();
  }
  return sharedCtx;
}

const decodeCache = new Map<Blob, Promise<AudioBuffer>>();

export function decode(blob: Blob): Promise<AudioBuffer> {
  let p = decodeCache.get(blob);
  if (!p) {
    p = blob.arrayBuffer().then((ab) => audioContext().decodeAudioData(ab));
    decodeCache.set(blob, p);
    if (decodeCache.size > 12) decodeCache.delete(decodeCache.keys().next().value!);
    p.catch(() => decodeCache.delete(blob));
  }
  return p;
}

export type PlayState = 'stopped' | 'counting' | 'playing';

export class Engine {
  readonly duration: number;
  state: PlayState = 'stopped';
  /** loop points in seconds; null = none */
  loopA: number | null = null;
  loopB: number | null = null;
  /** 0 = endless */
  repeats = 0;
  loopsDone = 0;
  countIn = 0; // number of clicks before playing
  countInInterval = 0.6; // seconds between clicks
  onChange: () => void = () => {};
  /** called when playback stops by itself (end of file or last loop repetition) */
  onEnded: () => void = () => {};
  /** called each time the A-B loop jumps back */
  onLoop: () => void = () => {};

  private ctx = audioContext();
  private st = new SoundTouch();
  private filter: SimpleFilter;
  private node: ScriptProcessorNode;
  private gain: GainNode;
  private samples = new Float32Array(BUFFER * 2);
  private base = 0; // position (s) at last rebase
  private outFrames = 0; // output frames since last rebase
  private _speed = 1;
  private _semitones = 0;
  private countTimer: number | undefined;

  private buffer: AudioBuffer;

  constructor(original: AudioBuffer) {
    this.duration = original.duration;
    // soundtouchjs only processes full 16k-frame blocks and reads past the end of the buffer:
    // pad with silence so the tail is played and nothing undefined is read.
    this.buffer = padBuffer(this.ctx, original, 1.5);
    this.filter = new SimpleFilter(new WebAudioBufferSource(this.buffer), this.st);
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.node = this.ctx.createScriptProcessor(BUFFER, 2, 2);
    this.node.onaudioprocess = (ev) => this.process(ev);
  }

  get position(): number {
    return Math.min(this.duration, this.base + (this.outFrames * this._speed) / this.ctx.sampleRate);
  }

  get speed() { return this._speed; }
  set speed(v: number) {
    this.rebase();
    this._speed = v;
    this.st.tempo = v;
  }

  get semitones() { return this._semitones; }
  set semitones(v: number) {
    this._semitones = v;
    this.st.pitchSemitones = v;
  }

  get volume() { return this.gain.gain.value; }
  set volume(v: number) { this.gain.gain.value = v; }

  private rebase() {
    this.base = this.position;
    this.outFrames = 0;
  }

  seek(seconds: number) {
    const s = Math.max(0, Math.min(this.duration, seconds));
    this.filter.sourcePosition = Math.floor(s * this.buffer.sampleRate);
    this.st.clear();
    this.base = s;
    this.outFrames = 0;
    this.onChange();
  }

  async play() {
    if (this.state !== 'stopped') return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.position >= this.duration - 0.05) this.seek(this.loopA ?? 0);
    this.loopsDone = 0;
    if (this.countIn > 0) {
      this.state = 'counting';
      this.onChange();
      const t0 = this.ctx.currentTime + 0.05;
      for (let i = 0; i < this.countIn; i++) this.click(t0 + i * this.countInInterval, i === 0);
      this.countTimer = window.setTimeout(() => this.start(), (0.05 + this.countIn * this.countInInterval) * 1000);
    } else this.start();
  }

  private start() {
    this.state = 'playing';
    this.node.connect(this.gain);
    this.onChange();
  }

  pause() {
    clearTimeout(this.countTimer);
    if (this.state === 'playing') {
      this.node.disconnect();
      // drop what SoundTouch buffered so resuming starts exactly where the display is
      this.seek(this.position);
    }
    this.state = 'stopped';
    this.onChange();
  }

  toggle() {
    if (this.state === 'stopped') this.play();
    else this.pause();
  }

  setLoop(a: number | null, b: number | null) {
    if (a !== null && b !== null && b < a) [a, b] = [b, a];
    if (a !== null && b !== null && b - a < 0.2) b = Math.min(this.duration, a + 0.2);
    this.loopA = a;
    this.loopB = b;
    this.loopsDone = 0;
    this.onChange();
  }

  private click(at: number, accent: boolean) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = accent ? 1760 : 1320;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.5, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    o.connect(g).connect(this.gain);
    o.start(at);
    o.stop(at + 0.08);
  }

  private process(ev: AudioProcessingEvent) {
    const l = ev.outputBuffer.getChannelData(0);
    const r = ev.outputBuffer.getChannelData(1);
    if (this.state !== 'playing') { l.fill(0); r.fill(0); return; }
    const n = this.filter.extract(this.samples, BUFFER);
    for (let i = 0; i < n; i++) { l[i] = this.samples[2 * i]; r[i] = this.samples[2 * i + 1]; }
    l.fill(0, n); r.fill(0, n);
    this.outFrames += n;
    const pos = this.position;
    const loopOn = this.loopA !== null && this.loopB !== null;
    if (loopOn && pos >= this.loopB! && (this.repeats === 0 || this.loopsDone < this.repeats - 1)) {
      this.loopsDone++;
      this.seek(this.loopA!);
      this.onLoop();
    } else if (loopOn && pos >= this.loopB! && this.repeats > 0) {
      // last repetition finished: stop at B, ready to repeat
      this.pause();
      this.seek(this.loopA!);
      this.onEnded();
    } else if (n === 0 || pos >= this.duration - 0.01) {
      this.pause();
      this.seek(loopOn ? this.loopA! : 0);
      this.onEnded();
    }
  }

  dispose() {
    clearTimeout(this.countTimer);
    this.node.onaudioprocess = null;
    try { this.node.disconnect(); } catch { /* not connected */ }
    this.gain.disconnect();
  }
}

function padBuffer(ctx: BaseAudioContext, b: AudioBuffer, seconds: number): AudioBuffer {
  const extra = Math.ceil(seconds * b.sampleRate);
  const out = ctx.createBuffer(Math.min(2, b.numberOfChannels), b.length + extra, b.sampleRate);
  for (let c = 0; c < out.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c), c);
  return out;
}

/** Peak envelope for drawing a waveform. */
export function peaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  const ch = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / buckets));
  for (let b = 0; b < buckets; b++) {
    let m = 0;
    const end = Math.min(ch.length, (b + 1) * step);
    for (let i = b * step; i < end; i += 4) { const v = Math.abs(ch[i]); if (v > m) m = v; }
    out[b] = m;
  }
  let max = 0;
  for (const v of out) if (v > max) max = v;
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

export function fmtTime(s: number): string {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

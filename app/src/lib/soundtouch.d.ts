declare module 'soundtouchjs' {
  export class SoundTouch {
    tempo: number;
    rate: number;
    pitch: number;
    pitchSemitones: number;
    clear(): void;
  }
  export class WebAudioBufferSource {
    constructor(buffer: AudioBuffer);
    extract(target: Float32Array, numFrames: number, position: number): number;
  }
  export class SimpleFilter {
    constructor(source: WebAudioBufferSource, pipe: SoundTouch, onEnd?: () => void);
    sourcePosition: number;
    extract(target: Float32Array, numFrames: number): number;
    clear(): void;
  }
}

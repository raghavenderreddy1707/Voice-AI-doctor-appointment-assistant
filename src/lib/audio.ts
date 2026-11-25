/**
 * Audio utilities for real-time voice calling:
 * - Manual 16-bit PCM little-endian encoding (16kHz mic input -> base64)
 * - Gapless 24kHz PCM playback scheduler with interruption support & amplitude metering
 * - Web Audio API synthesized ring, connect, and end-call tones
 */

export function computeRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return Math.min(1, rms * 3.8);
}

export function float32ToPcm16Base64(float32: Float32Array): string {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64Pcm16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const byteLen = binary.length;
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(byteLen / 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

export class Pcm24kPlayer {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private analyserData: Float32Array<ArrayBuffer>;
  private nextStartTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();

  constructor() {
    this.ctx = new AudioContext({ sampleRate: 24000 });
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.connect(this.ctx.destination);
    this.analyserData = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  enqueueBase64Pcm(base64: string): void {
    const samples = base64Pcm16ToFloat32(base64);
    if (samples.length === 0) return;

    const buffer = this.ctx.createBuffer(1, samples.length, 24000);
    buffer.getChannelData(0).set(samples);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);

    const now = this.ctx.currentTime;
    const startAt = Math.max(now + 0.015, this.nextStartTime);
    this.nextStartTime = startAt + buffer.duration;

    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
    };

    source.start(startAt);
  }

  interrupt(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // Already stopped
      }
    }
    this.activeSources.clear();
    this.nextStartTime = 0;
  }

  getLevel(): number {
    if (this.activeSources.size === 0) return 0;
    this.analyser.getFloatTimeDomainData(this.analyserData);
    return computeRms(this.analyserData);
  }

  isPlaying(): boolean {
    return this.activeSources.size > 0;
  }

  async close(): Promise<void> {
    this.interrupt();
    if (this.ctx.state !== 'closed') {
      await this.ctx.close();
    }
  }
}

export class CallToneSynthesizer {
  private ctx: AudioContext | null = null;
  private ringTimer: number | null = null;

  private ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private playRingBurst(): void {
    try {
      const ctx = this.ensureContext();
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.055, now + 0.04);
      gain.gain.setValueAtTime(0.055, now + 0.65);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.78);
      gain.connect(ctx.destination);

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(440, now);
      osc2.frequency.setValueAtTime(480, now);

      osc1.connect(gain);
      osc2.connect(gain);
      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.8);
      osc2.stop(now + 0.8);
    } catch {
      // Ignore autoplay blocks
    }
  }

  startRinging(): void {
    this.stopRinging();
    this.playRingBurst();
    this.ringTimer = window.setInterval(() => {
      this.playRingBurst();
    }, 2200);
  }

  stopRinging(): void {
    if (this.ringTimer !== null) {
      window.clearInterval(this.ringTimer);
      this.ringTimer = null;
    }
  }

  playConnectChime(): void {
    this.stopRinging();
    try {
      const ctx = this.ensureContext();
      const now = ctx.currentTime;
      const notes = [523.25, 659.25];
      notes.forEach((freq, i) => {
        const start = now + i * 0.08;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.06, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
        gain.connect(ctx.destination);

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        osc.connect(gain);
        osc.start(start);
        osc.stop(start + 0.18);
      });
    } catch {
      // Ignore audio errors
    }
  }

  playEndTone(): void {
    this.stopRinging();
    try {
      const ctx = this.ensureContext();
      const now = ctx.currentTime;
      const notes = [440, 329.63];
      notes.forEach((freq, i) => {
        const start = now + i * 0.11;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.055, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
        gain.connect(ctx.destination);

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        osc.connect(gain);
        osc.start(start);
        osc.stop(start + 0.2);
      });
    } catch {
      // Ignore audio errors
    }
  }

  dispose(): void {
    this.stopRinging();
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}

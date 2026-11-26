/**
 * Minimalist dark ambient synth + tactile studio foley WebAudio engine:
 * - Slow, drumless, dark Boards-of-Canada-inspired analog tape synth pads (D minor / Dorian / Phrygian voicings)
 * - Deep breathing sub-harmonic drone + subtle tape wow/flutter + faint cleanroom tape hiss
 * - Aperiodic experimental high-tech micro-glitches (tape splices, stepped digital dust, FM data sparks, sonar harmonics)
 * - Subterranean low-pass filter shift when the chrome ball travels inside the underneath half-pipe rails
 * - Tactile mechanical foley (steel-on-ABS clinks, rolling bed, iris ports, switch snaps, dark harmonic LED chimes)
 */

// Dark minor / Dorian / Phrygian-tinged voicings (Hz) — slow, haunted, zero rhythm
const CHORD_VOICINGS: { bass: number; notes: number[] }[] = [
  // Dm9
  { bass: 36.71, notes: [146.83, 174.61, 220.0, 261.63, 329.63] },
  // Bbmaj7#11 (dark nostalgic BOC lift)
  { bass: 29.14, notes: [116.54, 174.61, 220.0, 293.66, 329.63] },
  // Gm9
  { bass: 49.0, notes: [146.83, 196.0, 233.08, 293.66, 349.23] },
  // Am11 (suspended hollow fifths)
  { bass: 55.0, notes: [164.81, 196.0, 220.0, 293.66, 329.63] },
  // Dm(addb6) / Eb over D (cold sci-fi Phrygian tension)
  { bass: 36.71, notes: [146.83, 155.56, 220.0, 293.66, 349.23] },
  // Cadd9 / E
  { bass: 41.2, notes: [130.81, 196.0, 261.63, 293.66, 392.0] },
];

// Glassy high-tech telemetry / sonar tones in D Dorian/minor
const TELEMETRY_NOTES = [440.0, 523.25, 587.33, 659.25, 698.46, 880.0, 1046.5, 1174.66];

export class LabyrinthSound {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private musicMaster: GainNode | null = null;
  private musicDropGain: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private reverbSend: GainNode | null = null;
  private wowLfo: OscillatorNode | null = null;
  private wowDepth: GainNode | null = null;
  private subOsc1: OscillatorNode | null = null;
  private subOsc2: OscillatorNode | null = null;
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private enabled = true;
  private backgrounded = false;
  private suspendTimer: number | null = null;
  private lastHitAt = 0;
  private chordIndex = 0;
  private chordTimer: number | null = null;
  private glitchTimer: number | null = null;
  private lastSubterranean = false;

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.rollGain) {
      this.rollGain.gain.setTargetAtTime(0, now, 0.05);
    }
    if (this.musicMaster) {
      this.musicMaster.gain.cancelScheduledValues(now);
      this.musicMaster.gain.setTargetAtTime(on ? 0.54 : 0.0001, now, on ? 1.1 : 0.22);
    }
    if (this.sfxBus) {
      this.sfxBus.gain.setTargetAtTime(on ? 1.0 : 0.0001, now, 0.04);
    }
    if (on && !this.backgrounded) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      this.ensureSchedulers();
    } else {
      this.stopSchedulers();
    }
  }

  /** Cleanly mute and suspend all audio when the window blurs or tab hides, resuming smoothly on focus */
  setBackgrounded(paused: boolean) {
    if (paused === this.backgrounded) return;
    this.backgrounded = paused;
    if (!this.ctx) return;

    if (this.suspendTimer !== null) {
      window.clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }

    const now = this.ctx.currentTime;
    if (paused) {
      this.stopSchedulers();
      if (this.rollGain) this.rollGain.gain.setTargetAtTime(0, now, 0.02);
      if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(0.0001, now, 0.02);
      if (this.musicMaster) {
        this.musicMaster.gain.cancelScheduledValues(now);
        this.musicMaster.gain.setTargetAtTime(0.0001, now, 0.025);
      }
      this.suspendTimer = window.setTimeout(() => {
        this.suspendTimer = null;
        if (this.backgrounded && this.ctx && this.ctx.state === 'running') {
          void this.ctx.suspend();
        }
      }, 110);
    } else if (this.enabled) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(1.0, now, 0.04);
      if (this.musicMaster) {
        this.musicMaster.gain.cancelScheduledValues(now);
        this.musicMaster.gain.setTargetAtTime(0.54, now, 0.55);
      }
      this.ensureSchedulers();
    }
  }

  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      this.ctx = ctx;

      // Shared soft noise buffer (3s) for rolling bed, tape hiss & digital glitch grains
      const nLen = ctx.sampleRate * 3;
      const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
      const nData = nBuf.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < nLen; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + w * 0.029;
        b1 = 0.985 * b1 + w * 0.032;
        b2 = 0.95 * b2 + w * 0.048;
        nData[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + w * 0.14) * 0.65));
      }
      this.noiseBuf = nBuf;

      // --- 1. SFX Bus ---
      const sfxBus = ctx.createGain();
      sfxBus.gain.value = 1.0;
      sfxBus.connect(ctx.destination);
      this.sfxBus = sfxBus;

      // Continuous ultra-quiet filtered noise bed for rolling steel bearing on matte plastic
      const rollSrc = ctx.createBufferSource();
      rollSrc.buffer = nBuf;
      rollSrc.loop = true;

      const rollFilter = ctx.createBiquadFilter();
      rollFilter.type = 'bandpass';
      rollFilter.frequency.value = 340;
      rollFilter.Q.value = 2.6;

      const rollGain = ctx.createGain();
      rollGain.gain.value = 0;

      rollSrc.connect(rollFilter);
      rollFilter.connect(rollGain);
      rollGain.connect(sfxBus);
      rollSrc.start();

      this.rollFilter = rollFilter;
      this.rollGain = rollGain;

      // --- 2. Slow Dark Minimal BOC Ambient Synth Engine ---
      const musicMaster = ctx.createGain();
      musicMaster.gain.setValueAtTime(0.0001, ctx.currentTime);
      musicMaster.gain.linearRampToValueAtTime(0.54, ctx.currentTime + 2.8);

      // Dedicated dropout gain stage for subtle magnetic-tape splice dips
      const musicDropGain = ctx.createGain();
      musicDropGain.gain.value = 1.0;

      // Warm analog tape saturator (subtle odd/even soft-clipping)
      const tapeSat = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i * 2) / 255 - 1;
        curve[i] = Math.tanh(x * 1.65) / Math.tanh(1.65);
      }
      tapeSat.curve = curve;
      tapeSat.oversample = '2x';

      // Global atmosphere filter (darkens smoothly when inside the subterranean half-pipe rails)
      const musicFilter = ctx.createBiquadFilter();
      musicFilter.type = 'lowpass';
      musicFilter.frequency.value = 2600;
      musicFilter.Q.value = 0.7;

      // Dark 4.8s algorithmic stereo reverb (cold lab acoustics + warm tape decay)
      const convolver = ctx.createConvolver();
      convolver.buffer = this.createDarkReverbImpulse(ctx, 4.8);

      const reverbSend = ctx.createGain();
      reverbSend.gain.value = 0.72;

      const reverbReturn = ctx.createGain();
      reverbReturn.gain.value = 0.58;

      musicDropGain.connect(musicFilter);
      musicFilter.connect(tapeSat);
      tapeSat.connect(musicMaster);
      musicMaster.connect(ctx.destination);

      reverbSend.connect(convolver);
      convolver.connect(reverbReturn);
      reverbReturn.connect(musicDropGain);

      this.musicMaster = musicMaster;
      this.musicDropGain = musicDropGain;
      this.musicFilter = musicFilter;
      this.reverbSend = reverbSend;

      // Tape wow & flutter pitch-drift LFO (shared across pad voices & drone)
      const wowLfo = ctx.createOscillator();
      wowLfo.type = 'sine';
      wowLfo.frequency.value = 0.14;
      const flutterLfo = ctx.createOscillator();
      flutterLfo.type = 'triangle';
      flutterLfo.frequency.value = 0.53;
      const flutterGain = ctx.createGain();
      flutterGain.gain.value = 4.2; // cents
      const wowDepth = ctx.createGain();
      wowDepth.gain.value = 10.5; // cents slow analog drift

      wowLfo.connect(wowDepth);
      flutterLfo.connect(flutterGain);
      flutterGain.connect(wowDepth);
      wowLfo.start();
      flutterLfo.start();
      this.wowLfo = wowLfo;
      this.wowDepth = wowDepth;

      // Continuous deep sub-harmonic drone (D1 + D2 triangle/sine breathing through slow LPF)
      const droneFilter = ctx.createBiquadFilter();
      droneFilter.type = 'lowpass';
      droneFilter.frequency.value = 135;
      droneFilter.Q.value = 1.4;

      const droneBreathLfo = ctx.createOscillator();
      droneBreathLfo.type = 'sine';
      droneBreathLfo.frequency.value = 0.048;
      const droneBreathGain = ctx.createGain();
      droneBreathGain.gain.value = 55;
      droneBreathLfo.connect(droneBreathGain);
      droneBreathGain.connect(droneFilter.frequency);
      droneBreathLfo.start();

      const droneGain = ctx.createGain();
      droneGain.gain.value = 0.14;

      const subOsc1 = ctx.createOscillator();
      subOsc1.type = 'sine';
      subOsc1.frequency.value = CHORD_VOICINGS[0].bass;

      const subOsc2 = ctx.createOscillator();
      subOsc2.type = 'triangle';
      subOsc2.frequency.value = CHORD_VOICINGS[0].bass * 2;
      subOsc2.detune.value = -5;
      wowDepth.connect(subOsc2.detune);

      const sub2Gain = ctx.createGain();
      sub2Gain.gain.value = 0.38;

      subOsc1.connect(droneFilter);
      subOsc2.connect(sub2Gain);
      sub2Gain.connect(droneFilter);
      droneFilter.connect(droneGain);
      droneGain.connect(musicDropGain);
      droneGain.connect(reverbSend);

      subOsc1.start();
      subOsc2.start();
      this.subOsc1 = subOsc1;
      this.subOsc2 = subOsc2;

      // Faint vintage reel-to-reel tape hiss / dark laboratory cleanroom floor
      const hissSrc = ctx.createBufferSource();
      hissSrc.buffer = nBuf;
      hissSrc.loop = true;
      const hissBand = ctx.createBiquadFilter();
      hissBand.type = 'bandpass';
      hissBand.frequency.value = 2150;
      hissBand.Q.value = 0.85;
      const hissGain = ctx.createGain();
      hissGain.gain.value = 0.011;
      hissSrc.connect(hissBand);
      hissBand.connect(hissGain);
      hissGain.connect(musicDropGain);
      hissSrc.start();

      // Start the slow, non-rhythmic generative chord & experimental glitch loops
      this.chordIndex = 0;
      this.triggerSlowPadChord(0);
      this.ensureSchedulers();
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  /** Smoothly shift ambient acoustics darker while the ball travels underneath in the half-pipe rails */
  updateAmbience(inPipe: boolean) {
    if (inPipe === this.lastSubterranean) return;
    this.lastSubterranean = inPipe;
    if (!this.ctx || !this.musicFilter) return;
    const now = this.ctx.currentTime;
    this.musicFilter.frequency.setTargetAtTime(inPipe ? 840 : 2600, now, 0.28);
  }

  private createDarkReverbImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Exponential dark decay with slight pre-delay bloom
        const env = Math.pow(1 - t, 2.75) * Math.min(1, i / (ctx.sampleRate * 0.035));
        const white = Math.random() * 2 - 1;
        // Progressive low-pass damping so high frequencies vanish into dark velvet
        const alpha = 0.06 + (1 - t) * 0.16;
        lp += (white - lp) * alpha;
        data[i] = lp * env * 0.85;
      }
    }
    return buf;
  }

  private ensureSchedulers() {
    if (this.chordTimer === null) {
      const scheduleNextChord = () => {
        // Irregular 13..20s drift — completely non-metric, slow breathing
        const waitMs = 13000 + Math.random() * 7500;
        this.chordTimer = window.setTimeout(() => {
          this.chordTimer = null;
          if (!this.enabled || !this.ctx) return;
          if (this.ctx.state === 'running') {
            this.chordIndex = (this.chordIndex + 1 + (Math.random() < 0.28 ? 1 : 0)) % CHORD_VOICINGS.length;
            this.triggerSlowPadChord(this.chordIndex);
          }
          scheduleNextChord();
        }, waitMs);
      };
      scheduleNextChord();
    }

    if (this.glitchTimer === null) {
      const scheduleNextGlitch = () => {
        // Aperiodic 3.2..8.8s experimental high-tech micro-glitches
        const waitMs = 3200 + Math.random() * 5600;
        this.glitchTimer = window.setTimeout(() => {
          this.glitchTimer = null;
          if (!this.enabled || !this.ctx) return;
          if (this.ctx.state === 'running') {
            this.triggerExperimentalGlitch();
          }
          scheduleNextGlitch();
        }, waitMs);
      };
      scheduleNextGlitch();
    }
  }

  private stopSchedulers() {
    if (this.chordTimer !== null) {
      window.clearTimeout(this.chordTimer);
      this.chordTimer = null;
    }
    if (this.glitchTimer !== null) {
      window.clearTimeout(this.glitchTimer);
      this.glitchTimer = null;
    }
  }

  /**
   * Slow, hazy Boards-of-Canada detuned analog pad chord with tape-sag entry and long filter bloom.
   */
  private triggerSlowPadChord(index: number) {
    if (!this.ctx || !this.musicDropGain || !this.reverbSend || !this.wowDepth) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const voicing = CHORD_VOICINGS[index % CHORD_VOICINGS.length];

    // Glide the deep sub-bass drone slowly to the new harmonic root
    if (this.subOsc1 && this.subOsc2) {
      this.subOsc1.frequency.setTargetAtTime(voicing.bass, now, 1.8);
      this.subOsc2.frequency.setTargetAtTime(voicing.bass * 2, now, 1.8);
    }

    // Pick 3–4 voices from the dark voicing for sparse, hollow harmonic beauty
    const shuffled = voicing.notes.slice().sort(() => Math.random() - 0.5);
    const chosen = shuffled.slice(0, Math.random() < 0.45 ? 3 : 4);

    const attack = 4.2 + Math.random() * 2.2;
    const hold = 3.5 + Math.random() * 3.0;
    const release = 6.5 + Math.random() * 3.0;
    const totalDur = attack + hold + release;

    // Shared warm resonant low-pass filter for this chord swell
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    const peakCutoff = 460 + Math.random() * 440;
    padFilter.frequency.setValueAtTime(190, now);
    padFilter.frequency.exponentialRampToValueAtTime(peakCutoff, now + attack + hold * 0.45);
    padFilter.frequency.exponentialRampToValueAtTime(170, now + totalDur);
    padFilter.Q.value = 1.6 + Math.random() * 1.4;

    const padEnv = ctx.createGain();
    padEnv.gain.setValueAtTime(0.0001, now);
    padEnv.gain.linearRampToValueAtTime(0.068, now + attack);
    padEnv.gain.setValueAtTime(0.062, now + attack + hold);
    padEnv.gain.exponentialRampToValueAtTime(0.0001, now + totalDur);

    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime((Math.random() - 0.5) * 0.45, now);

    padFilter.connect(padEnv);
    padEnv.connect(pan);
    pan.connect(this.musicDropGain);
    pan.connect(this.reverbSend);

    for (let i = 0; i < chosen.length; i++) {
      const freq = chosen[i];
      // Slight analog tape-sag pitch bend on note entrance
      const sagCents = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 10);

      // Pair: warm sawtooth + slightly detuned triangle one octave or unison
      const oscA = ctx.createOscillator();
      oscA.type = 'sawtooth';
      oscA.frequency.setValueAtTime(freq, now);
      oscA.detune.setValueAtTime(sagCents - 7, now);
      oscA.detune.linearRampToValueAtTime(-5 + (Math.random() - 0.5) * 4, now + attack * 0.8);

      const oscB = ctx.createOscillator();
      oscB.type = 'triangle';
      oscB.frequency.setValueAtTime(freq * (i === chosen.length - 1 && Math.random() < 0.35 ? 2 : 1), now);
      oscB.detune.setValueAtTime(sagCents + 8, now);
      oscB.detune.linearRampToValueAtTime(6 + (Math.random() - 0.5) * 4, now + attack * 0.8);

      this.wowDepth.connect(oscA.detune);
      this.wowDepth.connect(oscB.detune);

      const vGain = ctx.createGain();
      vGain.gain.value = 1 / chosen.length;

      oscA.connect(vGain);
      oscB.connect(vGain);
      vGain.connect(padFilter);

      oscA.start(now);
      oscB.start(now);
      oscA.stop(now + totalDur + 0.15);
      oscB.stop(now + totalDur + 0.15);
    }
  }

  /**
   * Sparse, surgical, non-rhythmic experimental glitches & high-tech spectral artifacts.
   */
  private triggerExperimentalGlitch() {
    if (!this.ctx || !this.musicDropGain || !this.reverbSend) return;
    const roll = Math.random();
    if (roll < 0.24) {
      this.glitchTapeSpliceDropout();
    } else if (roll < 0.5) {
      this.glitchDigitalDataSparks();
    } else if (roll < 0.72) {
      this.glitchTelemetryPing();
    } else if (roll < 0.88) {
      this.glitchSteppedStaticGrain();
    } else {
      this.glitchReverseHarmonicCut();
    }
  }

  /** 1. Momentary worn-tape dropout / splice dip on the synth bus */
  private glitchTapeSpliceDropout() {
    if (!this.ctx || !this.musicDropGain) return;
    const now = this.ctx.currentTime;
    const dur = 0.08 + Math.random() * 0.14;
    const dip = 0.28 + Math.random() * 0.3;
    this.musicDropGain.gain.cancelScheduledValues(now);
    this.musicDropGain.gain.setValueAtTime(1.0, now);
    this.musicDropGain.gain.linearRampToValueAtTime(dip, now + 0.012);
    this.musicDropGain.gain.linearRampToValueAtTime(1.0, now + dur);

    // Subtle tiny splice micro-tick at the edit point
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2800 + Math.random() * 1900, now);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.014, now + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.016);
    osc.connect(g);
    g.connect(this.reverbSend!);
    osc.start(now);
    osc.stop(now + 0.02);
  }

  /** 2. High-tech micro-granular FM data sparks (irregular 2..5 tiny stepped chirps) */
  private glitchDigitalDataSparks() {
    if (!this.ctx || !this.musicDropGain || !this.reverbSend) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const count = 2 + Math.floor(Math.random() * 4);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 1.4;
    pan.connect(this.musicDropGain);
    pan.connect(this.reverbSend);

    let offset = 0;
    for (let i = 0; i < count; i++) {
      const t0 = now + offset;
      const dur = 0.009 + Math.random() * 0.018;
      const carrier = ctx.createOscillator();
      carrier.type = Math.random() < 0.5 ? 'sine' : 'square';
      const baseF = 1400 + Math.random() * 3800;
      carrier.frequency.setValueAtTime(baseF, t0);
      carrier.frequency.setValueAtTime(baseF * (Math.random() < 0.5 ? 1.5 : 0.5), t0 + dur * 0.5);

      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = baseF;
      hp.Q.value = 3.5;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.016 + Math.random() * 0.012, t0 + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      carrier.connect(hp);
      hp.connect(g);
      g.connect(pan);
      carrier.start(t0);
      carrier.stop(t0 + dur + 0.01);

      offset += dur + 0.018 + Math.random() * 0.065;
    }
  }

  /** 3. Cold glassy FM telemetry harmonic ping drifting in stereo reverb */
  private glitchTelemetryPing() {
    if (!this.ctx || !this.musicDropGain || !this.reverbSend || !this.wowDepth) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const freq = TELEMETRY_NOTES[Math.floor(Math.random() * TELEMETRY_NOTES.length)];
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 1.3;
    pan.connect(this.musicDropGain);
    pan.connect(this.reverbSend);

    const playPing = (t0: number, amp: number, f: number) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t0);
      this.wowDepth!.connect(osc.detune);

      // Subtle metallic FM modulator
      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.setValueAtTime(f * 2.005, t0);
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(f * 0.12, t0);
      modGain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.35);
      mod.connect(modGain);
      modGain.connect(osc.frequency);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.85);

      osc.connect(g);
      g.connect(pan);
      osc.start(t0);
      mod.start(t0);
      osc.stop(t0 + 1.9);
      mod.stop(t0 + 1.9);
    };

    playPing(now, 0.022, freq);
    // Occasional ghostly uneven tape echo (never regular!)
    if (Math.random() < 0.55) {
      playPing(now + 0.31 + Math.random() * 0.42, 0.009, freq * (Math.random() < 0.25 ? 0.5 : 1));
    }
  }

  /** 4. Sample-and-hold bit-crushed digital dust grain dissolved into reverb */
  private glitchSteppedStaticGrain() {
    if (!this.ctx || !this.reverbSend || !this.musicDropGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = 0.045 + Math.random() * 0.08;
    const samples = Math.max(64, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Stair-step sample-and-hold decimation (authentic vintage lo-fi DSP artifact)
    const step = 12 + Math.floor(Math.random() * 28);
    let held = 0;
    for (let i = 0; i < samples; i++) {
      if (i % step === 0) held = Math.random() * 2 - 1;
      const win = Math.sin((i / samples) * Math.PI);
      data[i] = held * win;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100 + Math.random() * 2400;
    bp.Q.value = 2.4;

    const g = ctx.createGain();
    g.gain.value = 0.026;

    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 1.5;

    src.connect(bp);
    bp.connect(g);
    g.connect(pan);
    pan.connect(this.reverbSend);
    pan.connect(this.musicDropGain);
    src.start(now);
  }

  /** 5. Reverse-tape harmonic swell ending in an abrupt splice cut into dark reverb (classic BOC) */
  private glitchReverseHarmonicCut() {
    if (!this.ctx || !this.reverbSend || !this.wowDepth) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const voicing = CHORD_VOICINGS[this.chordIndex % CHORD_VOICINGS.length];
    const freq = voicing.notes[Math.floor(Math.random() * voicing.notes.length)] * (Math.random() < 0.5 ? 1 : 2);
    const swellDur = 1.4 + Math.random() * 1.2;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * 0.992, now);
    osc.frequency.linearRampToValueAtTime(freq, now + swellDur);
    this.wowDepth.connect(osc.detune);

    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(240, now);
    lpf.frequency.exponentialRampToValueAtTime(1400, now + swellDur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.036, now + swellDur);
    // Abrupt tape splice cut!
    g.gain.linearRampToValueAtTime(0.0001, now + swellDur + 0.014);

    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 1.1;

    osc.connect(lpf);
    lpf.connect(g);
    g.connect(pan);
    pan.connect(this.reverbSend);

    osc.start(now);
    osc.stop(now + swellDur + 0.04);
  }

  // =========================================================================
  // TACTILE STUDIO FOLEY & HARMONIC FEEDBACK (TUNED TO D MINOR / DORIAN)
  // =========================================================================

  updateRoll(speed: number) {
    if (!this.ctx || !this.rollGain || !this.rollFilter || !this.enabled || this.ctx.state !== 'running') return;
    const norm = Math.min(1, speed / 2.6);
    const targetGain = norm > 0.04 ? norm * norm * 0.032 : 0;
    const targetFreq = 220 + norm * 620;
    const now = this.ctx.currentTime;
    this.rollGain.gain.setTargetAtTime(targetGain, now, 0.04);
    this.rollFilter.frequency.setTargetAtTime(targetFreq, now, 0.05);
  }

  playWallHit(strength: number) {
    if (!this.enabled || !this.ctx || !this.sfxBus || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (now - this.lastHitAt < 0.045) return;
    this.lastHitAt = now;

    const vol = 0.024 + strength * 0.09;
    const baseFreq = 920 + Math.random() * 220 + strength * 260;

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.58, now + 0.028);

    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(baseFreq * 2.42, now);
    osc2.frequency.exponentialRampToValueAtTime(baseFreq * 1.6, now + 0.018);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.038);

    const g2 = this.ctx.createGain();
    g2.gain.setValueAtTime(0.0001, now);
    g2.gain.linearRampToValueAtTime(vol * 0.45, now + 0.0015);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);

    osc.connect(g);
    osc2.connect(g2);
    g.connect(this.sfxBus);
    g2.connect(this.sfxBus);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + 0.045);
    osc2.stop(now + 0.028);
  }

  playCheckpoint(index: number, allCleared: boolean) {
    if (!this.enabled || !this.ctx || !this.sfxBus || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // Harmonically matched D minor9 chime tones (D4, F4, A4, C5, E5) flowing into the dark reverb
    const notes = [293.66, 349.23, 440.0, 523.25, 659.25];
    const freq = notes[index % notes.length];

    const playTone = (f: number, delay: number, dur: number, amp: number) => {
      if (!this.ctx || !this.sfxBus) return;
      const t0 = now + delay;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t0);
      if (this.wowDepth) this.wowDepth.connect(osc.detune);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(g);
      g.connect(this.sfxBus);
      if (this.reverbSend) g.connect(this.reverbSend);
      osc.start(t0);
      osc.stop(t0 + dur + 0.04);
    };

    playTone(freq, 0, 0.65, 0.075);
    playTone(freq * 2, 0.014, 0.34, 0.018);

    if (allCleared) {
      // Slow haunted Dm9 arpeggiated bloom on level complete
      playTone(293.66, 0.16, 1.35, 0.055);
      playTone(440.0, 0.32, 1.45, 0.05);
      playTone(523.25, 0.48, 1.65, 0.048);
      playTone(659.25, 0.68, 2.0, 0.045);
    }
  }

  /** Subtle mechanical precision-actuator whirr & soft detent clicks when the sphere morphs between levels */
  playMorph() {
    if (!this.enabled || !this.ctx || !this.sfxBus || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(164.81, now + 0.48);
    osc.frequency.exponentialRampToValueAtTime(146.83, now + 0.95);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.028, now + 0.16);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.05);

    osc.connect(g);
    g.connect(this.sfxBus);
    if (this.reverbSend) g.connect(this.reverbSend);
    osc.start(now);
    osc.stop(now + 1.08);

    const tickTimes = [0.08, 0.24, 0.44, 0.64, 0.82];
    for (let i = 0; i < tickTimes.length; i++) {
      const t0 = now + tickTimes[i];
      const tick = this.ctx.createOscillator();
      tick.type = 'triangle';
      const f = 720 + i * 70;
      tick.frequency.setValueAtTime(f, t0);
      tick.frequency.exponentialRampToValueAtTime(f * 0.65, t0 + 0.02);

      const tg = this.ctx.createGain();
      tg.gain.setValueAtTime(0.0001, t0);
      tg.gain.linearRampToValueAtTime(0.016, t0 + 0.002);
      tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.024);

      tick.connect(tg);
      tg.connect(this.sfxBus);
      tick.start(t0);
      tick.stop(t0 + 0.028);
    }
  }

  /** Hollow resonant steel clunk when dropping down through a diaphragm iris into the half-pipe below */
  playPortalDrop() {
    if (!this.enabled || !this.ctx || !this.sfxBus || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(349.23, now);
    osc.frequency.exponentialRampToValueAtTime(146.83, now + 0.18);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.08, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

    osc.connect(g);
    g.connect(this.sfxBus);
    if (this.reverbSend) g.connect(this.reverbSend);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  /** Crisp upward mechanical pop when emerging back out of an open iris onto the upper track */
  playPortalEmerge() {
    if (!this.enabled || !this.ctx || !this.sfxBus || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.13);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.06, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    osc.connect(g);
    g.connect(this.sfxBus);
    if (this.reverbSend) g.connect(this.reverbSend);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  /** Crisp Braun/Leica tactile micro-switch click-clack when pressing a floor Toggle Pad */
  playToggle(active: boolean) {
    if (!this.enabled || !this.ctx || !this.sfxBus || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    const click = this.ctx.createOscillator();
    click.type = 'triangle';
    click.frequency.setValueAtTime(active ? 1180 : 880, now);
    click.frequency.exponentialRampToValueAtTime(active ? 540 : 410, now + 0.025);

    const cg = this.ctx.createGain();
    cg.gain.setValueAtTime(0.0001, now);
    cg.gain.linearRampToValueAtTime(0.08, now + 0.002);
    cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);

    click.connect(cg);
    cg.connect(this.sfxBus);
    click.start(now);
    click.stop(now + 0.038);

    // Subtle D-minor tuned confirmation tone (A4 -> D5 on ON, F4 -> D4 on OFF)
    const tone = this.ctx.createOscillator();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(active ? 440 : 349.23, now + 0.028);
    tone.frequency.exponentialRampToValueAtTime(active ? 587.33 : 293.66, now + 0.2);

    const tg = this.ctx.createGain();
    tg.gain.setValueAtTime(0.0001, now + 0.028);
    tg.gain.linearRampToValueAtTime(0.038, now + 0.042);
    tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

    tone.connect(tg);
    tg.connect(this.sfxBus);
    if (this.reverbSend) tg.connect(this.reverbSend);
    tone.start(now + 0.028);
    tone.stop(now + 0.3);
  }

  /** Brief rising tension hum as the sphere lifts before dropping in the grand finale */
  playFinaleLift() {
    if (!this.enabled || !this.ctx || !this.sfxBus || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(146.83, now);
    osc.frequency.exponentialRampToValueAtTime(293.66, now + 0.52);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.055, now + 0.14);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);

    osc.connect(g);
    g.connect(this.sfxBus);
    if (this.reverbSend) g.connect(this.reverbSend);
    osc.start(now);
    osc.stop(now + 0.66);
  }

  /** Tactile studio floor landing + pressurized polycarbonate equatorial seal pop + resolving D-major9 bloom */
  playFinaleSealPop() {
    if (!this.enabled || !this.ctx || !this.sfxBus || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 1. Clean studio floor landing thump
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(125, now);
    thump.frequency.exponentialRampToValueAtTime(42, now + 0.18);
    const thumpG = ctx.createGain();
    thumpG.gain.setValueAtTime(0.0001, now);
    thumpG.gain.linearRampToValueAtTime(0.22, now + 0.006);
    thumpG.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    thump.connect(thumpG);
    thumpG.connect(this.sfxBus);
    thump.start(now);
    thump.stop(now + 0.28);

    // 2. Crisp acrylic equatorial seal snap + subtle pressurized air release!
    const snap = ctx.createOscillator();
    snap.type = 'triangle';
    snap.frequency.setValueAtTime(1480, now + 0.012);
    snap.frequency.exponentialRampToValueAtTime(520, now + 0.068);
    const snapG = ctx.createGain();
    snapG.gain.setValueAtTime(0.0001, now + 0.012);
    snapG.gain.linearRampToValueAtTime(0.16, now + 0.016);
    snapG.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    snap.connect(snapG);
    snapG.connect(this.sfxBus);
    if (this.reverbSend) snapG.connect(this.reverbSend);
    snap.start(now + 0.012);
    snap.stop(now + 0.1);

    if (this.noiseBuf) {
      const hiss = ctx.createBufferSource();
      hiss.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(3100, now + 0.01);
      bp.frequency.exponentialRampToValueAtTime(1400, now + 0.16);
      bp.Q.value = 1.6;
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0.0001, now + 0.01);
      hg.gain.linearRampToValueAtTime(0.09, now + 0.02);
      hg.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      hiss.connect(bp);
      bp.connect(hg);
      hg.connect(this.sfxBus);
      hiss.start(now + 0.01, Math.random() * 1.4, 0.22);
    }

    // 3. Two hollow polycarbonate dome separation clacks (left & right stereo)
    for (let i = 0; i < 2; i++) {
      const t0 = now + 0.055 + i * 0.045;
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f = i === 0 ? 740 : 620;
      o.frequency.setValueAtTime(f, t0);
      o.frequency.exponentialRampToValueAtTime(f * 0.72, t0 + 0.065);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.075, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.085);
      const pan = ctx.createStereoPanner();
      pan.pan.value = i === 0 ? 0.55 : -0.55;
      o.connect(g);
      g.connect(pan);
      pan.connect(this.sfxBus);
      o.start(t0);
      o.stop(t0 + 0.095);
    }

    // 4. Warm uplifting D-major9 liberation chord bloom (resolving the game's D-minor tension!)
    const fanfare = [293.66, 369.99, 440.0, 554.37, 659.25, 880.0];
    for (let i = 0; i < fanfare.length; i++) {
      const t0 = now + 0.14 + i * 0.095;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(fanfare[i], t0);
      if (this.wowDepth) this.wowDepth.connect(osc.detune);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.048, t0 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
      osc.connect(g);
      g.connect(this.sfxBus);
      if (this.reverbSend) g.connect(this.reverbSend);
      osc.start(t0);
      osc.stop(t0 + 2.7);
    }
  }

  /** Authentic glassy sea-glass marble clink-bounce on the studio floor */
  playMarbleBounce(strength: number) {
    if (!this.enabled || !this.ctx || !this.sfxBus || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = 0.025 + Math.min(1, strength) * 0.095;

    const f1 = 2350 + Math.random() * 280;
    const f2 = f1 * 2.18;

    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(f1, now);
    o1.frequency.exponentialRampToValueAtTime(f1 * 0.92, now + 0.042);

    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(f2, now);

    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.linearRampToValueAtTime(vol, now + 0.0015);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, now);
    g2.gain.linearRampToValueAtTime(vol * 0.4, now + 0.001);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);

    o1.connect(g1);
    o2.connect(g2);
    g1.connect(this.sfxBus);
    g2.connect(this.sfxBus);
    if (this.reverbSend) g1.connect(this.reverbSend);
    o1.start(now);
    o2.start(now);
    o1.stop(now + 0.07);
    o2.stop(now + 0.038);
  }

  /** Soft pressurized colored-smoke flare billow whoosh + gentle D-major crystalline shimmer */
  playSmokePlume(panVal = 0) {
    if (!this.enabled || !this.ctx || !this.sfxBus || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.9, Math.min(0.9, panVal));
    pan.connect(this.sfxBus);
    if (this.reverbSend) pan.connect(this.reverbSend);

    // Silky filtered air-whoosh of a colored smoke canister billowing
    if (this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(520 + Math.random() * 260, now);
      bp.frequency.exponentialRampToValueAtTime(1450 + Math.random() * 450, now + 0.24);
      bp.frequency.exponentialRampToValueAtTime(340, now + 0.78);
      bp.Q.value = 1.1;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, now);
      ng.gain.linearRampToValueAtTime(0.052, now + 0.1);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
      src.connect(bp);
      bp.connect(ng);
      ng.connect(pan);
      src.start(now, Math.random() * 1.4, 0.9);
    }

    // Delicate airy D-major harmonic shimmer
    const notes = [587.33, 659.25, 739.99, 880.0, 1174.66];
    const f = notes[Math.floor(Math.random() * notes.length)];
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, now + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now + 0.04);
    g.gain.linearRampToValueAtTime(0.016, now + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
    o.connect(g);
    g.connect(pan);
    o.start(now + 0.04);
    o.stop(now + 1.2);
  }
}

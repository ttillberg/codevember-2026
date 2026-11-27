/**
 * Minimal generative beatless ambient synthesizer for `26 Anamorph`.
 *
 * Sparse, gallery-quiet, subtly sun-warped paper world (zero drums, zero melody, zero dense walls):
 *  1. Minimal Core Dyad: just 2 pure warm sine/flute voices per fold (`Aadd9 -> Dmaj -> F#m -> E ...`)
 *     cleanly crossfading and breathing softly in sync with the paper crease.
 *  2. Delicate Single-Tone Stacked Layers (up to 3 sparse tones lingering, oldest dissolves gently):
 *     each fold floats ONE single softly drifting harmonic tone (`pure-sine`, `glass-air`,
 *     `soft-formant`, `warm-fifth`) in open `A / E / B` fifths/octaves across stereo.
 *  3. Gentle Subtle Tape Wonk: slow asynchronous tape-wow pitch drift (no jitter, no heavy chorus),
 *     airy room reverb, and calm background volume that leaves plenty of space.
 */

export type LayerRole = 'pure-sine' | 'glass-air' | 'soft-formant' | 'warm-fifth';

export interface AmbientVoicing {
  name: string;
  /** Sparse 2-note warm open interval Hz (110-370 Hz, airy and minimal) */
  padHz: readonly [number, number];
  /** Single delicate consonant harmonic tone Hz layered on this fold (A / E / B fifths & octaves) */
  toneHz: number;
  /** Gentle stereo placement for this fold's lingering tone */
  pan: number;
  /** Minimal single-voice timbre layered on this step */
  role: LayerRole;
}

/**
 * 8-step sparse, luminous progression in A major (open dyads + single floating harmonics).
 * Every consecutive fold shifts root & timbre cleanly without ever stacking into a dense wall.
 */
export const AMBIENT_CHORD_VOICINGS: readonly AmbientVoicing[] = [
  {
    name: 'A',
    padHz: [110.0, 277.18], // A2 + C#4 (open tenth)
    toneHz: 329.63, // E4
    pan: -0.28,
    role: 'pure-sine',
  },
  {
    name: 'Dmaj7',
    padHz: [146.83, 369.99], // D3 + F#4 (open tenth)
    toneHz: 659.25, // E5
    pan: 0.32,
    role: 'glass-air',
  },
  {
    name: 'F#m7',
    padHz: [185.0, 329.63], // F#3 + E4 (open minor 7th)
    toneHz: 440.0, // A4
    pan: -0.26,
    role: 'soft-formant',
  },
  {
    name: 'Esus4',
    padHz: [164.81, 246.94], // E3 + B3 (open fifth)
    toneHz: 493.88, // B4
    pan: 0.24,
    role: 'warm-fifth',
  },
  {
    name: 'Bm7',
    padHz: [123.47, 293.66], // B2 + D4 (open minor tenth)
    toneHz: 220.0, // A3
    pan: -0.30,
    role: 'pure-sine',
  },
  {
    name: 'Dmaj9',
    padHz: [146.83, 277.18], // D3 + C#4 (luminous major 7th)
    toneHz: 880.0, // A5
    pan: 0.34,
    role: 'glass-air',
  },
  {
    name: 'A/C#',
    padHz: [138.59, 329.63], // C#3 + E4 (warm minor tenth)
    toneHz: 440.0, // A4
    pan: -0.22,
    role: 'soft-formant',
  },
  {
    name: 'Esus2',
    padHz: [164.81, 369.99], // E3 + F#4 (wide open ninth resolving home)
    toneHz: 493.88, // B4
    pan: 0.26,
    role: 'warm-fifth',
  },
];

export const MAX_ACTIVE_LAYERS = 3;
export const LAYER_FADE_OUT_SEC = 5.2;
export const LAYER_IDLE_AGE_SEC = 14.0;

export interface SoundtrackState {
  enabled: boolean;
  activeLayers: number;
  fadingLayers: number;
  totalSpawned: number;
  currentChord: string;
  currentRole: LayerRole;
}

export interface SoundtrackController {
  setEnabled(enabled: boolean): Promise<boolean>;
  resumeIfNeeded(): void;
  triggerFoldLayer(generation: number, isReverse?: boolean, foldDurationSec?: number): void;
  update(nowSec?: number): void;
  getState(): SoundtrackState;
  dispose(): void;
}

export function selectVoicingForStep(stepIndex: number): AmbientVoicing {
  const len = AMBIENT_CHORD_VOICINGS.length;
  const idx = ((Math.floor(stepIndex) % len) + len) % len;
  return AMBIENT_CHORD_VOICINGS[idx];
}

/**
 * Returns indices of lingering single-tone layers that should gently fade out because
 * either the active cap was exceeded or older tones have lingered past `idleAgeSec`.
 */
export function selectLayersToFadeOut(
  spawnTimesSec: readonly number[],
  nowSec: number,
  maxActive = MAX_ACTIVE_LAYERS,
  idleAgeSec = LAYER_IDLE_AGE_SEC,
): number[] {
  const toFade: number[] = [];
  const count = spawnTimesSec.length;
  if (count <= 1) return toFade;

  const overflow = Math.max(0, count - maxActive);
  for (let i = 0; i < overflow; i++) {
    toFade.push(i);
  }
  for (let i = overflow; i < count - 1; i++) {
    if (nowSec - spawnTimesSec[i] >= idleAgeSec) {
      toFade.push(i);
    }
  }
  return toFade;
}

interface SynthVoiceGroup {
  id: number;
  chordName: string;
  role: LayerRole | 'pad-bed';
  spawnTimeSec: number;
  fading: boolean;
  gain: GainNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  oscillators: OscillatorNode[];
  lfos: OscillatorNode[];
  extraNodes: AudioNode[];
  cleanupTimerId: number | null;
}

function holdParamAtTime(param: AudioParam, now: number, fallbackValue: number) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now);
  } else {
    param.cancelScheduledValues(now);
    param.setValueAtTime(fallbackValue, now);
  }
}

function createSoftFluteWave(ctx: BaseAudioContext): PeriodicWave {
  // Whisper-pure fundamental + gentle 2nd & 3rd overtone (airy woodwind / warm sine organ)
  const imag = new Float32Array([0, 1.0, 0.22, 0.08, 0.025, 0.008]);
  const real = new Float32Array(imag.length);
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

function createAiryReverbIR(ctx: BaseAudioContext, durationSec = 3.6): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * durationSec);
  const ir = ctx.createBuffer(2, len, sr);
  let seed = 90317;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    let lp2 = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const attack = Math.min(1, t / 0.06);
      const decay = Math.exp(-t * 1.15);
      const damp = Math.max(0.05, 0.25 * Math.exp(-t * 0.55));
      lp += (rand() - lp) * damp;
      lp2 += (lp - lp2) * (damp * 0.85);
      data[i] = lp2 * attack * decay * 1.25;
    }
  }
  return ir;
}

function createSoftTapeAirBuffer(ctx: BaseAudioContext, seconds = 4.0): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  let seed = 42019;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  for (let ch = 0; ch < 2; ch++) {
    const out = buf.getChannelData(ch);
    let b0 = 0, b1 = 0;
    for (let i = 0; i < len; i++) {
      const w = rand();
      b0 = 0.996 * b0 + w * 0.025;
      b1 = 0.975 * b1 + w * 0.030;
      out[i] = (b0 + b1) * 0.10;
    }
  }
  return buf;
}

export interface FoldSynthOptions {
  /** Optional external AudioContext / OfflineAudioContext (used for offline audio audition & tests) */
  audioContext?: BaseAudioContext;
}

export function createFoldAmbientSynth(opts: FoldSynthOptions = {}): SoundtrackController {
  let ctx: BaseAudioContext | null = opts.audioContext ?? null;
  let ownsContext = !opts.audioContext;
  let masterGain: GainNode | null = null;
  let layerBus: GainNode | null = null;
  let softWave: PeriodicWave | null = null;
  let tapeAirSource: AudioBufferSourceNode | null = null;
  let persistentLfos: OscillatorNode[] = [];
  let graphBuilt = false;

  let enabled = false;
  let layerStep = 0;
  let totalSpawned = 0;
  let lastTriggerMs = -9999;
  let currentChord = AMBIENT_CHORD_VOICINGS[0].name;
  let currentRole: LayerRole = AMBIENT_CHORD_VOICINGS[0].role;

  // Single minimal 2-note core dyad (clean crossfade on every fold)
  let currentPadBed: SynthVoiceGroup | null = null;
  // Up to 3 sparse single-tone floating harmonics lingering and dissolving gently
  let activeLayers: SynthVoiceGroup[] = [];
  let fadingLayers: SynthVoiceGroup[] = [];

  const ensureGraph = (): BaseAudioContext | null => {
    if (graphBuilt && ctx) return ctx;
    if (!ctx) {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
      ownsContext = true;
    }

    softWave = createSoftFluteWave(ctx);

    layerBus = ctx.createGain();
    layerBus.gain.value = 0.72;

    const subClean = ctx.createBiquadFilter();
    subClean.type = 'highpass';
    subClean.frequency.value = 75;
    subClean.Q.value = 0.5;

    // Gentle, calm stereo tape-wow pitch drift (subtly wonky without dense chorus or jitter)
    const warpSplit = ctx.createChannelSplitter(2);
    const warpMerge = ctx.createChannelMerger(2);
    const delayL = ctx.createDelay(0.08);
    const delayR = ctx.createDelay(0.08);
    delayL.delayTime.value = 0.016;
    delayR.delayTime.value = 0.019;

    const wowL = ctx.createOscillator();
    const wowR = ctx.createOscillator();
    wowL.type = 'sine';
    wowR.type = 'sine';
    wowL.frequency.value = 0.17;
    wowR.frequency.value = 0.135;
    const wowDepthL = ctx.createGain();
    const wowDepthR = ctx.createGain();
    wowDepthL.gain.value = 0.0030;
    wowDepthR.gain.value = 0.0028;
    wowL.connect(wowDepthL);
    wowDepthL.connect(delayL.delayTime);
    wowR.connect(wowDepthR);
    wowDepthR.connect(delayR.delayTime);

    const masterTone = ctx.createBiquadFilter();
    masterTone.type = 'lowpass';
    masterTone.frequency.value = 2200;
    masterTone.Q.value = 0.5;

    masterGain = ctx.createGain();
    masterGain.gain.value = 0;

    layerBus.connect(subClean);
    subClean.connect(warpSplit);
    warpSplit.connect(delayL, 0);
    warpSplit.connect(delayR, 1);
    delayL.connect(warpMerge, 0, 0);
    delayR.connect(warpMerge, 0, 1);
    warpMerge.connect(masterTone);

    // Clean, airy balance: 62% dry + 44% spacious room reverb
    const dryGain = ctx.createGain();
    dryGain.gain.value = 0.62;
    masterTone.connect(dryGain);
    dryGain.connect(masterGain);

    const convolver = ctx.createConvolver();
    convolver.buffer = createAiryReverbIR(ctx, 3.6);
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.44;
    masterTone.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(masterGain);

    // Barely perceptible soft room/paper air
    const airSrc = ctx.createBufferSource();
    airSrc.buffer = createSoftTapeAirBuffer(ctx, 4.0);
    airSrc.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = 900;
    airFilter.Q.value = 0.5;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.0016;
    airSrc.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(masterGain);
    airSrc.start();
    tapeAirSource = airSrc;

    persistentLfos = [wowL, wowR];
    for (const lfo of persistentLfos) lfo.start();

    masterGain.connect(ctx.destination);
    graphBuilt = true;
    return ctx;
  };

  const destroyVoiceGroup = (group: SynthVoiceGroup) => {
    if (group.cleanupTimerId !== null) {
      window.clearTimeout(group.cleanupTimerId);
      group.cleanupTimerId = null;
    }
    for (const osc of group.oscillators) {
      try {
        osc.stop();
      } catch {
        // Ignore already-stopped
      }
      osc.disconnect();
    }
    for (const lfo of group.lfos) {
      try {
        lfo.stop();
      } catch {
        // Ignore already-stopped
      }
      lfo.disconnect();
    }
    for (const n of group.extraNodes) n.disconnect();
    group.filter.disconnect();
    group.gain.disconnect();
    group.panner.disconnect();
  };

  const beginFadeOutGroup = (group: SynthVoiceGroup, fadeSec: number, atTimeSec?: number) => {
    if (group.fading || !ctx) return;
    group.fading = true;
    if (currentPadBed?.id === group.id) currentPadBed = null;
    activeLayers = activeLayers.filter((l) => l.id !== group.id);
    fadingLayers.push(group);

    const now = atTimeSec ?? ctx.currentTime;
    holdParamAtTime(group.gain.gain, now, Math.max(0.0001, group.gain.gain.value || 0.12));
    group.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSec);
    group.gain.gain.linearRampToValueAtTime(0, now + fadeSec + 0.12);

    holdParamAtTime(group.filter.frequency, now, Math.max(180, group.filter.frequency.value || 700));
    group.filter.frequency.exponentialRampToValueAtTime(220, now + fadeSec);

    if (ownsContext) {
      group.cleanupTimerId = window.setTimeout(() => {
        group.cleanupTimerId = null;
        fadingLayers = fadingLayers.filter((l) => l.id !== group.id);
        destroyVoiceGroup(group);
      }, Math.round((fadeSec + 0.3) * 1000));
    } else {
      for (const osc of group.oscillators) osc.stop(now + fadeSec + 0.2);
      for (const lfo of group.lfos) lfo.stop(now + fadeSec + 0.2);
    }
  };

  /**
   * Minimal 2-voice warm open dyad that breathes gently open in sync with each fold.
   */
  const transitionPadBed = (voicing: AmbientVoicing, isReverse: boolean, foldDurationSec: number, now: number) => {
    if (!ctx || !layerBus || !softWave) return;
    const clampedDur = Math.max(0.9, Math.min(8.0, foldDurationSec));
    const crossfadeSec = Math.max(1.2, Math.min(2.8, clampedDur * 0.72));

    if (currentPadBed) {
      beginFadeOutGroup(currentPadBed, crossfadeSec, now);
    }

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.75;
    if (isReverse) {
      filter.frequency.setValueAtTime(1180, now);
      filter.frequency.exponentialRampToValueAtTime(520, now + clampedDur * 0.92);
    } else {
      filter.frequency.setValueAtTime(260, now);
      filter.frequency.exponentialRampToValueAtTime(1180, now + clampedDur * 0.65);
      filter.frequency.exponentialRampToValueAtTime(640, now + clampedDur * 1.45);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.24, now + clampedDur * 0.62);
    gain.gain.linearRampToValueAtTime(0.16, now + clampedDur * 1.50);

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(0, now);

    filter.connect(gain);
    gain.connect(panner);
    panner.connect(layerBus);

    const oscillators: OscillatorNode[] = [];
    const lfos: OscillatorNode[] = [];
    const extraNodes: AudioNode[] = [];

    // Just 2 pure minimal voices (1 oscillator each) with subtle tape-bend entry & slow organic drift
    const weights = [0.54, 0.44] as const;
    const micro = [-4.0, 4.5] as const;
    const entryBend = isReverse ? 14 : -15;

    voicing.padHz.forEach((freq, idx) => {
      if (!ctx || !softWave) return;
      const osc = ctx.createOscillator();
      if (idx === 0) {
        osc.setPeriodicWave(softWave);
      } else {
        osc.type = 'sine';
      }
      osc.frequency.setValueAtTime(freq, now);
      osc.detune.setValueAtTime(micro[idx] + entryBend, now);
      osc.detune.linearRampToValueAtTime(micro[idx], now + Math.min(0.55, clampedDur * 0.22));

      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(0.11 + idx * 0.045, now);
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(8.0 + idx * 2.5, now);
      lfo.connect(lg);
      lg.connect(osc.detune);

      const vg = ctx.createGain();
      vg.gain.setValueAtTime(weights[idx], now);
      osc.connect(vg);
      vg.connect(filter);
      osc.start(now);
      lfo.start(now);

      oscillators.push(osc);
      lfos.push(lfo);
      extraNodes.push(lg, vg);
    });

    currentPadBed = {
      id: -totalSpawned - 1,
      chordName: voicing.name,
      role: 'pad-bed',
      spawnTimeSec: now,
      fading: false,
      gain,
      filter,
      panner,
      oscillators,
      lfos,
      extraNodes,
      cleanupTimerId: null,
    };
  };

  /**
   * Spawn ONE single delicate floating harmonic tone (pure sine / glass air / soft formant / muted fifth)
   * so up to 3 minimal notes linger in open space and gracefully dissolve out oldest-first.
   */
  const spawnTexturalLayer = (
    voicing: AmbientVoicing,
    isReverse: boolean,
    foldDurationSec: number,
    now: number,
  ) => {
    if (!ctx || !layerBus || !softWave) return;
    const clampedDur = Math.max(0.9, Math.min(8.0, foldDurationSec));
    const dissolveSec = Math.max(2.4, Math.min(7.5, clampedDur * 1.7));

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(voicing.pan, now);

    filter.connect(gain);
    gain.connect(panner);
    panner.connect(layerBus);

    const oscillators: OscillatorNode[] = [];
    const lfos: OscillatorNode[] = [];
    const extraNodes: AudioNode[] = [];

    const role = voicing.role;
    const freq = voicing.toneHz;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(freq, now);

    // Subtle organic tape pitch drift on the single floating tone
    const driftLfo = ctx.createOscillator();
    driftLfo.type = 'sine';
    driftLfo.frequency.setValueAtTime(0.16 + (totalSpawned % 4) * 0.035, now);
    const driftGain = ctx.createGain();
    driftGain.gain.setValueAtTime(role === 'glass-air' ? 12.0 : 9.5, now);
    driftLfo.connect(driftGain);
    driftGain.connect(osc.detune);
    extraNodes.push(driftGain);
    lfos.push(driftLfo);

    if (role === 'pure-sine') {
      osc.type = 'sine';
      osc.detune.setValueAtTime(isReverse ? 10 : -11, now);
      osc.detune.linearRampToValueAtTime(0, now + 0.5);
      filter.frequency.setValueAtTime(1400, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.085, now + clampedDur * 0.7);
      gain.gain.linearRampToValueAtTime(0.055, now + clampedDur * 1.6);
      osc.connect(filter);
    } else if (role === 'glass-air') {
      osc.type = 'sine';
      filter.frequency.setValueAtTime(1750, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.048, now + clampedDur * 0.8);
      gain.gain.linearRampToValueAtTime(0.032, now + clampedDur * 1.7);
      osc.connect(filter);
    } else if (role === 'soft-formant') {
      osc.setPeriodicWave(softWave);
      filter.frequency.setValueAtTime(1600, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.095, now + clampedDur * 0.75);
      gain.gain.linearRampToValueAtTime(0.065, now + clampedDur * 1.65);

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(680, now);
      bp.Q.value = 2.0;
      const bpLfo = ctx.createOscillator();
      bpLfo.type = 'sine';
      bpLfo.frequency.setValueAtTime(0.14, now);
      const bpDepth = ctx.createGain();
      bpDepth.gain.setValueAtTime(95, now);
      bpLfo.connect(bpDepth);
      bpDepth.connect(bp.frequency);
      bpLfo.start(now);

      osc.connect(bp);
      bp.connect(filter);
      lfos.push(bpLfo);
      extraNodes.push(bp, bpDepth);
    } else {
      // 'warm-fifth': single delicate triangle tone with gentle lowpass bloom
      osc.type = 'triangle';
      osc.detune.setValueAtTime(isReverse ? 12 : -12, now);
      osc.detune.linearRampToValueAtTime(0, now + 0.55);
      filter.frequency.setValueAtTime(isReverse ? 1100 : 380, now);
      filter.frequency.exponentialRampToValueAtTime(isReverse ? 540 : 1080, now + clampedDur * 0.85);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.062, now + clampedDur * 0.75);
      gain.gain.linearRampToValueAtTime(0.042, now + clampedDur * 1.65);
      osc.connect(filter);
    }

    osc.start(now);
    driftLfo.start(now);
    oscillators.push(osc);

    totalSpawned += 1;
    currentChord = voicing.name;
    currentRole = role;
    const layer: SynthVoiceGroup = {
      id: totalSpawned,
      chordName: voicing.name,
      role,
      spawnTimeSec: now,
      fading: false,
      gain,
      filter,
      panner,
      oscillators,
      lfos,
      extraNodes,
      cleanupTimerId: null,
    };
    activeLayers.push(layer);

    const fadeIndices = selectLayersToFadeOut(
      activeLayers.map((l) => l.spawnTimeSec),
      now,
      MAX_ACTIVE_LAYERS,
      LAYER_IDLE_AGE_SEC,
    );
    const toFade = fadeIndices.map((i) => activeLayers[i]).filter(Boolean);
    for (const old of toFade) {
      beginFadeOutGroup(old, dissolveSec, now);
    }
  };

  const setEnabled = async (next: boolean): Promise<boolean> => {
    enabled = Boolean(next);

    if (!enabled) {
      const isSuspended = Boolean(ctx && 'state' in ctx && ctx.state === 'suspended');
      if (ctx && masterGain) {
        const now = ctx.currentTime;
        holdParamAtTime(masterGain.gain, now, masterGain.gain.value);
        if (isSuspended) {
          masterGain.gain.setValueAtTime(0, now);
        } else {
          masterGain.gain.linearRampToValueAtTime(0, now + 0.45);
        }
      }
      if (isSuspended) {
        if (currentPadBed) {
          destroyVoiceGroup(currentPadBed);
          currentPadBed = null;
        }
        for (const l of [...activeLayers, ...fadingLayers]) {
          destroyVoiceGroup(l);
        }
        activeLayers = [];
        fadingLayers = [];
      } else {
        if (currentPadBed) beginFadeOutGroup(currentPadBed, 0.5);
        for (const l of [...activeLayers]) {
          beginFadeOutGroup(l, 0.5);
        }
      }
      return false;
    }

    const audioCtx = ensureGraph();
    if (!audioCtx || !masterGain) {
      enabled = false;
      return false;
    }
    if ('resume' in audioCtx && audioCtx.state === 'suspended') {
      // Do not block awaiting `resume()` — browsers may defer resolution until the first user gesture!
      void (audioCtx as AudioContext).resume().catch(() => {
        // Will resume on first user gesture via `resumeIfNeeded()`
      });
    }

    const now = audioCtx.currentTime;
    holdParamAtTime(masterGain.gain, now, Math.max(0.0001, masterGain.gain.value));
    masterGain.gain.linearRampToValueAtTime(0.82, now + 0.7);

    if (!currentPadBed && activeLayers.length === 0) {
      const v = selectVoicingForStep(layerStep);
      layerStep += 1;
      lastTriggerMs = performance.now();
      transitionPadBed(v, false, 3.0, now);
      spawnTexturalLayer(v, false, 3.0, now);
    }
    return true;
  };

  const resumeIfNeeded = () => {
    if (!enabled || !ctx) return;
    if ('resume' in ctx && ctx.state === 'suspended') {
      void (ctx as AudioContext).resume().catch(() => {
        // Ignore resume errors
      });
    }
  };

  const triggerFoldLayer = (generation: number, isReverse = false, foldDurationSec = 3.2) => {
    if (!enabled || !ctx) return;
    if (ownsContext) {
      const nowMs = performance.now();
      if (nowMs - lastTriggerMs < 250) return;
      lastTriggerMs = nowMs;
      if ('resume' in ctx && ctx.state === 'suspended') {
        void (ctx as AudioContext).resume();
      }
    }

    const now = ctx.currentTime;
    const voicing = selectVoicingForStep(layerStep > 0 ? layerStep : generation - 1);
    layerStep += 1;
    transitionPadBed(voicing, isReverse, foldDurationSec, now);
    spawnTexturalLayer(voicing, isReverse, foldDurationSec, now);
  };

  const update = (nowSecOverride?: number) => {
    if (!enabled || !ctx || activeLayers.length <= 1) return;
    const now = nowSecOverride ?? ctx.currentTime;
    const fadeIndices = selectLayersToFadeOut(
      activeLayers.map((l) => l.spawnTimeSec),
      now,
      MAX_ACTIVE_LAYERS,
      LAYER_IDLE_AGE_SEC,
    );
    if (fadeIndices.length === 0) return;
    const toFade = fadeIndices.map((i) => activeLayers[i]).filter(Boolean);
    for (const old of toFade) {
      beginFadeOutGroup(old, LAYER_FADE_OUT_SEC, now);
    }
  };

  const getState = (): SoundtrackState => ({
    enabled,
    activeLayers: activeLayers.length,
    fadingLayers: fadingLayers.length,
    totalSpawned,
    currentChord,
    currentRole,
  });

  const dispose = () => {
    enabled = false;
    if (currentPadBed) {
      destroyVoiceGroup(currentPadBed);
      currentPadBed = null;
    }
    for (const l of [...activeLayers, ...fadingLayers]) {
      destroyVoiceGroup(l);
    }
    activeLayers = [];
    fadingLayers = [];
    for (const node of [tapeAirSource, ...persistentLfos]) {
      if (node) {
        try {
          node.stop();
        } catch {
          // Ignore
        }
        node.disconnect();
      }
    }
    tapeAirSource = null;
    persistentLfos = [];
    if (ownsContext && ctx && 'close' in ctx) {
      void (ctx as AudioContext).close();
    }
    ctx = null;
    masterGain = null;
    layerBus = null;
    graphBuilt = false;
  };

  return { setEnabled, resumeIfNeeded, triggerFoldLayer, update, getState, dispose };
}

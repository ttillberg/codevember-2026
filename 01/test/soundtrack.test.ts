import { describe, expect, it } from 'vitest';
import {
  AMBIENT_CHORD_VOICINGS,
  LAYER_IDLE_AGE_SEC,
  MAX_ACTIVE_LAYERS,
  selectLayersToFadeOut,
  selectVoicingForStep,
} from '../src/soundtrack';

describe('minimal layered ambient fold synth', () => {
  it('cycles across sparse 2-note open dyads and distinct minimal single-tone roles', () => {
    expect(AMBIENT_CHORD_VOICINGS.length).toBe(8);
    const roles = new Set(AMBIENT_CHORD_VOICINGS.map((v) => v.role));
    expect(roles.size).toBe(4);
    for (let i = 0; i < 8; i++) {
      const cur = selectVoicingForStep(i);
      const next = selectVoicingForStep(i + 1);
      // Every consecutive fold shifts root AND minimal single-tone timbre
      expect(cur.padHz[0]).not.toBe(next.padHz[0]);
      expect(cur.role).not.toBe(next.role);
      expect(cur.padHz.length).toBe(2);
      expect(cur.toneHz).toBeGreaterThanOrEqual(220);
      expect(cur.padHz[0]).toBeGreaterThanOrEqual(110);
    }
  });

  it('transitions out oldest layers once exceeding MAX_ACTIVE_LAYERS or idle age, keeping newest breathing', () => {
    expect(selectLayersToFadeOut([0], 5)).toEqual([]);
    expect(selectLayersToFadeOut([0, 3, 6], 8)).toEqual([]);
    expect(selectLayersToFadeOut([0, 3, 6, 9], 9, MAX_ACTIVE_LAYERS, LAYER_IDLE_AGE_SEC)).toEqual([0]);
    expect(selectLayersToFadeOut([0, 3, 6, 9, 12], 12, MAX_ACTIVE_LAYERS, LAYER_IDLE_AGE_SEC)).toEqual([0, 1]);
    expect(selectLayersToFadeOut([0, 4, 25], 26, MAX_ACTIVE_LAYERS, LAYER_IDLE_AGE_SEC)).toEqual([0, 1]);
    expect(selectLayersToFadeOut([0, 4, 25], 100, MAX_ACTIVE_LAYERS, LAYER_IDLE_AGE_SEC)).toEqual([0, 1]);
  });
});

import { describe, it, expect } from 'vitest';
import { signature, upgrade, VERSION } from '../src/upgrade';
import { modelById } from '../src/models';

const saved = (model: string) => ({ model, done: [], folds: {}, rest: [], view: { zoom: 1, panX: 0, panY: 0, azimuth: 0 }, undos: [], redos: [] });

describe('the saved record', () => {
  it('starts empty from nothing, or from junk', () => {
    for (const raw of [null, undefined, 3, 'x', {}, []]) expect(upgrade(raw)).toEqual({ v: VERSION, at: null, town: [], cards: {} });
  });

  it('takes the board from before there was a record', () => {
    const town = [{ key: 'a', id: 'kiosk', x: 10, z: 20, turn: 1 }, { key: 'b', id: 'gone', x: 0, z: 0, turn: 0 }];
    const s = upgrade({ v: 0, town });
    expect(s.v).toBe(VERSION);
    expect(s.town).toEqual([town[0]]);
    expect(s.at).toBe('board');
  });

  it('keeps a sheet whose net is the same, drops one whose net changed', () => {
    const sig = signature(modelById('kiosk')!.net);
    const s = upgrade({ v: VERSION, at: 'kiosk', town: [], cards: {
      kiosk: { sig, card: saved('kiosk') },
      gertrud: { sig: 'old', card: saved('gertrud') },
      gone: { sig: 'x', card: saved('gone') },
    } });
    expect(Object.keys(s.cards)).toEqual(['kiosk']);
    expect(s.at).toBe('kiosk');
  });

  it('starts over on a record from a newer build', () => {
    expect(upgrade({ v: VERSION + 1, at: 'board', town: [{ key: 'a', id: 'kiosk', x: 0, z: 0, turn: 0 }], cards: {} }).town).toEqual([]);
  });
});

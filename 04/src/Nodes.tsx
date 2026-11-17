// D, or Network in ?debug: the network drawn over the picture: every road as a line and every node as a dot, with what the rules know of them.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import { cumLen, deck, type Net, type Node, type Road } from './net';

const INK = '#f4f4f2';
/** What a node is, as a colour: a signal, a dead end, a way out of the place, up on a bridge, or none of these. */
const tint = (n: Node) => (n.signal ? '#ffb020' : n.stub ? '#9aa0a6' : n.edge ? '#4aa8ff' : n.z > 0.5 ? '#ff5ad1' : INK);

/** Two lines for a node: its number and its arms by size, then its trim and whatever else is true of it. */
function words(n: Node): [string, string] {
  const arms = n.roads.map((r) => (r.bridge ? 'b' : r.ring ? 'o' : r.one ? '>' : '') + r.rank).join(' ');
  const flags = [n.signal && 'sig+' + n.sigOff.toFixed(0), n.stub && 'stub', n.edge && 'edge', n.z > 0.5 && 'z' + n.z.toFixed(1)].filter(Boolean).join(' ');
  return ['#' + n.id + '  ' + n.roads.length + ': ' + arms, 'trim ' + n.trim.toFixed(1) + (flags ? '  ' + flags : '')];
}

/** A road by its size: the bigger, the warmer. A bridge is pink, a roundabout green. */
const RANKS = ['#8fd3ff', '#bfe3a8', '#ffe27a', '#ff9a5a'];
const hue = (r: Road) => (r.bridge ? '#ff5ad1' : r.ring ? '#6fe0a0' : RANKS[r.rank] ?? INK);
/** One line for a road: its number, size, lanes each way and length, and whether it is one way or feeds a lot. */
const road = (r: Road) => 'r' + r.id + ' k' + r.rank + ' ' + r.lanes + 'l ' + r.len.toFixed(0) + 'm' + (r.ring || r.one ? ' >' : '') + (r.feeds ? ' feeds' : '');

export function Nodes({ net }: { net: Net }) {
  const sheet = useMemo(() => {
    const c = document.createElement('canvas');
    c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';
    return c;
  }, []);
  useEffect(() => { document.body.appendChild(sheet); return () => sheet.remove(); }, [sheet]);
  const told = useMemo(() => net.nodes.map((n) => ({ n, text: words(n), tint: tint(n) })), [net]);
  const v = useRef(new Vector3()).current;
  // each road as its centreline in the air where it is a bridge, and where its middle is
  const lines = useMemo(() => net.roads.map((r) => {
    const cum = cumLen(r.pts);
    const pts = r.pts.map((p, i) => new Vector3(p.x, deck(r, cum[i]) + 0.5, p.y));
    return { pts, mid: pts[pts.length >> 1], text: road(r), hue: hue(r), wide: 1 + r.lanes * 0.6 };
  }), [net]);

  useFrame(({ camera }) => {
    const k = Math.min(2, devicePixelRatio), w = innerWidth, h = innerHeight;
    if (sheet.width !== w * k || sheet.height !== h * k) { sheet.width = w * k; sheet.height = h * k; }
    const g = sheet.getContext('2d')!;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = '10px ui-monospace, Menlo, monospace';
    g.textBaseline = 'top';
    // a label only where there is room for it: the squares of the screen that already hold one
    const taken = new Set<number>();
    const at = (p: Vector3) => { v.copy(p).project(camera); return v.z > 1 ? null : { x: (v.x * 0.5 + 0.5) * w, y: (0.5 - v.y * 0.5) * h }; };
    const inside = (q: { x: number; y: number }) => q.x > -40 && q.x < w + 40 && q.y > -40 && q.y < h + 40;
    const room = (x: number, y: number) => { const cell = Math.floor(x / 120) * 4096 + Math.floor(y / 30); if (taken.has(cell)) return false; taken.add(cell); return true; };
    g.lineJoin = 'round';
    for (const l of lines) {
      g.beginPath();
      let seen = false;
      for (let i = 0; i < l.pts.length; i++) { const q = at(l.pts[i]); if (!q) continue; seen ||= inside(q); if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }
      if (!seen) continue;
      g.strokeStyle = l.hue; g.globalAlpha = 0.85; g.lineWidth = l.wide; g.stroke(); g.globalAlpha = 1;
    }
    for (const t of told) {
      v.set(t.n.p.x, t.n.z, t.n.p.y).project(camera);
      if (v.z > 1 || v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) continue;
      const x = (v.x * 0.5 + 0.5) * w, y = (0.5 - v.y * 0.5) * h;
      g.fillStyle = t.tint;
      g.strokeStyle = 'rgba(20, 22, 18, 0.9)';
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, 3.5, 0, 6.3); g.fill(); g.stroke();
      if (!room(x, y)) continue;
      const wide = Math.max(g.measureText(t.text[0]).width, g.measureText(t.text[1]).width);
      g.fillStyle = 'rgba(20, 22, 18, 0.72)';
      g.fillRect(x + 7, y - 13, wide + 8, 27);
      g.fillStyle = t.tint;
      g.fillText(t.text[0], x + 11, y - 10);
      g.fillStyle = INK;
      g.fillText(t.text[1], x + 11, y + 2);
    }
    // the roads are named last, where the nodes left room
    for (const l of lines) {
      const q = at(l.mid);
      if (!q || !inside(q) || !room(q.x, q.y)) continue;
      g.fillStyle = 'rgba(20, 22, 18, 0.6)';
      g.fillRect(q.x - 2, q.y - 7, g.measureText(l.text).width + 6, 14);
      g.fillStyle = l.hue;
      g.fillText(l.text, q.x + 1, q.y - 5);
    }
  });
  return null;
}

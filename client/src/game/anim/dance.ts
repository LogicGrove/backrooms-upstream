import { Node, extra, lerpPose, sampleClip, type Ctx, type Pose } from './core';

/*
 * Bailes de victoria montados con trozos: una secuencia de segmentos (clip, tramo, velocidad, repeticiones),
 * cada uno entrando con un cruce sobre el final del anterior. Son datos (anim/dances.json) que edita la
 * herramienta (?anim → DANCES). Todo es una función del tiempo, así que se puede avanzar o rebobinar.
 */

export interface Seg {
  clip: string;
  /** Tramo del clip que se usa (segundos; out 0 = hasta el final). */
  in: number;
  out: number;
  rate: number;
  /** Cuántas veces se repite el tramo. */
  loops: number;
  /** Solape con el segmento anterior (s). */
  fade: number;
}
export interface DanceDef {
  id: string;
  name: string;
  segs: Seg[];
  /** Al acabar, vuelve a empezar. */
  loop?: boolean;
}

export const DANCES: Record<string, DanceDef> = {};

const span = (s: Seg, c?: Ctx) => {
  const d = c?.pack.clips.get(s.clip)?.dur ?? 0, a = Math.min(s.in, d), b = s.out > 0 ? Math.min(s.out, d) : d;
  return { a, b, len: Math.max(0.05, (b - a) / Math.max(0.1, s.rate)) * Math.max(1, s.loops) };
};

/** Cuándo empieza cada segmento y cuánto dura el baile entero. */
export function timeline(d: DanceDef, c: Ctx) {
  const starts: number[] = [], lens: number[] = [];
  let t = 0;
  d.segs.forEach((s, i) => {
    const l = span(s, c).len;
    starts.push(i ? Math.max(0, t - s.fade) : 0);
    lens.push(l);
    t = starts[i] + l;
  });
  return { starts, lens, total: t };
}

export class SequenceNode extends Node {
  t = 0;
  /** La herramienta lo congela para mirar un instante. */
  frozen = false;
  constructor(private d: DanceDef) {
    super();
  }
  reset() {
    super.reset();
    this.t = 0;
  }
  dur(c: Ctx) {
    return timeline(this.d, c).total || 1;
  }
  update(dt: number, c: Ctx) {
    if (this.frozen) return;
    this.t += dt;
    const total = timeline(this.d, c).total;
    if (this.d.loop && total > 0) this.t %= total;
    else if (this.t >= total) (this.t = total), (this.ended = true);
  }
  /** Para la herramienta: ir a un instante. */
  seek(t: number) {
    this.t = Math.max(0, t);
    this.ended = false;
  }
  eval(out: Pose, c: Ctx) {
    const { starts, lens } = timeline(this.d, c), T = this.t;
    let first = true;
    this.d.segs.forEach((s, i) => {
      const local = T - starts[i];
      if (local < 0 || (local > lens[i] && i < this.d.segs.length - 1)) return; // (aún no empieza, o ya acabó y el siguiente la sustituye)
      const k = c.pack.clips.get(s.clip);
      if (!k) return;
      const { a, b } = span(s, c), p = c.tmp();
      const len = Math.max(0.01, b - a), x = Math.min(local, lens[i]) * Math.max(0.1, s.rate);
      sampleClip(k, a + (s.loops > 1 ? x % len : Math.min(x, len)), false, p, c.pack.fps);
      if (first) (out.copy(p), (first = false));
      else {
        const base = c.tmp(), w = Math.min(1, s.fade > 0 ? local / s.fade : 1);
        base.copy(out);
        lerpPose(out, base, p, w * w * (3 - 2 * w));
        c.free(base);
      }
      c.free(p);
    });
    if (first) out.clear();
  }
}

extra.dance = (id) => new SequenceNode(DANCES[id] ?? { id, name: id, segs: [] });

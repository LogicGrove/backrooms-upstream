import * as THREE from 'three';

/*
 * Núcleo del sistema de animación: paquete de clips (tools/anim_pack.mjs), poses, y los nodos del árbol
 * (clip, blendspace 1D y 2D, máquina de estados, capas con máscara, secuencias de baile). Todo es una
 * función de parámetros y tiempo: el árbol se describe en datos (anim/tree.json) y el Animator
 * (animator.ts) lo evalúa cada fotograma y pone el resultado en los huesos.
 */

// ── paquete de clips ──────────────────────────────────────────────────────

export interface Clip {
  name: string;
  dur: number;
  n: number;
  /** Índices (en Pack.bones) de los huesos que anima; q va de hueso en hueso, n fotogramas de 4 int16 cada uno. */
  bones: number[];
  q: Int16Array;
  hips?: Float32Array;
  /** Cuánto avanzaba la cadera en el FBX original (unidades/s). */
  speed: number;
}
export interface Pack {
  fps: number;
  hipsBindY: number;
  bones: string[];
  clips: Map<string, Clip>;
}

let packP: Promise<Pack> | undefined;
let packV: Pack | undefined;
/** El paquete, si ya se bajó (para quien no puede esperar). */
export const packNow = () => packV;
/** Baja (una vez) el paquete de animaciones del jugador. */
async function fetchPack(bust = ''): Promise<Pack> {
  {
    const [j, b] = await Promise.all([fetch('/animations/player.pack.json' + bust).then((r) => r.json()), fetch('/animations/player.pack.bin' + bust).then((r) => r.arrayBuffer())]);
    const clips = new Map<string, Clip>();
    for (const [name, c] of Object.entries<{ dur: number; n: number; bones: number[]; q: number; hips: number; speed: number }>(j.clips))
      clips.set(name, { name, dur: c.dur, n: c.n, bones: c.bones, q: new Int16Array(b, c.q, c.bones.length * c.n * 4), hips: c.hips >= 0 ? new Float32Array(b, c.hips, c.n * 3) : undefined, speed: c.speed });
    return { fps: j.fps, hipsBindY: j.hipsBindY, bones: j.bones, clips };
  }
}
export function loadPack(): Promise<Pack> {
  return (packP ??= fetchPack().then((p) => (packV = p)));
}
/**
 * Vuelve a bajar el paquete (se añadieron o cambiaron clips) y lo actualiza EN EL SITIO: el Animator y todo lo demás guardan la misma referencia.
 * Devuelve false si cambió el esqueleto (huesos nuevos): entonces hace falta recargar.
 */
export async function reloadPack(): Promise<boolean> {
  const fresh = await fetchPack('?v=' + Date.now());
  if (!packV) return (packP = Promise.resolve((packV = fresh))), true;
  if (fresh.bones.length !== packV.bones.length || fresh.bones.some((n, i) => n !== packV!.bones[i])) return false;
  packV.hipsBindY = fresh.hipsBindY;
  packV.clips.clear();
  fresh.clips.forEach((c, n) => packV!.clips.set(n, c));
  return true;
}

// ── poses ─────────────────────────────────────────────────────────────────

/** Una pose: un cuaternión por hueso (los que no tienen dato, `has` = 0, se quedan como estén) y la altura de la cadera. */
export class Pose {
  readonly q: Float32Array;
  readonly has: Uint8Array;
  hy = 0;
  constructor(readonly nb: number) {
    this.q = new Float32Array(nb * 4);
    this.has = new Uint8Array(nb);
  }
  clear() {
    this.has.fill(0);
  }
  copy(o: Pose) {
    this.q.set(o.q);
    this.has.set(o.has);
    this.hy = o.hy;
  }
}

const S = 1 / 32767;
/** Pone en `out` el clip en el instante `t` (segundos; con `loop` da la vuelta). */
export function sampleClip(c: Clip, t: number, loop: boolean, out: Pose, fps: number) {
  const tt = loop ? ((t % c.dur) + c.dur) % c.dur : Math.min(Math.max(t, 0), c.dur);
  const f = Math.min(tt * fps, c.n - 1), i0 = Math.floor(f), i1 = Math.min(c.n - 1, i0 + 1), k = f - i0;
  out.clear();
  for (let j = 0; j < c.bones.length; j++) {
    const b = c.bones[j], a = (j * c.n + i0) * 4, d = (j * c.n + i1) * 4;
    let x = c.q[a] * S, y = c.q[a + 1] * S, z = c.q[a + 2] * S, w = c.q[a + 3] * S;
    x += (c.q[d] * S - x) * k, y += (c.q[d + 1] * S - y) * k, z += (c.q[d + 2] * S - z) * k, w += (c.q[d + 3] * S - w) * k;
    const l = 1 / (Math.hypot(x, y, z, w) || 1);
    out.q[b * 4] = x * l, out.q[b * 4 + 1] = y * l, out.q[b * 4 + 2] = z * l, out.q[b * 4 + 3] = w * l;
    out.has[b] = 1;
  }
  out.hy = c.hips ? c.hips[i0 * 3 + 1] + (c.hips[i1 * 3 + 1] - c.hips[i0 * 3 + 1]) * k : 0;
}

/** out = a → b con peso `w` (0 = a); los huesos que solo tiene una de las dos pasan tal cual. `mask` (peso por hueso) limita a qué huesos afecta. */
export function lerpPose(out: Pose, a: Pose, b: Pose, w: number, mask?: Float32Array) {
  for (let i = 0; i < out.nb; i++) {
    const ha = a.has[i], hb = b.has[i], o = i * 4, wi = mask ? w * mask[i] : w;
    if (ha && hb) {
      const dot = a.q[o] * b.q[o] + a.q[o + 1] * b.q[o + 1] + a.q[o + 2] * b.q[o + 2] + a.q[o + 3] * b.q[o + 3], s = dot < 0 ? -1 : 1;
      let x = a.q[o] + (b.q[o] * s - a.q[o]) * wi, y = a.q[o + 1] + (b.q[o + 1] * s - a.q[o + 1]) * wi, z = a.q[o + 2] + (b.q[o + 2] * s - a.q[o + 2]) * wi, v = a.q[o + 3] + (b.q[o + 3] * s - a.q[o + 3]) * wi;
      const l = 1 / (Math.hypot(x, y, z, v) || 1);
      (x *= l), (y *= l), (z *= l), (v *= l);
      out.q[o] = x, out.q[o + 1] = y, out.q[o + 2] = z, out.q[o + 3] = v;
      out.has[i] = 1;
    } else if (ha || (hb && wi > 0.5)) {
      const s = ha ? a : b;
      out.q[o] = s.q[o], out.q[o + 1] = s.q[o + 1], out.q[o + 2] = s.q[o + 2], out.q[o + 3] = s.q[o + 3];
      out.has[i] = 1;
    } else out.has[i] = hb ? 1 : 0, hb && (out.q[o] = b.q[o], out.q[o + 1] = b.q[o + 1], out.q[o + 2] = b.q[o + 2], out.q[o + 3] = b.q[o + 3]);
  }
  out.hy = a.hy + (b.hy - a.hy) * (mask ? w * mask[0] : w);
}

// ── contexto y datos del árbol ────────────────────────────────────────────

export interface Ctx {
  /** Parámetros (velocidad, dirección, en el aire…): números; los booleanos van como 0/1. */
  p: Record<string, number>;
  /** Nombre lógico → clip («$walk» → «Walking»); las variantes (cosméticos) los sobrescriben. */
  slots: Record<string, string>;
  pack: Pack;
  masks: Record<string, Float32Array>;
  tmp: () => Pose;
  free: (p: Pose) => void;
}

export type Cond = { p: string; op: '>' | '<' | '>=' | '<=' | '==' | '!='; v: number } | { end: true };
export type NodeDef =
  | { type: 'clip'; clip: string; loop?: boolean; rate?: number; freeze?: number }
  | { type: 'blend1d'; param: string; sync?: boolean; fit?: boolean; items: { at: number; node: NodeDef }[] }
  | { type: 'blend2d'; px: string; py: string; sync?: boolean; items: { x: number; y: number; node: NodeDef }[] }
  | { type: 'machine'; entry: string; states: { name: string; node: NodeDef }[]; transitions: { from: string; to: string; when: Cond[]; fade?: number }[] }
  | { type: 'layer'; base: NodeDef; over: NodeDef; mask: string; weight: number | { p: string } }
  | { type: 'dance'; id: string };

// ── nodos ─────────────────────────────────────────────────────────────────

export abstract class Node {
  /** Posición normalizada del ciclo (0–1). */
  phase = 0;
  ended = false;
  abstract update(dt: number, c: Ctx): void;
  abstract eval(out: Pose, c: Ctx): void;
  /** Duración (s) del ciclo, para sincronizar. */
  abstract dur(c: Ctx): number;
  /** Los nodos de dentro (para recorrer el árbol: la herramienta busca la máquina de estados). */
  children(): Node[] {
    return [];
  }
  reset() {
    this.phase = 0;
    this.ended = false;
  }
}

const clipOf = (c: Ctx, name: string) => c.pack.clips.get(name.startsWith('$') ? c.slots[name.slice(1)] ?? '' : name);

export class ClipNode extends Node {
  constructor(private d: Extract<NodeDef, { type: 'clip' }>) {
    super();
    if (d.freeze !== undefined) this.phase = d.freeze;
  }
  dur(c: Ctx) {
    return clipOf(c, this.d.clip)?.dur ?? 1;
  }
  reset() {
    super.reset();
    if (this.d.freeze !== undefined) this.phase = this.d.freeze;
  }
  update(dt: number, c: Ctx) {
    if (this.d.freeze !== undefined) return;
    const k = clipOf(c, this.d.clip);
    if (!k) return;
    this.phase += (dt * (this.d.rate ?? 1)) / k.dur;
    if (this.d.loop === false) {
      if (this.phase >= 1) (this.phase = 1), (this.ended = true);
    } else this.phase %= 1;
  }
  eval(out: Pose, c: Ctx) {
    const k = clipOf(c, this.d.clip);
    out.clear();
    if (k) sampleClip(k, Math.min(this.phase, 1) * k.dur, this.d.loop !== false, out, c.pack.fps);
  }
}

/** Mezcla ponderada de varios nodos (pesos ya normalizados): se pliega de uno en uno. */
function mix(out: Pose, nodes: Node[], ws: number[], c: Ctx) {
  let acc = 0, first = true;
  const t = c.tmp();
  for (let i = 0; i < nodes.length; i++) {
    if (ws[i] <= 1e-4) continue;
    if (first) (nodes[i].eval(out, c), (first = false), (acc = ws[i]));
    else {
      const p = c.tmp();
      nodes[i].eval(p, c);
      acc += ws[i];
      t.copy(out);
      lerpPose(out, t, p, ws[i] / acc);
      c.free(p);
    }
  }
  c.free(t);
  if (first) out.clear();
}

export class Blend1D extends Node {
  private nodes: Node[];
  children() {
    return this.nodes;
  }
  private ws: number[];
  constructor(private d: Extract<NodeDef, { type: 'blend1d' }>) {
    super();
    this.d = { ...d, items: [...d.items].sort((a, b) => a.at - b.at) };
    this.nodes = this.d.items.map((i) => build(i.node));
    this.ws = this.nodes.map(() => 0);
  }
  private weights(v: number) {
    const it = this.d.items;
    this.ws.fill(0);
    if (v <= it[0].at) this.ws[0] = 1;
    else if (v >= it[it.length - 1].at) this.ws[it.length - 1] = 1;
    else for (let i = 0; i < it.length - 1; i++) if (v <= it[i + 1].at) ((this.ws[i + 1] = (v - it[i].at) / (it[i + 1].at - it[i].at || 1)), (this.ws[i] = 1 - this.ws[i + 1]));
  }
  dur(c: Ctx) {
    let d = 0;
    this.nodes.forEach((n, i) => (d += this.ws[i] * n.dur(c)));
    return d || 1;
  }
  update(dt: number, c: Ctx) {
    const v = c.p[this.d.param] ?? 0;
    this.weights(v);
    let rate = 1;
    if (this.d.fit) {
      // el clip se acelera o frena a la velocidad real: su umbral es la velocidad a la que ese clip se ve bien
      let ref = 0;
      this.d.items.forEach((i, k) => (ref += this.ws[k] * i.at));
      if (ref > 0.3) rate = THREE.MathUtils.clamp(v / ref, 0.6, 1.7);
    }
    if (this.d.sync !== false) {
      this.phase = (this.phase + (dt * rate) / this.dur(c)) % 1;
      this.nodes.forEach((n, i) => this.ws[i] > 1e-4 && ((n.phase = this.phase), n.update(0, c)));
    } else this.nodes.forEach((n, i) => this.ws[i] > 1e-4 && n.update(dt * rate, c));
  }
  eval(out: Pose, c: Ctx) {
    mix(out, this.nodes, this.ws, c);
  }
}

export class Blend2D extends Node {
  private nodes: Node[];
  children() {
    return this.nodes;
  }
  private ws: number[];
  constructor(private d: Extract<NodeDef, { type: 'blend2d' }>) {
    super();
    this.nodes = d.items.map((i) => build(i.node));
    this.ws = this.nodes.map(() => 0);
  }
  private weights(x: number, y: number) {
    // los tres puntos más cercanos, ponderados por 1/distancia²: sobre un punto vale 1 y se interpola suave entre ellos
    const ds = this.d.items.map((i, k) => ({ k, d: (i.x - x) ** 2 + (i.y - y) ** 2 })).sort((a, b) => a.d - b.d).slice(0, 3);
    this.ws.fill(0);
    if (ds[0].d < 1e-6) return void (this.ws[ds[0].k] = 1);
    let s = 0;
    for (const e of ds) s += 1 / e.d;
    for (const e of ds) this.ws[e.k] = 1 / e.d / s;
  }
  dur(c: Ctx) {
    let d = 0;
    this.nodes.forEach((n, i) => (d += this.ws[i] * n.dur(c)));
    return d || 1;
  }
  update(dt: number, c: Ctx) {
    this.weights(c.p[this.d.px] ?? 0, c.p[this.d.py] ?? 0);
    if (this.d.sync !== false) {
      this.phase = (this.phase + dt / this.dur(c)) % 1;
      this.nodes.forEach((n, i) => this.ws[i] > 1e-4 && ((n.phase = this.phase), n.update(0, c)));
    } else this.nodes.forEach((n, i) => this.ws[i] > 1e-4 && n.update(dt, c));
  }
  eval(out: Pose, c: Ctx) {
    mix(out, this.nodes, this.ws, c);
  }
}

const test = (cond: Cond, c: Ctx, n: Node) => {
  if ('end' in cond) return n.ended;
  const v = c.p[cond.p] ?? 0;
  return cond.op === '>' ? v > cond.v : cond.op === '<' ? v < cond.v : cond.op === '>=' ? v >= cond.v : cond.op === '<=' ? v <= cond.v : cond.op === '==' ? v === cond.v : v !== cond.v;
};

export class Machine extends Node {
  private nodes = new Map<string, Node>();
  cur: string;
  children() {
    return [...this.nodes.values()];
  }
  node(name: string) {
    return this.nodes.get(name);
  }
  private prev?: string;
  private fade = 0;
  private fadeT = 0;
  constructor(private d: Extract<NodeDef, { type: 'machine' }>) {
    super();
    for (const s of d.states) this.nodes.set(s.name, build(s.node));
    this.cur = d.entry;
  }
  dur(c: Ctx) {
    return this.nodes.get(this.cur)?.dur(c) ?? 1;
  }
  update(dt: number, c: Ctx) {
    const cur = this.nodes.get(this.cur)!;
    for (const t of this.d.transitions)
      if ((t.from === '*' ? t.to !== this.cur : t.from === this.cur) && t.when.every((w) => test(w, c, cur))) {
        this.prev = this.cur;
        this.cur = t.to;
        this.fade = this.fadeT = t.fade ?? 0.2;
        this.nodes.get(t.to)!.reset();
        break;
      }
    this.nodes.get(this.cur)!.update(dt, c);
    if (this.prev) {
      this.nodes.get(this.prev)!.update(dt, c);
      if ((this.fadeT -= dt) <= 0) this.prev = undefined;
    }
    this.ended = this.nodes.get(this.cur)!.ended;
  }
  eval(out: Pose, c: Ctx) {
    this.nodes.get(this.cur)!.eval(out, c);
    if (this.prev && this.fade > 0) {
      const a = c.tmp(), o = c.tmp();
      this.nodes.get(this.prev)!.eval(a, c);
      o.copy(out);
      lerpPose(out, a, o, 1 - this.fadeT / this.fade); // (suavizado: el cruce arranca y acaba tendido)
      c.free(a), c.free(o);
    }
  }
}

export class Layer extends Node {
  private base: Node;
  private over: Node;
  children() {
    return [this.base, this.over];
  }
  constructor(private d: Extract<NodeDef, { type: 'layer' }>) {
    super();
    this.base = build(d.base);
    this.over = build(d.over);
  }
  dur(c: Ctx) {
    return this.base.dur(c);
  }
  private w(c: Ctx) {
    return typeof this.d.weight === 'number' ? this.d.weight : c.p[this.d.weight.p] ?? 0;
  }
  update(dt: number, c: Ctx) {
    this.base.update(dt, c);
    if (this.w(c) > 1e-3) this.over.update(dt, c);
  }
  eval(out: Pose, c: Ctx) {
    this.base.eval(out, c);
    const w = this.w(c);
    if (w <= 1e-3) return;
    const o = c.tmp(), t = c.tmp();
    this.over.eval(o, c);
    t.copy(out);
    lerpPose(out, t, o, w, c.masks[this.d.mask]);
    c.free(o), c.free(t);
  }
}

/** Registro de constructores extra (los bailes viven en dance.ts y se enganchan aquí para no depender en círculo). */
export const extra: { dance?: (id: string) => Node } = {};

export function build(d: NodeDef): Node {
  switch (d.type) {
    case 'clip':
      return new ClipNode(d);
    case 'blend1d':
      return new Blend1D(d);
    case 'blend2d':
      return new Blend2D(d);
    case 'machine':
      return new Machine(d);
    case 'layer':
      return new Layer(d);
    case 'dance':
      return extra.dance!(d.id);
  }
}

import * as THREE from 'three';
import { solveArm } from '../ik';

/*
 * Pila de IK del Animator. Va DESPUÉS de la animación y parte siempre de la pose animada de ese fotograma (el
 * Animator reescribe los huesos cada vez), así no se acumula nada y funciona con cualquier clip. Cada objetivo
 * tiene un peso que sube y baja suave (sin saltos al coger o soltar) y se mezcla con la pose animada hueso a hueso.
 *  - Goal: brazo o pierna a un punto y orientación del mundo, con polo para el codo o la rodilla.
 *  - Pies al suelo: cada pie se apoya en la altura del terreno mientras está en contacto y la cadera baja con el pie más bajo.
 *  - Aim: el torso se reparte el giro necesario para mirar o apuntar hacia una dirección.
 */

export type Chain = 'LeftArm' | 'RightArm' | 'LeftLeg' | 'RightLeg';
export interface Target {
  pos: THREE.Vector3;
  quat?: THREE.Quaternion;
}
export interface Goal {
  chain: Chain;
  /** Dónde llevar la muñeca/el pie (mundo); null = sin objetivo (el peso baja a 0). */
  target: () => Target | null;
  /** Hacia dónde dobla el codo/la rodilla (punto del mundo); por defecto, atrás para el brazo y delante para la pierna. */
  pole?: () => THREE.Vector3 | null;
  /** Peso máximo (0–1). */
  weight: number;
  /** Cuánto del giro de muñeca se reparte con el antebrazo. */
  twist?: number;
  /** Rapidez con que el peso sigue (por segundo). */
  rate?: number;
  /** Peso actual (lo lleva la pila). */
  w?: number;
  /** Último objetivo que hubo: al soltar, el brazo se va hacia la animación desde ahí, sin saltar. */
  last?: Target;
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _r = new THREE.Quaternion(), _s = new THREE.Quaternion(), _f = new THREE.Vector3(), _g = new THREE.Vector3();
const ss = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Pone la rotación del mundo `world` a `bone` (descontando la de su padre). */
function setWorld(bone: THREE.Object3D, world: THREE.Quaternion) {
  bone.parent!.updateWorldMatrix(true, false);
  bone.parent!.getWorldQuaternion(_s).invert();
  bone.quaternion.copy(_s.multiply(world));
}

export class IKStack {
  goals: Goal[] = [];
  /** Altura del terreno en (x, z) del mundo; null = no hay (suelo plano: no hace nada). */
  ground?: (x: number, z: number) => number | null;
  footWeight = 1;
  /** Dirección del mundo hacia la que girar el torso (null = quieto) y cuánto. */
  aim?: { dir: () => THREE.Vector3 | null; weight: number; max?: number };
  private aimW = 0;
  private pelvis = 0;
  private plant = { Left: 0, Right: 0 };
  private rest = { foot: 0, chestOff: new THREE.Quaternion() };

  constructor(private root: THREE.Object3D, private bone: (n: string) => THREE.Bone | undefined) {
    // en la pose de reposo: cuánto está el tobillo sobre el suelo y cómo mira el pecho respecto al cuerpo
    root.updateWorldMatrix(true, true);
    const f = bone('LeftFoot'), s = bone('Spine2');
    if (f) this.rest.foot = f.getWorldPosition(_p).y - root.getWorldPosition(_g).y;
    if (s) this.rest.chestOff.copy(s.getWorldQuaternion(_q).invert().multiply(root.getWorldQuaternion(_r)));
  }

  private chainBones(c: Chain) {
    const side = c.startsWith('Left') ? 'Left' : 'Right', arm = c.endsWith('Arm');
    const b = this.bone;
    const parts = arm ? [b(`${side}Shoulder`), b(`${side}Arm`), b(`${side}ForeArm`), b(`${side}Hand`)] : [undefined, b(`${side}UpLeg`), b(`${side}Leg`), b(`${side}Foot`)];
    const [shoulder, a, fore, hand] = parts;
    return a && fore && hand ? { shoulder, arm: a, fore, hand } : undefined;
  }

  /** Resuelve una cadena hacia `t` y la mezcla con la pose animada con peso `w`. */
  private solve(c: Chain, t: Target, pole: THREE.Vector3, w: number, twist?: number) {
    const cb = this.chainBones(c);
    if (!cb || w < 0.001) return;
    const list = [cb.shoulder, cb.arm, cb.fore, cb.hand].filter(Boolean) as THREE.Bone[];
    const saved = list.map((b) => b.quaternion.clone());
    const keep = t.quat ?? cb.hand.getWorldQuaternion(new THREE.Quaternion()); // sin orientación pedida: la mano o el pie conserva la de la animación
    solveArm(cb, t.pos, pole, keep, twist ?? 0.55);
    if (w < 0.999) list.forEach((b, i) => b.quaternion.slerpQuaternions(saved[i], b.quaternion.clone(), w));
    cb.arm.updateWorldMatrix(true, true);
  }

  run(dt: number) {
    this.root.updateWorldMatrix(true, true);
    this.feet(dt);
    for (const g of this.goals) {
      const now = g.target();
      g.w = THREE.MathUtils.lerp(g.w ?? 0, now ? g.weight : 0, 1 - Math.exp(-dt * (g.rate ?? 12)));
      if (now) g.last = now;
      const t = now ?? (g.w > 0.01 ? g.last : undefined); // soltando: sigue el último objetivo mientras el peso baja
      if (!t || g.w < 0.001) continue;
      const cb = this.chainBones(g.chain);
      if (!cb) continue;
      const knee = cb.fore.getWorldPosition(new THREE.Vector3());
      this.root.getWorldQuaternion(_q);
      const fwd = _f.set(0, 0, 1).applyQuaternion(_q);
      // el codo atrás y abajo, la rodilla hacia delante
      const pole = (now ? g.pole?.() : undefined) ?? (g.last && (g.last as Target & { pole?: THREE.Vector3 }).pole) ?? (g.chain.endsWith('Arm') ? knee.add(fwd.clone().multiplyScalar(-0.6)).add(new THREE.Vector3(0, -0.4, 0)) : knee.add(fwd.clone().multiplyScalar(0.6)));
      this.solve(g.chain, t, pole, g.w, g.twist);
    }
    this.spine(dt);
  }

  /** Pies al suelo: cada pie en contacto se apoya en el terreno y la cadera baja con el pie más bajo. */
  private feet(dt: number) {
    const gr = this.ground;
    if (!gr || this.footWeight < 0.001) return;
    const rootY = this.root.getWorldPosition(_g).y, hips = this.bone('Hips');
    const want = { Left: 0, Right: 0 }, tg = { Left: new THREE.Vector3(), Right: new THREE.Vector3() }, q = { Left: new THREE.Quaternion(), Right: new THREE.Quaternion() };
    for (const side of ['Left', 'Right'] as const) {
      const foot = this.bone(`${side}Foot`);
      if (!foot) continue;
      foot.getWorldPosition(tg[side]);
      foot.getWorldQuaternion(q[side]);
      const lift = tg[side].y - rootY - this.rest.foot; // cuánto levanta la animación el pie del suelo
      this.plant[side] += (1 - ss(0.02, 0.18, lift) - this.plant[side]) * (1 - Math.exp(-dt * 20));
      const gy = gr(tg[side].x, tg[side].z);
      want[side] = gy === null ? 0 : (gy - rootY) * this.plant[side];
    }
    // la cadera baja hasta el pie más bajo (sin subir más de 10 cm), suave
    const target = THREE.MathUtils.clamp(Math.min(want.Left, want.Right, 0) + Math.max(0, Math.min(want.Left, want.Right)) * 0.5, -0.5, 0.1) * this.footWeight;
    this.pelvis += (target - this.pelvis) * (1 - Math.exp(-dt * 14));
    if (hips?.parent && Math.abs(this.pelvis) > 0.0005) {
      hips.getWorldPosition(_p).y += this.pelvis;
      hips.position.copy(hips.parent.worldToLocal(_p));
      hips.updateWorldMatrix(false, true);
    }
    for (const side of ['Left', 'Right'] as const) {
      const foot = this.bone(`${side}Foot`);
      if (!foot) continue;
      foot.getWorldPosition(_p); // (tras bajar la cadera)
      const wy = tg[side].y + want[side] * this.footWeight - 0; // altura final: la animada más el desnivel (el pie en el aire no se toca)
      if (Math.abs(wy - _p.y) < 0.002) continue;
      _p.y = wy;
      const knee = this.bone(`${side}Leg`)!.getWorldPosition(new THREE.Vector3());
      this.root.getWorldQuaternion(_r);
      this.solve(`${side}Leg` as Chain, { pos: _p.clone(), quat: q[side] }, knee.add(_f.set(0, 0, 1).applyQuaternion(_r).multiplyScalar(0.6)), 1, 0.3);
    }
  }

  /** El torso se reparte el giro hacia la dirección de `aim` (tercios entre Spine, Spine1 y Spine2). */
  private spine(dt: number) {
    const a = this.aim, d = a?.dir();
    this.aimW = THREE.MathUtils.lerp(this.aimW, d && a ? a.weight : 0, 1 - Math.exp(-dt * 10));
    const chest = this.bone('Spine2');
    if (!a || !d || this.aimW < 0.001 || !chest) return;
    chest.updateWorldMatrix(true, false);
    chest.getWorldQuaternion(_q).multiply(this.rest.chestOff);
    const fwd = _f.set(0, 0, 1).applyQuaternion(_q), delta = new THREE.Quaternion().setFromUnitVectors(fwd, _g.copy(d).normalize());
    const ang = 2 * Math.acos(Math.min(1, Math.abs(delta.w))), max = a.max ?? 1.2;
    if (ang > max) delta.slerp(new THREE.Quaternion(), 1 - max / ang);
    const part = new THREE.Quaternion().slerp(delta, this.aimW / 3);
    for (const n of ['Spine', 'Spine1', 'Spine2']) {
      const b = this.bone(n);
      if (!b) continue;
      b.updateWorldMatrix(true, false);
      b.getWorldQuaternion(_r).premultiply(part);
      setWorld(b, _r);
      b.updateWorldMatrix(false, true);
    }
  }
}

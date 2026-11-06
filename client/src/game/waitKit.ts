import * as THREE from 'three';

/*
 * Lo que comparten la sala de espera (waiting.ts), su decorado (waitDecor.ts) y el pasillo de detrás de la puerta
 * (waitCorridor.ts): ayudas para pintar texturas en un lienzo y planos con las UV a metros, y la cuenta de lo que
 * hay que soltar al salir (`Bag`).
 */

export interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Lo que se crea en la sala y se libera al salir: texturas y cosas con dispose(). */
export interface Bag {
  own: { dispose?: () => void }[];
  tex: THREE.Texture[];
}

export const clamp = THREE.MathUtils.clamp;
export const smooth = (x: number) => ((x = clamp(x, 0, 1)), x * x * (3 - 2 * x));
export const hash = (n: number) => Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1;
export const MONO = 'ui-monospace, Consolas, monospace';

/** Un lienzo pintado como textura. */
export function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, srgb = true) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Como canvasTex, pero apuntada en `bag` (se libera sola al salir). */
export function bagTex(bag: Bag, w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, srgb = true) {
  const t = canvasTex(w, h, draw, srgb);
  bag.tex.push(t);
  return t;
}

/** Un plano con las UV a metros (una repetición de la textura cada `per` m). */
export function plane(w: number, h: number, mat: THREE.Material, per: number, pos: [number, number, number], rx: number, ry: number) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / per, (uv.getY(i) * h) / per);
  const m = new THREE.Mesh(g, mat);
  m.position.set(...pos);
  m.rotation.set(rx, ry, 0);
  return m;
}

/** Un decal: plano de una textura con alfa (sin escribir profundidad, algo despegado de la pared). `rot` en el orden YXZ. */
export function decal(w: number, h: number, mat: THREE.Material, pos: [number, number, number], rx: number, ry: number, rz = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(...pos);
  m.rotation.set(rx, ry, rz, 'YXZ');
  m.renderOrder = 1;
  return m;
}

/** Un punto de luz difuso (blanco: el material lo tiñe). */
export function softTex(bag: Bag, a0 = 1, a1 = 0.35) {
  return bagTex(bag, 64, 64, (x) => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, `rgba(255,255,255,${a0})`);
    g.addColorStop(0.4, `rgba(255,255,255,${a1})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
  });
}

/** Una nube de polvo en el aire: puntos que derivan despacio dentro de una caja. */
export class Dust {
  readonly points: THREE.Points;
  private v: Float32Array;
  private mat: THREE.PointsMaterial;
  constructor(bag: Bag, n: number, min: THREE.Vector3, max: THREE.Vector3, size = 0.04, opacity = 0.5, color = 0xfff0c0) {
    const p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = min.x + Math.random() * (max.x - min.x);
      p[i * 3 + 1] = min.y + Math.random() * (max.y - min.y);
      p[i * 3 + 2] = min.z + Math.random() * (max.z - min.z);
      this.v[i * 3] = (Math.random() - 0.5) * 0.05;
      this.v[i * 3 + 1] = -0.01 - Math.random() * 0.03;
      this.v[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.mat = new THREE.PointsMaterial({ size, color, map: softTex(bag), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.min = min;
    this.max = max;
    bag.own.push(g, this.mat);
  }
  private min: THREE.Vector3;
  private max: THREE.Vector3;
  opacity(o: number) {
    this.mat.opacity = o;
    this.points.visible = o > 0.003;
  }
  update(dt: number, t: number) {
    const a = this.points.geometry.getAttribute('position') as THREE.BufferAttribute, p = a.array as Float32Array;
    for (let i = 0; i < p.length; i += 3) {
      p[i] += (this.v[i] + Math.sin(t * 0.4 + i) * 0.012) * dt;
      p[i + 1] += (this.v[i + 1] + Math.sin(t * 0.3 + i * 1.7) * 0.01) * dt;
      p[i + 2] += (this.v[i + 2] + Math.cos(t * 0.35 + i) * 0.012) * dt;
      if (p[i + 1] < this.min.y) p[i + 1] = this.max.y;
      if (p[i] < this.min.x) p[i] = this.max.x;
      else if (p[i] > this.max.x) p[i] = this.min.x;
      if (p[i + 2] < this.min.z) p[i + 2] = this.max.z;
      else if (p[i + 2] > this.max.z) p[i + 2] = this.min.z;
    }
    a.needsUpdate = true;
  }
}

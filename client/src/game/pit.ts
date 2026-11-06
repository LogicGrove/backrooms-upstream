import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, type Cell } from './maze';

/*
 * Los huecos del suelo: una celda entera sin suelo, pero con cara. El borde de la moqueta sale rasgado
 * (un anillo con el canto irregular que se hunde un poco hacia dentro), debajo asoma el canto de hormigón
 * de la losa, de ahí cuelgan un par de hierros doblados, hay cascotes tirados en el suelo de alrededor, y el
 * pozo se oscurece con la profundidad hasta ser negro. Todo sale de una semilla por celda: el mismo mapa,
 * los mismos huecos. La colisión sigue siendo la celda entera; el anillo de moqueta se come como mucho 14 cm
 * del hueco, que no se nota al andar.
 */

const H = CELL / 2;
const SIDE = 7; // puntos por lado del cuadrado
const DEPTH = 8; // lo que baja el pozo, en metros

function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** El punto `i` del perímetro del cuadrado de la celda, en su espacio local (de -H a H). */
function perimeter(i: number) {
  const n = SIDE * 4, u = (i % n) / SIDE, s = Math.floor(u), t = u - s;
  const [ax, az] = [[-H, -H], [H, -H], [H, H], [-H, H]][s], [bx, bz] = [[H, -H], [H, H], [-H, H], [-H, -H]][s];
  return new THREE.Vector2(ax + (bx - ax) * t, az + (bz - az) * t);
}

const CONCRETE = new THREE.Color(0.46, 0.44, 0.39);
const DARK = new THREE.Color(0.16, 0.15, 0.13);
const COLD = new THREE.Color(0.02, 0.025, 0.03);
const RUST = new THREE.Color(0.36, 0.2, 0.11);

/** Geometría de todos los huecos de un mapa: `junk` (pozo, hierros y cascotes, con colores por vértice) y `lip` (el anillo de moqueta, con UV de suelo). */
export function buildPits(voids: Cell[]) {
  const shaft: THREE.BufferGeometry[] = [], lip: THREE.BufferGeometry[] = [];
  for (const v of voids) {
    const r = rng(v.x * 7919 + v.y * 104729 + 17), cx = (v.x + 0.5) * CELL, cz = (v.y + 0.5) * CELL, N = SIDE * 4;
    // el borde de dentro, rasgado: cada punto del perímetro se mete 5–14 cm (más a rachas, como un mordisco)
    let bite = 0;
    const inner = Array.from({ length: N }, (_, i) => {
      if (r() < 0.2) bite = 0.04 + r() * 0.06;
      bite *= 0.7;
      const p = perimeter(i), k = (H - (0.05 + r() * 0.05 + bite)) / H;
      return p.clone().multiplyScalar(k);
    });
    const outer = Array.from({ length: N }, (_, i) => perimeter(i));

    // el anillo de moqueta: entre el cuadrado y el borde rasgado, con la parte de dentro algo hundida
    {
      const pos: number[] = [], uv: number[] = [], P = (p: THREE.Vector2, y: number) => (pos.push(cx + p.x, y, cz + p.y), uv.push((cx + p.x) / CELL, (cz + p.y) / CELL));
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        // (outer i, inner i, outer j) y (outer j, inner i, inner j), de cara arriba
        P(outer[i], 0.002), P(inner[i], -0.012), P(outer[j], 0.002);
        P(outer[j], 0.002), P(inner[i], -0.012), P(inner[j], -0.012);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      // las normales de arriba, sea cual sea el orden de los vértices
      const nrm = g.getAttribute('normal');
      for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
      lip.push(g);
    }

    // las paredes del pozo: el canto de hormigón (con su escalón irregular), luego se oscurece hasta el negro
    {
      const pos: number[] = [], col: number[] = [];
      const Q = (p: THREE.Vector2, y: number, c: THREE.Color) => (pos.push(cx + p.x, y, cz + p.y), col.push(c.r, c.g, c.b));
      const stops = (i: number) => [
        { y: -0.01, c: CONCRETE },
        { y: -0.1 - ((i * 37) % 11) * 0.02, c: CONCRETE.clone().multiplyScalar(0.8) }, // el canto de la losa
        { y: -0.45, c: DARK },
        { y: -1.6, c: COLD.clone().lerp(DARK, 0.25) },
        { y: -DEPTH, c: COLD },
      ];
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N, si = stops(i), sj = stops(j);
        for (let s = 0; s < si.length - 1; s++) {
          // un escalón hacia dentro en el canto: la losa se rompe en dos niveles
          const a = inner[i].clone().multiplyScalar(s === 0 ? 1 : 0.985), b = inner[j].clone().multiplyScalar(s === 0 ? 1 : 0.985);
          Q(a, si[s].y, si[s].c), Q(b, sj[s].y, sj[s].c), Q(a, si[s + 1].y, si[s + 1].c);
          Q(b, sj[s].y, sj[s].c), Q(b, sj[s + 1].y, sj[s + 1].c), Q(a, si[s + 1].y, si[s + 1].c);
        }
      }
      // el fondo, negro
      const c4 = [new THREE.Vector2(-H, -H), new THREE.Vector2(H, -H), new THREE.Vector2(H, H), new THREE.Vector2(-H, H)];
      for (const k of [0, 1, 2, 0, 2, 3]) Q(c4[k], -DEPTH, COLD);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      shaft.push(g);
    }

    // los hierros que asoman del canto, doblados hacia abajo, y los cascotes del suelo de alrededor
    const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
      const n = g.getAttribute('position').count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    const keep = (g: THREE.BufferGeometry) => {
      g.deleteAttribute('uv');
      return g.index ? g.toNonIndexed() : g;
    };
    for (let k = 0; k < 3; k++) {
      const i = (r() * N) | 0, p = inner[i], dir = new THREE.Vector3(-p.x, -0.35 - r() * 0.3, -p.y).normalize(), len = 0.18 + r() * 0.22;
      const g = keep(new THREE.CylinderGeometry(0.007, 0.007, len, 5));
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(cx + p.x + (dir.x * len) / 2, -0.14 - r() * 0.1 + (dir.y * len) / 2, cz + p.y + (dir.z * len) / 2), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), new THREE.Vector3(1, 1, 1)));
      shaft.push(paint(g, RUST));
    }
    for (let k = 0; k < 6; k++) {
      // en el suelo de fuera del cuadrado (son celdas abiertas por los cuatro lados)
      const o = perimeter(Math.floor(r() * N)), out = o.clone().normalize().multiplyScalar(0.08 + r() * 0.35), s = 0.03 + r() * 0.07;
      const g = keep(new THREE.BoxGeometry(s * (1 + r()), s, s * (1 + r())));
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(cx + o.x + out.x, s / 2, cz + o.y + out.y), new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 0.5, r() * 6.28, r() * 0.5)), new THREE.Vector3(1, 1, 1)));
      shaft.push(paint(g, CONCRETE.clone().multiplyScalar(0.55 + r() * 0.35)));
    }
  }
  const merge = (gs: THREE.BufferGeometry[]) => (gs.length ? mergeGeometries(gs) : null);
  return { junk: merge(shaft), lip: merge(lip) };
}

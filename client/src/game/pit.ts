import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, type Cell } from './maze';

/*
 * Los huecos del suelo: vacíos. Un borde de moqueta recto, y por dentro las paredes del propio pasillo (con el papel de
 * las Backrooms) que se apagan a negro enseguida: a un metro ya no se ve nada, y el fondo no existe. Sin roca ni hierros ni
 * cascotes. Los de las salas de pozos se comen además PIT_EDGE metros de la pasarela por cada lado (el suelo de esas celdas
 * se recorta igual en world.ts), así que el camino entre ellos es estrecho. Todo sale de la celda: el mismo mapa, los mismos huecos.
 */

/** Lo que el hueco de una sala de pozos invade las celdas de al lado (m): la pasarela de 1,5 m queda en 0,75 m. */
export const PIT_EDGE = 0.375;

const H = CELL / 2;
const SIDE = 7; // puntos por lado del cuadrado
const DEPTH = 8; // lo que baja el pozo, en metros
const N = SIDE * 4;

/** El punto `i` del perímetro del cuadrado de la celda, en su espacio local (de -H a H). */
function perimeter(i: number) {
  const u = (i % N) / SIDE, s = Math.floor(u), t = u - s;
  const [ax, az] = [[-H, -H], [H, -H], [H, H], [-H, H]][s], [bx, bz] = [[H, -H], [H, H], [-H, H], [-H, -H]][s];
  return new THREE.Vector2(ax + (bx - ax) * t, az + (bz - az) * t);
}

const NB = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Geometría de todos los huecos de un mapa: `junk` (las paredes del pozo, con color por vértice y UV) y `lip` (el borde de moqueta, con UV de suelo). */
export function buildPits(voids: Cell[], clean: (c: Cell) => boolean = () => false) {
  const shaft: THREE.BufferGeometry[] = [], lip: THREE.BufferGeometry[] = [];
  const has = new Set(voids.map((c) => c.x + ',' + c.y));
  for (const v of voids) {
    const nb = (dx: number, dz: number) => has.has(v.x + dx + ',' + (v.y + dz));
    // los lados que dan a otro hueco no llevan borde ni pared: los fosos grandes son varias celdas juntas
    const shared = (i: number) => {
      const [dx, dz] = NB[Math.floor((i % N) / SIDE)];
      return nb(dx, dz);
    };
    const ex = clean(v) ? PIT_EDGE : 0;
    // cada punto del perímetro se sale de la celda ex metros por los lados que no tocan otro hueco
    const grow = (p: THREE.Vector2) => new THREE.Vector2(p.x > H - 1e-4 && !nb(1, 0) ? ex : p.x < -H + 1e-4 && !nb(-1, 0) ? -ex : 0, p.y > H - 1e-4 && !nb(0, 1) ? ex : p.y < -H + 1e-4 && !nb(0, -1) ? -ex : 0);
    const cx = (v.x + 0.5) * CELL, cz = (v.y + 0.5) * CELL, k = (H - 0.05) / H;
    const outer = Array.from({ length: N }, (_, i) => perimeter(i).add(grow(perimeter(i))));
    const inner = Array.from({ length: N }, (_, i) => perimeter(i).multiplyScalar(k).add(grow(perimeter(i))));

    // el borde de moqueta: entre el contorno y 5 cm hacia dentro, apenas hundido
    {
      const pos: number[] = [], uv: number[] = [], P = (p: THREE.Vector2, y: number) => (pos.push(cx + p.x, y, cz + p.y), uv.push((cx + p.x) / CELL, (cz + p.y) / CELL));
      for (let i = 0; i < N; i++) {
        if (shared(i)) continue;
        const j = (i + 1) % N;
        P(outer[i], 0.002), P(inner[i], -0.01), P(outer[j], 0.002);
        P(outer[j], 0.002), P(inner[i], -0.01), P(inner[j], -0.01);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const nrm = g.getAttribute('normal');
      for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
      lip.push(g);
    }

    // las paredes del pozo: el papel de las Backrooms, que se oscurece hasta el negro absoluto en menos de dos metros
    {
      const pos: number[] = [], col: number[] = [], uv: number[] = [];
      const gray = [{ y: -0.01, c: 0.7 }, { y: -0.4, c: 0.3 }, { y: -1, c: 0.06 }, { y: -2, c: 0 }, { y: -DEPTH, c: 0 }];
      const Q = (p: THREE.Vector2, s: { y: number; c: number }) => (pos.push(cx + p.x, s.y, cz + p.y), col.push(s.c, s.c, s.c), uv.push((cx + p.x + cz + p.y) / CELL, -s.y / CELL));
      for (let i = 0; i < N; i++) {
        if (shared(i)) continue;
        const j = (i + 1) % N, a = inner[i], b = inner[j];
        for (let s = 0; s < gray.length - 1; s++) {
          Q(a, gray[s]), Q(b, gray[s]), Q(a, gray[s + 1]);
          Q(b, gray[s]), Q(b, gray[s + 1]), Q(a, gray[s + 1]);
        }
      }
      // el fondo, negro
      const c4 = [new THREE.Vector2(-H, -H), new THREE.Vector2(H, -H), new THREE.Vector2(H, H), new THREE.Vector2(-H, H)].map((p) => p.add(grow(p)));
      for (const q of [0, 1, 2, 0, 2, 3]) Q(c4[q], { y: -DEPTH, c: 0 });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      shaft.push(g);
    }
  }
  const merge = (gs: THREE.BufferGeometry[]) => (gs.length ? mergeGeometries(gs) : null);
  return { junk: merge(shaft), lip: merge(lip) };
}

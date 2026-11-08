import * as THREE from 'three';
import { CELL, ZONE, type Cell, type Maze } from './maze';

/*
 * La luz de las backrooms, horneada al crear cada mapa: una textura vista desde arriba (4 texels por
 * celda) con lo que llega de cada fluorescente encendido y la oclusión de las paredes cercanas (esquinas
 * y pies de pared más oscuros). Cada fluorescente es un panel de 1,2 m, no un punto: se muestrea en tres
 * puntos a lo largo y la penumbra de las sombras sale sola. Los tubos que parpadean van aparte, en una
 * segunda textura con un canal por grupo (hasta cuatro): al parpadear uno, se iluminan y se apagan a la
 * vez las paredes de alrededor, no solo el panel. Suelo, techo, paredes y piezas la leen por su posición
 * en el mundo; las paredes, medio metro hacia fuera de su cara.
 *
 * Es una textura de datos en un uniform: cambiarla de un mapa a otro no crea programas nuevos.
 */

/** Intensidad de la linterna con la pila llena (candelas de un SpotLight). */
export const FLASH = 45;

const R = 4; // texels por celda
const COLOR = [1, 0.93, 0.74]; // fluorescente viejo, tirando a amarillo
const RANGE = 10; // metros: más allá, un panel no cuenta
const SPAN = [-0.4, 0, 0.4]; // los puntos del panel que alumbran, a lo largo de su lado largo (x)

// los uniforms, compartidos por todos los materiales parcheados (hay una partida a la vez)
// uLmGain: la corriente (1 normal, 0 en un apagón), compartida por todos los materiales
// uLm2/uFlick: la luz de los tubos que parpadean, un canal por grupo, y cuánto da cada grupo ahora
export const LM = {
  uLm: { value: null as THREE.Texture | null },
  uLm2: { value: null as THREE.Texture | null },
  uFlick: { value: new THREE.Vector4(1, 1, 1, 1) },
  uLmSize: { value: new THREE.Vector2(1, 1) },
  uLmGain: { value: 1 },
};
const patched = new WeakSet<THREE.Material>();

/** Hace que un material estándar tome la luz del lightmap (una vez por material; la misma función siempre: el mismo programa). */
export function lightmapped(m: THREE.Material) {
  if (patched.has(m) || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
  patched.add(m);
  m.onBeforeCompile = patch;
}

function patch(s: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(s.uniforms, LM);
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vLmP;\nvarying vec3 vLmN;')
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec4 lmW = vec4(transformed, 1.0);
      vec3 lmN = objectNormal;
      #ifdef USE_INSTANCING
        lmW = instanceMatrix * lmW;
        lmN = mat3(instanceMatrix) * lmN;
      #endif
      vLmP = (modelMatrix * lmW).xyz;
      vLmN = normalize(mat3(modelMatrix) * lmN);`,
    );
  s.fragmentShader = s.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform sampler2D uLm;\nuniform sampler2D uLm2;\nuniform vec4 uFlick;\nuniform vec2 uLmSize;\nuniform float uLmGain;\nvarying vec3 vLmP;\nvarying vec3 vLmN;')
    .replace(
      '#include <opaque_fragment>',
      `{
        vec3 n = normalize(vLmN);
        vec2 lmUv = (vLmP.xz + n.xz * 0.45) / uLmSize;
        vec4 lm = texture2D(uLm, lmUv);
        // los tubos que parpadean (cada grupo con su nivel) se suman a la luz fija, del mismo color de tubo viejo
        lm.rgb += vec3(1.0, 0.93, 0.74) * dot(texture2D(uLm2, lmUv), uFlick);
        // en las paredes: el rodapié en sombra y una franja más oscura bajo el techo
        float side = 1.0 - abs(n.y);
        float grad = mix(1.0, 0.5 + 0.5 * smoothstep(-0.1, 0.8, vLmP.y), side) * mix(1.0, 0.82, side * smoothstep(2.1, 2.7, vLmP.y));
        // el techo recibe poco de unos paneles que alumbran hacia abajo
        float up = n.y < -0.5 ? 0.42 : 1.0;
        outgoingLight = outgoingLight * lm.a * grad + diffuseColor.rgb * lm.rgb * 1.5 * lm.a * grad * up * uLmGain;
      }
      #include <opaque_fragment>`,
    );
}

/**
 * Hornea la luz de un mapa y la deja puesta en los materiales parcheados. `flick`: los paneles que
 * parpadean, cada uno con su grupo (0–3); van a la segunda textura y no a la fija.
 */
export function bakeLight(m: Maze, flick: { c: Cell; g: number }[] = []) {
  const W = m.w * R, H = m.h * R, n = W * H;
  const light = new Float32Array(n), fl = new Float32Array(n * 4), ao = new Float32Array(n), solidT = new Uint8Array(n);
  const solid = (cx: number, cy: number) => cx < 0 || cy < 0 || cx >= m.w || cy >= m.h || !m.open[cy * m.w + cx];
  const group = new Map(flick.map((f) => [f.c.y * m.w + f.c.x, f.g]));
  const lamps = m.lamps.map((c) => ({ x: (c.x + 0.5) * CELL, z: (c.y + 0.5) * CELL, g: group.get(c.y * m.w + c.x) ?? -1 }));
  // los paneles, por cubos de 6 m, para no mirarlos todos desde cada texel
  const B = 6, bw = Math.ceil((m.w * CELL) / B), buckets: (typeof lamps)[] = Array.from({ length: bw * bw }, () => []);
  for (const l of lamps) buckets[Math.floor(l.z / B) * bw + Math.floor(l.x / B)]?.push(l);
  const step = CELL / 4;
  const sees = (ax: number, az: number, bx: number, bz: number, d: number) => {
    const k = Math.ceil(d / step);
    for (let i = 1; i < k; i++) {
      const t = i / k;
      if (solid(Math.floor((ax + (bx - ax) * t) / CELL), Math.floor((az + (bz - az) * t) / CELL))) return false;
    }
    return true;
  };
  const near = Math.ceil(RANGE / B);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const k = j * W + i, px = ((i + 0.5) / R) * CELL, pz = ((j + 0.5) / R) * CELL, cx = Math.floor(i / R), cy = Math.floor(j / R);
      if (solid(cx, cy)) {
        solidT[k] = 1;
        continue;
      }
      // la luz: cada panel visible (tres puntos suyos), con caída suave (están a 2,65 m: nunca de golpe)
      let sum = 0.05; // un mínimo: hasta las zonas apagadas dejan ver algo con la linterna encima
      const bx = Math.floor(px / B), bz = Math.floor(pz / B);
      for (let y = bz - near; y <= bz + near; y++)
        for (let x = bx - near; x <= bx + near; x++) {
          const b = x >= 0 && y >= 0 && x < bw && y < bw ? buckets[y * bw + x] : undefined;
          if (!b) continue;
          for (const l of b) {
            let got = 0;
            for (const o of SPAN) {
              const dx = l.x + o - px, dz = l.z - pz, d2 = dx * dx + dz * dz;
              if (d2 > RANGE * RANGE || !sees(px, pz, l.x + o, l.z, Math.sqrt(d2))) continue;
              got += 0.95 / SPAN.length / (1 + (d2 + 6) / 3.1); // caída más seca: charcos de luz bajo cada tubo y penumbra entre ellos
            }
            if (l.g < 0) sum += got;
            else fl[k * 4 + l.g] += got;
          }
        }
      light[k] = sum;
      // la oclusión: cada celda de pared vecina oscurece según lo cerca que esté su borde
      let f = 1;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || !solid(cx + dx, cy + dy)) continue;
          const x0 = (cx + dx) * CELL, z0 = (cy + dy) * CELL;
          const ex = Math.max(x0 - px, 0, px - (x0 + CELL)), ez = Math.max(z0 - pz, 0, pz - (z0 + CELL));
          const d = Math.hypot(ex, ez);
          f *= 1 - 0.55 * (1 - THREE.MathUtils.smoothstep(d, 0, 1.7)); // contacto: esquinas y pies de pared algo más oscuros y más anchos
        }
      ao[k] = f;
    }
  // lo de dentro de las paredes toma lo de sus vecinos (al filtrar, el borde no se oscurece)
  for (let pass = 0; pass < 2; pass++)
    for (let k = 0; k < n; k++) {
      if (!solidT[k]) continue;
      let l = 0, a = 0, c = 0;
      const f4 = [0, 0, 0, 0];
      for (const o of [1, -1, W, -W]) {
        const q = k + o;
        if (q < 0 || q >= n || (solidT[q] && light[q] === 0)) continue;
        l += light[q];
        a += ao[q];
        for (let g = 0; g < 4; g++) f4[g] += fl[q * 4 + g];
        c++;
      }
      if (c) {
        light[k] = l / c;
        ao[k] = a / c;
        for (let g = 0; g < 4; g++) fl[k * 4 + g] = f4[g] / c;
      }
    }
  // un desenfoque de 3×3: las sombras de las paredes, con penumbra (`stride`/`ch`: un canal de un array de 4)
  const blur = (src: Float32Array, stride = 1, ch = 0) => {
    const out = new Float32Array(n);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        let s = 0, c = 0;
        for (let y = Math.max(0, j - 1); y <= Math.min(H - 1, j + 1); y++) for (let x = Math.max(0, i - 1); x <= Math.min(W - 1, i + 1); x++) (s += src[(y * W + x) * stride + ch]), c++;
        out[j * W + i] = s / c;
      }
    return out;
  };
  // la luz rebotada: un desenfoque ancho (~2,5 m) mezclado con la directa, para que la sombra de una esquina
  // no sea un corte seco y entre las lámparas quede un relleno suave y tenue, como el de una sala real
  const wide = (src: Float32Array, r: number) => {
    const tmp = new Float32Array(n), out = new Float32Array(n);
    for (let j = 0; j < H; j++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += src[j * W + Math.min(W - 1, Math.max(0, i))];
      for (let i = 0; i < W; i++) {
        tmp[j * W + i] = s / (2 * r + 1);
        s += src[j * W + Math.min(W - 1, i + r + 1)] - src[j * W + Math.max(0, i - r)];
      }
    }
    for (let i = 0; i < W; i++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += tmp[Math.min(H - 1, Math.max(0, j)) * W + i];
      for (let j = 0; j < H; j++) {
        out[j * W + i] = s / (2 * r + 1);
        s += tmp[Math.min(H - 1, j + r + 1) * W + i] - tmp[Math.max(0, j - r) * W + i];
      }
    }
    return out;
  };
  const L0 = blur(light), Lw = wide(L0, 10);
  const L = L0.map((v, k) => v * 0.82 + Lw[k] * 0.3);
  const A = blur(ao), F = [0, 1, 2, 3].map((g) => blur(fl, 4, g));
  const data = new Uint8Array(n * 4), data2 = new Uint8Array(n * 4);
  // cada tipo de zona, un tono de luz: se reconoce de lejos dónde se está
  const TINT: Record<number, number[]> = { [ZONE.pits]: [1, 0.96, 0.66], [ZONE.cubicles]: [0.9, 1, 0.96], [ZONE.office]: [0.96, 0.98, 1], [ZONE.shelves]: [1, 0.9, 0.74] };
  for (let k = 0; k < n; k++) {
    const tint = TINT[m.zone[Math.floor(k / W / R) * m.w + Math.floor(((k % W) / R))]] ?? [1, 1, 1];
    // lo que llega menos se vuelve más cobrizo (la luz vieja se apaga hacia el naranja)
    const t = Math.min(1, L[k] / 2), v = t * 255, warm = 1 - t;
    data[k * 4] = v * COLOR[0] * tint[0];
    data[k * 4 + 1] = v * (COLOR[1] - 0.08 * warm) * tint[1];
    data[k * 4 + 2] = v * (COLOR[2] - 0.22 * warm) * tint[2];
    data[k * 4 + 3] = A[k] * 255;
    for (let g = 0; g < 4; g++) data2[k * 4 + g] = Math.min(1, F[g][k] / 2) * 255;
  }
  // los nichos de las paredes (escondites): casi a oscuras
  for (const { cell } of m.hides)
    for (let j = 0; j < R; j++)
      for (let i = 0; i < R; i++) {
        const k = (cell.y * R + j) * W + cell.x * R + i;
        for (let c = 0; c < 3; c++) data[k * 4 + c] *= 0.1;
        data[k * 4 + 3] *= 0.25;
        data2.fill(0, k * 4, k * 4 + 4);
      }
  const mk = (d: Uint8Array<ArrayBuffer>) => {
    const tex = new THREE.DataTexture(d, W, H);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  };
  const tex = mk(data);
  LM.uLm.value?.dispose();
  LM.uLm2.value?.dispose();
  LM.uLm.value = tex;
  LM.uLm2.value = mk(data2);
  LM.uLmSize.value.set(m.w * CELL, m.h * CELL);
  return tex;
}

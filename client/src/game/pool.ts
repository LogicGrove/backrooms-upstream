import * as THREE from 'three';
import type { Controls } from './input';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { settings } from '../settings';

/*
 * Poolrooms, paso 1 del plan (docs/poolrooms.md): un cuarto de prueba con SOLO el agua. Sin texturas de archivo ni render extra:
 * superficie opaca (sin transparencia ni refracción real), dos campos de ondas analíticos, color por profundidad, cáusticas falsas,
 * reflejo falso del techo (luces de neón) y hasta 12 ondas por impulso (pasos). Se abre con `?pool`.
 */

const W = 28, D = 28, HT = 4.2; // sala
const PW = 16, PD = 16, DEEP = 1.4, SURF = -0.3; // piscina centrada, fondo a -DEEP, agua a SURF (cubierta en y=0)
export const EYE = 1.62, NRIP = 20;

export const vert = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vW;
varying vec4 vUv;
uniform mat4 textureMatrix;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vUv = textureMatrix * vec4(position, 1.0);
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

export const frag = /* glsl */ `
#include <fog_pars_fragment>
uniform float uTime;
uniform vec4 uRip[${NRIP}];
uniform vec3 uCam;
uniform vec2 uHalf;
uniform float uDeep;
uniform float uCeil;
uniform sampler2D tDiffuse;
uniform vec3 color;
varying vec3 vW;
varying vec4 vUv;

// gradiente de un campo de ondas: suma de senos con direcciones fijas (barato y sin textura)
vec2 waves(vec2 p, float t){
  vec2 g = vec2(0.0);
  g += vec2( 0.8, 0.6) * 0.040 * 3.1 * cos(dot(p, vec2( 0.8, 0.6)) * 3.1 + t * 1.60);
  g += vec2(-0.5, 0.86) * 0.030 * 4.7 * cos(dot(p, vec2(-0.5, 0.86)) * 4.7 - t * 1.90);
  g += vec2( 0.97,-0.24) * 0.018 * 7.3 * cos(dot(p, vec2( 0.97,-0.24)) * 7.3 + t * 2.50);
  g += vec2(-0.3,-0.95) * 0.010 * 11.0 * cos(dot(p, vec2(-0.3,-0.95)) * 11.0 - t * 3.20);
  return g;
}
// segunda capa, más fina, en sentido contrario (hace que no se vea el patrón de la primera)
vec2 ripples(vec2 p, float t){
  vec2 g = vec2(0.0);
  for (int i = 0; i < ${NRIP}; i++){
    vec4 r = uRip[i];
    float age = t - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 6.0) continue;
    vec2 d = p - r.xy;
    float dl = length(d) + 1e-4;
    float u = dl - 1.7 * age;
    float env = exp(-age * 0.75) * exp(-pow(u * 1.0, 2.0)) * r.w;
    float f = env * (18.0 * cos(18.0 * u) + sin(18.0 * u) * (-2.0 * 1.0 * u)) * 0.028;
    g += f * d / dl;
  }
  return g;
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// cáusticas: dos capas de líneas de celda desplazadas (la clásica trampa barata)
float caustic(vec2 p, float t){
  float c = 0.0;
  for (int k = 0; k < 2; k++){
    vec2 q = p * (1.7 + float(k) * 1.1) + vec2(t * 0.15, -t * 0.11) * (1.0 + float(k));
    q += 0.35 * vec2(sin(q.y * 1.7 + t), cos(q.x * 1.9 - t * 0.8));
    vec2 f = abs(fract(q) - 0.5);
    c += pow(1.0 - 2.0 * min(f.x, f.y), 14.0);
  }
  return c * 0.5;
}
// el techo reflejado: rejilla de tubos de neón
float ceiling(vec3 pos, vec3 r){
  if (r.y <= 0.02) return 0.0;
  vec2 p = pos.xz + r.xz * ((uCeil - pos.y) / r.y);
  vec2 c = abs(fract(p / vec2(4.0, 3.0)) - 0.5) * vec2(4.0, 3.0);
  return smoothstep(0.35, 0.28, c.y) * smoothstep(1.25, 1.1, c.x);
}

void main(){
  vec3 V = normalize(uCam - vW);
  vec2 g = waves(vW.xz, uTime) + waves(vW.xz * 1.9 + 3.0 + vec2(0.35, 0.2) * uTime, -uTime * 0.8) * 0.8 + ripples(vW.xz, uTime);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float cosv = max(dot(N, V), 0.0);
  float fres = 0.2 + 0.8 * pow(1.0 - cosv, 4.0); // el agua refleja la sala también mirando desde arriba
  // lo que hay debajo, sin refracción de verdad: el suelo se desplaza un poco con la pendiente y se tiñe con la profundidad
  vec3 dir = refract(-V, N, 0.75);
  float depth = uDeep + 0.0;
  vec2 fp = vW.xz + dir.xz / max(-dir.y, 0.2) * depth;
  float cs = caustic(fp, uTime);
  vec3 tile = vec3(0.74, 0.90, 0.76) * (0.82 + 0.18 * step(0.5, hash(floor(fp * 2.0))));
  vec3 under = tile * (0.5 + 1.3 * cs);
  float k = 1.0 - exp(-depth * 0.9);
  vec3 body = mix(under, vec3(0.06, 0.42, 0.27), k * 0.75);
  // espuma / borde de la piscina y brillo del neón en el reflejo
  vec2 e = uHalf - abs(vW.xz);
  float foam = smoothstep(0.35, 0.0, min(e.x, e.y)) * (0.5 + 0.5 * sin(uTime * 1.3 + vW.x * 3.0 + vW.z * 2.0));
  // reflejo planar: la sala vista desde debajo del agua (media resolución), desplazada por la pendiente de las ondas
  vec3 refl = texture2DProj(tDiffuse, vec4(vUv.xy + N.xz * 0.09 * vUv.w, vUv.zw)).rgb;
  vec3 col = mix(body, refl, clamp(fres * 1.05, 0.0, 0.95)) + foam * 0.25;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

/** Baldosas blancas de cuarzo, `tile` metros de lado: color, relieve (bump) y rugosidad (junta mate, baldosa pulida) del mismo dibujo. Regulares o irregulares (mosaico). */
export function tiles(tile: number, irregular: boolean | number, gloss: boolean, hue: [number, number, number] = [238, 242, 239]) {
  const lv = irregular === true ? 1 : irregular || 0, N = 8, S = 512, T = S / N, mk = () => Object.assign(document.createElement('canvas'), { width: S, height: S });
  const cc = mk(), cb = mk(), cr = mk(), x = cc.getContext('2d')!, xb = cb.getContext('2d')!, xr = cr.getContext('2d')!;
  let r = 777;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  x.fillStyle = 'rgb(196,203,200)'; // junta
  x.fillRect(0, 0, S, S);
  xb.fillStyle = '#000'; // en el relieve la junta es el hueco
  xb.fillRect(0, 0, S, S);
  xr.fillStyle = 'rgb(170,170,170)'; // y la más rugosa
  xr.fillRect(0, 0, S, S);
  const rough = gloss ? 24 : 153;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const k = 0.965 - lv * 0.065 + rnd() * (0.035 + lv * 0.065);
    const jit = 0.14 * lv, gap = 1.5 + rnd() * 2.5 * lv;
    const cx = (i + 0.5) * T + (rnd() - 0.5) * T * jit * 2, cy = (j + 0.5) * T + (rnd() - 0.5) * T * jit * 2;
    const sw = (T - gap * 2) * (1 - rnd() * 0.2 * lv), sh = (T - gap * 2) * (1 - rnd() * 0.2 * lv);
    const rot = (rnd() - 0.5) * 0.12 * lv, hv = 175 + rnd() * (25 + 30 * lv); // cada baldosa a su altura
    for (const [ctx, kind] of [[x, 0], [xb, 1], [xr, 2]] as const) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      if (kind === 1) {
        // cara ligeramente abombada: borde más bajo (bisel) y centro alto
        const g = xb.createRadialGradient(0, 0, 0, 0, 0, Math.max(sw, sh) * 0.72);
        g.addColorStop(0, `rgb(${hv | 0},${hv | 0},${hv | 0})`);
        g.addColorStop(0.75, `rgb(${hv * 0.9 | 0},${hv * 0.9 | 0},${hv * 0.9 | 0})`);
        g.addColorStop(1, `rgb(${hv * 0.55 | 0},${hv * 0.55 | 0},${hv * 0.55 | 0})`);
        ctx.fillStyle = g;
        ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
      } else if (kind === 2) {
        ctx.fillStyle = `rgb(${rough},${rough},${rough})`;
        ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
      } else {
        ctx.beginPath();
        ctx.rect(-sw / 2, -sh / 2, sw, sh);
        ctx.clip();
        ctx.fillStyle = `rgb(${hue[0] * k | 0},${hue[1] * k | 0},${hue[2] * k | 0})`;
        ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
        const g = ctx.createLinearGradient(-sw / 2, -sh / 2, sw / 2, sh / 2);
        g.addColorStop(0, 'rgba(255,255,255,0.5)');
        g.addColorStop(1, 'rgba(225,232,230,0.25)');
        ctx.fillStyle = g;
        ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(-sw / 2, (rnd() - 0.5) * sh);
        ctx.quadraticCurveTo((rnd() - 0.5) * sw, (rnd() - 0.5) * sh, sw / 2, (rnd() - 0.5) * sh);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  const make = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.repeat.set(1 / (tile * N), 1 / (tile * N)); // UV en metros (ver quad): el tamaño de la baldosa no depende de la superficie
    return t;
  };
  return { map: make(cc, true), bump: make(cb, false), rough: make(cr, false) };
}

export class PoolTest {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private water: THREE.ShaderMaterial;
  private rip = Array.from({ length: NRIP }, () => new THREE.Vector4(0, 0, -99, 0));
  private ri = 0;
  private stepT = 0;
  private t = 0;
  private owned: { dispose(): void }[] = [];
  private px = -(PW / 2 + 3);
  private pz = 0;
  private py = 0;
  private yaw = -Math.PI / 2;
  private pitch = 0;

  constructor(aspect: number, renderer: THREE.WebGLRenderer) {
    this.camera = new THREE.PerspectiveCamera(settings.fov, aspect, 0.05, 60);
    const sc = this.scene, own = <T extends { dispose(): void }>(o: T) => (this.owned.push(o), o);
    sc.background = new THREE.Color(0xc4cec8);
    sc.fog = new THREE.FogExp2(0xc4cec8, 0.006);
    sc.add(new THREE.HemisphereLight(0xf4f7f4, 0xb9c2bc, 0.55));
    // luminarias del techo (se ven y se reflejan) y las luces que dan los brillos en suelo y paredes
    const fm = own(new THREE.MeshBasicMaterial({ color: 0xffffff })), fg = own(new THREE.BoxGeometry(3, 0.08, 0.6));
    for (const x of [-9, -3, 3, 9]) for (const z of [-9, -3, 3, 9]) {
      const f = new THREE.Mesh(fg, fm);
      f.position.set(x, HT - 0.04, z);
      sc.add(f);
    }
    for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6], [0, 0]]) {
      const l = new THREE.PointLight(0xfff6e8, 9, 16, 1.5);
      l.position.set(x, HT - 0.8, z);
      sc.add(l);
    }
    // entorno para los reflejos: una caja con tubos de neón cálidos, horneada una vez (PMREM)
    const env = new THREE.Scene(), em = own(new THREE.MeshBasicMaterial({ color: 0x8f9892, side: THREE.BackSide }));
    env.add(new THREE.Mesh(own(new THREE.BoxGeometry(30, 10, 30)), em));
    const nm = own(new THREE.MeshBasicMaterial({ color: 0xfffaea })), ng = own(new THREE.BoxGeometry(3.4, 0.1, 0.7));
    for (const x of [-9, -3, 3, 9]) for (const z of [-9, -3, 3, 9]) { const n = new THREE.Mesh(ng, nm); n.position.set(x, 4.8, z); env.add(n); }
    const gen = new THREE.PMREMGenerator(renderer);
    sc.environment = gen.fromScene(env, 0.04).texture;
    gen.dispose();

    const mat = (tile: number, irregular: boolean | number, gloss = true, bump = 2.2) => {
      const t = tiles(tile, irregular, gloss);
      own(t.map), own(t.bump), own(t.rough);
      return own(new THREE.MeshPhysicalMaterial({ map: t.map, bumpMap: t.bump, bumpScale: gloss ? bump : 0.8, roughnessMap: t.rough, roughness: 1, metalness: 0, clearcoat: gloss ? 1 : 0, clearcoatRoughness: 0.05, envMapIntensity: gloss ? 1.7 : 0.3 }));
    };
    const quad = (w: number, h: number, m: THREE.Material, x: number, y: number, z: number, rx: number, ry: number) => {
      const o = new THREE.Mesh(own(new THREE.PlaneGeometry(w, h)), m);
      o.position.set(x, y, z);
      o.rotation.set(rx, ry, 0);
      o.updateMatrixWorld();
      // UV planar en metros del mundo: mismas baldosas en todas las superficies, vengan del tamaño que vengan, y sin cortes entre trozos
      const pos = o.geometry.attributes.position, uv = o.geometry.attributes.uv, p = new THREE.Vector3(), flat = Math.abs(rx) > 0.1, alongX = Math.abs(Math.sin(ry)) < 0.5;
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        uv.setXY(i, flat ? p.x : alongX ? p.x : p.z, flat ? p.z : p.y);
      }
      sc.add(o);
      return o;
    };
    const wall = mat(0.12, 0, true, 4.5); // paredes y columnas: mosaico totalmente regular (aprobado) con relieve marcado
    // suelo de cubierta en 4 trozos alrededor del hueco de la piscina (así no hay que cortar el plano)
    const deck = mat(0.18, false);
    const bx = PW / 2, bz = PD / 2;
    quad(W, D / 2 - bz, deck, 0, 0, -(D / 4 + bz / 2), -Math.PI / 2, 0);
    quad(W, D / 2 - bz, deck, 0, 0, D / 4 + bz / 2, -Math.PI / 2, 0);
    quad(W / 2 - bx, PD, deck, -(W / 4 + bx / 2), 0, 0, -Math.PI / 2, 0);
    quad(W / 2 - bx, PD, deck, W / 4 + bx / 2, 0, 0, -Math.PI / 2, 0);
    quad(W, D, mat(0.16, false, false), 0, HT, 0, Math.PI / 2, 0); // techo
    quad(W, HT, wall, 0, HT / 2, -D / 2, 0, 0);
    quad(W, HT, wall, 0, HT / 2, D / 2, 0, Math.PI);
    quad(D, HT, wall, -W / 2, HT / 2, 0, 0, Math.PI / 2);
    quad(D, HT, wall, W / 2, HT / 2, 0, 0, -Math.PI / 2);
    // la cubeta: fondo y 4 paredes hacia dentro
    const pm = mat(0.1, true);
    quad(PW, PD, pm, 0, -DEEP, 0, -Math.PI / 2, 0);
    for (const [x, z, ry, w] of [[0, -bz, 0, PW], [0, bz, Math.PI, PW], [-bx, 0, Math.PI / 2, PD], [bx, 0, -Math.PI / 2, PD]] as const) quad(w, DEEP, pm, x, -DEEP / 2, z, 0, ry);
    // columnas
    const col = wall, cg = own(new THREE.CylinderGeometry(0.45, 0.45, HT, 32));
    {
      // UV en metros también en la columna; la vuelta entera es un número exacto de periodos de la textura para que no haya costura
      const per = 0.12 * 8, turns = Math.round((2 * Math.PI * 0.45) / per), uv = cg.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * turns * per, uv.getY(i) * HT);
    }
    for (const x of [-9, 9]) for (const z of [-11, -4, 4, 11]) {
      const c = new THREE.Mesh(cg, col);
      c.position.set(x, HT / 2, z);
      sc.add(c);
    }

    // el agua: el Reflector de three pinta la sala reflejada (media resolución, sin MSAA) y nuestro shader lo mezcla con el fondo
    const shader = {
      name: 'PoolWater',
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
        uTime: { value: 0 }, uRip: { value: this.rip }, uCam: { value: new THREE.Vector3() }, uHalf: { value: new THREE.Vector2(bx, bz) }, uDeep: { value: DEEP + SURF }, uCeil: { value: HT },
      }]),
      vertexShader: vert,
      fragmentShader: frag,
    };
    const dpr = Math.min(devicePixelRatio, 1080 / Math.max(renderer.domElement.clientHeight, 1));
    const rf = new Reflector(new THREE.PlaneGeometry(PW, PD), {
      textureWidth: Math.max(256, Math.floor(renderer.domElement.clientWidth * dpr * 0.5)),
      textureHeight: Math.max(256, Math.floor(renderer.domElement.clientHeight * dpr * 0.5)),
      clipBias: 0.003, multisample: 0, shader,
    });
    this.water = rf.material as THREE.ShaderMaterial;
    this.water.fog = true;
    rf.position.set(0, SURF, 0);
    rf.rotation.x = -Math.PI / 2;
    sc.add(rf);
    own(rf);
  }

  private inPool(x: number, z: number) {
    return Math.abs(x) < PW / 2 - 0.2 && Math.abs(z) < PD / 2 - 0.2;
  }

  /** Una onda nueva en (x, z): anillo circular que se abre. */
  splash(x: number, z: number, amp: number) {
    this.rip[this.ri].set(x, z, this.t, amp);
    this.ri = (this.ri + 1) % NRIP;
  }

  update(dt: number, c: Controls) {
    this.t += dt;
    this.yaw -= c.look.x;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - c.look.y));
    const sp = (c.run ? 5 : 2.8) * (this.inPool(this.px, this.pz) ? 0.7 : 1);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = -fz, rz = fx;
    const mx = (fx * c.move.y + rx * c.move.x) * sp * dt, mz = (fz * c.move.y + rz * c.move.x) * sp * dt;
    const was = this.inPool(this.px, this.pz);
    this.px = THREE.MathUtils.clamp(this.px + mx, -W / 2 + 0.5, W / 2 - 0.5);
    this.pz = THREE.MathUtils.clamp(this.pz + mz, -D / 2 + 0.5, D / 2 - 0.5);
    const pool = this.inPool(this.px, this.pz);
    if (pool !== was) this.splash(this.px, this.pz, 1.3); // entrar o salir
    const speed = Math.hypot(mx, mz) / Math.max(dt, 1e-4);
    this.stepT -= dt;
    if (pool && speed > 0.4 && this.stepT <= 0) (this.stepT = speed > 4 ? 0.2 : 0.38), this.splash(this.px, this.pz, speed > 4 ? 1 : 0.55);
    this.py += ((pool ? -DEEP : 0) - this.py) * Math.min(1, dt * 8);
    this.camera.position.set(this.px, this.py + EYE, this.pz);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.water.uniforms.uTime.value = this.t;
    this.water.uniforms.uCam.value.copy(this.camera.position);
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.owned.forEach((o) => o.dispose());
    this.scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
  }
}

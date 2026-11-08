// Empaqueta las animaciones FBX de Mixamo (assets-src/animations/player/ o client/public/animations/player/, ~10 MB cada una por las
// texturas incrustadas) en un solo paquete compacto que carga el juego: player.pack.json (índice) + player.pack.bin.
//   · cada clip se remuestrea a 30 fps; solo van los huesos que animan (cuaterniones en int16) y la posición de la cadera (float32)
//   · se guarda cuánto avanza la cadera por segundo (para sincronizar pasos) y la altura de la cadera en reposo (para escalar)
//   · es incremental: lo ya leído se guarda en node_modules/.cache/anim-pack y solo se vuelven a leer los FBX nuevos o cambiados
// Uso: node tools/anim_pack.mjs
// En desarrollo y al compilar lo lanza solo el plugin `animPack` de client/vite.config.ts (y en desarrollo vigila la carpeta: soltar un FBX
// nuevo ahí basta; Anim Studio lo recoge sin recargar). Sin carpeta de FBX no hace nada (se queda el paquete que haya).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'assets-src/animations/player');
const dir = fs.existsSync(src) ? src : path.join(root, 'client/public/animations/player');
const out = path.join(root, 'client/public/animations');
const cacheDir = path.join(root, 'node_modules/.cache/anim-pack');
const FPS = 30;

if (!fs.existsSync(dir)) {
  console.log('anim_pack: no hay carpeta de FBX, se deja el paquete como está');
  process.exit(0);
}
fs.mkdirSync(cacheDir, { recursive: true });
const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.fbx')).sort();

// el orden de los huesos se mantiene entre ejecuciones (los clips ya empaquetados y la caché dependen de él)
let bones = [];
try {
  bones = JSON.parse(fs.readFileSync(path.join(out, 'player.pack.json'), 'utf8')).bones ?? [];
} catch {
  /* primera vez */
}
const boneIdx = (n) => {
  let i = bones.indexOf(n);
  if (i < 0) (i = bones.length), bones.push(n);
  return i;
};

let THREE, FBXLoader;
const loadLibs = async () => {
  if (FBXLoader) return;
  globalThis.window = { URL };
  globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_v) {}, style: {} }) };
  ({ FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js'));
  THREE = await import('three');
  const warn = console.warn;
  console.warn = (m, ...a) => (String(m).includes('skinning weights') ? 0 : warn(m, ...a)); // aviso inofensivo del FBXLoader
};

/** Lee un FBX y devuelve el clip remuestreado (huesos por nombre, para no depender del orden global). */
async function parse(file) {
  await loadLibs();
  const buf = fs.readFileSync(file);
  const o = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const clip = o.animations[0];
  if (!clip) return null;
  let hipsBindY = 0;
  o.traverse((x) => x.name === 'mixamorigHips' && (hipsBindY = x.position.y));
  const dur = clip.duration, n = Math.max(2, Math.round(dur * FPS) + 1);
  const names = [], qs = [];
  let hips = null;
  for (const t of clip.tracks) {
    const m = /^mixamorig(.+)\.(quaternion|position)$/.exec(t.name);
    if (!m) continue;
    const it = t.createInterpolant();
    if (m[2] === 'position') {
      if (m[1] !== 'Hips') continue;
      hips = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) hips.set(it.evaluate(Math.min(dur, i / FPS)), i * 3);
      continue;
    }
    const q = new Int16Array(n * 4), prev = new THREE.Quaternion(), cur = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      cur.fromArray(it.evaluate(Math.min(dur, i / FPS))).normalize();
      if (i && cur.dot(prev) < 0) (cur.x *= -1), (cur.y *= -1), (cur.z *= -1), (cur.w *= -1); // mismo hemisferio: la interpolación va por el camino corto
      prev.copy(cur);
      for (let k = 0; k < 4; k++) q[i * 4 + k] = Math.round(cur.toArray()[k] * 32767);
    }
    names.push(m[1]);
    qs.push(q);
  }
  const all = new Int16Array(qs.length * n * 4);
  qs.forEach((q, i) => all.set(q, i * n * 4));
  const speed = hips ? Math.hypot(hips[(n - 1) * 3] - hips[0], hips[(n - 1) * 3 + 2] - hips[2]) / dur : 0;
  const b64 = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
  return { dur: +dur.toFixed(4), n, names, speed: +speed.toFixed(3), hipsBindY, q: b64(all), hips: hips ? b64(hips) : null };
}

const chunks = [];
let size = 0;
const put = (buf) => {
  const pad = (4 - (size % 4)) % 4;
  if (pad) (chunks.push(Buffer.alloc(pad)), (size += pad));
  const off = size;
  chunks.push(buf);
  size += buf.length;
  return off;
};

const clips = {};
let hipsBindY = 0, fresh = 0;
for (const f of files) {
  const file = path.join(dir, f), st = fs.statSync(file), name = path.basename(f, path.extname(f)), sig = `${st.size}-${Math.round(st.mtimeMs)}`;
  const cf = path.join(cacheDir, name.replace(/[^\w.-]/g, '_') + '.json');
  let c;
  try {
    c = JSON.parse(fs.readFileSync(cf, 'utf8'));
    if (c.sig !== sig) c = undefined;
  } catch {
    /* sin caché */
  }
  if (!c) {
    let p;
    try {
      p = await parse(file);
    } catch (e) {
      console.warn("no se pudo leer (¿se está copiando aún?):", f, e.message);
      continue;
    }
    if (!p) {
      console.warn('sin animación:', f);
      continue;
    }
    c = { sig, ...p };
    fs.writeFileSync(cf, JSON.stringify(c));
    fresh++;
    console.log('nuevo/cambiado:', name.padEnd(34), `${c.dur.toFixed(2)}s`, `${c.names.length} huesos`);
  }
  if (!hipsBindY) hipsBindY = c.hipsBindY;
  const qb = c.names.map(boneIdx);
  clips[name] = { dur: c.dur, n: c.n, bones: qb, q: put(Buffer.from(c.q, 'base64')), hips: c.hips ? put(Buffer.from(c.hips, 'base64')) : -1, speed: c.speed };
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'player.pack.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(out, 'player.pack.json'), JSON.stringify({ fps: FPS, hipsBindY: +hipsBindY.toFixed(3), bones, clips }));
console.log(`anim_pack: ${Object.keys(clips).length} clips (${fresh} leídos de nuevo), ${bones.length} huesos, ${(size / 1e6).toFixed(2)} MB`);

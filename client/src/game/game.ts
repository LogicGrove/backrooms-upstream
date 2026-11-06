import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { compileGently } from './compile';
import { CELL, generateMaze } from './maze';
import { World, center } from './world';
import { Input } from './input';
import { Player } from './player';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FilmShader, VhsShader } from './vhsPass';
import { GameAudio } from './audio';
import { Items, type Target } from './items';
import { Entity, type Kind } from './entity';
import { Shatter } from './shatter';
import { TvRoom } from './tvRoom';
import { unlock } from '../achievements';
import { Remote } from './remote';
import { WaitingRoom } from './waiting';
import { holdStill } from './still';
import { netStats, type Sock } from '../net';
import { worldTl } from './interp';
import { Breath, DEFAULT_LOOK, type Look, hideStates, tickHides, type HideState, type PlayerState, type RoomView, type WorldSnapshot } from '@backrooms/shared';

/** Lo que el juego necesita de una sala: el socket y quién soy. */
export interface Mp {
  sock: Sock;
  id: string;
  /** Segundos de luz de cada linterna (según la dificultad de la sala). */
  life?: number;
  /** Jugadores al empezar: de ellos depende cuántos recursos hay en el suelo (lo mismo calcula el servidor). */
  players?: number;
}

/** Lo que enseña el inventario. */
export interface Inv {
  hand: 'none' | 'camera' | 'gun';
  left: 'none' | 'flashlight';
  belt: 'none' | 'camera' | 'gun';
  stamina: number;
  sanity: number;
  escaped: boolean;
  camera: boolean;
  gun: boolean;
  ammo: number;
  spare: number;
  tapes: number;
  photos: number;
  thumbs: string[];
  /** Las mismas fotos en grande (para el zoom y la descarga). */
  full: string[];
  flashOn: boolean;
  battery: number; // la camcorder
  charge: number; // lo que le queda a la linterna (0–1)
  spares: number; // linternas de repuesto en la mochila
}

/** Lo que el OSD enseña, leído desde React diez veces por segundo. */
export interface Hud {
  bag: boolean;
  hint: string | null;
  inv: Inv;
  aiming: boolean;
  zoom: number;
  focus: boolean;
  tapes: number;
  photos: number;
  ammo: number | null; // en el cargador; null sin el rifle
  spare: number;
  battery: number; // 0–1
  time: number; // segundos de grabación
  /** En una sala, muerto: el nombre del compañero por cuyos ojos se mira (vacío si no queda ninguno). */
  spectating: string | null;
  /** Espectador: los compañeros (el que se mira, marcado), si están vivos, y desde dónde se mira. */
  watchList?: { name: string; on: boolean; dead: boolean }[];
  specView?: 'eyes' | 'chase';
  /** Cerca de un nicho y mirándolo: «E HIDE»; escondido: «E LEAVE». */
  hide: 'hide' | 'leave' | null;
  /** Escondido: el aire (0–1), si una entidad lo inspecciona (hay que mantener Space) y si lo contiene. */
  breath: { air: number; warn: boolean; held: boolean } | null;
}

const _spec = new THREE.Vector3(), _want = new THREE.Vector3(), _none = new THREE.Vector2();

/*
 * Las backrooms: el juego de juegos/backrooms.exe. Sin React; el caparazón (Backrooms.tsx) lo carga,
 * lo arranca y lee su estado para el OSD.
 */

const DIR = '/models/backrooms/';
export const MODELS = ['hazmat', 'bacteria', 'partygoer', 'balloon', 'camcorder', 'vhs', 'gun', 'flashlight', 'elevator', 'vent', 'socket', 'exit', 'door', 'armchair'] as const;
export type ModelName = (typeof MODELS)[number];
export const TEXTURES = ['wall', 'carpet', 'ceiling'] as const;

export interface Assets {
  gltf: Record<ModelName, GLTF>;
  tex: Record<(typeof TEXTURES)[number], THREE.Texture>;
}

/** Descarga todo, con el progreso en bytes (aproximado: lo que diga cada respuesta). */
export async function loadAssets(progress: (f: number) => void): Promise<Assets> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const urls = [...MODELS.map((m) => DIR + m + '.glb'), ...TEXTURES.map((t) => DIR + 'tex/' + t + '.webp')];  const got = new Map<string, number>(), total = new Map<string, number>();
  const tick = () => {
    let a = 0, b = 0;
    for (const u of urls) {
      const t = total.get(u) ?? 1;
      b += t;
      a += Math.min(t, got.get(u) ?? 0);
    }
    progress(a / b);
  };
  const on = (u: string) => (e: ProgressEvent) => {
    if (e.lengthComputable) total.set(u, e.total);
    got.set(u, e.loaded);
    tick();
  };
  const gltf = {} as Assets['gltf'], tex = {} as Assets['tex'];
  const tl = new THREE.TextureLoader();
  await Promise.all([
    ...MODELS.map((m) => loader.loadAsync(DIR + m + '.glb', on(DIR + m + '.glb')).then((g) => void (gltf[m] = g))),
    ...TEXTURES.map((t) =>
      tl.loadAsync(DIR + 'tex/' + t + '.webp').then((x) => {
        x.wrapS = x.wrapT = THREE.RepeatWrapping;
        x.colorSpace = THREE.SRGBColorSpace;
        x.anisotropy = 4;
        tex[t] = x;
        got.set(DIR + 'tex/' + t + '.webp', 1);
        tick();
      }),
    ),
  ]);
  // sin mapa de entorno un metal puro (metalness 1, el valor por defecto de glTF) no refleja nada y se ve gris o negro:
  // las piezas del suelo (cinta, rifle, linterna, globo) se quedan con un poco de metal y su color propio
  for (const m of ['vhs', 'gun', 'flashlight', 'balloon'] as const)
    gltf[m].scene.traverse((o) => {
      const k = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (k?.isMeshStandardMaterial) k.metalness = Math.min(k.metalness, 0.25);
    });
  return { gltf, tex };
}

/**
 * El juego. `load` lo descarga todo y compila los materiales con un laberinto de prueba (los de cada
 * partida comparten programas: no se vuelve a compilar al darle a Play); `start` monta una partida.
 */
export class BackroomsGame {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
  assets?: Assets;
  world?: World;
  // las luces, siempre las mismas (cambiar cuántas hay recompilaría todo): el cielo, la linterna y
  // cuatro puntos que se van a las lámparas más cercanas
  // (la luz del mapa va horneada: ver lightmap.ts; estas alumbran a los personajes y lo que se recoge)
  readonly hemi = new THREE.HemisphereLight(0xfff1c4, 0x3a2c0c, 0.16);
  readonly flash = new THREE.SpotLight(0xfff6e0, 0, 14, 0.45, 0.5, 1.6);
  readonly points = Array.from({ length: 4 }, () => new THREE.PointLight(0xffefc6, 3, 7, 1.8));
  private clock = new THREE.Clock(false);
  private t = 0;
  readonly input: Input;
  readonly composer: EffectComposer;
  readonly vhs = new ShaderPass(VhsShader);
  readonly film = new ShaderPass(FilmShader);
  // el polvo del aire: una caja de 8 m que va con la cámara (cada mota da la vuelta al salirse); brilla
  // dentro del haz de la linterna y apenas se ve fuera
  private dust = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(Array.from({ length: 1600 * 3 }, () => Math.random() * 8), 3)),
    new THREE.ShaderMaterial({
      uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBeam: { value: 1 }, uPx: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform vec3 uCam;
        uniform float uTime, uBeam, uPx;
        varying float vA;
        void main() {
          // a la deriva, lenta, y siempre en una caja de 8 m centrada en la cámara
          vec3 p = position + vec3(sin(uTime * 0.13 + position.y) * 0.4, -uTime * 0.03, cos(uTime * 0.11 + position.x) * 0.4);
          p = mod(p - uCam + 4.0, 8.0) - 4.0 + uCam;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = length(mv.xyz);
          // el haz: el cono de la linterna (mira al frente desde la cámara), más fuerte cerca
          float beam = smoothstep(0.86, 0.97, dot(normalize(mv.xyz), vec3(0.0, -0.05, -1.0))) * uBeam * smoothstep(7.0, 1.0, d);
          // cada mota con su tamaño y su brillo, y un centelleo lento: unas pocas se ven siempre, flotando en la luz
          float h = fract(sin(dot(position, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float tw = 0.65 + 0.35 * sin(uTime * (0.6 + h * 1.4) + h * 40.0);
          vA = (0.03 + 0.5 * beam) * (0.45 + h) * tw;
          gl_PointSize = uPx * (0.6 + h * 1.0) / max(d, 1.2); // las de muy cerca, no como pelotas
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vec3(1.0, 0.93, 0.78) * vA * smoothstep(0.5, 0.1, r), 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  audio?: GameAudio;
  private stepAcc = 0;
  corruption = 0;
  player?: Player;
  items?: Items;
  onWin?: () => void;
  private black = 0;
  private winning = false;
  entities: Entity[] = [];
  private shatters: Shatter[] = [];
  private balloons: THREE.Object3D[] = [];
  /** Segundos desde que se muere (-1: vivo). */
  private dying = -1;
  private killer?: Entity;
  // la sala
  mp?: Mp;
  private remotes = new Map<string, Remote>();
  private spare: Remote[] = [];
  /** El aspecto de cada jugador de la sala (lo manda el servidor con la sala). */
  private looks = new Map<string, Look>();
  private entMap = new Map<number, Entity>();
  private offNet: (() => void)[] = [];
  private sendT = 0;
  private lastFrame = 0;
  private spectating = false;
  private watching = '';
  private specView: 'eyes' | 'chase' = 'eyes';
  private specPos = new THREE.Vector3();
  private god = false;
  // los escondites (nichos de las paredes): en solitario los lleva la sim de las entidades; en una sala, el servidor
  private hides: HideState[] = [];
  private hideIdx = -1;
  private breath = new Breath();
  private holding = false;
  private inspected = false;
  private noise = 0;
  onDeath?: () => void;
  private snap?: THREE.WebGLRenderTarget;
  // la camcorder que sale volando al morir: la vista es ella
  private fly?: { pos: THREE.Vector3; vel: THREE.Vector3; q: THREE.Quaternion; spin: THREE.Vector3; bounced: boolean };
  onPause?: () => void;
  private offs: (() => void)[] = [];
  private paused = false;
  bagOpen = false;
  // la sala de la tele, mientras carga
  tv?: TvRoom;
  private tvProgress = 0;
  tvFailed = false;
  private tvDone?: () => void;
  private froze = false;
  // la sala de espera (ver waiting.ts): su escena sustituye a la del juego en el compositor mientras se está en el lobby
  waiting?: WaitingRoom;
  private waitTok = 0;
  private waitMp?: Mp;
  private waitPhase = '';
  private offWait: (() => void)[] = [];
  private fadeIn = 0;
  /** El ordenador de la sala de espera se abre o se cierra (lo oye el caparazón para sacar la pantalla de ajustes). */
  onWaitComputer?: (open: boolean) => void;
  /** Escenas prerenderizadas para la nieve del menú: cada una, unos fotogramas de una sala con entidades bailando (ver prerender). */
  stills: HTMLCanvasElement[][] = [];
  /** Sin sonido (lo decide el menú; se aplica al crear el audio si aún no existe). */
  muted = false;
  /** El volumen general de los ajustes (0–1). */
  volume = 1;

  constructor(readonly canvas: HTMLCanvasElement, readonly opts: { low: boolean; reduced: boolean }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.72; // sin la cinta encima, el amarillo quema
    // la sombra de la linterna, solo en escritorio
    this.renderer.shadowMap.enabled = !opts.low;
    this.flash.castShadow = !opts.low;
    this.flash.shadow.mapSize.set(512, 512);
    this.flash.shadow.camera.near = 0.2;
    this.flash.shadow.bias = -0.002;
    this.input = new Input(canvas);
    // la imagen: escena, el halo de los fluorescentes (no en calidad baja), color de pantalla, el grano y,
    // mirando por la cámara, la cinta encima
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (!opts.low) this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.92));
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.film);
    this.composer.addPass(this.vhs);
    this.film.uniforms.uMove.value = opts.reduced ? 0 : 1;
    const u = this.vhs.uniforms;
    u.uMove.value = opts.reduced ? 0 : 1;
    u.uLow.value = opts.low ? 1 : 0;
    u.tPrev.value = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    u.tPrev.value.needsUpdate = true;
    this.scene.background = new THREE.Color(0x17130a);
    this.scene.fog = new THREE.Fog(0x17130a, 2.5, 19);
    this.scene.add(this.hemi, this.camera, this.dust, ...this.points);
    this.dust.frustumCulled = false;
    this.camera.add(this.flash, this.flash.target);
    // sale de la lente de la linterna (en la mano izquierda), hacia el centro de la vista
    this.flash.position.set(-0.13, -0.16, -0.5);
    this.flash.target.position.set(0, -0.3, -6);
    const resize = () => {
      // como mucho a 1080 líneas (y a la mitad en calidad baja): el grano y la cinta lo ablandan igual
      const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight, pr = Math.min(devicePixelRatio, 1080 / h) * (opts.low ? 0.6 : 1);
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(w, h, false);
      this.composer?.setPixelRatio(pr);
      this.composer?.setSize(w, h);
      this.vhs?.uniforms.uRes.value.set(w * pr, h * pr);
      if (this.vhs) this.vhs.uniforms.uAspect.value = w / h;
      this.film?.uniforms.uRes.value.set(w * pr, h * pr);
      this.tv?.resize(w / h);
      this.waiting?.resize(w / h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (this.paused) this.composer?.render(0); // el lienzo se borra al cambiar de tamaño: que la pausa no quede en negro
    };
    resize();
    addEventListener('resize', resize);
    this.offs.push(() => removeEventListener('resize', resize));
  }

  /** Quitar o devolver el sonido (vale también antes de empezar: se aplica al crear el audio). */
  setVolume(v: number) {
    this.volume = v;
    this.audio?.setVolume(v);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.audio?.setMuted(m);
  }

  /** La sala de la tele: se pinta sola mientras carga (ver load) hasta que nos metemos dentro (diveIntoTv). */
  showTv() {
    const tv = (this.tv = new TvRoom(this.opts.reduced));
    tv.resize(this.camera.aspect);
    this.clock.start();
    const rp = this.composer.passes[0] as RenderPass, u = this.vhs.uniforms;
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.t += dt;
      tv.update(dt, this.t, this.tvProgress, this.tvFailed);
      // la sala de la tele pasa por el compositor: bloom en la pantalla, grano y la cinta encima, que se rompe al meterse
      // (y todo vuelve a como estaba: la carga compila con el compositor del juego entre fotograma y fotograma)
      const was = [this.vhs.enabled, u.uAspect.value] as const;
      rp.scene = tv.scene;
      rp.camera = tv.camera;
      this.vhs.enabled = true;
      u.uAspect.value = 1;
      u.uTime.value = this.film.uniforms.uTime.value = this.t;
      u.uCorrupt.value = tv.progress ** 2 * 0.85;
      u.uBlack.value = Math.max(0, 1 - tv.age / 1.4);
      this.composer.render(dt);
      rp.scene = this.scene;
      rp.camera = this.camera;
      this.vhs.enabled = was[0];
      u.uAspect.value = was[1];
      u.uCorrupt.value = u.uBlack.value = 0;
      if (this.tvDone && tv.near && tv.dive(dt, this.opts.reduced ? 0.2 : 1.3)) {
        this.renderer.setAnimationLoop(null);
        tv.dispose();
        this.tv = undefined;
        this.t = 0;
        this.tvDone();
      }
    });
  }

  /** Meterse en la tele (resuelve cuando la pantalla llena la vista). */
  diveIntoTv() {
    return new Promise<void>((r) => (this.tv ? (this.tvDone = r) : r()));
  }

  async load(progress: (f: number) => void) {
    const report = progress;
    progress = (f) => ((this.tvProgress = f), report(f));
    this.assets = await loadAssets((f) => progress(f * 0.8));
    // compilar con un laberinto cualquiera y el jugador con todo en las manos, en la pantalla de carga
    // (en Firefox, sin paralelo, es lento)
    const w = new World(generateMaze(1), this.assets), p = new Player(w, this.assets, this.camera, this.flash, true);
    for (const it of Object.values(p.items)) it.visible = true;
    this.scene.add(w.root);
    p.spawn(center(w.maze.start), 0);
    p.update(0, this.input.read());
    // las dos entidades (con piel) y sus trozos al reventar (sin piel)
    const es = (['bacteria', 'partygoer'] as Kind[]).map((k, i) => new Entity(k, w, this.assets!, w.maze.spawns[i] ?? w.maze.start));
    es.forEach((e) => e.update(0, p.pos, this.camera.position, null, true, true));
    w.root.add(Shatter.warm(es.map((e) => e.rig.root)));
    new Items(w, this.assets, p, this.camera); // y lo que se recoge (cintas, cámara y rifle en el suelo)
    await compileGently(this.renderer, this.scene, this.camera, undefined, (f) => progress(0.8 + f * 0.2));
    // y las pasadas (con todo lo de antes ya compilado): con y sin VHS, que la última pinta a pantalla y es otro programa
    this.vhs.enabled = false;
    this.composer.render(0);
    this.vhs.enabled = true;
    this.composer.render(0);
    this.stills = this.prerender(w, p, es);
    es.forEach((e) => e.dispose());
    p.dispose();
    w.dispose();
    progress(1);
  }

  /**
   * Las escenas de la nieve del menú, pintadas una vez con el mapa de prueba ya compilado: salas y pasillos
   * vistos desde el suelo, con una a tres entidades bailando; cada escena son 3 fotogramas de su baile, a
   * 320×180, que el menú saca de vez en cuando entre la nieve.
   */
  private prerender(w: World, p: Player, es: Entity[]) {
    const m = w.maze, cam = this.camera, out: HTMLCanvasElement[][] = [];
    p.rig.root.visible = false;
    for (const it of Object.values(p.items)) it.visible = false;
    this.vhs.enabled = false;
    const extra = (['bacteria', 'partygoer'] as Kind[]).map((k, i) => new Entity(k, w, this.assets!, m.spawns[i] ?? m.start));
    const pool = [...es, ...extra];
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    const free = (x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h && !!m.open[y * m.w + x] && !m.voids.some((v) => v.x === x && v.y === y);
    const du = (this.dust.material as THREE.ShaderMaterial).uniforms;
    const shoot = () => {
      const src = this.renderer.domElement, c = Object.assign(document.createElement('canvas'), { width: 320, height: 180 }), k = Math.max(320 / src.width, 180 / src.height);
      c.getContext('2d')!.drawImage(src, (320 - src.width * k) / 2, (180 - src.height * k) / 2, src.width * k, src.height * k);
      return c;
    };
    cam.fov = 70;
    cam.updateProjectionMatrix();
    for (let tries = 0; out.length < 7 && tries < 400; tries++) {
      const cx = 1 + ((Math.random() * (m.w - 2)) | 0), cy = 1 + ((Math.random() * (m.h - 2)) | 0);
      if (!free(cx, cy)) continue;
      // hacia dónde hay más sitio libre en línea recta (se quiere profundidad: un pasillo o una sala)
      let best: { d: readonly [number, number]; len: number } = { d: DIRS[0], len: 0 };
      for (const d of DIRS) {
        let len = 0;
        while (len < 8 && free(cx + d[0] * (len + 1), cy + d[1] * (len + 1))) len++;
        if (len > best.len) best = { d, len };
      }
      if (best.len < 4) continue;
      const [dx, dz] = best.d, side = new THREE.Vector3(-dz, 0, dx);
      const eye = center({ x: cx, y: cy }, 1.3).addScaledVector(new THREE.Vector3(dx, 0, dz), -0.4);
      // una tercera parte con la linterna encendida: en las zonas apagadas no se vería nada
      const lit = !!m.lit[cy * m.w + cx], torch = !lit || Math.random() < 0.3;
      const n = 1 + (Math.random() < 0.6 ? 1 : 0) + (Math.random() < 0.25 ? 1 : 0);
      const cast = [...pool].sort(() => Math.random() - 0.5);
      cast.forEach((e, i) => {
        const on = i < n;
        e.rig.root.visible = on;
        if (e.balloon) e.balloon.visible = on;
        if (!on) return;
        const dist = Math.min(2.4 + i * 1.2 + Math.random() * 0.6, best.len * CELL - 0.3);
        // en un pasillo de una celda no hay sitio para apartarse; en una sala, sí
        const wide = free(cx + dx * Math.round(dist / CELL) + (side.x ? Math.sign(side.x) : 0), cy + dz * Math.round(dist / CELL) + (side.z ? Math.sign(side.z) : 0));
        const lateral = i === 0 || !wide ? 0 : (i % 2 ? 1 : -1) * (0.45 + Math.random() * 0.3);
        e.pos.copy(eye).setY(0).addScaledVector(new THREE.Vector3(dx, 0, dz), dist).addScaledVector(side, lateral);
        e.dance(eye);
      });
      cam.position.copy(eye);
      cam.lookAt(eye.clone().add(new THREE.Vector3(dx, -0.04, dz).multiplyScalar(8)).addScaledVector(side, (Math.random() - 0.5) * 0.8));
      cam.rotateZ((Math.random() - 0.5) * 0.12);
      cam.updateMatrixWorld(true);
      this.flash.intensity = torch ? 26 : 0;
      const frames: HTMLCanvasElement[] = [];
      for (let f = 0; f < 3; f++) {
        // el baile avanza entre fotogramas (el primero, desde un punto cualquiera del clip)
        cast.slice(0, n).forEach((e) => e.update(f ? 0.16 : Math.random() * 3, eye, eye, null, false, true));
        w.update(this.t + f * 0.1, 0.1);
        w.lightsNear(cam.position).forEach((l, i) => (this.points[i].position.copy(l.pos), (this.points[i].intensity = 3 * l.level)));
        du.uCam.value.copy(cam.position);
        this.composer.render(0);
        frames.push(shoot());
      }
      out.push(frames);
    }
    extra.forEach((e) => e.dispose());
    this.flash.intensity = 0;
    return out;
  }

  start(seed: number, mp?: Mp) {
    this.fadeIn = this.waiting ? 0.9 : 0; // de la sala de espera a la partida: el negro de la entrada se abre
    this.leaveWaiting();
    this.stopMp();
    this.entities.forEach((e) => e.dispose());
    this.shatters.forEach((s) => s.dispose());
    this.shatters = [];
    this.spectating = false;
    this.player?.dispose();
    this.world?.dispose();
    this.black = 0;
    this.winning = false;
    this.dying = -1;
    this.killer = undefined;
    this.outT = -1;
    this.nextOut = 70 + Math.random() * 50;
    this.audio?.power(1);
    this.bagOpen = false;
    this.input.suspend = false;
    this.hideIdx = -1;
    this.holding = this.inspected = false;
    this.noise = 0;
    this.breath.reset();
    this.vhs.uniforms.uCorrupt.value = 0;
    // desarrollo: &god, inmortal
    this.god = !mp && process.env.NODE_ENV === 'development' && new URLSearchParams(location.search).has('god');
    const w = (this.world = new World(generateMaze(seed, mp?.players ?? 1), this.assets!));
    this.scene.add(w.root);
    const m = w.maze, s = m.start;
    this.hides = hideStates(m);
    const p = (this.player = new Player(w, this.assets!, this.camera, this.flash, this.opts.reduced));
    if (mp?.life) p.life = mp.life;
    if (mp) p.spares = 1; // en una sala cada uno empieza con una linterna de repuesto en el bolsillo
    // mirando hacia el primer lado abierto (con yaw = 0 se mira a -z)
    const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => m.open[(s.y + dy) * m.w + s.x + dx]) ?? [0, -1];
    p.spawn(center(s), Math.atan2(-side[0], -side[1]));
    p.onFall = () => {
      if (this.mp) (this.sendState(), this.mp.sock.emit('fell'));
      this.die();
    };
    this.audio ??= new GameAudio(undefined, this.muted, this.volume);
    const it = (this.items = new Items(w, this.assets!, p, this.camera, this.audio));
    it.onWin = () => this.win();
    // al empezar, una de cada: la bacteria y el partygoer, en los arranques más lejanos
    // (en una sala las lleva el servidor y llegan en el snapshot del mundo)
    this.entities = mp ? [] : (['bacteria', 'partygoer'] as Kind[]).map((k, i) => new Entity(k, w, this.assets!, m.spawns[i] ?? m.spawns[0]));
    it.targets = this.entities;
    if (mp) this.wire(mp, it);
    it.onKill = (t, from) => this.kill(t as Entity, from);
    this.input.begin();
    this.audio.start();
    this.t = 0;
    this.paused = false;
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.lastFrame = performance.now();
    // en una sala la pausa no detiene el mundo (los demás siguen jugando): solo se sueltan los mandos
    if (this.paused && !this.mp) return;
    const c = this.input.read();
    // el inventario: E lo abre y lo cierra (Escape también lo cierra, sin pausar)
    if (this.dying < 0 && !this.winning && c.bag) {
      if (this.bagOpen) this.closeBag();
      else if (!this.hideKey()) this.openBag();
    }
    if (c.pause && this.dying < 0 && !this.winning) {
      if (this.bagOpen) (this.bagOpen = false), (this.input.suspend = false); // una pausa de verdad también lo cierra
      return this.pause();
    }
    this.t += dt;
    if (!this.spectating || this.player?.dead) this.player?.update(dt, c);
    // escondido, las manos están quietas: nada de recoger, disparar ni linterna
    const hiding = !!this.player && this.player.hideState !== 'out', cc = hiding ? { ...c, grab: false, fire: false, reload: false, flash: false, swap: false, aim: false, zoom: 0 } : c;
    if (c.flash && this.dying < 0 && !hiding) this.audio?.click();
    if (this.dying < 0) this.items?.update(this.t, dt, cc);
    this.hideFrame(dt, c.hold);
    this.monsters(dt);
    if (this.mp) this.netFrame(dt);
    if (this.dying >= 0 && !this.spectating) this.dyingFrame(dt);
    // pasos: uno cada ~0,7 m andando (algo más largos corriendo), si se pisa suelo
    const p = this.player;
    if (p && p.speed > 0 && p.pos.y === 0) {
      this.stepAcc += p.speed * dt;
      const len = p.speed > 2 ? 1.1 : 0.7;
      if (this.stepAcc > len) (this.stepAcc -= len), this.audio?.step(p.speed > 2);
    }
    if (this.world) {
      this.world.update(this.t, dt);
      this.blackouts(dt);
      const near = this.world.lightsNear(this.camera.position);
      near.forEach((l, i) => (this.points[i].position.copy(l.pos), (this.points[i].intensity = 3 * l.level)));
      // el zumbido: el del tubo que tienes encima (y nada en un apagón)
      this.audio?.power((near[0]?.level ?? 0) * (0.4 + 0.6 * THREE.MathUtils.clamp(1 - Math.sqrt(near[0]?.d ?? 99) / 6, 0, 1)));
      if (p) this.audio?.ambient(dt, this.openness(p.pos), 1 - p.sanity);
      if (p) this.audio?.pit(this.world.pitNear(p.pos.x, p.pos.z));
      const du = (this.dust.material as THREE.ShaderMaterial).uniforms;
      du.uCam.value.copy(this.camera.position);
      du.uTime.value = this.t;
      du.uBeam.value = this.spectating ? (this.remotes.get(this.watching)?.light ? 1 : 0) : p?.lightOn ? 1 : 0;
      du.uPx.value = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y * 0.02;
    }
    // la cinta solo se ve mirando por la cámara (y al morir y en el ascensor, que es la grabación la que se corta)
    if (this.fadeIn > 0) this.fadeIn = Math.max(0, this.fadeIn - dt);
    this.vhs.enabled = (!!p?.aiming && !this.spectating) || (this.dying >= 0 && !this.spectating) || this.winning || this.fadeIn > 0;
    const u = this.vhs.uniforms;
    u.uTime.value = this.film.uniforms.uTime.value = this.t;
    u.uFlash.value = this.items?.flash ?? 0;
    if (this.winning) this.black = Math.min(1, this.black + dt / 1.5);
    u.uBlack.value = Math.max(this.black, this.fadeIn / 0.9);
    u.uAspect.value = this.fadeIn > 0 && !p?.aiming && this.dying < 0 && !this.winning ? 1 : this.camera.aspect;
    // la foto: se pinta el fotograma del flash y se queda congelado un instante
    const it = this.items;
    if (it && it.freeze > 0) {
      it.freeze -= dt;
      if (this.froze) return;
      this.froze = true;
    } else this.froze = false;
    // la foto: primero el fotograma sin flash, a una miniatura para el inventario
    if (it?.snap) {
      it.snap = false;
      u.uFlash.value = 0;
      this.composer.render(dt);
      it.thumbs.push(this.shot(160, 120, 0.7));
      it.full.push(this.shot(960, 720, 0.88));
      u.uFlash.value = it.flash;
    }
    this.composer.render(dt);
  }

  /** Lo que hay ahora en el lienzo, recortado al cuadro 4:3 de la cinta, a `w`×`h` en jpeg. */
  private shot(w: number, h: number, q: number) {
    const src = this.renderer.domElement, c = Object.assign(document.createElement('canvas'), { width: w, height: h }), k = Math.max(w / src.width, h / src.height);
    c.getContext('2d')!.drawImage(src, (w - src.width * k) / 2, (h - src.height * k) / 2, src.width * k, src.height * k);
    return c.toDataURL('image/jpeg', q);
  }

  get hud(): Hud {
    const p = this.player;
    const battery = Math.max(0.15, 1 - this.t / 900);
    const inv: Inv = { left: p?.left ?? 'flashlight', belt: p?.belt ?? 'none', stamina: p?.stamina ?? 1, sanity: p?.sanity ?? 1, escaped: this.winning, hand: p?.hand ?? 'none', camera: !!p?.has.camera, gun: !!p?.has.gun, ammo: p?.ammo ?? 0, spare: p?.spare ?? 0, tapes: this.items?.tapes ?? 0, photos: this.items?.photos ?? 0, thumbs: this.items?.thumbs ?? [], full: this.items?.full ?? [], flashOn: !!p?.flashOn, battery, charge: p?.charge ?? 1, spares: p?.spares ?? 0 };
    const hidden = !!p && p.hideState !== 'out';
    return { bag: this.bagOpen, hint: hidden ? null : this.items?.hint ?? null, hide: this.dying >= 0 || this.winning || this.spectating ? null : hidden ? (p!.hideState === 'hidden' ? 'leave' : null) : this.hideNear() ? 'hide' : null, breath: p?.concealed ? { air: this.breath.air, warn: this.inspected, held: this.holding } : null, inv, aiming: !!p?.aiming, zoom: p?.zoom ?? 1, focus: !!this.items?.focus, tapes: this.items?.tapes ?? 0, photos: this.items?.photos ?? 0, ammo: p?.has.gun ? p.ammo : null, spare: p?.spare ?? 0, battery, time: this.t, spectating: this.spectating ? (this.remotes.get(this.watching)?.name ?? '') : null, watchList: this.spectating ? [...this.remotes.values()].map((r) => ({ name: r.name, on: r.id === this.watching, dead: r.dead })) : undefined, specView: this.spectating ? this.specView : undefined };
  }

  /** Lo abierto que es el sitio: las celdas libres en 7 × 7 alrededor (0–1). */
  private openness(at: THREE.Vector3) {
    const m = this.world!.maze, cx = Math.floor(at.x / CELL), cz = Math.floor(at.z / CELL);
    let n = 0;
    for (let y = cz - 3; y <= cz + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) n += x >= 0 && y >= 0 && x < m.w && y < m.h ? m.open[y * m.w + x] : 0;
    return n / 49;
  }

  // los apagones: cada minuto o dos las luces tiemblan, se van unos segundos y vuelven con un golpe
  private nextOut = 70 + Math.random() * 50;
  private outT = -1;
  private blackouts(dt: number) {
    const w = this.world!;
    if (this.outT < 0) {
      if (this.t > this.nextOut && this.dying < 0 && !this.winning) this.outT = 0;
      return;
    }
    const was = w.power;
    this.outT += dt;
    const T = this.outT, down = 1.4, dark = 4.5;
    if (T < down) w.power = Math.random() < 0.5 ? 1 : 0.1; // tiembla
    else if (T < down + dark) w.power = 0;
    else if (T < down + dark + 0.5) w.power = Math.random() < 0.6 ? 1 : 0;
    else (w.power = 1), (this.outT = -1), (this.nextOut = this.t + 60 + Math.random() * 70);
    if (was > 0.5 !== w.power > 0.5 && Math.random() < 0.5) this.audio?.clunk(w.power > 0.5);
  }

  /** Las entidades, sus trozos, los globos sueltos y lo que se oye de ellas. */
  private monsters(dt: number) {
    const p = this.player!, w = this.world!, eye = this.camera.position, near = { bacteria: Infinity, partygoer: Infinity };
    // bajo los fluorescentes (con corriente) se te ve de más lejos; con la linterna, más aún
    const c = w.cellAt(p.pos.x, p.pos.z), exposed = w.power > 0.5 && !!w.maze.lit[c.y * w.maze.w + c.x];
    const torch = p.lightOn ? this.camera.getWorldDirection(new THREE.Vector3()) : null;
    const occ = this.mp ? [] : this.hides.filter((h) => h.occ); // (en una sala las entidades las lleva el servidor)
    for (const e of this.entities) {
      if (!e.alive) continue;
      if (e.update(dt, p.pos, eye, torch, exposed, this.god, occ, p.concealed) && this.dying < 0) this.die(e);
      near[e.kind] = Math.min(near[e.kind], e.pos.distanceTo(p.pos));
    }
    if (this.dying < 0) {
      this.audio?.near('bacteria', near.bacteria);
      this.audio?.near('partygoer', near.partygoer);
      // la cordura: a la luz se recupera; a oscuras se va (más deprisa sin linterna) y cerca de ellas, más
      const m = this.world!.maze, lit = this.world!.power > 0.5 && m.lit[Math.floor(p.pos.z / CELL) * m.w + Math.floor(p.pos.x / CELL)];
      const close = Math.min(near.bacteria, near.partygoer);
      const d = (lit ? 1 / 90 : p.lightOn ? -1 / 240 : -1 / 70) - (close < 10 ? (1 - close / 10) / 20 : 0);
      p.sanity = THREE.MathUtils.clamp(p.sanity + d * dt, 0, 1);
    }
    this.film.uniforms.uMad.value = this.dying < 0 ? 1 - (p.sanity) : 0;
    this.shatters = this.shatters.filter((s) => s.update(dt));
    this.balloons = this.balloons.filter((b) => {
      b.position.y += dt * 1.6;
      b.rotation.z = Math.sin(b.position.y * 2) * 0.3;
      if (b.position.y < 9) return true;
      b.removeFromParent();
      return false;
    });
  }

  /** El nicho que tienes delante: cerca, mirándolo, por su boca y vacío (sin nadie dentro ni entrando). */
  private hideNear(): HideState | undefined {
    const p = this.player;
    if (!p || p.hideState !== 'out' || p.frozen || p.dead) return undefined;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    for (const h of this.hides) {
      const dx = h.x - p.pos.x, dz = h.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > 2.4 || (fx * dx + fz * dz) / d < 0.8) continue;
      // por la boca: del lado de la salida
      if (((p.pos.x - h.x) * (h.fx - h.x) + (p.pos.z - h.z) * (h.fz - h.z)) / CELL < 0.6 * CELL * 0.5) continue;
      if (h.occ || [...this.remotes.values()].some((r) => r.hiding && Math.hypot(r.pos.x - h.x, r.pos.z - h.z) < 1)) continue;
      return h;
    }
    return undefined;
  }

  /** E: meterse en el nicho que tienes delante o salir del que estás. true si lo ha gastado (si no, abre el inventario). */
  private hideKey() {
    const p = this.player;
    if (!p || this.spectating || p.dead || p.frozen) return false;
    if (p.hideState === 'hidden') {
      p.leaveHide(this.hides[this.hideIdx]);
      this.audio?.click();
      return true;
    }
    if (p.hideState !== 'out') return true; // entrando o saliendo: espera
    const h = this.hideNear();
    if (!h) return false;
    this.hideIdx = h.idx;
    p.enterHide(h);
    this.breath.reset();
    this.audio?.click();
    return true;
  }

  /** Cada fotograma: el aire, quién me inspecciona y, en solitario, el nicho (ocupado, con mi ruido) que ven las entidades. */
  private hideFrame(dt: number, hold?: boolean) {
    const p = this.player;
    if (!p) return;
    this.noise = p.speed > 2 ? 1 : Math.max(0, this.noise - dt / 8);
    if (!this.mp) tickHides(this.hides, dt);
    const h = this.hides[this.hideIdx];
    if (p.concealed && h) {
      this.holding = this.breath.step(dt, !!hold);
      if (this.breath.gasped) this.audio?.gasp();
      if (!this.mp) {
        h.occ = { id: 'me', holding: this.holding, noise: this.noise };
        this.inspected = !!h.by;
      }
      this.audio?.hideAmb(dt, this.inspected ? 1 : 0.15, this.holding);
    } else {
      this.breath.step(dt, false);
      this.holding = false;
      if (!this.mp) {
        this.inspected = false;
        if (h) h.occ = null;
      }
      if (p.hideState === 'out') this.hideIdx = -1;
    }
  }

  /** Un tiro que mata: revienta, «Good job idiot, now what?» y otra del tipo contrario, más dura. */
  private kill(e: Entity, from: THREE.Vector3) {
    this.burst(e, from);
    unlock('idiot');
    // la siguiente, en el arranque más lejano del jugador: 15 % más rápida y un tiro más
    const m = this.world!.maze, p = this.player!.pos;
    const far = [...m.spawns].sort((a, b) => center(b).distanceTo(p) - center(a).distanceTo(p))[0];
    this.entities.push(new Entity(e.kind === 'bacteria' ? 'partygoer' : 'bacteria', this.world!, this.assets!, far, Math.min(1.2, e.speed * 1.1), e.hp0 + 1));
  }

  /** Una entidad que revienta: sus trozos salen despedidos de `from` y el globo se va al cielo. */
  private burst(e: Entity, from: THREE.Vector3) {
    const s = new Shatter(e.rig.root, from);
    this.world!.root.add(s.root);
    this.shatters.push(s);
    if (e.balloon) this.balloons.push(e.balloon), (e.balloon = undefined);
    e.dispose();
  }

  /** Te pillan o te caes: la cámara al suelo, la entidad baila, la cinta se come y el cuelgue falso. */
  private die(e?: Entity) {
    if (this.dying >= 0 || this.winning || (this.god && e)) return;
    this.dying = 0;
    this.killer = e;
    this.fly = undefined;
    if (this.hideIdx >= 0) (this.player!.cancelHide(this.hides[this.hideIdx]), (this.hides[this.hideIdx].occ = null), (this.hideIdx = -1)); // lo encuentran: fuera del nicho
    this.holding = false;
    this.player!.frozen = true;
    if (e) this.player!.dead = true;
    this.player!.aiming = false; // fuera el visor de la camcorder
    this.player!.zoom = 1;
    if (this.items) this.items.freeze = 0;
    if (this.bagOpen) (this.bagOpen = false), (this.input.suspend = false);
    this.input.unlock();
    // un fotograma de ahora, para los trozos congelados de la corrupción
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.snap = new THREE.WebGLRenderTarget(size.x / 2, size.y / 2);
    this.renderer.setRenderTarget(this.snap);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.vhs.uniforms.tPrev.value = this.snap.texture;
  }

  private dyingFrame(dt: number) {
    const t = (this.dying += dt), e = this.killer, p = this.player!, cam = this.camera;
    const look = (from: THREE.Vector3, to: THREE.Vector3) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(from, to, new THREE.Vector3(0, 1, 0)));
    if (e) {
      const head = e.rig.bone('Head')?.getWorldPosition(new THREE.Vector3()) ?? e.pos.clone().setY(e.height * 0.9);
      if (t < 0.4) {
        // se lanza a la lente: la vista se clava en su cara, se abre de golpe y tiembla
        const k = t / 0.4;
        cam.quaternion.slerp(look(cam.position, head), Math.min(1, dt * 14));
        cam.fov = THREE.MathUtils.lerp(70, 100, k * k);
        if (!this.opts.reduced) cam.position.set(p.pos.x + (Math.random() - 0.5) * 0.08 * k, p.pos.y + 1.62 + (Math.random() - 0.5) * 0.08 * k, p.pos.z + (Math.random() - 0.5) * 0.08 * k);
      } else {
        // la camcorder sale volando de las manos, dando vueltas, y cae de lado al suelo
        if (!this.fly) {
          const away = cam.position.clone().sub(e.pos).setY(0).normalize();
          const side = new THREE.Vector3(-away.z, 0, away.x).multiplyScalar((Math.random() - 0.5) * 2);
          this.fly = { pos: cam.position.clone(), vel: away.multiplyScalar(3).add(side).setY(2.6), q: cam.quaternion.clone(), spin: new THREE.Vector3(9, 6, 11).multiplyScalar(Math.random() < 0.5 ? -1 : 1), bounced: false };
        }
        const f = this.fly, w = this.world!;
        f.vel.y -= 9.8 * dt;
        const nx = f.pos.x + f.vel.x * dt, nz = f.pos.z + f.vel.z * dt;
        if (w.solid(nx, f.pos.z)) f.vel.x *= -0.4;
        else f.pos.x = nx;
        if (w.solid(f.pos.x, nz)) f.vel.z *= -0.4;
        else f.pos.z = nz;
        f.pos.y += f.vel.y * dt;
        if (f.pos.y < 0.12) {
          f.pos.y = 0.12;
          f.vel.y = Math.abs(f.vel.y) * 0.3;
          f.vel.x *= 0.55;
          f.vel.z *= 0.55;
          f.spin.multiplyScalar(0.4);
          if (!f.bounced) (f.bounced = true), this.audio?.step(true);
        }
        const still = f.bounced && f.vel.length() < 0.6;
        if (!still) f.q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(f.spin.x * dt, f.spin.y * dt, f.spin.z * dt)));
        else {
          // quieta en el suelo, de lado, grabando el cuerpo y lo que baila encima
          const lie = look(f.pos, p.corpse.setY(0.5)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.35));
          f.q.slerp(lie, Math.min(1, dt * 6));
        }
        cam.position.copy(f.pos);
        cam.quaternion.copy(f.q);
        cam.fov = THREE.MathUtils.lerp(cam.fov, 62, Math.min(1, dt * 4));
      }
      cam.updateProjectionMatrix();
      // y baila encima del cuerpo
      if (t > 1.5 && e.state === 'attack') {
        e.pos.copy(p.corpse);
        e.dance(p.pos);
      }
    } else this.black = THREE.MathUtils.clamp((t - 0.6) / 2.4, 0, 1); // al vacío: se cae a negro
    this.corrupt(THREE.MathUtils.clamp((t - 0.8) / 3.8, 0, 1));
    if (t > 4.8 && this.dying < 100) {
      this.dying = 100; // una vez
      if (this.mp) return this.spectate();
      this.renderer.setAnimationLoop(null); // la imagen se queda congelada: el cuelgue
      this.onDeath?.();
    }
  }

  /** Dentro del ascensor: las puertas se cierran, la grabación se corta a negro y «Noclip». */
  private win() {
    this.winning = true;
    this.player!.frozen = true;
    this.bagOpen = false;
    unlock('backrooms');
    this.mp?.sock.emit('exit');
    setTimeout(() => this.onWin?.(), 2500);
  }

  // desarrollo: dos dianas quietas delante del inicio, para probar fotos y tiros sin entidades
  fakeEntities() {
    const p = this.player!, f = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const mk = (d: number): Target => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6), new THREE.MeshStandardMaterial({ color: 0xaa2222 }));
      m.position.copy(p.pos).addScaledVector(f, d).setY(0.9);
      this.world!.root.add(m);
      const t = { pos: m.position.clone().setY(0), height: 1.8, alive: true, hit: () => ((t.alive = false), (m.visible = false), true) };
      return t;
    };
    this.items!.targets = [...this.entities, mk(2.5), mk(4.5)];
  }

  /** La cinta se rompe (0–1): la imagen y el sonido. */
  corrupt(f: number) {
    this.corruption = f;
    this.vhs.uniforms.uCorrupt.value = f;
    this.audio?.corrupt(f);
  }

  /** Abre el inventario: el puntero queda suelto para hacer clic; la partida sigue. */
  openBag() {
    this.bagOpen = true;
    this.input.clear(); // el joystick y RUN del táctil se desmontan sin soltar
    this.input.suspend = true;
    this.input.unlock();
  }
  closeBag() {
    this.bagOpen = false;
    this.input.suspend = false;
    this.input.lock();
  }

  /** Escribir en el chat: el teclado es del campo de texto, el puntero queda suelto (y soltarlo no pausa). */
  openChat() {
    this.input.clear();
    this.input.suspend = true;
    this.input.unlock();
  }
  closeChat() {
    if (this.bagOpen) return;
    this.input.suspend = false;
    this.input.lock();
  }

  /** Dentro del ascensor, cerrando la grabación. */
  get escaping() {
    return this.winning;
  }

  /** Congela la partida (el último fotograma se queda) y avisa al caparazón. */
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.input.active = false;
    this.input.clear();
    this.input.unlock();
    this.onPause?.();
  }
  resume() {
    this.paused = false;
    this.input.active = true;
    this.input.lock();
    this.clock.getDelta();
  }

  // ── la sala de espera ────────────────────────────────────────────────────

  /**
   * Montar la sala de espera 3D (waiting.ts) sobre el compositor: se descargan sus modelos, se compila con los demás
   * jugadores ya dentro y empieza a pintar. Devuelve false si se canceló mientras tanto (se salió de la sala).
   */
  async enterWaiting(mp: Mp, room: RoomView) {
    this.leaveWaiting();
    const tok = ++this.waitTok;
    const free = holdStill(); // en Firefox compilar congela la página: con la pantalla quieta
    try {
      const wr = await WaitingRoom.load(this.assets!, this.opts.reduced);
      if (tok !== this.waitTok) return wr.dispose(), false;
      wr.resize(this.camera.aspect);
      // el clon de un jugador, dentro mientras se compila: su material estrenaría programa con el primero que llegue
      const probe = this.spare.pop() ?? new Remote(this.assets!);
      probe.reset('probe', 'probe');
      wr.scene.add(probe.root);
      await compileGently(this.renderer, wr.scene, wr.camera);
      probe.root.removeFromParent();
      this.spare.push(probe);
      if (tok !== this.waitTok) return wr.dispose(), false;
      this.waiting = wr;
      this.waitMp = mp;
      wr.spawn(Math.max(0, room.players.findIndex((p) => p.id === mp.id)));
      wr.sfx = (n) => {
        const a = this.audio;
        if (n === 'creak') a?.creak();
        else if (n === 'boom') a?.boom();
        else if (n === 'alarm' || n === 'alarmoff') a?.alarm(n === 'alarm');
        else if (n === 'vend') a?.vend();
        else (a?.click(), n === 'thunk' && a?.clunk(true));
      };
      wr.onPress = () => mp.sock.emit('start');
      wr.onComputer = (open) => {
        this.input.clear();
        this.input.suspend = open;
        if (open) this.input.unlock();
        else this.input.lock();
        this.onWaitComputer?.(open);
      };
      this.audio ??= new GameAudio(undefined, this.muted, this.volume);
      this.audio.start();
      this.waitRoom(room);
      // los demás jugadores
      const onPlayers = (all: Record<string, PlayerState & { name: string; dead: boolean }>) => this.waitPhase !== 'playing' && this.syncRemotes(all, mp.id, wr.scene);
      mp.sock.on('players', onPlayers);
      const beat = setInterval(() => performance.now() - this.lastFrame > 150 && this.waitSend(), 1000 / 15);
      // las teclas 1–4 son los emotes (no mientras se escribe)
      const emoteKey = (e: KeyboardEvent) => {
        if (e.repeat || (e.target as HTMLElement | null)?.tagName === 'INPUT' || !/^Digit[1-4]$/.test(e.code)) return;
        wr.doEmote(Number(e.code.slice(5)));
      };
      addEventListener('keydown', emoteKey);
      this.offWait.push(() => (mp.sock.off('players', onPlayers), clearInterval(beat), removeEventListener('keydown', emoteKey)));
      const rp = this.composer.passes[0] as RenderPass;
      rp.scene = wr.scene;
      rp.camera = wr.camera;
      this.input.active = true;
      this.paused = false;
      this.input.clear();
      this.t = 0;
      this.sendT = 0;
      this.stepAcc = 0;
      this.clock.start();
      this.renderer.setAnimationLoop(() => this.waitFrame());
      return true;
    } finally {
      free();
    }
  }

  /** El aspecto de cada jugador, según la sala: se aplica a los que ya se ven y a los que lleguen. */
  setLooks(room: RoomView) {
    this.looks = new Map(room.players.map((p) => [p.id, p.look]));
    for (const [id, r] of this.remotes) r.setLook(this.looks.get(id) ?? DEFAULT_LOOK);
  }

  /** Lo que la sala dice de sí misma (propietario, fase, ajustes): la pantalla del ordenador y, si empieza la partida, la entrada. */
  waitRoom(room: RoomView) {
    const wr = this.waiting, mp = this.waitMp;
    if (!wr || !mp) return;
    this.waitPhase = room.phase;
    wr.owner = room.ownerId === mp.id;
    const DIFF = { easy: 'EASY', normal: 'NORMAL', hard: 'HARD' } as const;
    wr.setScreen(['BACKROOMS', `ROOM ${room.code}`, room.name.toUpperCase(), `${room.public ? 'PUBLIC' : 'PRIVATE'} ${room.players.length}/${room.max}`, `DIFFICULTY ${DIFF[room.difficulty]}`, `SEED ${room.fixedSeed || 'RANDOM'}`]);
    if (room.phase === 'starting' && !wr.entering) {
      // todos pasan a la cámara automática: los mandos quedan suspendidos
      wr.begin();
      this.paused = false;
      this.input.active = true;
      this.input.clear();
      this.input.suspend = true;
    }
  }

  /** Lo que el caparazón enseña sobre la sala de espera. */
  get waitHud() {
    const wr = this.waiting;
    return { ready: !!wr, hint: wr?.hint ?? null, label: wr?.hintLabel ?? '', notice: wr?.notice ?? '', computer: wr?.mode === 'computer', entering: !!wr?.entering, locked: this.input.locked, free: wr?.mode === 'free' };
  }

  /** Se cumple cuando la entrada por la puerta ha terminado (enseguida si no hay sala de espera). */
  waitDone() {
    return this.waiting ? this.waiting.whenDone() : Promise.resolve();
  }

  closeComputer() {
    this.waiting?.closeComputer();
  }

  private waitSend() {
    const wr = this.waiting;
    if (wr && this.waitMp) this.waitMp.sock.volatile.emit('state', { ...wr.state, t: performance.now() });
  }

  private waitFrame() {
    const dt = Math.min(this.clock.getDelta(), 0.05), wr = this.waiting;
    this.lastFrame = performance.now();
    if (!wr) return;
    this.t += dt;
    const c = this.input.read();
    // pausa (Esc, el puntero soltado): la sala sigue y los demás se ven; solo se sueltan los mandos
    if (c.pause && wr.mode === 'free' && !this.paused) this.pause();
    wr.update(dt, this.paused || wr.mode === 'starting' ? { ...c, move: _none.clone(), look: _none.clone(), bag: false, run: false } : c);
    for (const r of this.remotes.values()) r.update(dt);
    if (wr.speed > 0) {
      this.stepAcc += wr.speed * dt;
      const len = wr.speed > 2 ? 1.1 : 0.7;
      if (this.stepAcc > len) (this.stepAcc -= len), this.audio?.step(wr.speed > 2);
    }
    this.sendT += dt;
    if (this.sendT >= 1 / 15) (this.sendT = 0), this.waitSend();
    // el zumbido sigue al fluorescente y, al cruzar la puerta, sube con el negro
    this.audio?.power(wr.power * (1 - wr.black) + wr.black * 3.5);
    this.audio?.ambient(dt, 0.15, wr.black); // el bajo que bate sube con el negro de la entrada
    const u = this.vhs.uniforms;
    this.vhs.enabled = wr.black > 0;
    u.uAspect.value = 1;
    u.uTime.value = this.film.uniforms.uTime.value = this.t;
    u.uBlack.value = wr.black;
    this.composer.render(dt);
  }

  /** Quita la sala de espera: el compositor vuelve a pintar la escena del juego. */
  leaveWaiting() {
    this.waitTok++; // si aún se estaba cargando, se cancela
    this.offWait.forEach((f) => f());
    this.offWait = [];
    this.waitMp = undefined;
    this.waitPhase = '';
    const wr = this.waiting;
    if (!wr) return;
    this.waiting = undefined;
    wr.dispose();
    for (const r of this.remotes.values()) (r.root.removeFromParent(), this.spare.push(r));
    this.remotes.clear();
    const rp = this.composer.passes[0] as RenderPass;
    rp.scene = this.scene;
    rp.camera = this.camera;
    this.vhs.enabled = false;
    this.vhs.uniforms.uBlack.value = 0;
    this.vhs.uniforms.uAspect.value = this.camera.aspect;
    this.input.suspend = false;
    this.audio?.power(1);
  }

  // ── la sala ──────────────────────────────────────────────────────────────

  /** Escuchar a la sala: los demás jugadores, el mundo (entidades y objetos) y las muertes. */
  private wire(mp: Mp, items: Items) {
    this.mp = mp;
    const s = mp.sock;
    worldTl.reset(100); // snapshots del mundo cada 100 ms
    const onPlayers = (all: Record<string, PlayerState & { name: string; dead: boolean }>) => this.syncRemotes(all, mp.id, this.scene);
    const onWorld = (w: WorldSnapshot) => this.applyWorld(w);
    const onDead = (id: string) => {
      if (id !== mp.id) return this.remotes.get(id)?.die();
      if (this.dying >= 0 || this.winning || !this.player) return;
      // quien te ha pillado: la entidad más cerca (el servidor lo sabe antes de que llegue el siguiente snapshot)
      const p = this.player.pos;
      const e = this.entities.filter((e) => e.alive && e.pos.distanceTo(p) < 5).sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p))[0];
      e?.forceAttack();
      this.die(e);
    };
    // espectador: flechas o Tab cambian de compañero
    const key = (e: KeyboardEvent) => {
      if (!this.spectating || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'Tab') (e.preventDefault(), this.watch(e.code === 'ArrowLeft' ? -1 : 1));
      else if (e.code === 'KeyV') this.specView = this.specView === 'eyes' ? 'chase' : 'eyes';
      else if (/^Digit[1-3]$/.test(e.code)) {
        const live = [...this.remotes.values()].filter((r) => !r.dead), t = live[Number(e.code.slice(5)) - 1];
        if (t) this.watching = t.id;
      }
    };
    s.on('players', onPlayers);
    s.on('world', onWorld);
    s.on('dead', onDead);
    addEventListener('keydown', key);
    // con la pestaña oculta o la ventana sin foco el navegador para los fotogramas: la sala sigue sabiendo dónde estoy
    const beat = setInterval(() => performance.now() - this.lastFrame > 150 && !this.spectating && this.sendState(), 1000 / 15);
    this.offNet.push(() => clearInterval(beat));
    this.offNet.push(() => (s.off('players', onPlayers), s.off('world', onWorld), s.off('dead', onDead), removeEventListener('keydown', key)));
    items.claim = (id, done) => s.emit('pickup', id, done);
    items.onPhoto = () => s.emit('photo');
  }

  /** Los demás jugadores según lo que dice el servidor: se crean (con un clon reutilizado, en `parent`), se mueven y se quitan los que ya no están. */
  private syncRemotes(all: Record<string, PlayerState & { name: string; dead: boolean }>, me: string, parent: THREE.Object3D) {
    const seen = new Set<string>();
    for (const [id, st] of Object.entries(all)) {
      if (id === me) continue;
      seen.add(id);
      let r = this.remotes.get(id);
      if (!r) {
        if (this.remotes.size >= 3) continue; // ≤ 4 jugadores: tres clones, reutilizados
        r = this.spare.pop() ?? new Remote(this.assets!);
        r.reset(id, st.name);
        r.setLook(this.looks.get(id) ?? DEFAULT_LOOK);
        // en la sala de espera: sombra falsa y pasos (con volumen y lado según dónde esté respecto a mí)
        r.floorShadow = parent !== this.scene;
        r.onStep = r.floorShadow ? (rr, run) => this.remoteStep(rr, run) : undefined;
        parent.add(r.root);
        this.remotes.set(id, r);
      }
      r.set(st);
      if (st.dead) r.die();
    }
    for (const [id, r] of this.remotes) if (!seen.has(id)) (r.root.removeFromParent(), this.remotes.delete(id), this.spare.push(r));
  }

  /** El paso de otro jugador en la sala de espera: más bajo cuanto más lejos y hacia el lado en que está. */
  private remoteStep(r: Remote, run: boolean) {
    const wr = this.waiting;
    if (!wr || !this.audio) return;
    const dx = r.pos.x - wr.camera.position.x, dz = r.pos.z - wr.camera.position.z, d = Math.hypot(dx, dz);
    // a su derecha: el producto con el lado derecho de la cámara
    const right = dx * Math.cos(wr.yaw) - dz * Math.sin(wr.yaw);
    this.audio.step(run, Math.max(0, 1 - d / 7) * 0.8, d > 0.2 ? Math.max(-0.9, Math.min(0.9, right / Math.max(d, 1))) : 0);
  }

  /** Deja de escuchar a la sala y quita a los demás. */
  private stopMp() {
    this.offNet.forEach((f) => f());
    this.offNet = [];
    for (const r of this.remotes.values()) (r.root.removeFromParent(), this.spare.push(r));
    this.remotes.clear();
    this.entMap.clear();
    this.mp = undefined;
  }

  /** El snapshot del servidor: las entidades (las nuevas se crean, las que faltan han muerto) y los objetos. */
  private applyWorld(w: WorldSnapshot) {
    const world = this.world, mp = this.mp;
    if (!world || !mp) return;
    const here = new Set<number>(), now = performance.now(), t = w.t ?? now;
    worldTl.push(t, now); // el reloj del mundo (hora del servidor): las entidades se dibujan algo en el pasado, con el ritmo del servidor
    for (const s of w.ents) {
      here.add(s.id);
      let e = this.entMap.get(s.id);
      if (!e) {
        e = new Entity(s.kind, world, this.assets!, world.cellAt(s.x, s.z), s.speed, s.hp, true);
        e.id = s.id;
        e.onHit = (id) => mp.sock.emit('hit', id);
        e.net(s, true, t);
        this.entMap.set(s.id, e);
        this.entities.push(e);
      } else e.net(s, false, t);
    }
    for (const [id, e] of this.entMap)
      if (!here.has(id)) {
        e.alive = false;
        this.entMap.delete(id);
        this.entities.splice(this.entities.indexOf(e), 1);
        if (e !== this.killer) this.burst(e, this.camera.position);
        else e.dispose();
      }
    this.items?.sync(w.taken, w.tapes);
    this.inspected = !!w.insp?.includes(mp.id);
  }

  /** Cada fotograma en una sala: los demás, lo que yo mando (15 Hz) y, si estoy muerto, la cámara del compañero. */
  private netFrame(dt: number) {
    for (const r of this.remotes.values()) r.update(dt);
    if (!this.spectating) {
      this.sendT += dt;
      if (this.sendT >= 1 / 15) (this.sendT = 0), this.sendState();
      return;
    }
    const live = [...this.remotes.values()].filter((r) => !r.dead);
    let t = this.remotes.get(this.watching);
    if (!t || t.dead) t = live[0];
    this.watching = t?.id ?? '';
    if (!t) return void (this.flash.intensity = 0);
    const cam = this.camera, eye = _spec.set(t.pos.x, t.pos.y + 1.62, t.pos.z);
    const chase = this.specView === 'chase';
    for (const r of this.remotes.values()) r.setFirstPerson(r === t && !chase);
    if (!chase) {
      // por sus ojos: donde está, hacia donde mira, y con su linterna
      this.specPos.copy(eye);
      cam.position.copy(eye);
      cam.rotation.set(t.pitch, t.yaw, 0, 'YXZ');
    } else {
      // desde detrás y algo por encima, sin atravesar paredes (si choca, se acerca) y con inercia
      const fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw), w = this.world;
      let d = 2.4;
      while (d > 0.4 && w?.solid(eye.x - fx * d, eye.z - fz * d)) d -= 0.2;
      const want = _want.set(eye.x - fx * d, eye.y + 0.5 + (2.4 - d) * 0.1, eye.z - fz * d);
      if (this.specPos.distanceTo(eye) > 6) this.specPos.copy(want);
      this.specPos.lerp(want, 1 - Math.exp(-dt * 9));
      cam.position.copy(this.specPos);
      cam.lookAt(eye.x + fx * 1.5, eye.y - 0.15, eye.z + fz * 1.5);
    }
    cam.updateMatrixWorld();
    this.flash.intensity = t.light ? 22 : 0;
  }

  private sendState() {
    const p = this.player;
    if (!p || !this.mp) return;
    // volatile: si el túnel va atascado, este estado se pierde en vez de encolarse (el siguiente lleva lo último); t: la hora de ahora, para que
    // los demás reconstruyan mi ritmo aunque los paquetes lleguen tarde o juntos
    this.mp.sock.volatile.emit('state', { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch, anim: p.rig.current?.getClip().name ?? 'Neutral Idle', light: p.lightOn, held: p.concealed ? 'none' : p.hand, hiding: p.concealed, holding: this.holding, t: performance.now() });
  }

  /** Estado de la red para depurar (consola: `__game.netInfo()`): ping, jitter y retraso de dibujo de cada jugador y del mundo. */
  netInfo() {
    return { rtt: netStats.rtt, world: { jitter: Math.round(worldTl.jitter), delay: Math.round(worldTl.delay) }, players: [...this.remotes.values()].map((r) => ({ name: r.name, ...r.net })) };
  }

  /** Muerto del todo: pasa a mirar por los ojos de un compañero. */
  private spectate() {
    this.spectating = true;
    this.fly = undefined;
    this.black = 0;
    this.corrupt(0);
    this.vhs.uniforms.uBlack.value = 0;
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this.watching = [...this.remotes.values()].find((r) => !r.dead)?.id ?? '';
  }

  /** Al siguiente (o anterior) compañero vivo. */
  private watch(dir: number) {
    const live = [...this.remotes.values()].filter((r) => !r.dead);
    if (!live.length) return;
    const i = live.findIndex((r) => r.id === this.watching);
    this.watching = live[(i + dir + live.length * 2) % live.length].id;
  }

  /** Saca al jugador de la partida (la sala vuelve al lobby): se para todo y queda el lienzo en negro. */
  stop() {
    this.renderer.setAnimationLoop(null);
    this.leaveWaiting();
    this.stopMp();
    this.input.active = false;
    this.input.clear();
    this.input.unlock();
    this.entities.forEach((e) => e.dispose());
    this.entities = [];
    this.shatters.forEach((s) => s.dispose());
    this.shatters = [];
    this.balloons.forEach((b) => b.removeFromParent());
    this.balloons = [];
    this.audio?.dispose();
    this.audio = undefined;
    this.player?.dispose();
    this.world?.dispose();
    this.player = this.world = this.items = undefined;
    this.spectating = false;
    this.dying = -1;
    this.winning = false;
    this.bagOpen = false;
    this.corrupt(0);
    this.vhs.uniforms.uBlack.value = 0;
    this.vhs.enabled = false;
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this.flash.intensity = 0;
    this.composer.render(0);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.stopMp();
    this.spare.forEach((r) => r.dispose());
    for (const off of this.offs) off();
    this.input.dispose();
    this.tv?.dispose();
    this.leaveWaiting();
    this.entities.forEach((e) => e.dispose());
    this.shatters.forEach((s) => s.dispose());
    this.snap?.dispose();
    this.audio?.dispose();
    this.composer.dispose();
    this.player?.dispose();
    this.world?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

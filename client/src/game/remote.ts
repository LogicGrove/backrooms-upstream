import * as THREE from 'three';
import { DEFAULT_LOOK, type Look, type PlayerState } from '@backrooms/shared';
import type { Assets } from './game';
import { Rig, aim } from './rig';
import { fit } from './player';
import { Cosmetics } from './cosmetics';
import { Timeline, Track, type Snap } from './interp';

/*
 * Otro jugador: el mismo hazmat (clonado) que el propio, con la linterna y lo que lleve en la mano. Se
 * le interpola el estado que llega a 15 Hz; su cuerpo reproduce el clip que manda. Sin luces nuevas (otra
 * luz recompilaría todos los materiales): el haz de la linterna es un cono aditivo.
 */

const WALK = 1.6, RUN = 3.6;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const angle = (a: number, b: number) => a + THREE.MathUtils.euclideanModulo(b - a + Math.PI, Math.PI * 2) - Math.PI;

// el haz: dos conos (un núcleo estrecho y una penumbra ancha), la punta en el origen y abiertos hacia -z. El tono se
// desvanece a lo largo, se aclara al borde de la silueta y se agota con la distancia, como el polvo que cruza una linterna.
const cone = (r: number) => new THREE.ConeGeometry(r, 6, 20, 1, true).translate(0, -3, 0).rotateX(Math.PI / 2);
const BEAM = [cone(1.5), cone(0.55)];
const beamMat = (k: number) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uK: { value: k }, uT: { value: 0 }, uOn: { value: 1 } },
    vertexShader: `varying float vT; varying vec3 vN; varying vec3 vV;
      void main() { vT = -position.z / 6.0; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uK; uniform float uT; uniform float uOn; varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float along = pow(1.0 - vT, 1.7) * smoothstep(0.0, 0.06, vT);
        float dust = 0.88 + 0.12 * sin(vT * 38.0 - uT * 1.7) * sin(vT * 11.0 + uT * 0.9);
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.74) * uK * edge * along * dust * uOn, 1.0);
      }`,
  });
// el brillo de la lente: un punto cálido con caída suave, siempre de cara a la cámara
const GLOW = (() => {
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,244,214,1)');
  g.addColorStop(0.25, 'rgba(255,226,160,0.55)');
  g.addColorStop(1, 'rgba(255,200,110,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// la sombra falsa bajo los pies: un punto negro con caída suave
const BLOB = (() => {
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.62)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0), _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Remote {
  readonly root = new THREE.Group();
  private rig: Rig;
  private cos: Cosmetics;
  private items: Record<'flashlight' | 'camera' | 'gun', THREE.Object3D>;
  private beam = new THREE.Group();
  private beamMats = [beamMat(0.07), beamMat(0.16)];
  private glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  private clock = 0;
  private label: THREE.Sprite;
  private labelCtx: CanvasRenderingContext2D;
  private bones: Record<'LeftHand' | 'RightHand' | 'Head', THREE.Bone | undefined>;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  light = true;
  held: PlayerState['held'] = 'none';
  dead = false;
  /** Escondido en un nicho: se ve agachado dentro (el cuerpo achatado y echado hacia el fondo). */
  hiding = false;
  private crouch = 0;
  id = '';
  name = '';
  private goal = new THREE.Vector3();
  private goalYaw = 0;
  private goalPitch = 0;
  private fresh = true;
  private track = new Track<Snap & { s: PlayerState }>();
  private base?: PlayerState;
  private out: Snap = { t: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private speed = 0;
  private deadT = 0;
  // la sala de espera: emote (ver PlayerState.emote), sombra falsa y pasos
  emote = 0;
  private emoteK = 0;
  floorShadow = false;
  private shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: BLOB, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  onStep?: (r: Remote, run: boolean) => void;
  private walked = 0;

  constructor(assets: Assets) {
    this.rig = new Rig(assets.gltf.hazmat);
    this.rig.root.traverse((o) => void ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
    this.cos = new Cosmetics(this.rig.root);
    this.items = {
      flashlight: fit(assets.gltf.flashlight.scene.clone(true), 0.26, Math.PI),
      camera: fit(assets.gltf.camcorder.scene.clone(true), 0.2, Math.PI / 2),
      gun: fit(assets.gltf.gun.scene.clone(true), 0.72, Math.PI),
    };
    this.items.flashlight.getObjectByName('Circle_6')?.removeFromParent();
    BEAM.forEach((g, i) => {
      const m = new THREE.Mesh(g, this.beamMats[i]);
      m.frustumCulled = false;
      m.renderOrder = 2;
      this.beam.add(m);
    });
    this.glow.scale.setScalar(0.34);
    this.bones = { LeftHand: this.rig.bone('LeftHand'), RightHand: this.rig.bone('RightHand'), Head: this.rig.bone('Head') };
    // el nombre flotante: un sprite con el texto pintado en un lienzo pequeño
    const cv = Object.assign(document.createElement('canvas'), { width: 256, height: 64 });
    this.labelCtx = cv.getContext('2d')!;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    this.label.scale.set(1, 0.25, 1);
    this.root.add(this.rig.root, ...Object.values(this.items), this.beam, this.glow, this.label, this.shadow, this.cos.root);
    this.rig.play('Neutral Idle', 0);
  }

  /** Reutilizar este clon para otro jugador. */
  reset(id: string, name: string) {
    this.id = id;
    this.name = name;
    this.dead = false;
    this.hiding = false;
    this.crouch = 0;
    this.rig.root.scale.set(1, 1, 1);
    this.fresh = true;
    this.track = new Track(); // un jugador nuevo en este clon: otro reloj, otro buffer
    this.base = undefined;
    this.deadT = 0;
    this.cos.set(DEFAULT_LOOK);
    this.rig.root.rotation.set(0, 0, 0);
    this.rig.play('Neutral Idle', 0);
    const x = this.labelCtx;
    x.clearRect(0, 0, 256, 64);
    x.font = 'bold 30px ui-monospace, Consolas, monospace';
    x.textAlign = 'center';
    x.lineWidth = 6;
    x.strokeStyle = '#000';
    x.fillStyle = '#f2f1ea';
    const t = name.toUpperCase();
    x.strokeText(t, 128, 42);
    x.fillText(t, 128, 42);
    (this.label.material.map as THREE.Texture).needsUpdate = true;
  }

  /** Su aspecto (color, sombrero, mochila): lo da la sala, validado por el servidor. */
  setLook(l: Look) {
    this.cos.set(l);
  }

  /** Un estado nuevo del servidor: se guarda con la hora del emisor (los repetidos o viejos se descartan); se aplica en `update`, algo en el pasado. */
  set(s: PlayerState) {
    // sin hora (el estado inicial que pone el servidor antes de que el jugador mande el suyo): no entra al buffer, que mezclaría relojes
    if (!s.t) return void (this.base = s);
    this.track.push({ t: s.t, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, s }, performance.now());
  }

  /** Ping de este jugador: lo que se retrasa el que más y el retraso con el que se le dibuja (ms). */
  get net() {
    return { jitter: Math.round(this.track.tl.jitter), delay: Math.round(this.track.tl.delay) };
  }

  /** Atrapado (o caído): el cuerpo cae y se queda en el suelo. */
  die() {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
    const clip = ['Dying', 'Falling Back Death', 'Death'].find((n) => this.rig.action(n));
    if (clip) this.rig.play(clip, 0.1, true);
  }

  /** La cabeza se esconde mientras se mira por sus ojos. */
  setFirstPerson(on: boolean) {
    this.bones.Head?.scale.setScalar(on ? 0.001 : 1);
  }

  update(dt: number) {
    // lo que toca dibujar ahora: interpolado entre estados ya recibidos (ver interp.ts), con lo discreto del anterior
    let s = this.track.sample(performance.now(), this.out)?.s;
    if (!s && this.base) (s = this.base), Object.assign(this.out, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch });
    if (s) {
      this.goal.set(this.out.x, this.out.y, this.out.z);
      this.goalYaw = this.out.yaw;
      this.goalPitch = this.out.pitch;
      this.light = s.light;
      this.held = s.held;
      this.hiding = !!s.hiding;
      this.emote = s.emote ?? 0;
      if (!this.dead) this.rig.play(s.anim);
      if (this.fresh) (this.fresh = false), this.pos.copy(this.goal), (this.yaw = this.goalYaw), (this.pitch = this.goalPitch);
    }
    // ya viene suave: solo un pulido corto (y, si de verdad se ha ido lejos, se corta)
    const k = 1 - Math.exp(-dt * 30), prev = _v.copy(this.pos);
    Timeline.follow(this.pos, this.goal, dt, k); // con tope de velocidad: tras un atasco se recupera corriendo, no a saltos
    this.pos.y += (this.goal.y - this.pos.y) * k;
    // la mirada (cabeza) con un filtro más lento y tope de velocidad: el ratón de quien juega tiembla y a veces da
    // saltos, y la cabeza no debe latiguear ni vibrar con eso
    const kh = 1 - Math.exp(-dt * 12), cap = dt * 12;
    this.yaw += THREE.MathUtils.clamp((angle(this.yaw, this.goalYaw) - this.yaw) * kh, -cap, cap);
    this.pitch += THREE.MathUtils.clamp((this.goalPitch - this.pitch) * kh, -cap, cap);
    // el clip, a la velocidad a la que se mueve de verdad
    const sp = dt > 0 ? this.pos.distanceTo(prev) / dt : 0;
    this.speed += (sp - this.speed) * Math.min(1, dt * 8);
    const a = this.rig.current;
    if (a && !this.dead) a.timeScale = this.speed > 0.2 ? THREE.MathUtils.clamp(this.speed / (this.speed > 2.4 ? RUN : WALK), 0.6, 1.4) : 1;
    const body = this.rig.root;
    body.position.copy(this.pos);
    this.crouch += ((this.hiding && !this.dead ? 1 : 0) - this.crouch) * Math.min(1, dt * 8);
    body.scale.set(1, 1 - 0.4 * this.crouch, 1);
    body.position.x += Math.sin(this.yaw) * 0.3 * this.crouch;
    body.position.z += Math.cos(this.yaw) * 0.3 * this.crouch;
    if (this.dead) {
      this.deadT += dt;
      const clip = ['Dying', 'Falling Back Death', 'Death'].find((n) => this.rig.action(n));
      body.rotation.set(0, this.yaw + Math.PI, 0);
      if (!clip) body.rotation.set(-(Math.min(1, this.deadT / 0.75) ** 2) * (Math.PI / 2) * 0.96, this.yaw + Math.PI, 0, 'YXZ');
    } else body.rotation.set(0, this.yaw + Math.PI, 0);
    this.rig.update(dt);
    if (!this.dead) this.pose(dt);
    // la cabeza sigue a la mirada (hacia arriba o abajo)
    if (this.bones.Head && !this.dead) this.bones.Head.rotation.x -= THREE.MathUtils.clamp(this.pitch, -1, 1) * 0.7;
    body.updateMatrixWorld(true);
    this.cos.update(this.pitch, !this.bones.Head || this.bones.Head.scale.x > 0.5);
    const live = !this.dead;
    // lo que lleva: en las manos, apuntando hacia donde mira
    _q.setFromEuler(_e.set(this.pitch, this.yaw, 0, 'YXZ'));
    const place = (it: THREE.Object3D, bone: THREE.Bone | undefined, on: boolean, fwd: number) => {
      it.visible = on && !!bone;
      if (!it.visible) return;
      bone!.getWorldPosition(it.position);
      it.position.addScaledVector(_v.set(0, 0, -1).applyQuaternion(_q), fwd);
      it.quaternion.copy(_q);
    };
    place(this.items.flashlight, this.bones.LeftHand, live && this.held !== 'gun', 0.1);
    place(this.items.camera, this.bones.RightHand, live && this.held === 'camera', 0.12);
    place(this.items.gun, this.bones.RightHand, live && this.held === 'gun', 0.25);
    // el haz sale de la linterna
    this.clock += dt;
    this.beam.visible = this.glow.visible = live && this.light;
    if (this.beam.visible) {
      (this.beam.position.copy(this.items.flashlight.position), this.beam.quaternion.copy(_q));
      this.glow.position.copy(this.items.flashlight.position).addScaledVector(_v.set(0, 0, -1).applyQuaternion(_q), 0.12);
      for (const m of this.beamMats) m.uniforms.uT.value = this.clock;
    }
    this.shadow.visible = this.floorShadow && live;
    this.shadow.position.set(this.pos.x, this.pos.y + 0.012, this.pos.z);
    if (live && this.onStep && this.emoteK < 0.5 && this.speed > 0.3) {
      this.walked += this.speed * dt;
      const len = this.speed > 2.4 ? 1.1 : 0.7;
      if (this.walked > len) (this.walked -= len), this.onStep(this, this.speed > 2.4);
    }
    this.label.visible = live;
    this.label.position.set(this.pos.x, this.pos.y + 2.15 - 0.85 * this.crouch, this.pos.z);
  }

  /**
   * Los emotes de la sala de espera: el rig solo trae andar, correr y quieto, así que son poses a mano: tras el mezclador, se
   * apuntan los huesos (aim) hacia una dirección del mundo; `emoteK` (0–1) mezcla de la pose del clip a la del emote.
   */
  private pose(dt: number) {
    const e = this.emote;
    this.emoteK += ((e ? 1 : 0) - this.emoteK) * Math.min(1, dt * 9);
    if (this.emoteK < 0.02) return;
    const k = this.emoteK, t = this.clock, B = (n: string) => this.rig.bone(n);
    _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _r.set(-_f.z, 0, _f.x);
    // apunta `bone` (cuyo hijo es `child`) a medio camino de donde estaba hacia `want`
    const point = (bone: THREE.Object3D | undefined, child: THREE.Object3D | undefined, want: THREE.Vector3) => {
      if (!bone || !child) return;
      bone.updateWorldMatrix(true, true);
      bone.getWorldPosition(_a);
      child.getWorldPosition(_b);
      _d.copy(_b).sub(_a).normalize().lerp(want.clone().normalize(), k).normalize();
      aim(bone, child, _d);
    };
    const v = (f: number, up: number, r: number) => new THREE.Vector3().addScaledVector(_f, f).addScaledVector(_u, up).addScaledVector(_r, r);
    const rA = B('RightArm'), rF = B('RightForeArm'), rH = B('RightHand'), lA = B('LeftArm'), lF = B('LeftForeArm'), lH = B('LeftHand');
    if (e === 1) {
      point(rA, rF, v(0.1, 0.85, 0.45));
      point(rF, rH, v(0.05, 1, Math.sin(t * 9) * 0.6));
    } else if (e === 2) {
      point(rA, rF, v(0.95, 0.15, 0.1));
      point(rF, rH, v(0.95, 0.15, 0.1));
    } else if (e === 3) {
      const c = 0.5 + 0.5 * Math.sin(t * 13);
      point(lA, lF, v(0.5, -0.6, -0.3));
      point(rA, rF, v(0.5, -0.6, 0.3));
      point(lF, lH, v(0.8, 0.25, 0.25 + 0.5 * c));
      point(rF, rH, v(0.8, 0.25, -0.25 - 0.5 * c));
    } else if (e === 4) {
      // sentado: la cadera baja y los muslos salen hacia delante
      this.rig.root.position.y -= 0.46 * k;
      point(B('LeftUpLeg'), B('LeftLeg'), v(0.97, 0.05, -0.1));
      point(B('RightUpLeg'), B('RightLeg'), v(0.97, 0.05, 0.1));
      point(B('LeftLeg'), B('LeftFoot'), v(-0.05, -1, -0.02));
      point(B('RightLeg'), B('RightFoot'), v(-0.05, -1, 0.02));
      point(lA, lF, v(0.15, -0.9, -0.2));
      point(rA, rF, v(0.15, -0.9, 0.2));
    }
    this.rig.root.updateMatrixWorld(true);
  }

  dispose() {
    this.rig.mixer.stopAllAction();
    this.cos.dispose();
    this.root.removeFromParent();
  }
}

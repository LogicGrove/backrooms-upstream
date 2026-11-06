import * as THREE from 'three';
import type { Controls } from './input';
import type { World } from './world';
import type { Assets } from './game';
import { settings } from '../settings';
import { Rig } from './rig';
import { solveArm, solveTwoBone, poseFingers } from './ik';
import { grips, type Hand, type View } from './grips';

/*
 * El jugador: el hazmat en primera persona. La cámara va a la altura de los ojos y el cuerpo debajo,
 * un poco atrás, sin cabeza (se encoge el hueso): al mirar abajo se ven el pecho, las piernas y las
 * botas. Los brazos los pone el IK encima de la animación: cada mano va a su punto de agarre. La
 * izquierda lleva la linterna; con la pistola (o mirando por la cámara) van las dos al objeto, y la
 * linterna queda montada (su luz sigue saliendo de la vista).
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const D = Math.PI / 180;
const wrap = (a: number) => THREE.MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI;

export const EYE = 1.62;
const _rest = new THREE.Vector3(), _eye = new THREE.Vector3();
const REACH_T = 0.85; // lo que dura recoger algo, en segundos
const WALK = 1.6, RUN = 3.6, JUMP = Math.sqrt(2 * 9.8 * 0.9), G = 9.8, R = 0.3;

/** Un modelo escalado para que su lado mayor mida `size`, centrado en el origen y girado `ry`. */
export function fit(o: THREE.Object3D, size: number, ry = 0) {
  const box = new THREE.Box3().setFromObject(o), s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = size / Math.max(s.x, s.y, s.z);
  const g = new THREE.Group();
  o.position.sub(c);
  g.add(o);
  g.scale.setScalar(k);
  g.rotation.y = ry;
  return g;
}

/** Lo que se lleva encima y dónde va: la derecha y el cinturón, camcorder o rifle; la izquierda, la linterna. */
export type Gear = 'flashlight' | 'camera' | 'gun';
export type Slot = 'left' | 'right' | 'belt';
export const FITS: Record<Slot, Gear[]> = { left: ['flashlight'], right: ['camera', 'gun'], belt: ['camera', 'gun'] };

export class Player {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  hand: 'none' | 'camera' | 'gun' = 'none';
  left: 'none' | 'flashlight' = 'flashlight';
  belt: 'none' | 'camera' | 'gun' = 'none';
  readonly has = { camera: false, gun: false };
  /** Correr lo gasta y a cero no se corre hasta recuperar un cuarto; la cordura la lleva game.ts. */
  stamina = 1;
  sanity = 1;
  private winded = false;
  ammo = 0; // en el cargador
  spare = 0; // de reserva
  flashOn = true;
  /** Lo que le queda a la linterna (0–1) y las de repuesto en la mochila. */
  charge = 1;
  /** Segundos de luz que da una linterna (la dificultad de la sala lo cambia). */
  life = 90;
  spares = 0;
  private lens?: THREE.MeshStandardMaterial;
  // recoger: la vista se agacha hacia el objeto y la mano derecha baja a por él (0 → REACH_T)
  private reachAt?: THREE.Vector3;
  private reachT = 0;
  private reachCb?: () => void;
  /** Mirando por la camcorder (clic derecho). */
  aiming = false;
  /** El zoom de la camcorder, 1×–4×. */
  zoom = 1;
  private aimK = 0; // 0 → 1 mientras se sube la cámara al ojo
  onFall?: () => void;
  readonly rig: Rig;
  /** Lo que va en las manos, pegado a la cámara: la linterna a la izquierda y la cámara o la pistola a la derecha. */
  readonly items = { flashlight: new THREE.Group(), camera: new THREE.Group(), gun: new THREE.Group() };
  speed = 0;
  private velY = 0;
  private ground = true;
  private falling = false;
  private fell = false;
  private bob = 0;
  private busy = 0; // segundos de una animación de una vez (recoger, recargar)
  private recoil = 0;
  /** El jugador ya no manda (muerto, en el ascensor): solo se pinta. */
  frozen = false;
  /** Le ha pillado una entidad: el cuerpo cae (y la cámara ya no es suya: la lleva game.ts). */
  dead = false;
  private deadT = 0;
  private bones: Record<string, THREE.Bone | undefined>;
  /**
   * Escondite en un nicho de la pared: fuera, entrando (0,4 s), dentro, o saliendo. Dentro, la vista se agacha y se
   * acerca al fondo, no se camina, la mirada se limita a ±70° de la salida, la linterna se apaga y las manos bajan.
   */
  hideState: 'out' | 'in' | 'hidden' | 'leaving' = 'out';
  private hideK = 0;
  private hideFrom = new THREE.Vector3();
  private hideTo = new THREE.Vector3();
  private hideYaw = 0;
  private hideYaw0 = 0;
  private flashWas = false;

  constructor(private world: World, assets: Assets, private camera: THREE.PerspectiveCamera, private flash: THREE.SpotLight, private reduced: boolean) {
    this.rig = new Rig(assets.gltf.hazmat);
    world.root.add(this.rig.root);
    this.bones = Object.fromEntries(['Head', 'Neck', 'RightArm', 'RightForeArm', 'RightHand', 'RightHandMiddle1', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandMiddle1'].map((n) => [n, this.rig.bone(n)]));
    // los objetos de la mano, a escala de mano y apuntando al frente (-z): el rifle y la linterna
    // miran a +z en su modelo; la cámara, a +x
    this.items.flashlight.add(fit(assets.gltf.flashlight.scene.clone(true), 0.26, Math.PI));
    this.items.flashlight.getObjectByName('Circle_6')?.removeFromParent(); // la tira de la muñeca
    // la lente: su emisiva va con la linterna (encendida o no); un material propio, que es la única
    this.items.flashlight.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.MeshStandardMaterial).emissive?.getHex()) this.lens = m.material = (m.material as THREE.MeshStandardMaterial).clone();
    });
    this.items.camera.add(fit(assets.gltf.camcorder.scene.clone(true), 0.2, Math.PI / 2));
    this.items.gun.add(fit(assets.gltf.gun.scene.clone(true), 0.72, Math.PI));
    this.placeItems(0);
    for (const it of Object.values(this.items)) camera.add(it);
    this.items.camera.visible = this.items.gun.visible = false;
    this.rig.play('Neutral Idle', 0);
  }

  /** Cada objeto en su sitio respecto a la vista (grips.json); la camcorder, de su sitio en reposo al ojo según `k` (0–1). */
  private placeItems(k: number) {
    const put = (it: THREE.Object3D, v: View, pos: THREE.Vector3) => (it.position.copy(pos), it.rotation.set(v.rot[0] * D, v.rot[1] * D, v.rot[2] * D));
    put(this.items.flashlight, grips.flashlight.view, _rest.fromArray(grips.flashlight.view.pos));
    put(this.items.gun, grips.gun.view, _rest.fromArray(grips.gun.view.pos));
    const cv = grips.camera.view;
    put(this.items.camera, cv, _rest.fromArray(cv.pos).lerp(_eye.fromArray(cv.aim ?? cv.pos), k));
  }

  spawn(at: THREE.Vector3, yaw: number) {
    this.pos.copy(at).setY(0);
    this.yaw = yaw;
    this.pitch = 0;
    this.velY = 0;
    this.ground = true;
    this.falling = this.fell = false;
  }

  private blocked(x: number, z: number) {
    const w = this.world;
    return w.solid(x - R, z - R) || w.solid(x + R, z - R) || w.solid(x - R, z + R) || w.solid(x + R, z + R) || w.furniture(x, z, R);
  }

  update(dt: number, c: Controls) {
    if (this.dead) return this.fall(dt);
    if (this.frozen) c = { ...c, move: new THREE.Vector2(), look: new THREE.Vector2(), jump: false, flash: false, swap: false, aim: false };
    const hs = this.hideState;
    if (hs !== 'out') c = { ...c, move: new THREE.Vector2(), jump: false, flash: false, swap: false, aim: false, run: false };
    // mirar por la cámara: se sube al ojo, la vista se cierra y, ya arriba, se mira a través (el modelo se esconde)
    const want = c.aim && this.hand === 'camera';
    this.aimK = THREE.MathUtils.clamp(this.aimK + (want ? dt : -dt) * 6, 0, 1);
    this.aiming = this.aimK > 0.85;
    this.zoom = this.aiming ? THREE.MathUtils.clamp(this.zoom + c.zoom * 0.5, 1, 4) : 1;
    const k = this.aimK * this.aimK * (3 - 2 * this.aimK);
    this.placeItems(k);
    this.items.camera.visible = this.hand === 'camera' && !this.aiming;
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(settings.fov / 2)) / THREE.MathUtils.lerp(1, this.zoom * 1.25, k)));
    if (Math.abs(fov - this.camera.fov) > 0.01) (this.camera.fov = fov), this.camera.updateProjectionMatrix();
    this.yaw -= c.look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch - c.look.y, -1.45, 1.45);
    if (hs === 'hidden') {
      // dentro, mirando hacia la salida: ±70° de lado y poco arriba o abajo
      this.yaw = this.hideYaw + THREE.MathUtils.clamp(wrap(this.yaw - this.hideYaw), -70 * D, 70 * D);
      this.pitch = THREE.MathUtils.clamp(this.pitch, -0.7, 0.7);
    }
    if (c.flash) this.toggleLight();
    if (this.lightOn) {
      this.charge = Math.max(0, this.charge - dt / this.life);
      if (this.charge === 0) this.flashOn = false;
    }
    if (c.swap) this.swap();

    // andar: hacia donde se mira, chocando eje a eje con las paredes
    const moving = c.move.length() > 0.05, run = c.run && moving && !this.winded;
    // ~9 s corriendo; se recupera en ~6 s andando y ~4 s parado; agotado, no se corre hasta el 30 %
    this.stamina = THREE.MathUtils.clamp(this.stamina + dt * (run ? -1 / 9 : moving ? 1 / 6 : 1 / 4), 0, 1);
    if (this.stamina <= 0) this.winded = true;
    else if (this.stamina > 0.3) this.winded = false;
    const speed = moving ? (run ? RUN : WALK) * Math.min(1, c.move.length()) : 0;
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
    const v = f.multiplyScalar(c.move.y).add(r.multiplyScalar(c.move.x));
    if (v.lengthSq() > 0) v.normalize().multiplyScalar(speed * dt);
    if (!this.blocked(this.pos.x + v.x, this.pos.z)) this.pos.x += v.x;
    if (!this.blocked(this.pos.x, this.pos.z + v.z)) this.pos.z += v.z;
    this.speed = speed;

    // saltar y caer: sobre un hueco no hay suelo
    if (c.jump && this.ground && !this.falling) (this.velY = JUMP), (this.ground = false);
    const floor = this.falling || this.world.voidAt(this.pos.x, this.pos.z) ? -Infinity : 0;
    this.velY -= G * dt;
    this.pos.y += this.velY * dt;
    if (this.pos.y <= floor) (this.pos.y = floor), (this.velY = 0), (this.ground = true);
    else if (this.pos.y < -0.2) this.falling = true;
    if (this.pos.y < -3 && !this.fell) (this.fell = true), this.onFall?.();

    // el escondite: de la boca al fondo (o al revés) en 0,4 s, y la vista se agacha (hk: 0 de pie, 1 dentro)
    let hk = hs === 'hidden' ? 1 : 0;
    if (hs === 'in' || hs === 'leaving') {
      this.hideK = Math.min(1, this.hideK + dt / 0.4);
      const e = this.hideK * this.hideK * (3 - 2 * this.hideK);
      this.pos.lerpVectors(this.hideFrom, this.hideTo, e);
      this.pos.y = 0;
      this.velY = 0;
      if (hs === 'in') this.yaw = this.hideYaw + this.hideYaw0 * (1 - e); // se da la vuelta: de cara a la salida
      hk = hs === 'in' ? e : 1 - e;
      if (this.hideK >= 1) {
        this.hideState = hs === 'in' ? 'hidden' : 'out';
        if (hs === 'leaving') this.flashOn = this.flashWas && this.charge > 0;
      }
    }
    // recoger: sube y baja en REACH_T; a mitad, la mano llega y el objeto es suyo
    let rk = 0;
    if (this.reachAt) {
      this.reachT += dt;
      if (this.reachT >= REACH_T / 2 && this.reachCb) this.reachCb(), (this.reachCb = undefined);
      if (this.reachT >= REACH_T) this.reachAt = undefined;
      else rk = Math.sin((Math.PI * this.reachT) / REACH_T);
    }
    // el cuerpo: detrás de los ojos, mirando hacia donde se mira (los de Mixamo miran a +z); al mirar
    // abajo se retrasa (y el ojo se adelanta, sobre el cuello), que no se vea por dentro
    const down = Math.max(0, -this.pitch) / 1.45;
    const body = this.rig.root, back = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(0.16 + 0.2 * down);
    body.position.copy(this.pos).add(back);
    body.position.y -= 0.45 * rk + 0.9 * hk;
    body.rotation.y = this.yaw + Math.PI;
    body.visible = hk < 0.3;
    const idle = this.hand === 'gun' ? 'Rifle Idle' : 'Neutral Idle';
    this.busy -= dt;
    if (this.busy <= 0) {
      const a = this.rig.play(speed > 2 ? 'Slow Run' : speed > 0 ? 'Walking222' : idle);
      if (a) a.timeScale = speed > 0 ? speed / (speed > 2 ? RUN : WALK) : 1;
    }
    this.rig.update(dt);
    this.bones.Head?.scale.setScalar(0.001);
    // con la cámara en el ojo, los brazos no se ven (estarían delante de la lente)
    for (const s of ['LeftArm', 'RightArm']) this.bones[s]?.scale.setScalar(this.aiming ? 0.001 : 1);
    this.bones.Neck?.scale.setScalar(0.5);

    // la cámara: los ojos, con el vaivén de una cámara de mano al andar
    this.bob += dt * (speed > 2 ? 11 : 7) * (speed > 0 ? 1 : 0);
    const amp = this.reduced || !this.ground ? 0 : speed > 2 ? 0.045 : speed > 0 ? 0.025 : 0;
    const neck = Math.sin(down * 1.45) * 0.12;
    // (agachado en un nicho, algo hacia el fondo: de espaldas a la salida)
    const bx = Math.sin(this.hideYaw) * 0.32 * hk, bz = Math.cos(this.hideYaw) * 0.32 * hk;
    this.camera.position.set(this.pos.x - Math.sin(this.yaw) * neck + bx, this.pos.y + EYE - 0.5 * rk - 0.82 * hk + Math.sin(this.bob * 2) * amp, this.pos.z - Math.cos(this.yaw) * neck + bz);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    // al recoger, la vista se va al objeto
    let pitch = this.pitch;
    if (this.reachAt) {
      const d = Math.hypot(this.reachAt.x - this.camera.position.x, this.reachAt.z - this.camera.position.z);
      pitch = THREE.MathUtils.lerp(this.pitch, Math.atan2(this.reachAt.y - this.camera.position.y, d), rk * 0.85);
    }
    this.camera.rotation.set(pitch + this.recoil * 0.06, this.yaw, Math.sin(this.bob) * amp * 0.3, 'YXZ');
    this.camera.updateMatrixWorld();

    // los brazos, a sus agarres: la muñeca al punto, la mano con su orientación y los dedos cerrados (ver ik.ts y grips.ts)
    const q = this.camera.quaternion;
    const grip = (side: 'Left' | 'Right', item: THREE.Object3D, h: Hand) => {
      const arm = this.bones[side + 'Arm'], fore = this.bones[side + 'ForeArm'], hand = this.bones[side + 'Hand'];
      if (!arm || !fore || !hand) return;
      const pole = arm.getWorldPosition(new THREE.Vector3()).add(V(...h.pole).applyQuaternion(q));
      item.updateWorldMatrix(true, false);
      const want = item.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(h.rot[0] * D, h.rot[1] * D, h.rot[2] * D)));
      solveArm({ shoulder: this.rig.bone(side + 'Shoulder'), arm, fore, hand }, item.localToWorld(V(...h.pos)), pole, want);
      poseFingers((n) => this.rig.bone(n), side, h.curl, h.spread);
    };
    const two = this.hand === 'gun' || (this.hand === 'camera' && this.aiming);
    const lamp = this.left === 'flashlight' && hk < 0.3;
    this.items.flashlight.visible = lamp && !two;
    if (!two && lamp && grips.flashlight.left) grip('Left', this.items.flashlight, grips.flashlight.left);
    if (this.hand !== 'none' && hk < 0.3) {
      const it = this.items[this.hand], g = grips[this.hand];
      it.visible = !rk && !(this.hand === 'camera' && this.aiming); // la derecha suelta lo que lleva mientras recoge
      if (!rk && g.right) grip('Right', it, g.right);
      if (two && g.left) grip('Left', it, g.left);
    }
    if (hk >= 0.3) for (const it of Object.values(this.items)) it.visible = false;
    if (rk && this.reachAt) {
      // la mano derecha, de su sitio en reposo hasta el objeto, con los dedos hacia abajo
      const arm = this.bones.RightArm, fore = this.bones.RightForeArm, hand = this.bones.RightHand;
      if (arm && fore && hand) {
        // hacia el objeto, hasta donde llega el brazo (y se vea en cuadro): medio metro desde el ojo
        const eye = this.camera.position, dir = this.reachAt.clone().sub(eye), far = Math.min(0.5, dir.length());
        const rest = this.camera.localToWorld(V(0.2, -0.32, -0.3)), to = rest.lerp(eye.clone().addScaledVector(dir.normalize(), far).add(V(0.06, 0, 0)), rk);
        const pole = arm.getWorldPosition(new THREE.Vector3()).add(V(0.5, -0.6, 0.2).applyQuaternion(q));
        solveTwoBone(arm, fore, hand, to, pole, this.bones.RightHandMiddle1, V(0, -1, 0).lerp(V(0, 0, -1).applyQuaternion(q), 0.4).normalize());
      }
    }

    // las pilas se acaban: por debajo del 25 % da menos y a ratos parpadea
    const low = this.charge < 0.25, flick = low && Math.random() > 0.3 + this.charge * 2 ? 0.15 : 1;
    const dim = (0.35 + 0.65 * Math.min(1, this.charge / 0.25)) * flick;
    this.flash.intensity = this.lightOn ? 26 * dim : 0;
    this.lens?.emissive.setScalar(this.lightOn ? dim : 0.04);
  }

  /**
   * Muerto: el cuerpo entero se ve (con la cabeza) y cae de espaldas: con el clip de muerte de Mixamo
   * si lo hay; si no, se desploma por código, girando sobre los pies.
   */
  private fall(dt: number) {
    const first = this.deadT === 0;
    this.deadT += dt;
    this.rig.root.visible = true;
    if (first) for (const it of Object.values(this.items)) it.visible = false;
    const body = this.rig.root, back = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(0.16);
    body.position.copy(this.pos).add(back);
    const clip = ['Dying', 'Falling Back Death', 'Death'].find((n) => this.rig.action(n));
    if (clip) {
      if (first) this.rig.play(clip, 0.1, true);
      body.rotation.set(0, this.yaw + Math.PI, 0);
    } else {
      const k = Math.min(1, this.deadT / 0.75);
      body.rotation.set(-k * k * (Math.PI / 2) * 0.96, this.yaw + Math.PI, 0, 'YXZ');
      if (first) this.rig.play('Neutral Idle', 0.2);
    }
    this.rig.update(dt);
    for (const s of ['Head', 'Neck', 'LeftArm', 'RightArm']) this.bones[s]?.scale.setScalar(1);
  }

  /** Se mete en el nicho `h` (centro y yaw de salida, ver HideState): entra en 0,4 s, la linterna se apaga. */
  enterHide(h: { x: number; z: number; yaw: number }) {
    if (this.hideState !== 'out' || this.frozen || this.dead) return;
    this.hideState = 'in';
    this.hideK = 0;
    this.hideFrom.copy(this.pos);
    this.hideTo.set(h.x, 0, h.z);
    this.hideYaw = h.yaw;
    this.hideYaw0 = wrap(this.yaw - h.yaw);
    this.flashWas = this.flashOn;
    this.flashOn = false;
    this.aiming = false;
  }
  /** Sale a la boca del nicho (`fx`, `fz`: el centro de su celda). */
  leaveHide(h: { fx: number; fz: number }) {
    if (this.hideState !== 'hidden') return;
    this.hideState = 'leaving';
    this.hideK = 0;
    this.hideFrom.copy(this.pos);
    this.hideTo.set(h.fx, 0, h.fz);
  }
  /** Fuera del nicho ya (te han encontrado): de pie en la boca. */
  cancelHide(h: { fx: number; fz: number }) {
    if (this.hideState === 'out') return;
    if (this.hideState !== 'leaving' || this.hideK < 1) this.pos.set(h.fx, 0, h.fz);
    this.hideState = 'out';
    this.rig.root.visible = true;
    this.flashOn = this.flashWas && this.charge > 0;
  }
  /** Escondido de verdad (dentro): no cuenta como objetivo. */
  get concealed() {
    return this.hideState === 'hidden';
  }

  /** Donde queda el cuerpo tirado (el centro, en el suelo). */
  get corpse() {
    return this.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(0.9));
  }

  /** Una animación de una vez sobre el cuerpo (recoger, recargar): manda hasta que acaba. */
  /** Recoger lo que hay en `at`: `grab` se llama cuando la mano llega (a mitad del gesto). */
  reach(at: THREE.Vector3, grab: () => void) {
    if (this.reachAt) return false;
    this.reachAt = at.clone();
    this.reachT = 0;
    this.reachCb = grab;
    return true;
  }

  act(name: string) {
    const a = this.rig.play(name, 0.15, true);
    if (a) (a.timeScale = 1.6), (this.busy = a.getClip().duration / 1.6);
  }

  /** El retroceso del disparo: la vista salta un poco hacia arriba y el rifle hacia atrás. */
  kick() {
    this.recoil = 1;
  }

  hold(h: Player['hand']) {
    this.hand = h;
    this.items.camera.visible = h === 'camera';
    if (h !== 'camera') this.aimK = 0;
    this.items.gun.visible = h === 'gun';
  }

  /** F o el interruptor: enciende o apaga; con la linterna gastada, saca una de repuesto si hay. */
  toggleLight() {
    if (this.left !== 'flashlight') return;
    if (this.charge <= 0) {
      if (this.spares <= 0) return;
      this.spares--;
      this.charge = 1;
      this.flashOn = true;
    } else this.flashOn = !this.flashOn;
  }

  /** La linterna da luz: encendida y en la mano izquierda. */
  get lightOn() {
    return this.flashOn && this.left === 'flashlight';
  }

  /** Q o la rueda: lo de la mano derecha al cinturón y lo del cinturón a la mano. */
  swap() {
    const b = this.belt;
    this.belt = this.hand;
    this.hold(b);
  }

  /** Poner `it` en `slot` (o vaciarlo con 'none'): sale de donde estuviera; lo que había, al almacén. */
  place(slot: Slot, it: Gear | 'none') {
    if (it !== 'none') {
      if (!FITS[slot].includes(it) || (it !== 'flashlight' && !this.has[it])) return false;
      if (this.hand === it) this.hold('none');
      if (this.belt === it) this.belt = 'none';
      if (this.left === it) this.left = 'none';
    }
    if (slot === 'right') this.hold(it as Player['hand']);
    else if (slot === 'belt') this.belt = it as Player['belt'];
    else this.left = it as Player['left'];
    return true;
  }

  /** Lo recién cogido: a la mano si está libre, si no al cinturón, si no al almacén. */
  stow(it: 'camera' | 'gun') {
    if (this.hand === 'none') this.hold(it);
    else if (this.belt === 'none') this.belt = it;
  }

  dispose() {
    for (const it of Object.values(this.items)) it.removeFromParent();
    this.rig.root.removeFromParent();
    this.rig.mixer.stopAllAction();
  }
}

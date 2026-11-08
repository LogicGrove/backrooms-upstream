import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Animator } from './anim/animator';
import { packNow } from './anim/core';

/*
 * Lo que comparten el jugador y las entidades: un personaje de Mixamo clonado con su mezclador y sus
 * clips (por nombre de archivo), andar y correr sin desplazarse (la posición la lleva el juego) y
 * cruces entre clips.
 */

/** Quita el avance de la cadera en x/z: el clip se queda en el sitio (la altura, que bota, sí). */
function inPlace(clip: THREE.AnimationClip) {
  const c = clip.clone();
  for (const t of c.tracks) {
    if (!/Hips\.position$/.test(t.name)) continue;
    const v = t.values, x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) (v[i] = x0), (v[i + 2] = z0);
  }
  return c;
}

export class Rig {
  readonly root: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  current?: THREE.AnimationAction;

  constructor(gltf: GLTF) {
    this.root = clone(gltf.scene);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.frustumCulled = false; // con piel, la caja de la pose de reposo engaña
    });
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const c of gltf.animations) this.actions.set(c.name, this.mixer.clipAction(inPlace(c)));
  }

  bone(name: string) {
    return this.root.getObjectByName('mixamorig' + name) as THREE.Bone | undefined;
  }

  action(name: string) {
    return this.actions.get(name);
  }

  /** Con el Animator (anim/animator.ts) puesto, él lleva el cuerpo: andar, correr, saltar, agacharse y bailes son parámetros suyos. */
  animator?: Animator;
  private legacy = false;
  private legacyT = 0;
  /** Pone el Animator si el paquete de animaciones ya está bajado (si no, el cuerpo sigue con los clips del modelo). */
  useAnimator() {
    const pk = packNow();
    if (pk && !this.animator) this.animator = new Animator(this.root, pk);
    return this.animator;
  }

  /**
   * Pasa a un clip del modelo con un cruce; `once` lo deja quieto en su último fotograma. Con Animator solo valen los clips
   * de un golpe (coger, morir…): mientras duran mandan ellos; los continuos (andar, quieto) los lleva el Animator y se ignoran.
   */
  play(name: string, fade = 0.2, once = false) {
    const a = this.actions.get(name);
    if (this.animator) {
      if (!once) return (this.legacy = false), a;
      if (!a) return a;
      this.legacy = true;
      this.legacyT = 0;
    }
    if (!a || a === this.current) return a;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.enabled = true;
    a.play();
    if (this.current) a.crossFadeFrom(this.current, fade, false);
    this.current = a;
    return a;
  }

  update(dt: number) {
    const A = this.animator;
    if (A && !this.legacy) return A.update(dt);
    this.mixer.update(dt);
    if (A && this.current) {
      // un clip de un golpe del modelo: acabado (menos la muerte, que se queda), el Animator vuelve a llevar el cuerpo
      this.legacyT += dt * Math.abs(this.current.timeScale);
      if (this.legacyT >= this.current.getClip().duration && !/Dying|Death/.test(this.current.getClip().name)) (this.legacy = false), this.current.stop(), (this.current = undefined);
    }
  }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _p = new THREE.Quaternion();
/** Gira `bone` para que su hijo quede en la dirección `dir` (en el mundo). Tras el mezclador. */
export function aim(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) {
  bone.updateWorldMatrix(true, true);
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  const cur = _b.sub(_a).normalize();
  _q.setFromUnitVectors(cur, dir);
  bone.getWorldQuaternion(_p);
  _p.premultiply(_q);
  bone.parent!.getWorldQuaternion(_q).invert();
  bone.quaternion.copy(_q.multiply(_p));
  bone.updateWorldMatrix(false, true);
}

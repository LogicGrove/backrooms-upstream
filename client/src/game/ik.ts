import * as THREE from 'three';
import { aim } from './rig';

/*
 * IK de brazo para que las manos cojan de verdad lo que llevan. Va después del mezclador, encima de la
 * animación, y hace cuatro cosas que el de dos huesos de antes no hacía:
 *  - la mano entera, con su orientación (no solo la muñeca): se le da un cuaternión del mundo;
 *  - el giro que falta entre antebrazo y mano se reparte entre los dos (sin torsión de muñeca, el
 *    «caramelo» que se retuerce);
 *  - si el objetivo queda fuera de alcance, el hombro ayuda un poco en vez de estirar el brazo hasta
 *    dejar la mano colgando;
 *  - los dedos se curvan uno a uno.
 */

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _e = new THREE.Vector3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _p = new THREE.Quaternion(), _r = new THREE.Quaternion(), _w = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);

export interface ArmBones {
  shoulder?: THREE.Bone;
  arm: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
}

/** Pone el cuaternión del mundo `world` a `bone` (descontando el de su padre). */
function setWorldQuat(bone: THREE.Object3D, world: THREE.Quaternion) {
  bone.parent!.updateWorldMatrix(true, false);
  bone.parent!.getWorldQuaternion(_w).invert();
  bone.quaternion.copy(_w.multiply(world));
  bone.updateWorldMatrix(false, true);
}

/**
 * Lleva la muñeca a `target` doblando el codo hacia `pole` (todo en el mundo). Con `handQuat` (el
 * cuaternión del mundo que se quiere para la mano) la orienta y reparte el giro con el antebrazo; `twist`
 * es la parte que se lleva el antebrazo (0–1). Sin él, la mano solo apunta `finger` hacia `fingers`.
 */
export function solveArm(b: ArmBones, target: THREE.Vector3, pole: THREE.Vector3, handQuat?: THREE.Quaternion, twist = 0.55, finger?: THREE.Object3D, fingers?: THREE.Vector3) {
  const { shoulder, arm, fore, hand } = b;
  (shoulder ?? arm).updateWorldMatrix(true, true);
  arm.getWorldPosition(_a);
  fore.getWorldPosition(_b);
  hand.getWorldPosition(_c);
  const l1 = _a.distanceTo(_b), l2 = _b.distanceTo(_c);
  // fuera de alcance: el hombro adelanta el brazo hasta 10 cm hacia el objetivo
  if (shoulder) {
    const extra = _a.distanceTo(target) - (l1 + l2) * 0.95;
    if (extra > 0) {
      shoulder.getWorldPosition(_e);
      _d.copy(target).sub(_a).normalize();
      aim(shoulder, arm, _t.copy(_a).addScaledVector(_d, Math.min(extra, 0.1)).sub(_e).normalize());
      arm.getWorldPosition(_a);
      fore.getWorldPosition(_b);
    }
  }
  // ni más estirado de lo que da, ni tan plegado que el codo se salga
  const dist = THREE.MathUtils.clamp(_a.distanceTo(target), Math.abs(l1 - l2) * 1.05 + 0.02, (l1 + l2) * 0.999);
  _d.copy(target).sub(_a).normalize();
  // la dirección en que se dobla: hacia el polo, quitándole lo que va a lo largo del brazo
  _n.copy(pole).sub(_a);
  _n.addScaledVector(_d, -_n.dot(_d)).normalize();
  const cos = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1), sin = Math.sqrt(1 - cos * cos);
  _e.copy(_a).addScaledVector(_d, l1 * cos).addScaledVector(_n, l1 * sin);
  aim(arm, fore, _t.copy(_e).sub(_a).normalize());
  fore.getWorldPosition(_b);
  aim(fore, hand, _t.copy(target).sub(_b).normalize());
  if (handQuat) {
    // el giro que le falta a la mano respecto al antebrazo, sobre el eje del antebrazo: se reparte
    fore.getWorldQuaternion(_p);
    _r.copy(handQuat).multiply(_q.copy(_p).invert());
    fore.getWorldPosition(_b);
    hand.getWorldPosition(_c);
    _d.copy(_c).sub(_b).normalize();
    let tw = 2 * Math.atan2(_r.x * _d.x + _r.y * _d.y + _r.z * _d.z, _r.w);
    tw = THREE.MathUtils.euclideanModulo(tw + Math.PI, Math.PI * 2) - Math.PI;
    setWorldQuat(fore, _q.setFromAxisAngle(_d, tw * twist).multiply(_p));
    setWorldQuat(hand, handQuat);
  } else if (finger && fingers) aim(hand, finger, fingers);
}

const NAMES = ['Index', 'Middle', 'Ring', 'Pinky'] as const;
const WEIGHT = [1, 1, 0.8]; // lo que cada falange sigue a la curvatura del dedo
/** Cuánto gira cada lado en su eje: en Mixamo curvar los dedos de una mano y de la otra va en sentidos distintos. */
const SIGN = { Left: 1, Right: 1 };

/**
 * Curva los dedos de una mano: `curl` = pulgar, índice, corazón, anular, meñique (radianes); `spread`, lo
 * que se abre el pulgar. `bone` busca un hueso por su nombre sin el prefijo (p. ej. 'LeftHandIndex2').
 */
export function poseFingers(bone: (n: string) => THREE.Bone | undefined, side: 'Left' | 'Right', curl: number[], spread: number) {
  const s = SIGN[side];
  NAMES.forEach((n, i) => {
    for (let j = 1; j <= 3; j++) bone(`${side}Hand${n}${j}`)?.quaternion.setFromAxisAngle(X, s * curl[i + 1] * WEIGHT[j - 1]);
  });
  // el pulgar: la primera falange se abre hacia fuera (eje Z) y se cierra (eje X); las otras dos, solo se cierran
  const t1 = bone(`${side}HandThumb1`), t2 = bone(`${side}HandThumb2`), t3 = bone(`${side}HandThumb3`);
  t1?.quaternion.setFromAxisAngle(Z, s * spread).multiply(_q.setFromAxisAngle(X, s * curl[0] * 0.5));
  t2?.quaternion.setFromAxisAngle(X, s * curl[0] * 0.7);
  t3?.quaternion.setFromAxisAngle(X, s * curl[0] * 0.7);
  (t1 ?? t2)?.updateWorldMatrix(false, true);
}

/** El IK de dos huesos de antes (solo muñeca y dedos hacia una dirección): lo usa la herramienta de agarres para partir de lo que había. */
export function solveTwoBone(arm: THREE.Bone, fore: THREE.Bone, hand: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3, finger?: THREE.Object3D, fingers?: THREE.Vector3) {
  solveArm({ arm, fore, hand }, target, pole, undefined, 0, finger, fingers);
}

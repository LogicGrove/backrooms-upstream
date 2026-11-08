import * as THREE from 'three';
import raw from './worn.json';

/*
 * Lo que se lleva puesto en el cuerpo (hoy: la bombona de buceo a la espalda), con su sitio editable en Anim Studio (IK → grips → tank).
 * Son datos (worn.json), como grips.json. `pos` va en el marco del cuerpo respecto a Spine2 (x lado, y arriba, z hacia delante), `rot` en grados y
 * `size` es la altura del objeto en metros.
 */
export interface WornItem {
  pos: [number, number, number];
  rot: [number, number, number];
  size: number;
}
export const DEFAULT_WORN = raw as unknown as Record<'tank', WornItem>;
export const worn: Record<'tank', WornItem> = structuredClone(DEFAULT_WORN);

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _e = new THREE.Euler();
const D = Math.PI / 180;

/** El modelo de la bombona, de pie, centrado y de 1 m de alto (el tamaño real lo pone `placeWorn`). */
export function wornModel(src: THREE.Object3D) {
  const t = src.clone(true), g = new THREE.Group(), d = new THREE.Box3().setFromObject(t).getSize(_v);
  if (d.z > d.y) t.rotation.x = -Math.PI / 2; // el lado largo, vertical
  g.add(t);
  const b = new THREE.Box3().setFromObject(g), k = 1 / Math.max(b.max.y - b.min.y, 1e-6), c = b.getCenter(new THREE.Vector3());
  t.scale.multiplyScalar(k), t.position.sub(c.multiplyScalar(k));
  return new THREE.Group().add(g);
}

/** Pone un objeto llevado en el cuerpo: respecto a `spine`, girado con el cuerpo `root`. */
export function placeWorn(obj: THREE.Object3D, w: WornItem, root: THREE.Object3D, spine: THREE.Object3D) {
  root.getWorldQuaternion(_q);
  spine.getWorldPosition(obj.position).add(_v.set(...w.pos).applyQuaternion(_q));
  obj.quaternion.copy(_q).multiply(new THREE.Quaternion().setFromEuler(_e.set(w.rot[0] * D, w.rot[1] * D, w.rot[2] * D)));
  obj.scale.setScalar(w.size);
}

import * as THREE from 'three';

/*
 * Una entidad que revienta: su pose de ese instante (con la piel aplicada) se parte en 40–60 trozos
 * de triángulos vecinos que salen volando desde el impacto, rebotan en el suelo y giran; a los 4 s
 * empiezan a encogerse y a los 5 s se van. Los trozos son mallas sin piel con el mismo material: ese
 * programa se compila en la carga (ver `warm`).
 */

interface Chunk {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  w: THREE.Vector3;
}

const CELLS = 4; // la caja del cuerpo, partida en 4 × 4 × 4 celdas: los triángulos de cada una, un trozo

export class Shatter {
  readonly root = new THREE.Group();
  private chunks: Chunk[] = [];
  private t = 0;

  constructor(body: THREE.Object3D, from: THREE.Vector3) {
    body.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(body), size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.01, 0.01, 0.01));
    const p = new THREE.Vector3();
    body.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index;
      const tri = idx ? idx.count / 3 : pos.count / 3;
      const bins = new Map<number, { p: number[]; uv: number[] }>();
      const world = (i: number) => mesh.localToWorld(mesh.getVertexPosition(i, p)).clone(); // con la piel aplicada
      for (let t = 0; t < tri; t++) {
        const ids = [0, 1, 2].map((k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k));
        const vs = ids.map(world), c = vs[0].clone().add(vs[1]).add(vs[2]).divideScalar(3).sub(box.min).divide(size);
        const key = [c.x, c.y, c.z].map((x) => Math.min(CELLS - 1, Math.max(0, Math.floor(x * CELLS)))).reduce((a, b) => a * CELLS + b, 0);
        const bin = bins.get(key) ?? { p: [], uv: [] };
        vs.forEach((v, k) => (bin.p.push(v.x, v.y, v.z), uv && bin.uv.push(uv.getX(ids[k]), uv.getY(ids[k]))));
        bins.set(key, bin);
      }
      for (const bin of bins.values()) {
        const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(bin.p, 3));
        if (bin.uv.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(bin.uv, 2));
        geo.computeBoundingBox();
        const c = geo.boundingBox!.getCenter(new THREE.Vector3());
        geo.translate(-c.x, -c.y, -c.z);
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, mesh.material);
        m.position.copy(c);
        this.root.add(m);
        // hacia fuera desde el impacto, y hacia arriba
        const out = c.clone().sub(from).setY(0).normalize().multiplyScalar(2 + Math.random() * 3.5);
        out.y = 2 + Math.random() * 3;
        this.chunks.push({ mesh: m, v: out, w: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14) });
      }
    });
  }

  /** false cuando ya no queda nada (y se ha liberado). */
  update(dt: number) {
    this.t += dt;
    for (const c of this.chunks) {
      c.v.y -= 9.8 * dt;
      c.mesh.position.addScaledVector(c.v, dt);
      c.mesh.rotation.x += c.w.x * dt;
      c.mesh.rotation.y += c.w.y * dt;
      c.mesh.rotation.z += c.w.z * dt;
      if (c.mesh.position.y < 0.05) {
        c.mesh.position.y = 0.05;
        c.v.y = Math.abs(c.v.y) * 0.35;
        c.v.x *= 0.6;
        c.v.z *= 0.6;
        c.w.multiplyScalar(0.6);
      }
      if (this.t > 4) c.mesh.scale.setScalar(Math.max(0.001, 1 - (this.t - 4)));
    }
    if (this.t < 5) return true;
    this.dispose();
    return false;
  }

  dispose() {
    for (const c of this.chunks) c.mesh.geometry.dispose();
    this.root.removeFromParent();
  }

  /** Para compilar en la carga: un trozo de cada material de estos cuerpos, como malla sin piel. */
  static warm(bodies: THREE.Object3D[]) {
    const g = new THREE.Group(), tri = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    tri.computeVertexNormals();
    for (const b of bodies) b.traverse((o) => (o as THREE.Mesh).isMesh && g.add(new THREE.Mesh(tri, (o as THREE.Mesh).material)));
    return g;
  }
}

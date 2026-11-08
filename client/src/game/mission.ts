import * as THREE from 'three';
import { DIRS, TV_REACH, tvPoint, tvSites } from '@backrooms/shared';
import type { Controls } from './input';
import type { Player } from './player';
import type { World } from './world';
import type { Assets } from './game';
import type { GameAudio } from './audio';

/*
 * La misión «TURN OFF THE TVS»: las televisiones CRT que hay que apagar (las N de tvSites, bien repartidas por el mapa). Son las mismas que
 * dibuja world.ts sobre los escritorios; encima se pone el resplandor azul de la pantalla encendida y, con G cerca y mirándola, se apaga.
 * En una sala el apagado se reclama al servidor (`claim`) y el estado de todas llega en el snapshot del mundo (`sync`); solo, se lleva aquí.
 * Mientras alguna está encendida suena estática (más fuerte cuanto más cerca) y su luz azulada se ve de lejos.
 */

/** Un disco de luz difusa (centro blanco, borde transparente) para el resplandor. */
function haloTexture() {
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Tv {
  at: THREE.Vector3;
  group: THREE.Group;
  screen: THREE.Mesh;
  halo: THREE.Sprite;
  on: boolean;
  /** Pedido al servidor, sin respuesta aún. */
  pending?: boolean;
}

export class Tvs {
  readonly root = new THREE.Group();
  /** «TURN OFF TV» mientras se apunta a una encendida. */
  hint: string | null = null;
  /** En una sala: pedir al servidor apagar la número `i`. */
  claim?: (i: number, done: (ok: boolean) => void) => void;
  private tvs: Tv[] = [];
  private t = 0;
  private flick = Math.random() * 10;

  constructor(private world: World, assets: Assets, goal: number) {
    const m = world.maze, sites = tvSites(m, goal);
    // el tamaño de la pantalla, según el modelo: la cara que mira al cuarto (+z local) y su ancho y alto
    const box = new THREE.Box3().setFromObject(assets.gltf.crt.scene), sz = box.getSize(new THREE.Vector3());
    const w = Math.max(0.2, sz.x * 0.62), h = Math.max(0.2, sz.y * 0.55);
    const mat = new THREE.MeshBasicMaterial({ color: 0x7db4ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const halo = new THREE.SpriteMaterial({ map: haloTexture(), color: 0x5f9bff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    sites.forEach((s) => {
      const p = tvPoint(s), [dx, dy] = DIRS[s.rot] ?? DIRS[0], g = new THREE.Group();
      g.position.set(p.x, 0.9, p.z);
      g.rotation.y = Math.atan2(-dx, -dy); // +z local mira al cuarto, como el modelo
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat.clone());
      screen.position.set(0, box.min.y + sz.y * 0.55, box.max.z + 0.01);
      const hl = new THREE.Sprite(halo.clone());
      hl.scale.setScalar(1.6);
      hl.position.set(0, box.min.y + sz.y * 0.55, box.max.z + 0.25);
      g.add(screen, hl);
      this.root.add(g);
      this.tvs.push({ at: new THREE.Vector3(p.x, 1.15, p.z), group: g, screen, halo: hl, on: true });
    });
    world.root.add(this.root);
  }

  get total() {
    return this.tvs.length;
  }
  get off() {
    return this.tvs.filter((t) => !t.on).length;
  }

  private turnOff(i: number, audio?: GameAudio) {
    const t = this.tvs[i];
    if (!t?.on) return;
    t.on = false;
    t.group.visible = false;
    audio?.tvOff();
  }

  /** Lo que dice el servidor: los índices de las ya apagadas. */
  sync(off: number[], audio?: GameAudio) {
    for (const i of off) this.turnOff(i, audio);
  }

  /** La más cerca encendida, a menos de TV_REACH y de frente. */
  private nearest(p: Player) {
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    let best = -1, bd = Infinity;
    this.tvs.forEach((t, i) => {
      if (!t.on || t.pending) return;
      const dx = t.at.x - p.pos.x, dz = t.at.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > TV_REACH || (d > 0.4 && (dx * fx + dz * fz) / d < 0.5)) return;
      if (d < bd) (bd = d), (best = i);
    });
    return best;
  }

  /** Cada fotograma: el parpadeo de las encendidas, la estática y G para apagar. Devuelve los mandos sin `grab` si G se ha usado aquí. */
  update(dt: number, p: Player, c: Controls, audio?: GameAudio): Controls {
    this.t += dt;
    let near = Infinity;
    for (const t of this.tvs) {
      if (!t.on) continue;
      const k = 0.75 + 0.25 * Math.sin(this.t * 31 + this.flick) * Math.sin(this.t * 7.3) + (Math.random() - 0.5) * 0.25;
      (t.screen.material as THREE.MeshBasicMaterial).opacity = 0.5 * k;
      (t.halo.material as THREE.SpriteMaterial).opacity = 0.42 * k;
      near = Math.min(near, Math.hypot(t.at.x - p.pos.x, t.at.z - p.pos.z));
    }
    audio?.tvStatic(near === Infinity ? 0 : Math.max(0, 1 - near / 9));
    const i = p.dead || p.frozen ? -1 : this.nearest(p);
    this.hint = i >= 0 ? 'TURN OFF TV' : null;
    if (i < 0 || !c.grab) return c;
    const t = this.tvs[i];
    if (this.claim) {
      t.pending = true;
      this.claim(i, (ok) => {
        t.pending = false;
        if (ok) this.turnOff(i, audio);
      });
    } else this.turnOff(i, audio);
    return { ...c, grab: false };
  }

  dispose() {
    this.root.removeFromParent();
  }
}

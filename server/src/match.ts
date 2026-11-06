import {
  Breath, seesXZ, CELL, DIFFICULTY, EntitySim, TAPES_NEEDED, centerOf, generateMaze, hideStates, itemSpots, solidAt, tickHides,
  type Difficulty, type Look, type HideState, type EntState, type ItemSpot, type Kind, type Maze, type PlayerState, type SimTarget, type WorldSnapshot,
} from '@backrooms/shared';

/*
 * Lo que el servidor sabe de una partida en marcha: el mapa de la semilla, los objetos que quedan, las
 * entidades (su IA es la de shared/sim.ts) y quién ha caído. Todo lo decide aquí; los clientes pintan.
 */

const EYE = 1.62;
const PICK_REACH = 3.6; // m en el suelo: el alcance del cliente (2,4) más lo que se mueve entre mensajes
const SHOT_REACH = 32;
const PHOTO_REACH = 50; // m: 15 del visor por la raíz del zoom máximo, con margen
const PHOTO_COS = Math.cos((24 * Math.PI) / 180); // el visor cierra 12° como mucho; aquí se perdona el doble por la red

export interface Player {
  id: string;
  name: string;
  st: PlayerState;
  dead: boolean;
  lastChat: number;
  lastHit: number;
  /** Ya mandó su primer estado de la partida. */
  seen: boolean;
  /** La cuenta con la que entró (0 = invitado: no acumula nada) y su aspecto, validado por el servidor. */
  uid: number;
  look: Look;
  /** Fotos de esta partida (ids de entidad ya contados), la última y si lo están inspeccionando ahora. */
  shot?: Set<number>;
  lastPhoto?: number;
  inspected?: boolean;
  /** Escondites (los lleva Match): el nicho en que está (-1 ninguno), su aire y el ruido reciente (1 al correr). */
  hide?: number;
  breath?: Breath;
  noise?: number;
}

interface Ent {
  id: number;
  sim: EntitySim;
}

export class Match {
  readonly maze: Maze;
  private items = new Map<string, ItemSpot>();
  private taken = new Set<string>();
  private ents: Ent[] = [];
  private nextId = 1;
  private age = 0;

  private speed: number;
  private grace: number;
  /** Aguantó una inspección escondido (lo llama tick). */
  onHeld?: (p: Player) => void;
  /** Los nichos de las paredes, con quien hay dentro. */
  readonly hides: HideState[];

  constructor(readonly seed: number, difficulty: Difficulty = 'normal', players = 1) {
    this.speed = DIFFICULTY[difficulty].speed;
    this.grace = DIFFICULTY[difficulty].grace;
    this.maze = generateMaze(seed, players);
    this.hides = hideStates(this.maze);
    for (const it of itemSpots(this.maze)) this.items.set(it.id, it);
    // al empezar, una de cada, en los arranques más lejanos
    const m = this.maze;
    (['bacteria', 'partygoer'] as Kind[]).forEach((k, i) => this.spawn(k, m.spawns[i] ?? m.spawns[0]));
  }

  /** Dónde empiezan todos. */
  get start() {
    return centerOf(this.maze.start);
  }

  private spawn(kind: Kind, at: { x: number; y: number }, speed = 1, hp = 1) {
    const m = this.maze;
    this.ents.push({ id: this.nextId++, sim: new EntitySim(kind, m, (x, z) => solidAt(m, x, z), at, speed * this.speed, hp, true) });
  }

  /** Las cintas recogidas entre todos. */
  get tapes() {
    let n = 0;
    for (const id of this.taken) if (id[0] === 't') n++;
    return n;
  }

  /** Un paso de la IA (la llaman 20 veces por segundo). `caught` se llama por cada jugador al que alcanza una. */
  tick(dt: number, players: Player[], caught: (p: Player, entityId: number) => void) {
    this.age += dt;
    const targets: SimTarget[] = [];
    this.hiding(dt, players);
    const hidden = this.age > this.grace ? this.hides.filter((h) => h.occ) : [];
    if (this.age > this.grace) {
      for (const p of players) {
        if (p.dead || !p.seen || (p.hide ?? -1) >= 0) continue;
        const s = p.st, cx = Math.floor(s.x / CELL), cy = Math.floor(s.z / CELL), m = this.maze;
        const cp = Math.cos(s.pitch);
        targets.push({
          id: p.id, x: s.x, y: s.y, z: s.z, ex: s.x, ey: s.y + EYE, ez: s.z,
          torch: s.light ? [-Math.sin(s.yaw) * cp, Math.sin(s.pitch), -Math.cos(s.yaw) * cp] : null,
          exposed: cx >= 0 && cy >= 0 && cx < m.w && cy < m.h && !!m.lit[cy * m.w + cx],
        });
      }
    }
    for (const e of this.ents) {
      const id = e.sim.update(dt, targets, false, hidden);
      if (id === undefined) continue;
      const p = players.find((q) => q.id === id);
      if (!p) continue;
      p.dead = true;
      e.sim.dance(p.st.x, p.st.z);
      e.sim.state = 'attack'; // primero el ataque; el baile llega solo (ver recover)
      caught(p, e.id);
    }
  }

  snapshot(): WorldSnapshot {
    return {
      ents: this.ents.map((e) => ({ id: e.id, kind: e.sim.kind, x: e.sim.x, z: e.sim.z, yaw: e.sim.facing, state: e.sim.state, hp: e.sim.hp, speed: e.sim.speed }) satisfies EntState),
      taken: [...this.taken],
      tapes: this.tapes,
      insp: this.hides.filter((h) => h.by && h.occ).map((h) => h.occ!.id),
    };
  }

  /** ¿Puede estar escondido en (x, z)? Dentro de un nicho que no ocupa otro. */
  hideOk(p: Player, st: PlayerState) {
    return !p.dead && this.hides.some((h) => Math.hypot(h.x - st.x, h.z - st.z) < 1 && (!h.occ || h.occ.id === p.id));
  }

  /**
   * Quién está en qué nicho: lo que el cliente dice (`hiding`) solo vale si está dentro de uno libre. Su aire
   * lo lleva el servidor (con algo más de margen que el cliente, por la red) y de ahí sale si de verdad contiene.
   */
  private hiding(dt: number, players: Player[]) {
    tickHides(this.hides, dt);
    for (const p of players) {
      const st = p.st, b = (p.breath ??= new Breath());
      p.noise = /run/i.test(st.anim) ? 1 : Math.max(0, (p.noise ?? 0) - dt / 8);
      const want = !p.dead && p.seen && st.hiding ? this.hides.findIndex((h) => Math.hypot(h.x - st.x, h.z - st.z) < 1 && (!h.occ || h.occ.id === p.id)) : -1;
      const was = p.hide ?? -1;
      if (was !== want) {
        if (this.hides[was]?.occ?.id === p.id) this.hides[was].occ = null; // (was puede venir de la partida anterior)
        if (want >= 0) (this.hides[want].occ = { id: p.id, holding: false, noise: p.noise }), b.reset();
        p.hide = want;
      }
      if (st.hiding && want < 0) st.hiding = st.holding = false;
      // una inspección que acaba con él aún dentro y vivo (la entidad se marcha): la aguantó
      if (want >= 0 && this.hides[want].by && this.hides[want].occ?.id === p.id) p.inspected = true;
      else {
        if (p.inspected && want >= 0 && !p.dead) this.onHeld?.(p);
        p.inspected = false;
      }
      if (want >= 0) {
        const occ = this.hides[want].occ!;
        occ.holding = b.step(dt, !!st.holding, 1.2);
        occ.noise = p.noise;
      }
    }
  }

  /** Recoger un objeto: el primero en llegar se lo lleva; hay que estar cerca de donde está. */
  pickup(p: Player, id: string) {
    const it = this.items.get(id);
    if (!it || this.taken.has(id) || p.dead) return false;
    const c = centerOf(it.cell);
    if (Math.hypot(p.st.x - c.x, p.st.z - c.z) > PICK_REACH) return false;
    this.taken.add(id);
    return true;
  }

  /** Un tiro a una entidad: se acepta si va con el rifle y está a tiro; muere al llegar su hp a cero (true) y otra la sustituye. */
  hit(p: Player, entityId: number) {
    const i = this.ents.findIndex((e) => e.id === entityId);
    if (i < 0 || p.dead || p.st.held !== 'gun') return false;
    const e = this.ents[i];
    if (Math.hypot(p.st.x - e.sim.x, p.st.z - e.sim.z) > SHOT_REACH) return false;
    if (!e.sim.hit()) return false;
    this.ents.splice(i, 1);
    // la siguiente, en el arranque más lejano del que disparó: 15 % más rápida y un tiro más
    const far = [...this.maze.spawns].sort((a, b) => dist(centerOf(b), p.st) - dist(centerOf(a), p.st))[0];
    this.spawn(e.sim.kind === 'bacteria' ? 'partygoer' : 'bacteria', far, Math.min(1.2, (e.sim.speed / this.speed) * 1.1), e.sim.hp0 + 1);
    return true;
  }

  /**
   * Una foto que vale: con la cámara en la mano, a una entidad viva delante (en el cono del visor), a la vista y a tiro, y que no
   * se haya contado ya en esta partida. El cliente decide el encuadre fino (zoom); aquí se comprueba lo grueso. Devuelve su id.
   */
  photo(p: Player): number | undefined {
    const now = Date.now();
    if (p.dead || p.st.held !== 'camera' || now - (p.lastPhoto ?? 0) < 800) return undefined;
    p.lastPhoto = now;
    const s = p.st, fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), m = this.maze;
    for (const e of this.ents) {
      if (p.shot?.has(e.id) || !e.sim.alive) continue;
      const dx = e.sim.x - s.x, dz = e.sim.z - s.z, d = Math.hypot(dx, dz);
      if (d > PHOTO_REACH || (d > 1 && (dx * fx + dz * fz) / d < PHOTO_COS) || !seesXZ((x, z) => solidAt(m, x, z), s.x, s.z, e.sim.x, e.sim.z)) continue;
      (p.shot ??= new Set()).add(e.id);
      return e.id;
    }
  }

  /** Llegar al ascensor con las cintas de todos. */
  canExit(p: Player) {
    const c = centerOf(this.maze.elevator);
    return !p.dead && this.tapes >= TAPES_NEEDED && Math.hypot(p.st.x - c.x, p.st.z - c.z) < 2.5;
  }

  /** Ha caído al vacío de verdad (no un salto). */
  fell(p: Player) {
    return !p.dead && p.st.y < -1;
  }
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

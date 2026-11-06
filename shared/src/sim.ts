import { bfs, CELL, DIRS as MAZE_DIRS, type Cell, type Maze } from './maze';

/*
 * La lógica de las entidades (bacteria y partygoer), sin gráficos: la corre el servidor en las salas y el
 * cliente en solitario (entity.ts solo la pinta). No patrullan: van de un sitio a oscuras a otro cercano
 * y allí se quedan un rato. Se dan cuenta de ti poco a poco (ver notice); a medias, se paran y miran
 * hacia ti; del todo, corren hacia donde te vieron por última vez. Si te pierden de vista 4 s, vuelven a
 * lo suyo. A 1,2 m, atacan. No pisan los huecos, la celda del ascensor ni los sillones.
 *
 * Los escondites (maze.hides): un jugador escondido no es objetivo. Pero si una entidad pasa a <= 2 celdas del
 * nicho, con algo de probabilidad (más si el jugador corrió hace poco) se para frente a él a «inspeccionar»: el
 * jugador tiene que contener la respiración (ver Breath); si no la contiene, o se le acaba, lo encuentra.
 */

export type Kind = 'bacteria' | 'partygoer';
export type EState = 'wander' | 'chase' | 'attack' | 'dance' | 'dead' | 'inspect';
export const HEIGHT: Record<Kind, number> = { bacteria: 3, partygoer: 2.2 };

/** Lo que el servidor reparte de cada entidad. */
export interface EntState {
  id: number;
  kind: Kind;
  x: number;
  z: number;
  yaw: number;
  state: EState;
  hp: number;
  /** Multiplicador de velocidad (las que reaparecen corren más). */
  speed: number;
}

/** Un jugador, visto por una entidad. */
export interface SimTarget {
  id: string;
  /** Los pies. */
  x: number;
  y: number;
  z: number;
  /** Los ojos. */
  ex: number;
  ey: number;
  ez: number;
  /** Hacia dónde apunta la linterna (unitario); null si va apagada. */
  torch: [number, number, number] | null;
  /** Bajo los fluorescentes encendidos. */
  exposed: boolean;
}

// persiguen más rápido de lo que andas y más despacio de lo que corres: escapar cuesta aguante
const WANDER = 1.1, CHASE = 2.9, CONE = (50 * Math.PI) / 180, LOSE = 4, REACH = 1.2;
// la inspección: hasta dónde se fija en un nicho, lo que dura frente a él, lo que tarda en notar que no contienes
// el aire (con el margen de la red) y el enfriamiento del nicho tras una
const HIDE_RANGE = 2 * CELL + 0.3, INSPECT_T = [4, 5.5] as const, REACT = 0.9, BAD_T = 0.7, COOL = 20;
// a cuánto te ven: a oscuras, bajo los fluorescentes y con la linterna encendida; el haz en la cara, a 0,3 rad
const SIGHT_DARK = 7, SIGHT_LIT = 14, SIGHT_TORCH = 20, BEAM = 0.3;
const TAU = Math.PI * 2;
const mod = (a: number, n: number) => ((a % n) + n) % n;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export const centerOf = (c: Cell) => ({ x: c.x * CELL + CELL / 2, z: c.y * CELL + CELL / 2 });

/** Quien está en un nicho: `holding` es lo que de verdad contiene (ya con el aire), `noise` 1 al correr y baja con el tiempo. */
export interface HideOcc {
  id: string;
  holding: boolean;
  noise: number;
}
/** Un nicho en marcha (el servidor y el solitario llevan uno por cada `maze.hides`). */
export interface HideState {
  idx: number;
  /** El centro del nicho y el de la celda de su boca (m). */
  x: number;
  z: number;
  fx: number;
  fz: number;
  /** Hacia dónde mira quien sale (yaw del jugador: -z es yaw 0). */
  yaw: number;
  occ: HideOcc | null;
  /** Segundos hasta poder inspeccionarlo otra vez. */
  cd: number;
  /** La entidad que lo inspecciona ahora. */
  by: EntitySim | null;
}
export function hideStates(m: Maze): HideState[] {
  return m.hides.map((h, idx) => {
    const n = centerOf(h.cell), [dx, dy] = MAZE_DIRS[h.side];
    return { idx, x: n.x, z: n.z, fx: n.x + dx * CELL, fz: n.z + dy * CELL, yaw: Math.atan2(-dx, -dy), occ: null, cd: 0, by: null };
  });
}
export const tickHides = (hs: HideState[], dt: number) => hs.forEach((h) => (h.cd = Math.max(0, h.cd - dt)));

/**
 * Contener la respiración: 6 s seguidos (1 = lleno), se recupera en 4 al soltar; si se agota, un jadeo y
 * no se puede volver a contener hasta recuperar un 30 %. `slack` > 1 da más aire (el servidor, por la red).
 */
export class Breath {
  air = 1;
  /** Se acaba de agotar en este paso. */
  gasped = false;
  private winded = false;
  /** Un paso; devuelve si de verdad contiene (quiere, y le queda aire). */
  step(dt: number, want: boolean, slack = 1) {
    this.gasped = false;
    const hold = want && !this.winded && this.air > 0;
    this.air = Math.max(0, Math.min(1, this.air + (hold ? -1 / (6 * slack) : 1 / 4) * dt));
    if (hold && this.air <= 0) (this.winded = true), (this.gasped = true);
    else if (this.winded && this.air >= 0.3) this.winded = false;
    return hold;
  }
  reset() {
    this.air = 1;
    this.winded = this.gasped = false;
  }
}

/** Pared (o fuera del mapa) en ese punto; la cabina del ascensor cuenta como pared mientras no se abra. */
export function solidAt(m: Maze, x: number, z: number, elevatorOpen = false) {
  const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
  if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h || !m.open[cy * m.w + cx]) return true;
  return !elevatorOpen && cx === m.elevator.x && cy === m.elevator.y;
}

/** ¿Se ve (bx,bz) desde (ax,az) sin pared en medio? (pasos de 25 cm por la rejilla) */
export function seesXZ(solid: (x: number, z: number) => boolean, ax: number, az: number, bx: number, bz: number) {
  const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.25);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (solid(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

export class EntitySim {
  x: number;
  z: number;
  facing = 0;
  state: EState = 'wander';
  alive = true;
  /** Se movió en el último paso (para elegir andar o quieta). */
  moving = false;
  readonly height: number;
  readonly hp0: number;
  private path: { x: number; z: number }[] = [];
  private repath = 0;
  private lost = 0;
  /** Cuánto se ha dado cuenta de ti (0–1): a 1, persigue. */
  private alert = 0;
  /** Lo que se queda quieta en un sitio antes de irse a otro. */
  private rest = 0;
  private seen = { x: 0, z: 0 };
  private blocked: Set<number>;
  /** Segundos en el estado de ataque o baile (solo con `recover`). */
  private phase = 0;
  /** La inspección en curso y los nichos que ya ha mirado (se olvidan al alejarse). */
  private insp?: { h: HideState; t: number; walk: number; bad: number; dur: number };
  private rolled = new Set<number>();

  /** `recover`: tras atacar, baila un rato y vuelve a lo suyo (en las salas; en solitario la partida acaba). */
  constructor(
    readonly kind: Kind,
    private maze: Maze,
    private solid: (x: number, z: number) => boolean,
    at: Cell,
    readonly speed = 1,
    public hp = 1,
    private recover = false,
  ) {
    this.hp0 = hp;
    this.height = HEIGHT[kind];
    const c = centerOf(at);
    this.x = c.x;
    this.z = c.z;
    this.blocked = new Set([...maze.voids, maze.elevator, ...maze.props.filter((p) => p.kind === 'armchair').map((p) => p.cell)].map((c) => c.y * maze.w + c.x));
  }

  private cellOf(x: number, z: number): Cell {
    return { x: Math.floor(x / CELL), y: Math.floor(z / CELL) };
  }

  /** Camino por la rejilla hasta `to` (centros de celda), evitando huecos y el ascensor. */
  private route(to: Cell) {
    // la celda propia nunca cuenta como bloqueada: si una persecución la dejó sobre un hueco, que salga
    const m = this.maze, from = this.cellOf(this.x, this.z), own = from.y * m.w + from.x;
    const blocked = this.blocked.has(own) ? new Set([...this.blocked].filter((i) => i !== own)) : this.blocked;
    const d = bfs(m, to, blocked);
    if (d[from.y * m.w + from.x] < 0) return [];
    // se baja por las distancias desde el destino: cada paso, al vecino más cerca de él
    const out: { x: number; z: number }[] = [];
    let c = from;
    for (let i = 0; i < 400 && (c.x !== to.x || c.y !== to.y); i++) {
      const nb = DIRS.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).filter((n) => n.x >= 0 && n.y >= 0 && n.x < m.w && n.y < m.h && d[n.y * m.w + n.x] >= 0);
      c = nb.sort((a, b) => d[a.y * m.w + a.x] - d[b.y * m.w + b.x])[0];
      if (!c) break;
      out.push(centerOf(c));
    }
    return this.smooth(out);
  }

  /** ¿Cabe un cuerpo (0,6 m) yendo en línea recta de a a b, sin pared, hueco ni sillón? */
  private clear(ax: number, az: number, bx: number, bz: number) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    if (d < 1e-6) return true;
    const nx = (-dz / d) * 0.3, nz = (dx / d) * 0.3, n = Math.ceil(d / 0.3);
    for (let i = 1; i <= n; i++)
      for (const k of [-1, 0, 1]) {
        const x = ax + (dx * i) / n + nx * k, z = az + (dz * i) / n + nz * k;
        if (this.solid(x, z) || this.blockedAt(x, z)) return false;
      }
    return true;
  }

  /** El camino por celdas, sin escalones: de cada punto, al más lejano (de los 14 siguientes) al que se llega en recta. En una sala abierta, en diagonal. */
  private smooth(path: { x: number; z: number }[]) {
    const out: { x: number; z: number }[] = [];
    let ax = this.x, az = this.z, i = 0;
    while (i < path.length) {
      let j = i;
      for (let k = Math.min(path.length - 1, i + 14); k > i; k--)
        if (this.clear(ax, az, path[k].x, path[k].z)) {
          j = k;
          break;
        }
      out.push(path[j]);
      ({ x: ax, z: az } = path[j]);
      i = j + 1;
    }
    return out;
  }

  private blockedAt(x: number, z: number) {
    const c = this.cellOf(x, z);
    return this.blocked.has(c.y * this.maze.w + c.x);
  }

  /** Adónde ir: un sitio no muy lejos (a 4–14 celdas), mejor a oscuras. */
  private darkSpot(): Cell {
    const m = this.maze, me = this.cellOf(this.x, this.z);
    let best = me, score = -1;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * TAU, r = 4 + Math.random() * 10;
      const c = { x: Math.round(me.x + Math.cos(a) * r), y: Math.round(me.y + Math.sin(a) * r) }, k = c.y * m.w + c.x;
      if (c.x < 0 || c.y < 0 || c.x >= m.w || c.y >= m.h || !m.open[k] || this.blocked.has(k)) continue;
      const s = (m.lit[k] ? 0 : 2) + Math.random();
      if (s > score) (score = s), (best = c);
    }
    return best;
  }

  /**
   * Cuánto se da cuenta de `t` por segundo (0: no lo ve). Lo ve sin pared en medio, dentro de su cono (o
   * a menos de 2,5 m) y a SIGHT_DARK, SIGHT_LIT o SIGHT_TORCH según dónde esté y si lleva la linterna
   * encendida; si le da con el haz, aunque no mire y más deprisa. Persiguiendo no le hace falta el cono y
   * ve el doble de lejos (18 m como mucho: en las salas grandes no hay que verse hasta el fondo).
   */
  private notice(t: SimTarget) {
    const my = this.height * 0.85, tx = t.ex - this.x, ty = t.ey - my, tz = t.ez - this.z, d = Math.hypot(tx, ty, tz), chasing = this.state === 'chase';
    let range = t.torch ? SIGHT_TORCH : t.exposed ? SIGHT_LIT : SIGHT_DARK;
    if (chasing) range = Math.min(18, range * 2);
    // el ángulo entre el haz y la línea del ojo a la entidad
    let beamed = false;
    if (t.torch && d < SIGHT_TORCH && d > 1e-6) {
      const cos = -(t.torch[0] * tx + t.torch[1] * ty + t.torch[2] * tz) / d;
      beamed = Math.acos(Math.max(-1, Math.min(1, cos))) < BEAM;
    }
    const ang = Math.abs(mod(Math.atan2(tx, tz) - this.facing + Math.PI, TAU) - Math.PI);
    if (!beamed && !((chasing || ang < CONE || d < 2.5) && d < range)) return 0;
    if (!seesXZ(this.solid, this.x, this.z, t.ex, t.ez)) return 0;
    return beamed ? 2.5 : 0.4 + 1.6 * (1 - d / range);
  }

  /**
   * Un paso. `hides`: los nichos con alguien dentro (esos jugadores no van en `targets`). Devuelve el id
   * del jugador al que alcanza en este paso (si lo hay).
   */
  update(dt: number, targets: SimTarget[], god = false, hides: HideState[] = []): string | undefined {
    let caught: string | undefined;
    this.moving = false;
    if (this.state === 'inspect') return this.inspect(dt, god);
    if ((this.state === 'wander' || this.state === 'chase') && hides.length && this.maybeInspect(hides)) return undefined;
    if (this.state === 'wander' || this.state === 'chase') {
      // al que más se da cuenta (el más cerca que ve) le hace caso
      let rate = 0, tgt: SimTarget | undefined;
      for (const t of targets) {
        const r = this.notice(t);
        if (r > rate) (rate = r), (tgt = t);
      }
      if (this.state === 'wander') {
        this.alert = rate > 0 ? Math.min(1, this.alert + rate * dt) : Math.max(0, this.alert - dt / 4);
        if (this.alert >= 1) (this.state = 'chase'), (this.lost = 0), (this.repath = 0);
      }
      if (this.state === 'chase') {
        if (rate > 0 && tgt) (this.lost = 0), (this.seen = { x: tgt.x, z: tgt.z });
        // te ha perdido: aún se acuerda un poco (si vuelve a verte, persigue antes)
        else if ((this.lost += dt) > LOSE) (this.state = 'wander'), (this.alert = 0.5), (this.path = []), (this.rest = 2);
      }
      const hunting = this.state === 'chase';
      this.repath -= dt;
      if (hunting) {
        if (this.repath <= 0 || !this.path.length) (this.path = this.route(this.cellOf(this.seen.x, this.seen.z))), (this.repath = 0.5);
      } else if (!this.path.length && (this.rest -= dt) <= 0) {
        const s = centerOf(this.darkSpot());
        (this.path = this.route(this.cellOf(s.x, s.z))), (this.rest = 3 + Math.random() * 5);
      }
      // a medio darse cuenta: se para y mira hacia ti
      const watch = tgt ?? targets.reduce<SimTarget | undefined>((b, t) => (!b || Math.hypot(t.x - this.x, t.z - this.z) < Math.hypot(b.x - this.x, b.z - this.z) ? t : b), undefined);
      const wary = !hunting && this.alert > 0.35 && !!watch;
      // en la misma celda que un jugador, directo a él
      const near = hunting ? targets.find((t) => Math.hypot(t.x - this.x, t.z - this.z) < CELL * 1.2 && seesXZ(this.solid, this.x, this.z, t.x, t.z) && !this.blockedAt(t.x, t.z)) : undefined;
      const goal = wary ? undefined : near ? { x: near.x, z: near.z } : this.path[0];
      const v = hunting ? CHASE * this.speed : WANDER;
      if (goal) {
        const tx = goal.x - this.x, tz = goal.z - this.z, d = Math.hypot(tx, tz);
        if (d < 0.15 && !near) this.path.shift();
        else if (d > 1e-6) {
          const k = Math.min(d, v * dt) / d, nx = this.x + tx * k, nz = this.z + tz * k;
          if (!near || !this.blockedAt(nx, nz)) (this.x = nx), (this.z = nz);
          this.moving = true;
        }
        this.turn(tx, tz, dt);
      } else if (wary && watch) this.turn(watch.x - this.x, watch.z - this.z, dt);
      if (this.state === 'chase' && !god) {
        const hit = targets.find((t) => Math.hypot(t.x - this.x, t.z - this.z) < REACH && Math.abs(t.y) < 1.2);
        if (hit) (this.state = 'attack'), (this.phase = 0), (caught = hit.id);
      }
    } else if (this.recover && (this.state === 'attack' || this.state === 'dance')) {
      // tras atacar: un momento de ataque, un baile y de vuelta a lo suyo
      this.phase += dt;
      if (this.state === 'attack' && this.phase > 1.3) (this.state = 'dance'), (this.phase = 0);
      else if (this.state === 'dance' && this.phase > 5) (this.state = 'wander'), (this.alert = 0), (this.path = []), (this.rest = 2);
    }
    return caught;
  }

  /** Hay un nicho ocupado a <= 2 celdas y a la vista: una vez por pasada, con probabilidad (más si el que está dentro hizo ruido). */
  private maybeInspect(hides: HideState[]) {
    for (const h of hides) {
      if (Math.hypot(h.x - this.x, h.z - this.z) > 3 * CELL) this.rolled.delete(h.idx);
      if (!h.occ || h.by || h.cd > 0 || this.rolled.has(h.idx) || Math.hypot(h.x - this.x, h.z - this.z) > HIDE_RANGE) continue;
      if (!seesXZ(this.solid, this.x, this.z, h.fx, h.fz)) continue;
      this.rolled.add(h.idx);
      if (Math.random() > Math.min(0.9, 0.35 + 0.5 * h.occ.noise)) continue;
      this.state = 'inspect';
      this.path = [];
      this.insp = { h, t: 0, walk: 0, bad: 0, dur: INSPECT_T[0] + Math.random() * (INSPECT_T[1] - INSPECT_T[0]) };
      h.by = this;
      return true;
    }
    return false;
  }

  /** Delante del nicho, mirándolo: si el de dentro no contiene la respiración (pasado un instante de margen), lo encuentra. */
  private inspect(dt: number, god: boolean): string | undefined {
    const s = this.insp!, h = s.h;
    const stop = () => ((h.by = null), (this.insp = undefined));
    if (!h.occ) {
      // ha salido: lo ve
      stop();
      (this.state = 'chase'), (this.alert = 1), (this.lost = 0), (this.repath = 0), (this.seen = { x: h.x, z: h.z });
      return undefined;
    }
    const d = Math.hypot(h.fx - this.x, h.fz - this.z);
    if (d > 0.3 && s.walk < 5) {
      // a la boca, andando
      s.walk += dt;
      const k = Math.min(d, 1.8 * dt) / d;
      this.x += (h.fx - this.x) * k;
      this.z += (h.fz - this.z) * k;
      this.moving = true;
      this.turn(h.fx - this.x, h.fz - this.z, dt);
      return undefined;
    }
    this.turn(h.x - this.x, h.z - this.z, dt);
    if ((s.t += dt) > REACT) s.bad = h.occ.holding ? Math.max(0, s.bad - dt) : s.bad + dt;
    if (s.bad > BAD_T && !god) {
      const id = h.occ.id;
      stop();
      (this.state = 'attack'), (this.phase = 0);
      return id;
    }
    if (s.t > s.dur) {
      // no hay nadie: se marcha
      h.cd = COOL;
      stop();
      (this.state = 'wander'), (this.alert = 0), (this.rest = 3), (this.path = []);
    }
    return undefined;
  }

  /** Girar hacia (tx, tz), a 6 rad/s como mucho. */
  private turn(tx: number, tz: number, dt: number) {
    const turn = mod(Math.atan2(tx, tz) - this.facing + Math.PI, TAU) - Math.PI;
    this.facing += Math.sign(turn) * Math.min(Math.abs(turn), dt * 6);
  }

  /** Tras atacar: mira a (x, z) y baila. */
  dance(x: number, z: number) {
    this.state = 'dance';
    this.phase = 0;
    this.facing = Math.atan2(x - this.x, z - this.z);
  }

  /** Un tiro; true si muere. */
  hit() {
    if (!this.alive) return false;
    if (--this.hp > 0) return false;
    if (this.insp) (this.insp.h.by = null), (this.insp = undefined);
    this.alive = false;
    this.state = 'dead';
    return true;
  }
}

/** Los objetos de una partida, sacados del mapa (la misma lista en el servidor y el cliente). */
export interface ItemSpot {
  id: string;
  kind: 'tape' | 'flashlight' | 'camera' | 'gun';
  cell: Cell;
}
export function itemSpots(m: Maze): ItemSpot[] {
  const out: ItemSpot[] = [];
  m.tapes.forEach((cell, i) => out.push({ id: 't' + i, kind: 'tape', cell }));
  m.flashlights.forEach((cell, i) => out.push({ id: 'f' + i, kind: 'flashlight', cell }));
  out.push({ id: 'c', kind: 'camera', cell: m.camera });
  if (m.pistol) out.push({ id: 'g', kind: 'gun', cell: m.pistol });
  m.extraGuns.forEach((cell, i) => out.push({ id: 'g' + (i + 1), kind: 'gun', cell }));
  return out;
}

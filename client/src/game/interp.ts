/*
 * Interpolación con buffer de jitter para lo que llega por la red (otros jugadores y entidades).
 *
 * El fallo de antes: cada vez que llegaba un estado se tomaba como «meta» y se perseguía con un suavizado exponencial.
 * Con un túnel (latencia alta y variable, TCP que retiene y suelta de golpe) la meta se quedaba quieta mientras no llegaba
 * nada y, al soltarse una ráfaga, saltaba de golpe: tirones y «teletransportes» de la cámara de espectador.
 *
 * Ahora cada estado lleva la hora a la que se tomó (reloj del emisor), da igual cuándo llegue. Se guardan unos cuantos y se
 * dibuja siempre un poco en el pasado (`delay`: 1,5 intervalos + 2 veces el jitter medido), interpolando entre dos estados que ya
 * se tienen. Si aun así falta el siguiente, se extrapola un instante (amortiguado) y se espera; si hay un salto real, se corta.
 */

const rad = Math.PI * 2;
const angle = (a: number, b: number) => a + ((((b - a + Math.PI) % rad) + rad) % rad) - Math.PI;

export interface Snap {
  /** Hora del estado, en ms del reloj del emisor. */
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Pasa la hora de un emisor a la local y mide el jitter. Uno por emisor (cada reloj es suyo). */
export class Timeline {
  /** local − remoto del paquete más rápido visto: el desfase de relojes más la latencia mínima. */
  off = NaN;
  /** Cuánto se retrasan los paquetes sobre el más rápido (ms, media móvil). */
  jitter = 0;
  /** Intervalo entre estados (ms, media móvil). */
  gap = 66;
  /** Retraso con el que se dibuja (ms), suavizado para que no dé tirones al cambiar. */
  delay = 150;
  private last = NaN;

  push(t: number, now: number) {
    const d = now - t;
    if (Number.isNaN(this.off) || d < this.off) this.off = d;
    else this.off += (d - this.off) * 0.002; // sube despacio: si la ruta empeora de verdad, el reloj se reajusta
    this.jitter += (Math.max(0, d - this.off) - this.jitter) * 0.06;
    if (!Number.isNaN(this.last) && t > this.last) this.gap += (Math.min(t - this.last, 400) - this.gap) * 0.1;
    this.last = t;
    const want = Math.min(350, Math.max(100, 1.5 * this.gap + 1.5 * this.jitter));
    this.delay += (want - this.delay) * 0.05;
  }

  /** Mover `cur` hacia `goal` con un suavizado corto pero con tope de velocidad (m/s): si el buffer se vació y la meta salta, se
   * recupera corriendo y no con un salto. Un error grande (> `snap` m) se corta. Devuelve la distancia movida. */
  static follow(cur: { x: number; z: number }, goal: { x: number; z: number }, dt: number, k: number, max = 9, snap = 6) {
    const dx = goal.x - cur.x, dz = goal.z - cur.z, d = Math.hypot(dx, dz);
    if (d > snap) return (cur.x = goal.x), (cur.z = goal.z), d;
    const m = Math.min(d * k, max * dt);
    if (d > 1e-6) (cur.x += (dx / d) * m), (cur.z += (dz / d) * m);
    return m;
  }

  reset(gap = 66) {
    this.off = NaN;
    this.jitter = 0;
    this.gap = gap;
    this.delay = 1.5 * gap + 50;
    this.last = NaN;
  }

  /** La hora (del emisor) que toca dibujar ahora. */
  at(now: number) {
    return now - this.off - this.delay;
  }
}

/** El reloj de los snapshots del mundo (uno por partida, compartido por todas las entidades). */
export const worldTl = new Timeline();

/** Los estados recientes de un emisor y su muestreo a la hora que toca. */
export class Track<S extends Snap> {
  buf: S[] = [];
  constructor(readonly tl = new Timeline(), private own = true) {}

  /** Guardar un estado (false si es viejo o repetido: se descarta). */
  push(s: S, now: number) {
    const last = this.buf[this.buf.length - 1];
    if (last && s.t <= last.t) return false;
    this.buf.push(s);
    if (this.buf.length > 40) this.buf.shift();
    if (this.own) this.tl.push(s.t, now);
    return true;
  }

  /**
   * El estado a dibujar a la hora local `now`: escribe en `out` la posición y la mirada interpoladas y devuelve el estado
   * anterior más cercano (para lo discreto: animación, linterna, lo que lleva en la mano).
   */
  sample(now: number, out: Snap): S | undefined {
    const b = this.buf;
    if (!b.length) return undefined;
    const rt = this.tl.at(now);
    let i = b.length - 1;
    while (i > 0 && b[i].t > rt) i--;
    if (i > 1) (b.splice(0, i - 1), (i = 1)); // lo anterior ya no se usa (se deja uno de margen)
    const a = b[i], n = b[i + 1];
    const copy = (s: Snap) => ((out.x = s.x), (out.y = s.y), (out.z = s.z), (out.yaw = s.yaw), (out.pitch = s.pitch));
    if (rt <= a.t) return copy(a), a;
    if (n) {
      // un salto de verdad (caída, reaparición): sin interpolar, se queda en el viejo hasta la mitad y salta
      if (Math.hypot(n.x - a.x, n.z - a.z) > 4) return copy(rt - a.t < (n.t - a.t) / 2 ? a : n), a;
      const u = Math.min(1, Math.max(0, (rt - a.t) / (n.t - a.t || 1)));
      out.x = a.x + (n.x - a.x) * u;
      out.y = a.y + (n.y - a.y) * u;
      out.z = a.z + (n.z - a.z) * u;
      out.yaw = a.yaw + (angle(a.yaw, n.yaw) - a.yaw) * u; // por el camino corto
      out.pitch = a.pitch + (n.pitch - a.pitch) * u;
      return a;
    }
    // sin el siguiente: se sigue con la velocidad de los dos últimos, un máximo de 150 ms y amortiguado
    const p = b[i - 1];
    copy(a);
    if (p && a.t > p.t) {
      const dt = a.t - p.t, ahead = Math.min(rt - a.t, 150), f = 1 - ahead / 300; // 1 → 0,5
      const k = (ahead * f) / dt;
      const vx = a.x - p.x, vz = a.z - p.z;
      if (Math.hypot(vx, vz) / dt < 0.012) { // ≤ 12 m/s: más rápido no es andar, es un salto
        out.x += vx * k;
        out.z += vz * k;
      }
    }
    return a;
  }
}

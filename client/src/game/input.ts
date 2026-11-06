import * as THREE from 'three';
import { settings } from '../settings';

/*
 * Los controles del juego, de donde vengan: teclado y ratón (con el puntero bloqueado) o los
 * controles táctiles (Touch.tsx llama a stick/drag/press/hold). El juego lee una vez por fotograma.
 * Lo que suelta el puntero (Escape, cambiar de pestaña, una ventana del sistema) o el botón de atrás
 * del móvil pide pausa.
 */

export interface Controls {
  move: THREE.Vector2; // x a la derecha, y hacia delante, en [-1, 1]
  look: THREE.Vector2; // radianes este fotograma
  run: boolean;
  jump: boolean;
  flash: boolean; // pulsaciones: true solo el fotograma en que se pulsan
  grab: boolean; // G: recoger
  bag: boolean; // E: el inventario
  aim: boolean; // clic derecho mantenido: mirar por la cámara
  zoom: number; // la rueda mirando por la cámara (pasos)
  fire: boolean;
  reload: boolean;
  swap: boolean;
  pause: boolean;
  /** Space mantenido (contener la respiración en un escondite). */
  hold?: boolean;
}
export type Pulse = 'jump' | 'flash' | 'grab' | 'bag' | 'fire' | 'reload' | 'swap' | 'pause';

const MOUSE = 0.0022; // radianes por píxel de ratón
const TOUCH = 0.006; // por píxel de dedo
const SPIKE = 500; // píxeles de ratón en un solo evento: más que esto no es una mano
const LOOK_CAP = 0.35; // radianes de giro máximos por fotograma
const LOOK_DROP = 1; // lo acumulado que sobra por encima de esto se tira

export class Input {
  private keys = new Set<string>();
  private look = new THREE.Vector2();
  private stickV = new THREE.Vector2();
  private pulses = new Set<Pulse>();
  private holds = new Set<'run' | 'aim'>();
  private zoomV = 0;
  private toggled = false;
  private offs: (() => void)[] = [];
  private wasLocked = false;
  private lockedAt = 0; // cuándo se capturó el puntero (los primeros ms traen un salto falso)
  private softUntil = 0; // hasta cuándo un fallo al capturar el puntero no pausa (reanudar con Esc: el navegador exige un clic)
  private asked = -1e9; // cuándo se pidió el puntero por última vez (pedirlo dos veces seguidas da error)
  /** Si hay que leer (en pausa o en el menú no: nada se acumula). */
  active = false;
  /** Con el inventario abierto el puntero va suelto: soltarlo no pausa y un clic no lo vuelve a bloquear. */
  suspend = false;

  constructor(readonly el: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions) => {
      addEventListener(t, f as EventListener, o);
      this.offs.push(() => removeEventListener(t, f as EventListener, o));
    };
    const doc = <K extends keyof DocumentEventMap>(t: K, f: (e: DocumentEventMap[K]) => void) => {
      document.addEventListener(t, f as EventListener);
      this.offs.push(() => document.removeEventListener(t, f as EventListener));
    };
    const KEYS: Record<string, Pulse> = { Space: 'jump', KeyF: 'flash', KeyG: 'grab', KeyE: 'bag', KeyR: 'reload', KeyQ: 'swap' };
    on('keydown', (e) => {
      if (!this.active || (e.target as HTMLElement | null)?.tagName === 'INPUT') return; // escribiendo (el chat): no es para el juego
      if (e.code === 'Escape') return this.pulses.add(this.suspend ? 'bag' : 'pause'); // con el inventario abierto, lo cierra
      if (e.repeat) return;
      this.keys.add(e.code);
      // contener la respiración alternando (ajuste): Space la pone y la quita; entrar o salir de un escondite (E) la suelta
      if (e.code === 'Space') this.toggled = settings.toggleBreath && !this.toggled;
      else if (e.code === 'KeyE') this.toggled = false;
      const p = KEYS[e.code];
      if (p) this.pulses.add(p), e.preventDefault();
    });
    on('keyup', (e) => this.keys.delete(e.code));
    on('mousemove', (e) => {
      if (!this.locked) return;
      // los saltos falsos del ratón (Chrome da un golpe enorme al capturar el puntero y a veces después de un parón de la
      // página, sobre todo en equipos o conexiones lentas): se ignoran los 150 ms tras capturar y los deltas imposibles
      if (performance.now() - this.lockedAt < 150 || Math.abs(e.movementX) > SPIKE || Math.abs(e.movementY) > SPIKE) return;
      this.look.x += e.movementX * MOUSE * settings.sens;
      this.look.y += e.movementY * MOUSE * settings.sens * (settings.invertY ? -1 : 1);
    });
    on('mousedown', (e) => {
      if (!this.active) return;
      if (e.button === 2 && this.locked) return void this.holds.add('aim');
      if (e.button !== 0) return;
      if (this.locked) this.pulses.add('fire');
      else if (!this.suspend && matchMedia('(pointer: fine)').matches) this.lock();
    });
    on('mouseup', (e) => e.button === 2 && this.holds.delete('aim'));
    // el clic derecho es de la cámara, no del menú del navegador
    on('contextmenu', (e) => this.active && e.preventDefault());
    // la rueda: cambia de objeto o, mirando por la cámara, el zoom
    on(
      'wheel',
      (e) => {
        if (!this.active || !this.locked || Math.abs(e.deltaY) <= 4) return;
        if (this.holds.has('aim')) this.zoomV -= Math.sign(e.deltaY);
        else this.pulses.add('swap');
      },
      { passive: true },
    );
    // lo que se lleva el puntero o la pestaña: pausa
    doc('pointerlockchange', () => {
      this.asked = -1e9;
      if (this.locked) this.lockedAt = performance.now();
      if (this.wasLocked && !this.locked && this.active && !this.suspend) this.pulses.add('pause');
      this.wasLocked = this.locked;
    });
    // el navegador no da el puntero (pedido muy pronto tras soltarlo, o sin un clic): sin ratón no se juega
    doc('pointerlockerror', () => ((this.asked = -1e9), this.active && performance.now() >= this.softUntil && this.pulses.add('pause')));
    // salir de pantalla completa (Escape con el inventario abierto, el gesto de atrás en el móvil): pausa
    doc('fullscreenchange', () => !document.fullscreenElement && this.active && this.pulses.add('pause'));
    on('blur', () => this.active && this.pulses.add('pause'));
    doc('visibilitychange', () => document.hidden && this.active && this.pulses.add('pause'));
    on('popstate', () => {
      if (!this.active) return;
      this.pulses.add('pause');
      history.pushState({ backrooms: 1 }, ''); // que el siguiente atrás vuelva a pausar, no a salir
    });
  }

  get locked() {
    return document.pointerLockElement === this.el;
  }

  /** Bloquear el puntero (solo con ratón; en táctil no hace falta). */
  lock() {
    if (!matchMedia('(pointer: fine)').matches || this.locked || performance.now() - this.asked < 1000) return;
    this.asked = performance.now();
    try {
      const r = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => this.active && performance.now() >= this.softUntil && this.pulses.add('pause'));
    } catch {
      if (this.active && performance.now() >= this.softUntil) this.pulses.add('pause');
    }
  }

  /**
   * Reanudar con Esc: el navegador no cuenta Esc como un gesto y no deja recapturar el puntero, así que ese fallo no
   * debe volver a pausar; se sigue jugando y el primer clic lo captura (ver mousedown).
   */
  soft() {
    this.softUntil = performance.now() + 2000;
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  /** Empieza la partida: atrás del móvil pausa en vez de salir. */
  begin() {
    this.active = true;
    history.pushState({ backrooms: 1 }, '');
    this.lock();
  }

  // los controles táctiles
  stick(x: number, y: number) {
    this.stickV.set(x, y);
  }
  drag(dx: number, dy: number) {
    this.look.x += dx * TOUCH;
    this.look.y += dy * TOUCH;
  }
  press(p: Pulse) {
    if (this.active) this.pulses.add(p);
  }
  hold(name: 'run' | 'aim', on: boolean) {
    if (on) this.holds.add(name);
    else this.holds.delete(name);
  }

  read(): Controls {
    const k = this.keys;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ky = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const move = new THREE.Vector2(kx, ky).add(this.stickV);
    if (move.lengthSq() > 1) move.normalize();
    const p = this.pulses;
    const c: Controls = {
      move,
      look: this.look.clone(),
      run: k.has('ShiftLeft') || k.has('ShiftRight') || this.holds.has('run'),
      jump: p.has('jump'),
      flash: p.has('flash'),
      grab: p.has('grab'),
      bag: p.has('bag'),
      aim: this.holds.has('aim'),
      zoom: this.zoomV,
      fire: p.has('fire'),
      reload: p.has('reload'),
      swap: p.has('swap'),
      pause: p.has('pause'),
      hold: settings.toggleBreath ? this.toggled : k.has('Space'),
    };
    // el giro de un fotograma tiene tope: tras un parón de la página (red lenta, GC) el ratón acumulado no se aplica de
    // golpe, sino repartido en los fotogramas siguientes; lo que pase de 1 rad se descarta (era un salto falso)
    const cap = (v: number) => Math.max(-LOOK_CAP, Math.min(LOOK_CAP, v));
    c.look.set(cap(this.look.x), cap(this.look.y));
    this.look.sub(c.look);
    if (Math.abs(this.look.x) > LOOK_DROP || Math.abs(this.look.y) > LOOK_DROP) this.look.set(0, 0);
    this.zoomV = 0;
    p.clear();
    return c;
  }

  /** Al pausar: lo pulsado se suelta (si no, al volver se seguiría andando solo). */
  clear() {
    this.keys.clear();
    this.toggled = false;
    this.holds.clear();
    this.pulses.clear();
    this.look.set(0, 0);
    this.stickV.set(0, 0);
  }

  dispose() {
    this.unlock();
    for (const off of this.offs) off();
  }
}

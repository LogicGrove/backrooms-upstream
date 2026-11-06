/** Lo que comparten el cliente y el servidor: los puertos fijos, el protocolo de las salas y la lógica de la partida. */
export * from './maze';
export * from './sim';
export * from './progress';
import type { EntState } from './sim';
import type { Look } from './progress';

export const CLIENT_PORT = 5180;
export const SERVER_PORT = 5181;

export const MAX_PLAYERS = 4;
export const NAME_MAX = 16;
export const CHAT_MAX = 200;
/** Milisegundos mínimos entre dos mensajes de chat de un jugador. */
export const CHAT_GAP = 500;
/** Cintas que hay que juntar entre todos para que se abra la salida. */
export const TAPES_NEEDED = 8;

/** Lo que cada jugador manda ~15 veces por segundo (el servidor lo reparte a su sala; también en la sala de espera). */
export interface PlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** El clip que lleva puesto el cuerpo (andar, correr, quieto...). */
  anim: string;
  /** La linterna está encendida. */
  light: boolean;
  /** Lo que lleva en la mano derecha. */
  held: 'none' | 'camera' | 'gun';
  /** Solo en la sala de espera: 0 nada, 1 saludar, 2 señalar, 3 aplaudir, 4 sentarse. */
  emote?: number;
  /** Escondido en un nicho de la pared (x, z son los del nicho). El servidor lo valida. */
  hiding?: boolean;
  /** Mantiene la respiración (Space) mientras está escondido; el servidor lo devuelve ya con el aire. */
  holding?: boolean;
  /**
   * Cuándo se tomó este estado, en ms del reloj de quien lo manda (performance.now()). El servidor lo reenvía tal cual:
   * quien lo recibe reconstruye el ritmo del emisor aunque los paquetes lleguen en ráfaga o tarde (ver client/src/game/interp.ts).
   */
  t?: number;
}
/** Emotes de la sala de espera (teclas 1–4) y los ms mínimos entre dos cambios de uno. */
export const EMOTES = ['', 'WAVE', 'POINT', 'CLAP', 'SIT'] as const;
export const EMOTE_GAP = 200;

/** `starting`: el propietario ha pulsado el botón y la puerta se abre (START_DELAY ms) antes de que empiece la partida. */
export type Phase = 'lobby' | 'starting' | 'playing' | 'over';
/** Lo que dura la entrada por la puerta (ms) entre el botón y la partida. */
export const START_DELAY = 7500;
/**
 * La sala de espera 3D: 6 × 5 m centrada en el origen (x a lo ancho, z a lo largo; el suelo, en y = 0). En la
 * fase `lobby` y `starting`, las posiciones de los jugadores son de esta sala; el servidor las recorta a la caja.
 */
export const WAIT_HALF = { x: 3, z: 2.5 };
/** Dónde aparece cada jugador (por orden en la sala): en fila frente a la puerta, mirando a -z. */
export const WAIT_SPAWNS = [{ x: -1.5, z: 1.6 }, { x: -0.5, z: 1.6 }, { x: 0.5, z: 1.6 }, { x: 1.5, z: 1.6 }];
export type Difficulty = 'easy' | 'normal' | 'hard';
/** Lo que mueve cada dificultad: entidades más o menos rápidas, tiempo sin que ataquen al empezar (s) y vida de la linterna (s). */
export const DIFFICULTY: Record<Difficulty, { speed: number; grace: number; life: number }> = {
  easy: { speed: 0.85, grace: 16, life: 140 },
  normal: { speed: 1, grace: 10, life: 90 },
  hard: { speed: 1.2, grace: 6, life: 60 },
};
export const ROOM_NAME_MAX = 20;
/** Lo que el propietario puede cambiar de la sala (en el lobby). */
export interface RoomSettings {
  name: string;
  public: boolean;
  max: number;
  difficulty: Difficulty;
  /** 0 = aleatoria. */
  fixedSeed: number;
}
export interface Room extends RoomSettings {
  code: string;
  /** Contador de «cinta» de la lista (un número de la sala, por estética). */
  tape: number;
  ownerId: string;
  phase: Phase;
  /** 0 hasta que el propietario da a EMPEZAR. */
  seed: number;
}
export interface Member {
  id: string;
  name: string;
  dead: boolean;
  /** Su aspecto: el de su cuenta (lo valida el servidor) o, siendo invitado, un color gratis. */
  look: Look;
}
export type RoomView = Room & { players: Member[] };
export interface RoomInfo {
  code: string;
  name: string;
  tape: number;
  owner: string;
  count: number;
  max: number;
  phase: Phase;
  difficulty: Difficulty;
  /** La sala fija la semilla del mapa. */
  seeded: boolean;
  /** Segundos que lleva la partida en marcha (0 en el lobby). */
  age: number;
}
export type Joined = { id: string; room: RoomView } | { error: string };

/** Un objeto de la partida: cinta, linterna, cámara o rifle. */
export type ItemKind = 'tape' | 'flashlight' | 'camera' | 'gun';
export interface WorldSnapshot {
  /** Reloj del servidor (Date.now()) al tomar el snapshot: las entidades se interpolan con él, no con la hora de llegada. */
  t?: number;
  ents: EntState[];
  /** Ids de los objetos ya recogidos. */
  taken: string[];
  /** Cintas recogidas entre todos. */
  tapes: number;
  /** Jugadores a los que una entidad inspecciona ahora en su nicho (hay que contener la respiración). */
  insp?: string[];
}

export interface ClientToServer {
  create: (a: { name: string; public: boolean }, cb: (r: Joined) => void) => void;
  /** El propietario cambia los ajustes (solo en el lobby). */
  settings: (patch: Partial<RoomSettings>) => void;
  join: (a: { code: string; name: string }, cb: (r: Joined) => void) => void;
  list: (cb: (rooms: RoomInfo[]) => void) => void;
  start: () => void;
  state: (s: PlayerState) => void;
  /** Medir el ping: el servidor contesta al momento. */
  ping: (cb: () => void) => void;
  pickup: (itemId: string, cb?: (ok: boolean) => void) => void;
  /** Un disparo que acierta a una entidad: el servidor decide si muere. */
  hit: (entityId: number) => void;
  /** Se ha caído al vacío. */
  fell: () => void;
  chat: (text: string) => void;
  leave: () => void;
  /** Ha llegado a la salida. */
  exit: () => void;
  /** Se ha sacado una foto (el servidor cuenta las que valen, solo con cámara en la mano). */
  photo: () => void;
  /** Solo invitados: su color (uno de los gratis). Con cuenta, el aspecto sale de la cuenta. */
  look: (color: string) => void;
}
/** Lo que dice el servidor de sí mismo (GET /status): si está en mantenimiento y por qué. */
export interface Status {
  maintenance: boolean;
  message: string;
  /** Cuándo empieza el mantenimiento anunciado (ISO), si aún no ha empezado. */
  at?: string;
}

export interface ServerToClient {
  status: (s: Status) => void;
  room: (r: RoomView) => void;
  players: (all: Record<string, PlayerState & { name: string; dead: boolean }>) => void;
  world: (w: WorldSnapshot) => void;
  chat: (m: { id: string; name: string; text: string }) => void;
  dead: (id: string) => void;
  over: (r: { won: boolean }) => void;
  /** El servidor te ha concedido un logro (clave de ACHIEVEMENTS). */
  achievement: (key: string) => void;
}

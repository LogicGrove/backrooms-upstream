/**
 * Cuentas, logros y cosméticos: el único archivo de datos. El servidor concede los logros (a partir de
 * eventos de la partida) y valida el armario; el cliente solo lo muestra.
 */

// ── cuentas ──────────────────────────────────────────────────────────────
export const USER_RE = /^[A-Za-z0-9_]{3,16}$/;
/** La única cuenta con consola de admin (nombre exacto, ver server/src/index.ts: la comprobación real es del servidor). */
export const ADMIN_USER = 's7lver';
export const PASS_MIN = 8;
export const PASS_MAX = 128;
/** Lo que el servidor acepta de cuerpo en la API (bytes). */
export const BODY_MAX = 4096;
/** La foto de perfil: bytes máximos, lado (px) y tipos permitidos (nada de SVG). */
export const AVATAR_MAX = 40 * 1024;
export const AVATAR_PX = 128;
export const AVATAR_TYPES = ['image/webp', 'image/jpeg'];

// ── logros ───────────────────────────────────────────────────────────────
/** Contadores de progreso (los lleva el servidor por cuenta). */
export type StatKey = 'games' | 'escapes' | 'tapes' | 'photos' | 'holds' | 'kills' | 'falls';
export const STAT_LABEL: Record<StatKey, string> = { games: 'GAMES', escapes: 'ESCAPES', tapes: 'TAPES', photos: 'PHOTOS', holds: 'INSPECTIONS HELD', kills: 'KILLS', falls: 'FALLS' };

export interface AchievementDef {
  key: string;
  name: string;
  desc: string;
  /** Si va por contador: cuál y cuántos hacen falta. */
  stat?: StatKey;
  goal?: number;
  /** La rama del árbol de logros; dentro de una rama, el orden de esta lista es el de los nodos. */
  branch: Branch;
}
export const BRANCHES = ['ESCAPE', 'COLLECT', 'SURVIVE', 'COMBAT'] as const;
export type Branch = (typeof BRANCHES)[number];
export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'first_escape', name: 'FIRST EXIT', desc: 'Escape the Backrooms.', stat: 'escapes', goal: 1, branch: 'ESCAPE' },
  { key: 'team_player', name: 'TEAM PLAYER', desc: 'Escape in a room of 3 or more.', branch: 'ESCAPE' },
  { key: 'survivor', name: 'NO ONE LEFT BEHIND', desc: 'Escape with nobody in your room caught.', branch: 'ESCAPE' },
  { key: 'photographer', name: 'PHOTOGRAPHER', desc: 'Take 10 photos.', stat: 'photos', goal: 10, branch: 'COLLECT' },
  { key: 'tape_hoarder', name: 'TAPE HOARDER', desc: 'Collect 20 tapes in total.', stat: 'tapes', goal: 20, branch: 'COLLECT' },
  { key: 'night_owl', name: 'NIGHT OWL', desc: 'Play 10 games.', stat: 'games', goal: 10, branch: 'SURVIVE' },
  { key: 'held_breath', name: 'HELD BREATH', desc: 'Hold your breath through an inspection while hiding.', branch: 'SURVIVE' },
  { key: 'pit_fall', name: 'WATCH YOUR STEP', desc: 'Fall into the void.', stat: 'falls', goal: 1, branch: 'SURVIVE' },
  { key: 'idiot', name: 'GOOD JOB IDIOT', desc: 'Kill an entity. Now what?', branch: 'COMBAT' },
  { key: 'trigger_happy', name: 'TRIGGER HAPPY', desc: 'Take down 5 entities.', stat: 'kills', goal: 5, branch: 'COMBAT' },
];
export const ACHIEVEMENT_KEYS = new Set(ACHIEVEMENTS.map((a) => a.key));

// ── cosméticos ───────────────────────────────────────────────────────────
export type Slot = 'color' | 'head' | 'back';
export interface CosmeticDef {
  slot: Slot;
  id: string;
  name: string;
  /** El logro que lo desbloquea (null: gratis). */
  need: string | null;
  /** color: el tinte. head / back: el modelo (client/public/models/cosmetics/<id>.glb). */
  hex?: string;
}
export const COSMETICS: CosmeticDef[] = [
  { slot: 'color', id: 'stock', name: 'STOCK', need: null, hex: '#ffffff' },
  { slot: 'color', id: 'rust', name: 'RUST', need: null, hex: '#ff8f78' },
  { slot: 'color', id: 'sand', name: 'SAND', need: null, hex: '#e9d9a6' },
  { slot: 'color', id: 'slate', name: 'SLATE', need: null, hex: '#9db4c8' },
  { slot: 'color', id: 'ice', name: 'ICE', need: 'night_owl', hex: '#8fd6ff' },
  { slot: 'color', id: 'moss', name: 'MOSS', need: 'photographer', hex: '#a6e07e' },
  { slot: 'color', id: 'amber', name: 'AMBER', need: 'tape_hoarder', hex: '#ffd24a' },
  { slot: 'color', id: 'ash', name: 'ASH', need: 'pit_fall', hex: '#9a9a94' },
  { slot: 'color', id: 'ink', name: 'INK', need: 'first_escape', hex: '#55555f' },
  { slot: 'color', id: 'teal', name: 'TEAL', need: 'team_player', hex: '#5fd1bd' },
  { slot: 'color', id: 'rose', name: 'ROSE', need: 'held_breath', hex: '#f2a1c0' },
  { slot: 'color', id: 'crimson', name: 'CRIMSON', need: 'trigger_happy', hex: '#e2534b' },
  { slot: 'head', id: 'bicorn_hat', name: 'BICORN', need: 'first_escape' },
  { slot: 'head', id: 'asian_conical_hat', name: 'CONICAL HAT', need: 'team_player' },
  { slot: 'head', id: 'ushanka', name: 'USHANKA', need: 'survivor' },
  { slot: 'head', id: 'witch_hat', name: 'WITCH HAT', need: 'held_breath' },
  { slot: 'head', id: 'doge_hat', name: 'DOGE HAT', need: 'idiot' },
  { slot: 'back', id: 'battery', name: 'BATTERY PACK', need: 'trigger_happy' },
];
export const cosmetic = (slot: Slot, id: string) => COSMETICS.find((c) => c.slot === slot && c.id === id);

/** Lo que lleva puesto un jugador: color (id) y, si lleva, sombrero y mochila ('' = nada). */
export interface Look {
  color: string;
  head: string;
  back: string;
}
export const DEFAULT_LOOK: Look = { color: 'stock', head: '', back: '' };
/** ¿Puede llevar este aspecto quien ha desbloqueado `unlocked` (claves de logro)? Un campo vacío siempre vale (menos el color). */
export function lookAllowed(look: Look, unlocked: ReadonlySet<string>) {
  const ok = (slot: Slot, id: string) => {
    const c = cosmetic(slot, id);
    return !!c && (!c.need || unlocked.has(c.need));
  };
  return ok('color', look.color) && (!look.head || ok('head', look.head)) && (!look.back || ok('back', look.back));
}
/** Un aspecto de lo que llegue por la red (o de la BD): solo ids conocidos; lo demás, por defecto. */
export function cleanLook(x: unknown): Look {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const pick = (slot: Slot, dflt: string) => (typeof o[slot] === 'string' && cosmetic(slot, o[slot] as string) ? (o[slot] as string) : dflt);
  return { color: pick('color', 'stock'), head: pick('head', ''), back: pick('back', '') };
}

// ── lo que devuelve la API ───────────────────────────────────────────────
export interface Me {
  username: string;
  /** Es la cuenta de admin (solo para MOSTRAR la consola: el servidor vuelve a comprobarlo en cada acción). */
  admin?: boolean;
  /** Su foto de perfil (`<id>?v=<versión>`), vacío si no tiene. */
  avatar: string;
  /** clave → cuándo (ms). */
  achievements: Record<string, number>;
  stats: Partial<Record<StatKey, number>>;
  loadout: Look;
  /** Ids de cosméticos desbloqueados, `slot:id`. */
  unlocked: string[];
  /** logro → % de las cuentas que lo tienen. */
  rarity: Record<string, number>;
}

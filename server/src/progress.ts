import { ACHIEVEMENTS, ACHIEVEMENT_KEYS, type StatKey } from '@backrooms/shared';
import { bumpStat, unlockAchievement } from './db';

/*
 * Conceder logros: los eventos de la partida (match.ts / index.ts) llaman a `award` y `count`; aquí se guarda y, si es
 * nuevo, se avisa (index.ts engancha `hooks.notify` para mandar `achievement` por el socket del jugador).
 */
export const hooks = {
  notify: (_uid: number, _key: string) => {},
  /** Cambió el armario de la cuenta: los sockets de esa cuenta refrescan su aspecto. */
  loadout: (_uid: number) => {},
};

export function award(uid: number, key: string) {
  if (!ACHIEVEMENT_KEYS.has(key) || !unlockAchievement(uid, key)) return false;
  hooks.notify(uid, key);
  return true;
}

/** Suma al contador y concede los logros por contador que ya se alcanzan. */
export function count(uid: number, stat: StatKey, by = 1) {
  const v = bumpStat(uid, stat, by);
  for (const a of ACHIEVEMENTS) if (a.stat === stat && a.goal && v >= a.goal) award(uid, a.key);
}

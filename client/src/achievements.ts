/** Los logros de la partida, en el navegador de quien juega (el portfolio original los enseñaba en su muro). */
export type AchievementId = 'backrooms' | 'idiot';

const KEY = 'br-achievements';
const read = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
};

export const has = (id: AchievementId) => id in read();

export function unlock(id: AchievementId) {
  const all = read();
  if (id in all) return;
  all[id] = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

const IMPORTED = 'br-ach-imported';
/** Los logros de este navegador que se pueden llevar a una cuenta (una vez): el servidor solo acepta `backrooms` e `idiot`. */
export function list(): string[] {
  try {
    if (localStorage.getItem(IMPORTED)) return [];
  } catch {}
  return Object.keys(read()).filter((k) => k === 'backrooms' || k === 'idiot');
}
export function markImported() {
  try {
    localStorage.setItem(IMPORTED, '1');
  } catch {}
}

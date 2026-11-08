import { ACHIEVEMENT_KEYS, ITEM_IDS, type AdminAction, type Kind } from '@backrooms/shared';

/*
 * Validación de la consola de admin. Lo que llega por el socket es basura hasta que pasa por aquí: solo salen acciones de la lista,
 * con cadenas cortas y números acotados. Nunca se evalúa nada ni se usa un texto del cliente como ruta o clave sin comprobarlo.
 */
const id = (v: unknown) => (typeof v === 'string' && v.length >= 1 && v.length <= 40 && !/[\u0000-\u001f]/.test(v) ? v : undefined);
const MONEY_MAX = 1_000_000;

export function parseAdmin(x: unknown): AdminAction | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>, t = id(o.t) ?? 'me';
  switch (o.a) {
    case 'level': {
      const lv = id(o.id);
      const seed = o.seed === undefined ? undefined : Number.isInteger(o.seed) && (o.seed as number) >= 1 && (o.seed as number) < 2 ** 31 ? (o.seed as number) : null;
      return lv && seed !== null ? { a: 'level', id: lv, seed } : null;
    }
    case 'run': case 'kill': case 'revive': case 'heal':
      return { a: o.a, t };
    case 'lobby': case 'mission': case 'tvs': case 'info':
      return { a: o.a };
    case 'god': case 'ammo':
      return typeof o.on === 'boolean' ? { a: o.a, t, on: o.on } : null;
    case 'tp': {
      if (o.to !== 'start' && o.to !== 'elevator' && o.to !== 'player') return null;
      return { a: 'tp', t, to: o.to, who: id(o.who) };
    }
    case 'money':
      return (o.mode === 'add' || o.mode === 'set') && Number.isInteger(o.n) && Math.abs(o.n as number) <= MONEY_MAX ? { a: 'money', mode: o.mode, n: o.n as number } : null;
    case 'give':
      return typeof o.item === 'string' && (ITEM_IDS as string[]).includes(o.item) ? { a: 'give', t, item: o.item as (typeof ITEM_IDS)[number] } : null;
    case 'award': {
      const key = id(o.key);
      return key && (key === '*' || ACHIEVEMENT_KEYS.has(key)) ? { a: 'award', t, key } : null; // '*': todos
    }
    case 'end':
      return typeof o.ok === 'boolean' ? { a: 'end', ok: o.ok } : null;
    case 'ent': {
      if (o.op !== 'spawn' && o.op !== 'clear' && o.op !== 'freeze' && o.op !== 'thaw') return null;
      const kind = o.kind === 'bacteria' || o.kind === 'partygoer' ? (o.kind as Kind) : undefined;
      return { a: 'ent', op: o.op, kind, near: id(o.near) };
    }
  }
  return null;
}
export const MONEY_LIMIT = MONEY_MAX;

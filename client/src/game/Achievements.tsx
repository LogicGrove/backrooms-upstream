import { useRef, useState, type KeyboardEvent } from 'react';
import { ACHIEVEMENTS, BRANCHES, COSMETICS, STAT_LABEL, type AchievementDef } from '@backrooms/shared';
import { type Account } from '../account';
import { list as localAchievements, markImported } from '../achievements';
import Frame from './Frame';
import './achievements.css';

/*
 * Los logros como árbol de progresión: una rama por categoría con sus nodos en cadena, y a un lado el detalle del
 * nodo elegido (progreso, recompensa, rareza). Flechas: ← → dentro de la rama, ↑ ↓ entre ramas, Intro no hace falta
 * (elegir es enfocar). Marco con pestañas: ALL o una sola rama.
 */

// un símbolo por logro, de los que casi cualquier fuente monoespaciada trae
const ICON: Record<string, string> = { first_escape: '▲', tape_hoarder: '▣', photographer: '◉', held_breath: '○', team_player: '♣', survivor: '♥', pit_fall: '▼', trigger_happy: '◆', night_owl: '☼', idiot: '☺' };
const slotName = { color: 'COLOR', head: 'HEAD', back: 'BACK' } as const;
const TABS = ['ALL', ...BRANCHES] as const;

const Lock = () => (
  <svg className="ach__lock" viewBox="0 0 12 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="1.5" y="6" width="9" height="7" fill="currentColor" stroke="none" />
    <path d="M3.5 6V4a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);

export function AchievementsScreen({ acct, onSignIn, onBack }: { acct: Account; onSignIn: () => void; onBack: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('ALL');
  const [sel, setSel] = useState(ACHIEVEMENTS[0].key);
  const [local, setLocal] = useState(localAchievements);
  const [err, setErr] = useState('');
  const tree = useRef<HTMLDivElement>(null);
  const me = acct.me;
  const have = me?.achievements ?? {};
  const rows = BRANCHES.filter((b) => tab === 'ALL' || b === tab).map((b) => ({ b, list: ACHIEVEMENTS.filter((a) => a.branch === b) }));
  const cur = ACHIEVEMENTS.find((a) => a.key === sel) ?? ACHIEVEMENTS[0];
  const shown = rows.some((r) => r.list.includes(cur)) ? cur : rows[0].list[0];

  const importLocal = async () => {
    try {
      await acct.importLegacy(local);
      markImported();
      setLocal([]);
    } catch (e) {
      setErr(String((e as Error)?.message ?? 'SOMETHING WENT WRONG').toUpperCase());
    }
  };
  // el siguiente alcanzable de cada rama: el primero sin desbloquear si todo lo anterior lo está
  const next = (list: AchievementDef[]) => list.find((a) => !(a.key in have));
  const move = (e: KeyboardEvent, r: number, i: number) => {
    const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!d) return;
    const rr = r + d[0], row = rows[rr];
    if (!row && d[0]) return; // ↑ del todo arriba o ↓ del todo abajo: nada (Frame ya lleva las pestañas)
    const ii = d[0] ? Math.min(i, row.list.length - 1) : i + d[1];
    const a = (row ?? rows[r]).list[ii];
    if (!a) return;
    e.preventDefault();
    setSel(a.key);
    requestAnimationFrame(() => tree.current?.querySelector<HTMLElement>(`[data-key="${a.key}"]`)?.focus());
  };

  const on = shown.key in have;
  const n = shown.stat ? me?.stats[shown.stat] ?? 0 : 0;
  const reward = COSMETICS.filter((c) => c.need === shown.key);
  const rare = me && (me.rarity?.[shown.key] ?? 0);
  const done = Object.keys(have).length;

  return (
    <Frame title="ACHIEVEMENTS" tabs={TABS} tab={tab} onTab={setTab} onBack={onBack}>
      <div className="ach">
        <div className="ach__main">
          <p className="ach__sum">
            {me ? `${done}/${ACHIEVEMENTS.length} UNLOCKED` : 'GUEST'}
            {!me && (
              <>
                {' · '}SIGN IN TO SAVE PROGRESS
                <button type="button" className="br-opt" onClick={onSignIn}>SIGN IN</button>
              </>
            )}
            {me && local.length > 0 && (
              <button type="button" className="br-opt" onClick={importLocal}>IMPORT {local.length} FROM THIS BROWSER</button>
            )}
          </p>
          {err && <p className="br-lobby__err" role="alert">{err}</p>}
          <div className="ach__tree" ref={tree} role="tabpanel" aria-label={tab}>
            {rows.map(({ b, list }, r) => {
              const nx = next(list);
              return (
                <section key={b} className="ach__branch" aria-label={b}>
                  <h2 className="ach__bn">{b}</h2>
                  <ul>
                    {list.map((a, i) => {
                      const got = a.key in have;
                      return (
                        <li key={a.key} data-prev={i > 0 && list[i - 1].key in have ? '' : undefined}>
                          <button
                            type="button"
                            className="ach__node"
                            data-key={a.key}
                            data-on={got || undefined}
                            data-next={nx === a || undefined}
                            aria-pressed={shown.key === a.key}
                            aria-label={`${a.name}, ${got ? 'unlocked' : 'locked'}`}
                            tabIndex={shown.key === a.key ? 0 : -1}
                            onFocus={() => setSel(a.key)}
                            onMouseEnter={() => setSel(a.key)}
                            onClick={() => setSel(a.key)}
                            onKeyDown={(e) => move(e, r, i)}
                          >
                            <span aria-hidden="true">{ICON[a.key] ?? '■'}</span>
                            {!got && <Lock />}
                          </button>
                          <span className="ach__nm" data-on={got || undefined}>{a.name}</span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
        <aside className="ach__det" aria-live="polite" aria-label="Achievement detail">
          <div className="ach__big" data-on={on || undefined} aria-hidden="true">
            {ICON[shown.key] ?? '■'}
            {!on && <Lock />}
          </div>
          <p className="ach__dn">{shown.name}</p>
          <p className="br-lobby__dim">{shown.desc}</p>
          {shown.stat && shown.goal ? (
            <div className="ach__prog">
              <div className="ach__meter" role="img" aria-label={`progress ${Math.min(n, shown.goal)} of ${shown.goal}`}>
                <i style={{ width: `${Math.round((Math.min(me ? (on ? shown.goal : n) : 0, shown.goal) / shown.goal) * 100)}%` }} />
              </div>
              <p className="br-lobby__dim">{me ? `${on ? shown.goal : Math.min(n, shown.goal)} / ${shown.goal} ${STAT_LABEL[shown.stat]}` : 'SIGN IN TO TRACK PROGRESS'}</p>
            </div>
          ) : (
            <p className="br-lobby__dim">{on ? 'COMPLETE' : 'ONE-OFF · NO COUNTER'}</p>
          )}
          <dl className="ach__facts">
            <dt>STATUS</dt>
            <dd>{on ? `UNLOCKED ${new Date(have[shown.key]).toLocaleDateString()}` : 'LOCKED'}</dd>
            <dt>REWARD</dt>
            <dd>{reward.length ? reward.map((c) => `${c.name} ${slotName[c.slot]}`).join(', ') : '—'}</dd>
            <dt>RARITY</dt>
            <dd>{rare == null ? '—' : `${rare}% OF PLAYERS`}</dd>
          </dl>
        </aside>
      </div>
    </Frame>
  );
}

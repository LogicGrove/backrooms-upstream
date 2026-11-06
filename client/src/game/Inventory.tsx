'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cosmetic, DEFAULT_LOOK, type Look } from '@backrooms/shared';
import type { Assets, Inv } from './game';
import { FITS, type Gear, type Slot } from './player';
import { cosmeticIcon, gearIcons, type IconKey } from './invIcons';
import InvAvatar from './InvAvatar';
import './inventory.css';

/*
 * El inventario (E): el menú en pantalla de la camcorder encima de la partida, que sigue corriendo.
 * A la izquierda, el personaje en 3D con sus ranuras de equipo (cabeza y espalda, el aspecto que llevas; manos y
 * cinturón, lo que se usa); en medio, la mochila en casillas; a la derecha, el detalle de lo elegido y los objetivos.
 * Se arrastra de una casilla a otra (ratón o dedo), doble clic o clic derecho equipa o guarda, Mayús+clic lo mueve
 * al instante. Qué se puede llevar y dónde lo decide player.ts (FITS); aquí solo se pide con onPlace.
 */

const NAME: Record<Gear, string> = { flashlight: 'FLASHLIGHT', camera: 'CAMCORDER', gun: 'RIFLE' };
const SLOTS: [Slot, string][] = [
  ['left', 'L HAND'],
  ['right', 'R HAND'],
  ['belt', 'BELT'],
];
const PACK = 20; // casillas de la mochila (5 × 4)

/** Una barra de bloques del OSD, de diez. */
const Bar = ({ v }: { v: number }) => {
  const n = Math.round(v * 10);
  return (
    <span aria-label={`${Math.round(v * 100)}%`}>
      {'▮'.repeat(n)}
      <span className="br-osd__dim">{'▮'.repeat(10 - n)}</span>
    </span>
  );
};

type Where = Slot | 'store';
type Sel = { kind: 'gear'; g: Gear } | { kind: 'tape' | 'spare' | 'ammo' | 'head' | 'back' };

export default function Inventory({
  inv,
  assets,
  look = DEFAULT_LOOK,
  reduced = false,
  onPlace,
  onLight,
  onClose,
}: {
  inv: Inv;
  assets: Assets;
  look?: Look;
  reduced?: boolean;
  onPlace: (s: Slot, g: Gear | 'none') => void;
  onLight: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'items' | 'photos'>('items');
  // la foto ampliada (índice) o ninguna
  const [zoom, setZoom] = useState<number | null>(null);
  // lo que se lleva (arrastrando, o tocado para soltarlo con otro toque), dónde va el fantasma y sobre qué casilla está
  const [held, setHeld] = useState<{ g: Gear; from: Where } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [over, setOver] = useState<Where | null>(null);
  const [sel, setSel] = useState<Sel>({ kind: 'gear', g: 'flashlight' });
  const down = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const fresh = useRef(false); // el clic que sigue a coger algo con un toque no lo suelta
  const dragged = useRef(false); // un arrastre no cuenta como clic

  const icons = useMemo(() => gearIcons(assets), [assets]);
  const [cos, setCos] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    for (const id of [look.head, look.back]) if (id && !cos[id]) void cosmeticIcon(id).then((u) => u && alive && setCos((c) => ({ ...c, [id]: u })));
    return () => void (alive = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look.head, look.back]);

  const at: Record<Slot, Gear | 'none'> = { left: inv.left, right: inv.hand, belt: inv.belt };
  const owned: Gear[] = ['flashlight', ...(inv.camera ? (['camera'] as const) : []), ...(inv.gun ? (['gun'] as const) : [])];
  const stored = owned.filter((g) => !Object.values(at).includes(g));
  // la mochila: primero lo que se cuenta, luego el equipo guardado
  const stacks: { kind: 'tape' | 'spare' | 'ammo'; n: number }[] = [
    ...(inv.tapes ? [{ kind: 'tape' as const, n: inv.tapes }] : []),
    ...(inv.spares ? [{ kind: 'spare' as const, n: inv.spares }] : []),
    ...(inv.gun && inv.spare ? [{ kind: 'ammo' as const, n: inv.spare }] : []),
  ];
  const cells = stacks.length + stored.length;

  // Tab cierra; con una foto ampliada, Escape la cierra (y no el inventario) y las flechas pasan de una a otra
  useEffect(() => {
    const n = inv.full.length;
    const key = (e: KeyboardEvent) => {
      if (zoom === null) {
        if (e.code === 'Tab') (e.preventDefault(), onClose());
        return;
      }
      if (e.code !== 'Escape' && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.code === 'Escape') setZoom(null);
      else setZoom((z) => (z === null ? z : (z + (e.code === 'ArrowRight' ? 1 : -1) + n) % n));
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [zoom, inv.full.length, onClose]);

  // soltar en `to`: en una casilla que le vale, va ahí; en la mochila, sale de donde estaba
  const drop = (to: Where | null) => {
    if (held && to && to !== held.from) {
      if (to === 'store') onPlace(held.from as Slot, 'none');
      else if (FITS[to].includes(held.g)) onPlace(to, held.g);
    }
    setHeld(null);
    setGhost(null);
    setOver(null);
  };
  const whereAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest('[data-where]') as HTMLElement | null)?.dataset.where as Where | undefined;

  // doble clic, clic derecho o Mayús+clic: de la mochila, a la primera casilla libre que le vale; de una casilla, a la mochila
  const quick = (g: Gear, from: Where) => {
    if (from !== 'store') return onPlace(from, 'none');
    const fits = SLOTS.map(([s]) => s).filter((s) => FITS[s].includes(g));
    onPlace(fits.find((s) => at[s] === 'none') ?? fits[0], g);
  };

  const grab = (g: Gear, from: Where) => (e: React.PointerEvent) => {
    setSel({ kind: 'gear', g });
    if (held || e.button !== 0) return; // ya lleva uno (por toque): este toque lo suelta, ver onClick de la casilla
    down.current = { x: e.clientX, y: e.clientY, moved: false };
    dragged.current = false;
    setHeld({ g, from });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = down.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) d.moved = dragged.current = true;
    if (d.moved) (setGhost({ x: e.clientX, y: e.clientY }), setOver(whereAt(e.clientX, e.clientY) ?? null));
  };
  const up = (e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (d?.moved) drop(whereAt(e.clientX, e.clientY) ?? null);
    else if (e.pointerType === 'mouse') setHeld(null); // el ratón: un clic solo elige
    else fresh.current = true; // el dedo: queda cogido hasta tocar una casilla
  };
  // un toque en una casilla (o en la mochila) con algo cogido lo suelta ahí
  const tap = (to: Where) => () => {
    if (fresh.current) fresh.current = false;
    else if (held && !down.current) drop(to);
  };

  const gear = (g: Gear, from: Where) => (
    <button
      type="button"
      className="iv-item"
      data-held={held?.g === g || undefined}
      data-sel={(sel.kind === 'gear' && sel.g === g) || undefined}
      onPointerDown={grab(g, from)}
      onPointerMove={move}
      onPointerUp={up}
      onDoubleClick={() => quick(g, from)}
      onContextMenu={(e) => (e.preventDefault(), quick(g, from))}
      onClick={(e) => e.shiftKey && !dragged.current && quick(g, from)}
      aria-label={`${NAME[g]}: drag to a slot, double click to ${from === 'store' ? 'equip' : 'put away'}`}
    >
      <img src={icons[g]} alt="" draggable={false} />
    </button>
  );
  const stack = (kind: 'tape' | 'spare' | 'ammo', n: number) => (
    <button type="button" className="iv-item" data-sel={sel.kind === kind || undefined} onClick={() => setSel({ kind })} aria-label={`${kind === 'tape' ? 'VHS tapes' : kind === 'spare' ? 'Spare flashlights' : 'Rifle ammo'} ×${n}`}>
      <img src={icons[kind as IconKey]} alt="" draggable={false} />
      <b>×{n}</b>
    </button>
  );
  const cosSlot = (slot: 'head' | 'back', label: string) => {
    const id = look[slot], def = id ? cosmetic(slot, id) : undefined;
    return (
      <div className="iv-slot" data-cos>
        <span className="iv-label">{label}</span>
        {id && def ? (
          <button type="button" className="iv-item" data-sel={sel.kind === slot || undefined} onClick={() => setSel({ kind: slot })} aria-label={def.name}>
            {cos[id] ? <img src={cos[id]} alt="" draggable={false} /> : <span className="br-osd__dim">…</span>}
          </button>
        ) : (
          <span className="iv-empty">NONE</span>
        )}
      </div>
    );
  };

  // el detalle de lo elegido
  const detail = (() => {
    if (sel.kind === 'tape') return { title: 'VHS TAPE', lines: [`COLLECTED ${inv.tapes}/8`, 'Recorded tapes. Find them all.'], icon: icons.tape };
    if (sel.kind === 'spare') return { title: 'SPARE FLASHLIGHT', lines: [`×${inv.spares} IN THE BACKPACK`, 'Swaps in when the battery dies.'], icon: icons.spare };
    if (sel.kind === 'ammo') return { title: 'RIFLE AMMO', lines: [`${inv.spare} IN RESERVE`, 'Reloads the rifle (R).'], icon: icons.ammo };
    if (sel.kind === 'head' || sel.kind === 'back') {
      const id = look[sel.kind], def = id ? cosmetic(sel.kind, id) : undefined;
      return { title: def?.name ?? 'NONE', lines: [sel.kind === 'head' ? 'HEAD' : 'BACK', 'Change it at the computer in the waiting room.'], icon: id ? cos[id] : undefined };
    }
    const g = (sel as { g: Gear }).g; // lo demás ya volvió arriba
    const lines =
      g === 'flashlight'
        ? [`BATTERY ${Math.round(inv.charge * 100)}%`, inv.flashOn ? 'ON' : 'OFF', 'Lights the way. [F] switches it.']
        : g === 'camera'
          ? [`BATTERY ${Math.round(inv.battery * 100)}%`, `PHOTOS ${inv.photos}/2`, 'Hold it, right click, click.']
          : [`AMMO ${inv.ammo}/3 +${inv.spare}`, 'Right click to aim, click to fire.'];
    return { title: NAME[g], lines, icon: icons[g] };
  })();

  const goals: [string, number, number][] = [
    ['FIND A CAMCORDER', inv.camera ? 1 : 0, 1],
    ['FIND VHS TAPES', inv.tapes, 8],
    ['PHOTOGRAPH ENTITIES', inv.photos, 2],
    ['REACH THE ELEVATOR', inv.escaped ? 1 : 0, 1],
  ];
  const worn = { left: inv.left, hand: inv.hand, belt: inv.belt };

  return (
    <div className="br-inv" role="dialog" aria-label="Inventory">
      <div className="br-inv__tabs" role="tablist">
        <button type="button" role="tab" className="br-opt" aria-selected={tab === 'items'} onClick={() => setTab('items')}>
          CHARACTER
        </button>
        <button type="button" role="tab" className="br-opt" aria-selected={tab === 'photos'} onClick={() => setTab('photos')}>
          PHOTOS {inv.thumbs.length}
        </button>
        <button type="button" className="br-opt br-inv__exit" onClick={onClose}>
          EXIT [E]
        </button>
      </div>
      {tab === 'items' ? (
        <div className="iv">
          <section className="iv-col" aria-label="Equipment">
            <p className="br-inv__head">EQUIPMENT</p>
            <div className="iv-eq">
              <div className="iv-side">
                {cosSlot('head', 'HEAD')}
                {cosSlot('back', 'BACK')}
                <div className="iv-slot" data-where="left" data-fits={(held && FITS.left.includes(held.g)) || undefined} data-over={(over === 'left' && held && FITS.left.includes(held.g)) || undefined} onClick={tap('left')}>
                  <span className="iv-label">L HAND</span>
                  {at.left !== 'none' ? gear(at.left, 'left') : <span className="iv-empty">EMPTY</span>}
                </div>
              </div>
              <InvAvatar assets={assets} look={look} worn={worn} reduced={reduced} />
              <div className="iv-side">
                {(['right', 'belt'] as const).map((s) => (
                  <div key={s} className="iv-slot" data-where={s} data-fits={(held && FITS[s].includes(held.g)) || undefined} data-over={(over === s && held && FITS[s].includes(held.g)) || undefined} onClick={tap(s)}>
                    <span className="iv-label">{s === 'right' ? 'R HAND' : 'BELT'}</span>
                    {at[s] !== 'none' ? gear(at[s] as Gear, s) : <span className="iv-empty">EMPTY</span>}
                  </div>
                ))}
              </div>
            </div>
            <p className="br-inv__keys">DRAG THE CHARACTER TO TURN IT. [Q] SWAPS R HAND AND BELT.</p>
          </section>

          <section className="iv-col" aria-label="Backpack">
            <p className="br-inv__head iv-between">
              <span>BACKPACK</span>
              <span>
                {cells}/{PACK}
              </span>
            </p>
            <div className="iv-grid" data-where="store" data-over={(over === 'store' && held && held.from !== 'store') || undefined} onClick={tap('store')}>
              {Array.from({ length: PACK }, (_, i) => (
                <div key={i} className="iv-cell">
                  {i < stacks.length ? stack(stacks[i].kind, stacks[i].n) : stored[i - stacks.length] && gear(stored[i - stacks.length], 'store')}
                </div>
              ))}
            </div>
            <p className="br-inv__keys">DRAG TO A SLOT. DOUBLE CLICK OR RIGHT CLICK EQUIPS. SHIFT+CLICK MOVES. ON A TOUCH SCREEN, TAP THEN TAP A SLOT.</p>
          </section>

          <section className="iv-col" aria-label="Details">
            <p className="br-inv__head">DETAILS</p>
            <div className="iv-detail">
              <div className="iv-detail__icon">{detail.icon ? <img src={detail.icon} alt="" /> : <span className="br-osd__dim">∅</span>}</div>
              <div>
                <p className="iv-detail__t">{detail.title}</p>
                {detail.lines.map((l) => (
                  <p key={l} className="iv-detail__l">
                    {l}
                  </p>
                ))}
                {sel.kind === 'gear' && sel.g === 'flashlight' && at.left === 'flashlight' && (
                  <button type="button" className="br-opt br-inv__switch" onClick={onLight}>
                    {inv.charge <= 0 ? (inv.spares ? 'NEW BATTERY' : 'DEAD') : inv.flashOn ? 'SWITCH OFF' : 'SWITCH ON'}
                  </button>
                )}
              </div>
            </div>
            <p className="br-inv__head">TAPES {inv.tapes}/8</p>
            <ul className="br-inv__goals">
              {goals.map(([t, n, of]) => (
                <li key={t} data-done={n >= of || undefined}>
                  <span>{t}</span>
                  <span>
                    {n}/{of}
                  </span>
                </li>
              ))}
            </ul>
            <p className="br-inv__head">BIOMETRICS</p>
            <ul className="br-inv__goals">
              <li data-low={inv.sanity < 0.3 || undefined}>
                <span>SANITY</span>
                <Bar v={inv.sanity} />
              </li>
              <li data-low={inv.stamina < 0.25 || undefined}>
                <span>STAMINA</span>
                <Bar v={inv.stamina} />
              </li>
            </ul>
          </section>
        </div>
      ) : inv.thumbs.length ? (
        <div className="br-inv__photos">
          {inv.thumbs.map((src, i) => (
            <button key={i} type="button" className="br-inv__photo" onClick={() => setZoom(i)} aria-label={`Photo ${i + 1}: enlarge`}>
              <img src={src} alt="" width={160} height={120} />
            </button>
          ))}
        </div>
      ) : (
        <p className="br-inv__head">NO PHOTOS. HOLD THE CAMCORDER, RIGHT CLICK, CLICK.</p>
      )}
      {zoom !== null && inv.full[zoom] && (
        <div className="br-zoom" role="dialog" aria-label={`Photo ${zoom + 1}`} onClick={() => setZoom(null)}>
          <p className="br-zoom__head">
            PHOTO {zoom + 1}/{inv.full.length}
          </p>
          <img className="br-zoom__img" src={inv.full[zoom]} alt={`Photo ${zoom + 1}`} onClick={(e) => e.stopPropagation()} />
          <div className="br-zoom__bar" onClick={(e) => e.stopPropagation()}>
            {inv.full.length > 1 && (
              <button type="button" className="br-opt" onClick={() => setZoom((zoom + inv.full.length - 1) % inv.full.length)}>
                PREV
              </button>
            )}
            {inv.full.length > 1 && (
              <button type="button" className="br-opt" onClick={() => setZoom((zoom + 1) % inv.full.length)}>
                NEXT
              </button>
            )}
            <a className="br-opt" href={inv.full[zoom]} download={`backrooms-photo-${zoom + 1}.jpg`}>
              DOWNLOAD
            </a>
            <button type="button" className="br-opt" autoFocus onClick={() => setZoom(null)}>
              BACK [ESC]
            </button>
          </div>
        </div>
      )}
      {held && ghost && (
        <div className="iv-ghost" style={{ transform: `translate(${ghost.x}px, ${ghost.y}px)` }} aria-hidden="true">
          <img src={icons[held.g]} alt="" />
        </div>
      )}
    </div>
  );
}

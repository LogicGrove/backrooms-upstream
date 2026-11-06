import { useState, type ReactNode } from 'react';
import Frame from './Frame';
import { Crosshair } from './Crosshair';
import { DEFAULTS, setSetting, useSettings, type Settings } from '../settings';

/*
 * SETTINGS: una pestaña por bloque (audio, controles, imagen, accesibilidad) a todo el ancho y en dos columnas: a la izquierda
 * la lista de ajustes (nombre, una línea de qué hace y el control: barra larga con su valor o un interruptor) y a la derecha
 * el panel del ajuste elegido (por el ratón o el foco) con su descripción y una vista previa. Se guardan solos (localStorage,
 * ver settings.ts); RESET devuelve el bloque —o todo— a lo de fábrica.
 */

type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

interface Row {
  id: string;
  label: string;
  desc: string; // una línea, bajo el nombre
  long: string; // el panel de la derecha
  note?: string;
  num?: { k: NumKey; min: number; max: number; step: number; unit: string; scale: number };
  flag?: BoolKey | 'mute';
}

const pct = (k: NumKey): Row['num'] => ({ k, min: 0, max: 1, step: 0.05, unit: '%', scale: 100 });

const SECTIONS = {
  AUDIO: [
    { id: 'mute', label: 'MUTE', desc: 'All sound off', long: 'Silences the whole game. The volumes below stay where you left them.', flag: 'mute' },
    { id: 'volume', label: 'MASTER VOLUME', desc: 'Everything you hear', long: 'The overall level of the game, menu included.', num: pct('volume') },
    { id: 'sfx', label: 'EFFECTS', desc: 'Footsteps, shots, entities', long: 'Sounds that happen at a moment: footsteps, the camera, the rifle, whatever is hunting you. Lowering it makes the Backrooms quieter, not safer.', num: pct('sfx') },
    { id: 'ambient', label: 'AMBIENT', desc: 'Lights, vents, tape hiss', long: 'The constant bed: the fluorescent hum, the ventilation and the hiss of the tape.', num: pct('ambient') },
  ],
  CONTROLS: [
    { id: 'sens', label: 'MOUSE SENSITIVITY', desc: 'How far the view turns', long: 'Multiplier on how far the view turns for each pixel the mouse moves.', num: { k: 'sens', min: 0.2, max: 3, step: 0.1, unit: 'x', scale: 1 } },
    { id: 'invertY', label: 'INVERT Y', desc: 'Mouse up looks down', long: 'Flips the vertical look: pushing the mouse forward looks down, like a flight stick.', flag: 'invertY' },
  ],
  VIDEO: [
    { id: 'vhs', label: 'VHS EFFECT', desc: 'Tape noise, bleed and tracking', long: 'How much the tape shows through when you look through the camera, die or take the elevator. At 0 the picture is clean; a corrupted tape always shows.', num: pct('vhs') },
    { id: 'fov', label: 'FIELD OF VIEW', desc: 'How much you see', long: 'The vertical angle of the lens. Wider shows more of the room and bends the edges.', num: { k: 'fov', min: 60, max: 110, step: 5, unit: '°', scale: 1 } },
    { id: 'crosshair', label: 'CROSSHAIR', desc: 'A dot at the centre', long: 'A small dot in the middle of the picture so you can tell where you are looking. It hides when you aim through the camera or the rifle, hide in a niche or open the bag.', flag: 'crosshair' },
    { id: 'fps', label: 'SHOW FPS', desc: 'A frame counter, top right', long: 'Shows how many frames per second the game is drawing, on every screen.', flag: 'fps' },
  ],
  ACCESSIBILITY: [
    { id: 'reduceMotion', label: 'REDUCE MOTION', desc: 'No sway, shake or flicker', long: 'Stills the camera sway, the tape bands and the flicker, and shortens the door sequence. It is also on if your system asks for reduced motion.', note: 'APPLIES ON RELOAD', flag: 'reduceMotion' },
    { id: 'toggleBreath', label: 'TOGGLE BREATH HOLD', desc: 'Press once, not hold', long: 'Hiding in a niche and an entity looks in: press SPACE once to hold your breath and again to let go, instead of keeping the key down.', flag: 'toggleBreath' },
  ],
} satisfies Record<string, Row[]>;
type Section = keyof typeof SECTIONS;
const TABS = Object.keys(SECTIONS) as Section[];
const BLOCKS = 24;

const show = (n: NonNullable<Row['num']>, v: number) => `${n.unit === 'x' ? (v * n.scale).toFixed(1) : Math.round(v * n.scale)}${n.unit}`;

function Meter({ v }: { v: number }) {
  const on = Math.round(v * BLOCKS);
  return (
    <p className="br-meter" aria-hidden="true">
      {'▮'.repeat(on)}
      <span className="br-lobby__dim">{'▮'.repeat(BLOCKS - on)}</span>
    </p>
  );
}

/** La vista previa del ajuste elegido. */
function Preview({ row, s, muted }: { row: Row; s: Settings; muted: boolean }): ReactNode {
  switch (row.id) {
    case 'mute':
      return <p className="br-big">{muted ? 'SOUND OFF' : 'SOUND ON'}</p>;
    case 'volume':
    case 'sfx':
    case 'ambient':
      return <Meter v={muted ? 0 : s[row.id] * (row.id === 'volume' ? 1 : s.volume)} />;
    case 'sens':
      return (
        <p className="br-big">
          100 PX = {Math.round(100 * 0.0022 * s.sens * (180 / Math.PI) * 10) / 10}°
          <span className="br-lobby__dim br-big__s"> of turn</span>
        </p>
      );
    case 'invertY':
      return (
        <p className="br-big">
          MOUSE ↑ = LOOK {s.invertY ? 'DOWN ↓' : 'UP ↑'}
        </p>
      );
    case 'vhs':
      return (
        <div className="br-tape-prev" style={{ ['--a' as string]: s.vhs }} aria-hidden="true">
          <span>● REC 00:42:17</span>
          <span>SP</span>
        </div>
      );
    case 'fov': {
      const a = (s.fov / 2) * (Math.PI / 180), dx = 104 * Math.sin(a), dy = 104 * Math.cos(a);
      return (
        <svg className="br-fovprev" viewBox="0 0 240 142" role="img" aria-label={`${s.fov} degrees`}>
          <polygon points={`120,114 ${120 - dx},${114 - dy} ${120 + dx},${114 - dy}`} fill="none" stroke="currentColor" strokeWidth="2" />
          <text x="120" y="136" textAnchor="middle" fill="currentColor" fontSize="16">{s.fov}°</text>
        </svg>
      );
    }
    case 'crosshair':
      return (
        <p className="br-big">
          {s.crosshair ? <Crosshair /> : null} {s.crosshair ? 'ON' : 'OFF'}
        </p>
      );
    case 'fps':
      return <p className="br-big">{s.fps ? '60 FPS' : 'HIDDEN'}</p>;
    case 'reduceMotion':
      return <p className="br-big">{s.reduceMotion ? 'STILL' : 'FULL MOTION'}</p>;
    case 'toggleBreath':
      return <p className="br-big">SPACE · {s.toggleBreath ? 'PRESS TO HOLD, PRESS TO LET GO' : 'KEEP PRESSED'}</p>;
  }
  return null;
}

export default function SettingsPane({ muted, toggleSound, onBack }: { muted: boolean; toggleSound: () => void; onBack: () => void }) {
  const [tab, setTab] = useState<Section>('AUDIO');
  const [pick, setPick] = useState<Record<string, string>>({});
  const s = useSettings();
  const rows: Row[] = SECTIONS[tab];
  const row = rows.find((r) => r.id === pick[tab]) ?? rows[0];
  const keys = rows.flatMap((r) => (r.num ? [r.num.k] : r.flag && r.flag !== 'mute' ? [r.flag] : []));
  const reset = (ks: (keyof Settings)[]) => ks.forEach((k) => setSetting(k, DEFAULTS[k] as never));

  return (
    <Frame title="SETTINGS" tabs={TABS} tab={tab} onTab={setTab} onBack={onBack}>
      <div className="br-set2" role="tabpanel" aria-label={tab}>
        <ul
          className="br-set2__list"
          onKeyDown={(e) => {
            // ↑ ↓ pasan de un ajuste a otro (en una barra, además, cambiarían su valor)
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            const all = [...e.currentTarget.querySelectorAll<HTMLElement>('input, button')], i = all.indexOf(document.activeElement as HTMLElement);
            all[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
            e.preventDefault();
          }}
        >
          {rows.map((r) => {
            const f = r.flag, on = f === 'mute' ? muted : f ? s[f] : false;
            return (
              <li key={r.id} className="br-row" data-sel={r === row || undefined} onMouseEnter={() => setPick({ ...pick, [tab]: r.id })} onFocus={() => setPick({ ...pick, [tab]: r.id })}>
                <span className="br-row__l">
                  <span className="br-row__t">
                    {r.label}
                    {r.note && <span className="br-lobby__dim"> · {r.note}</span>}
                  </span>
                  <span className="br-row__d">{r.desc}</span>
                </span>
                {r.num ? (
                  <span className="br-row__c">
                    <input type="range" className="br-range" aria-label={r.label} min={r.num.min} max={r.num.max} step={r.num.step} value={s[r.num.k]} onChange={(e) => setSetting(r.num!.k, Number(e.target.value))} />
                    <output className="br-row__v">{show(r.num, s[r.num.k])}</output>
                  </span>
                ) : (
                  <button type="button" className="br-opt br-row__sw" role="switch" aria-checked={on} aria-label={r.label} onClick={() => (f === 'mute' ? toggleSound() : f && setSetting(f, !s[f]))}>
                    {on ? 'ON' : 'OFF'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <aside className="br-set2__side" aria-live="polite">
          <p className="br-set2__h">{row.label}</p>
          <p>{row.long}</p>
          <div className="br-set2__prev">
            <Preview row={row} s={s} muted={muted} />
          </div>
        </aside>
        <div className="br-pane__foot">
          <button type="button" className="br-opt" onClick={() => reset(keys)} disabled={keys.every((k) => s[k] === DEFAULTS[k])}>
            RESET {tab}
          </button>
          <button type="button" className="br-opt" onClick={() => reset(Object.keys(DEFAULTS) as (keyof Settings)[])}>
            RESET ALL
          </button>
          <span className="br-lobby__dim br-lobby__keys">↑ ↓ SELECT · ◀ ▶ CHANGE · SAVED IN THIS BROWSER · ESC BACK</span>
        </div>
      </div>
    </Frame>
  );
}

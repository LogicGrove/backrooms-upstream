import { useEffect, useRef, useState } from 'react';
import { applyCarry, CAMS, useStudio } from './store';

/*
 * Lo que se pone sobre el visor 3D: ángulos de cámara predefinidos, el mando de pruebas (palanca, velocidad, caminar solo, cinta andadora,
 * cámara lenta, pausa) y la ayuda de atajos.
 */

export function CamBar() {
  const { S } = useStudio();
  const [, force] = useState(0);
  const f = () => force((n) => n + 1);
  if (!S) return null;
  const m = S.ctl;
  return (
    <div className="st-cambar">
      {CAMS.map(([id, label, key]) => (
        <button key={id} data-on={(id === 'first' ? S.first : false) || undefined} title={`camera: ${label} (${key})`} onClick={() => (S.setCam(id), f())}>{label}<kbd>{key}</kbd></button>
      ))}
      <i />
      <button data-on={m.skeleton || undefined} onClick={() => ((m.skeleton = !m.skeleton), f())} title="show the bones">bones</button>
      <button data-on={m.grid || undefined} onClick={() => ((m.grid = !m.grid), f())}>grid</button>
      <button onClick={() => (S.reset(), f())} title="R: put the character back in the middle">reset</button>
      <button onClick={() => window.dispatchEvent(new Event('st-help'))} title="?">?</button>
    </div>
  );
}

/** Palanca virtual: arrastrar hacia arriba avanza (más lejos = más rápido), a los lados gira. */
function Stick({ joy }: { joy: { x: number; y: number } }) {
  const pad = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  const move = (e: React.PointerEvent) => {
    const r = pad.current!.getBoundingClientRect(), R = r.width / 2;
    let x = (e.clientX - r.left - R) / R, y = -(e.clientY - r.top - R) / R;
    const l = Math.hypot(x, y);
    if (l > 1) (x /= l), (y /= l);
    joy.x = Math.abs(x) < 0.12 ? 0 : x;
    joy.y = y;
    force((n) => n + 1);
  };
  return (
    <div
      ref={pad}
      className="st-stick"
      onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), move(e))}
      onPointerMove={(e) => e.buttons && move(e)}
      onPointerUp={() => ((joy.x = joy.y = 0), force((n) => n + 1))}
      title="drag: up = walk / run, sides = turn"
    >
      <i style={{ left: `${50 + joy.x * 38}%`, top: `${50 - joy.y * 38}%` }} />
    </div>
  );
}

export function Mando() {
  const { S } = useStudio();
  const [open, setOpen] = useState(() => innerHeight > 700); // (en una ventana baja tapa el personaje)
  const [, force] = useState(0);
  useEffect(() => {
    const h = setInterval(() => force((n) => n + 1), 150);
    return () => clearInterval(h);
  }, []);
  if (!S) return null;
  const m = S.ctl, A = S.A;
  const set = (fn: () => void) => (fn(), force((n) => n + 1));
  return (
    <div className="st-mando" data-open={open || undefined}>
      <button className="st-mando-h" onClick={() => setOpen(!open)}>CONTROLLER {open ? '▾' : '▸'}</button>
      {open && (
        <div className="st-mando-b">
          <Stick joy={m.joy} />
          <div className="st-mando-c">
            <label>speed <input type="range" min={0} max={3.6} step={0.05} value={m.speed} onChange={(e) => set(() => ((m.speed = +e.target.value), m.auto === 'off' && m.speed > 0 && (m.auto = 'straight'), m.speed === 0 && (m.auto = 'off')))} /> <b>{m.speed.toFixed(1)}</b></label>
            <div className="st-seg3">
              {(['off', 'straight', 'circle'] as const).map((a) => <button key={a} data-on={m.auto === a || undefined} onClick={() => set(() => (m.auto = a))}>{a === 'off' ? 'manual' : a === 'straight' ? 'walk on its own' : 'walk in circle'}</button>)}
            </div>
            {m.auto === 'circle' && <label>turn <input type="range" min={-2.5} max={2.5} step={0.05} value={m.turn} onChange={(e) => set(() => (m.turn = +e.target.value))} /></label>}
            <div className="st-seg3">
              <button data-on={m.crouch || undefined} onClick={() => set(() => (m.crouch = !m.crouch))}>crouch</button>
              <button onClick={() => set(() => (m.jump = true))}>jump</button>
              <button data-on={m.treadmill || undefined} onClick={() => set(() => (m.treadmill = !m.treadmill))} title="stay in the middle; the floor slides">treadmill</button>
            </div>
            <label>time ×<input type="range" min={0.05} max={2} step={0.05} value={m.timeScale} onChange={(e) => set(() => (m.timeScale = +e.target.value))} /> <b>{m.timeScale.toFixed(2)}</b></label>
            <div className="st-seg3">
              {[0.1, 0.25, 0.5, 1].map((v) => <button key={v} data-on={m.timeScale === v || undefined} onClick={() => set(() => (m.timeScale = v))}>{v}×</button>)}
              <button data-on={m.paused || undefined} onClick={() => set(() => (m.paused = !m.paused))} title="P">{m.paused ? '▶' : '❚❚'}</button>
              <button onClick={() => set(() => ((m.paused = true), (m.step = true)))} title=".">step</button>
            </div>
            <div className="st-seg3">
              {(['none', 'rifle', 'flashlight'] as const).map((h) => <button key={h} data-on={(S.gear ? false : S.hold === h) || undefined} onClick={() => set(() => ((S.gear = ''), (S.hold = h), applyCarry(S)))}>{h}</button>)}
            </div>
            <small>state <b>{A.machine?.cur ?? '–'}</b> · speed <b>{(A.p.speed ?? 0).toFixed(1)}</b></small>
          </div>
        </div>
      )}
    </div>
  );
}

const KEYS: [string, string][] = [
  ['W / S', 'walk forward / back'], ['A / D', 'turn'], ['Shift', 'run'], ['C', 'crouch'], ['Space', 'jump'],
  ['1 – 9', 'camera: front, 3/4, side, back, top, hands, feet, first person, item'], ['P', 'pause'], ['.', 'one frame'], ['R', 'reset character'],
  ['Ctrl+Z / Ctrl+Y', 'undo / redo'], ['Ctrl+S', 'save everything'], ['?', 'this help'],
];
export function Help() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = () => setOpen((o) => !o);
    window.addEventListener('st-help', h);
    return () => window.removeEventListener('st-help', h);
  }, []);
  if (!open) return null;
  return (
    <div className="st-help" onClick={() => setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()}>
        <h3>Shortcuts</h3>
        <table><tbody>{KEYS.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}</tbody></table>
        <p>Drag the thin bars between panels to resize them. Drag the stick in the CONTROLLER to walk; set a speed and “walk on its own” to look at a gait without holding keys; “treadmill” keeps the character in the middle of the view.</p>
        <button onClick={() => setOpen(false)}>close</button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import * as THREE from 'three';
import { grips, DEFAULT_GRIPS, type GripId, type Hand, type V3 } from '../../game/grips';
import { worn, DEFAULT_WORN } from '../../game/worn';
import { useStudio, applyCarry } from './store';

/*
 * Los agarres (antes /?grips): dónde va cada objeto respecto a la vista, dónde se agarra con cada mano, cuánto se cierra cada dedo y hacia dónde
 * dobla el codo. Se ve en el Player de verdad, y las manos las lleva el IK del Animator (anim/ikstack.ts), con la animación del cuerpo debajo.
 * Los accesorios (sombreros, mochilas) siguen en /?grips.
 */

/** Lo que se agarra con la mano: los objetos del juego y los pequeños que aún no tienen función en la mano. */
const GEARS: GripId[] = ['flashlight', 'camera', 'gun', 'watergun', 'caution', 'radar', 'totem', 'water', 'soap', 'tape', 'ammo'];
const NAMES: Partial<Record<GripId, string>> = { camera: 'camcorder', gun: 'rifle', caution: 'duct tape', water: 'almond water', soap: 'soap', tape: 'vhs tape', ammo: 'ammo box' };
const D = Math.PI / 180;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const AIMABLE: GripId[] = ['camera', 'gun', 'watergun'];

function Num({ label, v, min, max, step, on }: { label: string; v: number; min: number; max: number; step: number; on: (n: number) => void }) {
  return (
    <div className="st-row">
      <span className="st-w">{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(+e.target.value)} style={{ flex: 1 }} />
      <input type="number" min={min} max={max} step={step} value={r3(v)} style={{ width: 62 }} onChange={(e) => on(+e.target.value)} />
    </div>
  );
}

/** La bombona de buceo, que va a la espalda: sitio respecto al torso, giro y tamaño. */
function TankEditor() {
  const { edit } = useStudio();
  const w = worn.tank;
  return (
    <div>
      <p className="st-hint">Other players see the tank on the character's back (the Back camera is on). Position is relative to the chest, in the body's frame.</p>
      <h4>position (m)</h4>
      {(['side', 'up', 'forward'] as const).map((k, i) => <Num key={k} label={k} v={w.pos[i]} min={-0.5} max={0.5} step={0.005} on={(n) => edit(() => (w.pos[i] = n))} />)}
      <h4>rotation (deg)</h4>
      {(['x', 'y', 'z'] as const).map((k, i) => <Num key={k} label={k} v={w.rot[i]} min={-180} max={180} step={1} on={(n) => edit(() => (w.rot[i] = n))} />)}
      <h4>size</h4>
      <Num label="height" v={w.size} min={0.2} max={1.2} step={0.01} on={(n) => edit(() => (w.size = n))} />
      <button onClick={() => edit(() => Object.assign(w, structuredClone(DEFAULT_WORN.tank)))}>revert</button>
    </div>
  );
}

export function GripsPanel() {
  const { S, edit } = useStudio();
  const [side, setSide] = useState<'left' | 'right'>('right');
  const [keep, setKeep] = useState(true);
  const [msg, setMsg] = useState('');
  if (!S) return null;
  const tankSel = S.tank;
  const gear = S.gear || 'gun';
  const g = grips[gear];
  const hasHand = (s: 'left' | 'right') => !!g[s];
  const hand: 'left' | 'right' = g[side] ? side : side === 'left' ? 'right' : 'left';
  const h = g[hand] as Hand | undefined;
  const view = g.view;
  const aimOn = S.gripAim && AIMABLE.includes(gear);
  const dirty = JSON.stringify(g) !== JSON.stringify(DEFAULT_GRIPS[gear]);

  const pickTank = () => {
    S.gear = '';
    S.tank = true;
    S.gripAim = false;
    applyCarry(S);
    S.setCam('back');
    edit();
  };
  const pick = (id: GripId) => {
    S.tank = false;
    S.gear = id;
    S.gripAim = false;
    applyCarry(S);
    setTimeout(() => S.setCam('item'), 150); // (la cámara va al objeto: tras un fotograma, cuando ya está en su sitio)
    edit();
  };
  const set3 = (a: V3, i: number, n: number) => edit(() => (a[i] = n));
  // mueve el objeto en la vista; con `keep` las manos no se mueven: su agarre, que va en el espacio del objeto, se reexpresa en el nuevo
  const setView = (a: V3, i: number, n: number, moves = true) =>
    edit(() => {
      const mat = () => new THREE.Matrix4().compose(new THREE.Vector3(...view.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(view.rot[0] * D, view.rot[1] * D, view.rot[2] * D)), new THREE.Vector3(1, 1, 1));
      const m0 = mat();
      a[i] = n;
      if (!keep || !moves) return;
      const to = mat().invert().multiply(m0), qt = new THREE.Quaternion().setFromRotationMatrix(to);
      for (const hd of [g.left, g.right]) {
        if (!hd) continue;
        const p = new THREE.Vector3(...hd.pos).applyMatrix4(to);
        hd.pos = [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)];
        const e = new THREE.Euler().setFromQuaternion(qt.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(hd.rot[0] * D, hd.rot[1] * D, hd.rot[2] * D))), 'XYZ');
        hd.rot = [+(e.x / D).toFixed(1), +(e.y / D).toFixed(1), +(e.z / D).toFixed(1)];
      }
    });
  const mirror = () => {
    const from = g[hand], to = hand === 'left' ? 'right' : 'left';
    if (!from) return;
    edit(() => (g[to] = { pos: [-from.pos[0], from.pos[1], from.pos[2]], rot: [from.rot[0], -from.rot[1], -from.rot[2]], curl: [...from.curl], spread: from.spread, pole: [-from.pole[0], from.pole[1], from.pole[2]] }));
    setMsg(`${hand} hand mirrored onto the ${to} hand`);
  };
  const revert = () => {
    edit(() => {
      for (const k of Object.keys(g)) delete (g as unknown as Record<string, unknown>)[k];
      Object.assign(g, structuredClone(DEFAULT_GRIPS[gear]));
    });
    setMsg(`${gear} reverted to the saved file`);
  };
  const xyz = ['x', 'y', 'z'] as const;

  return (
    <div>
      <p className="st-hint">The character carries the selected object. Hands follow it through the IK on top of the body animation: walk with <kbd>W</kbd> to check they keep up. Saving (Ctrl+S) writes grips.json.</p>
      <div className="st-chips big">
        {GEARS.map((id) => (
          <button key={id} data-on={S.gear === id || undefined} onClick={() => pick(id)}>{NAMES[id] ?? id}{JSON.stringify(grips[id]) !== JSON.stringify(DEFAULT_GRIPS[id]) ? ' ●' : ''}</button>
        ))}
        <button data-on={tankSel || undefined} onClick={pickTank} title="worn on the back, not in the hand">diving tank (worn){JSON.stringify(worn.tank) !== JSON.stringify(DEFAULT_WORN.tank) ? ' ●' : ''}</button>
      </div>
      {tankSel && <TankEditor />}
      {S.gear && (
        <>
          <div className="st-row">
            <label className="st-chk"><input type="checkbox" checked={S.first} onChange={(e) => ((S.first = e.target.checked), edit())} />first person view</label>
            {AIMABLE.includes(gear) && <label className="st-chk"><input type="checkbox" checked={aimOn} onChange={(e) => ((S.gripAim = e.target.checked), edit())} />aiming (right click)</label>}
          </div>
          <div className="st-row">
            {(['left', 'right'] as const).map((s) => (
              <button key={s} disabled={!hasHand(s)} data-on={hand === s || undefined} onClick={() => setSide(s)}>{s} hand</button>
            ))}
            {hasHand('left') && hasHand('right') && <button onClick={mirror} title="copy this hand onto the other, mirrored">mirror →</button>}
            <button disabled={!dirty} onClick={revert}>revert</button>
            <button onClick={() => navigator.clipboard?.writeText(JSON.stringify({ [gear]: g }, null, 2)).then(() => setMsg('copied ' + gear))}>copy json</button>
          </div>
          {h && !aimOn && (
            <>
              <h4>wrist (item space, m)</h4>
              {xyz.map((k, i) => <Num key={k} label={k} v={h.pos[i]} min={-0.4} max={0.4} step={0.001} on={(n) => set3(h.pos, i, n)} />)}
              <h4>hand orientation (deg)</h4>
              {xyz.map((k, i) => <Num key={k} label={k} v={h.rot[i]} min={-180} max={180} step={1} on={(n) => set3(h.rot, i, n)} />)}
              <h4>fingers</h4>
              {['thumb', 'index', 'middle', 'ring', 'pinky'].map((k, i) => <Num key={k} label={k} v={h.curl[i]} min={-0.6} max={1.8} step={0.01} on={(n) => edit(() => (h.curl[i] = n))} />)}
              <Num label="thumb out" v={h.spread} min={-1} max={1} step={0.01} on={(n) => edit(() => (h.spread = n))} />
              <h4>elbow direction (view space)</h4>
              {xyz.map((k, i) => <Num key={k} label={k} v={h.pole[i]} min={-1.2} max={1.2} step={0.01} on={(n) => set3(h.pole, i, n)} />)}
            </>
          )}
          <h4>{aimOn ? 'at the eye (view space, m)' : 'item in view (view space, m)'}</h4>
          {xyz.map((k, i) => {
            const a = aimOn && view.aim ? view.aim : view.pos;
            return <Num key={k} label={k} v={a[i]} min={-0.6} max={0.3} step={0.001} on={(n) => setView(a, i, n, !aimOn)} />;
          })}
          <label className="st-chk"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />hands stay put when moving the item</label>
          {!aimOn && (
            <>
              <h4>item rotation (deg)</h4>
              {xyz.map((k, i) => <Num key={k} label={k} v={view.rot[i]} min={-180} max={180} step={1} on={(n) => setView(view.rot, i, n)} />)}
            </>
          )}
          <p className="st-hint">{msg}</p>
        </>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { TREE, MANIFEST } from '../../game/anim/animator';
import { DANCES, timeline, type DanceDef, type Seg, type SequenceNode } from '../../game/anim/dance';
import type { Cond, NodeDef } from '../../game/anim/core';
import { useStudio, CAT_COLOR } from './store';

// ── línea de tiempo de bailes ─────────────────────────────────────────────

const LANE_H = 46;

export function Timeline() {
  const { S, edit, thumbs, clips, setSel } = useStudio();
  const ids = Object.keys(DANCES);
  const [id, setId] = useState(ids[0] ?? '');
  const [pps, setPps] = useState(60); // píxeles por segundo
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [seg, setSeg] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const d: DanceDef | undefined = DANCES[id];
  const A = S!.A;
  const tl = d ? timeline(d, A.ctx) : { starts: [], lens: [], total: 0 };

  // el baile en el visor: el nodo se crea al elegir el baile y avanza solo mientras suena; en pausa, se congela en `t`
  const node = () => A.overNode as (SequenceNode & { frozen: boolean }) | undefined;
  useEffect(() => {
    if (!d) return;
    S!.danceOn = true;
    A.playOver(id, { fadeIn: 0.1, hold: true });
    node()?.seek(t);
    const n = node();
    if (n) n.frozen = !playing;
    return () => {
      S!.danceOn = false;
      A.stopOver();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!d]);
  useEffect(() => {
    const n = node();
    if (n) n.frozen = !playing;
  }, [playing]);
  useEffect(() => {
    const h = setInterval(() => {
      const n = node();
      if (n && playing) setT(n.t);
    }, 50);
    return () => clearInterval(h);
  });
  const seek = (v: number) => {
    setT(v);
    const n = node();
    if (n) (n.frozen = true), n.seek(v);
    setPlaying(false);
  };

  const create = () => {
    const n = 'dance' + (ids.length + 1);
    edit(() => (DANCES[n] = { id: n, name: 'NEW DANCE', segs: [] }));
    setId(n);
  };
  if (!d)
    return (
      <div className="st-dock">
        <button className="st-big" onClick={create}>+ NEW DANCE</button>
        <p className="st-hint">No dances yet.</p>
      </div>
    );

  const drop = (e: React.DragEvent) => {
    const c = e.dataTransfer.getData('text/clip');
    if (!c) return;
    const x = e.clientX - track.current!.getBoundingClientRect().left + track.current!.scrollLeft, tt = x / pps;
    let at = 0;
    d.segs.forEach((_, i) => tl.starts[i] + tl.lens[i] / 2 < tt && (at = i + 1));
    edit(() => d.segs.splice(at, 0, { clip: c, in: 0, out: 0, rate: 1, loops: 1, fade: at > 0 ? 0.3 : 0 }));
    setSeg(at);
  };

  /** Arrastrar con el ratón: `move` recibe el avance en segundos desde el principio del gesto. */
  const drag = (e: React.PointerEvent, move: (dt: number, x: number) => void) => {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX, left = track.current!.getBoundingClientRect().left, sl = track.current!.scrollLeft;
    const mv = (ev: PointerEvent) => {
      move((ev.clientX - x0) / pps, (ev.clientX - left + sl) / pps);
      edit();
    };
    const up = () => (removeEventListener('pointermove', mv), removeEventListener('pointerup', up));
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  };

  const s = d.segs[seg] as Seg | undefined;
  const k = s && S!.pack.clips.get(s.clip);
  const num = (label: string, v: number, on: (n: number) => void, step = 0.05, min = 0) => (
    <label className="st-num">{label}<input type="number" step={step} min={min} value={+v.toFixed(3)} onChange={(e) => edit(() => on(Math.max(min, +e.target.value)))} /></label>
  );

  return (
    <div className="st-dock">
      <div className="st-row">
        {ids.map((i) => <button key={i} className="st-tab sm" data-on={i === id || undefined} onClick={() => (setId(i), setSeg(0), setT(0), setPlaying(false))}>{DANCES[i].name}</button>)}
        <button className="st-tab sm" onClick={create}>+</button>
        <span className="st-grow" />
        <input className="st-name" value={d.name} onChange={(e) => edit(() => (d.name = e.target.value.toUpperCase()))} />
        <label className="st-chk"><input type="checkbox" checked={!!d.loop} onChange={(e) => edit(() => (d.loop = e.target.checked))} />loop</label>
        <button title="delete this dance" onClick={() => { edit(() => delete DANCES[id]); setId(Object.keys(DANCES)[0] ?? ''); }}>🗑</button>
      </div>
      <div className="st-row">
        <button className="st-play" onClick={() => (playing ? setPlaying(false) : (t >= tl.total - 0.05 && seek(0), setPlaying(true)))}>{playing ? '❚❚' : '▶'}</button>
        <button onClick={() => seek(0)} title="back to start">⏮</button>
        <span className="st-time">{t.toFixed(1)} / {tl.total.toFixed(1)} s</span>
        <span className="st-grow" />
        <label className="st-chk">zoom <input type="range" min={20} max={160} value={pps} onChange={(e) => setPps(+e.target.value)} /></label>
      </div>
      <div className="st-track" ref={track} onDragOver={(e) => e.preventDefault()} onDrop={drop}>
        <div className="st-inner" style={{ width: Math.max(tl.total + 3, 8) * pps }}>
          <div className="st-ruler" onPointerDown={(e) => seek((e.clientX - track.current!.getBoundingClientRect().left + track.current!.scrollLeft) / pps)}>
            {Array.from({ length: Math.ceil(tl.total + 3) }, (_, i) => <span key={i} style={{ left: i * pps }}>{i}s</span>)}
          </div>
          {d.segs.length === 0 && <p className="st-empty">Drag clips here from the library →  they play in order, each blending into the previous one.</p>}
          {d.segs.map((sg, i) => {
            const k2 = S!.pack.clips.get(sg.clip), left = tl.starts[i] * pps, w = Math.max(18, tl.lens[i] * pps), cat = MANIFEST[sg.clip] ?? 'part';
            return (
              <div
                key={i}
                className="st-seg"
                data-on={i === seg || undefined}
                style={{ left, width: w, top: 24 + (i % 2) * (LANE_H + 4), height: LANE_H, ['--c' as string]: CAT_COLOR[cat] }}
                onPointerDown={(e) => {
                  setSeg(i);
                  setSel(sg.clip);
                  // arrastrar el bloque: cambia su sitio en el orden
                  drag(e, (_, x) => {
                    let to = 0;
                    d.segs.forEach((_s, j) => j !== i && tl.starts[j] + tl.lens[j] / 2 < x && (to = j < i ? j + 1 : j));
                    if (to !== i) (d.segs.splice(to, 0, d.segs.splice(i, 1)[0]), setSeg(to));
                  });
                }}
                title={`${sg.clip}${k2 ? ` (${k2.dur.toFixed(1)}s)` : ''}`}
              >
                {sg.fade > 0 && i > 0 && <i className="st-fade" style={{ width: Math.min(w, sg.fade * pps) }} />}
                <img src={thumbs[sg.clip]} alt="" draggable={false} />
                <b>{sg.clip}</b>
                {sg.loops > 1 && <em>×{sg.loops}</em>}
                {i > 0 && <u className="st-h l" title="drag: overlap with the previous clip" onPointerDown={(e) => { const f0 = sg.fade; setSeg(i); drag(e, (dt) => (sg.fade = Math.min(Math.max(0, f0 - dt), tl.lens[i - 1], tl.lens[i]))); }} />}
                <u className="st-h r" title="drag: trim the end" onPointerDown={(e) => { const o0 = sg.out > 0 ? sg.out : (k2?.dur ?? 1), r = Math.max(0.1, sg.rate), l0 = (o0 - sg.in) / r; setSeg(i); drag(e, (dt) => (sg.out = Math.min(k2?.dur ?? 99, Math.max(sg.in + 0.1, sg.in + Math.max(0.1, l0 + dt / Math.max(1, sg.loops)) * r)))); }} />
              </div>
            );
          })}
          <i className="st-head" style={{ left: t * pps }} />
        </div>
      </div>
      {s && k ? (
        <div className="st-row st-segbar">
          <b style={{ color: CAT_COLOR[MANIFEST[s.clip] ?? 'part'] }}>{s.clip}</b>
          <select value={s.clip} onChange={(e) => edit(() => ((s.clip = e.target.value), (s.in = 0), (s.out = 0)))}>{clips.map((c) => <option key={c}>{c}</option>)}</select>
          {num('speed ×', s.rate, (n) => (s.rate = Math.max(0.1, n)), 0.05, 0.1)}
          {num('repeat', s.loops, (n) => (s.loops = Math.max(1, Math.round(n))), 1, 1)}
          {num('from s', s.in, (n) => (s.in = Math.min(n, k.dur - 0.1)))}
          {num('to s', s.out || k.dur, (n) => (s.out = n >= k.dur - 0.01 ? 0 : Math.max(s.in + 0.1, n)))}
          {seg > 0 && num('blend s', s.fade, (n) => (s.fade = n))}
          <span className="st-grow" />
          <button onClick={() => edit(() => d.segs.splice(seg + 1, 0, { ...s }))} title="duplicate">⧉</button>
          <button onClick={() => { edit(() => d.segs.splice(seg, 1)); setSeg(Math.max(0, seg - 1)); }} title="remove">✕</button>
        </div>
      ) : (
        <p className="st-hint">Click a block to edit it.</p>
      )}
    </div>
  );
}

// ── mapa de estados del movimiento ────────────────────────────────────────

type MachineDef = Extract<NodeDef, { type: 'machine' }>;
const findMachine = (n: NodeDef): MachineDef | undefined => (n.type === 'machine' ? n : n.type === 'layer' ? findMachine(n.base) : undefined);
const MAXV = 6.5;

export function Locomotion() {
  const { S, edit, thumbs, clips } = useStudio();
  const m = findMachine(TREE.root);
  const [state, setState] = useState(m?.entry ?? '');
  const [, force] = useState(0);
  useEffect(() => {
    const h = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(h);
  }, []);
  if (!m) return <div className="st-dock"><p className="st-hint">The tree has no state machine.</p></div>;
  const A = S!.A, live = A.machine?.cur;
  const st = m.states.find((s) => s.name === state) ?? m.states[0];
  const resolve = (c: string) => (c.startsWith('$') ? TREE.slots[c.slice(1)] ?? c : c);

  /** Suelta un clip sobre un nodo clip: si usa un slot, cambia el slot (así las variantes siguen funcionando). */
  const assign = (n: Extract<NodeDef, { type: 'clip' }>, c: string) => edit(() => (n.clip.startsWith('$') ? ((TREE.slots[n.clip.slice(1)] = c), (A.slots[n.clip.slice(1)] = c)) : (n.clip = c)), true);
  const dropOn = (fn: (c: string) => void) => ({ onDragOver: (e: React.DragEvent) => e.preventDefault(), onDrop: (e: React.DragEvent) => { const c = e.dataTransfer.getData('text/clip'); c && fn(c); } });

  const clipCard = (n: Extract<NodeDef, { type: 'clip' }>) => (
    <div className="st-mcard" {...dropOn((c) => assign(n, c))}>
      <img src={thumbs[resolve(n.clip)]} alt="" />
      <b>{n.clip.startsWith('$') ? n.clip.slice(1) : resolve(n.clip)}</b>
      <small>{resolve(n.clip)}</small>
    </div>
  );

  const body = () => {
    const n = st.node;
    if (n.type === 'clip')
      return (
        <div className="st-row">
          {clipCard(n)}
          <label className="st-chk"><input type="checkbox" checked={n.loop !== false} onChange={(e) => edit(() => (n.loop = e.target.checked), true)} />loops</label>
          <span className="st-hint">Plays once and moves on when it ends (loops off).</span>
        </div>
      );
    if (n.type === 'blend1d') {
      const items = [...n.items].sort((a, b) => a.at - b.at);
      return (
        <div className="st-strip">
          <div
            className="st-axis"
            title="click: set the speed by hand · double-click: add a clip here"
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              S!.manual = true;
              A.p[n.param] = Math.max(0, Math.min(MAXV, ((e.clientX - r.left) / r.width) * MAXV));
              edit();
            }}
            onDoubleClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              edit(() => n.items.push({ at: +(((e.clientX - r.left) / r.width) * MAXV).toFixed(2), node: { type: 'clip', clip: '$walk' } }), true);
            }}
          >
            {[0, 1, 2, 3, 4, 5, 6].map((v) => <span key={v} className="st-tick" style={{ left: `${(v / MAXV) * 100}%` }}>{v}</span>)}
            <i className="st-needle" style={{ left: `${(Math.min(A.p[n.param] ?? 0, MAXV) / MAXV) * 100}%` }} />
            {items.map((it, i) => (
              <div
                key={i}
                className="st-mark"
                style={{ left: `${(it.at / MAXV) * 100}%` }}
                {...dropOn((c) => it.node.type === 'clip' && assign(it.node, c))}
              >
                <u
                  className="st-pin"
                  title="drag to change the speed this clip is for"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const w = (e.currentTarget.closest('.st-axis') as HTMLElement).getBoundingClientRect().width, a0 = it.at, x0 = e.clientX;
                    const mv = (ev: PointerEvent) => { it.at = +Math.max(0, Math.min(MAXV, a0 + ((ev.clientX - x0) / w) * MAXV)).toFixed(2); edit(); };
                    const up = () => (removeEventListener('pointermove', mv), removeEventListener('pointerup', up), edit(undefined, true));
                    addEventListener('pointermove', mv);
                    addEventListener('pointerup', up);
                  }}
                />
                {it.node.type === 'clip' && clipCard(it.node)}
                <small>{it.at} m/s</small>
                {n.items.length > 1 && <button className="st-x" onClick={() => edit(() => n.items.splice(n.items.indexOf(it), 1), true)}>✕</button>}
              </div>
            ))}
          </div>
          <p className="st-hint">
            Each clip sits at the speed it looks right at. The tree blends between neighbours and speeds the clip up or down to match the real speed (no foot sliding). Click the line to try a speed; drag the pins to move clips; drop a library clip on a card to replace it.
          </p>
        </div>
      );
    }
    return <p className="st-hint">This state is a {n.type}: edit it in the JSON-like editor of the old tool (git history) or add support here.</p>;
  };

  const conds = (t: MachineDef['transitions'][number]) => (
    <>
      {t.when.map((c, i) => (
        <span key={i} className="st-cond">
          {'end' in c ? (
            <em>when the clip ends</em>
          ) : (
            <>
              <select value={c.p} onChange={(e) => edit(() => (c.p = e.target.value), true)}>{Object.keys(TREE.params).map((p) => <option key={p}>{p}</option>)}</select>
              <select value={c.op} onChange={(e) => edit(() => (c.op = e.target.value as Cond & { op: never }['op']), true)}>{['>', '<', '>=', '<=', '==', '!='].map((o) => <option key={o}>{o}</option>)}</select>
              <input type="number" step={0.1} value={c.v} onChange={(e) => edit(() => (c.v = +e.target.value), true)} />
            </>
          )}
          <button className="st-x" onClick={() => edit(() => t.when.splice(i, 1), true)}>✕</button>
        </span>
      ))}
      <button onClick={() => edit(() => t.when.push({ p: 'speed', op: '>', v: 0 }), true)}>+ if</button>
      <button onClick={() => edit(() => t.when.push({ end: true }), true)}>+ ends</button>
    </>
  );

  return (
    <div className="st-dock">
      <div className="st-states">
        {m.states.map((s) => (
          <button key={s.name} className="st-state" data-on={st.name === s.name || undefined} data-live={live === s.name || undefined} onClick={() => setState(s.name)}>
            {s.name}
            {live === s.name && <i>●</i>}
          </button>
        ))}
        <span className="st-hint">states of the movement tree — green dot = where the character is now</span>
      </div>
      {body()}
      <h4>from “{st.name}” the character goes to…</h4>
      {m.transitions.filter((t) => t.from === st.name || t.from === '*').map((t, i) => (
        <div className="st-row st-trans" key={i}>
          <span>{t.from === '*' ? 'any →' : '→'}</span>
          <select value={t.to} onChange={(e) => edit(() => (t.to = e.target.value), true)}>{m.states.map((s) => <option key={s.name}>{s.name}</option>)}</select>
          {conds(t)}
          <label className="st-num">blend s<input type="number" step={0.05} min={0} value={t.fade ?? 0.2} onChange={(e) => edit(() => (t.fade = +e.target.value), true)} /></label>
          <button className="st-x" onClick={() => edit(() => m.transitions.splice(m.transitions.indexOf(t), 1), true)}>✕</button>
        </div>
      ))}
      <button onClick={() => edit(() => m.transitions.push({ from: st.name, to: m.entry, when: [], fade: 0.2 }), true)}>+ transition</button>
      <span className="st-hint"> clips available: {clips.length}</span>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import type { RoomView } from '@backrooms/shared';
import type { Sock } from '../net';
import { avatarUrl } from '../account';
import { Avatar } from './Account';
import './lobby.css';

/*
 * La sala de espera, encima de la sala 3D: a la derecha las plazas, cada una con su foto, su nombre y si está lista; las libres
 * salen vacías. «R» (o pulsar el estado propio, con el cursor suelto) marca listo. Es informativo: empieza el
 * propietario, en la puerta.
 */

export default function WaitPanel({ room, me, sock }: { room: RoomView; me: string; sock?: Sock }) {
  const mine = room.players.find((p) => p.id === me);
  const ready = room.players.filter((p) => p.ready).length;
  const toggle = () => mine && sock?.emit('ready', !mine.ready);
  const tog = useRef(toggle);
  tog.current = toggle;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'KeyR' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = (e.target as HTMLElement | null)?.tagName;
      if (t !== 'INPUT' && t !== 'TEXTAREA') tog.current();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  const rows = [...room.players, ...Array.from({ length: Math.max(0, room.max - room.players.length) }, () => null)];
  return (
    <>
      <p className="br-bank" aria-label="Team bank and round">
        BANK ${room.bank} <span className="br-lobby__dim">· ROUND {room.round}</span>
      </p>
      <ul className="br-roster" aria-label="Players">
        <li className="br-roster__head" aria-hidden="true">
          CREW · {ready}/{room.players.length} READY
        </li>
        {rows.map((p, i) =>
          p ? (
            <li key={p.id} data-me={p.id === me || undefined} data-ready={p.ready || undefined}>
              <Avatar src={avatarUrl(p.avatar)} name={p.name} />
              <span className="br-roster__n">{p.name}</span>
              <span className="br-roster__role">{p.id === room.ownerId ? 'OWNER' : p.id === me ? 'YOU' : ''}</span>
              {p.id === me ? (
                <button type="button" className="br-opt br-roster__st" onClick={toggle} aria-pressed={p.ready}>
                  {p.ready ? '▮ READY' : '▯ NOT READY'} [R]
                </button>
              ) : (
                <span className="br-roster__st">{p.ready ? '▮ READY' : '▯ NOT READY'}</span>
              )}
            </li>
          ) : (
            <li key={`e${i}`} data-empty="">
              <span className="br-avatar" aria-hidden="true">·</span>
              <span className="br-roster__n">WAITING FOR PLAYER</span>
            </li>
          ),
        )}
      </ul>
    </>
  );
}

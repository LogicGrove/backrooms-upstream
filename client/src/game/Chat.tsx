import { useEffect, useRef, useState } from 'react';
import { CHAT_MAX } from '@backrooms/shared';
import type { Sock } from '../net';

/** El chat de la sala: lo que llega (el servidor ya limita ritmo y largo) y cuándo llegó. React escapa el texto. */
export interface Msg {
  n: number;
  id: string;
  name: string;
  text: string;
  at: number;
}

export function useChat(sock?: Sock) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  useEffect(() => {
    if (!sock) return setMsgs([]);
    let n = 0;
    const on = (m: { id: string; name: string; text: string }) => setMsgs((a) => [...a.slice(-29), { ...m, n: n++, at: Date.now() }]);
    sock.on('chat', on);
    return () => void sock.off('chat', on);
  }, [sock]);
  return msgs;
}

/** Los últimos mensajes. `fade`: en partida, solo los de los últimos segundos y se desvanecen. */
export function ChatLog({ msgs, max = 6, fade = false, className = '' }: { msgs: Msg[]; max?: number; fade?: boolean; className?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!fade) return;
    const id = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(id);
  }, [fade]);
  const shown = msgs.slice(-max).filter((m) => !fade || now - m.at < 9000);
  if (!shown.length) return null;
  return (
    <ul className={`br-chat ${className}`} aria-live="polite">
      {shown.map((m) => (
        <li key={m.n} style={fade ? { opacity: Math.min(1, (9000 - (now - m.at)) / 2500) } : undefined}>
          <b>{m.name}</b> {m.text}
        </li>
      ))}
    </ul>
  );
}

/** La línea para escribir: Intro envía, Escape cierra; el teclado es suyo (el juego no lo ve). */
export function ChatInput({ sock, onClose, keep = false }: { sock: Sock; onClose?: () => void; keep?: boolean }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => void ref.current?.focus(), []);
  return (
    <input
      ref={ref}
      className="br-chat__in"
      value={text}
      maxLength={CHAT_MAX}
      placeholder="TYPE…"
      aria-label="Chat"
      autoComplete="off"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => !keep && onClose?.()}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== 'Escape') return e.stopPropagation(); // WASD y demás no mueven al jugador
        e.stopPropagation();
        if (e.key === 'Enter' && text.trim()) sock.emit('chat', text.trim());
        setText('');
        if (e.key === 'Escape' || !keep) onClose?.();
      }}
    />
  );
}

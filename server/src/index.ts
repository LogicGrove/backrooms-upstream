import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { Server } from 'socket.io';
import {
  SERVER_PORT, MAX_PLAYERS, DEFAULT_LOOK, cosmetic, lookAllowed, NAME_MAX, CHAT_MAX, CHAT_GAP, ROOM_NAME_MAX, DIFFICULTY, START_DELAY, WAIT_HALF, WAIT_SPAWNS, EMOTES, EMOTE_GAP,
  type ClientToServer, type ServerToClient, type Status, type PlayerState, type Room, type RoomView, type RoomInfo, type Look,
} from '@backrooms/shared';
import { Match, type Player } from './match';
import { allowedOrigins, handleApi, originOk, userFromCookie } from './auth';
import { achievementsOf, loadoutOf } from './db';
import { award, count, hooks } from './progress';

/*
 * El servidor de las salas: crea y lista salas, reparte los estados de los jugadores (15 Hz) y lleva la
 * partida (objetos, entidades, muertes, fin) en `Match`. El cliente solo pinta lo que éste le dice.
 */
/**
 * El mantenimiento: MAINTENANCE=1 (y MAINTENANCE_MSG, MAINTENANCE_AT) o, sin reiniciar, un maintenance.json
 * junto al servidor: {"on": true, "message": "...", "at": "2026-11-06T20:00:00Z"}. `at` en el futuro = solo aviso.
 */
function readStatus(): Status {
  let on = process.env.MAINTENANCE === '1', message = process.env.MAINTENANCE_MSG ?? '', at = process.env.MAINTENANCE_AT;
  try {
    const f = JSON.parse(readFileSync(process.env.MAINTENANCE_FILE ?? 'maintenance.json', 'utf8'));
    (on = !!f.on), (message = String(f.message ?? message)), (at = f.at ? String(f.at) : at);
  } catch {}
  const soon = !!at && Date.parse(at) > Date.now();
  return { maintenance: on && !soon, message: message.slice(0, 160), ...(soon ? { at } : {}) };
}
let status = readStatus();

const http = createServer((req, res) => {
  if (handleApi(req, res)) return;
  if (req.url?.startsWith('/status')) {
    status = readStatus();
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    return void res.end(JSON.stringify(status));
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('backrooms ok\n');
});
// with CLIENT_ORIGIN set (one or several, comma-separated), only those origins (production); without it, any origin (dev, LAN, port forwarding).
// `credentials`: the session cookie travels with the socket (see auth.ts)
// latido corto (por defecto 25 s + 20 s): si un túnel no pasa el cierre de la pestaña, el jugador fantasma desaparece en ≤ 13 s, no en 45
const io = new Server<ClientToServer, ServerToClient>(http, { pingInterval: 5000, pingTimeout: 8000, cors: { origin: process.env.CLIENT_ORIGIN ? allowedOrigins : true, credentials: true } });

interface RoomState extends Room {
  players: Map<string, Player>;
  match?: Match;
  startedAt?: number;
  /** Jugadores al empezar la partida y cuántos han caído en ella (para los logros de equipo). */
  size0: number;
  deaths: number;
}
const rooms = new Map<string, RoomState>();
const where = new Map<string, string>(); // socket → código de su sala

let tapeNo = 30;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin la I ni la O (se confunden con 1 y 0)
function newCode() {
  for (;;) {
    const c = Array.from({ length: 5 }, () => LETTERS[(Math.random() * LETTERS.length) | 0]).join('');
    if (!rooms.has(c)) return c;
  }
}
const cleanName = (n: unknown) => String(n ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX) || 'anon';
const sockets = new Map<number, Set<string>>(); // cuenta → sus sockets conectados
const guestColor = new Map<string, string>(); // socket de invitado → su color (uno gratis)
const view = (r: RoomState): RoomView => ({
  code: r.code, tape: r.tape, name: r.name, public: r.public, ownerId: r.ownerId, max: r.max, difficulty: r.difficulty, fixedSeed: r.fixedSeed, phase: r.phase, seed: r.seed,
  players: [...r.players.values()].map((p) => ({ id: p.id, name: p.name, dead: p.dead, look: p.look })),
});
const push = (r: RoomState) => io.to(r.code).emit('room', view(r));
const START: PlayerState = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, anim: 'Neutral Idle', light: true, held: 'none' };
/** Dónde está de pie en la sala de espera quien ocupa el hueco `i` (sin linterna). */
const waitSpot = (i: number): PlayerState => ({ ...START, ...WAIT_SPAWNS[i % WAIT_SPAWNS.length], light: false });
/** Lo que se acepta en la sala de espera: dentro de la caja (menos lo que ocupa el cuerpo). */
const WAIT_PAD = 0.25;
const emoteAt = new Map<string, number>(); // cuándo cambió cada jugador de emote por última vez
const inWait = (r: RoomState) => r.phase === 'lobby' || r.phase === 'starting';

/** El aspecto de quien juega: el de su cuenta (si aún le vale) o, de invitado, su color gratis. Nunca lo manda el cliente tal cual. */
function lookFor(uid: number, id: string): Look {
  if (uid) {
    const l = loadoutOf(uid);
    return lookAllowed(l, new Set(Object.keys(achievementsOf(uid)))) ? l : DEFAULT_LOOK;
  }
  return { ...DEFAULT_LOOK, color: guestColor.get(id) ?? 'stock' };
}
function addPlayer(r: RoomState, id: string, name: string, uid: number) {
  r.players.set(id, { id, name, st: waitSpot(r.players.size), dead: false, lastChat: 0, lastHit: 0, seen: false, uid, look: lookFor(uid, id) });
  where.set(id, r.code);
}

function leave(id: string) {
  const code = where.get(id);
  where.delete(id);
  emoteAt.delete(id);
  const r = code ? rooms.get(code) : undefined;
  if (!r) return;
  io.sockets.sockets.get(id)?.leave(code!);
  r.players.delete(id);
  if (!r.players.size) return void rooms.delete(code!);
  if (r.ownerId === id) r.ownerId = r.players.keys().next().value!; // el siguiente pasa a ser el propietario
  push(r);
  if (r.phase === 'playing') checkOver(r);
}

/** Si ya no queda nadie vivo, se acaba; la derrota se retrasa para que el último termine de caer. */
function checkOver(r: RoomState) {
  if (r.phase !== 'playing' || [...r.players.values()].some((p) => !p.dead)) return;
  finish(r, false);
}
function finish(r: RoomState, won: boolean) {
  if (r.phase !== 'playing') return;
  r.phase = 'over';
  const done = () => {
    if (rooms.get(r.code) !== r) return;
    io.to(r.code).emit('over', { won });
    // la sala vuelve al lobby: el propietario puede empezar otra
    r.phase = 'lobby';
    r.seed = 0;
    r.match = undefined;
    r.startedAt = undefined;
    // de vuelta a la sala de espera: cada uno en su sitio
    [...r.players.values()].forEach((p, i) => ((p.dead = false), (p.seen = false), (p.st = waitSpot(i))));
    push(r);
  };
  if (won) done();
  else setTimeout(done, 5000);
}

/** Quienes siguen vivos al salir por el ascensor: contadores y logros de su cuenta. Los invitados no acumulan nada. */
function creditEscape(r: RoomState) {
  for (const p of r.players.values()) {
    if (!p.uid || p.dead) continue;
    count(p.uid, 'escapes');
    if (r.size0 >= 3) award(p.uid, 'team_player');
    if (!r.deaths) award(p.uid, 'survivor');
  }
}

const roomOf = (id: string) => rooms.get(where.get(id) ?? '');

io.on('connection', (sock) => {
  sock.emit('status', status);
  // la cuenta, por la cookie de sesión (sin Origin: es una petición del propio origen; con él, tiene que ser uno permitido). Si no, invitado
  const hs = sock.handshake.headers;
  const acct = !hs.origin || originOk(hs.origin, hs.host) ? userFromCookie(hs.cookie) : undefined;
  const uid = acct?.user.id ?? 0;
  if (uid) (sockets.get(uid) ?? sockets.set(uid, new Set()).get(uid)!).add(sock.id);
  const join = (r: RoomState, name: string, cb: (x: { id: string; room: RoomView }) => void) => {
    addPlayer(r, sock.id, acct ? acct.user.username : name, uid);
    sock.join(r.code);
    cb({ id: sock.id, room: view(r) });
    push(r);
  };

  sock.on('create', (a, cb) => {
    if (typeof cb !== 'function') return;
    if (status.maintenance) return cb({ error: 'Maintenance' });
    leave(sock.id);
    const r: RoomState = { code: newCode(), tape: ++tapeNo, name: `SALA ${tapeNo}`, public: !!a?.public, ownerId: sock.id, max: MAX_PLAYERS, difficulty: 'normal', fixedSeed: 0, phase: 'lobby', seed: 0, players: new Map(), size0: 0, deaths: 0 };
    rooms.set(r.code, r);
    join(r, cleanName(a?.name), cb);
  });

  sock.on('join', (a, cb) => {
    if (typeof cb !== 'function') return;
    if (status.maintenance) return cb({ error: 'Maintenance' });
    const r = rooms.get(String(a?.code ?? '').trim().toUpperCase());
    if (!r) return cb({ error: 'No such room' });
    if (where.get(sock.id) === r.code) return cb({ id: sock.id, room: view(r) });
    if (r.phase !== 'lobby') return cb({ error: 'Game in progress' });
    if (r.players.size >= r.max) return cb({ error: 'Room is full' });
    leave(sock.id);
    join(r, cleanName(a?.name), cb);
  });

  // las salas públicas, también las llenas y las que ya juegan (el cliente las enseña sin dejar entrar)
  sock.on('list', (cb) => {
    if (typeof cb !== 'function') return;
    const out: RoomInfo[] = [];
    for (const r of rooms.values())
      if (r.public)
        out.push({
          code: r.code, name: r.name, tape: r.tape, owner: r.players.get(r.ownerId)?.name ?? '', count: r.players.size, max: r.max,
          phase: r.phase, difficulty: r.difficulty, seeded: !!r.fixedSeed, age: r.startedAt ? Math.round((Date.now() - r.startedAt) / 1000) : 0,
        });
    cb(out);
  });

  sock.on('settings', (a) => {
    const r = roomOf(sock.id);
    if (!r || r.ownerId !== sock.id || r.phase !== 'lobby' || !a || typeof a !== 'object') return;
    if (typeof a.name === 'string') r.name = a.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, ROOM_NAME_MAX) || r.name;
    if (typeof a.public === 'boolean') r.public = a.public;
    if (Number.isFinite(a.max)) r.max = Math.min(MAX_PLAYERS, Math.max(2, r.players.size, Math.round(a.max!)));
    if (a.difficulty && a.difficulty in DIFFICULTY) r.difficulty = a.difficulty;
    if (Number.isFinite(a.fixedSeed)) r.fixedSeed = Math.min(2 ** 31 - 1, Math.max(0, Math.floor(a.fixedSeed!)));
    push(r);
  });

  sock.on('start', () => {
    const r = roomOf(sock.id);
    if (!r || r.ownerId !== sock.id || r.phase !== 'lobby') return;
    r.seed = r.fixedSeed || 1 + ((Math.random() * 2 ** 31) | 0);
    // la puerta se abre: START_DELAY ms en los que nadie entra ni cambia nada, y luego empieza la partida
    r.phase = 'starting';
    push(r);
    setTimeout(() => {
      if (rooms.get(r.code) !== r || r.phase !== 'starting') return;
      r.match = new Match(r.seed, r.difficulty, r.players.size);
      r.match.onHeld = (p) => p.uid && (count(p.uid, 'holds'), award(p.uid, 'held_breath'));
      r.size0 = r.players.size;
      r.deaths = 0;
      for (const p of r.players.values()) (p.shot = new Set()), p.uid && count(p.uid, 'games');
      r.phase = 'playing';
      r.startedAt = Date.now();
      for (const p of r.players.values()) (p.dead = false), (p.seen = false), (p.st = { ...START, x: r.match.start.x, z: r.match.start.z });
      push(r);
    }, START_DELAY);
  });

  sock.on('state', (s) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r || !p || !s || (r.phase !== 'playing' && !inWait(r)) || (r.phase === 'playing' && p.dead)) return;
    const n = (v: unknown) => (Number.isFinite(v) ? (v as number) : 0);
    const st: PlayerState = {
      x: n(s.x), y: n(s.y), z: n(s.z), yaw: n(s.yaw), pitch: n(s.pitch),
      anim: String(s.anim ?? '').slice(0, 40), light: !!s.light, held: s.held === 'camera' || s.held === 'gun' ? s.held : 'none',
      hiding: !!s.hiding, holding: !!s.holding, // el escondite lo valida Match (ver hiding)
      t: n(s.t), // el reloj del emisor: se reenvía tal cual para que los demás reconstruyan su ritmo
    };
    if (inWait(r)) {
      // en la sala de espera no hay a dónde ir: se recorta a la caja, sin saltos ni linterna
      const c = (v: number, h: number) => Math.min(h - WAIT_PAD, Math.max(-h + WAIT_PAD, v));
      // el emote: solo los permitidos, y un cambio cada EMOTE_GAP ms como mucho
      const e = Number.isInteger(s.emote) && s.emote! >= 0 && s.emote! < EMOTES.length ? s.emote! : 0, now = Date.now();
      if (e !== (p.st.emote ?? 0) && now - (emoteAt.get(sock.id) ?? 0) >= EMOTE_GAP) (st.emote = e), emoteAt.set(sock.id, now);
      else st.emote = p.st.emote ?? 0;
      (st.x = c(st.x, WAIT_HALF.x)), (st.z = c(st.z, WAIT_HALF.z)), (st.y = Math.min(0.5, Math.max(0, st.y))), (st.light = false), (st.held = 'none');
      p.st = st;
      return;
    }
    if (st.hiding && !r.match?.hideOk(p, st)) st.hiding = st.holding = false; // solo en un nicho libre
    p.st = st;
    p.seen = true;
  });

  sock.on('ping', (cb) => typeof cb === 'function' && cb());

  sock.on('pickup', (id, cb) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    const ok = !!r?.match && !!p && r.phase === 'playing' && r.match.pickup(p, String(id));
    if (ok && p!.uid && String(id)[0] === 't') count(p!.uid, 'tapes'); // las cintas (ids t...)
    if (typeof cb === 'function') cb(ok);
  });

  sock.on('hit', (id) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r?.match || !p || r.phase !== 'playing') return;
    // como mucho un tiro cada 0,2 s
    if (Date.now() - p.lastHit < 200) return;
    p.lastHit = Date.now();
    if (r.match.hit(p, Number(id)) && p.uid) (award(p.uid, 'idiot'), count(p.uid, 'kills'));
  });

  sock.on('photo', () => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (r?.match && p && r.phase === 'playing' && p.uid && r.match.photo(p) !== undefined) count(p.uid, 'photos');
  });

  // invitados: su color, uno de los gratis (con cuenta el aspecto sale de la cuenta, no del cliente)
  sock.on('look', (c) => {
    if (uid || typeof c !== 'string') return;
    const def = cosmetic('color', c);
    if (!def || def.need) return;
    guestColor.set(sock.id, c);
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (r && p) (p.look = lookFor(0, sock.id), push(r));
  });

  sock.on('fell', () => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r?.match || !p || r.phase !== 'playing' || !r.match.fell(p)) return;
    p.dead = true;
    r.deaths++;
    if (p.uid) count(p.uid, 'falls');
    io.to(r.code).emit('dead', p.id);
    push(r);
    checkOver(r);
  });

  sock.on('exit', () => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (r?.match && p && r.phase === 'playing' && r.match.canExit(p)) (creditEscape(r), finish(r, true));
  });

  sock.on('chat', (text) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r || !p || typeof text !== 'string') return;
    const t = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, CHAT_MAX);
    const now = Date.now();
    if (!t || now - p.lastChat < CHAT_GAP) return;
    p.lastChat = now;
    io.to(r.code).emit('chat', { id: p.id, name: p.name, text: t });
  });

  sock.on('leave', () => leave(sock.id));
  sock.on('disconnect', () => {
    leave(sock.id);
    guestColor.delete(sock.id);
    if (uid) {
      const s = sockets.get(uid);
      s?.delete(sock.id);
      if (!s?.size) sockets.delete(uid);
    }
  });
});

// los logros nuevos llegan al jugador por su socket; un cambio de armario refresca su aspecto en la sala
hooks.notify = (uid, key) => sockets.get(uid)?.forEach((id) => io.to(id).emit('achievement', key));
hooks.loadout = (uid) =>
  sockets.get(uid)?.forEach((id) => {
    const r = roomOf(id), p = r?.players.get(id);
    if (r && p) (p.look = lookFor(uid, id), push(r));
  });

// el estado de mantenimiento: si cambia, se avisa a todos (también a los que están jugando)
setInterval(() => {
  const next = readStatus();
  if (JSON.stringify(next) !== JSON.stringify(status)) (status = next), io.emit('status', next);
}, 10_000);

// la IA y las muertes, 20 veces por segundo
const DT = 1 / 20;
setInterval(() => {
  for (const r of rooms.values()) {
    if (r.phase !== 'playing' || !r.match) continue;
    r.match.tick(DT, [...r.players.values()], (p) => {
      r.deaths++;
      io.to(r.code).emit('dead', p.id);
      push(r);
    });
    checkOver(r);
  }
}, DT * 1000);

// el estado de cada jugador a su sala, 15 veces por segundo; el del mundo, 10
setInterval(() => {
  for (const r of rooms.values()) {
    if (r.phase !== 'playing' && !inWait(r)) continue;
    // volatile: si el socket de alguien (un túnel lento) no ha terminado de vaciar lo anterior, este se descarta en vez de
    // encolarse: llega siempre lo último y no una ráfaga de estados viejos
    io.to(r.code).volatile.emit('players', Object.fromEntries([...r.players].map(([id, p]) => [id, { ...p.st, name: p.name, dead: p.dead }])));
  }
}, 1000 / 15);
setInterval(() => {
  for (const r of rooms.values()) if (r.phase === 'playing' && r.match) io.to(r.code).volatile.emit('world', { ...r.match.snapshot(), t: Date.now() });
}, 100);

http.listen(Number(process.env.PORT) || SERVER_PORT, () => console.log(`backrooms server en :${process.env.PORT || SERVER_PORT}`));

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { io } from 'socket.io-client';
import { CELL, DEFAULT_LOOK, START_INV, centerOf, itemSpots, solidAt, type EntitySim, type Maze } from '@backrooms/shared';
import { Match, type Player } from '../server/src/match';

function player(match: Match): Player {
  return {
    id: 'player', name: 'PLAYER', st: { ...match.start, y: 0, yaw: 0, pitch: 0, anim: 'Neutral Idle', light: true, held: 'none' },
    dead: false, lastChat: 0, lastHit: 0, seen: true, uid: 0, look: DEFAULT_LOOK,
    hp: 100, water: 0, totem: 0, inv: { ...START_INV }, cap: { ...START_INV },
  };
}

function wallPair(maze: Maze) {
  for (let y = 0; y < maze.h; y++) {
    for (let x = 0; x < maze.w - 2; x++) {
      const a = centerOf({ x, y }), wall = centerOf({ x: x + 1, y }), b = centerOf({ x: x + 2, y });
      if (!solidAt(maze, a.x, a.z) && solidAt(maze, wall.x, wall.z) && !solidAt(maze, b.x, b.z)) return { a, b };
    }
  }
  throw new Error('The test map needs two floor cells separated by a wall');
}

test('a player killed by several entities in one tick dies once', () => {
  const match = new Match(1), p = player(match);
  const internals = match as unknown as { ents: { id: number; sim: EntitySim }[] };
  internals.ents = [1, 2, 3].map((id) => ({ id, sim: { update: () => p.id } as unknown as EntitySim }));
  let deaths = 0;
  match.tick(1 / 20, [p], () => deaths++);
  assert.equal(p.dead, true);
  assert.equal(deaths, 1);
});

test('entity hits require an owned rifle and an active player', () => {
  const match = new Match(1), p = player(match);
  const internals = match as unknown as { ents: { id: number; sim: EntitySim }[] };
  let hits = 0;
  internals.ents = [{ id: 1, sim: { x: p.st.x, z: p.st.z, hit: () => { hits++; return false; } } as unknown as EntitySim }];
  p.st.held = 'gun';
  match.hit(p, 1);
  assert.equal(hits, 0);
  p.cap.gun = true;
  p.boarded = true;
  match.hit(p, 1);
  assert.equal(hits, 0);
  p.boarded = false;
  match.hit(p, 1);
  assert.equal(hits, 1);
});

test('photos require an owned camera', () => {
  const match = new Match(1), p = player(match);
  const internals = match as unknown as { ents: { id: number; sim: EntitySim }[] };
  internals.ents = [{ id: 1, sim: { x: p.st.x, z: p.st.z, alive: true } as unknown as EntitySim }];
  p.st.held = 'camera';
  assert.equal(match.photo(p), undefined);
  p.cap.camera = true;
  assert.equal(match.photo(p), 1);
});

test('entity shots stop at level0 walls', () => {
  const match = new Match(1), p = player(match), pair = wallPair(match.maze);
  p.st = { ...p.st, ...pair.a, held: 'gun' };
  p.cap.gun = true;
  let hits = 0;
  const sim = { ...pair.b, hit: () => { hits++; return false; } } as unknown as EntitySim;
  (match as unknown as { ents: { id: number; sim: EntitySim }[] }).ents = [{ id: 1, sim }];
  match.hit(p, 1);
  assert.equal(hits, 0);
  sim.x = pair.a.x;
  sim.z = pair.a.z;
  match.hit(p, 1);
  assert.equal(hits, 1);
});

test('socket rooms validate difficulty, rifle ownership and pickup retries', { timeout: 25_000 }, async (t) => {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    env: { ...process.env, PORT: String(port), DB_PATH: ':memory:', MAINTENANCE: '0', MAINTENANCE_FILE: '__test_missing_maintenance__.json' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  let errors = '';
  child.stderr.on('data', (data) => { errors += data; });
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(() => { throw new Error(errors); }),
  ]);
  const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
  t.after(() => socket.close());
  await once(socket, 'connect');
  const joined = await socket.timeout(2000).emitWithAck('create', { name: 'PLAYER', difficulty: '__proto__' });
  assert.equal(joined.room.difficulty, 'normal');
  await socket.timeout(2000).emitWithAck('ping');
  const room = once(socket, 'room');
  socket.emit('settings', { difficulty: 'constructor' });
  assert.equal((await room)[0].difficulty, 'normal');
  const changed = once(socket, 'room');
  socket.emit('settings', { difficulty: 'hard', fixedSeed: 7 });
  assert.equal((await changed)[0].difficulty, 'hard');
  const teammate = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
  t.after(() => teammate.close());
  await once(teammate, 'connect');
  const friend = await teammate.timeout(2000).emitWithAck('join', { code: joined.room.code, name: 'FRIEND' });
  let inventory = { ...START_INV };
  socket.on('inv', (inv) => { inventory = inv; });
  assert.equal(await socket.timeout(2000).emitWithAck('drop', 'flashlight'), true);
  const lobbyDrop = (await once(socket, 'ldrops'))[0].find((d: { by: string }) => d.by === socket.id);
  assert.ok(lobbyDrop);
  assert.equal(await socket.timeout(2000).emitWithAck('pickup', lobbyDrop.id), true);
  assert.equal(inventory.spares, 1);
  assert.equal(await socket.timeout(2000).emitWithAck('pickup', lobbyDrop.id), true);
  assert.equal(inventory.spares, 1);
  assert.equal(await teammate.timeout(2000).emitWithAck('pickup', lobbyDrop.id), false);
  let levelSeed = 0;
  const playing = new Promise<void>((resolve) => {
    let voted = false;
    const onRoom = (r: { phase: string; seed: number; vote: unknown; offers: { id: string }[] }) => {
      if (!voted && r.phase === 'starting' && r.vote && r.offers.length) {
        voted = true;
        socket.emit('vote', r.offers[0].id);
        teammate.emit('vote', r.offers[0].id);
        socket.emit('ready', true);
        teammate.emit('ready', true);
      }
      if (r.phase === 'playing') {
        levelSeed = r.seed;
        socket.off('room', onRoom);
        resolve();
      }
    };
    socket.on('room', onRoom);
  });
  socket.emit('start');
  await playing;
  assert.equal(await socket.timeout(2000).emitWithAck('pickup', lobbyDrop.id), false);
  assert.equal(await socket.timeout(2000).emitWithAck('drop', 'flashlight'), true);
  const drops = (await once(socket, 'world'))[0].drops;
  const levelDrop = drops.find((d: { by: string }) => d.by === socket.id);
  assert.ok(levelDrop);
  assert.equal(await socket.timeout(2000).emitWithAck('pickup', levelDrop.id), true);
  assert.equal(await socket.timeout(2000).emitWithAck('pickup', levelDrop.id), true);
  assert.equal(await teammate.timeout(2000).emitWithAck('pickup', levelDrop.id), false);
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.equal(await socket.timeout(2000).emitWithAck('drop', 'flashlight'), true);
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.equal(await socket.timeout(2000).emitWithAck('drop', 'flashlight'), false); // solo recuperó una unidad
  const initial = (await once(socket, 'players'))[0];
  socket.emit('state', { ...initial[socket.id!], held: 'gun' });
  socket.emit('shoot', friend.id);
  await socket.timeout(2000).emitWithAck('ping');
  const after = (await once(socket, 'players'))[0];
  assert.equal(after[friend.id].dead, false);
  assert.equal(after[friend.id].hp, 100);
  const maze = new Match(levelSeed, 'hard', 2).maze, pair = wallPair(maze);
  const rifle = itemSpots(maze).find((item) => item.kind === 'gun');
  assert.ok(rifle);
  // Se envían estados admitidos por el protocolo para aislar la validación del tiro de la física cliente.
  const move = (client: typeof socket, at: { x: number; z: number }) => {
    for (let i = 0; i < Math.ceil(Math.hypot(maze.w, maze.h) * CELL / 2); i++) client.emit('state', { ...initial[socket.id!], ...at, held: 'gun' });
  };
  move(socket, centerOf(rifle.cell));
  assert.equal(await socket.timeout(2000).emitWithAck('pickup', rifle.id), true);
  move(socket, pair.a);
  move(teammate, pair.b);
  await teammate.timeout(2000).emitWithAck('ping');
  await new Promise((resolve) => setTimeout(resolve, 210));
  socket.emit('shoot', friend.id);
  await socket.timeout(2000).emitWithAck('ping');
  assert.equal((await once(socket, 'players'))[0][friend.id].dead, false);
  move(teammate, pair.a);
  await teammate.timeout(2000).emitWithAck('ping');
  await new Promise((resolve) => setTimeout(resolve, 210));
  socket.emit('shoot', friend.id);
  await socket.timeout(2000).emitWithAck('ping');
  assert.equal((await once(socket, 'players'))[0][friend.id].dead, true);
  const returned = new Promise<void>((resolve) => {
    const onRoom = (r: { phase: string }) => {
      if (r.phase !== 'lobby') return;
      socket.off('room', onRoom);
      resolve();
    };
    socket.on('room', onRoom);
  });
  socket.emit('insane');
  teammate.emit('insane');
  await returned;
  assert.equal(await socket.timeout(2000).emitWithAck('pickup', levelDrop.id), false);
});

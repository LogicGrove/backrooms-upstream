import assert from 'node:assert/strict';
import test from 'node:test';
import { bfs, CELL, generateMaze, type Maze } from '../shared/src/maze';
import { Breath, EntitySim, hideStates, itemSpots, seesXZ, solidAt, tickHides, type SimTarget } from '../shared/src/sim';

function room(): Maze {
  const w = 7, h = 7, open = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) open[y * w + x] = 1;
  return {
    w, h, open, lit: open.slice(), zone: new Uint8Array(w * h),
    start: { x: 1, y: 1 }, elevator: { x: 5, y: 5 }, camera: { x: 1, y: 2 },
    pistol: null, extraGuns: [], tapes: [], flashlights: [], spawns: [], lamps: [], props: [], hides: [], rooms: [], voids: [],
  };
}

function target(x: number, z: number): SimTarget {
  return { id: 'player', x, y: 0, z, ex: x, ey: 1.65, ez: z, torch: null, exposed: true };
}

test('BFS does not leave a wall or a blocked origin', () => {
  const m = room(), origin = { x: 2, y: 2 }, key = origin.y * m.w + origin.x;
  assert.ok(bfs(m, origin, new Set([key])).every((d) => d === -1));
  m.open[key] = 0;
  assert.ok(bfs(m, origin).every((d) => d === -1));
});

test('BFS rejects an out-of-bounds origin instead of aliasing another cell', () => {
  const m = room();
  for (const from of [{ x: -1, y: 2 }, { x: m.w, y: 1 }, { x: 1.5, y: 1 }, { x: NaN, y: 1 }]) {
    assert.ok(bfs(m, from).every((d) => d === -1));
  }
});

test('line of sight detects a short crossing through a wall corner', () => {
  const m = room();
  m.open[2 * m.w + 2] = 0;
  const solid = (x: number, z: number) => solidAt(m, x, z);
  assert.equal(seesXZ(solid, 2.95, 3.1, 3.1, 2.85), false);
  assert.equal(seesXZ(solid, 3.1, 2.85, 2.95, 3.1), false);
  assert.equal(seesXZ(solid, 2.8, 2.8, 2.6, 2.6), true);
});

test('line of sight terminates for endpoints on grid boundaries', () => {
  const coordinates = [0, 0.75, 1.5, 2.25, 3];
  for (const ax of coordinates) for (const az of coordinates) for (const bx of coordinates) for (const bz of coordinates) {
    let calls = 0;
    assert.equal(seesXZ(() => {
      assert.ok(++calls < 30, `ray did not terminate from ${ax},${az} to ${bx},${bz}`);
      return false;
    }, ax, az, bx, bz), true);
  }
});

test('an entity cannot capture a player through a wall corner', () => {
  const m = room();
  m.open[2 * m.w + 2] = 0;
  const entity = new EntitySim('partygoer', m, (x, z) => solidAt(m, x, z), { x: 1, y: 2 });
  entity.x = 2.9;
  entity.z = 3.2;
  entity.state = 'chase';
  assert.equal(entity.update(0.05, [target(3.2, 2.9)]), undefined);
});

test('an entity still captures a reachable nearby player', () => {
  const m = room();
  const entity = new EntitySim('partygoer', m, (x, z) => solidAt(m, x, z), { x: 1, y: 2 });
  entity.state = 'chase';
  assert.equal(entity.update(0.05, [target(entity.x + 0.5, entity.z)]), 'player');
});

test('chasing a nearby player does not cut across the corner of a pit', () => {
  const m = room();
  m.voids.push({ x: 2, y: 2 });
  const entity = new EntitySim('partygoer', m, (x, z) => solidAt(m, x, z), { x: 1, y: 2 });
  entity.x = 2.95;
  entity.z = 3.1;
  entity.state = 'chase';
  entity.update(0.2, [target(3.1, 2.85)], true);
  const pit = (x: number, z: number) => Math.floor(x / CELL) === 2 && Math.floor(z / CELL) === 2;
  assert.equal(seesXZ(pit, 2.95, 3.1, entity.x, entity.z), true);
});

test('inspection does not walk across a pit to reach a hiding place', (t) => {
  t.mock.method(Math, 'random', () => 0.1);
  const m = room();
  m.hides.push({ cell: { x: 4, y: 3 }, side: 1 });
  m.open[3 * m.w + 4] = 0;
  m.voids.push({ x: 3, y: 2 });
  const hides = hideStates(m);
  hides[0].occ = { id: 'hidden', holding: true, noise: 1 };
  const entity = new EntitySim('partygoer', m, (x, z) => solidAt(m, x, z), { x: 3, y: 1 });
  entity.z = 2.4;
  for (let i = 0; i < 20; i++) {
    entity.update(0.1, [], false, hides);
    assert.ok(Math.floor(entity.x / CELL) !== 3 || Math.floor(entity.z / CELL) !== 2, 'entity crossed the pit during inspection');
  }
});

test('teleporting toward a hidden player uses the walkable niche mouth', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const m = room();
  m.w = 64;
  m.h = 12;
  m.open = new Uint8Array(m.w * m.h);
  for (let x = 1; x <= 15; x++) m.open[m.w + x] = 1;
  for (let y = 1; y <= 10; y++) m.open[y * m.w + 15] = 1;
  for (let x = 15; x <= 60; x++) m.open[10 * m.w + x] = 1;
  m.lit = new Uint8Array(m.open.length);
  m.zone = new Uint8Array(m.open.length);
  m.hides.push({ cell: { x: 1, y: 0 }, side: 2 });
  const hides = hideStates(m);
  hides[0].occ = { id: 'hidden', holding: true, noise: 0 };
  const entity = new EntitySim('partygoer', m, (x, z) => solidAt(m, x, z), { x: 50, y: 10 });
  for (let i = 0; i < 1500; i++) entity.update(0.05, [], false, hides);
  assert.ok(entity.x < 45 * CELL, 'entity never teleported toward the occupied niche');
  assert.equal(seesXZ((x, z) => solidAt(m, x, z), entity.x, entity.z, hides[0].fx, hides[0].fz), false);
});

test('an occupied niche prevents teleporting in sight of its mouth', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const m = room();
  m.w = 64;
  m.h = 5;
  m.open = new Uint8Array(m.w * m.h);
  for (let x = 1; x <= 60; x++) m.open[m.w + x] = m.open[3 * m.w + x] = 1;
  m.open[2 * m.w + 60] = 1;
  m.lit = new Uint8Array(m.open.length);
  m.zone = new Uint8Array(m.open.length);
  m.hides.push({ cell: { x: 1, y: 0 }, side: 2 });
  const hides = hideStates(m);
  hides[0].occ = { id: 'hidden', holding: true, noise: 0 };
  const entity = new EntitySim('partygoer', m, (x, z) => solidAt(m, x, z), { x: 40, y: 3 });
  for (let i = 0; i < 1500; i++) entity.update(0.05, [], false, hides);
  assert.equal(Math.floor(entity.z / CELL), 3, 'entity teleported onto the visible upper corridor');
});

test('invalid time steps leave entity simulation unchanged', () => {
  for (const dt of [NaN, Infinity, -Infinity, -1, 0]) {
    const m = room();
    const entity = new EntitySim('partygoer', m, (x, z) => solidAt(m, x, z), { x: 1, y: 2 });
    const before = { x: entity.x, z: entity.z, facing: entity.facing, state: entity.state };
    entity.update(dt, [target(entity.x, entity.z + 2)]);
    assert.deepEqual({ x: entity.x, z: entity.z, facing: entity.facing, state: entity.state }, before);
  }
});

test('invalid time steps do not corrupt breath or hide cooldowns', () => {
  const m = room();
  m.hides.push({ cell: { x: 2, y: 2 }, side: 1 });
  for (const dt of [NaN, Infinity, -Infinity, -1]) {
    const breath = new Breath(), hides = hideStates(m);
    breath.step(1, true);
    const air = breath.air;
    hides[0].cd = 5;
    breath.step(dt, true);
    tickHides(hides, dt);
    assert.equal(breath.air, air);
    assert.equal(hides[0].cd, 5);
  }
});

test('generated level resources stay reachable and deterministic', () => {
  for (const seed of [1, 2, 7, 12, 99, 5180, 2147483647]) {
    const m = generateMaze(seed, 4);
    assert.deepEqual(generateMaze(seed, 4), m);
    const blocked = new Set(m.voids.map((c) => c.y * m.w + c.x));
    const distances = bfs(m, m.start, blocked);
    for (const { cell, id } of [...itemSpots(m), { cell: m.elevator, id: 'elevator' }]) {
      assert.ok(distances[cell.y * m.w + cell.x] >= 0, `seed ${seed}, item ${id} is unreachable`);
    }
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Input } from '../client/src/game/input';
import type { Controls } from '../client/src/game/input';
import { generateMaze, START_INV } from '@backrooms/shared';
import { Items } from '../client/src/game/items';
import type { Assets } from '../client/src/game/game';
import type { Player } from '../client/src/game/player';
import type { World } from '../client/src/game/world';
import { claimPickup } from '../client/src/pickup-claim';

function pickupSocket(responses: (boolean | Error)[]) {
  const timeouts: number[] = [];
  const requests: [string, string][] = [];
  const socket = {
    timeout(ms: number) {
      timeouts.push(ms);
      return {
        async emitWithAck(event: 'pickup', id: string) {
          requests.push([event, id]);
          const response = responses.shift();
          if (response instanceof Error) throw response;
          assert.equal(typeof response, 'boolean');
          return response as boolean;
        },
      };
    },
  };
  return { socket, requests, timeouts };
}

test('pickup retries a lost ACK and acknowledges success once', async () => {
  const { socket, requests, timeouts } = pickupSocket([new Error('timeout'), true]);
  const results: boolean[] = [];
  await claimPickup(socket, 'd1', (ok) => results.push(ok), 1);
  assert.deepEqual(results, [true]);
  assert.deepEqual(requests, [['pickup', 'd1'], ['pickup', 'd1']]);
  assert.deepEqual(timeouts, [1, 1]);
});

test('pickup refusal finishes without retrying', async () => {
  const { socket, requests, timeouts } = pickupSocket([false]);
  const results: boolean[] = [];
  await claimPickup(socket, 't0', (ok) => results.push(ok));
  assert.deepEqual(results, [false]);
  assert.deepEqual(requests, [['pickup', 't0']]);
  assert.deepEqual(timeouts, [2500]);
});

test('pickup releases pending state after three failed ACK attempts', async () => {
  const { socket, requests } = pickupSocket([new Error('timeout'), new Error('timeout'), new Error('timeout')]);
  const results: boolean[] = [];
  let pending = true;
  await claimPickup(socket, 'c', (ok) => {
    pending = false;
    results.push(ok);
  });
  assert.equal(pending, false);
  assert.deepEqual(results, [false]);
  assert.deepEqual(requests, [['pickup', 'c'], ['pickup', 'c'], ['pickup', 'c']]);
});

function makeItems() {
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  const scene = new THREE.Group();
  scene.add(mesh);
  const gltf = Object.fromEntries(['vhs', 'flashlight', 'water', 'totem', 'radar', 'camcorder', 'gun', 'duct'].map((key) => [key, { scene }]));
  const world = {
    maze: generateMaze(123, 1),
    root: new THREE.Group(),
    elevator: new THREE.Group(),
    cellAt: (x: number, z: number) => ({ x: Math.floor(x / 1.5), y: Math.floor(z / 1.5) }),
  } as World;
  world.elevator.position.set(1000, 0, 1000);
  const player = { inventory: { ...START_INV } } as Player;
  const camera = new THREE.PerspectiveCamera();
  const items = new Items(world, { gltf } as Assets, player, camera);
  return { items, geometry, material, world, player, camera };
}

test('expired drops release their own resources and preserve shared assets', () => {
  const { items, geometry, material } = makeItems();
  let sharedDisposed = 0;
  geometry.addEventListener('dispose', () => sharedDisposed++);
  material.addEventListener('dispose', () => sharedDisposed++);
  const originalCount = items.root.children.length;
  items.syncDrops([{ id: 'd1', kind: 'ammo', x: 1, z: 1 }]);
  const drop = items.root.children[originalCount];
  let dropDisposed = 0;
  drop.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.addEventListener('dispose', () => dropDisposed++);
    obj.material.addEventListener('dispose', () => dropDisposed++);
  });
  items.syncDrops([]);
  assert.equal(drop.parent, null);
  assert.equal(dropDisposed, 2);
  assert.equal(sharedDisposed, 0);
  items.dispose();
  assert.equal(sharedDisposed, 0);
  geometry.dispose();
  material.dispose();
});

test('disposing items releases cloned materials once and detaches the root', () => {
  const { items, geometry, material, world } = makeItems();
  let materialCount = 0;
  let disposedCount = 0;
  items.root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    materialCount++;
    obj.material.addEventListener('dispose', () => disposedCount++);
  });
  assert.ok(materialCount > 0);
  assert.equal(items.root.parent, world.root);
  items.dispose();
  items.dispose();
  assert.equal(disposedCount, materialCount);
  assert.equal(items.root.parent, null);
  geometry.dispose();
  material.dispose();
});

test('empty and unchanged world snapshots do not allocate ammo meshes', () => {
  const { items, geometry, material } = makeItems();
  const emptyBefore = new THREE.Object3D().id;
  for (let i = 0; i < 100; i++) items.syncDrops([]);
  assert.equal(new THREE.Object3D().id, emptyBefore + 1);
  const drops = [{ id: 'd1', kind: 'ammo' as const, x: 1, z: 1 }];
  items.syncDrops(drops);
  const unchangedBefore = new THREE.Object3D().id;
  for (let i = 0; i < 100; i++) items.syncDrops(drops);
  assert.equal(new THREE.Object3D().id, unchangedBefore + 1);
  items.dispose();
  geometry.dispose();
  material.dispose();
});

test('a pickup acknowledgement arriving after teardown does not act on the previous player', () => {
  const { items, geometry, material, player, camera } = makeItems();
  let reaches = 0;
  Object.assign(player, {
    pos: new THREE.Vector3(),
    reach: () => {
      reaches++;
      return false;
    },
  });
  camera.position.copy(items.root.children[0].position).add(new THREE.Vector3(0, 0, 1));
  let acknowledge: ((ok: boolean) => void) | undefined;
  items.claim = (_id, done) => {
    acknowledge = done;
  };
  items.update(0, 0, { grab: true } as Controls);
  assert.ok(acknowledge);
  items.dispose();
  acknowledge(true);
  assert.equal(reaches, 0);
  geometry.dispose();
  material.dispose();
});

test('pausing releases held mouse fire and pending camera zoom', () => {
  const win = new EventTarget();
  const doc = new EventTarget();
  const el = {} as HTMLElement;
  Object.defineProperty(doc, 'pointerLockElement', { value: el });
  const original = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    addEventListener: win.addEventListener.bind(win),
    removeEventListener: win.removeEventListener.bind(win),
    document: doc,
  };
  for (const [key, value] of Object.entries(globals)) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  try {
    const input = new Input(el);
    input.active = true;
    const mouse = (type: string, button: number) => {
      const event = new Event(type);
      Object.defineProperty(event, 'button', { value: button });
      win.dispatchEvent(event);
    };
    mouse('mousedown', 0);
    mouse('mousedown', 2);
    const wheel = new Event('wheel');
    Object.defineProperty(wheel, 'deltaY', { value: -100 });
    win.dispatchEvent(wheel);
    input.clear();
    const controls = input.read();
    assert.equal(controls.fireHeld, false);
    assert.equal(controls.zoom, 0);
    assert.equal(controls.aim, false);
    assert.deepEqual(controls.move, new THREE.Vector2());
  } finally {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

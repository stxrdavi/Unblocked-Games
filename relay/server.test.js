import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocket } from 'ws';

const origin = 'https://www.calcolatrice.website.';

async function startRelay(t, token = '') {
  const relay = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: '0', RELAY_HOST_TOKEN: token, RELAY_ORIGINS: origin },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = once(relay, 'exit');
  const listening = once(relay.stdout, 'data');
  t.after(async () => {
    relay.kill('SIGTERM');
    await exited;
  });
  const [line] = await Promise.race([
    listening,
    exited.then(([code]) => { throw new Error(`Relay exited with code ${code}`); }),
  ]);
  return `localhost:${line.toString().match(/port (\d+)/)[1]}`;
}

function readFrames(socket) {
  const frames = [];
  const readers = [];
  socket.on('message', (payload, binary) => {
    const frame = binary ? payload : JSON.parse(payload.toString());
    const reader = readers.shift();
    if (reader) reader(frame);
    else frames.push(frame);
  });
  return () => frames.length ? Promise.resolve(frames.shift()) :
    new Promise(resolve => readers.push(resolve));
}

test('opens a world, relays binary data in both directions, and closes the room', { timeout: 8000 }, async t => {
  const address = await startRelay(t);
  assert.equal((await fetch(`http://${address}/health`)).status, 200);

  const host = new WebSocket(`ws://${address}/lan/host`, { origin });
  const nextHost = readFrames(host);
  await once(host, 'open');
  const hosted = await nextHost();
  assert.equal(hosted.type, 'hosted');
  assert.match(hosted.code, /^[A-HJ-NP-Z2-9]{8}$/);

  const guest = new WebSocket(`ws://${address}/lan/join?code=${hosted.code.toLowerCase()}`, { origin });
  const nextGuest = readFrames(guest);
  await once(guest, 'open');
  const opened = await nextHost();
  assert.equal(opened.type, 'peer-open');
  assert.match(opened.peer, /^[0-9a-f]{16}$/);

  const guestData = Buffer.from([0x00, 0x80, 0xff]);
  guest.send(guestData);
  const header = Buffer.concat([Buffer.from([1, 16]), Buffer.from(opened.peer)]);
  assert.deepEqual(await nextHost(), Buffer.concat([header, guestData]));

  const hostData = Buffer.from([0xfe, 0x00, 0x02]);
  host.send(Buffer.concat([header, hostData]));
  assert.deepEqual(await nextGuest(), hostData);

  guest.close();
  assert.deepEqual(await nextHost(), { type: 'peer-close', peer: opened.peer });
  const secondGuest = new WebSocket(`ws://${address}/lan/join?code=${hosted.code}`, { origin });
  const closed = once(secondGuest, 'close');
  await nextHost();
  host.close();
  assert.equal((await closed)[0], 1001);

  const lateGuest = new WebSocket(`ws://${address}/lan/join?code=${hosted.code}`, { origin });
  const nextLateGuest = readFrames(lateGuest);
  await once(lateGuest, 'open');
  assert.deepEqual(await nextLateGuest(), { type: 'error', message: 'World not found' });
});

test('checks the browser origin and optional host token', { timeout: 8000 }, async t => {
  const address = await startRelay(t, 'test-host-token');
  const url = `ws://${address}/lan/host`;
  for (const [target, headers] of [
    [`${url}?token=test-host-token`, { origin: 'https://example.org' }],
    [url, { origin }],
  ]) {
    const denied = new WebSocket(target, headers);
    const [error] = await once(denied, 'error');
    assert.match(error.message, /403/);
  }
  const host = new WebSocket(`${url}?token=test-host-token`, { origin });
  const next = readFrames(host);
  await once(host, 'open');
  assert.equal((await next()).type, 'hosted');
  host.close();
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { gzipSync } = require('node:zlib');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const relayScript = readFileSync(resolve(root, 'arcade/assets/minecraft-relay.js'), 'utf8');
const key = '_eaglercraftX.relay.list.v3';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');
const decode = value => JSON.parse(Buffer.from(value, 'base64').toString());
function relay(initial = {}) {
  const values = new Map(Object.entries(initial));
  const context = { window: {}, TextEncoder, TextDecoder, Uint8Array, atob, btoa, AbortSignal,
    fetch: async () => ({}), localStorage: {
      getItem: name => values.get(name) ?? null,
      setItem: (name, value) => values.set(name, value)
    }
  };
  runInNewContext(relayScript, context);
  return { values, launch: context.window.configureArcadeMinecraftRelay };
}
test('26.3 receives the WebSocket LAN transport, preserving custom relays and saved worlds', () => {
  const custom = { name: 'Amici è 👾', address: 'wss://custom.example', capability: 'auto' };
  const old = encode([custom]);
  const { values, launch } = relay({ [key]: old, worlds: 'saved-world-data' });
  launch();
  const profiles = decode(values.get(key));
  assert.equal(profiles[0].address, 'wss://arcade-lan-relay.onrender.com');
  assert.equal(profiles[0].capability, 'both');
  assert.equal(profiles[0].private, false);
  assert.deepEqual(profiles[1], custom);
  assert.equal(values.get('arcade-minecraft-relay-backup-v1'), old);
  assert.equal(values.get('worlds'), 'saved-world-data');
});
test('later launches respect changes made by the player', () => {
  const { values, launch } = relay();
  launch();
  values.set(key, encode([]));
  launch();
  assert.deepEqual(decode(values.get(key)), []);
});
test('legacy and damaged settings do not prevent automatic configuration', () => {
  for (const initial of [{ '_eaglercraftX.relay.list.v2': encode([{ address: 'wss://old.example' }]) }, { [key]: 'damaged!' }]) {
    const { values, launch } = relay(initial);
    launch();
    assert.equal(decode(values.get(key))[0].capability, 'both');
    assert.equal(values.get('arcade-minecraft-relay-backup-v1'), Object.values(initial)[0]);
  }
});
async function launchGame(game, source, {sync = false} = {}) {
  const html = readFileSync(resolve(root, 'arcade/games/launch.html'), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  let written, fetched, restored, configured = false;
  const scripts = [];
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const location = new URL('https://www.calcolatrice.website/arcade/games/launch.html?v=5&game=' + game);
  if (sync) {
    location.searchParams.set('sync', '1');
    location.searchParams.set('plain', '1');
  }
  runInNewContext(script, {
    URL, URLSearchParams, Response, DecompressionStream, location,
    arcadeSaveKeys: { '2048': ['gameState'] },
    window: {
      configureArcadeMinecraftRelay() { configured = true; },
      async prepareArcadeSaves(game, keys, origin) { restored = {game, keys, origin}; }
    },
    fetch: async url => { fetched = url; return new Response(sync ? source : gzipSync(source)); },
    document: { getElementById: () => ({}), createElement: () => ({}),
      head: { append(script) { scripts.push(script.src); script.onload(); } },
      open() {}, close() {}, write(value) { written = value; } },
    parent: { postMessage(message, origin) { finish({ message, origin }); } }
  });
  return { ...(await done), written, fetched, configured, restored, scripts };
}
test('compressed games load from the certificate-valid site and retain their asset base', async () => {
  const result = await launchGame('speed-stars', '<!doctype html><html><head></head><body>Game</body></html>');
  assert.equal(result.fetched, 'https://www.calcolatrice.website/arcade/games/speed-stars/index.html.gz');
  assert.match(result.written, /<base href="https:\/\/www.calcolatrice.website\/arcade\/games\/speed-stars\/index.html">/);
  assert.equal(result.message.type, 'arcade-game-opened');
  assert.equal(result.origin, 'https://www.calcolatrice.website');
  assert.equal(result.configured, false);
  assert.deepEqual(result.scripts, ['../assets/game-audio.js']);
});
test('Minecraft setup runs before opening the game; invalid game paths are rejected', async () => {
  const result = await launchGame('eaglecraft-26-3', '<html>Game</html>');
  assert.equal(result.configured, true);
  assert.deepEqual(result.scripts, ['../assets/game-audio.js', '../assets/minecraft-relay.js?v=1']);
  const invalid = await launchGame('../secrets', '');
  assert.equal(invalid.message.type, 'arcade-game-failed');
  assert.equal(invalid.fetched, undefined);
});
test('games with cloud sync still restore saves and load the plain HTML', async () => {
  const result = await launchGame('2048', '<html>Game</html>', {sync:true});
  assert.equal(result.fetched, 'https://www.calcolatrice.website/arcade/games/2048/index.html');
  assert.deepEqual(result.scripts, [
    '../assets/game-audio.js',
    '../assets/save-bridge.js?v=1',
    '../assets/game-saves.js?v=1'
  ]);
  assert.deepEqual(result.restored, {game:'2048', keys:['gameState'], origin:'https://www.calcolatrice.website'});
  assert.equal(result.message.type, 'arcade-game-opened');
});

// Exercise the actual routing helper used by showGame, including custom-domain
// and GitHub Pages installations. The dotted alias must not receive 26.3.
test('26.3 launches on the page origin, while other game routing is preserved', () => {
  const page = readFileSync(resolve(root, 'arcade/index.html'), 'utf8');
  const helper = page.match(/function playerOriginFor\(game\) \{[\s\S]*?\n\}/)[0];
  for (const origin of ['https://www.calcolatrice.website', 'https://stxrdavi.github.io']) {
    const context = {location: {origin}, gameOrigin: 'https://www.calcolatrice.website.'};
    runInNewContext(helper, context);
    assert.equal(context.playerOriginFor({id:'eaglecraft-26-3'}), origin);
    assert.equal(context.playerOriginFor({id:'2048'}), context.gameOrigin);
  }
});

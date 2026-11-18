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
const publicRelay = 'wss://oxer-26-2-relay-c5f9ad499e09.herokuapp.com';
const oldRelay = {
  name: 'Arcade LAN', address: 'wss://arcade-lan-relay.onrender.com',
  private: false, token: '', capability: 'both', detected: 'both'
};
test('existing Arcade settings migrate to the public relay without changing custom relays or worlds', () => {
  const custom = { name: 'Amici è 👾', address: 'wss://custom.example', capability: 'auto' };
  const old = encode([custom, oldRelay]);
  const { values, launch } = relay({
    [key]: old, 'arcade-minecraft-relay-v1': '1', worlds: 'saved-world-data'
  });
  launch();
  const profiles = decode(values.get(key));
  assert.deepEqual(profiles[0], custom);
  assert.equal(profiles[1].address, publicRelay);
  assert.equal(profiles[1].detected, 'both');
  assert.equal(profiles[2].address, 'wss://relay.deev.is');
  assert.equal(profiles[2].detected, 'singleplayer');
  assert.equal(values.get('arcade-minecraft-relay-backup-v2'), old);
  assert.equal(values.get('worlds'), 'saved-world-data');
});
test('new launches seed a public relay and respect later removals by the player', () => {
  const { values, launch } = relay();
  launch();
  assert.equal(decode(values.get(key))[0].address, publicRelay);
  values.set(key, encode([]));
  launch();
  assert.deepEqual(decode(values.get(key)), []);
});
test('existing custom, empty, and legacy lists stay intact across migration', () => {
  const custom = {...oldRelay, name:'My relay', token:'custom'};
  for (const [storageKey, profiles] of [[key, []], [key, [custom]],
    ['_eaglercraftX.relay.list.v2', [{address:'wss://old.example'}]]]) {
    const previous = encode(profiles);
    const { values, launch } = relay({[storageKey]: previous, 'arcade-minecraft-relay-v1': '1'});
    launch();
    assert.equal(values.get(storageKey), previous);
  }
});
test('a saved public relay is not duplicated and damaged storage recovers', () => {
  const existing = {name:'My public relay', address:publicRelay + '/'};
  const migrated = relay({[key]:encode([oldRelay, existing]), 'arcade-minecraft-relay-v1':'1'});
  migrated.launch();
  const profiles = decode(migrated.values.get(key));
  assert.deepEqual(profiles.filter(p => p.address.replace(/\/+$/, '') === publicRelay), [existing]);
  const damaged = relay({[key]:'damaged!'});
  damaged.launch();
  assert.equal(decode(damaged.values.get(key))[0].address, publicRelay);
});
async function launchGame(game, source, {sync = false, knownSize = true} = {}) {
  const html = readFileSync(resolve(root, 'arcade/games/launch.html'), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  let written, fetched, restored, configured = false;
  const progress = [];
  const scripts = [];
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const location = new URL('https://www.calcolatrice.website/arcade/games/launch.html?v=5&game=' + game);
  if (sync) {
    location.searchParams.set('sync', '1');
    location.searchParams.set('plain', '1');
  }
  runInNewContext(script, {
    URL, URLSearchParams, Response, TransformStream, DecompressionStream, performance, location,
    arcadeSaveKeys: { '2048': ['gameState'] },
    window: {
      configureArcadeMinecraftRelay() { configured = true; },
      async prepareArcadeSaves(game, keys, origin) { restored = {game, keys, origin}; }
    },
    fetch: async url => {
      fetched = url;
      const body = sync ? Buffer.from(source) : gzipSync(source);
      const stream = new ReadableStream({
        start(controller) {
          const middle = Math.floor(body.length / 2);
          controller.enqueue(body.subarray(0, middle));
          controller.enqueue(body.subarray(middle));
          controller.close();
        }
      });
      return new Response(stream, {headers:knownSize ? {'Content-Length': String(body.length)} : {}});
    },
    document: { getElementById: () => ({}), createElement: () => ({}),
      head: { append(script) { scripts.push(script.src); script.onload(); } },
      open() {}, close() {}, write(value) { written = value; } },
    parent: { postMessage(message, origin) {
      if (message.type === 'arcade-game-progress') progress.push(message.percent);
      else finish({ message, origin });
    } }
  });
  return { ...(await done), written, fetched, configured, restored, scripts, progress };
}
test('compressed games load from the certificate-valid site and retain their asset base', async () => {
  const result = await launchGame('speed-stars', '<!doctype html><html><head></head><body>Game</body></html>');
  assert.equal(result.fetched, 'https://www.calcolatrice.website/arcade/games/speed-stars/index.html.gz');
  assert.match(result.written, /<base href="https:\/\/www.calcolatrice.website\/arcade\/games\/speed-stars\/index.html">/);
  assert.equal(result.message.type, 'arcade-game-opened');
  assert.equal(result.origin, 'https://www.calcolatrice.website');
  assert.equal(result.configured, false);
  assert.ok(result.progress[0] >= 49 && result.progress[0] <= 50);
  assert.equal(result.progress.at(-1), 100);
  assert.deepEqual(result.scripts, ['../assets/game-audio.js']);
});
test('downloads with unknown size report the startup stage without inventing percentages', async () => {
  const result = await launchGame('speed-stars', '<html>Game</html>', {knownSize:false});
  assert.deepEqual(result.progress, [null]);
  assert.equal(result.message.type, 'arcade-game-opened');
});
test('Minecraft setup runs before opening the game; invalid game paths are rejected', async () => {
  const result = await launchGame('eaglecraft-26-3', '<html>Game</html>');
  assert.equal(result.configured, true);
  assert.deepEqual(result.scripts, ['../assets/game-audio.js', '../assets/minecraft-relay.js?v=2']);
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

/* Start this game with a fresh save namespace without clearing another game's data. */
(() => {
  'use strict';
  window.prepareArcadeResetStorage = function (game, revision) {
    if (!/^[a-z0-9-]{1,80}$/.test(game) || !/^[a-z0-9-]{1,80}$/.test(revision)) {
      throw new Error('Reset non valido');
    }
    const prefix = 'arcade-reset:' + game + ':' + revision + ':';
    const prototype = Storage.prototype;
    const native = Object.fromEntries(['getItem', 'setItem', 'removeItem', 'key', 'clear']
      .map(name => [name, prototype[name]]));
    const length = Object.getOwnPropertyDescriptor(prototype, 'length').get;
    const stores = new Set([window.localStorage, window.sessionStorage]);
    const targets = new WeakMap();
    const raw = value => targets.get(value) || value;
    const names = storage => {
      const keys = [];
      for (let i = 0; i < length.call(storage); i++) {
        const key = native.key.call(storage, i);
        if (key.startsWith(prefix)) keys.push(key.slice(prefix.length));
      }
      return keys;
    };
    prototype.getItem = function (key) {
      const storage = raw(this);
      return native.getItem.call(storage, stores.has(storage) ? prefix + String(key) : key);
    };
    prototype.setItem = function (key, value) {
      const storage = raw(this);
      return native.setItem.call(storage, stores.has(storage) ? prefix + String(key) : key, value);
    };
    prototype.removeItem = function (key) {
      const storage = raw(this);
      return native.removeItem.call(storage, stores.has(storage) ? prefix + String(key) : key);
    };
    prototype.key = function (index) {
      const storage = raw(this);
      return stores.has(storage) ? names(storage)[Number(index) >>> 0] ?? null : native.key.call(storage, index);
    };
    prototype.clear = function () {
      const storage = raw(this);
      if (!stores.has(storage)) return native.clear.call(storage);
      for (const key of names(storage)) native.removeItem.call(storage, prefix + key);
    };
    Object.defineProperty(prototype, 'length', {configurable:true, get() {
      const storage = raw(this);
      return stores.has(storage) ? names(storage).length : length.call(storage);
    }});
    for (const name of ['localStorage', 'sessionStorage']) {
      const storage = window[name];
      const proxy = new Proxy(storage, {
        get(target, key, receiver) {
          if (key in prototype || typeof key === 'symbol') return Reflect.get(prototype, key, receiver);
          return receiver.getItem(key) ?? undefined;
        },
        set(target, key, value, receiver) { receiver.setItem(key, value); return true; },
        deleteProperty(target, key) { prototype.removeItem.call(target, key); return true; },
        ownKeys(target) { return names(target); },
        has(target, key) { return key in prototype || prototype.getItem.call(target, key) !== null; },
        getOwnPropertyDescriptor(target, key) {
          const value = prototype.getItem.call(target, key);
          return value === null ? undefined : {value, writable:true, enumerable:true, configurable:true};
        }
      });
      targets.set(proxy, storage);
      Object.defineProperty(window, name, {configurable:true, get:() => proxy});
    }
    // Worlds and Unity saves commonly live in IndexedDB rather than localStorage.
    const idb = window.indexedDB;
    const open = idb.open.bind(idb);
    const removeDB = idb.deleteDatabase.bind(idb);
    idb.open = (name, ...args) => open(prefix + name, ...args);
    idb.deleteDatabase = name => removeDB(prefix + name);
    if (idb.databases) {
      const databases = idb.databases.bind(idb);
      idb.databases = async () => (await databases()).filter(db => db.name.startsWith(prefix))
        .map(db => ({...db, name:db.name.slice(prefix.length)}));
    }
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    const cookiePrefix = 'arcade_' + game + '_' + revision + '_';
    if (cookie?.get && cookie?.set) Object.defineProperty(Document.prototype, 'cookie', {
      configurable:true,
      get() {
        return cookie.get.call(this).split(/;\s*/).filter(item => item.startsWith(cookiePrefix))
          .map(item => item.slice(cookiePrefix.length)).join('; ');
      },
      set(value) { cookie.set.call(this, cookiePrefix + value); }
    });
  };
})();

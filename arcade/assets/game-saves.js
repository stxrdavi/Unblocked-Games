(() => {
  'use strict';
  const get = Storage.prototype.getItem;
  const set = Storage.prototype.setItem;
  const remove = Storage.prototype.removeItem;

  window.prepareArcadeSaves = async function (game, keys, origin) {
    if (window === parent || !origin) return;
    const storage = window.localStorage;
    function request(type, values) {
      return new Promise(resolve => {
        const requestId = crypto.randomUUID();
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); resolve(null); }, 7500);
        window.addEventListener('message', event => {
          if (event.source !== parent || event.origin !== origin || event.data?.type !== 'arcade-save-result' ||
              event.data.requestId !== requestId) return;
          clearTimeout(timer);
          controller.abort();
          resolve(event.data);
        }, {signal:controller.signal});
        parent.postMessage({type, requestId, values}, origin);
      });
    }
    const result = await request('arcade-save-load');
    if (!result?.scope) return;
    const prefix = 'arcade-save:'+game+':'+result.scope+':';
    const claim = 'arcade-save-import:'+game;
    const canImport = !get.call(storage, claim) || get.call(storage, claim) === result.scope;
    if (canImport) set.call(storage, claim, result.scope);
    const pendingKey = prefix+'pending';
    const pending = JSON.parse(get.call(storage, pendingKey) || '{}');
    const keySet = new Set(keys);
    const savePending = () => set.call(storage, pendingKey, JSON.stringify(pending));
    for (const key of keys) {
      let value;
      if (Object.hasOwn(pending, key)) value = pending[key];
      else if (result.data && Object.hasOwn(result.data, key)) value = result.data[key];
      else if (canImport) {
        value = get.call(storage,prefix+key) ?? result.legacy?.[key] ?? get.call(storage,key);
        if (value !== null && value !== undefined) pending[key] = value;
      }
      if (value === null) remove.call(storage,prefix+key);
      if (typeof value === 'string') set.call(storage,prefix+key,value);
    }
    savePending();
    let sending = false;
    async function flush() {
      if (sending || !Object.keys(pending).length) return;
      sending = true;
      const batch = {...pending};
      try {
        if ((await request('arcade-save-write', batch))?.ok) {
          for (const key of Object.keys(batch)) if (pending[key] === batch[key]) delete pending[key];
          savePending();
        }
      } finally { sending = false; }
    }
    let timer;
    function mark(key, value) {
      pending[key] = value;
      savePending();
      clearTimeout(timer);
      timer = setTimeout(flush, 350);
    }
    Storage.prototype.getItem = function (key) {
      return get.call(this, this === storage && keySet.has(String(key)) ? prefix+key : key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (this !== storage || !keySet.has(String(key))) return set.call(this,key,value);
      set.call(this,prefix+key,value);
      if (String(value).length <= 131072) mark(key,String(value));
    };
    Storage.prototype.removeItem = function (key) {
      if (this !== storage || !keySet.has(String(key))) return remove.call(this,key);
      remove.call(this,prefix+key);
      mark(key,null);
    };
    setInterval(flush, 5000);
    setTimeout(flush, 0);
  };
})();

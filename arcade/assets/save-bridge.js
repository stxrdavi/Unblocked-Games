const arcadeSaveKeys = {
  '2048': ['gameState', 'bestScore'],
  'cookie-clicker': ['CookieClickerGame', 'CookieClickerGameBeta'],
  blackjack: ['arcade-blackjack-balance']
};

function connectGameSaves(frame, game) {
  const keys = arcadeSaveKeys[game.id];
  const session = profileSession;
  if (!keys || !session || gameOrigin === location.origin) return () => {};

  let open = true;
  let writes = Promise.resolve();
  function accountId() {
    const body = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(body)).sub;
  }
  const call = async (changes = null) => {
    const token = await accessToken(session);
    const response = await fetch(authBase+'/rest/v1/rpc/arcade_sync_game', {
      method:'POST', headers:{apikey:authKey, Authorization:'Bearer '+token, 'Content-Type':'application/json'},
      body:JSON.stringify({game_name:game.id, changes}), signal:AbortSignal.timeout(6000)
    });
    if (!response.ok) throw new Error('Salvataggio cloud non disponibile');
    return response.json();
  };
  async function receive(event) {
    if (!open || session !== profileSession || event.origin !== gameOrigin || event.source !== frame.contentWindow) return;
    const {type, values, requestId} = event.data || {};
    if (type !== 'arcade-save-load' && type !== 'arcade-save-write') return;
    const reply = payload => {
      if (open && session === profileSession) frame.contentWindow?.postMessage({type:'arcade-save-result', requestId, ...payload}, gameOrigin);
    };
    try {
      if (type === 'arcade-save-load') {
        const scope = accountId();
        const data = await writes.then(() => call()).catch(() => null);
        const legacy = {};
        for (const key of keys) {
          try {
            const value = localStorage.getItem(key);
            if (value !== null) legacy[key] = value;
          } catch {}
        }
        reply({data, legacy, scope});
      } else {
        const changes = {};
        for (const key of keys) {
          if (Object.hasOwn(values || {}, key) && (values[key] === null ||
              (typeof values[key] === 'string' && values[key].length <= 131072))) changes[key] = values[key];
        }
        const next = writes.then(() => call(changes));
        writes = next.catch(() => {});
        await next;
        reply({ok:true});
      }
    } catch { reply({ok:false}); }
  }
  window.addEventListener('message', receive);
  return () => { open = false; window.removeEventListener('message', receive); return writes; };
}

async function resetCloudGameSave(game, session) {
  const keys = arcadeSaveKeys[game.id];
  if (!keys || !session) return;
  const token = await accessToken(session);
  if (session !== profileSession) throw new Error('Account cambiato. Riapri il gioco e riprova.');
  const response = await fetch(authBase+'/rest/v1/rpc/arcade_sync_game', {
    method:'POST', headers:{apikey:authKey, Authorization:'Bearer '+token, 'Content-Type':'application/json'},
    body:JSON.stringify({game_name:game.id, changes:Object.fromEntries(keys.map(key => [key, null]))}),
    signal:AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Reset cloud non riuscito. Controlla la connessione e riprova.');
}

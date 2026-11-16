(() => {
  'use strict';
  if (!window.crypto?.randomUUID) return;
  const counts = get('site-presence');
  const adminOnline = get('admin-online');
  const adminPlaying = get('admin-playing');
  const pageId = crypto.randomUUID();
  const guestKey = 'arcade-presence-guest';
  const format = new Intl.NumberFormat('it');
  let guestId = crypto.randomUUID();
  let sending = false;
  let updatePending = false;

  function guestIdentity() {
    try {
      const saved = localStorage.getItem(guestKey);
      if (saved) guestId = saved;
      else localStorage.setItem(guestKey, guestId);
    } catch {}
    return guestId;
  }

  async function update() {
    if (document.hidden) return;
    if (sending) {
      updatePending = true;
      return;
    }
    sending = true;
    const session = profileSession;
    try {
      const headers = {apikey:authKey, 'Content-Type':'application/json'};
      if (session) headers.Authorization = 'Bearer '+await accessToken(session);
      if (session !== profileSession || document.hidden) return;
      const route = location.hash;
      const response = await fetch(authBase+'/rest/v1/rpc/arcade_online_counts', {
        method:'POST', headers, signal:AbortSignal.timeout(8000),
        body:JSON.stringify({
          page_id:pageId, guest_id:session ? null : guestIdentity(),
          in_game:route.startsWith('#gioco/') && byId.has(route.slice(7))
        })
      });
      if (!response.ok) throw new Error('Counts unavailable');
      const [activity] = await response.json();
      if (session !== profileSession || !activity) return;
      adminOnline.textContent = get('online-count').textContent = format.format(activity.online);
      adminPlaying.textContent = get('playing-count').textContent = format.format(activity.playing);
      counts.hidden = false;
    } catch {
      if (session === profileSession) {
        counts.hidden = true;
        adminOnline.textContent = adminPlaying.textContent = '—';
      }
    } finally {
      sending = false;
      if (updatePending) {
        updatePending = false;
        update();
      }
    }
  }

  window.addEventListener('hashchange', update);
  window.addEventListener('arcade-session-change', update);
  window.addEventListener('pageshow', event => { if (event.persisted) update(); });
  document.addEventListener('visibilitychange', update);
  setInterval(update, 20000);
  update();
})();

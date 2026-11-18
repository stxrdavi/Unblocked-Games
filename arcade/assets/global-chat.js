(() => {
  'use strict';
  const panel = get('global-chat');
  const launcher = get('global-launcher');
  const form = get('global-form');
  const input = get('global-text');
  const send = form.querySelector('button');
  const log = get('global-messages');
  const status = get('global-status');
  const clock = new Intl.DateTimeFormat('it', {hour:'2-digit', minute:'2-digit'});
  let guestId;
  let reading = false;
  let sending = false;
  let ready = false;
  let lastViewer;
  let lastOwnership;
  let seenId;
  let noticeStart = Date.now();

  function checkMentions(messages, session) {
    if (!session) return;
    for (const message of messages) {
      const isNew = seenId === undefined ? Date.parse(message.sent_at) >= noticeStart : message.id > seenId;
      if (!isNew || message.mine === true || (message.mine === undefined && message.username === session.username)) continue;
      const tags = message.body.matchAll(/(?<![\w.@-])@([a-z0-9_.-]+)/gi);
      if (![...tags].some(tag => tag[1].toLowerCase() === session.username.toLowerCase())) continue;
      arcadeNotices.push({
        title:'Menzione nella chat globale', detail:message.username,
        suppressed:() => panel.open,
        reply:open
      });
    }
    if (messages.length) seenId = Math.max(seenId ?? 0, Number(messages.at(-1).id));
  }

  function guestIdentity() {
    if (guestId) return guestId;
    try { guestId = localStorage.getItem('arcade-chat-guest'); } catch {}
    if (!/^[0-9a-f-]{36}$/i.test(guestId || '')) guestId = crypto.randomUUID();
    try { localStorage.setItem('arcade-chat-guest', guestId); } catch {}
    return guestId;
  }

  async function request(name, data, token) {
    const headers = {apikey:authKey, 'Content-Type':'application/json'};
    if (token) headers.Authorization = 'Bearer '+token;
    const options = {
      method:'POST', headers, body:JSON.stringify(data), signal:AbortSignal.timeout(10000)
    };
    const endpoint = authBase+'/rest/v1/rpc/arcade_global_';
    let response = await fetch(endpoint+(name === 'read' ? 'messages_for_viewer' : name), options);
    if (name === 'read') {
      for (const fallback of ['profiles', 'read']) {
        if (response.status !== 404 || (await response.clone().json().catch(() => ({}))).code !== 'PGRST202') break;
        response = await fetch(endpoint+fallback, {...options, body:'{}'});
      }
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.code === 'P0001' ? error.message : 'Chat globale al momento non disponibile.');
    }
    if (name === 'read') return response.json();
  }

  function profileButton(username, content, openProfile, label) {
    const button = document.createElement('button');
    button.className = 'chat-profile';
    button.type = 'button';
    if (label) button.setAttribute('aria-label', 'Apri il profilo di '+username);
    button.append(content);
    button.onclick = openProfile;
    return button;
  }

  function render(messages, session) {
    const ownership = messages.map(message =>
      message.mine === true || (message.mine === undefined && session?.username === message.username));
    const signature = ownership.join(',');
    if (lastViewer === session && lastOwnership === signature &&
        String(messages.at(-1)?.id) === log.lastElementChild?.dataset.id) return;
    lastViewer = session;
    lastOwnership = signature;
    const atBottom = !log.lastElementChild || log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    log.replaceChildren(...messages.map((message, index) => {
      const row = document.createElement('div');
      const mine = ownership[index];
      row.className = mine ? 'chat-message-row mine' : 'chat-message-row';
      row.dataset.id = message.id;
      const bubble = document.createElement('div');
      bubble.className = mine ? 'dm-message mine' : 'dm-message';
      const avatar = makeChatAvatar(message.username, message.avatar);
      const openProfile = () => {
        close();
        get('public-profile').dispatchEvent(new CustomEvent('arcade-open-player', {detail:message}));
      };
      const author = document.createElement('time');
      author.dateTime = message.sent_at;
      author.textContent = clock.format(new Date(message.sent_at));
      const name = message.has_profile
        ? profileButton(message.username, message.username, openProfile)
        : message.username+' · ';
      author.prepend(name);
      bubble.append(author);
      for (const [index, part] of message.body.split(/((?<![\w.@-])@[a-z0-9_.-]+)/gi).entries()) {
        if (index % 2 === 0) bubble.append(part);
        else {
          const mention = document.createElement('span');
          mention.className = 'chat-mention';
          mention.textContent = part;
          bubble.append(mention);
        }
      }
      row.append(message.has_profile ? profileButton(message.username, avatar, openProfile, true) : avatar, bubble);
      return row;
    }));
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  async function refresh() {
    if ((!panel.open && !profileSession) || reading) return;
    reading = true;
    const session = profileSession;
    try {
      const token = session ? await accessToken(session) : null;
      if (session !== profileSession) return;
      const messages = await request('read', {guest_id:session ? null : guestIdentity()}, token);
      if (session !== profileSession) return;
      checkMentions(messages, session);
      if (!panel.open) return;
      render(messages, session);
      if (!sending && (!ready || !status.textContent || status.textContent === 'Scrivi il primo messaggio.')) {
        status.textContent = messages.length ? '' : 'Scrivi il primo messaggio.';
      }
      ready = true;
    } catch {
      ready = false;
      if (panel.open && !sending) status.textContent = 'Chat globale al momento non disponibile.';
    } finally {
      reading = false;
      send.disabled = !ready || sending;
    }
  }

  function close() {
    if (panel.open) panel.close();
    launcher.setAttribute('aria-expanded', 'false');
  }
  function open() {
    if (panel.open || document.fullscreenElement) return;
    get('dm-dialog').close();
    panel.show();
    arcadeNotices.recheck();
    launcher.setAttribute('aria-expanded', 'true');
    ready = false;
    send.disabled = true;
    status.textContent = 'Caricamento chat…';
    input.focus();
    refresh();
  }
  launcher.onclick = () => { if (panel.open) close(); else open(); };
  get('global-close').onclick = () => { close(); launcher.focus(); };
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); launcher.focus(); }
  });
  get('dm-launcher').addEventListener('click', close);
  window.addEventListener('arcade-open-dm', close);
  window.addEventListener('arcade-close-global', close);
  window.addEventListener('arcade-session-change', () => {
    log.replaceChildren();
    seenId = undefined;
    noticeStart = Date.now();
    refresh();
  });
  document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement) close(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || !ready || sending) return;
    const session = profileSession;
    sending = true;
    send.disabled = true;
    try {
      const token = session ? await accessToken(session) : null;
      if (session !== profileSession) return;
      await request('send', {guest_id:session ? null : guestIdentity(), message}, token);
      if (input.value.trim() === message) input.value = '';
      status.textContent = '';
    } catch (error) {
      status.textContent = error.message;
      return;
    } finally {
      sending = false;
      send.disabled = !ready;
    }
    refresh();
  });
  setInterval(() => { if (!document.hidden) refresh(); }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
})();

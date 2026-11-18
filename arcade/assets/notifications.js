const arcadeNotices = (() => {
  'use strict';
  const box = get('arcade-notice');
  const title = get('notice-title');
  const detail = get('notice-detail');
  const ignore = get('notice-ignore');
  const reply = get('notice-reply');
  const nativePopover = typeof box.showPopover === 'function';
  const queue = [];
  let active;
  let timer;
  let incoming = new Set();

  function show() {
    while (!active && queue.length) {
      const notice = queue.shift();
      if (notice.suppressed?.()) continue;
      active = notice;
      title.textContent = notice.title;
      detail.textContent = notice.detail;
      box.hidden = false;
      if (nativePopover) box.showPopover();
      timer = setTimeout(dismiss, 5000);
    }
  }

  function dismiss(advance = true) {
    clearTimeout(timer);
    active = undefined;
    if (nativePopover && box.matches(':popover-open')) box.hidePopover();
    box.hidden = true;
    if (advance) show();
  }

  function push(notice) {
    if (notice.suppressed?.()) return;
    if (queue.length >= 20) queue.shift();
    queue.push(notice);
    show();
  }

  function recheck() {
    if (active?.suppressed?.()) dismiss();
  }

  ignore.onclick = () => dismiss();
  reply.onclick = async () => {
    if (!active) return;
    const notice = active;
    const session = profileSession;
    dismiss(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      if (session === profileSession && !document.fullscreenElement) notice.reply();
    } finally {
      show();
    }
  };

  document.addEventListener('fullscreenchange', () => {
    const host = document.fullscreenElement === get('player-stage')
      ? document.fullscreenElement : document.body;
    if (box.parentElement !== host) host.append(box);
    if (active && nativePopover && !box.matches(':popover-open')) box.showPopover();
  });
  window.addEventListener('arcade-session-change', () => {
    incoming = new Set();
    queue.length = 0;
    dismiss();
  });
  window.addEventListener('arcade-friends-updated', event => {
    const requests = event.detail.filter(person => person.relationship === 'incoming');
    const previous = incoming;
    incoming = new Set(requests.map(person => person.username));
    recheck();
    for (const person of requests) {
      if (previous.has(person.username)) continue;
      push({
        title:'Richiesta di amicizia', detail:person.username,
        suppressed:() => !incoming.has(person.username),
        reply:() => get('public-profile').dispatchEvent(new CustomEvent('arcade-open-player', {detail:person}))
      });
    }
  });

  return {push, recheck};
})();

(() => {
  'use strict';
  const address = 'wss://arcade-lan-relay.onrender.com';
  const key = '_eaglercraftX.relay.list.v3';
  const marker = 'arcade-minecraft-relay-v1';

  window.configureArcadeMinecraftRelay = function () {
    // Wake the existing relay while the large game bundle downloads. A sleeping
    // relay must never prevent the player from opening an offline world.
    fetch('https://arcade-lan-relay.onrender.com/health', {
      mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(90000)
    }).catch(() => {});

    if (localStorage.getItem(marker)) return;
    const previous = localStorage.getItem(key)
      ?? localStorage.getItem('_eaglercraftX.relay.list.v2');
    let profiles = [];
    if (previous !== null) {
      // Preserve the exact previous value as well as every custom relay.
      localStorage.setItem('arcade-minecraft-relay-backup-v1', previous);
      try {
        const decoded = new TextDecoder().decode(
          Uint8Array.from(atob(previous), character => character.charCodeAt(0))
        );
        const parsed = JSON.parse(decoded);
        if (Array.isArray(parsed)) profiles = parsed;
      } catch { /* An unreadable relay list must not block game startup. */ }
    }
    profiles = profiles.filter(profile => profile?.address?.replace(/\/+$/, '') !== address);
    profiles.unshift({
      name: 'Arcade LAN', address, private: false, token: '',
      capability: 'both', detected: 'both'
    });
    const bytes = new TextEncoder().encode(JSON.stringify(profiles));
    localStorage.setItem(key, btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')));
    localStorage.setItem(marker, '1');
  };
})();

(() => {
  'use strict';
  const publicRelay = 'wss://oxer-26-2-relay-c5f9ad499e09.herokuapp.com';
  const p2pRelay = 'wss://relay.deev.is';
  const oldRelay = 'wss://arcade-lan-relay.onrender.com';
  const key = '_eaglercraftX.relay.list.v3';
  const marker = 'arcade-minecraft-relay-v2';
  const endpoint = profile => typeof profile?.address === 'string'
    ? profile.address.trim().replace(/\/+$/, '').toLowerCase()
    : '';
  const profile = (name, address, detected) => ({
    name, address, private: false, token: '', capability: 'auto', detected
  });

  window.configureArcadeMinecraftRelay = function () {
    if (localStorage.getItem(marker)) return;
    const previous = localStorage.getItem(key)
      ?? localStorage.getItem('_eaglercraftX.relay.list.v2');
    let profiles;
    try {
      if (previous !== null) {
        profiles = JSON.parse(new TextDecoder().decode(
          Uint8Array.from(atob(previous), character => character.charCodeAt(0))
        ));
      }
    } catch { /* Restore defaults if the old list cannot be decoded. */ }

    if (!Array.isArray(profiles)) {
      profiles = [
        profile('Heroku public relay', publicRelay, 'both'),
        profile('Eagler P2P relay', p2pRelay, 'singleplayer')
      ];
    } else {
      // Replace only the profile installed by Arcade. Keep user relay edits,
      // an explicitly empty list, and the order of existing custom profiles.
      const index = profiles.findIndex(entry => endpoint(entry) === oldRelay
        && entry.name === 'Arcade LAN' && entry.private === false
        && !entry.token && entry.capability === 'both' && entry.detected === 'both');
      if (index === -1 || !localStorage.getItem('arcade-minecraft-relay-v1')) {
        localStorage.setItem(marker, '1');
        return;
      }
      profiles.splice(index, 1);
      const replacements = [];
      if (!profiles.some(entry => endpoint(entry) === publicRelay)) {
        replacements.push(profile('Heroku public relay', publicRelay, 'both'));
      }
      if (!profiles.some(entry => endpoint(entry) === p2pRelay)) {
        replacements.push(profile('Eagler P2P relay', p2pRelay, 'singleplayer'));
      }
      profiles.splice(index, 0, ...replacements);
    }

    if (previous !== null && localStorage.getItem('arcade-minecraft-relay-backup-v2') === null) {
      localStorage.setItem('arcade-minecraft-relay-backup-v2', previous);
    }
    const bytes = new TextEncoder().encode(JSON.stringify(profiles));
    localStorage.setItem(key, btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')));
    localStorage.setItem(marker, '1');
  };
})();

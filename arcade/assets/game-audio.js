(() => {
  'use strict';
  const boot = document.currentScript;
  const parentOrigin = boot.dataset.playerOrigin || (
    location.hostname === 'www.calcolatrice.website.' ? 'https://www.calcolatrice.website' : location.origin
  );
  if (parent === window || window.arcadeAudioInstalled) return;
  window.arcadeAudioInstalled = true;

  let muted = false;
  const media = new Map();
  const gains = new Map();
  const audioNode = window.AudioNode?.prototype;
  const connect = audioNode?.connect;
  const disconnect = audioNode?.disconnect;

  function output(node, destination, create) {
    const context = node.context;
    if (destination !== context.destination || destination.numberOfOutputs !== 0 ||
        !(context instanceof AudioContext)) return destination;
    if (!gains.has(context) && create) {
      const gain = context.createGain();
      gain.gain.value = muted ? 0 : 1;
      connect.call(gain, destination);
      gains.set(context, gain);
    }
    return gains.get(context) || destination;
  }

  if (audioNode && window.AudioContext) {
    audioNode.connect = function (destination, ...ports) {
      const target = output(this, destination, true);
      const result = connect.call(this, target, ...ports);
      return target === destination ? result : destination;
    };
    audioNode.disconnect = function (...args) {
      if (args[0] instanceof AudioNode) args[0] = output(this, args[0], false);
      return disconnect.apply(this, args);
    };
  }

  function syncMedia() {
    for (const element of document.querySelectorAll('audio,video')) {
      if (muted && !media.has(element)) media.set(element, element.muted);
    }
    for (const [element, original] of media) {
      element.muted = muted || original;
    }
    if (!muted) media.clear();
    for (const [context, gain] of gains) {
      gain.gain.value = muted ? 0 : 1;
      if (context.state === 'closed') gains.delete(context);
    }
  }

  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (muted) {
      if (!media.has(this)) media.set(this, this.muted);
      this.muted = true;
    }
    return play.apply(this, args);
  };

  function receive(event) {
    if (event.source !== parent || event.origin !== parentOrigin ||
        event.data?.type !== 'arcade-audio' || typeof event.data.muted !== 'boolean') return;
    muted = event.data.muted;
    syncMedia();
  }

  // Embedded games can replace their document during startup.
  const open = document.open;
  document.open = function (...args) {
    const result = open.apply(this, args);
    if (this === document) window.addEventListener('message', receive);
    return result;
  };
  window.addEventListener('message', receive);
  window.setInterval(() => { if (muted) syncMedia(); }, 180);
  parent.postMessage({type:'arcade-audio-ready'}, parentOrigin);
})();

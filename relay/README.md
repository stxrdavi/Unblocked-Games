# Relay LAN di Arcade

Il relay collega chi ospita un mondo in Eaglercraft 26.3 a chi si unisce con il codice. La partita gira nel browser di chi ospita. Il server inoltra i dati via WebSocket e tiene le stanze in memoria fino a quando l'host esce.

## Pubblicazione su Render

1. Apri **New → Blueprint** in Render e seleziona questo repository e il branch che contiene `render.yaml`. Il Blueprint crea un Web Service in Francoforte con il piano Free.
2. Quando il servizio è attivo, apri `https://<nome-servizio>.onrender.com/health` e verifica che risponda `Arcade LAN relay ready`.
3. Usa l'indirizzo base `wss://<nome-servizio>.onrender.com` nelle impostazioni del gioco.

Dopo un periodo di inattività, apri la pagina `/health` e attendi che risponda prima di avviare la stanza. Il piano Free impiega circa un minuto a riattivarsi.

## Connessione dal gioco

1. In Eaglercraft 26.3 apri **Multiplayer → Relays… → Add relay**. Inserisci l'indirizzo base e scegli **Both** e **Public**. Sposta il relay in cima alla lista per usarlo per la LAN.
2. Chi ospita apre il mondo e attiva **Relay LAN**. Gli amici configurano lo stesso relay in Arcade e inseriscono il codice in **Multiplayer → Direct Connection → Join LAN World**.

Il relay accetta connessioni dal dominio di Arcade. Se il dominio cambia, imposta `RELAY_ORIGINS` con le origini HTTPS ammesse, separate da virgole. Per limitare chi può aprire una stanza, imposta un valore casuale in `RELAY_HOST_TOKEN` nelle variabili del servizio. Chi ospita seleziona **Private** nel gioco e inserisce il token. Agli amici basta il codice del mondo e la configurazione **Public**.

## Prova locale

```bash
cd relay
npm ci
npm test
npm start
```

Le route WebSocket sono `/lan/host` e `/lan/join?code=…`. La modalità **Both** fa usare al client il trasporto WebSocket di Relay LAN.

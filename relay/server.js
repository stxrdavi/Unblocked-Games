import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCodePattern = /^[A-HJ-NP-Z2-9]{8}$/;
const peerIdPattern = /^[a-f0-9]{16}$/;
const maxRooms = 24;
const maxGuests = 6;
const maxFrameBytes = 8 * 1024 * 1024;
const maxQueueBytes = 24 * 1024 * 1024;

const rooms = new Map();
const allowedOrigins = new Set((process.env.RELAY_ORIGINS ??
  'https://www.calcolatrice.website.,https://www.calcolatrice.website')
  .split(',').map(origin => origin.trim()).filter(Boolean));
const hostToken = Buffer.from(process.env.RELAY_HOST_TOKEN ?? '');

const server = createServer((request, response) => {
  const healthy = request.method === 'GET' &&
    (request.url === '/health' || request.url === '/');
  response.writeHead(healthy ? 200 : 404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  }).end(healthy ? 'Arcade LAN relay ready\n' : 'Not found\n');
});

const sockets = new WebSocketServer({
  noServer: true,
  maxPayload: maxFrameBytes,
  perMessageDeflate: false,
});

function send(socket, payload, binary) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount + Buffer.byteLength(payload) > maxQueueBytes) {
    socket.terminate();
    return;
  }
  socket.send(payload, { binary }, error => {
    if (error) socket.terminate();
  });
}

function sendControl(socket, type, fields) {
  send(socket, JSON.stringify({ type, ...fields }), false);
}

function reject(socket, message) {
  sendControl(socket, 'error', { message });
  socket.close(1008, message);
}

function hostRoom(host) {
  let code;
  do {
    code = Array.from({ length: 8 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join('');
  } while (rooms.has(code));

  const guests = new Map();
  rooms.set(code, { host, guests });
  host.once('close', () => {
    rooms.delete(code);
    for (const guest of guests.values()) guest.close(1001, 'Host left the world');
    guests.clear();
  });

  host.on('message', (frame, binary) => {
    // The host multiplexes every guest on one socket: tag, ID length, ID, data.
    if (!binary || frame.length < 19 || frame[0] !== 1 || frame[1] !== 16) {
      reject(host, 'Invalid host frame');
      return;
    }
    const peer = frame.toString('latin1', 2, 18);
    if (!peerIdPattern.test(peer)) {
      reject(host, 'Invalid peer ID');
      return;
    }
    const guest = guests.get(peer);
    if (guest) send(guest, frame.subarray(18), true);
  });
  sendControl(host, 'hosted', { code });
}

function joinRoom(guest, { host, guests }) {
  let peer;
  do {
    peer = randomBytes(8).toString('hex');
  } while (guests.has(peer));

  const header = Buffer.alloc(18);
  header[0] = 1;
  header[1] = 16;
  header.write(peer, 2, 'ascii');
  guests.set(peer, guest);
  guest.once('close', () => {
    if (guests.delete(peer)) sendControl(host, 'peer-close', { peer });
  });
  guest.on('message', (data, binary) => {
    if (!binary || data.length === 0 || data.length > maxFrameBytes - header.length) {
      reject(guest, 'Invalid guest frame');
      return;
    }
    send(host, Buffer.concat([header, data]), true);
  });
  sendControl(host, 'peer-open', { peer });
}

server.on('upgrade', (request, connection, head) => {
  const url = URL.parse(request.url, 'http://relay.local');
  const hosting = url?.pathname === '/lan/host';
  const joining = url?.pathname === '/lan/join';
  if ((!hosting && !joining) || !allowedOrigins.has(request.headers.origin)) {
    connection.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    return;
  }

  const token = Buffer.from(url.searchParams.get('token') ?? '');
  if (hosting && hostToken.length &&
      (token.length !== hostToken.length || !timingSafeEqual(token, hostToken))) {
    connection.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    return;
  }

  if (sockets.clients.size >= maxRooms * (maxGuests + 1)) {
    connection.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    return;
  }

  sockets.handleUpgrade(request, connection, head, socket => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('error', () => socket.terminate());
    if (hosting) {
      if (rooms.size >= maxRooms) reject(socket, 'Relay is full');
      else hostRoom(socket);
      return;
    }

    const code = url.searchParams.get('code')?.toUpperCase() ?? '';
    const room = roomCodePattern.test(code) && rooms.get(code);
    if (!room || room.host.readyState !== WebSocket.OPEN) reject(socket, 'World not found');
    else if (room.guests.size >= maxGuests) reject(socket, 'World is full');
    else joinRoom(socket, room);
  });
});

const heartbeat = setInterval(() => {
  for (const socket of sockets.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    if (socket.readyState === WebSocket.OPEN) {
      socket.isAlive = false;
      socket.ping();
    }
  }
}, 30_000);
heartbeat.unref();

process.once('SIGTERM', () => {
  clearInterval(heartbeat);
  for (const socket of sockets.clients) socket.close(1001, 'Relay is restarting');
  server.close();
  setTimeout(() => {
    for (const socket of sockets.clients) socket.terminate();
  }, 3000).unref();
});

server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0', () => {
  console.log(`Arcade LAN relay listening on port ${server.address().port}`);
});

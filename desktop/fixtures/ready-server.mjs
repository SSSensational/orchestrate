import { createServer } from 'node:net';

const server = createServer((socket) => socket.end());
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (typeof address === 'string' || address === null) process.exit(1);
  process.send?.({ type: 'ready', host: '127.0.0.1', port: address.port });
});

process.once('SIGTERM', () => {
  server.close(() => process.exit(0));
});

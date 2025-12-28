/**
 * VSCord Server Entry Point
 * WebSocket server with O(K) pub/sub architecture
 */

import { WebSocketServer, WebSocket } from 'ws';
import { DatabaseService } from './database';
import { PubSubService, GitHubService, MessageHandler } from './services';
import { HEARTBEAT_INTERVAL_MS } from '../shared/types';

const PORT = parseInt(process.env['PORT'] ?? '8080', 10);
const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://vscord:vscord_dev_password@localhost:5433/vscord';
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6380';

async function main(): Promise<void> {
  console.log('[Server] Starting VSCord server...');

  // Initialize services
  const db = new DatabaseService(DATABASE_URL);
  const pubsub = new PubSubService(REDIS_URL);
  const github = new GitHubService();
  const handler = new MessageHandler(db, pubsub, github);

  // Initialize database schema
  await db.initialize();
  await pubsub.initialize();

  // Create WebSocket server
  const wss = new WebSocketServer({ port: PORT });
  console.log(`[Server] WebSocket server listening on port ${PORT}`);

  // Track alive clients for heartbeat
  const aliveClients = new WeakMap<WebSocket, boolean>();

  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (aliveClients.get(ws) === false) {
        console.log('[Server] Terminating dead connection');
        ws.terminate();
        continue;
      }
      aliveClients.set(ws, false);
      ws.send(JSON.stringify({ t: 'hb' }));
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Handle new connections
  wss.on('connection', (ws: WebSocket) => {
    aliveClients.set(ws, true);

    ws.on('message', async (data: Buffer) => {
      aliveClients.set(ws, true);
      try {
        await handler.handleMessage(ws, data.toString());
      } catch (error) {
        console.error('[Server] Error handling message:', error);
        ws.send(JSON.stringify({ t: 'error', error: 'Internal server error' }));
      }
    });

    ws.on('close', async () => {
      try {
        await handler.handleDisconnect(ws);
      } catch (error) {
        console.error('[Server] Error handling disconnect:', error);
      }
    });

    ws.on('error', (error) => {
      console.error('[Server] WebSocket error:', error);
    });

    ws.on('pong', () => {
      aliveClients.set(ws, true);
    });
  });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log('[Server] Shutting down...');
    clearInterval(heartbeatInterval);

    // Close all connections
    for (const ws of wss.clients) {
      ws.close(1001, 'Server shutting down');
    }

    wss.close();
    await pubsub.close();
    await db.close();

    console.log('[Server] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[Server] Fatal error:', error);
  process.exit(1);
});

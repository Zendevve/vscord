/**
 * Pub/Sub Service
 * Redis-based O(K) presence distribution
 */

import Redis from 'ioredis';
import type { WebSocket } from 'ws';
import type { ServerMessage, DeltaUpdateMessage, UserOnlineMessage, UserOfflineMessage } from '../../shared/types';
import { SESSION_RESUME_TTL_MS } from '../../shared/types';

interface SessionData {
  userId: string;
  username: string;
  githubId?: number;
  connectedAt: number;
}

interface Subscription {
  ws: WebSocket;
  userId: string;
}

export class PubSubService {
  public publisher: Redis;  // Public for channel handler
  private subscriber: Redis;
  private subscriptions: Map<string, Set<Subscription>> = new Map();
  private userSockets: Map<WebSocket, string[]> = new Map();

  constructor(redisUrl: string) {
    this.publisher = new Redis(redisUrl);
    this.subscriber = new Redis(redisUrl);

    // Handle Redis pub/sub messages
    this.subscriber.on('message', (channel: string, message: string) => {
      this.handleMessage(channel, message);
    });
  }

  /**
   * Initialize Redis connection
   */
  async initialize(): Promise<void> {
    await this.publisher.ping();
    await this.subscriber.ping();
    console.log('[PubSub] Redis connected');
  }

  /**
   * Subscribe a WebSocket to a user's presence channel
   */
  async subscribe(ws: WebSocket, targetUsername: string, viewerId: string): Promise<void> {
    const channel = `presence:${targetUsername}`;

    // Track subscription
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
      await this.subscriber.subscribe(channel);
    }

    this.subscriptions.get(channel)?.add({ ws, userId: viewerId });

    // Track which channels this socket is subscribed to
    if (!this.userSockets.has(ws)) {
      this.userSockets.set(ws, []);
    }
    this.userSockets.get(ws)?.push(channel);
  }

  /**
   * Subscribe to multiple users at once
   */
  async subscribeToMany(ws: WebSocket, targetUsernames: string[], viewerId: string): Promise<void> {
    for (const username of targetUsernames) {
      await this.subscribe(ws, username, viewerId);
    }
  }

  /**
   * Unsubscribe a WebSocket from all channels
   */
  async unsubscribeAll(ws: WebSocket): Promise<void> {
    const channels = this.userSockets.get(ws) ?? [];

    for (const channel of channels) {
      const subs = this.subscriptions.get(channel);
      if (subs) {
        for (const sub of subs) {
          if (sub.ws === ws) {
            subs.delete(sub);
          }
        }
        // If no more subscribers, unsubscribe from Redis
        if (subs.size === 0) {
          this.subscriptions.delete(channel);
          await this.subscriber.unsubscribe(channel);
        }
      }
    }

    this.userSockets.delete(ws);
  }

  /**
   * Publish a delta update to a user's channel
   */
  async publishDelta(username: string, delta: Omit<DeltaUpdateMessage, 't'>): Promise<void> {
    const message: DeltaUpdateMessage = { t: 'u', ...delta };
    await this.publisher.publish(`presence:${username}`, JSON.stringify(message));
  }

  /**
   * Publish user online event
   */
  async publishOnline(username: string, data: Omit<UserOnlineMessage, 't'>): Promise<void> {
    const message: UserOnlineMessage = { t: 'o', ...data };
    await this.publisher.publish(`presence:${username}`, JSON.stringify(message));
  }

  /**
   * Publish user offline event
   */
  async publishOffline(username: string): Promise<void> {
    const message: UserOfflineMessage = { t: 'x', id: username, ts: Date.now() };
    await this.publisher.publish(`presence:${username}`, JSON.stringify(message));
  }

  /**
   * Handle incoming Redis messages
   */
  private handleMessage(channel: string, message: string): void {
    const subs = this.subscriptions.get(channel);
    if (!subs) return;

    // Send to all subscribed WebSockets
    for (const { ws } of subs) {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(message);
      }
    }
  }

  /**
   * Store session resume token
   */
  async setResumeToken(token: string, session: SessionData): Promise<void> {
    await this.publisher.set(
      `session:${token}`,
      JSON.stringify(session),
      'PX',
      SESSION_RESUME_TTL_MS
    );
  }

  /**
   * Get and validate resume token
   */
  async getResumeToken(token: string): Promise<SessionData | null> {
    const data = await this.publisher.get(`session:${token}`);
    if (!data) return null;
    return JSON.parse(data) as SessionData;
  }

  /**
   * Delete resume token (used after successful resume)
   */
  async deleteResumeToken(token: string): Promise<void> {
    await this.publisher.del(`session:${token}`);
  }

  /**
   * Cache user status for quick retrieval
   */
  async cacheUserStatus(username: string, status: Record<string, unknown>): Promise<void> {
    await this.publisher.hset(`status:${username}`, status as Record<string, string>);
    await this.publisher.expire(`status:${username}`, 3600); // 1 hour TTL
  }

  /**
   * Get cached user status
   */
  async getCachedStatus(username: string): Promise<Record<string, string> | null> {
    const status = await this.publisher.hgetall(`status:${username}`);
    return Object.keys(status).length > 0 ? status : null;
  }

  /**
   * Close Redis connections
   */
  async close(): Promise<void> {
    await this.subscriber.quit();
    await this.publisher.quit();
  }
}

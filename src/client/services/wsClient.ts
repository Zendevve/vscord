/**
 * WebSocket Client Service
 * Manages connection to VSCord server with reconnection and delta updates
 */

import * as vscode from 'vscode';
import WebSocket from 'ws';
import type {
  ServerMessage,
  ClientMessage,
  UserStatus,
  StatusType,
  ActivityType,
  SyncMessage,
  DeltaUpdateMessage,
  UserOnlineMessage,
  UserOfflineMessage,
  LoginSuccessMessage,
} from '../../shared/types';
import { HEARTBEAT_INTERVAL_MS } from '../../shared/types';

export interface WsClientOptions {
  serverUrl: string;
  onUserListUpdate: (users: UserStatus[]) => void;
  onConnectionChange: (connected: boolean) => void;
  onError: (error: string) => void;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private users: Map<string, UserStatus> = new Map();
  private resumeToken: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isConnected = false;

  constructor(private options: WsClientOptions) { }

  /**
   * Connect to server with GitHub token
   */
  async connect(username: string, token?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.options.serverUrl);

        this.ws.on('open', () => {
          console.log('[WsClient] Connected to server');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.options.onConnectionChange(true);

          // Send login
          const loginMsg: ClientMessage = {
            t: 'login',
            username,
            token,
            resumeToken: this.resumeToken ?? undefined,
          };
          this.send(loginMsg);
        });

        this.ws.on('message', (data: Buffer) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('close', () => {
          this.handleDisconnect();
        });

        this.ws.on('error', (error) => {
          console.error('[WsClient] WebSocket error:', error);
          this.options.onError(error.message);
          reject(error);
        });

        // Resolve after first successful message
        const messageHandler = (data: Buffer) => {
          const msg = JSON.parse(data.toString()) as ServerMessage;
          if (msg.t === 'loginSuccess') {
            this.ws?.off('message', messageHandler);
            resolve();
          } else if (msg.t === 'loginError') {
            this.ws?.off('message', messageHandler);
            reject(new Error((msg as { error: string }).error));
          }
        };
        this.ws.on('message', messageHandler);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming server message
   */
  private handleMessage(data: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      console.error('[WsClient] Invalid JSON:', data);
      return;
    }

    switch (message.t) {
      case 'loginSuccess':
        this.handleLoginSuccess(message);
        break;
      case 'sync':
        this.handleSync(message);
        break;
      case 'u':
        this.handleDeltaUpdate(message);
        break;
      case 'o':
        this.handleUserOnline(message);
        break;
      case 'x':
        this.handleUserOffline(message);
        break;
      case 'hb':
        // Heartbeat response - connection is alive
        break;
      case 'token':
        this.resumeToken = message.token;
        break;
      case 'error':
        this.options.onError(message.error);
        break;
    }
  }

  /**
   * Handle login success
   */
  private handleLoginSuccess(message: LoginSuccessMessage): void {
    this.resumeToken = message.token;
    this.startHeartbeat();
  }

  /**
   * Handle initial sync
   */
  private handleSync(message: SyncMessage): void {
    this.users.clear();
    for (const user of message.users) {
      this.users.set(user.id, {
        username: user.id,
        avatar: user.a,
        status: user.s as StatusType,
        activity: user.act as ActivityType,
        project: user.p ?? '',
        language: user.l ?? '',
        lastSeen: user.ls,
      });
    }
    this.options.onUserListUpdate(Array.from(this.users.values()));
  }

  /**
   * Handle delta update - only changed fields
   */
  private handleDeltaUpdate(message: DeltaUpdateMessage): void {
    const existing = this.users.get(message.id);
    if (existing) {
      if (message.s) existing.status = message.s as StatusType;
      if (message.a) existing.activity = message.a as ActivityType;
      if (message.p !== undefined) existing.project = message.p;
      if (message.l !== undefined) existing.language = message.l;
      this.options.onUserListUpdate(Array.from(this.users.values()));
    }
  }

  /**
   * Handle user coming online
   */
  private handleUserOnline(message: UserOnlineMessage): void {
    this.users.set(message.id, {
      username: message.id,
      avatar: message.a,
      status: message.s as StatusType,
      activity: message.act as ActivityType,
      project: message.p ?? '',
      language: message.l ?? '',
    });
    this.options.onUserListUpdate(Array.from(this.users.values()));
  }

  /**
   * Handle user going offline
   */
  private handleUserOffline(message: UserOfflineMessage): void {
    const user = this.users.get(message.id);
    if (user) {
      user.status = 'Offline';
      user.lastSeen = message.ts;
      this.options.onUserListUpdate(Array.from(this.users.values()));
    }
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(): void {
    this.isConnected = false;
    this.stopHeartbeat();
    this.options.onConnectionChange(false);

    // Attempt reconnection
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      console.log(`[WsClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
      setTimeout(() => {
        // Will need username/token from storage
        // This is handled by the extension
      }, delay);
    }
  }

  /**
   * Send status update
   */
  sendStatusUpdate(status?: StatusType, activity?: ActivityType, project?: string, language?: string): void {
    this.send({
      t: 'statusUpdate',
      s: status,
      a: activity,
      p: project,
      l: language,
    });
  }

  /**
   * Send message to server
   */
  private send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ t: 'hb' });
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.isConnected = false;
  }

  /**
   * Get current users
   */
  getUsers(): UserStatus[] {
    return Array.from(this.users.values());
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected;
  }
}

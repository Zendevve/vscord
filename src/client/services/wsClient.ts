/**
 * WebSocket Client Service
 * Manages connection to VSCord server with reconnection and delta updates
 */

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
  ChannelSyncMessage,
  ChannelUpdateMessage,
  ChannelJoinMessage,
  ChannelLeaveMessage,
  ChannelCreatedMessage,
  JoinSuccessMessage,
  ChannelChatMessage,
} from '../../shared/types';
import { HEARTBEAT_INTERVAL_MS } from '../../shared/types';
import type { ChannelData } from '../providers';

export interface WsClientOptions {
  serverUrl: string;
  onUserListUpdate: (users: UserStatus[]) => void;
  onConnectionChange: (connected: boolean) => void;
  onError: (error: string) => void;
  // Channel callbacks
  onChannelSync?: (channel: ChannelData) => void;
  onChannelUpdate?: (channelId: string, username: string, updates: Partial<UserStatus>) => void;
  onChannelMemberJoin?: (channelId: string, member: UserStatus) => void;
  onChannelMemberLeave?: (channelId: string, username: string) => void;
  onChannelCreated?: (channelId: string, name: string, inviteCode: string) => void;
  onChannelJoined?: (channelId: string, name: string) => void;
  onChannelMessage?: (channelId: string, sender: string, content: string, ts: number) => void;
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
      // Channel messages
      case 'ccOk':
        this.handleChannelCreated(message as ChannelCreatedMessage);
        break;
      case 'jcOk':
        this.handleJoinSuccess(message as JoinSuccessMessage);
        break;
      case 'cs':
        this.handleChannelSync(message as ChannelSyncMessage);
        break;
      case 'cu':
        this.handleChannelUpdate(message as ChannelUpdateMessage);
        break;
      case 'cj':
        this.handleChannelJoin(message as ChannelJoinMessage);
        break;
      case 'cl':
        this.handleChannelLeave(message as ChannelLeaveMessage);
        break;
      case 'cm':
        this.handleChannelChat(message as ChannelChatMessage);
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

  // ==========================================================================
  // Channel Handlers (Phase 2)
  // ==========================================================================

  private handleChannelCreated(message: ChannelCreatedMessage): void {
    this.options.onChannelCreated?.(message.channelId, message.name, message.inviteCode);
  }

  private handleJoinSuccess(message: JoinSuccessMessage): void {
    this.options.onChannelJoined?.(message.channelId, message.name);
  }

  private handleChannelSync(message: ChannelSyncMessage): void {
    const members: UserStatus[] = message.members.map(m => ({
      username: m.id,
      avatar: m.a,
      status: (m.s as StatusType) ?? 'Offline',
      activity: (m.act as ActivityType) ?? 'Idle',
      project: m.p ?? '',
      language: m.l ?? '',
    }));
    this.options.onChannelSync?.({
      id: message.channelId,
      name: message.name,
      members,
    });
  }

  private handleChannelUpdate(message: ChannelUpdateMessage): void {
    this.options.onChannelUpdate?.(message.channelId, message.id, {
      status: message.s as StatusType,
      activity: message.a as ActivityType,
      project: message.p,
      language: message.l,
    });
  }

  private handleChannelJoin(message: ChannelJoinMessage): void {
    const member: UserStatus = {
      username: message.member.id,
      avatar: message.member.a,
      status: (message.member.s as StatusType) ?? 'Online',
      activity: (message.member.act as ActivityType) ?? 'Idle',
      project: message.member.p ?? '',
      language: message.member.l ?? '',
    };
    this.options.onChannelMemberJoin?.(message.channelId, member);
  }

  private handleChannelLeave(message: ChannelLeaveMessage): void {
    this.options.onChannelMemberLeave?.(message.channelId, message.id);
  }

  private handleChannelChat(message: ChannelChatMessage): void {
    if (message.id && message.ts) {
      this.options.onChannelMessage?.(message.channelId, message.id, message.content, message.ts);
    }
  }

  // ==========================================================================
  // Channel Commands
  // ==========================================================================

  /**
   * Create a new channel
   */
  createChannel(name: string): void {
    this.sendRaw({ t: 'cc', name });
  }

  /**
   * Join a channel by invite code
   */
  joinChannel(inviteCode: string): void {
    this.sendRaw({ t: 'jc', inviteCode });
  }

  /**
   * Leave a channel
   */
  leaveChannel(channelId: string): void {
    this.sendRaw({ t: 'lc', channelId });
  }

  /**
   * Send a message to a channel
   */
  sendChannelMessage(channelId: string, content: string): void {
    this.sendRaw({ t: 'cm', channelId, content });
  }

  /**
   * Send raw message (for channel commands)
   */
  private sendRaw(message: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
}


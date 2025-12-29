/**
 * Message Handlers
 * Process incoming WebSocket messages
 */

import type { WebSocket } from 'ws';
import type { DatabaseService } from '../database';
import type { PubSubService } from './pubsub';
import type { GitHubService } from './github';
import type {
  ClientMessage,
  StatusUpdateMessage,
  PrefsUpdateMessage,
  LoginMessage,
  CreateChannelMessage,
  JoinChannelMessage,
  LeaveChannelMessage,
  ChannelChatMessage,
  SetStatusMessage,
  CustomStatus,
} from '../../shared/types';
import { ACTIVITY_PRIORITY, MAX_CHANNEL_MEMBERS } from '../../shared/types';
import crypto from 'crypto';

export interface ClientData {
  ws: WebSocket;
  username: string;
  githubId?: number;
  avatar?: string;
  status: string;
  activity: string;
  project: string;
  language: string;
  followers: number[];
  following: number[];
  resumeToken?: string;
  customStatus?: CustomStatus;
}

export class MessageHandler {
  private clients: Map<WebSocket, ClientData> = new Map();
  private userSessions: Map<string, Set<WebSocket>> = new Map();

  constructor(
    private db: DatabaseService,
    private pubsub: PubSubService,
    private github: GitHubService
  ) { }

  /**
   * Handle incoming message
   */
  async handleMessage(ws: WebSocket, data: string): Promise<void> {
    let message: ClientMessage;
    try {
      message = JSON.parse(data) as ClientMessage;
    } catch {
      this.sendError(ws, 'Invalid JSON');
      return;
    }

    switch (message.t) {
      case 'login':
        await this.handleLogin(ws, message);
        break;
      case 'statusUpdate':
        await this.handleStatusUpdate(ws, message);
        break;
      case 'prefsUpdate':
        await this.handlePrefsUpdate(ws, message);
        break;
      case 'hb':
        ws.send(JSON.stringify({ t: 'hb' }));
        break;
      // Channel messages (Phase 2)
      case 'cc':
        await this.handleCreateChannel(ws, message);
        break;
      case 'jc':
        await this.handleJoinChannel(ws, message);
        break;
      case 'lc':
        await this.handleLeaveChannel(ws, message);
        break;
      case 'cm':
        await this.handleChannelMessage(ws, message);
        break;
      // Rich Status (Phase 2)
      case 'ss':
        await this.handleSetStatus(ws, message);
        break;
      case 'clr':
        await this.handleClearStatus(ws);
        break;
      default:
        this.sendError(ws, 'Unknown message type');
    }
  }

  /**
   * Handle login message
   */
  private async handleLogin(ws: WebSocket, message: LoginMessage): Promise<void> {
    const { username, token, resumeToken } = message;

    // Check for session resumption
    if (resumeToken) {
      const session = await this.pubsub.getResumeToken(resumeToken);
      if (session && session.username === username) {
        console.log(`[Server] Session resumed: ${username}`);
        await this.setupClient(ws, {
          username,
          githubId: session.githubId,
          isResume: true,
        });
        return;
      }
    }

    // GitHub authentication
    if (token) {
      const ghUser = await this.github.validateToken(token);
      if (!ghUser) {
        ws.send(JSON.stringify({ t: 'loginError', error: 'Invalid GitHub token' }));
        return;
      }

      const { followers, following } = await this.github.getRelationships(token);

      // Upsert user in database
      await this.db.upsertUser(ghUser.id, ghUser.login, ghUser.avatar_url, followers, following);

      await this.setupClient(ws, {
        username: ghUser.login,
        githubId: ghUser.id,
        avatar: ghUser.avatar_url,
        followers,
        following,
        isResume: false,
      });
    } else {
      // Guest login
      const isUnique = await this.db.registerGuest(username);
      if (!isUnique) {
        const existing = this.getClientByUsername(username);
        if (existing) {
          ws.send(JSON.stringify({ t: 'loginError', error: 'Username already taken' }));
          return;
        }
      }

      await this.setupClient(ws, {
        username,
        isResume: false,
      });
    }
  }

  /**
   * Set up client after successful auth
   */
  private async setupClient(
    ws: WebSocket,
    data: {
      username: string;
      githubId?: number;
      avatar?: string;
      followers?: number[];
      following?: number[];
      isResume: boolean;
    }
  ): Promise<void> {
    const { username, githubId, avatar, followers = [], following = [], isResume } = data;

    // Generate resume token
    const newResumeToken = crypto.randomUUID();
    await this.pubsub.setResumeToken(newResumeToken, {
      userId: githubId?.toString() ?? username,
      username,
      githubId,
      connectedAt: Date.now(),
    });

    // Store client data
    const clientData: ClientData = {
      ws,
      username,
      githubId,
      avatar,
      status: 'Online',
      activity: 'Idle',
      project: '',
      language: '',
      followers,
      following,
      resumeToken: newResumeToken,
    };
    this.clients.set(ws, clientData);

    // Track multi-window sessions
    if (!this.userSessions.has(username)) {
      this.userSessions.set(username, new Set());
    }
    this.userSessions.get(username)?.add(ws);

    // Subscribe to friends' presence channels
    if (githubId) {
      const friends = await this.getFriendUsernames(githubId, followers, following);
      await this.pubsub.subscribeToMany(ws, friends, username);
    }

    // Send login success
    ws.send(JSON.stringify({
      t: 'loginSuccess',
      token: newResumeToken,
      githubId,
      followers,
      following,
    }));

    // Send initial sync of online friends
    await this.sendInitialSync(ws, clientData);

    // Publish online event (if not resume)
    if (!isResume) {
      await this.pubsub.publishOnline(username, {
        id: username,
        a: avatar,
        s: 'Online',
        act: 'Idle',
        p: '',
        l: '',
      });
    }

    console.log(`[Server] Client connected: ${username} (${isResume ? 'resumed' : 'new'})`);
  }

  /**
   * Handle status update
   */
  private async handleStatusUpdate(ws: WebSocket, message: StatusUpdateMessage): Promise<void> {
    const client = this.clients.get(ws);
    if (!client) return;

    let changed = false;
    const delta: Record<string, string> = { id: client.username };

    if (message.s && message.s !== client.status) {
      client.status = message.s;
      delta['s'] = message.s;
      changed = true;
    }
    if (message.a && message.a !== client.activity) {
      client.activity = message.a;
      delta['a'] = message.a;
      changed = true;
    }
    if (message.p !== undefined && message.p !== client.project) {
      client.project = message.p;
      delta['p'] = message.p;
      changed = true;
    }
    if (message.l !== undefined && message.l !== client.language) {
      client.language = message.l;
      delta['l'] = message.l;
      changed = true;
    }

    // Publish delta update if anything changed
    if (changed) {
      await this.pubsub.publishDelta(client.username, delta as Omit<import('../../shared/types').DeltaUpdateMessage, 't'>);

      // Update cache
      await this.pubsub.cacheUserStatus(client.username, {
        status: client.status,
        activity: client.activity,
        project: client.project,
        language: client.language,
      });
    }
  }

  /**
   * Handle preferences update
   */
  private async handlePrefsUpdate(ws: WebSocket, message: PrefsUpdateMessage): Promise<void> {
    const client = this.clients.get(ws);
    if (!client?.githubId) return;

    await this.db.updatePreferences(client.githubId, {
      visibility_mode: message.prefs.visibilityMode,
      share_project: message.prefs.shareProjectName,
      share_language: message.prefs.shareLanguage,
      share_activity: message.prefs.shareActivity,
    });

    // If visibility changed, may need to send offline to some users
    if (message.prefs.visibilityMode === 'invisible') {
      await this.pubsub.publishOffline(client.username);
    }
  }

  /**
   * Handle client disconnect
   */
  async handleDisconnect(ws: WebSocket): Promise<void> {
    const client = this.clients.get(ws);
    if (!client) return;

    // Remove from multi-window tracking
    const sessions = this.userSessions.get(client.username);
    sessions?.delete(ws);

    // Only publish offline if this was the last session
    if (!sessions || sessions.size === 0) {
      this.userSessions.delete(client.username);
      await this.pubsub.publishOffline(client.username);

      if (client.githubId) {
        await this.db.updateLastSeen(client.githubId);
      }
    }

    // Cleanup subscriptions
    await this.pubsub.unsubscribeAll(ws);
    this.clients.delete(ws);

    console.log(`[Server] Client disconnected: ${client.username}`);
  }

  /**
   * Send initial sync of online friends
   */
  private async sendInitialSync(ws: WebSocket, client: ClientData): Promise<void> {
    const onlineFriends: Array<{
      id: string;
      a?: string;
      s: string;
      act: string;
      p?: string;
      l?: string;
    }> = [];

    // Get online friends
    for (const [, otherClient] of this.clients) {
      if (otherClient.username === client.username) continue;

      // Check if this client should see the other
      if (this.canClientSee(client, otherClient)) {
        onlineFriends.push({
          id: otherClient.username,
          a: otherClient.avatar,
          s: otherClient.status,
          act: otherClient.activity,
          p: otherClient.project,
          l: otherClient.language,
        });
      }
    }

    ws.send(JSON.stringify({
      t: 'sync',
      users: onlineFriends,
    }));
  }

  /**
   * Check if client can see another client
   */
  private canClientSee(viewer: ClientData, target: ClientData): boolean {
    if (!viewer.githubId || !target.githubId) return false;

    // Mutual: viewer follows target OR target follows viewer
    return viewer.following.includes(target.githubId) ||
      viewer.followers.includes(target.githubId) ||
      target.following.includes(viewer.githubId) ||
      target.followers.includes(viewer.githubId);
  }

  /**
   * Get usernames of friends from GitHub IDs
   */
  private async getFriendUsernames(
    userId: number,
    followers: number[],
    following: number[]
  ): Promise<string[]> {
    const allFriendIds = [...new Set([...followers, ...following])];
    const users = await this.db.getUsersByIds(allFriendIds);
    return users.map(u => u.username);
  }

  /**
   * Get client by username
   */
  private getClientByUsername(username: string): ClientData | undefined {
    for (const [, client] of this.clients) {
      if (client.username === username) return client;
    }
    return undefined;
  }

  /**
   * Get aggregated status for a user (across multiple windows)
   */
  getAggregatedStatus(username: string): ClientData | undefined {
    const sessions = this.userSessions.get(username);
    if (!sessions || sessions.size === 0) return undefined;

    let mostActive: ClientData | undefined;
    let highestPriority = -1;

    for (const ws of sessions) {
      const client = this.clients.get(ws);
      if (!client) continue;

      const priority = ACTIVITY_PRIORITY[client.activity as keyof typeof ACTIVITY_PRIORITY] ?? 0;
      if (priority > highestPriority) {
        highestPriority = priority;
        mostActive = client;
      }
    }

    return mostActive;
  }

  /**
   * Send error to client
   */
  private sendError(ws: WebSocket, error: string): void {
    ws.send(JSON.stringify({ t: 'error', error }));
  }

  /**
   * Get all connected clients (for testing)
   */
  getClients(): Map<WebSocket, ClientData> {
    return this.clients;
  }

  // ==========================================================================
  // Channel Handlers (Phase 2)
  // ==========================================================================

  /**
   * Handle channel creation
   */
  private async handleCreateChannel(ws: WebSocket, message: CreateChannelMessage): Promise<void> {
    const client = this.clients.get(ws);
    if (!client?.githubId) {
      this.sendError(ws, 'Must be logged in with GitHub to create channels');
      return;
    }

    try {
      const channel = await this.db.createChannel(message.name, client.githubId, client.username);

      // Subscribe creator to channel
      await this.pubsub.subscribeToChannel(ws, channel.id, client.username);

      // Send success response
      ws.send(JSON.stringify({
        t: 'ccOk',
        channelId: channel.id,
        name: channel.name,
        inviteCode: channel.invite_code,
      }));

      // Send channel sync with initial member (self)
      ws.send(JSON.stringify({
        t: 'cs',
        channelId: channel.id,
        name: channel.name,
        members: [{
          id: client.username,
          a: client.avatar,
          s: client.status,
          act: client.activity,
          p: client.project,
          l: client.language,
        }],
      }));
    } catch (error) {
      this.sendError(ws, 'Failed to create channel');
    }
  }

  /**
   * Handle joining a channel
   */
  private async handleJoinChannel(ws: WebSocket, message: JoinChannelMessage): Promise<void> {
    const client = this.clients.get(ws);
    if (!client?.githubId) {
      this.sendError(ws, 'Must be logged in with GitHub to join channels');
      return;
    }

    const channel = await this.db.getChannelByInviteCode(message.inviteCode);
    if (!channel) {
      this.sendError(ws, 'Invalid invite code');
      return;
    }

    const added = await this.db.addChannelMember(channel.id, client.githubId, client.username);
    if (!added) {
      this.sendError(ws, 'Channel is full or you are already a member');
      return;
    }

    // Subscribe to channel
    await this.pubsub.subscribeToChannel(ws, channel.id, client.username);

    // Get all members
    const members = await this.db.getChannelMembers(channel.id);
    const memberStatuses = members.map(m => {
      const online = this.getClientByUsername(m.username);
      return {
        id: m.username,
        a: online?.avatar,
        s: online?.status ?? 'Offline',
        act: online?.activity ?? 'Idle',
        p: online?.project ?? '',
        l: online?.language ?? '',
      };
    });

    // Send join success
    ws.send(JSON.stringify({
      t: 'jcOk',
      channelId: channel.id,
      name: channel.name,
    }));

    // Send channel sync
    ws.send(JSON.stringify({
      t: 'cs',
      channelId: channel.id,
      name: channel.name,
      members: memberStatuses,
    }));

    // Notify other channel members
    await this.pubsub.publishToChannel(channel.id, {
      t: 'cj',
      channelId: channel.id,
      member: {
        id: client.username,
        a: client.avatar,
        s: client.status,
        act: client.activity,
        p: client.project,
        l: client.language,
      },
    });
  }

  /**
   * Handle leaving a channel
   */
  private async handleLeaveChannel(ws: WebSocket, message: LeaveChannelMessage): Promise<void> {
    const client = this.clients.get(ws);
    if (!client?.githubId) return;

    await this.db.removeChannelMember(message.channelId, client.githubId);
    await this.pubsub.unsubscribeFromChannel(ws, message.channelId);

    // Notify other members
    await this.pubsub.publishToChannel(message.channelId, {
      t: 'cl',
      channelId: message.channelId,
      id: client.username,
    });
  }

  /**
   * Handle channel chat message
   */
  private async handleChannelMessage(ws: WebSocket, message: ChannelChatMessage): Promise<void> {
    const client = this.clients.get(ws);
    if (!client?.githubId) return;

    const isMember = await this.db.isChannelMember(message.channelId, client.githubId);
    if (!isMember) {
      this.sendError(ws, 'Not a member of this channel');
      return;
    }

    // Broadcast to channel
    await this.pubsub.publishToChannel(message.channelId, {
      t: 'cm',
      channelId: message.channelId,
      id: client.username,
      content: message.content,
      ts: Date.now(),
    });
  }

  // ==========================================================================
  // Rich Status Handlers (Phase 2)
  // ==========================================================================

  /**
   * Handle set custom status
   */
  private async handleSetStatus(ws: WebSocket, message: SetStatusMessage): Promise<void> {
    const client = this.clients.get(ws);
    if (!client) return;

    const customStatus: CustomStatus = {
      text: message.text.slice(0, 128),
      emoji: message.emoji,
      expiresAt: message.expiresIn ? Date.now() + message.expiresIn : undefined,
    };

    client.customStatus = customStatus;

    // Publish delta update with custom status
    await this.pubsub.publishDelta(client.username, {
      id: client.username,
      cs: customStatus,
    });
  }

  /**
   * Handle clear custom status
   */
  private async handleClearStatus(ws: WebSocket): Promise<void> {
    const client = this.clients.get(ws);
    if (!client) return;

    client.customStatus = undefined;

    // Publish delta update with cleared status
    await this.pubsub.publishDelta(client.username, {
      id: client.username,
      cs: null,
    });
  }
}


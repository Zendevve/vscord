/**
 * Channel Handler Service
 * Handles channel-related WebSocket messages
 */

import type { WebSocket } from 'ws';
import type { DatabaseService } from '../database';
import type { PubSubService } from './pubsub';
import type {
  CreateChannelMessage,
  JoinChannelMessage,
  LeaveChannelMessage,
  ChannelChatMessage,
  CompactUser,
} from '../../shared/types';

export interface ClientData {
  ws: WebSocket;
  username: string;
  githubId?: number;
  avatar?: string;
  status: string;
  activity: string;
  project: string;
  language: string;
}

export class ChannelHandler {
  // Track which channels each client is subscribed to
  private clientChannels: Map<WebSocket, Set<string>> = new Map();

  constructor(
    private db: DatabaseService,
    private pubsub: PubSubService,
    private getClient: (ws: WebSocket) => ClientData | undefined,
    private getClientByUsername: (username: string) => ClientData | undefined
  ) { }

  /**
   * Handle create channel request
   */
  async handleCreateChannel(ws: WebSocket, message: CreateChannelMessage): Promise<void> {
    const client = this.getClient(ws);
    if (!client?.githubId) {
      ws.send(JSON.stringify({ t: 'error', error: 'Must be authenticated to create channels' }));
      return;
    }

    // Validate name
    const name = message.name.trim();
    if (name.length < 3 || name.length > 30) {
      ws.send(JSON.stringify({ t: 'error', error: 'Channel name must be 3-30 characters' }));
      return;
    }

    try {
      const channel = await this.db.createChannel(name, client.githubId, client.username);

      // Subscribe creator to channel
      await this.subscribeToChannel(ws, channel.id);

      // Send success response
      ws.send(JSON.stringify({
        t: 'ccOk',
        channelId: channel.id,
        name: channel.name,
        inviteCode: channel.invite_code,
      }));

      console.log(`[Channels] Created channel "${name}" by ${client.username}`);
    } catch (error) {
      console.error('[Channels] Create channel error:', error);
      ws.send(JSON.stringify({ t: 'error', error: 'Failed to create channel' }));
    }
  }

  /**
   * Handle join channel request
   */
  async handleJoinChannel(ws: WebSocket, message: JoinChannelMessage): Promise<void> {
    const client = this.getClient(ws);
    if (!client?.githubId) {
      ws.send(JSON.stringify({ t: 'error', error: 'Must be authenticated to join channels' }));
      return;
    }

    const channel = await this.db.getChannelByInviteCode(message.inviteCode);
    if (!channel) {
      ws.send(JSON.stringify({ t: 'error', error: 'Invalid invite code' }));
      return;
    }

    // Check if already a member
    const isMember = await this.db.isChannelMember(channel.id, client.githubId);
    if (isMember) {
      ws.send(JSON.stringify({ t: 'error', error: 'Already a member of this channel' }));
      return;
    }

    // Add to channel
    const added = await this.db.addChannelMember(channel.id, client.githubId, client.username);
    if (!added) {
      ws.send(JSON.stringify({ t: 'error', error: 'Channel is full (max 50 members)' }));
      return;
    }

    // Subscribe to channel
    await this.subscribeToChannel(ws, channel.id);

    // Send join success
    ws.send(JSON.stringify({
      t: 'jcOk',
      channelId: channel.id,
      name: channel.name,
    }));

    // Send channel sync (member list)
    await this.sendChannelSync(ws, channel.id, channel.name);

    // Notify other members
    const newMember: CompactUser = {
      id: client.username,
      a: client.avatar,
      s: client.status,
      act: client.activity,
      p: client.project,
      l: client.language,
    };
    await this.pubsub.publisher.publish(`channel:${channel.id}`, JSON.stringify({
      t: 'cj',
      channelId: channel.id,
      member: newMember,
    }));

    console.log(`[Channels] ${client.username} joined channel "${channel.name}"`);
  }

  /**
   * Handle leave channel request
   */
  async handleLeaveChannel(ws: WebSocket, message: LeaveChannelMessage): Promise<void> {
    const client = this.getClient(ws);
    if (!client?.githubId) return;

    await this.db.removeChannelMember(message.channelId, client.githubId);

    // Unsubscribe from channel
    await this.unsubscribeFromChannel(ws, message.channelId);

    // Notify other members
    await this.pubsub.publisher.publish(`channel:${message.channelId}`, JSON.stringify({
      t: 'cl',
      channelId: message.channelId,
      id: client.username,
    }));

    console.log(`[Channels] ${client.username} left channel ${message.channelId}`);
  }

  /**
   * Handle channel chat message
   */
  async handleChannelMessage(ws: WebSocket, message: ChannelChatMessage): Promise<void> {
    const client = this.getClient(ws);
    if (!client?.githubId) return;

    // Verify membership
    const isMember = await this.db.isChannelMember(message.channelId, client.githubId);
    if (!isMember) {
      ws.send(JSON.stringify({ t: 'error', error: 'Not a member of this channel' }));
      return;
    }

    // Broadcast message to channel
    const chatMsg: ChannelChatMessage = {
      t: 'cm',
      channelId: message.channelId,
      id: client.username,
      content: message.content,
      ts: Date.now(),
    };

    await this.pubsub.publisher.publish(`channel:${message.channelId}`, JSON.stringify(chatMsg));
  }

  /**
   * Subscribe WebSocket to a channel's Redis pub/sub
   */
  private async subscribeToChannel(ws: WebSocket, channelId: string): Promise<void> {
    if (!this.clientChannels.has(ws)) {
      this.clientChannels.set(ws, new Set());
    }
    this.clientChannels.get(ws)?.add(channelId);

    // PubSub subscription is handled by the main subscriber
    // Here we just track it locally
  }

  /**
   * Unsubscribe WebSocket from a channel
   */
  private async unsubscribeFromChannel(ws: WebSocket, channelId: string): Promise<void> {
    this.clientChannels.get(ws)?.delete(channelId);
  }

  /**
   * Send channel sync (member list) to a client
   */
  async sendChannelSync(ws: WebSocket, channelId: string, channelName: string): Promise<void> {
    const members = await this.db.getChannelMembers(channelId);
    const memberStatuses: CompactUser[] = [];

    for (const member of members) {
      const onlineClient = this.getClientByUsername(member.username);
      if (onlineClient) {
        memberStatuses.push({
          id: member.username,
          a: onlineClient.avatar,
          s: onlineClient.status,
          act: onlineClient.activity,
          p: onlineClient.project,
          l: onlineClient.language,
        });
      } else {
        // Offline member
        memberStatuses.push({
          id: member.username,
          s: 'Offline',
          act: 'Idle',
        });
      }
    }

    ws.send(JSON.stringify({
      t: 'cs',
      channelId,
      name: channelName,
      members: memberStatuses,
    }));
  }

  /**
   * Broadcast status update to all channels a user is in
   */
  async broadcastStatusToChannels(client: ClientData): Promise<void> {
    if (!client.githubId) return;

    const channels = await this.db.getUserChannels(client.githubId);

    for (const channel of channels) {
      await this.pubsub.publisher.publish(`channel:${channel.id}`, JSON.stringify({
        t: 'cu',
        channelId: channel.id,
        id: client.username,
        s: client.status,
        a: client.activity,
        p: client.project,
        l: client.language,
      }));
    }
  }

  /**
   * Load user's channels on connect
   */
  async loadUserChannels(ws: WebSocket, userId: number): Promise<void> {
    const channels = await this.db.getUserChannels(userId);

    for (const channel of channels) {
      await this.subscribeToChannel(ws, channel.id);
      await this.sendChannelSync(ws, channel.id, channel.name);
    }
  }

  /**
   * Cleanup on disconnect
   */
  async handleDisconnect(ws: WebSocket): Promise<void> {
    const channels = this.clientChannels.get(ws);
    if (channels) {
      for (const channelId of channels) {
        await this.unsubscribeFromChannel(ws, channelId);
      }
    }
    this.clientChannels.delete(ws);
  }

  /**
   * Get channels for a WebSocket
   */
  getClientChannels(ws: WebSocket): Set<string> {
    return this.clientChannels.get(ws) ?? new Set();
  }
}

/**
 * Presence Sidebar Provider
 * Displays online friends in VS Code sidebar
 */

import * as vscode from 'vscode';
import type { UserStatus } from '../../shared/types';

export class PresenceProvider implements vscode.TreeDataProvider<PresenceItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PresenceItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private users: UserStatus[] = [];

  /**
   * Update user list
   */
  updateUsers(users: UserStatus[]): void {
    this.users = users;
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get tree item
   */
  getTreeItem(element: PresenceItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get children
   */
  getChildren(element?: PresenceItem): PresenceItem[] {
    if (element) return [];

    // Sort: Online first, then by activity priority
    const sorted = [...this.users].sort((a, b) => {
      const statusOrder = { Online: 0, Away: 1, Offline: 2, Invisible: 3 };
      const aOrder = statusOrder[a.status] ?? 4;
      const bOrder = statusOrder[b.status] ?? 4;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.username.localeCompare(b.username);
    });

    return sorted.map(user => new PresenceItem(user));
  }

  /**
   * Refresh view
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}

/**
 * Tree item for a user
 */
class PresenceItem extends vscode.TreeItem {
  constructor(public readonly user: UserStatus) {
    super(user.username, vscode.TreeItemCollapsibleState.None);

    // Build description
    const parts: string[] = [];
    if (user.activity !== 'Idle' && user.activity !== 'Hidden') {
      parts.push(user.activity);
    }
    if (user.project) {
      parts.push(user.project);
    }
    if (user.language) {
      parts.push(user.language);
    }
    this.description = parts.join(' • ');

    // Icon based on status
    this.iconPath = this.getIcon(user.status, user.activity);

    // Tooltip with full details
    this.tooltip = this.buildTooltip(user);

    // Context value for commands
    this.contextValue = 'user';
  }

  /**
   * Get icon for status
   */
  private getIcon(status: string, activity: string): vscode.ThemeIcon {
    if (status === 'Offline') {
      return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.gray'));
    }
    if (status === 'Away') {
      return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.yellow'));
    }
    if (activity === 'Debugging') {
      return new vscode.ThemeIcon('debug', new vscode.ThemeColor('charts.red'));
    }
    if (activity === 'Coding') {
      return new vscode.ThemeIcon('code', new vscode.ThemeColor('charts.green'));
    }
    return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
  }

  /**
   * Build tooltip
   */
  private buildTooltip(user: UserStatus): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`### ${user.username}\n\n`);
    md.appendMarkdown(`**Status:** ${user.status}\n\n`);
    md.appendMarkdown(`**Activity:** ${user.activity}\n\n`);
    if (user.project) {
      md.appendMarkdown(`**Project:** ${user.project}\n\n`);
    }
    if (user.language) {
      md.appendMarkdown(`**Language:** ${user.language}\n\n`);
    }
    if (user.lastSeen && user.status === 'Offline') {
      const ago = this.timeAgo(user.lastSeen);
      md.appendMarkdown(`**Last seen:** ${ago}\n\n`);
    }
    return md;
  }

  /**
   * Format time ago
   */
  private timeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }
}

/**
 * Connection Status Provider
 */
export class ConnectionProvider implements vscode.TreeDataProvider<ConnectionItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ConnectionItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private connected = false;
  private username: string | null = null;

  /**
   * Update connection status
   */
  updateStatus(connected: boolean, username?: string): void {
    this.connected = connected;
    this.username = username ?? null;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ConnectionItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ConnectionItem[] {
    if (this.connected && this.username) {
      return [
        new ConnectionItem('Connected', `as ${this.username}`, true),
      ];
    }
    return [
      new ConnectionItem('Disconnected', 'Click to connect', false),
    ];
  }
}

class ConnectionItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    connected: boolean
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(
      connected ? 'plug' : 'debug-disconnect',
      new vscode.ThemeColor(connected ? 'charts.green' : 'charts.red')
    );
    if (!connected) {
      this.command = {
        command: 'vscord.connectGitHub',
        title: 'Connect GitHub',
      };
    }
  }
}

// ============================================================================
// Channel Provider (Phase 2)
// ============================================================================

export interface ChannelData {
  id: string;
  name: string;
  members: UserStatus[];
  inviteCode?: string;
}

export class ChannelProvider implements vscode.TreeDataProvider<ChannelTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ChannelTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private channels: Map<string, ChannelData> = new Map();

  /**
   * Add or update a channel
   */
  updateChannel(channel: ChannelData): void {
    this.channels.set(channel.id, channel);
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Update a member's status in a channel
   */
  updateMemberInChannel(channelId: string, username: string, updates: Partial<UserStatus>): void {
    const channel = this.channels.get(channelId);
    if (!channel) return;

    const member = channel.members.find(m => m.username === username);
    if (member) {
      Object.assign(member, updates);
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  /**
   * Add member to channel
   */
  addMemberToChannel(channelId: string, member: UserStatus): void {
    const channel = this.channels.get(channelId);
    if (!channel) return;

    const exists = channel.members.find(m => m.username === member.username);
    if (!exists) {
      channel.members.push(member);
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  /**
   * Remove member from channel
   */
  removeMemberFromChannel(channelId: string, username: string): void {
    const channel = this.channels.get(channelId);
    if (!channel) return;

    channel.members = channel.members.filter(m => m.username !== username);
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Remove a channel
   */
  removeChannel(channelId: string): void {
    this.channels.delete(channelId);
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Get channel by ID
   */
  getChannel(channelId: string): ChannelData | undefined {
    return this.channels.get(channelId);
  }

  getTreeItem(element: ChannelTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ChannelTreeItem): ChannelTreeItem[] {
    if (!element) {
      // Root level: show channels
      if (this.channels.size === 0) {
        return [new NoChannelsItem()];
      }
      return Array.from(this.channels.values()).map(ch => new ChannelItem(ch));
    }

    if (element instanceof ChannelItem) {
      // Channel children: show members
      const sorted = [...element.channel.members].sort((a, b) => {
        const statusOrder = { Online: 0, Away: 1, Offline: 2, Invisible: 3 };
        const aOrder = statusOrder[a.status] ?? 4;
        const bOrder = statusOrder[b.status] ?? 4;
        return aOrder - bOrder;
      });
      return sorted.map(m => new ChannelMemberItem(m, element.channel.id));
    }

    return [];
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}

type ChannelTreeItem = ChannelItem | ChannelMemberItem | NoChannelsItem;

class ChannelItem extends vscode.TreeItem {
  constructor(public readonly channel: ChannelData) {
    super(channel.name, vscode.TreeItemCollapsibleState.Expanded);

    const online = channel.members.filter(m => m.status === 'Online' || m.status === 'Away').length;
    this.description = `${online}/${channel.members.length} online`;
    this.iconPath = new vscode.ThemeIcon('organization', new vscode.ThemeColor('charts.blue'));
    this.contextValue = 'channel';

    // Tooltip with invite code
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`### ${channel.name}\n\n`);
    md.appendMarkdown(`**Members:** ${channel.members.length}\n\n`);
    if (channel.inviteCode) {
      md.appendMarkdown(`**Invite Code:** \`${channel.inviteCode}\`\n\n`);
    }
    this.tooltip = md;
  }
}

class ChannelMemberItem extends vscode.TreeItem {
  constructor(
    public readonly member: UserStatus,
    public readonly channelId: string
  ) {
    super(member.username, vscode.TreeItemCollapsibleState.None);

    const parts: string[] = [];
    if (member.activity !== 'Idle' && member.activity !== 'Hidden') {
      parts.push(member.activity);
    }
    if (member.project) {
      parts.push(member.project);
    }
    this.description = parts.join(' • ');

    // Status icon
    if (member.status === 'Offline') {
      this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.gray'));
    } else if (member.status === 'Away') {
      this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.yellow'));
    } else if (member.activity === 'Debugging') {
      this.iconPath = new vscode.ThemeIcon('debug', new vscode.ThemeColor('charts.red'));
    } else if (member.activity === 'Coding') {
      this.iconPath = new vscode.ThemeIcon('code', new vscode.ThemeColor('charts.green'));
    } else {
      this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
    }

    this.contextValue = 'channelMember';
  }
}

class NoChannelsItem extends vscode.TreeItem {
  constructor() {
    super('No channels yet', vscode.TreeItemCollapsibleState.None);
    this.description = 'Create or join one!';
    this.iconPath = new vscode.ThemeIcon('add');
    this.command = {
      command: 'vscord.createChannel',
      title: 'Create Channel',
    };
  }
}


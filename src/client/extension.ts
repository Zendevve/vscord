/**
 * VSCord Extension Entry Point
 * Real-time coding presence for your GitHub network
 */

import * as vscode from 'vscode';
import { WsClient } from './services/wsClient';
import { ActivityTracker } from './services/activityTracker';
import { AnalyticsService, AnalyticsDashboard } from './services';
import { PresenceProvider, ConnectionProvider, ChannelProvider } from './providers';

let wsClient: WsClient | null = null;
let activityTracker: ActivityTracker | null = null;
let analyticsService: AnalyticsService | null = null;
let analyticsDashboard: AnalyticsDashboard | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('[VSCord] Extension activating...');

  // Create providers
  const presenceProvider = new PresenceProvider();
  const connectionProvider = new ConnectionProvider();
  const channelProvider = new ChannelProvider();

  // Register tree views
  context.subscriptions.push(
    vscode.window.createTreeView('vscord-presence', {
      treeDataProvider: presenceProvider,
      showCollapseAll: false,
    })
  );

  context.subscriptions.push(
    vscode.window.createTreeView('vscord-status', {
      treeDataProvider: connectionProvider,
      showCollapseAll: false,
    })
  );

  context.subscriptions.push(
    vscode.window.createTreeView('vscord-channels', {
      treeDataProvider: channelProvider,
      showCollapseAll: true,
    })
  );

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(pulse) VSCord';
  statusBarItem.tooltip = 'VSCord: Disconnected';
  statusBarItem.command = 'vscord.openSettings';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Get config
  const config = vscode.workspace.getConfiguration('vscord');
  const serverUrl = config.get<string>('serverUrl', 'wss://vscord.example.com');

  // Create WebSocket client
  wsClient = new WsClient({
    serverUrl,
    onUserListUpdate: (users) => {
      presenceProvider.updateUsers(users);
    },
    onConnectionChange: (connected) => {
      connectionProvider.updateStatus(connected, wsClient ? 'user' : undefined);
      updateStatusBar(connected);
    },
    onError: (error) => {
      vscode.window.showErrorMessage(`VSCord: ${error}`);
    },
    // Channel callbacks
    onChannelSync: (channel) => {
      channelProvider.updateChannel(channel);
    },
    onChannelUpdate: (channelId, username, updates) => {
      channelProvider.updateMemberInChannel(channelId, username, updates);
    },
    onChannelMemberJoin: (channelId, member) => {
      channelProvider.addMemberToChannel(channelId, member);
    },
    onChannelMemberLeave: (channelId, username) => {
      channelProvider.removeMemberFromChannel(channelId, username);
    },
    onChannelCreated: (_channelId, name, inviteCode) => {
      vscode.window.showInformationMessage(
        `Channel "${name}" created! Invite code: ${inviteCode}`,
        'Copy Code'
      ).then((action) => {
        if (action === 'Copy Code') {
          vscode.env.clipboard.writeText(inviteCode);
        }
      });
    },
    onChannelJoined: (_channelId, name) => {
      vscode.window.showInformationMessage(`Joined channel "${name}"`);
    },
  });

  // Create activity tracker
  activityTracker = new ActivityTracker((state) => {
    if (wsClient?.connected) {
      wsClient.sendStatusUpdate(state.status, state.activity, state.project, state.language);
    }
    // Also update analytics
    analyticsService?.updateActivity(state.project, state.language);
  });

  // Initialize analytics
  analyticsService = new AnalyticsService(context);
  await analyticsService.initialize();
  analyticsDashboard = new AnalyticsDashboard(analyticsService);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('vscord.connectGitHub', async () => {
      await connectWithGitHub(context, connectionProvider);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscord.continueAsGuest', async () => {
      await connectAsGuest(context, connectionProvider);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscord.disconnect', async () => {
      wsClient?.disconnect();
      connectionProvider.updateStatus(false);
      updateStatusBar(false);
      await context.globalState.update('vscord.username', undefined);
      await context.globalState.update('vscord.token', undefined);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscord.refresh', () => {
      presenceProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscord.openAnalytics', () => {
      analyticsDashboard?.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscord.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'vscord');
    })
  );

  // Channel commands
  context.subscriptions.push(
    vscode.commands.registerCommand('vscord.createChannel', async () => {
      if (!wsClient?.connected) {
        vscode.window.showWarningMessage('Connect to VSCord first');
        return;
      }
      const name = await vscode.window.showInputBox({
        prompt: 'Enter channel name',
        placeHolder: 'My Team',
        validateInput: (v) => {
          if (!v || v.length < 3) return 'Name must be at least 3 characters';
          if (v.length > 30) return 'Name must be at most 30 characters';
          return null;
        },
      });
      if (name) {
        wsClient.createChannel(name);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscord.joinChannel', async () => {
      if (!wsClient?.connected) {
        vscode.window.showWarningMessage('Connect to VSCord first');
        return;
      }
      const code = await vscode.window.showInputBox({
        prompt: 'Enter invite code',
        placeHolder: 'ABC123',
        validateInput: (v) => (!v || v.length !== 6) ? 'Code must be 6 characters' : null,
      });
      if (code) {
        wsClient.joinChannel(code.toUpperCase());
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscord.leaveChannel', async (item?: { channelId?: string }) => {
      if (!wsClient?.connected) return;
      const channelId = item?.channelId;
      if (channelId) {
        wsClient.leaveChannel(channelId);
        channelProvider.removeChannel(channelId);
        vscode.window.showInformationMessage('Left channel');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscord.setStatus', async () => {
      if (!wsClient?.connected) {
        vscode.window.showWarningMessage('Connect to VSCord first');
        return;
      }
      const text = await vscode.window.showInputBox({
        prompt: 'Set your status (max 128 chars)',
        placeHolder: 'In a meeting 📅',
      });
      if (text) {
        // Extract emoji if present at start
        const emojiMatch = text.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*/u);
        const emoji = emojiMatch ? emojiMatch[1] : undefined;
        const statusText = emojiMatch ? text.slice(emojiMatch[0].length) : text;

        const duration = await vscode.window.showQuickPick(
          ['1 hour', '4 hours', '8 hours', '24 hours', 'Never'],
          { placeHolder: 'When should this status expire?' }
        );

        const durationMs: Record<string, number | undefined> = {
          '1 hour': 3600000,
          '4 hours': 14400000,
          '8 hours': 28800000,
          '24 hours': 86400000,
          'Never': undefined,
        };

        wsClient.setCustomStatus(statusText, emoji, durationMs[duration ?? 'Never']);
        vscode.window.showInformationMessage('Status updated!');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscord.clearStatus', () => {
      if (!wsClient?.connected) return;
      wsClient.clearCustomStatus();
      vscode.window.showInformationMessage('Status cleared');
    })
  );

  // Try auto-connect with stored credentials
  const storedUsername = context.globalState.get<string>('vscord.username');
  const storedToken = context.globalState.get<string>('vscord.token');

  if (storedUsername) {
    try {
      await wsClient.connect(storedUsername, storedToken);
      connectionProvider.updateStatus(true, storedUsername);
      updateStatusBar(true, storedUsername);
      activityTracker.start();
    } catch {
      // Silent fail on auto-connect, user can manually connect
    }
  }

  console.log('[VSCord] Extension activated');
}

/**
 * Connect with GitHub OAuth
 */
async function connectWithGitHub(
  context: vscode.ExtensionContext,
  connectionProvider: ConnectionProvider
): Promise<void> {
  try {
    // Get GitHub session
    const session = await vscode.authentication.getSession('github', ['read:user'], {
      createIfNone: true,
    });

    if (!session) {
      vscode.window.showErrorMessage('GitHub authentication cancelled');
      return;
    }

    const username = session.account.label;
    const token = session.accessToken;

    // Store credentials
    await context.globalState.update('vscord.username', username);
    await context.globalState.update('vscord.token', token);

    // Connect
    await wsClient?.connect(username, token);
    connectionProvider.updateStatus(true, username);
    updateStatusBar(true, username);
    activityTracker?.start();

    vscode.window.showInformationMessage(`VSCord: Connected as ${username}`);
  } catch (error) {
    vscode.window.showErrorMessage(`VSCord: Failed to connect - ${error}`);
  }
}

/**
 * Connect as guest
 */
async function connectAsGuest(
  context: vscode.ExtensionContext,
  connectionProvider: ConnectionProvider
): Promise<void> {
  const username = await vscode.window.showInputBox({
    prompt: 'Enter a username',
    placeHolder: 'GuestUser123',
    validateInput: (value) => {
      if (!value) return 'Username required';
      if (value.length < 3) return 'Username must be at least 3 characters';
      if (value.length > 39) return 'Username must be at most 39 characters';
      if (!/^[a-zA-Z0-9_-]+$/.test(value)) return 'Only letters, numbers, _ and - allowed';
      return null;
    },
  });

  if (!username) return;

  try {
    await context.globalState.update('vscord.username', username);
    await context.globalState.update('vscord.token', undefined);

    await wsClient?.connect(username);
    connectionProvider.updateStatus(true, username);
    updateStatusBar(true, `${username} (Guest)`);
    activityTracker?.start();

    vscode.window.showInformationMessage(`VSCord: Connected as ${username} (Guest)`);
  } catch (error) {
    vscode.window.showErrorMessage(`VSCord: Failed to connect - ${error}`);
  }
}

/**
 * Update status bar
 */
function updateStatusBar(connected: boolean, username?: string): void {
  if (!statusBarItem) return;

  if (connected) {
    statusBarItem.text = `$(pulse) ${username ?? 'VSCord'}`;
    statusBarItem.tooltip = `VSCord: Connected as ${username}`;
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = '$(pulse) VSCord';
    statusBarItem.tooltip = 'VSCord: Disconnected';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
}

export function deactivate(): void {
  console.log('[VSCord] Extension deactivating...');
  wsClient?.disconnect();
  activityTracker?.dispose();
}

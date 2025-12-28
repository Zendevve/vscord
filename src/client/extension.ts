/**
 * VSCord Extension Entry Point
 * Real-time coding presence for your GitHub network
 */

import * as vscode from 'vscode';
import { WsClient } from './services/wsClient';
import { ActivityTracker } from './services/activityTracker';
import { PresenceProvider, ConnectionProvider } from './providers';

let wsClient: WsClient | null = null;
let activityTracker: ActivityTracker | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('[VSCord] Extension activating...');

  // Create providers
  const presenceProvider = new PresenceProvider();
  const connectionProvider = new ConnectionProvider();

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
  });

  // Create activity tracker
  activityTracker = new ActivityTracker((state) => {
    if (wsClient?.connected) {
      wsClient.sendStatusUpdate(state.status, state.activity, state.project, state.language);
    }
  });

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
    vscode.commands.registerCommand('vscord.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'vscord');
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

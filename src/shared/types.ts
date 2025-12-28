/**
 * VSCord Shared Types
 * Used by both client and server for type-safe communication
 */

// ============================================================================
// User Status Types
// ============================================================================

export type StatusType = 'Online' | 'Away' | 'Offline' | 'Invisible';
export type ActivityType = 'Coding' | 'Debugging' | 'Reading' | 'Idle' | 'Hidden';
export type VisibilityMode = 'everyone' | 'followers' | 'following' | 'close-friends' | 'invisible';

export interface UserStatus {
  username: string;
  avatar?: string;
  status: StatusType;
  activity: ActivityType;
  project: string;
  language: string;
  lastSeen?: number;
  githubId?: number;
}

export interface UserPreferences {
  visibilityMode: VisibilityMode;
  shareProjectName: boolean;
  shareLanguage: boolean;
  shareActivity: boolean;
}

// ============================================================================
// Protocol Messages (Compact Keys for Bandwidth)
// ============================================================================

/** Message type identifiers */
export type MessageType =
  | 'hb'           // Heartbeat
  | 'token'        // Resume token
  | 'sync'         // Initial full sync
  | 'u'            // Delta update
  | 'o'            // User online
  | 'x'            // User offline
  | 'login'        // Client login
  | 'loginSuccess' // Login successful
  | 'loginError'   // Login failed
  | 'statusUpdate' // Client status update
  | 'prefsUpdate'  // Preferences update
  | 'error';       // General error

/** Base message interface */
export interface BaseMessage {
  t: MessageType;
}

/** Client → Server: Login */
export interface LoginMessage extends BaseMessage {
  t: 'login';
  username: string;
  token?: string;        // GitHub token
  resumeToken?: string;  // Session resume token
}

/** Server → Client: Login Success */
export interface LoginSuccessMessage extends BaseMessage {
  t: 'loginSuccess';
  token: string;         // Resume token for reconnection
  githubId?: number;
  followers?: number[];
  following?: number[];
}

/** Server → Client: Login Error */
export interface LoginErrorMessage extends BaseMessage {
  t: 'loginError';
  error: string;
}

/** Server → Client: Initial Sync */
export interface SyncMessage extends BaseMessage {
  t: 'sync';
  users: CompactUser[];
}

/** Compact user representation for wire transfer */
export interface CompactUser {
  id: string;            // username
  a?: string;            // avatar
  s: string;             // status
  act: string;           // activity
  p?: string;            // project
  l?: string;            // language
  ls?: number;           // lastSeen
}

/** Server → Client: Delta Update */
export interface DeltaUpdateMessage extends BaseMessage {
  t: 'u';
  id: string;            // username
  s?: string;            // status (if changed)
  a?: string;            // activity (if changed)
  p?: string;            // project (if changed)
  l?: string;            // language (if changed)
}

/** Server → Client: User Online */
export interface UserOnlineMessage extends BaseMessage {
  t: 'o';
  id: string;
  a?: string;            // avatar
  s: string;             // status
  act: string;           // activity
  p?: string;            // project
  l?: string;            // language
}

/** Server → Client: User Offline */
export interface UserOfflineMessage extends BaseMessage {
  t: 'x';
  id: string;
  ts: number;            // timestamp
}

/** Client → Server: Status Update */
export interface StatusUpdateMessage extends BaseMessage {
  t: 'statusUpdate';
  s?: StatusType;
  a?: ActivityType;
  p?: string;
  l?: string;
}

/** Client → Server: Preferences Update */
export interface PrefsUpdateMessage extends BaseMessage {
  t: 'prefsUpdate';
  prefs: Partial<UserPreferences>;
}

/** Heartbeat (bidirectional) */
export interface HeartbeatMessage extends BaseMessage {
  t: 'hb';
}

/** Resume Token */
export interface TokenMessage extends BaseMessage {
  t: 'token';
  token: string;
}

/** Error Message */
export interface ErrorMessage extends BaseMessage {
  t: 'error';
  error: string;
  code?: string;
}

// ============================================================================
// Union Types
// ============================================================================

export type ClientMessage =
  | LoginMessage
  | StatusUpdateMessage
  | PrefsUpdateMessage
  | HeartbeatMessage;

export type ServerMessage =
  | LoginSuccessMessage
  | LoginErrorMessage
  | SyncMessage
  | DeltaUpdateMessage
  | UserOnlineMessage
  | UserOfflineMessage
  | TokenMessage
  | HeartbeatMessage
  | ErrorMessage;

// ============================================================================
// Database Types
// ============================================================================

export interface DbUser {
  github_id: number;
  username: string;
  avatar: string;
  followers: number[];
  following: number[];
  close_friends: number[];
  last_seen: number;
  created_at: number;
}

export interface DbPreferences {
  user_id: number;
  visibility_mode: VisibilityMode;
  share_project: boolean;
  share_language: boolean;
  share_activity: boolean;
}

// ============================================================================
// Constants
// ============================================================================

export const ACTIVITY_PRIORITY: Record<ActivityType, number> = {
  Debugging: 4,
  Coding: 3,
  Reading: 2,
  Idle: 1,
  Hidden: 0,
};

export const STATUS_PRIORITY: Record<StatusType, number> = {
  Online: 3,
  Away: 2,
  Invisible: 1,
  Offline: 0,
};

export const AWAY_TIMEOUT_MS = 5 * 60 * 1000;        // 5 minutes
export const SESSION_RESUME_TTL_MS = 60 * 1000;     // 60 seconds
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;     // 30 seconds
export const UPDATE_DEBOUNCE_MS = 2 * 1000;         // 2 seconds

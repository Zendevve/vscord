/**
 * Database Service
 * PostgreSQL connection pool and user operations
 */

import pg from 'pg';
import type { DbUser, DbPreferences, DbChannel, DbChannelMember, VisibilityMode } from '../../shared/types';
import { INVITE_CODE_LENGTH, MAX_CHANNEL_MEMBERS } from '../../shared/types';

const { Pool } = pg;

export class DatabaseService {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  /**
   * Initialize database schema
   */
  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          github_id INTEGER PRIMARY KEY,
          username VARCHAR(255) UNIQUE NOT NULL,
          avatar VARCHAR(500),
          followers INTEGER[] DEFAULT '{}',
          following INTEGER[] DEFAULT '{}',
          close_friends INTEGER[] DEFAULT '{}',
          last_seen BIGINT DEFAULT 0,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
        );

        CREATE TABLE IF NOT EXISTS preferences (
          user_id INTEGER PRIMARY KEY REFERENCES users(github_id),
          visibility_mode VARCHAR(50) DEFAULT 'everyone',
          share_project BOOLEAN DEFAULT true,
          share_language BOOLEAN DEFAULT true,
          share_activity BOOLEAN DEFAULT true
        );

        CREATE TABLE IF NOT EXISTS guest_users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) UNIQUE NOT NULL,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
        );

        -- Channel tables (Phase 2)
        CREATE TABLE IF NOT EXISTS channels (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) NOT NULL,
          owner_id INTEGER REFERENCES users(github_id),
          invite_code VARCHAR(10) UNIQUE NOT NULL,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
        );

        CREATE TABLE IF NOT EXISTS channel_members (
          channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(github_id) ON DELETE CASCADE,
          username VARCHAR(255) NOT NULL,
          role VARCHAR(20) DEFAULT 'member',
          joined_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
          PRIMARY KEY (channel_id, user_id)
        );

        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_users_followers ON users USING GIN(followers);
        CREATE INDEX IF NOT EXISTS idx_users_following ON users USING GIN(following);
        CREATE INDEX IF NOT EXISTS idx_channels_invite ON channels(invite_code);
        CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id);
      `);
      console.log('[DB] Schema initialized');
    } finally {
      client.release();
    }
  }

  /**
   * Get or create user from GitHub data
   */
  async upsertUser(
    githubId: number,
    username: string,
    avatar: string,
    followers: number[],
    following: number[]
  ): Promise<DbUser> {
    const result = await this.pool.query<DbUser>(
      `INSERT INTO users (github_id, username, avatar, followers, following, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (github_id) DO UPDATE SET
         username = EXCLUDED.username,
         avatar = EXCLUDED.avatar,
         followers = EXCLUDED.followers,
         following = EXCLUDED.following,
         last_seen = EXCLUDED.last_seen
       RETURNING *`,
      [githubId, username, avatar, followers, following, Date.now()]
    );
    return result.rows[0] as DbUser;
  }

  /**
   * Get user by GitHub ID
   */
  async getUserById(githubId: number): Promise<DbUser | null> {
    const result = await this.pool.query<DbUser>(
      'SELECT * FROM users WHERE github_id = $1',
      [githubId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username: string): Promise<DbUser | null> {
    const result = await this.pool.query<DbUser>(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Update last seen timestamp
   */
  async updateLastSeen(githubId: number): Promise<void> {
    await this.pool.query(
      'UPDATE users SET last_seen = $1 WHERE github_id = $2',
      [Date.now(), githubId]
    );
  }

  /**
   * Get user preferences
   */
  async getPreferences(userId: number): Promise<DbPreferences | null> {
    const result = await this.pool.query<DbPreferences>(
      'SELECT * FROM preferences WHERE user_id = $1',
      [userId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Update user preferences
   */
  async updatePreferences(
    userId: number,
    prefs: Partial<DbPreferences>
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO preferences (user_id, visibility_mode, share_project, share_language, share_activity)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         visibility_mode = COALESCE($2, preferences.visibility_mode),
         share_project = COALESCE($3, preferences.share_project),
         share_language = COALESCE($4, preferences.share_language),
         share_activity = COALESCE($5, preferences.share_activity)`,
      [
        userId,
        prefs.visibility_mode ?? 'everyone',
        prefs.share_project ?? true,
        prefs.share_language ?? true,
        prefs.share_activity ?? true,
      ]
    );
  }

  /**
   * Add close friend
   */
  async addCloseFriend(userId: number, friendId: number): Promise<void> {
    await this.pool.query(
      `UPDATE users SET close_friends = array_append(close_friends, $2)
       WHERE github_id = $1 AND NOT ($2 = ANY(close_friends))`,
      [userId, friendId]
    );
  }

  /**
   * Remove close friend
   */
  async removeCloseFriend(userId: number, friendId: number): Promise<void> {
    await this.pool.query(
      `UPDATE users SET close_friends = array_remove(close_friends, $2)
       WHERE github_id = $1`,
      [userId, friendId]
    );
  }

  /**
   * Get users by IDs
   */
  async getUsersByIds(githubIds: number[]): Promise<DbUser[]> {
    if (githubIds.length === 0) return [];
    const result = await this.pool.query<DbUser>(
      'SELECT * FROM users WHERE github_id = ANY($1)',
      [githubIds]
    );
    return result.rows;
  }

  /**
   * Check if user can see another user based on visibility settings
   */
  async canUserSee(
    viewerId: number | null,
    targetId: number,
    targetPrefs: DbPreferences | null,
    targetUser: DbUser
  ): Promise<boolean> {
    if (!viewerId) return false;

    const mode: VisibilityMode = targetPrefs?.visibility_mode ?? 'everyone';

    switch (mode) {
      case 'invisible':
        return false;
      case 'everyone':
        return true;
      case 'followers':
        return targetUser.followers?.includes(viewerId) ?? false;
      case 'following':
        return targetUser.following?.includes(viewerId) ?? false;
      case 'close-friends':
        return targetUser.close_friends?.includes(viewerId) ?? false;
      default:
        return false;
    }
  }

  /**
   * Register guest user
   */
  async registerGuest(username: string): Promise<boolean> {
    try {
      await this.pool.query(
        'INSERT INTO guest_users (username) VALUES ($1)',
        [username]
      );
      return true;
    } catch {
      return false; // Username taken
    }
  }

  // ==========================================================================
  // Channel Operations (Phase 2)
  // ==========================================================================

  /**
   * Generate a random invite code
   */
  private generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing chars
    let code = '';
    for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Create a new channel
   */
  async createChannel(name: string, ownerId: number, ownerUsername: string): Promise<DbChannel> {
    const inviteCode = this.generateInviteCode();
    const result = await this.pool.query<DbChannel>(
      `INSERT INTO channels (name, owner_id, invite_code)
       VALUES ($1, $2, $3)
       RETURNING id, name, owner_id, invite_code, created_at`,
      [name, ownerId, inviteCode]
    );
    const channel = result.rows[0] as DbChannel;

    // Add owner as admin member
    await this.addChannelMember(channel.id, ownerId, ownerUsername, 'admin');

    return channel;
  }

  /**
   * Get channel by invite code
   */
  async getChannelByInviteCode(inviteCode: string): Promise<DbChannel | null> {
    const result = await this.pool.query<DbChannel>(
      'SELECT * FROM channels WHERE invite_code = $1',
      [inviteCode.toUpperCase()]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Get channel by ID
   */
  async getChannelById(channelId: string): Promise<DbChannel | null> {
    const result = await this.pool.query<DbChannel>(
      'SELECT * FROM channels WHERE id = $1',
      [channelId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Add member to channel
   */
  async addChannelMember(
    channelId: string,
    userId: number,
    username: string,
    role: 'admin' | 'member' = 'member'
  ): Promise<boolean> {
    // Check member count
    const countResult = await this.pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM channel_members WHERE channel_id = $1',
      [channelId]
    );
    const count = parseInt(countResult.rows[0]?.count ?? '0', 10);

    if (count >= MAX_CHANNEL_MEMBERS) {
      return false; // Channel full
    }

    try {
      await this.pool.query(
        `INSERT INTO channel_members (channel_id, user_id, username, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (channel_id, user_id) DO NOTHING`,
        [channelId, userId, username, role]
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove member from channel
   */
  async removeChannelMember(channelId: string, userId: number): Promise<void> {
    await this.pool.query(
      'DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2',
      [channelId, userId]
    );
  }

  /**
   * Get channel members
   */
  async getChannelMembers(channelId: string): Promise<DbChannelMember[]> {
    const result = await this.pool.query<DbChannelMember>(
      'SELECT * FROM channel_members WHERE channel_id = $1 ORDER BY joined_at',
      [channelId]
    );
    return result.rows;
  }

  /**
   * Get all channels for a user
   */
  async getUserChannels(userId: number): Promise<DbChannel[]> {
    const result = await this.pool.query<DbChannel>(
      `SELECT c.* FROM channels c
       INNER JOIN channel_members cm ON c.id = cm.channel_id
       WHERE cm.user_id = $1
       ORDER BY c.created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Check if user is member of channel
   */
  async isChannelMember(channelId: string, userId: number): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2',
      [channelId, userId]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Delete channel (owner only)
   */
  async deleteChannel(channelId: string, ownerId: number): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM channels WHERE id = $1 AND owner_id = $2',
      [channelId, ownerId]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Database Service Integration Tests
 * Tests user and channel CRUD operations with real PostgreSQL
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestContainers, teardownTestContainers, type TestContainers } from './setup';

describe('DatabaseService', () => {
  let containers: TestContainers;

  beforeAll(async () => {
    containers = await setupTestContainers();
  }, 60000);

  afterAll(async () => {
    await teardownTestContainers(containers);
  }, 30000);

  describe('User Operations', () => {
    it('should upsert and retrieve a user', async () => {
      const user = await containers.db.upsertUser(
        123456,
        'testuser',
        'https://avatar.example.com/test.png',
        [111, 222],
        [333, 444]
      );

      expect(user.github_id).toBe(123456);
      expect(user.username).toBe('testuser');
      expect(user.avatar).toBe('https://avatar.example.com/test.png');
      expect(user.followers).toEqual([111, 222]);
      expect(user.following).toEqual([333, 444]);
    });

    it('should get user by ID', async () => {
      const user = await containers.db.getUserById(123456);
      expect(user).not.toBeNull();
      expect(user?.username).toBe('testuser');
    });

    it('should get user by username', async () => {
      const user = await containers.db.getUserByUsername('testuser');
      expect(user).not.toBeNull();
      expect(user?.github_id).toBe(123456);
    });

    it('should update last seen', async () => {
      const before = await containers.db.getUserById(123456);
      await containers.db.updateLastSeen(123456);
      const after = await containers.db.getUserById(123456);

      expect(after?.last_seen).toBeGreaterThanOrEqual(before?.last_seen ?? 0);
    });

    it('should manage close friends', async () => {
      await containers.db.addCloseFriend(123456, 789);
      let user = await containers.db.getUserById(123456);
      expect(user?.close_friends).toContain(789);

      await containers.db.removeCloseFriend(123456, 789);
      user = await containers.db.getUserById(123456);
      expect(user?.close_friends).not.toContain(789);
    });
  });

  describe('Preferences', () => {
    it('should create and update preferences', async () => {
      await containers.db.updatePreferences(123456, {
        visibility_mode: 'followers',
        share_project: false,
      });

      const prefs = await containers.db.getPreferences(123456);
      expect(prefs?.visibility_mode).toBe('followers');
      expect(prefs?.share_project).toBe(false);
      expect(prefs?.share_language).toBe(true); // default
    });
  });

  describe('Channel Operations', () => {
    let channelId: string;
    let inviteCode: string;

    it('should create a channel', async () => {
      const channel = await containers.db.createChannel('Test Team', 123456, 'testuser');

      expect(channel.name).toBe('Test Team');
      expect(channel.owner_id).toBe(123456);
      expect(channel.invite_code).toHaveLength(6);

      channelId = channel.id;
      inviteCode = channel.invite_code;
    });

    it('should get channel by invite code', async () => {
      const channel = await containers.db.getChannelByInviteCode(inviteCode);
      expect(channel).not.toBeNull();
      expect(channel?.id).toBe(channelId);
    });

    it('should add members (up to limit)', async () => {
      // Create second user
      await containers.db.upsertUser(789, 'member2', '', [], []);

      const added = await containers.db.addChannelMember(channelId, 789, 'member2');
      expect(added).toBe(true);

      const members = await containers.db.getChannelMembers(channelId);
      expect(members.length).toBe(2); // owner + new member
    });

    it('should check membership', async () => {
      const isMember = await containers.db.isChannelMember(channelId, 789);
      expect(isMember).toBe(true);

      const notMember = await containers.db.isChannelMember(channelId, 999);
      expect(notMember).toBe(false);
    });

    it('should list user channels', async () => {
      const channels = await containers.db.getUserChannels(123456);
      expect(channels.length).toBeGreaterThan(0);
      expect(channels[0]?.name).toBe('Test Team');
    });

    it('should remove member', async () => {
      await containers.db.removeChannelMember(channelId, 789);
      const isMember = await containers.db.isChannelMember(channelId, 789);
      expect(isMember).toBe(false);
    });

    it('should delete channel (owner only)', async () => {
      // Non-owner cannot delete
      const failedDelete = await containers.db.deleteChannel(channelId, 999);
      expect(failedDelete).toBe(false);

      // Owner can delete
      const deleted = await containers.db.deleteChannel(channelId, 123456);
      expect(deleted).toBe(true);

      const channel = await containers.db.getChannelById(channelId);
      expect(channel).toBeNull();
    });
  });
});

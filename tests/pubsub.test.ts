/**
 * PubSub Service Integration Tests
 * Tests Redis pub/sub functionality with real Redis
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestContainers, teardownTestContainers, type TestContainers } from './setup';
import WebSocket from 'ws';

describe('PubSubService', () => {
  let containers: TestContainers;

  beforeAll(async () => {
    containers = await setupTestContainers();
  }, 60000);

  afterAll(async () => {
    await teardownTestContainers(containers);
  }, 30000);

  describe('Session Management', () => {
    it('should store and retrieve resume token', async () => {
      const token = 'test-resume-token-123';
      const session = {
        userId: 'alice',
        username: 'alice',
        githubId: 12345,
        connectedAt: Date.now(),
      };

      await containers.pubsub.setResumeToken(token, session);
      const retrieved = await containers.pubsub.getResumeToken(token);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.userId).toBe('alice');
      expect(retrieved?.githubId).toBe(12345);
    });

    it('should delete resume token', async () => {
      const token = 'delete-me-token';
      await containers.pubsub.setResumeToken(token, {
        userId: 'bob',
        username: 'bob',
        connectedAt: Date.now(),
      });

      await containers.pubsub.deleteResumeToken(token);
      const retrieved = await containers.pubsub.getResumeToken(token);
      expect(retrieved).toBeNull();
    });
  });

  describe('Status Caching', () => {
    it('should cache and retrieve user status', async () => {
      await containers.pubsub.cacheUserStatus('testuser', {
        s: 'Online',
        a: 'Coding',
        p: 'vscord',
        l: 'TypeScript',
      });

      const cached = await containers.pubsub.getCachedStatus('testuser');
      expect(cached).not.toBeNull();
      expect(cached?.s).toBe('Online');
      expect(cached?.a).toBe('Coding');
      expect(cached?.p).toBe('vscord');
    });

    it('should return null for non-existent user', async () => {
      const cached = await containers.pubsub.getCachedStatus('nonexistent');
      expect(cached).toBeNull();
    });
  });

  describe('Pub/Sub', () => {
    it('should publish delta updates', async () => {
      // Just test that publish doesn't throw
      await expect(
        containers.pubsub.publishDelta('alice', {
          id: 'alice',
          s: 'Away',
        })
      ).resolves.not.toThrow();
    });

    it('should publish online events', async () => {
      await expect(
        containers.pubsub.publishOnline('bob', {
          id: 'bob',
          s: 'Online',
          act: 'Coding',
        })
      ).resolves.not.toThrow();
    });

    it('should publish offline events', async () => {
      await expect(
        containers.pubsub.publishOffline('charlie')
      ).resolves.not.toThrow();
    });
  });
});

/**
 * Test Setup Utilities
 * Provides Testcontainers setup for PostgreSQL and Redis
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { DatabaseService } from '../src/server/database';
import { PubSubService } from '../src/server/services/pubsub';

export interface TestContainers {
  postgres: StartedPostgreSqlContainer;
  redis: StartedTestContainer;
  db: DatabaseService;
  pubsub: PubSubService;
}

/**
 * Start test containers and initialize services
 */
export async function setupTestContainers(): Promise<TestContainers> {
  // Start PostgreSQL container
  const postgres = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('vscord_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  // Start Redis container
  const redis = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .start();

  // Create services
  const db = new DatabaseService(postgres.getConnectionUri());
  await db.initialize();

  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  const pubsub = new PubSubService(redisUrl);
  await pubsub.initialize();

  return { postgres, redis, db, pubsub };
}

/**
 * Cleanup test containers
 */
export async function teardownTestContainers(containers: TestContainers): Promise<void> {
  await containers.db.close();
  await containers.pubsub.close();
  await containers.postgres.stop();
  await containers.redis.stop();
}

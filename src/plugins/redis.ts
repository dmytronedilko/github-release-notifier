import { Redis } from 'ioredis';

export type { Redis };

export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
}

export async function closeRedisClient(client: Redis): Promise<void> {
  if (client.status === 'ready' || client.status === 'connecting') {
    await client.quit();
  }
}

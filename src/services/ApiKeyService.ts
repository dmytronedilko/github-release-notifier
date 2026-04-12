import crypto from 'node:crypto';

import { eq, sql, and } from 'drizzle-orm';

import type { Db } from '../db/index.js';
import { apiKeys } from '../db/schema.js';

const KEY_BYTE_LENGTH = 32;
const KEY_HINT_LENGTH = 8;

export interface GenerateKeyOptions {
  name: string;
  expiresAt?: Date | null;
  userId: number;
}

export interface ApiKeyInfo {
  id: number;
  name: string;
  keyHint: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  usageCount: number;
}

export class ApiKeyService {
  constructor(private readonly db: Db) {}

  /**
   * Generate a new API key. Returns the raw key (shown once) and stores only the hash.
   */
  async generateKey(options: GenerateKeyOptions): Promise<string> {
    const rawKey = crypto.randomBytes(KEY_BYTE_LENGTH).toString('hex');
    const keyHash = this.hashKey(rawKey);
    const keyHint = rawKey.slice(-KEY_HINT_LENGTH);

    await this.db.insert(apiKeys).values({
      name: options.name,
      keyHash,
      keyHint,
      userId: options.userId,
      expiresAt: options.expiresAt ?? null,
    });

    return rawKey;
  }

  /**
   * Verify an API key. Returns the owner's userId if valid, null otherwise.
   */
  async verifyKey(rawKey: string): Promise<number | null> {
    const keyHash = this.hashKey(rawKey);

    const records = await this.db
      .select({
        userId: apiKeys.userId,
        expiresAt: apiKeys.expiresAt,
        usageCount: apiKeys.usageCount,
        usageQuota: apiKeys.usageQuota,
      })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    const record = records[0];
    if (!record) {
      return null;
    }

    if (record.expiresAt && record.expiresAt < new Date()) {
      return null;
    }

    if (record.usageCount >= record.usageQuota) {
      return null;
    }

    await this.db
      .update(apiKeys)
      .set({
        usageCount: sql`${apiKeys.usageCount} + 1`,
        lastUsedAt: new Date(),
      })
      .where(eq(apiKeys.keyHash, keyHash));

    return record.userId;
  }

  /**
   * List all API keys for a given user. Returns metadata only (no hashes).
   */
  async listKeys(userId: number): Promise<ApiKeyInfo[]> {
    const rows = await this.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyHint: apiKeys.keyHint,
        createdAt: apiKeys.createdAt,
        expiresAt: apiKeys.expiresAt,
        lastUsedAt: apiKeys.lastUsedAt,
        usageCount: apiKeys.usageCount,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId));

    return rows;
  }

  /**
   * Delete an API key by id (only if it belongs to the given user).
   */
  async deleteKey(id: number, userId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .limit(1);

    if (rows.length === 0) {
      return false;
    }

    await this.db.delete(apiKeys).where(eq(apiKeys.id, id));
    return true;
  }

  private hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }
}

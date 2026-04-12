import crypto from 'node:crypto';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Db } from '../db/index.js';
import { ApiKeyService } from '../services/ApiKeyService.js';

function makeMockDb() {
  const selectResult: unknown[] = [];
  const mockSelect = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(selectResult),
  };

  return {
    select: vi.fn().mockReturnValue(mockSelect),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    _mockSelectResult: selectResult,
    _mockSelect: mockSelect,
  };
}

const defaultOpts = { name: 'Test key', userId: 1 };

describe('ApiKeyService', () => {
  let db: ReturnType<typeof makeMockDb>;
  let service: ApiKeyService;

  beforeEach(() => {
    db = makeMockDb();
    service = new ApiKeyService(db as unknown as Db);
  });

  describe('generateKey', () => {
    it('should return a 64-char hex string and call insert', async () => {
      const key = await service.generateKey(defaultOpts);

      expect(key).toMatch(/^[a-f0-9]{64}$/);
      expect(db.insert).toHaveBeenCalled();
    });

    it('should store the SHA-256 hash, not the raw key', async () => {
      const key = await service.generateKey(defaultOpts);
      const expectedHash = crypto.createHash('sha256').update(key).digest('hex');

      const insertCall = db.insert.mock.results[0].value as { values: ReturnType<typeof vi.fn> };
      const valuesArg = insertCall.values.mock.calls[0][0] as { keyHash: string };

      expect(valuesArg.keyHash).toBe(expectedHash);
      expect(valuesArg.keyHash).not.toBe(key);
    });

    it('should store the userId', async () => {
      await service.generateKey({ ...defaultOpts, userId: 42 });

      const insertCall = db.insert.mock.results[0].value as { values: ReturnType<typeof vi.fn> };
      const valuesArg = insertCall.values.mock.calls[0][0] as { userId: number };

      expect(valuesArg.userId).toBe(42);
    });

    it('should store the name', async () => {
      await service.generateKey({ ...defaultOpts, name: 'Production key' });

      const insertCall = db.insert.mock.results[0].value as { values: ReturnType<typeof vi.fn> };
      const valuesArg = insertCall.values.mock.calls[0][0] as { name: string };

      expect(valuesArg.name).toBe('Production key');
    });

    it('should store the last 8 characters of the key as keyHint', async () => {
      const key = await service.generateKey(defaultOpts);

      const insertCall = db.insert.mock.results[0].value as { values: ReturnType<typeof vi.fn> };
      const valuesArg = insertCall.values.mock.calls[0][0] as { keyHint: string };

      expect(valuesArg.keyHint).toBe(key.slice(-8));
      expect(valuesArg.keyHint).toHaveLength(8);
    });

    it('should store the expiration date when provided', async () => {
      const expiresAt = new Date('2026-12-31T23:59:59Z');
      await service.generateKey({ ...defaultOpts, expiresAt });

      const insertCall = db.insert.mock.results[0].value as { values: ReturnType<typeof vi.fn> };
      const valuesArg = insertCall.values.mock.calls[0][0] as { expiresAt: Date };

      expect(valuesArg.expiresAt).toBe(expiresAt);
    });

    it('should store null expiresAt when not provided', async () => {
      await service.generateKey(defaultOpts);

      const insertCall = db.insert.mock.results[0].value as { values: ReturnType<typeof vi.fn> };
      const valuesArg = insertCall.values.mock.calls[0][0] as { expiresAt: null };

      expect(valuesArg.expiresAt).toBeNull();
    });
  });

  describe('verifyKey', () => {
    it('should return null for an unknown key', async () => {
      const result = await service.verifyKey('nonexistent');
      expect(result).toBeNull();
    });

    it('should return userId for a valid key within quota', async () => {
      const rawKey = crypto.randomBytes(32).toString('hex');
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      db._mockSelect.limit.mockResolvedValueOnce([
        {
          id: 1,
          name: 'Test key',
          keyHash,
          keyHint: rawKey.slice(-8),
          usageCount: 5,
          usageQuota: 1000,
          createdAt: new Date(),
          expiresAt: null,
          lastUsedAt: null,
          userId: 1,
        },
      ]);

      const result = await service.verifyKey(rawKey);
      expect(result).toBe(1);
      expect(db.update).toHaveBeenCalled();
    });

    it('should return null when quota is exhausted', async () => {
      const rawKey = crypto.randomBytes(32).toString('hex');
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      db._mockSelect.limit.mockResolvedValueOnce([
        {
          id: 1,
          name: 'Test key',
          keyHash,
          keyHint: rawKey.slice(-8),
          usageCount: 1000,
          usageQuota: 1000,
          createdAt: new Date(),
          expiresAt: null,
          lastUsedAt: null,
          userId: 1,
        },
      ]);

      const result = await service.verifyKey(rawKey);
      expect(result).toBeNull();
    });

    it('should return null when key is expired', async () => {
      const rawKey = crypto.randomBytes(32).toString('hex');
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      db._mockSelect.limit.mockResolvedValueOnce([
        {
          id: 1,
          name: 'Expired key',
          keyHash,
          keyHint: rawKey.slice(-8),
          usageCount: 0,
          usageQuota: 1000,
          createdAt: new Date(),
          expiresAt: new Date('2020-01-01'),
          lastUsedAt: null,
          userId: 1,
        },
      ]);

      const result = await service.verifyKey(rawKey);
      expect(result).toBeNull();
      expect(db.update).not.toHaveBeenCalled();
    });

    it('should return userId for a key with future expiration date', async () => {
      const rawKey = crypto.randomBytes(32).toString('hex');
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      db._mockSelect.limit.mockResolvedValueOnce([
        {
          id: 1,
          name: 'Future key',
          keyHash,
          keyHint: rawKey.slice(-8),
          usageCount: 0,
          usageQuota: 1000,
          createdAt: new Date(),
          expiresAt: new Date('2099-12-31'),
          lastUsedAt: null,
          userId: 1,
        },
      ]);

      const result = await service.verifyKey(rawKey);
      expect(result).toBe(1);
    });
  });

  describe('listKeys', () => {
    it('should call select with the userId filter', async () => {
      db._mockSelect.where.mockResolvedValueOnce([]);

      await service.listKeys(1);

      expect(db.select).toHaveBeenCalled();
    });
  });

  describe('deleteKey', () => {
    it('should return false when key does not exist', async () => {
      db._mockSelect.limit.mockResolvedValueOnce([]);

      const result = await service.deleteKey(999, 1);
      expect(result).toBe(false);
    });

    it('should delete and return true when key belongs to user', async () => {
      db._mockSelect.limit.mockResolvedValueOnce([{ id: 1 }]);

      const result = await service.deleteKey(1, 1);
      expect(result).toBe(true);
      expect(db.delete).toHaveBeenCalled();
    });
  });
});

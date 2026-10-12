import { RateLimiterService, RateLimitPolicy } from './rate-limiter.service';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';

describe('RateLimiterService Unit Tests', () => {
  let service: RateLimiterService;
  let mockConfigService: jest.Mocked<ConfigService>;

  const testPolicy: RateLimitPolicy = {
    keyPrefix: 'rate:test',
    maxAttempts: 3,
    windowSeconds: 60, // 1 minute
  };

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'SESSION_SECRET') return 'test_secret_for_rate_limiter_min_32_chars';
        if (key === 'TRUST_PROXY') return false;
        return defaultValue;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    service = new RateLimiterService(mockConfigService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('extractClientIp', () => {
    it('ignores spoofed X-Forwarded-For header when TRUST_PROXY is false', () => {
      const req = {
        ip: '192.168.1.100',
        headers: {
          'x-forwarded-for': '203.0.113.195, 70.41.3.18',
        },
        socket: { remoteAddress: '192.168.1.100' },
      } as unknown as Request;

      const ip = service.extractClientIp(req);
      expect(ip).toBe('192.168.1.100');
    });

    it('respects X-Forwarded-For header when TRUST_PROXY is configured true', () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'TRUST_PROXY') return true;
        return 'test_secret_for_rate_limiter_min_32_chars';
      });
      const proxyService = new RateLimiterService(mockConfigService);

      const req = {
        ip: '10.0.0.1',
        headers: {
          'x-forwarded-for': '203.0.113.195, 10.0.0.1',
        },
      } as unknown as Request;

      const ip = proxyService.extractClientIp(req);
      expect(ip).toBe('203.0.113.195');
      proxyService.onModuleDestroy();
    });
  });

  describe('hashIdentifier', () => {
    it('returns a deterministic HMAC-SHA256 hex string protecting plain email PII', () => {
      const hash1 = service.hashIdentifier('Customer@Example.com');
      const hash2 = service.hashIdentifier('   customer@example.com   ');

      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(hash2);
      expect(hash1).not.toContain('customer');
    });
  });

  describe('consume', () => {
    it('allows attempts within configured policy limits', () => {
      expect(() => service.consume(testPolicy, 'test-target')).not.toThrow();
      expect(() => service.consume(testPolicy, 'test-target')).not.toThrow();
      expect(() => service.consume(testPolicy, 'test-target')).not.toThrow();
    });

    it('throws HTTP 429 Too Many Requests when limit is exceeded with Retry-After', () => {
      service.consume(testPolicy, 'rate-limited-user');
      service.consume(testPolicy, 'rate-limited-user');
      service.consume(testPolicy, 'rate-limited-user');

      try {
        service.consume(testPolicy, 'rate-limited-user');
        fail('Expected HttpException 429');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const httpErr = err as HttpException;
        expect(httpErr.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        const resp = httpErr.getResponse() as Record<string, unknown>;
        expect(resp['code']).toBe('TOO_MANY_REQUESTS');
        expect(resp['retryAfter']).toBeDefined();
        expect(typeof resp['retryAfter']).toBe('number');
        expect(resp['retryAfter']).toBeGreaterThan(0);
      }
    });

    it('tracks different targets independently', () => {
      service.consume(testPolicy, 'user-A');
      service.consume(testPolicy, 'user-A');
      service.consume(testPolicy, 'user-A');

      // user-B is unaffected
      expect(() => service.consume(testPolicy, 'user-B')).not.toThrow();
    });
  });

  describe('reset', () => {
    it('resets attempt counter upon successful authentication', () => {
      service.consume(testPolicy, 'reset-user');
      service.consume(testPolicy, 'reset-user');

      service.reset(testPolicy, 'reset-user');

      // Can make maxAttempts more requests now without triggering 429
      expect(() => service.consume(testPolicy, 'reset-user')).not.toThrow();
      expect(() => service.consume(testPolicy, 'reset-user')).not.toThrow();
      expect(() => service.consume(testPolicy, 'reset-user')).not.toThrow();
    });
  });

  describe('acquireHashSlot', () => {
    it('allows concurrent slots within bounds and releases them cleanly', async () => {
      const release1 = await service.acquireHashSlot();
      const release2 = await service.acquireHashSlot();

      expect(typeof release1).toBe('function');
      expect(typeof release2).toBe('function');
      expect(service.getActiveHashOperations()).toBe(2);

      release1();
      expect(service.getActiveHashOperations()).toBe(1);
      release2();
      expect(service.getActiveHashOperations()).toBe(0);
    });

    it('queues requests when at capacity and fulfills them on release', async () => {
      service.setCustomMaxConcurrentHashes(1);

      const release1 = await service.acquireHashSlot();
      expect(service.getActiveHashOperations()).toBe(1);

      let slot2Acquired = false;
      const promise2 = service.acquireHashSlot().then((rel) => {
        slot2Acquired = true;
        return rel;
      });

      expect(slot2Acquired).toBe(false);
      expect(service.getHashQueueLength()).toBe(1);

      // Release slot 1 -> slot 2 should be acquired
      release1();
      const release2 = await promise2;
      expect(slot2Acquired).toBe(true);
      expect(service.getHashQueueLength()).toBe(0);
      release2();
    });

    it('immediately rejects with HTTP 429 when queue capacity is exceeded', async () => {
      service.setCustomMaxConcurrentHashes(1);
      service.setCustomMaxQueueLength(1);

      const release1 = await service.acquireHashSlot();

      // Queue 1 item (reaches queue max of 1)
      const promise2 = service.acquireHashSlot();
      expect(service.getHashQueueLength()).toBe(1);

      // 3rd item exceeds queue capacity -> immediate rejection
      await expect(service.acquireHashSlot()).rejects.toThrow(HttpException);

      release1();
      const release2 = await promise2;
      release2();
    });

    it('rejects with HTTP 429 when queued request times out', async () => {
      service.setCustomMaxConcurrentHashes(1);
      service.setCustomMaxQueueLength(5);
      service.setCustomMaxQueueWaitMs(50); // 50ms timeout for test

      const release1 = await service.acquireHashSlot();

      // Queue item that will time out because slot 1 is held
      const queuedPromise = service.acquireHashSlot();

      await expect(queuedPromise).rejects.toThrow(HttpException);
      release1();
    });

    it('ensures slots are released when operations throw in try/finally blocks', async () => {
      expect(service.getActiveHashOperations()).toBe(0);

      const release = await service.acquireHashSlot();
      expect(service.getActiveHashOperations()).toBe(1);

      try {
        throw new Error('Hashing computation failed');
      } catch {
        // catch error
      } finally {
        release();
      }

      expect(service.getActiveHashOperations()).toBe(0);
    });
  });

  describe('getPolicy and customLimits', () => {
    it('returns policy configuration and respects custom threshold overrides', () => {
      const policy = service.getPolicy('REGISTRATION_IP');
      expect(policy.keyPrefix).toBe('rate:reg:ip');
      expect(policy.windowSeconds).toBe(900);

      service.setCustomLimit('REGISTRATION_IP', 2);
      expect(service.getPolicy('REGISTRATION_IP').maxAttempts).toBe(2);

      service.resetCustomLimits();
      expect(service.getPolicy('REGISTRATION_IP').maxAttempts).not.toBe(2);
    });
  });

  describe('Gate C: storage saturation & eviction protection under churn', () => {
    it('safely rejects new identifiers with 429 when maxRecords is saturated with active records', () => {
      service.setMaxRecordsForTesting(3);

      // Fill store with 3 active records
      service.consume(testPolicy, 'key-1');
      service.consume(testPolicy, 'key-2');
      service.consume(testPolicy, 'key-3');

      // Attempt to add a 4th key when all 3 records are active
      try {
        service.consume(testPolicy, 'key-4');
        fail('Expected 429 HttpException due to storage capacity reached');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const httpErr = err as HttpException;
        expect(httpErr.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        const resp = httpErr.getResponse() as Record<string, unknown>;
        expect(resp['code']).toBe('TOO_MANY_REQUESTS');
        expect(resp['retryAfter']).toBe(5);
      }

      // INVARIANT: Key-1, Key-2, and Key-3 are NOT evicted under churn and remain actively tracked
      expect(() => service.consume(testPolicy, 'key-1')).not.toThrow();
      expect(() => service.consume(testPolicy, 'key-2')).not.toThrow();
      expect(() => service.consume(testPolicy, 'key-3')).not.toThrow();
    });

    it('permits new keys after expired records are pruned', () => {
      service.setMaxRecordsForTesting(2);

      const expiredPolicy: RateLimitPolicy = {
        keyPrefix: 'rate:expired',
        maxAttempts: 5,
        windowSeconds: -10, // instantly expired
      };

      service.consume(expiredPolicy, 'expired-key-1');
      service.consume(expiredPolicy, 'expired-key-2');

      // Consuming a new key triggers pruning, freeing capacity
      expect(() => service.consume(testPolicy, 'fresh-key')).not.toThrow();
    });
  });
});

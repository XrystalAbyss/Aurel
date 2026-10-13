import { Injectable, HttpException, HttpStatus, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, hkdfSync } from 'crypto';
import { isIP } from 'net';
import { Request } from 'express';
import { ErrorCode } from '@aurel/shared-types';

export interface RateLimitPolicy {
  keyPrefix: string;
  maxAttempts: number;
  windowSeconds: number;
}

export type RateLimitPolicyType =
  | 'REGISTRATION_IP'
  | 'REGISTRATION_EMAIL'
  | 'LOGIN_IP'
  | 'LOGIN_ACCOUNT'
  | 'SETUP_IP'
  | 'SETUP_TOKEN';

interface RateLimitRecord {
  count: number;
  resetAt: number; // Unix timestamp in ms
}

@Injectable()
export class RateLimiterService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly records = new Map<string, RateLimitRecord>();
  private readonly cleanupInterval: NodeJS.Timeout;
  private readonly derivedEmailKey: Buffer;
  private readonly trustProxy: boolean;
  private readonly customLimits = new Map<RateLimitPolicyType, number>();

  // Maximum stored rate-limit records to prevent memory exhaustion
  private maxRecords = 10000;

  // Concurrency limiter for expensive Argon2id hashing operations
  private activeHashOperations = 0;
  private maxConcurrentHashes = 10;
  private maxQueueLength = 20;
  private maxQueueWaitMs = 5000;
  private readonly hashQueue: Array<() => void> = [];

  constructor(private readonly configService: ConfigService) {
    const rawSecret = this.configService.get<string>(
      'SESSION_SECRET',
      'default_insecure_development_secret_32_chars',
    );

    // Cryptographic domain separation: derive dedicated rate-limiting HMAC key via HKDF
    this.derivedEmailKey = Buffer.from(
      hkdfSync('sha256', rawSecret, '', 'aurel:rate-limit-email:v1', 32),
    );

    this.trustProxy = this.configService.get<boolean>('TRUST_PROXY', false);

    // Prune expired records every 60 seconds to prevent unbounded memory growth
    this.cleanupInterval = setInterval(() => this.pruneExpiredRecords(), 60 * 1000);
    this.cleanupInterval.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupInterval);
  }

  /**
   * Retrieves active policy for the specified rate limit category.
   * Defaults to strict production settings in development/production, with higher
   * headroom in test environments to allow high-concurrency test suites without false positives.
   */
  getPolicy(type: RateLimitPolicyType): RateLimitPolicy {
    const isTest = this.configService.get<string>('NODE_ENV') === 'test';
    const custom = this.customLimits.get(type);

    switch (type) {
      case 'REGISTRATION_IP':
        return {
          keyPrefix: 'rate:reg:ip',
          maxAttempts: custom ?? (isTest ? 100 : 5),
          windowSeconds: 15 * 60, // 15 minutes
        };
      case 'REGISTRATION_EMAIL':
        return {
          keyPrefix: 'rate:reg:email',
          maxAttempts: custom ?? (isTest ? 50 : 3),
          windowSeconds: 60 * 60, // 1 hour
        };
      case 'LOGIN_IP':
        return {
          keyPrefix: 'rate:login:ip',
          maxAttempts: custom ?? (isTest ? 100 : 10),
          windowSeconds: 15 * 60, // 15 minutes
        };
      case 'LOGIN_ACCOUNT':
        return {
          keyPrefix: 'rate:login:account',
          maxAttempts: custom ?? (isTest ? 50 : 5),
          windowSeconds: 15 * 60, // 15 minutes
        };
      case 'SETUP_IP':
        return {
          keyPrefix: 'rate:setup:ip',
          maxAttempts: custom ?? (isTest ? 100 : 10),
          windowSeconds: 15 * 60, // 15 minutes
        };
      case 'SETUP_TOKEN':
        return {
          keyPrefix: 'rate:setup:token',
          maxAttempts: custom ?? (isTest ? 50 : 5),
          windowSeconds: 15 * 60, // 15 minutes
        };
    }
  }

  /**
   * Allows test fixtures to set explicit threshold overrides.
   */
  setCustomLimit(type: RateLimitPolicyType, maxAttempts: number): void {
    this.customLimits.set(type, maxAttempts);
  }

  /**
   * Clears custom threshold overrides.
   */
  resetCustomLimits(): void {
    this.customLimits.clear();
  }

  /**
   * Clears all in-memory rate-limit attempt counters (useful for isolated test execution).
   */
  clearAll(): void {
    this.records.clear();
  }

  /**
   * Overrides maximum store capacity for isolated unit test verification.
   */
  setMaxRecordsForTesting(count: number): void {
    this.maxRecords = count;
  }

  /**
   * Returns whether reverse proxy trust is enabled in configuration.
   */
  isTrustProxyEnabled(): boolean {
    return this.trustProxy;
  }

  /**
   * Securely extracts and validates the client IP address from the HTTP request.
   *
   * Security Invariants:
   * 1. Relies authoritatively on Express's `req.ip`, which evaluates the request
   *    in accordance with the configured `trust proxy` boundary (disabled by default).
   * 2. NEVER parses client-supplied `X-Forwarded-For` headers manually, preventing attackers
   *    from spoofing their rate-limiting identity by injecting arbitrary leftmost IPs.
   * 3. Validates that the resolved IP address is a syntactically valid IPv4 or IPv6 address.
   * 4. Normalizes IPv4-mapped IPv6 addresses (e.g., '::ffff:192.0.2.1' -> '192.0.2.1').
   * 5. Falls back safely to socket remote address or '127.0.0.1' if `req.ip` is undefined or malformed.
   * 6. Strictly ensures rate-limit keys are bounded, sanitized, and cannot contain arbitrary strings.
   */
  extractClientIp(req: Request): string {
    let candidate = req.ip || req.socket?.remoteAddress;

    if (!candidate || typeof candidate !== 'string') {
      return '127.0.0.1';
    }

    candidate = candidate.trim();

    // Normalize IPv4-mapped IPv6 addresses (e.g., '::ffff:192.0.2.1' -> '192.0.2.1')
    if (candidate.startsWith('::ffff:')) {
      const ipv4Part = candidate.substring(7);
      if (isIP(ipv4Part) === 4) {
        candidate = ipv4Part;
      }
    }

    // Validate that candidate is a valid IPv4 (4) or IPv6 (6) address
    if (isIP(candidate) !== 0) {
      return candidate;
    }

    // If candidate fails IP syntax validation, fallback safely to socket address if valid
    const socketAddress = req.socket?.remoteAddress?.trim();
    if (socketAddress) {
      const normalizedSocket = socketAddress.startsWith('::ffff:')
        ? socketAddress.substring(7)
        : socketAddress;
      if (isIP(normalizedSocket) !== 0) {
        return normalizedSocket;
      }
    }

    return '127.0.0.1';
  }

  /**
   * Hashes canonical email using domain-separated HMAC-SHA256 to avoid storing plaintext personal identifiers in memory.
   */
  hashIdentifier(identifier: string): string {
    return createHmac('sha256', this.derivedEmailKey)
      .update(identifier.trim().toLowerCase())
      .digest('hex');
  }

  /**
   * Consumes an attempt under the specified policy.
   * If limit is exceeded, throws RFC 7807 HttpException (HTTP 429) with Retry-After header.
   */
  consume(policy: RateLimitPolicy, targetKey: string): void {
    const key = `${policy.keyPrefix}:${targetKey}`;
    const now = Date.now();
    const existing = this.records.get(key);

    if (!existing || existing.resetAt <= now) {
      // Memory bound check: enforce maxRecords cap without evicting active throttled records.
      // If store is at capacity after pruning expired records, reject the new key with HTTP 429
      // to ensure an adversary generating rotating identifiers cannot churn and evict active throttles.
      if (!existing && this.records.size >= this.maxRecords) {
        this.pruneExpiredRecords();
        if (this.records.size >= this.maxRecords) {
          this.logger.warn(
            `Rate limiter storage saturation reached (${this.records.size}/${this.maxRecords}). Rejecting new key to protect active throttles.`,
          );
          throw new HttpException(
            {
              message: 'Authentication service capacity reached. Please try again later.',
              code: ErrorCode.TOO_MANY_REQUESTS,
              error: 'Too Many Requests',
              retryAfter: 5,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }

      this.records.set(key, {
        count: 1,
        resetAt: now + policy.windowSeconds * 1000,
      });
      return;
    }

    if (existing.count >= policy.maxAttempts) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      this.logger.warn(
        `Rate limit exceeded for key prefix ${policy.keyPrefix}. Retry-After: ${retryAfterSeconds}s`,
      );

      throw new HttpException(
        {
          message: 'Too many requests. Please try again later.',
          code: ErrorCode.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          retryAfter: retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    existing.count += 1;
  }

  /**
   * Resets rate-limit counter on success (e.g. successful login resets failed-attempt account counter).
   */
  reset(policy: RateLimitPolicy, targetKey: string): void {
    const key = `${policy.keyPrefix}:${targetKey}`;
    this.records.delete(key);
  }

  /**
   * Concurrency gate for expensive Argon2id operations to protect CPU and memory from DoS exhaustion.
   * Bounded by both active concurrency and maximum queue capacity.
   */
  async acquireHashSlot(): Promise<() => void> {
    if (this.activeHashOperations < this.maxConcurrentHashes) {
      this.activeHashOperations++;
      return () => this.releaseHashSlot();
    }

    if (this.hashQueue.length >= this.maxQueueLength) {
      this.logger.warn(
        `Argon2id hashing capacity exceeded (active: ${this.activeHashOperations}, queue: ${this.hashQueue.length}). Controlled rejection.`,
      );
      throw new HttpException(
        {
          message: 'Authentication service is busy. Please try again later.',
          code: ErrorCode.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          retryAfter: 2,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return new Promise<() => void>((resolve, reject) => {
      let timeoutTimer: NodeJS.Timeout | null = null;

      const callback = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        this.activeHashOperations++;
        resolve(() => this.releaseHashSlot());
      };

      timeoutTimer = setTimeout(() => {
        const index = this.hashQueue.indexOf(callback);
        if (index !== -1) {
          this.hashQueue.splice(index, 1);
        }
        reject(
          new HttpException(
            {
              message: 'Authentication service request timed out. Please try again later.',
              code: ErrorCode.TOO_MANY_REQUESTS,
              error: 'Too Many Requests',
              retryAfter: 2,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          ),
        );
      }, this.maxQueueWaitMs);
      timeoutTimer.unref();

      this.hashQueue.push(callback);
    });
  }

  private releaseHashSlot(): void {
    this.activeHashOperations--;
    if (this.hashQueue.length > 0 && this.activeHashOperations < this.maxConcurrentHashes) {
      const next = this.hashQueue.shift();
      if (next) next();
    }
  }

  private pruneExpiredRecords(): void {
    const now = Date.now();
    for (const [key, record] of this.records.entries()) {
      if (record.resetAt <= now) {
        this.records.delete(key);
      }
    }
  }

  // --- Test & Inspection Helpers ---
  setCustomMaxConcurrentHashes(max: number): void {
    this.maxConcurrentHashes = max;
  }

  setCustomMaxQueueLength(max: number): void {
    this.maxQueueLength = max;
  }

  setCustomMaxQueueWaitMs(ms: number): void {
    this.maxQueueWaitMs = ms;
  }

  getActiveHashOperations(): number {
    return this.activeHashOperations;
  }

  getHashQueueLength(): number {
    return this.hashQueue.length;
  }

  getStoredRecordCount(): number {
    return this.records.size;
  }
}

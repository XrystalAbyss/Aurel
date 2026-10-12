import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHmac, hkdfSync } from 'crypto';
import { AuthSession, User } from '@prisma/client';
import { ErrorCode } from '@aurel/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_TTL_MS } from './cookie.config';

export interface ValidatedSession {
  session: AuthSession;
  user: User;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly derivedSessionKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const rawSecret = this.configService.get<string>(
      'SESSION_SECRET',
      'default_insecure_development_secret_32_chars',
    );

    // Cryptographic domain separation: derive dedicated session digest key via HKDF
    this.derivedSessionKey = Buffer.from(
      hkdfSync('sha256', rawSecret, '', 'aurel:session-digest:v1', 32),
    );
  }

  /**
   * Generates a cryptographically secure random bearer token (256 bits / 32 bytes).
   * Encoded as 64-character lowercase hexadecimal string.
   */
  generateOpaqueToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Computes a one-way HMAC-SHA256 digest of the opaque token using the domain-separated key.
   * Storing only this digest in PostgreSQL ensures raw tokens cannot be recovered or
   * verified in offline database breach scenarios without the application secret.
   */
  computeTokenDigest(rawToken: string): string {
    return createHmac('sha256', this.derivedSessionKey).update(rawToken).digest('hex');
  }

  /**
   * Establishes and persists a new authenticated server-side session.
   * Atomically verifies that the account exists and remains active before persistence
   * using an exclusive PostgreSQL row lock (FOR UPDATE) inside an interactive transaction.
   *
   * @param userId Primary key of the authenticated User entity
   * @param userAgent Optional coarse user agent header (truncated for data minimization)
   * @returns Object containing the created AuthSession database record and the raw bearer token
   */
  async createSession(
    userId: string,
    userAgent?: string | null,
  ): Promise<{ session: AuthSession; rawToken: string }> {
    const rawToken = this.generateOpaqueToken();
    const tokenDigest = this.computeTokenDigest(rawToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    // Data minimization: truncate user agent to 500 chars, no raw IP history retention
    const sanitizedUserAgent = userAgent ? userAgent.substring(0, 500) : null;

    const session = await this.prisma.$transaction(async (tx) => {
      // Row lock FOR UPDATE strictly serializes against concurrent account deactivation transactions
      const userRows = await tx.$queryRaw<Array<{ id: string; is_active: boolean }>>`
        SELECT id, is_active FROM users WHERE id = ${userId}::uuid FOR UPDATE
      `;

      if (!userRows || userRows.length === 0 || !userRows[0].is_active) {
        throw new UnauthorizedException({
          message: 'Account is deactivated or not found.',
          code: ErrorCode.UNAUTHORIZED,
          error: 'Unauthorized',
        });
      }

      return tx.authSession.create({
        data: {
          userId,
          tokenDigest,
          createdAt: now,
          expiresAt,
          lastSeenAt: now,
          userAgent: sanitizedUserAgent,
        },
      });
    });

    this.logger.log(
      `Session created successfully for user ID: ${userId} (session ID: ${session.id})`,
    );

    return { session, rawToken };
  }

  /**
   * Authoritatively validates a bearer session token against PostgreSQL:
   * 1. Recomputes HMAC-SHA256 digest.
   * 2. Finds the session and attached user record.
   * 3. Verifies revocation status (revokedAt must be null).
   * 4. Verifies expiration (expiresAt must be in the future).
   * 5. Verifies account status (user.isActive must be true; revokes session if inactive).
   * 6. Asynchronously updates lastSeenAt bounded to once every 5 minutes.
   */
  async validateSession(rawToken: string): Promise<ValidatedSession | null> {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.length !== 64) {
      return null;
    }

    const tokenDigest = this.computeTokenDigest(rawToken);

    const session = await this.prisma.authSession.findUnique({
      where: { tokenDigest },
      include: { user: true },
    });

    if (!session) {
      return null;
    }

    // Authoritative revocation check
    if (session.revokedAt !== null) {
      return null;
    }

    const now = new Date();

    // Authoritative absolute expiration check
    if (session.expiresAt <= now) {
      return null;
    }

    // Authoritative user activation check: if account is inactive, immediately revoke session
    if (!session.user || !session.user.isActive) {
      await this.prisma.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now },
      });
      return null;
    }

    // Bounded activity touch (throttle database writes: maximum once every 5 minutes)
    const FIVE_MINUTES_MS = 5 * 60 * 1000;
    if (!session.lastSeenAt || now.getTime() - session.lastSeenAt.getTime() > FIVE_MINUTES_MS) {
      try {
        const updatePromise = this.prisma.authSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { lastSeenAt: now },
        });
        if (updatePromise && typeof updatePromise.catch === 'function') {
          updatePromise.catch((err) => {
            this.logger.warn(`Non-blocking lastSeenAt update failed: ${(err as Error).message}`);
          });
        }
      } catch {
        // Defensive error suppression
      }
    }

    return { session, user: session.user };
  }

  /**
   * Revokes a single session server-side by setting revokedAt timestamp.
   * Safe to call repeatedly (idempotent).
   */
  async revokeSession(rawToken: string): Promise<boolean> {
    if (!rawToken || typeof rawToken !== 'string') {
      return false;
    }

    const tokenDigest = this.computeTokenDigest(rawToken);
    const now = new Date();

    const result = await this.prisma.authSession.updateMany({
      where: {
        tokenDigest,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    return result.count > 0;
  }

  /**
   * Revokes all active sessions for a specific user ID across all browsers/devices.
   * Safe to call concurrently.
   */
  async revokeAllUserSessions(userId: string): Promise<number> {
    const now = new Date();

    const result = await this.prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    this.logger.log(`Revoked ${result.count} active sessions for user ID: ${userId}`);
    return result.count;
  }

  /**
   * Maintenance routine: prunes expired or long-revoked sessions from PostgreSQL.
   * Expired sessions are rejected regardless of whether this cleanup runs.
   */
  async cleanupExpiredSessions(): Promise<number> {
    const now = new Date();

    const result = await this.prisma.authSession.deleteMany({
      where: {
        expiresAt: { lt: now },
      },
    });

    this.logger.log(`Cleaned up ${result.count} expired sessions`);
    return result.count;
  }
}

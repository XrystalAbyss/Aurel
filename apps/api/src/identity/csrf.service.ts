import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHmac, timingSafeEqual, hkdfSync } from 'crypto';

@Injectable()
export class CsrfService {
  private readonly logger = new Logger(CsrfService.name);
  private readonly derivedCsrfKey: Buffer;
  private readonly allowedOrigins: Set<string>;

  constructor(private readonly configService: ConfigService) {
    const rawSecret = this.configService.get<string>(
      'CSRF_SECRET',
      'default_insecure_csrf_secret_min_32_chars',
    );

    // Cryptographic domain separation: derive dedicated CSRF HMAC key via HKDF
    this.derivedCsrfKey = Buffer.from(hkdfSync('sha256', rawSecret, '', 'aurel:csrf-token:v1', 32));

    const originsConfig = this.configService.get<string>('CORS_ALLOWED_ORIGINS', '');
    const parsedOrigins = originsConfig
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
      .map((o) => {
        try {
          return new URL(o).origin;
        } catch {
          return o;
        }
      });
    this.allowedOrigins = new Set(parsedOrigins);
  }

  /**
   * Generates a cryptographically signed anti-CSRF token bound to a specific session ID.
   * Format: <sessionId>.<randomNonce>.<hmacSignature>
   */
  generateToken(sessionId: string): string {
    const nonce = randomBytes(16).toString('hex');
    const payload = `${sessionId}.${nonce}`;
    const signature = createHmac('sha256', this.derivedCsrfKey).update(payload).digest('hex');
    return `${payload}.${signature}`;
  }

  /**
   * Generates an unauthenticated visitor CSRF token for pre-login / pre-registration protection.
   * Format: anonymous.<randomNonce>.<hmacSignature>
   */
  generateAnonymousToken(): string {
    return this.generateToken('anonymous');
  }

  /**
   * Validates a double-submit CSRF token against an active session ID using constant-time comparison.
   *
   * @param token CSRF token from X-CSRF-Token header or cookie
   * @param expectedSessionId Active session ID that must match the token's bound scope
   */
  validateToken(token: string | undefined, expectedSessionId: string): boolean {
    if (!token || typeof token !== 'string') {
      return false;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      return false;
    }

    const [tokenSessionId, nonce, signature] = parts;

    // Reject malformed components (nonce must be 32 hex chars, signature 64 hex chars)
    if (!/^[0-9a-f]{32}$/i.test(nonce) || !/^[0-9a-f]{64}$/i.test(signature)) {
      return false;
    }

    // Scope check: token must match the expected session ID
    if (tokenSessionId !== expectedSessionId) {
      return false;
    }

    const payload = `${tokenSessionId}.${nonce}`;
    const expectedSignature = createHmac('sha256', this.derivedCsrfKey)
      .update(payload)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(signatureBuffer, expectedBuffer);
  }

  /**
   * Validates request Origin and Referer headers against the whitelisted CORS origins.
   * Implements Layer 1 of the multi-layer CSRF defense model.
   *
   * Invariants:
   * 1. 'null' origins (sandboxed iframes, file://, privacy bouncers) are rejected.
   * 2. Malformed origin syntax is rejected.
   * 3. Suffix / prefix matches or unexpected ports are rejected via exact URL origin comparison.
   * 4. When both Origin and Referer are provided, both must be trusted and agree.
   * 5. Comma-separated, duplicate, or array Origin/Referer headers are rejected.
   */
  validateOrigin(originHeader?: string | string[], refererHeader?: string | string[]): boolean {
    // Disallow duplicate / array headers
    if (Array.isArray(originHeader) || Array.isArray(refererHeader)) {
      return false;
    }

    // Explicitly reject literal "null" origin or comma-separated lists
    if (originHeader) {
      if (
        typeof originHeader !== 'string' ||
        originHeader.includes(',') ||
        originHeader === 'null'
      ) {
        return false;
      }
    }

    if (refererHeader) {
      if (typeof refererHeader !== 'string' || refererHeader.includes(',')) {
        return false;
      }
    }

    let parsedOrigin: string | null = null;
    let parsedRefererOrigin: string | null = null;

    if (originHeader) {
      try {
        const url = new URL(originHeader);
        if (url.origin === 'null') {
          return false;
        }
        parsedOrigin = url.origin;
        if (!this.allowedOrigins.has(parsedOrigin)) {
          return false;
        }
      } catch {
        return false;
      }
    }

    if (refererHeader) {
      try {
        const url = new URL(refererHeader);
        if (url.origin === 'null') {
          return false;
        }
        parsedRefererOrigin = url.origin;
        if (!this.allowedOrigins.has(parsedRefererOrigin)) {
          return false;
        }
      } catch {
        return false;
      }
    }

    // If both headers are provided, they must agree
    if (parsedOrigin && parsedRefererOrigin && parsedOrigin !== parsedRefererOrigin) {
      return false;
    }

    return true;
  }
}

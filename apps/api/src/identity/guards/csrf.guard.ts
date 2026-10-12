import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { ErrorCode } from '@aurel/shared-types';
import { CsrfService } from '../csrf.service';
import { AuthSession } from '@prisma/client';
import { getCsrfCookieName, CSRF_COOKIE_NAME_DEV, CSRF_COOKIE_NAME_PROD } from '../cookie.config';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly csrfService: CsrfService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();

    // Idempotent read methods are exempt from CSRF validation
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    // Layer 1: Origin & Referer Whitelist Verification
    const origin = request.headers['origin'] as string | undefined;
    const referer = request.headers['referer'] as string | undefined;

    if (!this.csrfService.validateOrigin(origin, referer)) {
      throw new ForbiddenException({
        message: 'Cross-origin request rejected: untrusted Origin or Referer.',
        code: ErrorCode.FORBIDDEN,
        error: 'Forbidden',
      });
    }

    // Extract CSRF cookie from parsed cookies or raw Cookie header fallback
    const csrfCookieName = getCsrfCookieName(this.configService);
    let csrfCookie = request.cookies?.[csrfCookieName];
    if (!csrfCookie) {
      csrfCookie =
        request.cookies?.[CSRF_COOKIE_NAME_DEV] || request.cookies?.[CSRF_COOKIE_NAME_PROD];
    }
    if (!csrfCookie && request.headers.cookie) {
      const rawCookies = request.headers.cookie.split(';');
      for (const raw of rawCookies) {
        const [k, v] = raw.trim().split('=');
        if (
          (k === csrfCookieName || k === CSRF_COOKIE_NAME_DEV || k === CSRF_COOKIE_NAME_PROD) &&
          v
        ) {
          csrfCookie = decodeURIComponent(v);
          break;
        }
      }
    }

    const csrfHeader = request.headers['x-csrf-token'] as string | undefined;
    const session = (request as unknown as { session?: AuthSession }).session;

    // Determine request context:
    // Ambient cookies in headers, parsed cookies, Origin/Referer presence, session presence,
    // or anti-CSRF material firmly classifies the request as browser-context.
    const hasAnyCookie = Boolean(
      (request.headers.cookie && request.headers.cookie.trim().length > 0) ||
      (request.cookies && Object.keys(request.cookies).length > 0),
    );
    const hasOriginOrReferer = Boolean(origin || referer);
    const hasCsrfMaterial = Boolean(csrfHeader || csrfCookie);
    const isAuthenticated = Boolean(session);

    // If request is authenticated, or has origin/referer (browser client), or carries cookies,
    // or provides CSRF material: Full double-submit token verification is required.
    if (isAuthenticated || hasOriginOrReferer || hasCsrfMaterial || hasAnyCookie) {
      if (!csrfHeader) {
        throw new ForbiddenException({
          message: 'Missing anti-CSRF token in X-CSRF-Token header.',
          code: ErrorCode.CSRF_ERROR,
          error: 'Forbidden',
        });
      }

      if (!csrfCookie) {
        throw new ForbiddenException({
          message: 'Missing anti-CSRF cookie.',
          code: ErrorCode.CSRF_ERROR,
          error: 'Forbidden',
        });
      }

      // Double-submit invariant: header token must match cookie token
      if (csrfHeader !== csrfCookie) {
        throw new ForbiddenException({
          message: 'Anti-CSRF header and cookie tokens do not match.',
          code: ErrorCode.CSRF_ERROR,
          error: 'Forbidden',
        });
      }

      // Expected scope binding: active session ID for authenticated sessions, 'anonymous' for pre-auth browser mutations
      const expectedScope = session ? session.id : 'anonymous';
      const isValid = this.csrfService.validateToken(csrfHeader, expectedScope);
      if (!isValid) {
        throw new ForbiddenException({
          message: 'Invalid or expired anti-CSRF token.',
          code: ErrorCode.CSRF_ERROR,
          error: 'Forbidden',
        });
      }
    }

    // Non-browser API clients omitting Origin/Referer and cookies are allowed for unauthenticated mutations
    return true;
  }
}

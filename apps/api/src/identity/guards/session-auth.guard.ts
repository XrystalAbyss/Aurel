import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { ErrorCode } from '@aurel/shared-types';
import { SessionService } from '../session.service';
import { getSessionCookieName } from '../cookie.config';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const cookieName = getSessionCookieName(this.configService);

    // Retrieve token from parsed cookies or raw Cookie header fallback
    let token = request.cookies?.[cookieName];

    if (!token && request.headers.cookie) {
      // Defensive parsing in case cookie-parser middleware was bypassed
      const rawCookies = request.headers.cookie.split(';');
      for (const raw of rawCookies) {
        const [k, v] = raw.trim().split('=');
        if (k === cookieName && v) {
          token = decodeURIComponent(v);
          break;
        }
      }
    }

    if (!token) {
      throw new UnauthorizedException({
        message: 'Authentication required. No session cookie provided.',
        code: ErrorCode.UNAUTHORIZED,
        error: 'Unauthorized',
      });
    }

    const validated = await this.sessionService.validateSession(token);

    if (!validated) {
      throw new UnauthorizedException({
        message: 'Authentication failed. Session is invalid, expired, or revoked.',
        code: ErrorCode.UNAUTHORIZED,
        error: 'Unauthorized',
      });
    }

    // Attach strongly typed identity to request object
    (request as unknown as { user: unknown }).user = validated.user;
    (request as unknown as { session: unknown }).session = validated.session;
    (request as unknown as { rawSessionToken: string }).rawSessionToken = token;

    return true;
  }
}

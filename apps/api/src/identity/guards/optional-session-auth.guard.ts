import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { SessionService } from '../session.service';
import { getSessionCookieName } from '../cookie.config';

@Injectable()
export class OptionalSessionAuthGuard implements CanActivate {
  constructor(
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const cookieName = getSessionCookieName(this.configService);

    let token = request.cookies?.[cookieName];

    if (!token && request.headers.cookie) {
      const rawCookies = request.headers.cookie.split(';');
      for (const raw of rawCookies) {
        const [k, v] = raw.trim().split('=');
        if (k === cookieName && v) {
          token = decodeURIComponent(v);
          break;
        }
      }
    }

    if (token) {
      try {
        const validated = await this.sessionService.validateSession(token);
        if (validated) {
          (request as unknown as { user: unknown }).user = validated.user;
          (request as unknown as { session: unknown }).session = validated.session;
          (request as unknown as { rawSessionToken: string }).rawSessionToken = token;
        }
      } catch {
        // Non-blocking: continue as guest if optional session lookup fails
      }
    }

    return true;
  }
}

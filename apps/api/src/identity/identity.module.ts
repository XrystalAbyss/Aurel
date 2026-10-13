import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PasswordService } from './password.service';
import { UsersRepository } from './users.repository';
import { IdentityService } from './identity.service';
import { SessionService } from './session.service';
import { CsrfService } from './csrf.service';
import { RateLimiterService } from './rate-limiter.service';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { OptionalSessionAuthGuard } from './guards/optional-session-auth.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { AuthController } from './auth.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    PasswordService,
    UsersRepository,
    IdentityService,
    SessionService,
    CsrfService,
    RateLimiterService,
    SessionAuthGuard,
    OptionalSessionAuthGuard,
    CsrfGuard,
    PermissionsGuard,
  ],
  exports: [
    IdentityService,
    PasswordService,
    UsersRepository,
    SessionService,
    CsrfService,
    RateLimiterService,
    SessionAuthGuard,
    OptionalSessionAuthGuard,
    CsrfGuard,
    PermissionsGuard,
  ],
})
export class IdentityModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PasswordService } from './password.service';
import { UsersRepository } from './users.repository';
import { IdentityService } from './identity.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [PasswordService, UsersRepository, IdentityService],
  exports: [IdentityService, PasswordService, UsersRepository],
})
export class IdentityModule {}

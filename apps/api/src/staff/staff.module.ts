import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { IdentityModule } from '../identity/identity.module';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { AdminController } from './admin.controller';

@Module({
  imports: [PrismaModule, IdentityModule],
  controllers: [StaffController, AdminController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}

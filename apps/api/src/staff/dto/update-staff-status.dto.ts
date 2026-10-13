import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { UpdateStaffStatusRequest } from '@aurel/shared-types';

export class UpdateStaffStatusDto implements UpdateStaffStatusRequest {
  @ApiProperty({
    example: false,
    description: 'Updated active status (false deactivates account and revokes active sessions)',
  })
  @IsBoolean({ message: 'isActive must be a boolean value' })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const trimmed = value.trim().toLowerCase();
      if (trimmed === 'true') return true;
      if (trimmed === 'false') return false;
    }
    return value;
  })
  isActive: boolean;
}

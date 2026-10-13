import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ToggleAvailabilityDto {
  @ApiProperty({
    example: true,
    description: 'Whether the menu item is available for customer ordering',
  })
  @IsBoolean()
  isAvailable: boolean;
}

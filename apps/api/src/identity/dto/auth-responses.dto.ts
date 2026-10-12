import { ApiProperty } from '@nestjs/swagger';
import { LogoutResponse, CsrfTokenResponse } from '@aurel/shared-types';

export class LogoutResponseDto implements LogoutResponse {
  @ApiProperty({
    example: true,
    description: 'Indicates successful revocation and logout',
  })
  success!: boolean;

  @ApiProperty({
    example: 'Logged out successfully',
    description: 'Status message confirming session invalidation',
  })
  message!: string;
}

export class CsrfTokenResponseDto implements CsrfTokenResponse {
  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6.a1b2c3d4e5f6.9f8e7d6c5b4a...',
    description: 'Cryptographically signed double-submit anti-CSRF token',
  })
  csrfToken!: string;
}

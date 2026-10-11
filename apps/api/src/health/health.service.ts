import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HealthCheckResponse } from '@aurel/shared-types';

@Injectable()
export class HealthService {
  private readonly startTime = Date.now();

  constructor(private readonly prisma: PrismaService) {}

  async checkHealth(): Promise<HealthCheckResponse> {
    const isDbConnected = await this.prisma.checkDatabaseHealth();
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      status: isDbConnected ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      service: 'aurel-api',
      version: '1.0.0',
      checks: {
        database: isDbConnected ? 'connected' : 'disconnected',
        uptimeSeconds,
      },
    };
  }
}

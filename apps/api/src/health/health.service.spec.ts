import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthService', () => {
  let healthService: HealthService;
  let mockPrismaService: Partial<PrismaService>;

  beforeEach(() => {
    mockPrismaService = {
      checkDatabaseHealth: jest.fn().mockResolvedValue(true),
    };
    healthService = new HealthService(mockPrismaService as PrismaService);
  });

  it('should return status "ok" when database check succeeds', async () => {
    const result = await healthService.checkHealth();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('aurel-api');
    expect(result.checks.database).toBe('connected');
    expect(result.checks.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });

  it('should return status "degraded" when database check fails', async () => {
    (mockPrismaService.checkDatabaseHealth as jest.Mock).mockResolvedValue(false);

    const result = await healthService.checkHealth();

    expect(result.status).toBe('degraded');
    expect(result.checks.database).toBe('disconnected');
  });
});

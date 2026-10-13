import { Test, TestingModule } from '@nestjs/testing';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('CatalogService', () => {
  let service: CatalogService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      category: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
      menuItem: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      modifierGroup: {
        create: jest.fn(),
      },
      modifierOption: {
        createMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<CatalogService>(CatalogService);
    prisma = module.get(PrismaService);
  });

  describe('getMenu', () => {
    it('returns active categories with available items and modifier groups', async () => {
      (prisma.category.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'cat-1',
          name: 'Starters',
          slug: 'starters',
          description: 'Delicious starters',
          sortOrder: 1,
          isActive: true,
          items: [
            {
              id: 'item-1',
              categoryId: 'cat-1',
              name: 'Truffle Arancini',
              slug: 'truffle-arancini',
              description: 'Crispy rice balls',
              pricePaise: 55000,
              imageUrl: null,
              isAvailable: true,
              dietaryFlags: ['VEG'],
              modifierGroups: [],
            },
          ],
        },
      ]);

      const result = await service.getMenu();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Starters');
      expect(result[0].items[0].pricePaise).toBe(55000);
      expect(result[0].items[0].name).toBe('Truffle Arancini');
    });
  });

  describe('setItemAvailability', () => {
    it('toggles item availability from true to false (86ing)', async () => {
      (prisma.menuItem.findUnique as jest.Mock).mockResolvedValue({
        id: 'item-1',
        name: 'Truffle Arancini',
        isAvailable: true,
      });

      (prisma.menuItem.update as jest.Mock).mockResolvedValue({
        id: 'item-1',
        categoryId: 'cat-1',
        name: 'Truffle Arancini',
        slug: 'truffle-arancini',
        description: 'Crispy rice balls',
        pricePaise: 55000,
        imageUrl: null,
        isAvailable: false,
        dietaryFlags: ['VEG'],
        modifierGroups: [],
      });

      const result = await service.setItemAvailability('item-1', false);
      expect(result.isAvailable).toBe(false);
      expect(prisma.menuItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-1' },
          data: { isAvailable: false },
        }),
      );
    });

    it('throws NotFoundException if item does not exist', async () => {
      (prisma.menuItem.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.setItemAvailability('missing-id', false)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

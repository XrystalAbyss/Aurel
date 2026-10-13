import { Injectable, NotFoundException, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MenuCategory, MenuItemSummary, ErrorCode } from '@aurel/shared-types';

@Injectable()
export class CatalogService implements OnModuleInit {
  private readonly logger = new Logger(CatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.seedMenuIfEmpty();
  }

  /**
   * Retrieves the full active menu organized by category with available items and modifier groups.
   */
  async getMenu(includeUnavailable = false): Promise<MenuCategory[]> {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          where: includeUnavailable ? {} : { isAvailable: true },
          orderBy: { pricePaise: 'asc' },
          include: {
            modifierGroups: {
              include: {
                options: {
                  orderBy: { pricePaise: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      sortOrder: cat.sortOrder,
      isActive: cat.isActive,
      items: cat.items.map((item) => ({
        id: item.id,
        categoryId: item.categoryId,
        name: item.name,
        slug: item.slug,
        description: item.description,
        pricePaise: item.pricePaise,
        imageUrl: item.imageUrl,
        isAvailable: item.isAvailable,
        dietaryFlags: item.dietaryFlags,
        modifierGroups: item.modifierGroups.map((group) => ({
          id: group.id,
          itemId: group.itemId,
          name: group.name,
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
          options: group.options.map((opt) => ({
            id: opt.id,
            groupId: opt.groupId,
            name: opt.name,
            pricePaise: opt.pricePaise,
            isDefault: opt.isDefault,
          })),
        })),
      })),
    }));
  }

  /**
   * Retrieves a single menu item with its modifier hierarchy.
   */
  async getItemById(id: string): Promise<MenuItemSummary> {
    const item = await this.prisma.menuItem.findUnique({
      where: { id },
      include: {
        modifierGroups: {
          include: {
            options: true,
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException({
        message: 'Menu item not found.',
        code: ErrorCode.NOT_FOUND,
        error: 'Not Found',
      });
    }

    return {
      id: item.id,
      categoryId: item.categoryId,
      name: item.name,
      slug: item.slug,
      description: item.description,
      pricePaise: item.pricePaise,
      imageUrl: item.imageUrl,
      isAvailable: item.isAvailable,
      dietaryFlags: item.dietaryFlags,
      modifierGroups: item.modifierGroups.map((group) => ({
        id: group.id,
        itemId: group.itemId,
        name: group.name,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        options: group.options.map((opt) => ({
          id: opt.id,
          groupId: opt.groupId,
          name: opt.name,
          pricePaise: opt.pricePaise,
          isDefault: opt.isDefault,
        })),
      })),
    };
  }

  /**
   * Toggles item availability (86 / in stock) for operations and managers.
   */
  async setItemAvailability(itemId: string, isAvailable: boolean): Promise<MenuItemSummary> {
    const item = await this.prisma.menuItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      throw new NotFoundException({
        message: 'Menu item not found.',
        code: ErrorCode.NOT_FOUND,
        error: 'Not Found',
      });
    }

    const updated = await this.prisma.menuItem.update({
      where: { id: itemId },
      data: { isAvailable },
      include: {
        modifierGroups: {
          include: {
            options: true,
          },
        },
      },
    });

    this.logger.log(`Menu item availability toggled: ${itemId} -> ${isAvailable}`);

    return {
      id: updated.id,
      categoryId: updated.categoryId,
      name: updated.name,
      slug: updated.slug,
      description: updated.description,
      pricePaise: updated.pricePaise,
      imageUrl: updated.imageUrl,
      isAvailable: updated.isAvailable,
      dietaryFlags: updated.dietaryFlags,
      modifierGroups: updated.modifierGroups.map((g) => ({
        id: g.id,
        itemId: g.itemId,
        name: g.name,
        minSelections: g.minSelections,
        maxSelections: g.maxSelections,
        options: g.options.map((o) => ({
          id: o.id,
          groupId: o.groupId,
          name: o.name,
          pricePaise: o.pricePaise,
          isDefault: o.isDefault,
        })),
      })),
    };
  }

  /**
   * Seeds the default fine-dining menu into the database if the catalog is empty.
   */
  async seedMenuIfEmpty(): Promise<void> {
    const count = await this.prisma.category.count();
    if (count > 0) {
      return;
    }

    this.logger.log('Seeding fine dining restaurant menu into PostgreSQL...');

    // 1. Starters & Crudo
    const starters = await this.prisma.category.create({
      data: {
        name: 'Starters & Crudo',
        slug: 'starters',
        description:
          'Artisanal bites and delicate crudo prepared with seasonal Mediterranean bounty.',
        sortOrder: 1,
      },
    });

    const arancini = await this.prisma.menuItem.create({
      data: {
        categoryId: starters.id,
        name: 'Black Truffle & Wild Mushroom Arancini',
        slug: 'truffle-arancini',
        description:
          'Crispy Arborio rice spheres infused with black winter truffle and forest mushrooms, served over roasted garlic aioli and aged Parmigiano.',
        pricePaise: 55000, // ₹550
        dietaryFlags: ['VEG', 'SIGNATURE'],
      },
    });

    const aranciniGroup = await this.prisma.modifierGroup.create({
      data: {
        itemId: arancini.id,
        name: 'Aioli Selection',
        minSelections: 1,
        maxSelections: 1,
      },
    });

    await this.prisma.modifierOption.createMany({
      data: [
        { groupId: aranciniGroup.id, name: 'Truffle Garlic Aioli', pricePaise: 0, isDefault: true },
        {
          groupId: aranciniGroup.id,
          name: 'Spicy Calabrian Chili Aioli',
          pricePaise: 5000,
          isDefault: false,
        },
      ],
    });

    const burrata = await this.prisma.menuItem.create({
      data: {
        categoryId: starters.id,
        name: 'Burrata Pugliese con Fichi',
        slug: 'burrata-pugliese',
        description:
          'Fresh artisanal burrata from Puglia, caramelized mission figs, aged balsamic di Modena 12yr, toasted pine nuts, and warm sourdough.',
        pricePaise: 72000, // ₹720
        dietaryFlags: ['VEG'],
      },
    });

    const burrataGroup = await this.prisma.modifierGroup.create({
      data: {
        itemId: burrata.id,
        name: 'Artisanal Accompaniment',
        minSelections: 0,
        maxSelections: 2,
      },
    });

    await this.prisma.modifierOption.createMany({
      data: [
        {
          groupId: burrataGroup.id,
          name: 'Extra Grilled Sourdough',
          pricePaise: 12000,
          isDefault: false,
        },
        {
          groupId: burrataGroup.id,
          name: 'Prosciutto di Parma Reserva',
          pricePaise: 25000,
          isDefault: false,
        },
      ],
    });

    // 2. Artisanal Pastas
    const pasta = await this.prisma.category.create({
      data: {
        name: 'Handcrafted Pastas',
        slug: 'pastas',
        description:
          'Hand-rolled egg pastas extruded daily using bronze dies and Italian durum wheat.',
        sortOrder: 2,
      },
    });

    const tagliolini = await this.prisma.menuItem.create({
      data: {
        categoryId: pasta.id,
        name: 'Wild Morel & Truffle Tagliolini',
        slug: 'truffle-tagliolini',
        description:
          'Ribbon egg pasta tossed in cultured alpine butter, French morels, shaved black truffles, and 36-month Vacche Rosse Parmigiano-Reggiano.',
        pricePaise: 89000, // ₹890
        dietaryFlags: ['VEG', 'CHEF_RECOMMENDED'],
      },
    });

    const taglioliniGroup = await this.prisma.modifierGroup.create({
      data: {
        itemId: tagliolini.id,
        name: 'Truffle Shavings Upgrade',
        minSelections: 0,
        maxSelections: 1,
      },
    });

    await this.prisma.modifierOption.createMany({
      data: [
        { groupId: taglioliniGroup.id, name: 'Standard Shavings', pricePaise: 0, isDefault: true },
        {
          groupId: taglioliniGroup.id,
          name: 'Double Shaved Winter Truffles',
          pricePaise: 35000,
          isDefault: false,
        },
      ],
    });

    await this.prisma.menuItem.create({
      data: {
        categoryId: pasta.id,
        name: 'Bucatini Cacio e Pepe Tradizionale',
        slug: 'bucatini-cacio-e-pepe',
        description:
          'Roman thick hollow spaghetti, cracked Tellicherry black pepper, and emulsion of aged Pecorino Romano D.O.P.',
        pricePaise: 75000, // ₹750
        dietaryFlags: ['VEG'],
      },
    });

    // 3. Wood-Fired Neapolitan Pizzas
    const pizza = await this.prisma.category.create({
      data: {
        name: 'Neapolitan Wood-Fired Pizzas',
        slug: 'pizzas',
        description:
          'Fermented 48 hours for ethereal lightness, baked at 480°C in our Marra Forni oven.',
        sortOrder: 3,
      },
    });

    const margherita = await this.prisma.menuItem.create({
      data: {
        categoryId: pizza.id,
        name: 'Margherita Verace D.O.P',
        slug: 'margherita-verace',
        description:
          'San Marzano tomatoes, fresh Fior di Latte mozzarella, fragrant basil leaves, and cold-pressed extra virgin olive oil.',
        pricePaise: 68000, // ₹680
        dietaryFlags: ['VEG', 'SIGNATURE'],
      },
    });

    const margheritaGroup = await this.prisma.modifierGroup.create({
      data: {
        itemId: margherita.id,
        name: 'Crust & Cheese Additions',
        minSelections: 0,
        maxSelections: 2,
      },
    });

    await this.prisma.modifierOption.createMany({
      data: [
        {
          groupId: margheritaGroup.id,
          name: 'Upgrade to Buffalo Mozzarella D.O.P',
          pricePaise: 15000,
          isDefault: false,
        },
        {
          groupId: margheritaGroup.id,
          name: 'Garlic Herb Dipping Butter',
          pricePaise: 8000,
          isDefault: false,
        },
      ],
    });

    await this.prisma.menuItem.create({
      data: {
        categoryId: pizza.id,
        name: 'Diavola Tartufata',
        slug: 'diavola-tartufata',
        description:
          'Spicy artisanal salami, Fior di Latte, hot Calabrian honey drizzle, fresh oregano, and white truffle essence.',
        pricePaise: 82000, // ₹820
        dietaryFlags: ['SIGNATURE'],
      },
    });

    // 4. Robata & Mains
    const mains = await this.prisma.category.create({
      data: {
        name: 'Robata Grill & Entrées',
        slug: 'mains',
        description: 'Prime cuts and coastal fish grilled over Japanese Binchotan charcoal.',
        sortOrder: 4,
      },
    });

    const steak = await this.prisma.menuItem.create({
      data: {
        categoryId: mains.id,
        name: 'Dry-Aged Tenderloin Tagliata (250g)',
        slug: 'dry-aged-tagliata',
        description:
          '28-day dry aged grain-fed tenderloin steak, charred over binchotan embers, wild rocket, shaved parmesan, and salsa verde.',
        pricePaise: 145000, // ₹1,450
        dietaryFlags: ['SIGNATURE', 'GLUTEN_FREE'],
      },
    });

    const steakTempGroup = await this.prisma.modifierGroup.create({
      data: {
        itemId: steak.id,
        name: 'Cooking Temperature',
        minSelections: 1,
        maxSelections: 1,
      },
    });

    await this.prisma.modifierOption.createMany({
      data: [
        {
          groupId: steakTempGroup.id,
          name: 'Medium Rare (Recommended)',
          pricePaise: 0,
          isDefault: true,
        },
        { groupId: steakTempGroup.id, name: 'Medium', pricePaise: 0, isDefault: false },
        { groupId: steakTempGroup.id, name: 'Medium Well', pricePaise: 0, isDefault: false },
      ],
    });

    const steakSideGroup = await this.prisma.modifierGroup.create({
      data: {
        itemId: steak.id,
        name: 'Chef Side Selection',
        minSelections: 1,
        maxSelections: 1,
      },
    });

    await this.prisma.modifierOption.createMany({
      data: [
        { groupId: steakSideGroup.id, name: 'Truffle Pomme Purée', pricePaise: 0, isDefault: true },
        {
          groupId: steakSideGroup.id,
          name: 'Charred Broccolini with Almonds',
          pricePaise: 10000,
          isDefault: false,
        },
      ],
    });

    // 5. Desserts & Pâtisserie
    const desserts = await this.prisma.category.create({
      data: {
        name: 'Desserts & Pâtisserie',
        slug: 'desserts',
        description:
          'House-made confectioneries honoring classic European confectionery tradition.',
        sortOrder: 5,
      },
    });

    await this.prisma.menuItem.create({
      data: {
        categoryId: desserts.id,
        name: 'Aurel Tiramisu Classico',
        slug: 'tiramisu-classico',
        description:
          'Savoiardi biscuits soaked in single-origin espresso and Marsala wine, layered with sweet mascarpone cream and Valrhona cocoa.',
        pricePaise: 48000, // ₹480
        dietaryFlags: ['VEG', 'SIGNATURE'],
      },
    });

    await this.prisma.menuItem.create({
      data: {
        categoryId: desserts.id,
        name: 'Warm Valrhona Dark Chocolate Fondant',
        slug: 'chocolate-fondant',
        description:
          '70% Guanaja chocolate lava center, Madagascan vanilla bean gelato, and freeze-dried raspberry dust.',
        pricePaise: 52000, // ₹520
        dietaryFlags: ['VEG'],
      },
    });

    // 6. Beverages & Elixirs
    const drinks = await this.prisma.category.create({
      data: {
        name: 'Artisanal Elixirs & Teas',
        slug: 'beverages',
        description:
          'Botanical infusions, sparkling elixirs, and bespoke mocktails crafted tableside.',
        sortOrder: 6,
      },
    });

    await this.prisma.menuItem.create({
      data: {
        categoryId: drinks.id,
        name: 'Smoked Rosemary & Blood Orange Tonic',
        slug: 'smoked-rosemary-tonic',
        description:
          'Clarified blood orange juice, torched rosemary sprig, elderflower cordial, and artisan Indian tonic water.',
        pricePaise: 32000, // ₹320
        dietaryFlags: ['VEG', 'SIGNATURE'],
      },
    });

    await this.prisma.menuItem.create({
      data: {
        categoryId: drinks.id,
        name: 'Yuzu & Cucumber Sparkling Cooler',
        slug: 'yuzu-cucumber-cooler',
        description:
          'Japanese yuzu citrus, cold-pressed Persian cucumber, mint syrup, and effervescent soda.',
        pricePaise: 35000, // ₹350
        dietaryFlags: ['VEG'],
      },
    });

    this.logger.log('Default fine dining restaurant menu seeded successfully!');
  }
}

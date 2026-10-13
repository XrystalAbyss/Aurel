import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { ToggleAvailabilityDto } from './dto/toggle-availability.dto';
import { SessionAuthGuard } from '../identity/guards/session-auth.guard';
import { PermissionsGuard } from '../identity/guards/permissions.guard';
import { Permissions } from '../identity/decorators/permissions.decorator';
import { Permission, MenuCategory, MenuItemSummary } from '@aurel/shared-types';

@ApiTags('Catalog & Menu')
@Controller('menu')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  @ApiOperation({
    summary: 'Retrieve complete restaurant menu',
    description:
      'Returns all active categories, available menu items, dietary markers, and modifier choices.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Menu categories with items and modifier groups',
  })
  async getMenu(@Query('all') all?: string): Promise<MenuCategory[]> {
    const includeUnavailable = all === 'true';
    return this.catalogService.getMenu(includeUnavailable);
  }

  @Get('items/:id')
  @ApiOperation({
    summary: 'Retrieve single menu item details',
    description: 'Returns item details and full modifier group hierarchy.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Menu item details',
  })
  @ApiNotFoundResponse({ description: 'Item not found' })
  async getItem(@Param('id') id: string): Promise<MenuItemSummary> {
    return this.catalogService.getItemById(id);
  }

  @Patch('items/:id/availability')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @Permissions(Permission.CATALOG_WRITE)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Toggle menu item availability (86/in-stock)',
    description:
      'Enables managers and administrators to mark menu items unavailable or restore availability in real time.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Updated menu item availability',
  })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiNotFoundResponse({ description: 'Menu item not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions (requires catalog.write)' })
  async setAvailability(
    @Param('id') id: string,
    @Body() dto: ToggleAvailabilityDto,
  ): Promise<MenuItemSummary> {
    return this.catalogService.setItemAvailability(id, dto.isAvailable);
  }
}

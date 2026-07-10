import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private catalogService: CatalogService) {}

  @Get('categories')
  getCategories() {
    return this.catalogService.getCategories();
  }

  @Get('services')
  getServices(@Query('categoryId') categoryId?: string) {
    return this.catalogService.getServices(categoryId);
  }

  @Get('services/:slug')
  getServiceBySlug(@Param('slug') slug: string) {
    return this.catalogService.getServiceBySlug(slug);
  }
}

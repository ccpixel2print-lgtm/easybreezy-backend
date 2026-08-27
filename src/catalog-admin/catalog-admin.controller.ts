import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CatalogAdminService } from './catalog-admin.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateServiceDto,
  UpdateServiceDto,
  CreateSubServiceDto,
  UpdateSubServiceDto,
  CreatePincodeDto,
  UpdatePincodeDto,
} from './catalog-admin.dto';

@UseGuards(JwtGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/catalog')
export class CatalogAdminController {
  constructor(private svc: CatalogAdminService) {}

  // categories
  @Get('categories')
  listCategories() {
    return this.svc.listCategories();
  }
  @Post('categories')
  createCategory(@Body() b: CreateCategoryDto) {
    return this.svc.createCategory(b);
  }
  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() b: UpdateCategoryDto) {
    return this.svc.updateCategory(id, b);
  }
  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.svc.deleteCategory(id);
  }

  // services
  @Get('services')
  listServices(@Query('categoryId') categoryId?: string) {
    return this.svc.listServices(categoryId);
  }
  @Get('services/:id')
  getService(@Param('id') id: string) {
    return this.svc.getService(id);
  }
  @Post('services')
  createService(@Body() b: CreateServiceDto) {
    return this.svc.createService(b);
  }
  @Patch('services/:id')
  updateService(@Param('id') id: string, @Body() b: UpdateServiceDto) {
    return this.svc.updateService(id, b);
  }
  @Delete('services/:id')
  deleteService(@Param('id') id: string) {
    return this.svc.deleteService(id);
  }

  // sub-services
  @Post('sub-services')
  createSubService(@Body() b: CreateSubServiceDto) {
    return this.svc.createSubService(b);
  }
  @Patch('sub-services/:id')
  updateSubService(@Param('id') id: string, @Body() b: UpdateSubServiceDto) {
    return this.svc.updateSubService(id, b);
  }
  @Delete('sub-services/:id')
  deleteSubService(@Param('id') id: string) {
    return this.svc.deleteSubService(id);
  }

  // pincodes
  @Get('pincodes')
  listPincodes() {
    return this.svc.listPincodes();
  }
  @Post('pincodes')
  createPincode(@Body() b: CreatePincodeDto) {
    return this.svc.createPincode(b);
  }
  @Patch('pincodes/:id')
  updatePincode(@Param('id') id: string, @Body() b: UpdatePincodeDto) {
    return this.svc.updatePincode(id, b);
  }
  @Delete('pincodes/:id')
  deletePincode(@Param('id') id: string) {
    return this.svc.deletePincode(id);
  }
}

import { Controller, Get, Post, Body, Patch, Param, Delete, Put, UseGuards } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('roles')
@UseGuards(AuthGuard, AuthorizationGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @RequirePermissions('roles.create')
  create(@Body() createRoleDto: CreateRoleDto) {
    return this.rolesService.create(createRoleDto);
  }

  @Get()
  @RequirePermissions('roles.read')
  findAll() {
    return this.rolesService.findAll();
  }

  @Get('permissions/available')
  @RequirePermissions('roles.read')
  getAvailablePermissions() {
    return this.rolesService.getAllPermissions();
  }

  @Get('permissions/by-module')
  @RequirePermissions('roles.read')
  getPermissionsByModule() {
    return this.rolesService.getPermissionsByModule();
  }

  @Get(':id')
  @RequirePermissions('roles.read')
  findOne(@Param('id') id: string) {
    return this.rolesService.findOne(+id);
  }

  @Get(':id/permissions')
  @RequirePermissions('roles.read')
  getRolePermissions(@Param('id') id: string) {
    return this.rolesService.getRolePermissions(+id);
  }

  @Patch(':id')
  @RequirePermissions('roles.update')
  update(@Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
    return this.rolesService.update(+id, updateRoleDto);
  }

  @Put(':id/permissions')
  @RequirePermissions('roles.update')
  updateRolePermissions(
    @Param('id') id: string,
    @Body('permissionIds') permissionIds: string[]
  ) {
    return this.rolesService.updateRolePermissions(+id, permissionIds);
  }

  @Delete(':id')
  @RequirePermissions('roles.delete')
  remove(@Param('id') id: string) {
    return this.rolesService.remove(+id);
  }
}

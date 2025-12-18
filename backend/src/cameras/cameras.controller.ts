import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { CamerasService } from './cameras.service';
import { CreateCameraDto } from './dto/create-camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBadRequestResponse, ApiUnauthorizedResponse, ApiNotFoundResponse, ApiForbiddenResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { AuthGuard } from 'src/auth/auth.guard';
import { AuthorizationGuard } from 'src/auth/guards/authorization.guard';
import { RequirePermissions } from 'src/auth/decorators/permissions.decorator';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditModule, AuditAction } from '../audit/entities/audit-log.entity';

@ApiTags('Gestión de Cámaras')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
@ApiForbiddenResponse({ description: 'No tiene permisos suficientes para esta operación' })
@Controller('cameras')
export class CamerasController {
  constructor(private readonly camerasService: CamerasService) {}

  @Post()
  @RequirePermissions('cameras.create')
  @Auditable({
    module: AuditModule.CAMERAS,
    action: AuditAction.CREATE,
    entityType: 'Camera',
    description: 'Cámara creada en el sistema',
    captureResponse: true
  })
  @ApiOperation({ 
    summary: 'Crear una nueva cámara', 
    description: 'Crea una nueva cámara en el sistema y opcionalmente la registra en MediaMTX. Permite asignar roles con permisos de visualización. Requiere permiso "cameras.create".'
  })
  @ApiResponse({ status: 201, description: 'Cámara creada exitosamente' })
  @ApiBadRequestResponse({ description: 'Datos inválidos o mountPath ya existe' })
  @ApiBody({ type: CreateCameraDto })
  create(@Body() createCameraDto: CreateCameraDto) {
    return this.camerasService.create(createCameraDto);
  }

  @Get()
  @RequirePermissions('cameras.read')
  @ApiOperation({ 
    summary: 'Listar todas las cámaras', 
    description: 'Retorna la lista completa de cámaras registradas en el sistema con su información y roles asignados. Requiere permiso "cameras.read".'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Lista de cámaras obtenida exitosamente',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          location: { type: 'string' },
          mountPath: { type: 'string' },
          registeredInMediamtx: { type: 'boolean' },
          enableLpr: { type: 'boolean' },
          active: { type: 'boolean' },
          roles: { type: 'array' }
        }
      }
    }
  })
  findAll() {
    return this.camerasService.findAll();
  }

  @Get(':id')
  @RequirePermissions('cameras.read')
  @ApiOperation({ 
    summary: 'Obtener cámara por ID', 
    description: 'Retorna la información detallada de una cámara específica. Requiere permiso "cameras.read".'
  })
  @ApiParam({ name: 'id', description: 'ID único de la cámara', type: String })
  @ApiResponse({ status: 200, description: 'Cámara encontrada exitosamente' })
  @ApiNotFoundResponse({ description: 'Cámara no encontrada' })
  findOne(@Param('id') id: string) {
    return this.camerasService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('cameras.update')
  @Auditable({
    module: AuditModule.CAMERAS,
    action: AuditAction.UPDATE,
    entityType: 'Camera',
    description: 'Configuración de cámara actualizada',
    captureOldValue: true,
    captureResponse: true
  })
  @ApiOperation({ 
    summary: 'Actualizar cámara', 
    description: 'Actualiza la información de una cámara existente y sus roles asignados. Requiere permiso "cameras.update".'
  })
  @ApiParam({ name: 'id', description: 'ID único de la cámara', type: String })
  @ApiResponse({ status: 200, description: 'Cámara actualizada exitosamente' })
  @ApiNotFoundResponse({ description: 'Cámara no encontrada' })
  @ApiBadRequestResponse({ description: 'Datos inválidos' })
  @ApiBody({ type: UpdateCameraDto })
  update(@Param('id') id: string, @Body() updateCameraDto: UpdateCameraDto) {
    return this.camerasService.update(id, updateCameraDto);
  }

  @Delete(':id')
  @RequirePermissions('cameras.delete')
  @Auditable({
    module: AuditModule.CAMERAS,
    action: AuditAction.DELETE,
    entityType: 'Camera',
    description: 'Cámara eliminada del sistema',
    captureOldValue: true
  })
  @ApiOperation({ 
    summary: 'Eliminar cámara', 
    description: 'Elimina una cámara del sistema y la desregistra de MediaMTX si estaba registrada. Requiere permiso "cameras.delete".'
  })
  @ApiParam({ name: 'id', description: 'ID único de la cámara', type: String })
  @ApiResponse({ status: 200, description: 'Cámara eliminada exitosamente' })
  @ApiNotFoundResponse({ description: 'Cámara no encontrada' })
  remove(@Param('id') id: string) {
    return this.camerasService.remove(id);
  }

  @Post(':id/register')
  @RequirePermissions('cameras.update')
  @Auditable({
    module: AuditModule.CAMERAS,
    action: AuditAction.CAMERA_REGISTER,
    entityType: 'Camera',
    description: 'Cámara registrada en MediaMTX',
    captureResponse: true
  })
  @ApiOperation({ 
    summary: 'Registrar cámara en MediaMTX', 
    description: 'Registra o reintenta el registro de la cámara en MediaMTX para streaming. Requiere permiso "cameras.update".'
  })
  @ApiParam({ name: 'id', description: 'ID único de la cámara', type: String })
  @ApiResponse({ 
    status: 200, 
    description: 'Operación completada',
    schema: {
      type: 'object',
      properties: {
        registered: { type: 'boolean', description: 'Indica si el registro fue exitoso' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Cámara no encontrada' })
  async register(@Param('id') id: string) {
    const ok = await this.camerasService.registerInMediamtx(id);
    return { registered: ok };
  }

  @Get(':id/source')
  @RequirePermissions('cameras.read')
  @ApiOperation({ 
    summary: 'Obtener URL de origen de la cámara', 
    description: 'Retorna la URL RTSP desencriptada de la cámara. Solo para administradores. Requiere permiso "cameras.read".'
  })
  @ApiParam({ name: 'id', description: 'ID único de la cámara', type: String })
  @ApiResponse({ 
    status: 200, 
    description: 'URL de origen obtenida',
    schema: {
      type: 'object',
      properties: {
        sourceUrl: { type: 'string', description: 'URL RTSP desencriptada' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Cámara no encontrada' })
  async getSource(@Param('id') id: string) {
    const src = await this.camerasService.getDecryptedSourceUrl(id);
    return { sourceUrl: src };
  }

  @Get(':id/has-source')
  @RequirePermissions('cameras.read')
  @ApiOperation({ 
    summary: 'Verificar si la cámara tiene URL de origen', 
    description: 'Indica si la cámara tiene una URL de origen almacenada sin exponerla. Requiere permiso "cameras.read".'
  })
  @ApiParam({ name: 'id', description: 'ID único de la cámara', type: String })
  @ApiResponse({ 
    status: 200, 
    description: 'Estado verificado',
    schema: {
      type: 'object',
      properties: {
        hasSource: { type: 'boolean', description: 'Indica si tiene URL almacenada' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Cámara no encontrada' })
  async hasSource(@Param('id') id: string) {
    const ok = await this.camerasService.hasSource(id);
    return { hasSource: ok };
  }

  @Patch(':id/enable-lpr')
  @RequirePermissions('cameras.enable-ia')
  @Auditable({
    module: AuditModule.CAMERAS,
    action: AuditAction.UPDATE,
    entityType: 'Camera',
    description: 'Estado de LPR actualizado en cámara',
    captureResponse: true
  })
  @ApiOperation({ 
    summary: 'Habilitar/deshabilitar IA en cámara', 
    description: 'Activa o desactiva el reconocimiento de placas (LPR) mediante IA en la cámara. Requiere permiso "cameras.enable-ia".'
  })
  @ApiParam({ name: 'id', description: 'ID único de la cámara', type: String })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        enableLpr: { type: 'boolean', description: 'true para habilitar, false para deshabilitar' }
      },
      required: ['enableLpr']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Estado de IA actualizado exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        enableLpr: { type: 'boolean' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Cámara no encontrada' })
  async enableLpr(
    @Param('id') id: string, 
    @Body('enableLpr') enableLpr: boolean
  ) {
    return this.camerasService.updateLprStatus(id, enableLpr);
  }
}

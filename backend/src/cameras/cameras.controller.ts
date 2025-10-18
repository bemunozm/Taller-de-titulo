import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { CamerasService } from './cameras.service';
import { CreateCameraDto } from './dto/create-camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBadRequestResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard } from 'src/auth/auth.guard';
import { AuthorizationGuard } from 'src/auth/guards/authorization.guard';
import { RequireRoles } from 'src/auth/decorators/roles.decorator';

@ApiTags('cameras')
@ApiBearerAuth()
@UseGuards(AuthGuard, AuthorizationGuard)
@Controller('cameras')
export class CamerasController {
  constructor(private readonly camerasService: CamerasService) {}

  @Post()
  @ApiOperation({ summary: 'Crear una nueva cámara y asignar roles' })
  @ApiResponse({ status: 201, description: 'Cámara creada' })
  @ApiBadRequestResponse({ description: 'Entrada inválida' })
  create(@Body() createCameraDto: CreateCameraDto) {
    return this.camerasService.create(createCameraDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar cámaras' })
  findAll() {
    return this.camerasService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una cámara por ID' })
  findOne(@Param('id') id: string) {
    return this.camerasService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar una cámara y sus roles' })
  update(@Param('id') id: string, @Body() updateCameraDto: UpdateCameraDto) {
    return this.camerasService.update(id, updateCameraDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar una cámara' })
  remove(@Param('id') id: string) {
    return this.camerasService.remove(id);
  }

  @Post(':id/register')
  @ApiOperation({ summary: 'Registrar (o reintentar) la cámara en MediaMTX (pull)' })
  async register(@Param('id') id: string) {
    const ok = await this.camerasService.registerInMediamtx(id);
    return { registered: ok };
  }

  @Get(':id/source')
  @ApiOperation({ summary: 'Obtener la URL source (desencriptada) de la cámara' })
  @RequireRoles('Administrador')
  async getSource(@Param('id') id: string) {
    const src = await this.camerasService.getDecryptedSourceUrl(id);
    return { sourceUrl: src };
  }

  @Get(':id/has-source')
  @ApiOperation({ summary: 'Indica si la cámara tiene sourceUrl almacenado (sin exponerla)' })
  @RequireRoles('Administrador')
  async hasSource(@Param('id') id: string) {
    const ok = await this.camerasService.hasSource(id);
    return { hasSource: ok };
  }
}

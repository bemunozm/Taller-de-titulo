import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CreateCameraDto } from './dto/create-camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';
import { Camera } from './entities/camera.entity';
import { Role } from 'src/roles/entities/role.entity';
import { encryptString, decryptString } from 'src/utils/crypto.util';
import { MediamtxService } from 'src/mediamtx/mediamtx.service';
import { WorkerNotifierService } from 'src/workers/worker-notifier.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CamerasService {
  private readonly logger = new Logger(CamerasService.name);
  constructor(
    @InjectRepository(Camera)
    private readonly cameraRepository: Repository<Camera>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly mediamtxService?: MediamtxService,
    private readonly dataSource?: DataSource,
    private readonly workerNotifier?: WorkerNotifierService,
  ) {}

  // Ayudante: comprobación rápida tipo UUID v4 para evitar consultar la columna UUID con cadenas no UUID
  private isUuid(val: string) {
    if (!val || typeof val !== 'string') return false;
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(val);
  }

  /** Resuelve una cámara por su id (UUID) o por su mountPath (slug). Devuelve null si no existe. */
  private async resolveCameraByIdOrMount(cameraIdOrMount: string) {
    if (!cameraIdOrMount) return null;
  // Intentar por id cuando el valor parezca un UUID
    if (this.isUuid(cameraIdOrMount)) {
      const byId = await this.cameraRepository.findOne({ where: { id: cameraIdOrMount }, relations: ['roles'] });
      if (byId) return byId;
    }
  // Alternativa: intentar por mountPath
    const byMount = await this.cameraRepository.findOne({ where: { mountPath: cameraIdOrMount }, relations: ['roles'] });
    if (byMount) return byMount;
    // Como último recurso, si el input parecía un UUID pero lo anterior falló, intentar por id sin relaciones
    if (this.isUuid(cameraIdOrMount)) {
      return await this.cameraRepository.findOne({ where: { id: cameraIdOrMount } });
    }
    return null;
  }

  /** Helper público: obtiene la entidad cámara por id o mountPath (devuelve null si no existe) */
  async getCameraByIdOrMount(cameraIdOrMount: string) {
    return await this.resolveCameraByIdOrMount(cameraIdOrMount);
  }

  async create(createCameraDto: CreateCameraDto) {
    try {
      const { roleIds, ...data } = createCameraDto;

      const camera = this.cameraRepository.create(data);

      // Si se proporcionó sourceUrl, encriptarla antes de guardar
      if (data.sourceUrl) {
        camera.encryptedSourceUrl = encryptString(data.sourceUrl);
      }

  // Generar mountPath (slug) automáticamente a partir del nombre si no se proporcionó
      const desired = data.name ? this.slugify(data.name) : uuidv4();
      camera.mountPath = await this.generateUniqueMountPath(desired);

      if (roleIds && Array.isArray(roleIds) && roleIds.length > 0) {
        const roles = await this.roleRepository.findBy({ id: In(roleIds) });
        if (roles.length !== roleIds.length) {
          throw new BadRequestException('Algunos roles no existen');
        }
        camera.roles = roles;
      }

      const registerEnabled = (process.env.CAMERAS_REGISTER_IN_MEDIAMTX || '').toLowerCase() === 'true';
      const strict = (process.env.CAMERAS_STRICT_REGISTRATION || '').toLowerCase() === 'true';

  // Si el modo strict está activado, usar una transacción en la BD y requerir el registro en MediaMTX
      if (registerEnabled && strict && this.mediamtxService && this.dataSource) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
          const savedTx = await queryRunner.manager.save(camera);
          const mount = savedTx.mountPath && savedTx.mountPath.length > 0 ? savedTx.mountPath : savedTx.id;
          const decrypted = data.sourceUrl ? data.sourceUrl : await this.getDecryptedSourceUrl(savedTx.id);
          if (!decrypted) {
            // nada que registrar; confirmar
            await queryRunner.commitTransaction();
            return savedTx;
          }
          // intentar registro
          await this.mediamtxService.registerSource(mount, decrypted);
          // marcar como registrada dentro de la transacción
          savedTx.registeredInMediamtx = true;
          await queryRunner.manager.save(savedTx);
          try {
            await queryRunner.commitTransaction();
            return savedTx;
          } catch (commitErr) {
            // El commit falló después de un registro exitoso: intentar limpiar desregistrando
            try {
              await this.mediamtxService.deregisterSource(mount);
            } catch (cleanupErr) {
              this.logger.error(`Commit falló y el cleanup (deregister) también falló para mount '${mount}': ${cleanupErr?.message || cleanupErr}`);
            }
            throw commitErr;
          }
        } catch (err) {
          await queryRunner.rollbackTransaction();
          // rethrow as user-friendly error
          this.logger.warn(`Registro estricto falló durante la creación: ${err?.message || err}`);
          throw new InternalServerErrorException('No fue posible registrar la cámara en MediaMTX. Operación cancelada.');
        } finally {
          await queryRunner.release();
        }
      }

      // Comportamiento por defecto (no strict): guardar e intentar el registro de forma best-effort
      const saved = await this.cameraRepository.save(camera);
      // notify worker manager if LPR enabled
      try {
        if (saved.enableLpr && this.workerNotifier) {
          const decrypted = await this.getDecryptedSourceUrl(saved.id);
          await this.workerNotifier.registerCamera(saved.id, decrypted || '', saved.mountPath);
        }
      } catch (err) {
        this.logger.warn(`No se pudo notificar al worker manager tras crear cámara: ${err?.message || err}`);
      }
      if (registerEnabled && this.mediamtxService) {
        try {
          const mount = saved.mountPath && saved.mountPath.length > 0 ? saved.mountPath : saved.id;
          const decrypted = await this.getDecryptedSourceUrl(saved.id);
          if (decrypted) {
            await this.mediamtxService.registerSource(mount, decrypted);
            // marcar flag persistente
            saved.registeredInMediamtx = true;
            await this.cameraRepository.save(saved);
          }
        } catch (err) {
          this.logger.warn(`Fallo al registrar cámara en MediaMTX (no-strict): ${err?.message || err}`);
          // marcar como no registrada
          try {
            saved.registeredInMediamtx = false;
            await this.cameraRepository.save(saved);
          } catch {}
        }
      }

      return saved;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Error al crear la cámara');
    }
  }

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 140);
  }

  private async generateUniqueMountPath(base: string, excludeId?: string): Promise<string> {
    let attempt = 0;
    let candidate = base;
    while (true) {
      const existing = await this.cameraRepository.findOne({ where: { mountPath: candidate } });
      if (!existing || (excludeId && existing.id === excludeId)) {
        return candidate;
      }
      attempt += 1;
      candidate = `${base}-${attempt}`;
      if (attempt > 50) {
        // fallback
        return `${base}-${Date.now()}`;
      }
    }
  }

  async findAll() {
    try {
      return await this.cameraRepository.find({ relations: ['roles'], order: { name: 'ASC' } });
    } catch (error) {
      throw new InternalServerErrorException('Error al obtener cámaras');
    }
  }

  async findOne(id: string) {
    try {
      const camera = await this.cameraRepository.findOne({ where: { id }, relations: ['roles'] });
  if (!camera) throw new NotFoundException(`Cámara con ID ${id} no encontrada`);
      return camera;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Error al obtener la cámara');
    }
  }

  async update(id: string, updateCameraDto: UpdateCameraDto) {
    try {
      const camera = await this.cameraRepository.findOne({ where: { id }, relations: ['roles'] });
      if (!camera) throw new NotFoundException(`Cámara con ID ${id} no encontrada`);

      const { roleIds, ...data } = updateCameraDto;

      const oldDecrypted = camera.encryptedSourceUrl ? decryptString(camera.encryptedSourceUrl) : null;
      const oldMount = camera.mountPath && camera.mountPath.length > 0 ? camera.mountPath : camera.id;

      // Evitar cambiar mountPath via update (autoslug gestionado por el sistema)
      if (data.mountPath) {
        delete data.mountPath;
      }

      Object.assign(camera, data);

      // Si el nombre cambió y mountPath no está bloqueado explícitamente, regenerar mountPath
      if (data.name && !data.mountPath) {
        const desired = this.slugify(data.name);
        camera.mountPath = await this.generateUniqueMountPath(desired, camera.id);
      }

      if (data.sourceUrl) {
        // validar sourceUrl antes de guardar
        if (!this.isValidSourceUrl(data.sourceUrl)) {
          throw new BadRequestException('sourceUrl inválida. Debe usar esquemas permitidos (rtsp, rtmp, srt, http, https)');
        }
        camera.encryptedSourceUrl = encryptString(data.sourceUrl);
      }

      if (roleIds) {
        const roles = await this.roleRepository.findBy({ id: In(roleIds) });
        if (roles.length !== roleIds.length) {
          throw new BadRequestException('Algunos roles no existen');
        }
        camera.roles = roles;
      }

      // detect mountPath change: if name changed, recompute desired slug
      let willChangeMount = false;
      if (data.name) {
        const desired = this.slugify(data.name);
        const newMountCandidate = await this.generateUniqueMountPath(desired, camera.id);
        if (newMountCandidate !== oldMount) {
          willChangeMount = true;
          camera.mountPath = newMountCandidate;
        }
      }

      const registerEnabled = (process.env.CAMERAS_REGISTER_IN_MEDIAMTX || '').toLowerCase() === 'true';
      const strict = (process.env.CAMERAS_STRICT_REGISTRATION || '').toLowerCase() === 'true';

  // Si strict + registerEnabled, realizar la actualización dentro de una transacción y requerir operaciones en mediamtx
      if (registerEnabled && strict && this.mediamtxService && this.dataSource) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
          const savedTx = await queryRunner.manager.save(camera);
          const newMount = savedTx.mountPath && savedTx.mountPath.length > 0 ? savedTx.mountPath : savedTx.id;
          const newDecrypted = data.sourceUrl ? data.sourceUrl : await this.getDecryptedSourceUrl(savedTx.id);

          // If mount changed, deregister old mount first then register new
          if (willChangeMount) {
            await this.mediamtxService.deregisterSource(oldMount);
            if (newDecrypted) {
              await this.mediamtxService.registerSource(newMount, newDecrypted);
              // mark registered
              savedTx.registeredInMediamtx = true;
              await queryRunner.manager.save(savedTx);
            } else {
              savedTx.registeredInMediamtx = false;
              await queryRunner.manager.save(savedTx);
            }
          } else {
            // mount sin cambios. Si sourceUrl cambió, volver a registrar el mismo mount con la nueva URL
            const sourceChanged = data.sourceUrl && oldDecrypted !== data.sourceUrl;
            if (sourceChanged && newDecrypted) {
              await this.mediamtxService.registerSource(newMount, newDecrypted);
              savedTx.registeredInMediamtx = true;
              await queryRunner.manager.save(savedTx);
            }
          }

          try {
            await queryRunner.commitTransaction();
            return savedTx;
          } catch (commitErr) {
            // commit falló después de operaciones en mediamtx; intentar limpiar
            try {
              // If we registered new mount, try to deregister it
              const cleanupMount = savedTx.mountPath && savedTx.mountPath.length > 0 ? savedTx.mountPath : savedTx.id;
              await this.mediamtxService.deregisterSource(cleanupMount);
            } catch (cleanupErr) {
              this.logger.error(`Commit falló y el cleanup (deregister) también falló para mount tras update: ${cleanupErr?.message || cleanupErr}`);
            }
            throw commitErr;
          }
        } catch (err) {
          await queryRunner.rollbackTransaction();
          this.logger.warn(`Registro estricto falló durante update: ${err?.message || err}`);
          throw new InternalServerErrorException('No fue posible actualizar la cámara en MediaMTX. Operación cancelada.');
        } finally {
          await queryRunner.release();
        }
      }

      // Comportamiento por defecto (no strict): guardar e intentar registro/deregistro de forma best-effort
      const saved = await this.cameraRepository.save(camera);
      // notify worker manager about enableLpr changes
      try {
        if (saved.enableLpr && this.workerNotifier) {
          const decrypted = await this.getDecryptedSourceUrl(saved.id);
          await this.workerNotifier.registerCamera(saved.id, decrypted || '', saved.mountPath);
        } else if (!saved.enableLpr && this.workerNotifier) {
          // if LPR was disabled, unregister
          await this.workerNotifier.unregisterCamera(saved.id);
        }
      } catch (err) {
        this.logger.warn(`No se pudo notificar al worker manager tras actualizar cámara: ${err?.message || err}`);
      }
      if (registerEnabled && this.mediamtxService) {
        try {
          const newMount = saved.mountPath && saved.mountPath.length > 0 ? saved.mountPath : saved.id;
          const decrypted = await this.getDecryptedSourceUrl(saved.id);
          if (willChangeMount) {
            try {
              await this.mediamtxService.deregisterSource(oldMount);
            } catch (err) {
              this.logger.warn(`Fallo al deregistrar el path antiguo en MediaMTX '${oldMount}' tras update: ${err?.message || err}`);
            }
          }
          if (decrypted) {
            try {
              await this.mediamtxService.registerSource(newMount, decrypted);
              saved.registeredInMediamtx = true;
              await this.cameraRepository.save(saved);
            } catch (err) {
              this.logger.warn(`Fallo al registrar cámara actualizada en MediaMTX: ${err?.message || err}`);
              saved.registeredInMediamtx = false;
              await this.cameraRepository.save(saved);
            }
          }
        } catch (err) {
          this.logger.warn(`Fallo al registrar cámara actualizada en MediaMTX: ${err?.message || err}`);
        }
      }

      return saved;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Error al actualizar la cámara');
    }
  }

  private isValidSourceUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const allowed = ['rtsp:', 'rtsps:', 'rtmp:', 'rtmps:', 'srt:', 'http:', 'https:'];
      return allowed.includes(parsed.protocol);
    } catch (err) {
      return false;
    }
  }

  async remove(id: string) {
    try {
      const camera = await this.cameraRepository.findOne({ where: { id } });
      if (!camera) throw new NotFoundException(`Cámara con ID ${id} no encontrada`);

      const registerEnabled = (process.env.CAMERAS_REGISTER_IN_MEDIAMTX || '').toLowerCase() === 'true';
      const strict = (process.env.CAMERAS_STRICT_REGISTRATION || '').toLowerCase() === 'true';
      const mount = camera.mountPath && camera.mountPath.length > 0 ? camera.mountPath : camera.id;

      // If strict mode and registerEnabled, require successful deregistration before delete
      if (registerEnabled && strict && this.mediamtxService && this.dataSource) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
          await this.mediamtxService.deregisterSource(mount);
          await queryRunner.manager.delete(Camera, id);
          await queryRunner.commitTransaction();
          // notify worker manager to unregister LPR for this camera (best-effort)
          try {
            if (this.workerNotifier) await this.workerNotifier.unregisterCamera(id);
          } catch (err) {
            this.logger.warn(`No se pudo notificar al worker manager para desregistrar cámara tras delete (strict): ${err?.message || err}`);
          }
          return { message: 'Cámara eliminada' };
        } catch (err) {
          await queryRunner.rollbackTransaction();
          this.logger.warn(`Deregistro estricto falló durante eliminación: ${err?.message || err}`);
          throw new InternalServerErrorException('No fue posible eliminar la cámara porque no se pudo deregistrar en MediaMTX');
        } finally {
          await queryRunner.release();
        }
      }

      // Non-strict/default behaviour: best-effort deregister then delete
      if (registerEnabled && this.mediamtxService) {
        try {
          this.logger.log(`Intentando deregistrar path '${mount}' en MediaMTX antes de eliminar la cámara ${id}`);
          await this.mediamtxService.deregisterSource(mount);
          this.logger.log(`Path '${mount}' deregistrado en MediaMTX`);
        } catch (err) {
          this.logger.warn(`Fallo al deregistrar path '${mount}' en MediaMTX: ${err?.message || err}`);
        }
      }

      const result = await this.cameraRepository.delete(id);
      if (result.affected === 0) throw new NotFoundException(`Cámara con ID ${id} no encontrada`);
      // notify worker manager to unregister LPR for this camera (best-effort)
      try {
        if (this.workerNotifier) await this.workerNotifier.unregisterCamera(id);
      } catch (err) {
        this.logger.warn(`No se pudo notificar al worker manager para desregistrar cámara tras delete: ${err?.message || err}`);
      }
      return { message: 'Cámara eliminada' };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Error al eliminar la cámara');
    }
  }

  /** Reintenta registrar la cámara en MediaMTX (pull). Devuelve true si fue registrado. */
  async registerInMediamtx(cameraId: string): Promise<boolean> {
    const camera = await this.resolveCameraByIdOrMount(cameraId);
    if (!camera) throw new NotFoundException(`Cámara con ID o mount '${cameraId}' no encontrada`);
    const decrypted = await this.getDecryptedSourceUrl(camera.id);
    const mount = camera.mountPath && camera.mountPath.length > 0 ? camera.mountPath : camera.id;
    if (!decrypted) throw new InternalServerErrorException('No existe sourceUrl para esta cámara');
    if (!this.mediamtxService) throw new InternalServerErrorException('MediamtxService no configurado');
    try {
      await this.mediamtxService.registerSource(mount, decrypted);
      camera.registeredInMediamtx = true;
      await this.cameraRepository.save(camera);
      // if camera has LPR enabled, notify worker manager to (re)start analysis
      try {
        if (camera.enableLpr && this.workerNotifier) {
          await this.workerNotifier.registerCamera(camera.id, decrypted, mount);
        }
      } catch (err) {
        this.logger.warn(`No se pudo notificar al worker manager tras registerInMediamtx: ${err?.message || err}`);
      }
      return true;
    } catch (err) {
      camera.registeredInMediamtx = false;
      await this.cameraRepository.save(camera);
      return false;
    }
  }

  /**
  /** Comprueba si un usuario (por roles) tiene acceso a la cámara indicada.
   * userRoles: array de Role objects o role ids
   */
  async userHasAccessToCameraByRoles(cameraId: string, userRoleIds: string[]) {
    const camera = await this.resolveCameraByIdOrMount(cameraId);
    if (!camera) return false;
    if (!camera.roles || camera.roles.length === 0) return false;

    const camRoleIds = camera.roles.map((r) => r.id);
    return userRoleIds.some((rid) => camRoleIds.includes(rid));
  }

  /** Devuelve la URL desencriptada si existe, o null. cameraId puede ser id o mountPath */
  async getDecryptedSourceUrl(cameraId: string): Promise<string | null> {
    const camera = await this.resolveCameraByIdOrMount(cameraId);
    if (!camera || !camera.encryptedSourceUrl) return null;
    try {
      return decryptString(camera.encryptedSourceUrl);
    } catch (err) {
      throw new InternalServerErrorException('Error al desencriptar sourceUrl');
    }
  }

  /** Indica si la cámara tiene un sourceUrl guardado (sin desencriptar) */
  async hasSource(cameraId: string): Promise<boolean> {
    const camera = await this.resolveCameraByIdOrMount(cameraId);
    if (!camera) throw new NotFoundException(`Cámara con ID o mount '${cameraId}' no encontrada`);
    return !!camera.encryptedSourceUrl;
  }

  /** Devuelve el mountPath a usar en MediaMTX. Si mountPath no está definido usa el id de la cámara */
  async getMountPath(cameraId: string): Promise<string> {
    const camera = await this.resolveCameraByIdOrMount(cameraId);
    if (!camera) return cameraId.replace(/^\/+/, '');
    return (camera.mountPath && camera.mountPath.length > 0) ? camera.mountPath : camera.id;
  }
}

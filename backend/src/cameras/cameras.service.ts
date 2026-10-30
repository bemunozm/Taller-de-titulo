import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CreateCameraDto } from './dto/create-camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';
import {
  toStoredLprSettings,
  type LprSettingsDto,
} from './dto/lpr-settings.dto';
import type { LprSettings, WorkerLprSettingsView } from './lpr-settings';
import { Camera } from './entities/camera.entity';
import {
  normalizeGuardianZones,
  type GuardianZoneConfig,
} from './guardian-zones';
import { Role } from 'src/roles/entities/role.entity';
import { encryptString, decryptString } from 'src/utils/crypto.util';
import { MediamtxService } from 'src/mediamtx/mediamtx.service';
import { WorkerNotifierService } from 'src/workers/worker-notifier.service';
import { v4 as uuidv4 } from 'uuid';
import { TenantContextService } from 'src/common/tenant/tenant-context.service';
import { scopeWhere } from 'src/common/tenant/tenant-context.util';

/**
 * Fase 4 · P5.B (D12): todo método que atiende una request HTTP resuelve la
 * cámara ACOTADA al condominio del actor (`TenantContextService` +
 * `scopeWhere`, super-admin: todas). Una cámara de otro condominio responde
 * 404, igual que una inexistente (no revela su existencia).
 *
 * Variantes SIN scope, solo para callers internos sin contexto de actor:
 *  - `getCameraByIdOrMount`: `CameraViewGuard`, que compara él mismo el
 *    condominio de la cámara con el del actor (ver su docstring).
 *  - `findAllByOrganization` / `getDecryptedSourceUrlForOrganization`:
 *    `WorkersController` (API key de servicio), con el condominio EXPLÍCITO de
 *    la key.
 */
@Injectable()
export class CamerasService {
  private readonly logger = new Logger(CamerasService.name);
  constructor(
    @InjectRepository(Camera)
    private readonly cameraRepository: Repository<Camera>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    // Tarea #19 / P5.B: scoping por tenant de todo método de request (ver
    // docstring de la clase).
    private readonly tenantContext: TenantContextService,
    private readonly mediamtxService?: MediamtxService,
    private readonly dataSource?: DataSource,
    private readonly workerNotifier?: WorkerNotifierService,
  ) {}

  // Ayudante: comprobación rápida tipo UUID v4 para evitar consultar la columna UUID con cadenas no UUID
  private isUuid(val: string) {
    if (!val || typeof val !== 'string') return false;
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      val,
    );
  }

  /**
   * Cámara por id (UUID) o mountPath, ACOTADA al condominio del actor de la
   * request (super-admin: cualquiera). `null` si no existe o es de otro
   * condominio. Limpia el sufijo `_guardia` del worker manager, igual que
   * `resolveCameraByIdOrMount`.
   */
  private async loadScoped(cameraIdOrMount: string): Promise<Camera | null> {
    if (!cameraIdOrMount || typeof cameraIdOrMount !== 'string') return null;
    const ctx = await this.tenantContext.getContext();
    const cleanId = cameraIdOrMount.replace('_guardia', '');

    if (this.isUuid(cleanId)) {
      const byId = await this.cameraRepository.findOne({
        where: scopeWhere({ id: cleanId }, ctx),
        relations: ['roles'],
      });
      if (byId) return byId;
    }
    return this.cameraRepository.findOne({
      where: scopeWhere({ mountPath: cleanId }, ctx),
      relations: ['roles'],
    });
  }

  /** Igual que `loadScoped`, pero 404 si no existe o es de otro condominio. */
  private async loadScopedOrFail(cameraIdOrMount: string): Promise<Camera> {
    const camera = await this.loadScoped(cameraIdOrMount);
    if (!camera) {
      throw new NotFoundException(
        `Cámara con ID o mount '${cameraIdOrMount}' no encontrada`,
      );
    }
    return camera;
  }

  /** URL de origen descifrada de una cámara ya cargada (`null` si no tiene). */
  private decryptSourceOf(
    camera: Pick<Camera, 'encryptedSourceUrl'>,
  ): string | null {
    if (!camera.encryptedSourceUrl) return null;
    try {
      return decryptString(camera.encryptedSourceUrl);
    } catch {
      // Sin detalle del error: podría incluir datos del payload cifrado.
      throw new InternalServerErrorException('Error al desencriptar sourceUrl');
    }
  }

  /**
   * Resuelve una cámara por su id (UUID) o por su mountPath (slug), SIN scope
   * de tenant. Devuelve null si no existe. Solo para las variantes internas
   * listadas en el docstring de la clase.
   */
  private async resolveCameraByIdOrMount(cameraIdOrMount: string) {
    if (!cameraIdOrMount) return null;

    // El worker manager usa un ID con sufijo '_guardia' para evitar colisiones.
    // Lo limpiamos para buscar en la BD.
    const cleanId = cameraIdOrMount.replace('_guardia', '');

    // Intentar por id cuando el valor parezca un UUID
    if (this.isUuid(cleanId)) {
      const byId = await this.cameraRepository.findOne({
        where: { id: cleanId },
        relations: ['roles'],
      });
      if (byId) return byId;
    }
    // Alternativa: intentar por mountPath
    const byMount = await this.cameraRepository.findOne({
      where: { mountPath: cleanId },
      relations: ['roles'],
    });
    if (byMount) return byMount;

    // Como último recurso, si el input parecía un UUID pero lo anterior falló, intentar por id sin relaciones
    if (this.isUuid(cleanId)) {
      return await this.cameraRepository.findOne({ where: { id: cleanId } });
    }
    return null;
  }

  /**
   * Entidad cámara por id o mountPath (null si no existe), SIN scope de
   * tenant. Solo para `CameraViewGuard`, que compara el condominio de la
   * cámara con el del actor antes de cualquier otro chequeo.
   */
  async getCameraByIdOrMount(cameraIdOrMount: string) {
    return await this.resolveCameraByIdOrMount(cameraIdOrMount);
  }

  async create(createCameraDto: CreateCameraDto) {
    const {
      roleIds,
      organizationId: requestedOrganizationId,
      ...data
    } = createCameraDto;
    // Fase 4 · P5.C (creación estricta), ANTES del try (que convierte en 500
    // todo lo que no sea 400): el condominio es el del actor; el super-admin
    // debe indicar `organizationId` (400 sin él; 403 si lo envía otro actor o
    // si el actor no tiene condominio).
    const organizationId =
      await this.tenantContext.resolveCreationOrganizationId(
        requestedOrganizationId,
      );
    try {
      const camera = this.cameraRepository.create(data);
      camera.organizationId = organizationId;

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

      const registerEnabled =
        (process.env.CAMERAS_REGISTER_IN_MEDIAMTX || '').toLowerCase() ===
        'true';
      const strict =
        (process.env.CAMERAS_STRICT_REGISTRATION || '').toLowerCase() ===
        'true';

      // Si el modo strict está activado, usar una transacción en la BD y requerir el registro en MediaMTX
      if (
        registerEnabled &&
        strict &&
        this.mediamtxService &&
        this.dataSource
      ) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
          const savedTx = await queryRunner.manager.save(camera);
          const mount =
            savedTx.mountPath && savedTx.mountPath.length > 0
              ? savedTx.mountPath
              : savedTx.id;
          const decrypted = data.sourceUrl
            ? data.sourceUrl
            : this.decryptSourceOf(savedTx);
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
              this.logger.error(
                `Commit falló y el cleanup (deregister) también falló para mount '${mount}': ${cleanupErr?.message || cleanupErr}`,
              );
            }
            throw commitErr;
          }
        } catch (err) {
          await queryRunner.rollbackTransaction();
          // rethrow as user-friendly error
          this.logger.warn(
            `Registro estricto falló durante la creación: ${err?.message || err}`,
          );
          throw new InternalServerErrorException(
            'No fue posible registrar la cámara en MediaMTX. Operación cancelada.',
          );
        } finally {
          await queryRunner.release();
        }
      }

      // Comportamiento por defecto (no strict): guardar e intentar el registro de forma best-effort
      const saved = await this.cameraRepository.save(camera);
      // notify worker manager if LPR or Guardian enabled
      try {
        if (this.workerNotifier) {
          const decrypted = this.decryptSourceOf(saved);
          if (saved.enableLpr) {
            await this.workerNotifier.registerCamera(
              saved.id,
              decrypted || '',
              saved.mountPath,
            );
          }
          if (saved.enableGuardian) {
            await this.workerNotifier.registerCamera(
              `${saved.id}_guardia`,
              decrypted || '',
              saved.mountPath,
              'guardia',
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          `No se pudo notificar al worker manager tras crear cámara: ${err?.message || err}`,
        );
      }
      if (registerEnabled && this.mediamtxService) {
        try {
          const mount =
            saved.mountPath && saved.mountPath.length > 0
              ? saved.mountPath
              : saved.id;
          const decrypted = this.decryptSourceOf(saved);
          if (decrypted) {
            await this.mediamtxService.registerSource(mount, decrypted);
            // marcar flag persistente
            saved.registeredInMediamtx = true;
            await this.cameraRepository.save(saved);
          }
        } catch (err) {
          this.logger.warn(
            `Fallo al registrar cámara en MediaMTX (no-strict): ${err?.message || err}`,
          );
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

  private async generateUniqueMountPath(
    base: string,
    excludeId?: string,
  ): Promise<string> {
    let attempt = 0;
    let candidate = base;
    while (true) {
      const existing = await this.cameraRepository.findOne({
        where: { mountPath: candidate },
      });
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
      const ctx = await this.tenantContext.getContext();
      return await this.cameraRepository.find({
        where: scopeWhere({}, ctx),
        relations: ['roles'],
        order: { name: 'ASC' },
      });
    } catch (error) {
      throw new InternalServerErrorException('Error al obtener cámaras');
    }
  }

  async findOne(id: string) {
    try {
      const ctx = await this.tenantContext.getContext();
      const camera = await this.cameraRepository.findOne({
        where: scopeWhere({ id }, ctx),
        relations: ['roles'],
      });
      if (!camera)
        throw new NotFoundException(`Cámara con ID ${id} no encontrada`);
      return camera;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Error al obtener la cámara');
    }
  }

  async update(id: string, updateCameraDto: UpdateCameraDto) {
    try {
      const ctx = await this.tenantContext.getContext();
      const camera = await this.cameraRepository.findOne({
        where: scopeWhere({ id }, ctx),
        relations: ['roles'],
      });
      if (!camera)
        throw new NotFoundException(`Cámara con ID ${id} no encontrada`);

      const { roleIds, ...data } = updateCameraDto;

      const oldDecrypted = camera.encryptedSourceUrl
        ? decryptString(camera.encryptedSourceUrl)
        : null;
      const oldMount =
        camera.mountPath && camera.mountPath.length > 0
          ? camera.mountPath
          : camera.id;

      // Evitar cambiar mountPath via update (autoslug gestionado por el sistema)
      if (data.mountPath) {
        delete data.mountPath;
      }

      Object.assign(camera, data);

      // Si el nombre cambió y mountPath no está bloqueado explícitamente, regenerar mountPath
      if (data.name && !data.mountPath) {
        const desired = this.slugify(data.name);
        camera.mountPath = await this.generateUniqueMountPath(
          desired,
          camera.id,
        );
      }

      if (data.sourceUrl) {
        // validar sourceUrl antes de guardar
        if (!this.isValidSourceUrl(data.sourceUrl)) {
          throw new BadRequestException(
            'sourceUrl inválida. Debe usar esquemas permitidos (rtsp, rtmp, srt, http, https)',
          );
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
        const newMountCandidate = await this.generateUniqueMountPath(
          desired,
          camera.id,
        );
        if (newMountCandidate !== oldMount) {
          willChangeMount = true;
          camera.mountPath = newMountCandidate;
        }
      }

      const registerEnabled =
        (process.env.CAMERAS_REGISTER_IN_MEDIAMTX || '').toLowerCase() ===
        'true';
      const strict =
        (process.env.CAMERAS_STRICT_REGISTRATION || '').toLowerCase() ===
        'true';

      // Si strict + registerEnabled, realizar la actualización dentro de una transacción y requerir operaciones en mediamtx
      if (
        registerEnabled &&
        strict &&
        this.mediamtxService &&
        this.dataSource
      ) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
          const savedTx = await queryRunner.manager.save(camera);
          const newMount =
            savedTx.mountPath && savedTx.mountPath.length > 0
              ? savedTx.mountPath
              : savedTx.id;
          const newDecrypted = data.sourceUrl
            ? data.sourceUrl
            : this.decryptSourceOf(savedTx);

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
            const sourceChanged =
              data.sourceUrl && oldDecrypted !== data.sourceUrl;
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
              const cleanupMount =
                savedTx.mountPath && savedTx.mountPath.length > 0
                  ? savedTx.mountPath
                  : savedTx.id;
              await this.mediamtxService.deregisterSource(cleanupMount);
            } catch (cleanupErr) {
              this.logger.error(
                `Commit falló y el cleanup (deregister) también falló para mount tras update: ${cleanupErr?.message || cleanupErr}`,
              );
            }
            throw commitErr;
          }
        } catch (err) {
          await queryRunner.rollbackTransaction();
          this.logger.warn(
            `Registro estricto falló durante update: ${err?.message || err}`,
          );
          throw new InternalServerErrorException(
            'No fue posible actualizar la cámara en MediaMTX. Operación cancelada.',
          );
        } finally {
          await queryRunner.release();
        }
      }

      // Comportamiento por defecto (no strict): guardar e intentar registro/deregistro de forma best-effort
      const saved = await this.cameraRepository.save(camera);
      // notify worker manager about enableLpr changes
      try {
        if (this.workerNotifier) {
          // E10: el manager responde 'already_running' a un register de una
          // cámara viva y el worker seguiría leyendo la URL vieja; si la URL
          // cambió, se da de baja el worker antes de registrarlo de nuevo.
          const sourceChanged =
            Boolean(data.sourceUrl) && oldDecrypted !== data.sourceUrl;
          if (saved.enableLpr) {
            const decrypted = this.decryptSourceOf(saved);
            if (sourceChanged) {
              await this.workerNotifier.unregisterCamera(saved.id);
            }
            await this.workerNotifier.registerCamera(
              saved.id,
              decrypted || '',
              saved.mountPath,
            );
          } else {
            await this.workerNotifier.unregisterCamera(saved.id);
          }

          // Notificar sobre cambios en Guardián Visual
          if (saved.enableGuardian) {
            const decrypted = this.decryptSourceOf(saved);
            if (sourceChanged) {
              await this.workerNotifier.unregisterCamera(`${saved.id}_guardia`);
            }
            await this.workerNotifier.registerCamera(
              `${saved.id}_guardia`,
              decrypted || '',
              saved.mountPath,
              'guardia',
            );
          } else {
            await this.workerNotifier.unregisterCamera(`${saved.id}_guardia`);
          }
        }
      } catch (err) {
        this.logger.warn(
          `No se pudo notificar al worker manager tras actualizar cámara: ${err?.message || err}`,
        );
      }
      if (registerEnabled && this.mediamtxService) {
        try {
          const newMount =
            saved.mountPath && saved.mountPath.length > 0
              ? saved.mountPath
              : saved.id;
          const decrypted = this.decryptSourceOf(saved);
          if (willChangeMount) {
            try {
              await this.mediamtxService.deregisterSource(oldMount);
            } catch (err) {
              this.logger.warn(
                `Fallo al deregistrar el path antiguo en MediaMTX '${oldMount}' tras update: ${err?.message || err}`,
              );
            }
          }
          if (decrypted) {
            try {
              await this.mediamtxService.registerSource(newMount, decrypted);
              saved.registeredInMediamtx = true;
              await this.cameraRepository.save(saved);
            } catch (err) {
              this.logger.warn(
                `Fallo al registrar cámara actualizada en MediaMTX: ${err?.message || err}`,
              );
              saved.registeredInMediamtx = false;
              await this.cameraRepository.save(saved);
            }
          }
        } catch (err) {
          this.logger.warn(
            `Fallo al registrar cámara actualizada en MediaMTX: ${err?.message || err}`,
          );
        }
      }

      return saved;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      )
        throw error;
      throw new InternalServerErrorException('Error al actualizar la cámara');
    }
  }

  private isValidSourceUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const allowed = [
        'rtsp:',
        'rtsps:',
        'rtmp:',
        'rtmps:',
        'srt:',
        'http:',
        'https:',
      ];
      return allowed.includes(parsed.protocol);
    } catch (err) {
      return false;
    }
  }

  async remove(id: string) {
    try {
      // P5.B: acotada al condominio del actor. El DELETE de abajo usa el id
      // de ESTA cámara, ya verificada.
      const ctx = await this.tenantContext.getContext();
      const camera = await this.cameraRepository.findOne({
        where: scopeWhere({ id }, ctx),
      });
      if (!camera)
        throw new NotFoundException(`Cámara con ID ${id} no encontrada`);

      const registerEnabled =
        (process.env.CAMERAS_REGISTER_IN_MEDIAMTX || '').toLowerCase() ===
        'true';
      const strict =
        (process.env.CAMERAS_STRICT_REGISTRATION || '').toLowerCase() ===
        'true';
      const mount =
        camera.mountPath && camera.mountPath.length > 0
          ? camera.mountPath
          : camera.id;

      // If strict mode and registerEnabled, require successful deregistration before delete
      if (
        registerEnabled &&
        strict &&
        this.mediamtxService &&
        this.dataSource
      ) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
          await this.mediamtxService.deregisterSource(mount);
          await queryRunner.manager.delete(Camera, id);
          await queryRunner.commitTransaction();
          // notify worker manager to unregister LPR + Guardián (best-effort)
          await this.unregisterWorkersOf(id, 'tras delete (strict)');
          return { message: 'Cámara eliminada' };
        } catch (err) {
          await queryRunner.rollbackTransaction();
          this.logger.warn(
            `Deregistro estricto falló durante eliminación: ${err?.message || err}`,
          );
          throw new InternalServerErrorException(
            'No fue posible eliminar la cámara porque no se pudo deregistrar en MediaMTX',
          );
        } finally {
          await queryRunner.release();
        }
      }

      // Non-strict/default behaviour: best-effort deregister then delete
      if (registerEnabled && this.mediamtxService) {
        try {
          this.logger.log(
            `Intentando deregistrar path '${mount}' en MediaMTX antes de eliminar la cámara ${id}`,
          );
          await this.mediamtxService.deregisterSource(mount);
          this.logger.log(`Path '${mount}' deregistrado en MediaMTX`);
        } catch (err) {
          this.logger.warn(
            `Fallo al deregistrar path '${mount}' en MediaMTX: ${err?.message || err}`,
          );
        }
      }

      const result = await this.cameraRepository.delete(id);
      if (result.affected === 0)
        throw new NotFoundException(`Cámara con ID ${id} no encontrada`);
      // notify worker manager to unregister LPR + Guardián (best-effort)
      await this.unregisterWorkersOf(id, 'tras delete');
      return { message: 'Cámara eliminada' };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Error al eliminar la cámara');
    }
  }

  /**
   * Desregistra los workers de una cámara borrada: el LPR (`<id>`) y el
   * Guardián (`<id>_guardia`). Best-effort: cada uno en su propio try para
   * que el fallo de uno no deje al otro corriendo contra una cámara que ya no
   * existe. Nunca lanza.
   */
  private async unregisterWorkersOf(
    cameraId: string,
    context: string,
  ): Promise<void> {
    if (!this.workerNotifier) return;
    for (const workerId of [cameraId, `${cameraId}_guardia`]) {
      try {
        await this.workerNotifier.unregisterCamera(workerId);
      } catch (err) {
        this.logger.warn(
          `No se pudo notificar al worker manager para desregistrar ${workerId} ${context}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** Reintenta registrar la cámara en MediaMTX (pull). Devuelve true si fue registrado. */
  async registerInMediamtx(cameraId: string): Promise<boolean> {
    const camera = await this.loadScopedOrFail(cameraId);
    const decrypted = this.decryptSourceOf(camera);
    const mount =
      camera.mountPath && camera.mountPath.length > 0
        ? camera.mountPath
        : camera.id;
    if (!decrypted)
      throw new InternalServerErrorException(
        'No existe sourceUrl para esta cámara',
      );
    if (!this.mediamtxService)
      throw new InternalServerErrorException('MediamtxService no configurado');
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
        this.logger.warn(
          `No se pudo notificar al worker manager tras registerInMediamtx: ${err?.message || err}`,
        );
      }
      return true;
    } catch (err) {
      camera.registeredInMediamtx = false;
      await this.cameraRepository.save(camera);
      return false;
    }
  }

  /**
   * Fase 4 · P6.M (corrección QA): vuelve a registrar en MediaMTX una cámara
   * ACTIVA del condominio del actor (otra o inexistente: 404), con su URL
   * descifrada. Lo usa el forward WHEP cuando MediaMTX responde que el path no
   * existe (los paths viven en memoria y se pierden al reiniciarlo). A
   * diferencia de `registerInMediamtx`, no avisa al manager LPR: la cámara no
   * cambió. Actualiza `registeredInMediamtx`. `true` si quedó registrada.
   */
  async reregisterInMediamtx(cameraIdOrMount: string): Promise<boolean> {
    const camera = await this.loadScopedOrFail(cameraIdOrMount);
    if (!camera.active || !this.mediamtxService) {
      return false;
    }
    let source: string | null;
    try {
      source = this.decryptSourceOf(camera);
    } catch {
      this.logger.warn(
        `No se pudo descifrar la fuente de la cámara ${camera.id}: no se re-registra`,
      );
      return false;
    }
    if (!source) {
      return false;
    }
    const mount =
      camera.mountPath && camera.mountPath.length > 0
        ? camera.mountPath
        : camera.id;
    let registered = false;
    try {
      await this.mediamtxService.registerSource(mount, source);
      registered = true;
    } catch {
      // `registerSource` ya logueó el motivo (redactado).
      registered = false;
    }
    if (camera.registeredInMediamtx !== registered) {
      await this.cameraRepository.update(
        { id: camera.id },
        { registeredInMediamtx: registered },
      );
    }
    return registered;
  }

  /**
   * URL de origen descifrada (credencial RTSP) de una cámara del condominio
   * del actor, o `null` si no tiene. Otro condominio o inexistente: 404.
   * `cameraId` puede ser id o mountPath. La ruta HTTP exige `cameras.update`.
   */
  async getDecryptedSourceUrl(cameraId: string): Promise<string | null> {
    const camera = await this.loadScopedOrFail(cameraId);
    return this.decryptSourceOf(camera);
  }

  /**
   * Cámaras ACTIVAS de UN condominio, para credenciales de máquina (service
   * API key del manager LPR). No usa `TenantContextService`: el endpoint de
   * workers no tiene `request.user`, el condominio viene de los
   * `permissions` de la key. Las cámaras inactivas se excluyen: el manager
   * solo las usa para arrancar análisis, y una cámara desactivada no debe
   * analizarse.
   */
  async findAllByOrganization(organizationId: string): Promise<Camera[]> {
    try {
      return await this.cameraRepository.find({
        where: { organizationId, active: true },
        order: { name: 'ASC' },
      });
    } catch (error) {
      this.logger.error(
        'Error al listar cámaras por organización',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException('Error al obtener cámaras');
    }
  }

  /**
   * Ids de TODAS las cámaras de un condominio (activas o no). Lo usa
   * `GET /workers/ia-health` para acotar el estado de los workers al
   * condominio del actor (corrección P5, cyber B4).
   */
  async findIdsByOrganization(organizationId: string): Promise<string[]> {
    const cameras = await this.cameraRepository.find({
      where: { organizationId },
      select: { id: true },
    });
    return cameras.map((camera) => camera.id);
  }

  /**
   * Igual que `getDecryptedSourceUrl` pero acotado a un condominio EXPLÍCITO
   * (el de la API key de servicio, sin actor humano): una cámara de otra
   * organización responde como inexistente (404, sin filtrar su existencia).
   * `cameraId` puede ser id o mountPath.
   */
  async getDecryptedSourceUrlForOrganization(
    cameraId: string,
    organizationId: string,
  ): Promise<string | null> {
    const camera = await this.resolveCameraByIdOrMount(cameraId);
    if (!camera || camera.organizationId !== organizationId) {
      throw new NotFoundException(`Cámara '${cameraId}' no encontrada`);
    }
    if (!camera.encryptedSourceUrl) return null;
    try {
      return decryptString(camera.encryptedSourceUrl);
    } catch {
      // Sin detalle del error: podría incluir datos del payload cifrado.
      throw new InternalServerErrorException('Error al desencriptar sourceUrl');
    }
  }

  /** Indica si la cámara (del condominio del actor) tiene un sourceUrl guardado (sin desencriptar) */
  async hasSource(cameraId: string): Promise<boolean> {
    const camera = await this.loadScopedOrFail(cameraId);
    return !!camera.encryptedSourceUrl;
  }

  /** Actualiza el estado de LPR (reconocimiento de placas) de una cámara */
  async updateLprStatus(cameraId: string, enableLpr: boolean) {
    try {
      const camera = await this.loadScopedOrFail(cameraId);

      camera.enableLpr = enableLpr;
      const updated = await this.cameraRepository.save(camera);

      this.logger.log(
        `LPR ${enableLpr ? 'habilitado' : 'deshabilitado'} para cámara ${camera.name} (${camera.id})`,
      );

      // Notificar a los workers siguiendo la misma lógica que el método update
      try {
        if (this.workerNotifier) {
          if (enableLpr) {
            // Si se habilita LPR, registrar la cámara en el worker manager
            const decrypted = this.decryptSourceOf(updated);
            await this.workerNotifier.registerCamera(
              updated.id,
              decrypted || '',
              updated.mountPath,
            );
            this.logger.log(
              `Cámara ${updated.id} registrada en worker manager (LPR habilitado)`,
            );
          } else {
            // Si se deshabilita LPR, desregistrar la cámara del worker manager
            await this.workerNotifier.unregisterCamera(updated.id);
            this.logger.log(
              `Cámara ${updated.id} desregistrada del worker manager (LPR deshabilitado)`,
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          `No se pudo notificar al worker manager sobre cambio de LPR: ${err?.message || err}`,
        );
      }

      return {
        id: updated.id,
        name: updated.name,
        enableLpr: updated.enableLpr,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Error al actualizar estado LPR de cámara ${cameraId}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Error al actualizar estado de IA',
      );
    }
  }

  /** Actualiza el estado de Guardián (YOLO Intrusión) de una cámara */
  async updateGuardianStatus(cameraId: string, enableGuardian: boolean) {
    try {
      const camera = await this.loadScopedOrFail(cameraId);

      camera.enableGuardian = enableGuardian;
      const updated = await this.cameraRepository.save(camera);

      this.logger.log(
        `Guardián Visual ${enableGuardian ? 'habilitado' : 'deshabilitado'} para cámara ${camera.name} (${camera.id})`,
      );

      try {
        if (this.workerNotifier) {
          if (enableGuardian) {
            const decrypted = this.decryptSourceOf(updated);
            // El worker manager debe recibir el modo 'guardia' y un ID diferenciado para no colisionar
            await this.workerNotifier.registerCamera(
              `${updated.id}_guardia`,
              decrypted || '',
              updated.mountPath,
              'guardia',
            );
            this.logger.log(
              `Cámara ${updated.id} registrada en worker manager (Guardián Visual)`,
            );
          } else {
            await this.workerNotifier.unregisterCamera(`${updated.id}_guardia`);
            this.logger.log(
              `Cámara ${updated.id} desregistrada del worker manager (Guardián Visual)`,
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          `No se pudo notificar al worker manager sobre cambio de Guardián: ${err?.message || err}`,
        );
      }

      return {
        id: updated.id,
        name: updated.name,
        enableGuardian: updated.enableGuardian,
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(
        `Error al actualizar estado Guardián de cámara ${cameraId}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Error al actualizar Guardián Visual',
      );
    }
  }

  /**
   * Actualiza los polígonos/zonas del Guardián Visual. Fase 4 · P9: `zones`
   * llega validado por `UpdateGuardianZonesDto`; se guardan siempre en
   * formato nuevo (`{ points, type, loiterSeconds? }`, solo `x`/`y` en los
   * puntos). Se normaliza otra vez acá por si el llamador no pasó por el DTO
   * (zonas legacy `[[{x,y}]]` pasan a `type: 'intrusion'`).
   */
  async updateGuardianZones(cameraId: string, zones: unknown) {
    try {
      const camera = await this.loadScopedOrFail(cameraId);

      camera.guardianZones = normalizeGuardianZones(zones).map(
        (zone): GuardianZoneConfig => ({
          points: zone.points.map(({ x, y }) => ({ x, y })),
          type: zone.type,
          ...(zone.loiterSeconds !== undefined
            ? { loiterSeconds: zone.loiterSeconds }
            : {}),
        }),
      );
      const updated = await this.cameraRepository.save(camera);

      this.logger.log(
        `Zonas de Guardián actualizadas para la cámara ${camera.name} (${camera.id})`,
      );

      // Opcional: Reiniciar el worker o notificarle en vivo sobre los nuevos polígonos

      return {
        id: updated.id,
        name: updated.name,
        guardianZones: updated.guardianZones,
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(
        `Error al actualizar zonas en la cámara ${cameraId}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Error al guardar las zonas de intrusión',
      );
    }
  }

  /**
   * Reemplaza la configuración de visión LPR de una cámara del condominio del
   * actor. `dto` llega validado por `UpdateLprSettingsDto`; `{}` la resetea
   * a `null` (= defaults del worker). NO notifica al worker manager: el
   * worker hace pull de `GET /workers/cameras/:id/lpr-settings`.
   */
  async updateLprSettings(cameraId: string, dto: LprSettingsDto) {
    const camera = await this.loadScopedOrFail(cameraId);
    camera.lprSettings = toStoredLprSettings(dto);
    try {
      const updated = await this.cameraRepository.save(camera);
      this.logger.log(
        `Configuración LPR actualizada para la cámara ${camera.name} (${camera.id})`,
      );
      return {
        id: updated.id,
        name: updated.name,
        enableLpr: updated.enableLpr,
        lprSettings: updated.lprSettings,
      };
    } catch (error) {
      this.logger.error(
        `Error al guardar la configuración LPR de la cámara ${cameraId}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Error al guardar la configuración LPR',
      );
    }
  }

  /** Configuración de visión LPR de una cámara del condominio del actor. */
  async getLprSettings(cameraId: string): Promise<{
    id: string;
    name: string;
    enableLpr: boolean;
    lprSettings: LprSettings | null;
  }> {
    const camera = await this.loadScopedOrFail(cameraId);
    return {
      id: camera.id,
      name: camera.name,
      enableLpr: camera.enableLpr,
      lprSettings: camera.lprSettings ?? null,
    };
  }

  /**
   * Igual que `getLprSettings` pero acotado a un condominio EXPLÍCITO (el de
   * la API key de servicio, sin actor humano): una cámara de otra
   * organización responde como inexistente (404). `cameraId` puede ser id o
   * mountPath. Solo devuelve la configuración: nunca la URL de origen ni roles.
   */
  async getLprSettingsForOrganization(
    cameraId: string,
    organizationId: string,
  ): Promise<WorkerLprSettingsView> {
    const camera = await this.resolveCameraByIdOrMount(cameraId);
    if (!camera || camera.organizationId !== organizationId) {
      throw new NotFoundException(`Cámara '${cameraId}' no encontrada`);
    }
    return {
      cameraId: camera.id,
      enableLpr: camera.enableLpr,
      lprSettings: camera.lprSettings ?? null,
    };
  }

  /**
   * mountPath a usar en MediaMTX para una cámara del condominio del actor (si
   * no tiene mountPath, su id). Otro condominio o inexistente: 404. Antes caía
   * al string crudo del cliente, que podía apuntar a cualquier path de
   * MediaMTX.
   */
  async getMountPath(cameraId: string): Promise<string> {
    const camera = await this.loadScopedOrFail(cameraId);
    return camera.mountPath && camera.mountPath.length > 0
      ? camera.mountPath
      : camera.id;
  }
}

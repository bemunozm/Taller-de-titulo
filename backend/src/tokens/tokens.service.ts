import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Token } from './entities/token.entity';

/**
 * Tabla `Token` legacy (códigos de 6 dígitos). Ya no autentica nada: la
 * verificación de cuenta y el reset de contraseña los hace better-auth
 * (tarea #18). Fase 4 · P9: se retiró `TokensController` (CRUD sin alcance
 * por condominio) junto con los métodos que solo él usaba. Queda la limpieza
 * de filas vencidas que corre `ExpirationService`. La entidad se mantiene: la
 * tabla la crea la migración base (`InitialSchema`) y sacarla exige una
 * migración propia.
 */
@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(
    @InjectRepository(Token)
    private readonly tokenRepository: Repository<Token>,
  ) {}

  /**
   * Elimina todos los tokens expirados de la base de datos
   * Este método puede ser llamado periódicamente para limpiar tokens antiguos
   */
  async cleanupExpiredTokens(): Promise<number> {
    try {
      const expiredTokens = await this.tokenRepository.find({
        where: {
          expiresAt: LessThan(new Date()),
        },
      });

      if (expiredTokens.length > 0) {
        await this.tokenRepository.remove(expiredTokens);
        this.logger.log(
          `Se eliminaron ${expiredTokens.length} tokens expirados`,
        );
        return expiredTokens.length;
      }

      return 0;
    } catch (error) {
      this.logger.error(
        'Error al limpiar tokens expirados',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'Error al limpiar tokens expirados',
      );
    }
  }
}

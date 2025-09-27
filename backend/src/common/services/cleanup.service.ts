import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TokensService } from '../../tokens/tokens.service';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(private readonly tokensService: TokensService) {}

  /**
   * Ejecuta la limpieza de tokens expirados cada hora
   * Puedes ajustar la frecuencia cambiando el CronExpression
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleTokenCleanup() {
    this.logger.log('Iniciando limpieza de tokens expirados...');
    
    try {
      const removedCount = await this.tokensService.cleanupExpiredTokens();
      
      if (removedCount > 0) {
        this.logger.log(`Limpieza completada: se eliminaron ${removedCount} tokens expirados`);
      } else {
        this.logger.log('Limpieza completada: no se encontraron tokens expirados');
      }
    } catch (error) {
      this.logger.error('Error durante la limpieza de tokens:', error);
    }
  }

  /**
   * Ejecuta una limpieza manual de tokens expirados
   * Puede ser llamada desde un endpoint para fines de administración
   */
  async manualTokenCleanup(): Promise<{ removedCount: number; message: string }> {
    try {
      const removedCount = await this.tokensService.cleanupExpiredTokens();
      const message = removedCount > 0 
        ? `Se eliminaron ${removedCount} tokens expirados` 
        : 'No se encontraron tokens expirados';
        
      return { removedCount, message };
    } catch (error) {
      this.logger.error('Error durante la limpieza manual:', error);
      throw error;
    }
  }
}
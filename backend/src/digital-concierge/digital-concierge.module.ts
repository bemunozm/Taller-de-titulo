import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DigitalConciergeController } from './digital-concierge.controller';
import { DigitalConciergeService } from './services/digital-concierge.service';
import { RealtimeVoiceTokenService } from './services/realtime-voice-token.service';
import { ConciergeSession } from './entities/concierge-session.entity';
import { UsersModule } from '../users/users.module';
import { FamiliesModule } from '../families/families.module';
import { VisitsModule } from '../visits/visits.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SmsService } from '../common/services/sms.service';
import { QRCodeService } from '../common/services/qrcode.service';
import { MailerModule } from '@nestjs-modules/mailer';
import { HubModule } from '../hub/hub.module';
import { AuthModule } from '../auth/auth.module';
import { AgentModule } from '../agent/agent.module';
import { ConciergeAuthGuard } from './guards/concierge-auth.guard';

/**
 * `forwardRef(() => AgentModule)` (Fase 1, Bloque A2b —
 * docs/modulos/agente-cerebro.md §10.2 paso 4): `DigitalConciergeController`
 * ahora despacha `execute-tool` por el catálogo (`ToolDispatcherService` +
 * `ToolRegistryService` + `AuthorizedContextFactory`, exportados por
 * `AgentModule`) en vez del `switch` legacy. `AgentModule`, a su vez, importa
 * ESTE módulo (también con `forwardRef`) porque sus tools nuevas
 * (guardar_datos_visitante, notificar_residente, reenviar_notificacion,
 * finalizar_llamada) inyectan `DigitalConciergeService`. Ver el docstring de
 * `AgentModule` para el detalle de por qué `forwardRef` es seguro acá (ciclo
 * de MÓDULOS, no de providers).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ConciergeSession]),
    UsersModule,
    FamiliesModule,
    VisitsModule,
    NotificationsModule,
    MailerModule, // Necesario para SmsService
    HubModule,    // Añadido HubModule — también provee HubAuthGuard
    AuthModule,   // Fase 1, Bloque A1 — provee AuthGuard para ConciergeAuthGuard
    forwardRef(() => AgentModule),
  ],
  controllers: [DigitalConciergeController],
  providers: [
    DigitalConciergeService,
    RealtimeVoiceTokenService,
    SmsService,
    QRCodeService,
    ConciergeAuthGuard,
  ],
  exports: [DigitalConciergeService, RealtimeVoiceTokenService],
})
export class DigitalConciergeModule {}

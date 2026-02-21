import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DigitalConciergeController } from './digital-concierge.controller';
import { DigitalConciergeService } from './services/digital-concierge.service';
import { OpenAITokenService } from './services/openai-token.service';
import { ConciergeSession } from './entities/concierge-session.entity';
import { UsersModule } from '../users/users.module';
import { FamiliesModule } from '../families/families.module';
import { VisitsModule } from '../visits/visits.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SmsService } from '../common/services/sms.service';
import { QRCodeService } from '../common/services/qrcode.service';
import { MailerModule } from '@nestjs-modules/mailer';
import { HubModule } from '../hub/hub.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConciergeSession]),
    UsersModule,
    FamiliesModule,
    VisitsModule,
    NotificationsModule,
    MailerModule, // Necesario para SmsService
    HubModule,    // Añadido HubModule
  ],
  controllers: [DigitalConciergeController],
  providers: [
    DigitalConciergeService,
    OpenAITokenService,
    SmsService,
    QRCodeService,
  ],
  exports: [DigitalConciergeService],
})
export class DigitalConciergeModule {}

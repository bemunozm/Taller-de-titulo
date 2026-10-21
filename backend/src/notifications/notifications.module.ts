import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { Notification } from './entities/notification.entity';
import { UsersModule } from '../users/users.module';
import { User } from '../users/entities/user.entity';
import { BetterAuthSessionResolver } from '../auth/better-auth-session.resolver';

@Module({
  imports: [
    // User: repositorio de `BetterAuthSessionResolver` (identidad del socket,
    // Fase 4 · P6.R) y de AuthGuard/AuthorizationGuard del controller.
    TypeOrmModule.forFeature([Notification, User]),
    UsersModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsGateway,
    NotificationsService,
    BetterAuthSessionResolver,
  ],
  exports: [NotificationsGateway, NotificationsService],
})
export class NotificationsModule {}

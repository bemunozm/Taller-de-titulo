import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';
import { Unit } from './entities/unit.entity';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { HubModule } from '../hub/hub.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Unit]),
    ConfigModule,
    forwardRef(() => UsersModule),
    forwardRef(() => AuthModule),
    // Fase 1, Bloque A1.1 — provee HubAuthGuard para GET /units/ai-enabled
    // (migrado del check manual de HUB_SECRET al mismo guard de credenciales
    // por-hub que usa /concierge/*, ver units.controller.ts).
    HubModule,
  ],
  controllers: [UnitsController],
  providers: [UnitsService],
  exports: [UnitsService],
})
export class UnitsModule {}

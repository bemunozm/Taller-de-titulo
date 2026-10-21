import { Module, forwardRef } from '@nestjs/common';
import { TokensService } from './tokens.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Token } from './entities/token.entity';
import { UsersModule } from '../users/users.module';

// Fase 4 · P9: sin controller. `TokensController` exponía un CRUD de la tabla
// `Token` sin alcance por condominio y la tabla ya no autentica nada; el
// módulo queda solo para la limpieza de `ExpirationService` (ver
// tokens.service.ts).
@Module({
  imports: [TypeOrmModule.forFeature([Token]), forwardRef(() => UsersModule)],
  providers: [TokensService],
  exports: [TokensService],
})
export class TokensModule {}

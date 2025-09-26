import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from 'src/users/users.module';
import { TokensModule } from 'src/tokens/tokens.module';
import { JwtModule } from '@nestjs/jwt';
import { User } from 'src/users/entities/user.entity';
import { Token } from 'src/tokens/entities/token.entity';
import { AuthEmailService } from './services/auth-email.service';
import { AuthorizationGuard } from './guards/authorization.guard';
import { MailerModule } from '@nestjs-modules/mailer';

@Module({
  imports: [
    UsersModule,
    TokensModule,
    ConfigModule,
    TypeOrmModule.forFeature([User, Token]),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'yourSecretKey',
      signOptions: { expiresIn: '1d' },
    }),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = {
          transport: {
            host: configService.get<string>('SMTP_HOST'),
            port: configService.get<number>('SMTP_PORT'),
            secure: false,
            auth: {
              user: configService.get<string>('SMTP_USER'),
              pass: configService.get<string>('SMTP_PASS'),
            },
          },
          defaults: {
            from: 'UpTask <admin@uptask.com>',
          },
        };
        console.log('Configuración de MailerModule:', {
          host: config.transport.host,
          port: config.transport.port,
          user: config.transport.auth.user,
          from: config.defaults.from
        });
        return config;
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthEmailService, AuthorizationGuard],
  exports: [AuthorizationGuard],
})
export class AuthModule {}

import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_CONFIG, AppConfig, loadConfig } from './configuration';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // .env é carregado antes; loadConfig valida e lança erro se algo estiver inválido
      load: [() => ({ app: loadConfig() })],
    }),
  ],
  providers: [
    {
      provide: APP_CONFIG,
      inject: [ConfigService],
      useFactory: (cs: ConfigService): AppConfig => cs.getOrThrow<AppConfig>('app'),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}

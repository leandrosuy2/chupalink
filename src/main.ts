import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { APP_ROOT, loadConfig } from './config/configuration';
import { createRootLogger, PinoNestLogger } from './common/utils/logger';

async function bootstrap() {
  loadDotenv({ path: join(APP_ROOT, '.env'), quiet: true } as any);
  // Valida antes de qualquer coisa: falha rápido com mensagem clara
  const cfg = loadConfig();
  const root = createRootLogger({ level: cfg.log.level, logPath: cfg.log.path, pretty: cfg.env === 'development' });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new PinoNestLogger(root),
    bufferLogs: true,
  });
  setupApp(app);
  await app.listen(cfg.port, '0.0.0.0');
  const logger = new Logger('Bootstrap');
  logger.log(`ChupaLink API rodando em http://localhost:${cfg.port} (${cfg.env})`);
  logger.log(`Painel do QR Code: http://localhost:${cfg.port}/  ·  Swagger: http://localhost:${cfg.port}/api/docs`);
  logger.log(`Sessões em ${cfg.whatsapp.sessionRoot}/${cfg.whatsapp.sessionName}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`\n❌ Falha ao iniciar a ChupaLink API:\n${err?.message ?? err}\n`);
  process.exit(1);
});

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { join } from 'path';
import { APP_CONFIG, APP_ROOT, AppConfig } from './config/configuration';

/** Configuração HTTP compartilhada entre main.ts e os testes de integração. */
export function setupApp(app: INestApplication): AppConfig {
  const config = app.get<AppConfig>(APP_CONFIG);
  const express = app as NestExpressApplication;

  express.disable('x-powered-by');
  express.set('trust proxy', 'loopback');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
        },
      },
    }),
  );
  app.enableCors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins.length ? config.corsOrigins : false,
    credentials: false,
  });
  express.useBodyParser('json', { limit: '64kb' });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // Só a pasta public/ é servida. storage/ (sessões, downloads, logs) nunca é exposta.
  express.useStaticAssets(join(APP_ROOT, 'public'), { index: 'index.html', dotfiles: 'deny' });

  const doc = new DocumentBuilder()
    .setTitle('ChupaLink API')
    .setDescription('Mandou o link, recebeu o vídeo! — WhatsApp (Baileys) + Instagram/TikTok')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  app.enableShutdownHooks();
  return config;
}

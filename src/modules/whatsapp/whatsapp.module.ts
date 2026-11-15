import { Inject, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import { SessionsModule } from '../sessions/sessions.module';
import { WhatsappConnection } from './whatsapp.connection';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappEvents } from './whatsapp.events';
import { WhatsappGateway } from './whatsapp.gateway';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [SessionsModule],
  controllers: [WhatsappController],
  providers: [WhatsappEvents, WhatsappConnection, WhatsappService, WhatsappGateway],
  exports: [WhatsappEvents, WhatsappService, WhatsappConnection, WhatsappGateway],
})
export class WhatsappModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('WhatsApp');

  constructor(
    private readonly connection: WhatsappConnection,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Ao subir a API, reconecta automaticamente usando a sessão salva (ou gera QR se não houver). */
  async onApplicationBootstrap() {
    if (!this.config.whatsapp.autoConnect) {
      this.logger.log('WHATSAPP_AUTO_CONNECT=false — aguardando POST /api/whatsapp/connect');
      return;
    }
    void this.connection.start();
  }
}

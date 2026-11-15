import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import type { WAMessage } from './baileys';
import { ConnectionSnapshot, QrPayload, WA_EVENTS } from './whatsapp.types';

export interface WhatsappEventMap {
  [WA_EVENTS.STATUS]: ConnectionSnapshot;
  [WA_EVENTS.QR]: QrPayload;
  [WA_EVENTS.CONNECTED]: ConnectionSnapshot;
  [WA_EVENTS.DISCONNECTED]: ConnectionSnapshot;
  [WA_EVENTS.RECONNECTING]: ConnectionSnapshot & { delayMs: number };
  [WA_EVENTS.LOGGED_OUT]: ConnectionSnapshot;
  [WA_EVENTS.ERROR]: ConnectionSnapshot & { message: string };
  [WA_EVENTS.MESSAGE]: WAMessage;
}

/** Barramento de eventos interno tipado entre a conexão, o gateway e o processador de mensagens. */
@Injectable()
export class WhatsappEvents {
  private readonly emitter = new EventEmitter().setMaxListeners(50);

  emit<K extends keyof WhatsappEventMap>(event: K, payload: WhatsappEventMap[K]): void {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof WhatsappEventMap>(event: K, listener: (payload: WhatsappEventMap[K]) => void): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }
}

import { Logger } from '@nestjs/common';
import type { WAMessage, WAMessageKey } from '../whatsapp/baileys';
import { renderStatus, StatusState } from './bot-messages';

export interface StatusSender {
  sendText(jid: string, text: string, quoted?: WAMessage): Promise<{ key?: WAMessageKey } | undefined | void>;
  editText(jid: string, key: WAMessageKey, text: string): Promise<unknown>;
}

/** Intervalo mínimo entre edições (evita flood no WhatsApp). */
export const MIN_EDIT_INTERVAL_MS = 1500;

/**
 * Uma única mensagem de status por link, editada a cada etapa (estilo "bot ao vivo").
 * As operações são serializadas: uma edição nunca ultrapassa o envio inicial.
 * Atualizações de progresso são agrupadas e enviadas no máximo a cada MIN_EDIT_INTERVAL_MS.
 */
export class StatusMessage {
  private static readonly logger = new Logger('Status');
  private state: StatusState;
  private key?: WAMessageKey;
  private chain: Promise<void> = Promise.resolve();
  private lastText?: string;
  private lastEditAt = 0;
  private timer?: NodeJS.Timeout;
  private readonly chosen = new Map<string, string>();
  private readonly startedAt = Date.now();

  constructor(
    private readonly sender: StatusSender,
    private readonly jid: string,
    private readonly quoted: WAMessage | undefined,
    initial: StatusState,
    private readonly random: () => number = Math.random,
    private readonly minIntervalMs = MIN_EDIT_INTERVAL_MS,
  ) {
    this.state = initial;
  }

  get current(): Readonly<StatusState> {
    return this.state;
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  /** Atualiza o estado. `force` envia imediatamente (troca de etapa); senão respeita o intervalo. */
  update(patch: Partial<StatusState>, force = false): Promise<void> {
    this.state = { ...this.state, ...patch };
    const wait = this.lastEditAt + this.minIntervalMs - Date.now();
    if (force || wait <= 0) {
      this.clearTimer();
      return this.flush();
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, wait);
      this.timer.unref?.();
    }
    return this.chain;
  }

  /** Aguarda todas as edições pendentes. */
  async settle(): Promise<void> {
    this.clearTimer();
    await this.flush();
  }

  render(): string {
    return renderStatus(this.state, (k, list) => {
      let v = this.chosen.get(k);
      if (!v) {
        v = list[Math.floor(this.random() * list.length) % list.length];
        this.chosen.set(k, v);
      }
      return v;
    });
  }

  private flush(): Promise<void> {
    this.chain = this.chain.then(async () => {
      const text = this.render();
      if (text === this.lastText) return;
      try {
        if (!this.key) {
          const sent = await this.sender.sendText(this.jid, text, this.quoted);
          this.key = (sent as { key?: WAMessageKey } | undefined)?.key;
        } else {
          await this.sender.editText(this.jid, this.key, text);
        }
        this.lastText = text;
        this.lastEditAt = Date.now();
      } catch (err) {
        StatusMessage.logger.warn(`Falha ao atualizar status: ${(err as Error).message}`);
      }
    });
    return this.chain;
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

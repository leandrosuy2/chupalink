import { BadRequestException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import { WhatsappConnection } from '../whatsapp/whatsapp.connection';

export interface GroupSummary {
  id: string;
  subject: string;
  participants: number;
  owner?: string;
  createdAt?: string;
  announce?: boolean;
  allowed: boolean;
}

const GROUP_JID = /^\d{5,30}(-\d{5,15})?@g\.us$/;

/**
 * Lista de grupos onde o bot atua.
 * Os grupos de WHATSAPP_ALLOWED_GROUPS são sempre permitidos; os adicionados via API
 * ficam salvos em <sessions>/<nome>.groups.json e sobrevivem a reinicializações.
 */
@Injectable()
export class GroupsService implements OnModuleInit {
  private readonly logger = new Logger(GroupsService.name);
  private readonly fromEnv: Set<string>;
  private fromApi = new Set<string>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly connection: WhatsappConnection,
  ) {
    this.fromEnv = new Set(config.whatsapp.allowedGroups);
  }

  private get file() {
    return join(this.config.whatsapp.sessionRoot, `${this.config.whatsapp.sessionName}.groups.json`);
  }

  async onModuleInit() {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.fromApi = new Set((data.allowed ?? []).filter((g: string) => GROUP_JID.test(g)));
    } catch {
      this.fromApi = new Set();
    }
    const all = this.allowed();
    if (!all.length) {
      this.logger.warn('Nenhum grupo autorizado. Configure WHATSAPP_ALLOWED_GROUPS ou POST /api/groups/allowed');
    } else {
      this.logger.log(`Grupos autorizados: ${all.join(', ')}`);
    }
  }

  isAllowed(jid: string): boolean {
    return this.fromEnv.has(jid) || this.fromApi.has(jid);
  }

  allowed(): string[] {
    return [...new Set([...this.fromEnv, ...this.fromApi])];
  }

  allowedDetails() {
    return this.allowed().map((id) => ({ id, source: this.fromEnv.has(id) ? 'env' : 'api' }));
  }

  async allow(jid: string) {
    this.assertGroupJid(jid);
    this.fromApi.add(jid);
    await this.persist();
    this.logger.log(`Grupo autorizado: ${jid}`);
    return this.allowedDetails();
  }

  async disallow(jid: string) {
    this.assertGroupJid(jid);
    if (this.fromEnv.has(jid)) {
      throw new BadRequestException('Esse grupo está em WHATSAPP_ALLOWED_GROUPS; remova-o do .env');
    }
    this.fromApi.delete(jid);
    await this.persist();
    this.logger.log(`Grupo removido da lista: ${jid}`);
    return this.allowedDetails();
  }

  /** Grupos dos quais a conta conectada participa. */
  async listAvailable(): Promise<GroupSummary[]> {
    const groups = await this.connection.fetchAllGroups();
    return groups
      .map((g) => ({
        id: g.id,
        subject: g.subject,
        participants: g.participants?.length ?? 0,
        owner: g.owner ?? undefined,
        createdAt: g.creation ? new Date(g.creation * 1000).toISOString() : undefined,
        announce: g.announce ?? undefined,
        allowed: this.isAllowed(g.id),
      }))
      .sort((a, b) => a.subject.localeCompare(b.subject));
  }

  async getName(jid: string): Promise<string | undefined> {
    try {
      return (await this.connection.groupMetadata(jid)).subject;
    } catch {
      return undefined;
    }
  }

  private assertGroupJid(jid: string) {
    if (!GROUP_JID.test(jid)) throw new BadRequestException('ID de grupo inválido (esperado algo como 1203...@g.us)');
  }

  private async persist() {
    await fs.mkdir(this.config.whatsapp.sessionRoot, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ allowed: [...this.fromApi] }, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }
}

import { BadRequestException, Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { normalizeUrl } from '../../common/utils/links';
import { DownloaderService } from '../downloader/downloader.service';
import { GroupsService } from '../groups/groups.service';
import { EnqueueLinkDto } from './dto/enqueue.dto';
import { MessagesProcessor } from './messages.processor';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class MessagesController {
  constructor(
    private readonly processor: MessagesProcessor,
    private readonly groups: GroupsService,
    private readonly downloader: DownloaderService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Enfileira manualmente um link para ser baixado e enviado a um grupo autorizado' })
  async enqueue(@Body() dto: EnqueueLinkDto) {
    const url = normalizeUrl(dto.url);
    if (!url) throw new BadRequestException('URL inválida');
    if (!this.groups.isAllowed(dto.groupId)) throw new ForbiddenException('Grupo não autorizado');
    if (!this.downloader.isSupported(url)) {
      throw new BadRequestException(`Plataforma não suportada. Suportadas: ${this.downloader.platforms().join(', ')}`);
    }
    const res = await this.processor.enqueueLink(
      { chatJid: dto.groupId, sender: 'api', senderName: 'API', id: `api-${Date.now()}`, raw: undefined as any },
      url,
    );
    return { duplicate: res.duplicate, job: res.job };
  }
}

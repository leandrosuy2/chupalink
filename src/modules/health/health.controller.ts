import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { JobsService } from '../jobs/jobs.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly jobs: JobsService,
  ) {}

  /** Público (para PM2/monitoramento). Não expõe dados da conta. */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Health-check' })
  health() {
    const s = this.whatsapp.status();
    const mem = process.memoryUsage();
    return {
      status: 'ok',
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      whatsapp: { status: s.status, hasSession: s.hasSession },
      jobs: this.jobs.stats(),
      memoryMb: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576) },
    };
  }
}

import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ListJobsDto } from './dto/list-jobs.dto';
import { JobsService } from './jobs.service';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as tarefas (mais recentes primeiro)' })
  list(@Query() q: ListJobsDto) {
    return { stats: this.jobs.stats(), jobs: this.jobs.list(q) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes de uma tarefa' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.get(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancela uma tarefa pendente ou em andamento' })
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.cancel(id);
  }
}

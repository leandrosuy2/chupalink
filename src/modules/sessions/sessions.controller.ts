import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';

@ApiTags('sessions')
@ApiBearerAuth()
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as sessões salvas em disco' })
  list() {
    return this.sessions.list();
  }

  @Get(':name')
  @ApiOperation({ summary: 'Informações de uma sessão (existe? autenticada? arquivos?)' })
  async get(@Param('name') name: string) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new NotFoundException('Sessão não encontrada');
    const info = await this.sessions.getInfo(name);
    if (!info.exists) throw new NotFoundException(`Sessão "${name}" não existe`);
    return info;
  }
}

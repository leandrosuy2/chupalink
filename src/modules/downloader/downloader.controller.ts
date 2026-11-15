import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DownloaderService } from './downloader.service';
import { InspectUrlDto } from './dto/inspect.dto';

@ApiTags('downloader')
@ApiBearerAuth()
@Controller('downloader')
export class DownloaderController {
  constructor(private readonly downloader: DownloaderService) {}

  @Get('platforms')
  @ApiOperation({ summary: 'Plataformas suportadas' })
  platforms() {
    return this.downloader.platforms();
  }

  @Post('inspect')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lê os metadados de um link (título, duração, tamanho) sem baixar' })
  inspect(@Body() dto: InspectUrlDto) {
    return this.downloader.inspect(dto.url);
  }
}

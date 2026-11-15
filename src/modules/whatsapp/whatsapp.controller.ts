import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LogoutDto } from './dto/logout.dto';
import { WhatsappService } from './whatsapp.service';

@ApiTags('whatsapp')
@ApiBearerAuth()
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsapp: WhatsappService) {}

  @Get('status')
  @ApiOperation({ summary: 'Estado atual da conexão' })
  status() {
    return this.whatsapp.status();
  }

  @Get('qr')
  @ApiOperation({ summary: 'QR Code atual (Data URL e base64)' })
  qr() {
    return this.whatsapp.qr();
  }

  @Post('connect')
  @HttpCode(200)
  @ApiOperation({ summary: 'Inicia a conexão (usa a sessão salva; gera QR só se não houver sessão válida)' })
  connect() {
    return this.whatsapp.connect();
  }

  @Post('disconnect')
  @HttpCode(200)
  @ApiOperation({ summary: 'Desconecta sem apagar a sessão salva' })
  disconnect() {
    return this.whatsapp.disconnect();
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Desvincula o aparelho e apaga a sessão local (exige {"confirm":"LOGOUT"})' })
  logout(@Body() dto: LogoutDto) {
    return this.whatsapp.logout(dto.confirm);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Perfil da conta conectada' })
  profile() {
    return this.whatsapp.profile();
  }
}

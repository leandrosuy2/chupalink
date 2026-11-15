import { ApiProperty } from '@nestjs/swagger';
import { IsUrl, MaxLength } from 'class-validator';

export class InspectUrlDto {
  @ApiProperty({ example: 'https://www.tiktok.com/@usuario/video/7300000000000000000' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'url deve ser http(s) válida' })
  @MaxLength(2048)
  url: string;
}

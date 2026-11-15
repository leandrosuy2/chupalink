import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl, Matches, MaxLength } from 'class-validator';

export class EnqueueLinkDto {
  @ApiProperty({ example: 'https://www.instagram.com/reel/XXXXXXXXXXX/' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  url: string;

  @ApiProperty({ example: '120363000000000000@g.us', description: 'Grupo autorizado que receberá o vídeo' })
  @IsString()
  @Matches(/^\d{5,30}(-\d{5,15})?@g\.us$/)
  groupId: string;
}

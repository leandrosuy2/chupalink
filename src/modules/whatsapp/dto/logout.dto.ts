import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class LogoutDto {
  @ApiProperty({ example: 'LOGOUT', description: 'Confirmação obrigatória — apaga a sessão local' })
  @IsString()
  @IsIn(['LOGOUT'], { message: 'confirm deve ser exatamente "LOGOUT"' })
  confirm: string;
}

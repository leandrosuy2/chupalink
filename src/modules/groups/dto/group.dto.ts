import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class AllowGroupDto {
  @ApiProperty({ example: '120363000000000000@g.us' })
  @IsString()
  @Matches(/^\d{5,30}(-\d{5,15})?@g\.us$/, { message: 'groupId deve terminar em @g.us' })
  groupId: string;
}

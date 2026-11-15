import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowGroupDto } from './dto/group.dto';
import { GroupsService } from './groups.service';

@ApiTags('groups')
@ApiBearerAuth()
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os grupos em que a conta participa (nome, ID, autorizado?)' })
  list() {
    return this.groups.listAvailable();
  }

  @Get('allowed')
  @ApiOperation({ summary: 'Lista os grupos autorizados' })
  allowed() {
    return this.groups.allowedDetails();
  }

  @Post('allowed')
  @ApiOperation({ summary: 'Autoriza um grupo (persistido em disco)' })
  allow(@Body() dto: AllowGroupDto) {
    return this.groups.allow(dto.groupId);
  }

  @Delete('allowed/:groupId')
  @ApiOperation({ summary: 'Remove um grupo autorizado via API' })
  disallow(@Param('groupId') groupId: string) {
    return this.groups.disallow(groupId);
  }
}

import { Module } from '@nestjs/common';
import { DownloaderModule } from '../downloader/downloader.module';
import { GroupsModule } from '../groups/groups.module';
import { JobsModule } from '../jobs/jobs.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { MessagesController } from './messages.controller';
import { MessagesProcessor } from './messages.processor';
import { MessagesService } from './messages.service';

@Module({
  imports: [WhatsappModule, GroupsModule, JobsModule, DownloaderModule],
  controllers: [MessagesController],
  providers: [MessagesService, MessagesProcessor],
})
export class MessagesModule {}

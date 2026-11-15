import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { HealthController } from './health.controller';

@Module({
  imports: [WhatsappModule, JobsModule],
  controllers: [HealthController],
})
export class HealthModule {}

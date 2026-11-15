import { Module } from '@nestjs/common';
import { DownloaderController } from './downloader.controller';
import { DownloaderFactory } from './downloader.factory';
import { DownloaderService } from './downloader.service';
import { VIDEO_PROVIDERS, VideoProvider } from './downloader.types';
import { MediaService } from './media.service';
import { DirectProvider } from './providers/direct.provider';
import { InstagramProvider } from './providers/instagram.provider';
import { TiktokProvider } from './providers/tiktok.provider';

/** Para adicionar uma plataforma: crie o provider e inclua-o em PROVIDER_CLASSES. */
const PROVIDER_CLASSES = [InstagramProvider, TiktokProvider, DirectProvider];

@Module({
  controllers: [DownloaderController],
  providers: [
    ...PROVIDER_CLASSES,
    {
      provide: VIDEO_PROVIDERS,
      inject: PROVIDER_CLASSES,
      useFactory: (...providers: VideoProvider[]) => providers,
    },
    DownloaderFactory,
    MediaService,
    DownloaderService,
  ],
  exports: [DownloaderService],
})
export class DownloaderModule {}

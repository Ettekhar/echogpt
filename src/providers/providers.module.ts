import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { ProviderAdapterFactory } from './adapters/provider-adapter.factory';
import { OpenAiAdapter } from './adapters/openai.adapter';
import { ClaudeAdapter } from './adapters/claude.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';

@Module({
  controllers: [ProvidersController],
  providers: [
    ProvidersService,
    ProviderAdapterFactory,
    OpenAiAdapter,
    ClaudeAdapter,
    GeminiAdapter,
  ],
  exports: [ProvidersService, ProviderAdapterFactory],
})
export class ProvidersModule {}

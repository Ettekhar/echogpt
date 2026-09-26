import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ProvidersModule } from '../providers/providers.module';
import { SearchProviderFactory } from './adapters/search-provider.factory';
import { SerperSearchAdapter } from './adapters/serper.adapter';
import { BraveSearchAdapter } from './adapters/brave.adapter';
import { DuckDuckGoSearchAdapter } from './adapters/duckduckgo.adapter';

@Module({
  imports: [SubscriptionsModule, ProvidersModule],
  controllers: [SearchController],
  providers: [
    SearchService,
    SearchProviderFactory,
    SerperSearchAdapter,
    BraveSearchAdapter,
    DuckDuckGoSearchAdapter,
  ],
})
export class SearchModule {}

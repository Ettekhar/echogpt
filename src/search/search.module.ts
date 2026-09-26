import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SearchProviderFactory } from './adapters/search-provider.factory';
import { SerperSearchAdapter } from './adapters/serper.adapter';
import { BraveSearchAdapter } from './adapters/brave.adapter';

@Module({
  imports: [SubscriptionsModule],
  controllers: [SearchController],
  providers: [SearchService, SearchProviderFactory, SerperSearchAdapter, BraveSearchAdapter],
})
export class SearchModule {}

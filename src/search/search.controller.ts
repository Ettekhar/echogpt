import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

@ApiTags('Web Search')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiResponse({ status: 401, description: 'Missing or invalid access token' })
@Controller('search')
export class SearchController {
  constructor(private searchService: SearchService) {}

  @Post('query')
  @ApiOperation({ summary: 'Run an AI-assisted web search query' })
  @ApiResponse({
    status: 201,
    description: 'Search results (served from cache when available within the cache window)',
  })
  @ApiResponse({ status: 400, description: 'Validation failed on the request body' })
  @ApiResponse({ status: 403, description: 'Daily usage limit reached for the current plan' })
  search(@CurrentUser('id') userId: string, @Body() dto: SearchQueryDto) {
    return this.searchService.search(userId, dto.query);
  }

  @Post()
  @ApiOperation({ summary: 'Run an AI-assisted web search query (root alias)' })
  @ApiResponse({
    status: 201,
    description: 'Search results (served from cache when available within the cache window)',
  })
  searchRoot(@CurrentUser('id') userId: string, @Body() dto: SearchQueryDto) {
    return this.searchService.search(userId, dto.query);
  }

  @Get('history')
  @ApiOperation({ summary: "Paginated history of the user's past searches" })
  @ApiResponse({ status: 200, description: 'Paginated list of past searches, most recent first' })
  history(
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.searchService.history(userId, Number(page) || 1, Number(pageSize) || 20);
  }

  @Get('recent')
  @ApiOperation({ summary: 'Most recent distinct searches' })
  @ApiResponse({ status: 200, description: 'Array of recent distinct search queries' })
  recent(@CurrentUser('id') userId: string, @Query('limit') limit?: string) {
    return this.searchService.recent(userId, Number(limit) || 10);
  }

  @Get('suggestions')
  @ApiOperation({ summary: "Autocomplete suggestions from the user's own search history" })
  @ApiResponse({ status: 200, description: 'Array of suggested query strings' })
  suggestions(@CurrentUser('id') userId: string, @Query('prefix') prefix: string) {
    return this.searchService.suggestions(userId, prefix || '');
  }
}

import { Injectable } from '@nestjs/common';
import { ProviderName } from '../providers.constants';
import { ProviderAdapter } from './provider-adapter.interface';
import { OpenAiAdapter } from './openai.adapter';
import { ClaudeAdapter } from './claude.adapter';
import { GeminiAdapter } from './gemini.adapter';

@Injectable()
export class ProviderAdapterFactory {
  constructor(
    private openai: OpenAiAdapter,
    private claude: ClaudeAdapter,
    private gemini: GeminiAdapter,
  ) {}

  get(name: ProviderName): ProviderAdapter {
    switch (name) {
      case ProviderName.OPENAI:
        return this.openai;
      case ProviderName.CLAUDE:
        return this.claude;
      case ProviderName.GEMINI:
        return this.gemini;
      default:
        throw new Error(`Unsupported provider: ${name}`);
    }
  }
}

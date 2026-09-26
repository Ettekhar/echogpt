import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ProviderName } from '../providers.constants';

export class CreateProviderDto {
  @ApiProperty({ enum: ProviderName })
  @IsEnum(ProviderName)
  name: ProviderName;

  @ApiProperty({ required: false, description: 'Friendly label, e.g. "Work OpenAI key"' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiProperty({ description: 'Plaintext API key - encrypted at rest, never returned again' })
  @IsString()
  @MinLength(10)
  apiKey: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiProperty({
    required: false,
    description: 'Override base URL (self-hosted / proxy endpoints)',
  })
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

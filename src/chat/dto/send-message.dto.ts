import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ example: 'Summarize this page for me' })
  @IsString()
  @MinLength(1)
  prompt: string;

  @ApiProperty({
    required: false,
    description: 'Existing conversation to append to; omit to start a new one',
  })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiProperty({
    required: false,
    description: 'Specific provider id to use; omits to use the default provider',
  })
  @IsOptional()
  @IsUUID()
  providerId?: string;
}

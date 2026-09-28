import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ required: false, example: 'Summarize this page for me' })
  @IsOptional()
  @IsString()
  prompt?: string;

  @ApiProperty({ required: false, example: 'Summarize this page for me' })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiProperty({ required: false, example: 'Summarize this page for me' })
  @IsOptional()
  @IsString()
  content?: string;

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

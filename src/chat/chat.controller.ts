import { Body, Controller, Delete, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

@ApiTags('Chat')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiResponse({ status: 401, description: 'Missing or invalid access token' })
@Controller('chat')
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Post('messages')
  @ApiOperation({
    summary: 'Send a prompt and receive an AI response',
    description:
      'Sends a prompt to the selected (or default) AI provider and returns the full response ' +
      'in one shot. For an incrementally-streamed response, use POST /chat/messages/stream instead.',
  })
  @ApiResponse({ status: 201, description: 'Persisted user + assistant messages' })
  @ApiResponse({ status: 400, description: 'Validation failed on the request body' })
  @ApiResponse({ status: 403, description: 'Daily usage limit reached, or provider disabled' })
  @ApiResponse({ status: 404, description: 'No matching provider configured for this user' })
  sendMessage(@CurrentUser('id') userId: string, @Body() dto: SendMessageDto) {
    return this.chatService.sendMessage(userId, dto);
  }

  @Post('messages/stream')
  @ApiOperation({
    summary: '(Bonus) Send a prompt and stream the AI response as Server-Sent Events',
    description:
      'Same behavior as POST /chat/messages, but the response is `text/event-stream`: a series ' +
      'of `event: chunk` frames as tokens arrive, followed by one `event: done` frame with the ' +
      'persisted message, or `event: error` if something went wrong.',
  })
  @ApiResponse({ status: 200, description: 'text/event-stream of chunk/done/error frames' })
  @ApiResponse({ status: 400, description: 'Validation failed on the request body' })
  @ApiResponse({ status: 403, description: 'Daily usage limit reached, or provider disabled' })
  async sendMessageStream(
    @CurrentUser('id') userId: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    for await (const { event, data } of this.chatService.sendMessageStream(userId, dto)) {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    res.end();
  }

  @Get('conversations')
  @ApiOperation({ summary: "List the current user's conversations" })
  @ApiResponse({ status: 200, description: 'Array of conversations, most recent first' })
  listConversations(@CurrentUser('id') userId: string) {
    return this.chatService.listConversations(userId);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Get full message history for a conversation' })
  @ApiResponse({ status: 200, description: 'Conversation with its ordered messages' })
  @ApiResponse({ status: 404, description: 'Conversation not found or not owned by this user' })
  getHistory(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.chatService.getConversationHistory(userId, id);
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: 'Delete a conversation and its messages' })
  @ApiResponse({ status: 200, description: 'Conversation deleted' })
  @ApiResponse({ status: 404, description: 'Conversation not found or not owned by this user' })
  deleteConversation(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.chatService.deleteConversation(userId, id);
  }
}

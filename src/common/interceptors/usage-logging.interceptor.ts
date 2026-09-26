import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Logs every API request into ApiUsageLog for analytics (used by the Admin module's
 * "API Usage Analytics" and "Request Logs" endpoints). Fire-and-forget so it never
 * slows down the response.
 */
@Injectable()
export class UsageLoggingInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.log(context, request, start, 200),
        error: (err) => this.log(context, request, start, err?.status || 500),
      }),
    );
  }

  private log(context: ExecutionContext, request: any, start: number, statusCode: number) {
    const durationMs = Date.now() - start;
    const userId = request.user?.id ?? null;

    this.prisma.apiUsageLog
      .create({
        data: {
          userId,
          method: request.method,
          path: request.originalUrl || request.url,
          statusCode,
          durationMs,
          ip: request.ip,
        },
      })
      .catch(() => {
        // Never let logging failures break the request lifecycle.
      });
  }
}

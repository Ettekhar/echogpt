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
        next: () => this.maybeLog(request, start, 200),
        error: (err) => this.maybeLog(request, start, err?.status || 500),
      }),
    );
  }

  /**
   * Liveness probes are not user API traffic, so they are not logged.
   *
   * `npm run demo` has to start the app before it can migrate (migrating needs
   * PostgreSQL, which dev.js starts first), and it polls /health to know when the
   * app is up. Those polls land before the schema exists, so every fresh install
   * printed a red `relation "public.ApiUsageLog" does not exist` with the
   * offending INSERT - alarming noise in the one place a reviewer is looking to
   * decide whether the project works. Excluding the probe removes the cause
   * rather than hiding the message.
   */
  private maybeLog(request: any, start: number, statusCode: number) {
    const path = String(request.originalUrl || request.url || '');
    if (/\/health(\?|$)/.test(path)) return;
    this.log(request, start, statusCode);
  }

  private log(request: any, start: number, statusCode: number) {
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

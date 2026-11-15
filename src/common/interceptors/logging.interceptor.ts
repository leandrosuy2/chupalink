import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const start = Date.now();
    return next.handle().pipe(
      tap({
        next: () => this.logger.debug(`${req.method} ${req.url} ${Date.now() - start}ms`),
        error: (e) => this.logger.warn(`${req.method} ${req.url} falhou: ${e?.message} (${Date.now() - start}ms)`),
      }),
    );
  }
}

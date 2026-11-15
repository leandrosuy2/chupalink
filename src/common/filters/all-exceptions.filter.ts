import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ChupaError } from '../utils/errors';

const CHUPA_STATUS: Partial<Record<string, number>> = {
  INVALID_URL: HttpStatus.BAD_REQUEST,
  BLOCKED_URL: HttpStatus.BAD_REQUEST,
  UNSUPPORTED_PLATFORM: HttpStatus.UNPROCESSABLE_ENTITY,
  NOT_CONNECTED: HttpStatus.SERVICE_UNAVAILABLE,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, any> = { message: 'Erro interno' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      body = typeof r === 'string' ? { message: r } : (r as Record<string, any>);
    } else if (exception instanceof ChupaError) {
      status = CHUPA_STATUS[exception.code] ?? HttpStatus.BAD_REQUEST;
      body = { message: exception.message, code: exception.code };
    } else {
      this.logger.error(
        `${req.method} ${req.url} → ${(exception as Error)?.message}`,
        (exception as Error)?.stack,
      );
    }
    res.status(status).json({ statusCode: status, path: req.url, timestamp: new Date().toISOString(), ...body });
  }
}

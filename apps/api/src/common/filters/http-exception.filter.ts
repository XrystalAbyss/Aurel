import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiErrorResponse, ErrorCode } from '@aurel/shared-types';

function getDefaultErrorCode(status: number): string {
  switch (status) {
    case HttpStatus.NOT_FOUND:
      return ErrorCode.NOT_FOUND;
    case HttpStatus.BAD_REQUEST:
      return ErrorCode.BAD_REQUEST;
    case HttpStatus.UNAUTHORIZED:
      return ErrorCode.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return ErrorCode.FORBIDDEN;
    case HttpStatus.CONFLICT:
      return ErrorCode.CONFLICT;
    case HttpStatus.METHOD_NOT_ALLOWED:
      return ErrorCode.METHOD_NOT_ALLOWED;
    default:
      return status >= 500 ? ErrorCode.INTERNAL_ERROR : 'HTTP_ERROR';
  }
}

function getDefaultTitle(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'Bad Request';
    case HttpStatus.UNAUTHORIZED:
      return 'Unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'Forbidden';
    case HttpStatus.NOT_FOUND:
      return 'Not Found';
    case HttpStatus.CONFLICT:
      return 'Conflict';
    case HttpStatus.METHOD_NOT_ALLOWED:
      return 'Method Not Allowed';
    default:
      return status >= 500 ? 'Internal Server Error' : 'HTTP Error';
  }
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail = 'An unexpected internal server error occurred.';
    let code = ErrorCode.INTERNAL_ERROR as string;
    let errors: Record<string, string[]> | undefined = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = getDefaultErrorCode(status);
      title = getDefaultTitle(status);
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        detail = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        detail = (resp['message'] as string) || exception.message;
        title = (resp['error'] as string) || title;
        if (typeof resp['code'] === 'string') {
          code = resp['code'];
        }
        if (Array.isArray(resp['message'])) {
          detail = 'Validation failed for one or more fields.';
          errors = { validation: resp['message'] as string[] };
          code = ErrorCode.VALIDATION_FAILED;
        }
      }
    } else if (exception instanceof Error) {
      detail = exception.message;
      this.logger.error(`Unhandled Exception: ${exception.message}`, exception.stack);
    }

    const requestId = (request.headers['x-request-id'] as string) || undefined;

    const errorResponse: ApiErrorResponse = {
      type: `https://aurel.restaurant/errors/${status}`,
      title,
      status,
      detail,
      instance: request.originalUrl || request.url,
      code,
      requestId,
      errors,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(errorResponse);
  }
}

// API 에러 응답 형식: { "error": { "code": "...", "message": "..." } }
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (message = '대상을 찾을 수 없다.') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new HttpError(409, 'CONFLICT', message);
export const badRequest = (message: string) => new HttpError(400, 'BAD_REQUEST', message);

// PostgreSQL 에러 코드 → HTTP 상태. DB 제약이 막은 요청은 500이 아니라 요청 문제로 돌려준다.
const PG_ERRORS: Record<string, [number, string]> = {
  '23505': [409, 'CONFLICT'], // unique_violation
  '23514': [400, 'CONSTRAINT_VIOLATION'], // check_violation
  '23503': [400, 'CONSTRAINT_VIOLATION'], // foreign_key_violation
  '23502': [400, 'CONSTRAINT_VIOLATION'], // not_null_violation
};

export const routeNotFound: RequestHandler = (_req, _res, next) => {
  next(notFound('없는 경로다.'));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '요청 값이 올바르지 않다.', issues: err.issues } });
    return;
  }
  const pgError = typeof err?.code === 'string' ? PG_ERRORS[err.code] : undefined;
  if (pgError) {
    const [status, code] = pgError;
    res.status(status).json({ error: { code, message: err.constraint ? `DB 제약 위반: ${err.constraint}` : 'DB 제약 위반' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: '서버 오류' } });
};

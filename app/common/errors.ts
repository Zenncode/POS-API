export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message: string, code = 'BAD_REQUEST'): AppError {
  return new AppError(400, code, message);
}

export function unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED'): AppError {
  return new AppError(401, code, message);
}

export function forbidden(message = 'Forbidden', code = 'FORBIDDEN'): AppError {
  return new AppError(403, code, message);
}

export function notFound(message = 'Resource not found', code = 'NOT_FOUND'): AppError {
  return new AppError(404, code, message);
}

export function conflict(message: string, code = 'CONFLICT'): AppError {
  return new AppError(409, code, message);
}

export function unprocessable(message: string, code = 'UNPROCESSABLE'): AppError {
  return new AppError(422, code, message);
}

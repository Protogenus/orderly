/** Application error with a machine-readable code. */
export class AppError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export const ErrorCodes = {
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  DB: 'DB',
  IO: 'IO',
} as const;

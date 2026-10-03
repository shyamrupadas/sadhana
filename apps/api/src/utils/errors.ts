import { ApiShemas } from '../schema'

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }

  toJSON(): ApiShemas['Error'] {
    return {
      message: this.message,
      code: this.code,
    }
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message)
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = 'Bad Request') {
    super(400, 'BAD_REQUEST', message)
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Not Found') {
    super(404, 'NOT_FOUND', message)
  }
}

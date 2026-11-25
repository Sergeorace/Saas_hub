export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new HttpError(400, code, message, details);
  }

  static unauthorized(message = 'Authentification requise.') {
    return new HttpError(401, 'unauthorized', message);
  }

  static forbidden(message = 'Accès refusé.') {
    return new HttpError(403, 'forbidden', message);
  }

  static notFound(message = 'Ressource introuvable.') {
    return new HttpError(404, 'not_found', message);
  }

  static conflict(code: string, message: string, details?: unknown) {
    return new HttpError(409, code, message, details);
  }

  static tooMany(message = 'Trop de tentatives. Réessayez plus tard.') {
    return new HttpError(429, 'too_many_requests', message);
  }

  static unprocessable(code: string, message: string, details?: unknown) {
    return new HttpError(422, code, message, details);
  }
}

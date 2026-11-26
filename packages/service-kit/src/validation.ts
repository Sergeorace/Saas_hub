import { HttpError } from './errors.js';

export function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw HttpError.badRequest('invalid_body', 'Corps de requête invalide.');
  }
  return value as Record<string, unknown>;
}

export function requireString(
  source: Record<string, unknown>,
  field: string,
  opts: { min?: number; max?: number; pattern?: RegExp } = {},
): string {
  const value = source[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw HttpError.unprocessable('validation_error', `Le champ « ${field} » est requis.`, {
      field,
    });
  }
  const trimmed = value.trim();
  if (opts.min && trimmed.length < opts.min) {
    throw HttpError.unprocessable('validation_error', `« ${field} » est trop court.`, { field });
  }
  if (opts.max && trimmed.length > opts.max) {
    throw HttpError.unprocessable('validation_error', `« ${field} » est trop long.`, { field });
  }
  if (opts.pattern && !opts.pattern.test(trimmed)) {
    throw HttpError.unprocessable('validation_error', `Format invalide pour « ${field} ».`, {
      field,
    });
  }
  return trimmed;
}

export function optionalString(
  source: Record<string, unknown>,
  field: string,
  opts: { max?: number } = {},
): string | undefined {
  const value = source[field];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw HttpError.unprocessable('validation_error', `« ${field} » doit être une chaîne.`, {
      field,
    });
  }
  if (opts.max && value.length > opts.max) {
    throw HttpError.unprocessable('validation_error', `« ${field} » est trop long.`, { field });
  }
  return value.trim();
}

export function requireEmail(source: Record<string, unknown>, field = 'email'): string {
  return requireString(source, field, { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/ }).toLowerCase();
}

export function optionalEmail(
  source: Record<string, unknown>,
  field = 'email',
): string | undefined {
  const value = optionalString(source, field);
  if (!value) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    throw HttpError.unprocessable('validation_error', `Format e-mail invalide pour « ${field} ».`, {
      field,
    });
  }
  return value.toLowerCase();
}

export function requirePhone(source: Record<string, unknown>, field = 'phone'): string {
  const value = requireString(source, field, { min: 8, max: 20 });
  const digits = value.replace(/[^\d+]/g, '');
  if (!/^\+?\d{8,15}$/.test(digits)) {
    throw HttpError.unprocessable(
      'validation_error',
      `Format téléphone invalide pour « ${field} ».`,
      { field },
    );
  }
  return digits;
}

export function optionalPhone(
  source: Record<string, unknown>,
  field = 'phone',
): string | undefined {
  if (source[field] === undefined || source[field] === null || source[field] === '')
    return undefined;
  return requirePhone(source, field);
}

export function requireEnum<T extends string>(
  source: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = source[field];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw HttpError.unprocessable(
      'validation_error',
      `« ${field} » doit être l'une des valeurs : ${allowed.join(', ')}.`,
      { field },
    );
  }
  return value as T;
}

export function optionalBoolean(
  source: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = source[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw HttpError.unprocessable('validation_error', `« ${field} » doit être un booléen.`, {
      field,
    });
  }
  return value;
}

export function requireArray(source: Record<string, unknown>, field: string, max = 20): unknown[] {
  const value = source[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw HttpError.unprocessable(
      'validation_error',
      `« ${field} » doit être une liste non vide.`,
      { field },
    );
  }
  if (value.length > max) {
    throw HttpError.unprocessable('validation_error', `Trop d'éléments dans « ${field} ».`, {
      field,
    });
  }
  return value;
}

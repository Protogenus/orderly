/** Input validation for IPC payloads (main process). Throws AppError on invalid input. */
import { AppError } from '../domain/errors.js';

export function reqString(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('VALIDATION', `${field} is required.`);
  }
  if (value.length > max) throw new AppError('VALIDATION', `${field} is too long (max ${max} chars).`);
  return value.trim();
}

export function optString(value: unknown, field: string, max = 500): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AppError('VALIDATION', `${field} must be text.`);
  const t = value.trim();
  if (t === '') return null;
  if (t.length > max) throw new AppError('VALIDATION', `${field} is too long (max ${max} chars).`);
  return t;
}

export function reqInt(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new AppError('VALIDATION', `${field} must be a whole number.`);
  }
  if (value < min || value > max) throw new AppError('VALIDATION', `${field} is out of range.`);
  return value;
}

export function optInt(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  if (value === undefined || value === null) return null;
  return reqInt(value, field, min, max);
}

export function reqEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new AppError('VALIDATION', `${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function optEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | null {
  if (value === undefined || value === null) return null;
  return reqEnum(value, field, allowed);
}

export function reqId(value: unknown, field = 'id'): string {
  const s = reqString(value, field, 64);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new AppError('VALIDATION', `${field} has an invalid format.`);
  return s;
}

export function optId(value: unknown, field = 'id'): string | null {
  if (value === undefined || value === null) return null;
  return reqId(value, field);
}

export function reqDate(value: unknown, field: string): string {
  const s = reqString(value, field, 32);
  if (!/^\d{4}-\d{2}-\d{2}($|T)/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new AppError('VALIDATION', `${field} must be a valid date.`);
  }
  return s;
}

export function optDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return reqDate(value, field);
}

export function reqEmail(value: unknown, field: string): string {
  const s = reqString(value, field, 320);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
    throw new AppError('VALIDATION', `${field} must be a valid email address.`);
  }
  return s.toLowerCase();
}

export function optEmail(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return reqEmail(value, field);
}

export function optStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new AppError('VALIDATION', `${field} must be a list.`);
  return value.map((v) => String(v).trim()).filter((v) => v.length > 0).slice(0, 50);
}

/** Parse a user-typed dollar amount ("12.50") into integer cents. Throws on invalid. */
export function moneyToCents(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const t = value.replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) {
      throw new AppError('VALIDATION', `${field} must be a valid dollar amount like 12.50.`);
    }
    const [dollars, cents = ''] = t.split('.');
    return parseInt(dollars, 10) * 100 + parseInt((cents + '00').slice(0, 2), 10);
  }
  throw new AppError('VALIDATION', `${field} must be a valid dollar amount.`);
}

export function optMoneyToCents(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return moneyToCents(value, field);
}

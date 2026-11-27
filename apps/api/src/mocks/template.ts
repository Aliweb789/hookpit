import { randomUUID } from 'node:crypto';

// Never let a template walk into the prototype chain.
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Upper bound for everything substituted into one response, so a template that
// repeats {{request.body}} thousands of times cannot exhaust memory.
export const MAX_SUBSTITUTED_BYTES = 1024 * 1024;

/**
 * Fill {{placeholders}} in a response body. There is deliberately NO code
 * execution: a placeholder is either a built-in or a plain property lookup.
 *
 *   {{uuid}}  {{now}}  {{timestamp}}
 *   {{params.id}}  {{request.method}}  {{request.path}}
 *   {{request.query.page}}  {{request.headers.x-signature}}
 *   {{request.body}}  {{request.json.user.id}}
 *
 * Unknown or missing values become an empty string.
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  let budget = MAX_SUBSTITUTED_BYTES;

  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, expression: string) => {
    let value = resolve(expression, context);
    if (value.length > budget) value = value.slice(0, budget);
    budget -= value.length;
    return value;
  });
}

function resolve(expression: string, context: Record<string, unknown>): string {
  if (expression === 'uuid') return randomUUID();
  if (expression === 'now') return new Date().toISOString();
  if (expression === 'timestamp') return String(Date.now());

  let current: unknown = context;
  for (const key of expression.split('.')) {
    if (
      BLOCKED_KEYS.has(key) ||
      current === null ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, key)
    ) {
      return '';
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (current === undefined || current === null) return '';
  return typeof current === 'object' ? JSON.stringify(current) : String(current);
}

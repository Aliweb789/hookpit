export type PathParams = Record<string, string>;

const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Split a path into segments. "/" has none; trailing slashes are ignored. */
function segments(path: string): string[] {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? [] : trimmed.split('/').slice(1);
}

/**
 * Is this a pattern we accept?
 *   /users          exact
 *   /users/:id      ":name" matches exactly one segment and captures it
 *   /files/*        "*" (last segment only) matches everything below, including nothing
 */
export function isValidPattern(pattern: unknown): pattern is string {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 200) return false;
  if (!pattern.startsWith('/') || /[?#\s]/.test(pattern) || pattern.includes('//')) return false;
  const segs = segments(pattern);
  return segs.every((seg, i) => {
    if (seg === '*') return i === segs.length - 1;
    if (seg.startsWith(':')) return PARAM_NAME.test(seg.slice(1));
    return !seg.includes('*') && !seg.includes(':');
  });
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // malformed % escape: keep it as received
  }
}

/** Returns the captured params when `path` matches `pattern`, otherwise null. */
export function matchPath(pattern: string, path: string): PathParams | null {
  const pat = segments(pattern);
  const parts = segments(path);
  const params: PathParams = {};

  for (let i = 0; i < pat.length; i++) {
    const seg = pat[i];
    if (seg === '*') {
      params['*'] = parts.slice(i).map(decode).join('/');
      return params;
    }
    if (i >= parts.length) return null;
    if (seg.startsWith(':')) {
      params[seg.slice(1)] = decode(parts[i]);
    } else if (seg !== parts[i]) {
      return null; // literal segments are case-sensitive
    }
  }
  return pat.length === parts.length ? params : null;
}

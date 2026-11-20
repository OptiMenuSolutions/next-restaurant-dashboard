import { createHash } from 'node:crypto';

export function projectionCanonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(projectionCanonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${projectionCanonicalJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function projectionVolumeDigest(value) {
  return createHash('sha256').update(projectionCanonicalJSON(value)).digest('hex');
}

export function projectionDeepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(projectionDeepFreeze);
    Object.freeze(value);
  }
  return value;
}
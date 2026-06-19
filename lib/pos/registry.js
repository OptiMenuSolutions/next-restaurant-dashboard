// lib/pos/registry.js
//
// Provider registry. Adding a third POS later = one new file in ./providers and
// one line here. Nothing else in the system needs to know the provider exists.

import square from './providers/square';
import shift4 from './providers/shift4';

const PROVIDERS = { square, shift4 };

export function getProvider(id) {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unknown POS provider: ${id}`);
  return provider;
}

export function listProviders() {
  return Object.values(PROVIDERS).map(({ id, label, authType }) => ({ id, label, authType }));
}
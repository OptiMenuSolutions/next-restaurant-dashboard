
const MAX_RESPONSE_BYTES = 500_000;
const TIMEOUT_MS = 10_000;

function isPublicHostname(hostname) {
  const host = hostname.toLowerCase();

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.test') ||
    host.endsWith('.invalid')
  ) {
    return false;
  }

  // DNS names require an independent public-IP check.
  // Until that exists, only an explicit hostname allowlist
  // can be fetched safely.
  return false;
}

export function validateProductSourceUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !isPublicHostname(url.hostname)
    ) {
      return {
        valid: false,
        reason: 'Source URL is not approved for retrieval',
      };
    }

    return { valid: true, url: url.toString() };
  } catch {
    return {
      valid: false,
      reason: 'Invalid source URL',
    };
  }
}

export async function retrieveProductSource(rawUrl) {
  const validated = validateProductSourceUrl(rawUrl);

  if (!validated.valid) {
    return {
      status: 'blocked',
      reason: validated.reason,
      content: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    TIMEOUT_MS
  );

  try {
    const response = await fetch(validated.url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'text/html, text/plain',
      },
    });

    if (!response.ok) {
      return {
        status: 'unavailable',
        reason: `HTTP ${response.status}`,
        content: null,
      };
    }

    const contentType = response.headers.get('content-type') || '';

    if (
      !contentType.includes('text/html') &&
      !contentType.includes('text/plain')
    ) {
      return {
        status: 'unsupported',
        reason: 'Unsupported source content type',
        content: null,
      };
    }

    const declaredLength = Number(
      response.headers.get('content-length')
    );

    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_RESPONSE_BYTES
    ) {
      return {
        status: 'unsupported',
        reason: 'Source document is too large',
        content: null,
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let content = '';
    let bytesRead = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.byteLength;

      if (bytesRead > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return {
          status: 'unsupported',
          reason: 'Source document exceeds size limit',
          content: null,
        };
      }

      content += decoder.decode(value, { stream: true });
    }

    content += decoder.decode();

    return {
      status: 'retrieved',
      url: validated.url,
      contentType,
      content,
    };
  } catch {
    return {
      status: 'unavailable',
      reason: 'Source could not be retrieved',
      content: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

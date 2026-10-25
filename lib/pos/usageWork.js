export async function mapUsage(items, concurrency, run) {
  let next = 0;
  const results = new Array(items.length);

  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index], index);
      }
    }
  ));

  return results;
}

export async function usageFetch(url, options, deadline) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const remaining = deadline - Date.now();

    if (remaining < 1000) {
      throw new Error(
        'Preparation time budget reached; completed rules are saved.'
      );
    }

    const started = Date.now();
    let response;
    let data;
    let retryable = false;
    let failure;

    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(Math.min(45000, remaining)),
      });

      data = await response.json();

      if (response.ok) {
        console.info('[pos-usage:claude]', JSON.stringify({
          attempt,
          elapsed_ms: Date.now() - started,
          input_tokens: data.usage?.input_tokens,
          output_tokens: data.usage?.output_tokens,
          stop_reason: data.stop_reason,
          request_id: response.headers.get('request-id'),
        }));

        return data;
      }

      retryable = response.status === 429 || response.status >= 500;

      failure = new Error(
        `Claude HTTP ${response.status} (${data.error?.type || 'request_error'})`
      );
    } catch (error) {
      retryable = [
        'TimeoutError',
        'AbortError',
        'TypeError',
      ].includes(error.name);

      failure = new Error(
        retryable
          ? `Claude request timed out or lost connection: ${error.name}`
          : error.message
      );
    }

    console.warn('[pos-usage:claude]', {
      attempt,
      elapsed_ms: Date.now() - started,
      error: failure.message,
    });

    const header = response?.headers.get('retry-after');
    const seconds = header == null ? NaN : Number(header);

    const delay = Number.isFinite(seconds)
      ? Math.max(0, seconds * 1000)
      : header && Number.isFinite(Date.parse(header))
        ? Math.max(0, Date.parse(header) - Date.now())
        : 1000;

    if (
      !retryable ||
      attempt === 2 ||
      Date.now() + delay + 1000 >= deadline
    ) {
      throw failure;
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
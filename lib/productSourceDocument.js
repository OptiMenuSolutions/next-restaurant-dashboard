
/**
 * Extract URL metadata without assigning trust.
 *
 * The hostname identifies where the document was
 * retrieved from. It does not establish publisher
 * identity or source authority.
 */
export function extractSourceUrlMetadata(rawUrl) {
  try {
    const url = new URL(rawUrl);

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname ||
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname.endsWith('.local')
    ) {
      return null;
    }

    return {
      hostname: url.hostname.toLowerCase(),
      protocol: url.protocol,
    };
  } catch {
    return null;
  }
}

export function extractFetchedSourceDocument(
  response,
  expectedUrl
) {
  const fetchBlocks = (response?.content ?? [])
    .filter(
      (block) => block.type === 'web_fetch_tool_result'
    );

  const retrieved = fetchBlocks
    .map((block) => block.content)
    .find(
      (item) =>
        item?.type === 'web_fetch_result' &&
        item.url === expectedUrl &&
        item.content?.type === 'document'
    );

  if (!retrieved) {
    return null;
  }

  const urlMetadata = extractSourceUrlMetadata(
    retrieved.url
  );

  if (!urlMetadata) {
    return null;
  }

  const source = retrieved.content.source;

  if (
    source?.type !== 'text' ||
    source.media_type !== 'text/plain' ||
    typeof source.data !== 'string' ||
    !source.data.trim()
  ) {
    return null;
  }

  return {
    origin: 'anthropic_web_fetch',
    url: retrieved.url,
    hostname: urlMetadata.hostname,
    text: source.data,
    retrievedAt: retrieved.retrieved_at ?? null,
    mediaType: source.media_type,

    // Retrieval metadata alone cannot establish
    // that the publisher is authoritative.
    attribution: {
      publisher: null,
      publisherType: 'unknown',
      verificationStatus: 'unverified',
    },
  };
}

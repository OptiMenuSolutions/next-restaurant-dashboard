
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

try {
  const response = await client.messages.create({
    model:
      process.env.PRODUCT_RESEARCH_CLAUDE_MODEL ||
      'claude-haiku-4-5-20251001',
    max_tokens: 300,
    tools: [{
      type: 'web_fetch_20250910',
      name: 'web_fetch',
      max_uses: 1,
    }],
    messages: [{
      role: 'user',
      content:
        'Fetch https://www.knousefoodservice.com/products/strawberry-glaze-120-oz/ ' +
        'and report whether the page was successfully retrieved. ' +
        'Do not infer or invent any product measurements.',
    }],
  });

  console.log(JSON.stringify({
    stopReason: response.stop_reason,
    blockTypes: response.content.map((block) => block.type),
    fetchRequests:
      response.usage?.server_tool_use?.web_fetch_requests ?? 0,
    text: response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n'),
  }, null, 2));
} catch (error) {
  console.error({
    status: error.status,
    message: error.message,
  });
}

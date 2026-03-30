// pages/api/debug-ai.js
// TEMPORARY — delete this file after debugging

export default async function handler(req, res) {
  const results = {};

  // Check env vars
  results.hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  results.keyPrefix = process.env.ANTHROPIC_API_KEY?.slice(0, 10) + '...';
  results.hasSupabaseUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  results.hasServiceRoleKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Try Claude
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Reply with just the word: working' }],
    });
    results.claudeStatus = 'success';
    results.claudeResponse = message.content[0].text;
  } catch (err) {
    results.claudeStatus = 'failed';
    results.claudeError = err.message;
  }

  return res.status(200).json(results);
}
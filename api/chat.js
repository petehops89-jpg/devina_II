export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check API key is set in Vercel environment variables
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'MISTRAL_API_KEY not set in Vercel environment variables' });
  }

  // Validate request body
  const { system, messages, model, max_tokens, temperature, json_mode } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // Build Mistral messages — system goes first as role:'system'
  const mistralMessages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages
  ];

  try {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'mistral-large-latest',
        max_tokens: max_tokens || 4000,
        temperature: temperature ?? 0.7,
        messages: mistralMessages
      })
    });

    // Try to parse response body regardless of status
    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      return res.status(502).json({ error: 'Mistral returned unparseable response' });
    }

    // Handle Mistral API errors (rate limit, auth, etc.)
    if (!response.ok) {
      const mistralError = data?.message || data?.error?.message || `Mistral error ${response.status}`;
      return res.status(response.status).json({ error: mistralError });
    }

    // Extract content from response
    let content = data.choices?.[0]?.message?.content || '';
    if (!content) {
      return res.status(502).json({ error: 'Mistral returned empty content' });
    }

    // If json_mode requested: strip fences and extract clean JSON
    if (json_mode) {
      content = content.replace(/```json\s*|```\s*/g, '').trim();
      // Try array first, then object
      const arrStart = content.indexOf('[');
      const arrEnd = content.lastIndexOf(']');
      const objStart = content.indexOf('{');
      const objEnd = content.lastIndexOf('}');

      if (arrStart !== -1 && (arrStart < objStart || objStart === -1)) {
        content = content.slice(arrStart, arrEnd + 1);
      } else if (objStart !== -1) {
        content = content.slice(objStart, objEnd + 1);
      }

      // Validate it's real JSON before sending back
      try {
        JSON.parse(content);
      } catch (e) {
        return res.status(502).json({ error: 'Mistral returned invalid JSON', raw: content.slice(0, 300) });
      }
    }

    return res.status(200).json({ content });

  } catch (err) {
    // Network error reaching Mistral
    return res.status(503).json({ error: 'Could not reach Mistral API: ' + err.message });
  }
}

// Vercel serverless function (Node runtime).
// Keeps ANTHROPIC_API_KEY on the server — it is never sent to the browser.
// The frontend calls POST /api/claude with { system, userText, maxTokens }.
//
// This only runs when the person types a free-text meal description instead
// of picking a result from the food search (api/food-search.js, backed by
// USDA FoodData Central) — e.g. "chicken shawarma plate". Precise single
// foods never reach an LLM at all now; they're looked up directly. Because
// this is just extracting structured numbers from short text, it runs on
// Haiku 4.5 rather than a larger model: materially cheaper/faster with no
// meaningful accuracy loss for this task.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Server is missing ANTHROPIC_API_KEY. Set it in your Vercel project's environment variables.",
    });
  }

  const { system, userText, maxTokens } = req.body || {};
  if (!userText || typeof userText !== "string") {
    return res.status(400).json({ error: "Missing userText" });
  }

  const boundedMaxTokens = Math.min(Math.max(parseInt(maxTokens, 10) || 1000, 1), 4096);

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: boundedMaxTokens,
        system: system || undefined,
        messages: [{ role: "user", content: userText }],
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data?.error?.message || "The Anthropic API returned an error.",
      });
    }

    const text = (data.content || [])
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: `Server error reaching the Anthropic API: ${err?.message || err}` });
  }
}

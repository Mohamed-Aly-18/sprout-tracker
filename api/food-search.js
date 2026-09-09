// Vercel serverless function (Node runtime).
// Proxies USDA FoodData Central (https://fdc.nal.usda.gov) so the free
// USDA_API_KEY never has to sit in client-side code. Powers the
// search-and-pick food logging flow. Restricted to the Foundation and SR
// Legacy datasets — USDA's analyzed generic-food data (eggs, rice, chicken,
// banana, etc.) — rather than Branded (packaged products) or Survey data,
// which are noisier and less consistent for this use case.

const NUTRIENT_IDS = { energy: 1008, protein: 1003, fat: 1004, carbs: 1005 };

// Words that mean the person already told us exactly what state they want —
// when any of these appear in the query, we leave USDA's own ranking alone.
const EXPLICIT_STATE_WORDS = ["raw", "cooked", "boiled", "grilled", "roasted", "steamed", "fried", "baked", "sauteed", "sautéed", "poached", "smoked", "oil", "undrained", "canned in oil"];

// When the person doesn't specify, most staples are logged as eaten, not as
// a raw ingredient on a scale — bias toward the prepared/ready-to-eat form.
const PREFERRED_STATE_WORDS = ["cooked", "roasted", "boiled", "steamed", "grilled", "baked", "drained"];
const DEPRIORITIZED_STATE_WORDS = ["raw", "unprepared", "in oil", "undrained"];

function rerankByPrepState(results, query) {
  const q = query.toLowerCase();
  const isExplicit = EXPLICIT_STATE_WORDS.some((w) => q.includes(w));
  if (isExplicit) return results; // respect what the person actually typed

  return results
    .map((r, index) => {
      const desc = r.name.toLowerCase();
      let score = 0;
      if (PREFERRED_STATE_WORDS.some((w) => desc.includes(w))) score += 2;
      if (DEPRIORITIZED_STATE_WORDS.some((w) => desc.includes(w))) score -= 2;
      return { r, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index) // stable: keep USDA's relevance order within each score tier
    .map((x) => x.r);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.USDA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        "Server is missing USDA_API_KEY. Get a free key at fdc.nal.usda.gov/api-key-signup.html and set it in your Vercel project's environment variables.",
    });
  }

  const query = (req.query.q || "").toString().trim();
  if (query.length < 2) {
    return res.status(200).json({ results: [] });
  }

  try {
    const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("query", query);
    url.searchParams.set("pageSize", "15"); // fetch extra candidates so the prep-state rerank below has room to work with
    url.searchParams.append("dataType", "Foundation");
    url.searchParams.append("dataType", "SR Legacy");

    const upstream = await fetch(url.toString());
    const data = await upstream.json();

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data?.message || data?.error?.message || "USDA FoodData Central returned an error.",
      });
    }

    const results = rerankByPrepState(
      (data.foods || [])
        .map((food) => {
          const get = (id) => {
            const n = (food.foodNutrients || []).find((fn) => fn.nutrientId === id);
            return n ? Number(n.value) || 0 : 0;
          };
          // USDA descriptions come back in ALL CAPS ("CHICKEN, BROILERS OR
          // FRYERS, BREAST, MEAT ONLY, COOKED, ROASTED") — title-case them so
          // they read naturally in the app.
          const name = String(food.description || "Food")
            .toLowerCase()
            .replace(/\b\w/g, (c) => c.toUpperCase());
          return {
            id: String(food.fdcId),
            name,
            cal: get(NUTRIENT_IDS.energy),
            protein: get(NUTRIENT_IDS.protein),
            carbs: get(NUTRIENT_IDS.carbs),
            fat: get(NUTRIENT_IDS.fat),
            gramsEach: null, // Foundation/SR Legacy values are always per 100g — no "each" concept to convert through
          };
        })
        .filter((r) => r.cal > 0), // drop entries with no usable energy value
      query
    ).slice(0, 8);

    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: `Server error reaching USDA FoodData Central: ${err?.message || err}` });
  }
}

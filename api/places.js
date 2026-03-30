export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, lat, lng, place, query } = req.body;

  // ── Action: geocode（地名 → 坐标） ─────────────────────────────────
  if (action === 'geocode') {
    if (!query) return res.status(400).json({ error: '缺少搜索词' });
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${process.env.GOOGLE_KEY}&language=zh-CN`;
      const r = await fetch(url);
      const data = await r.json();
      if (!data.results?.length) return res.status(404).json({ error: '找不到该地点' });
      const loc = data.results[0].geometry.location;
      const name = data.results[0].formatted_address;
      return res.status(200).json({ lat: loc.lat, lng: loc.lng, name });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Action: nearby（附近地点） ────────────────────────────────────
  if (action === 'nearby') {
    try {
      const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': process.env.GOOGLE_KEY,
          'X-Goog-FieldMask': 'places.displayName,places.types,places.formattedAddress,places.rating,places.editorialSummary'
        },
        body: JSON.stringify({
          includedTypes: [
            "historical_landmark", "museum", "church", "hindu_temple",
            "mosque", "synagogue", "art_gallery", "library",
            "performing_arts_theater", "university", "tourist_attraction"
          ],
          maxResultCount: 8,
          locationRestriction: {
            circle: { center: { latitude: lat, longitude: lng }, radius: 800 }
          }
        })
      });

      if (!response.ok) throw new Error(`Google API错误: ${response.status}`);
      const data = await response.json();
      return res.status(200).json({ places: data.places || [] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Action: story（生成故事，含 Wikipedia） ──────────────────────
  if (action === 'story') {
    try {
      // 1. 查 Wikipedia
      const wikiSummary = await fetchWikipedia(place.name);

      // 2. 构建 prompt
      const prompt = buildStoryPrompt(place, wikiSummary);

      // 3. 调用 Claude（可通过 req.body.model 切换，供对比页面使用）
      const model = req.body.model || 'claude-haiku-4-5-20251001';
      const story = await callClaude(model, prompt);

      return res.status(200).json({ story, wikiFound: !!wikiSummary });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Action: compare（多模型对比，供 compare.html 使用） ──────────
  if (action === 'compare') {
    try {
      const wikiSummary = await fetchWikipedia(place.name);
      const prompt = buildStoryPrompt(place, wikiSummary);

      const claudeModels = [
        { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
        { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
      ];

      const geminiModels = [
        { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
      ];

      // 并行调用所有模型
      const results = await Promise.all([
        ...claudeModels.map(async (m) => {
          const start = Date.now();
          try {
            const text = await callClaude(m.id, prompt);
            return { model: m.id, label: m.label, text, ms: Date.now() - start, error: null };
          } catch (err) {
            return { model: m.id, label: m.label, text: null, ms: Date.now() - start, error: err.message };
          }
        }),
        ...geminiModels.map(async (m) => {
          const start = Date.now();
          try {
            const text = await callGemini(m.id, prompt);
            return { model: m.id, label: m.label, text, ms: Date.now() - start, error: null };
          } catch (err) {
            return { model: m.id, label: m.label, text: null, ms: Date.now() - start, error: err.message };
          }
        }),
      ]);

      return res.status(200).json({ results, wikiSummary, wikiFound: !!wikiSummary });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: '未知action' });
}

// ── Wikipedia 查询（英文优先，内容更丰富；中文备用） ────────────────
async function fetchWikipedia(name) {
  try {
    // 1. 先用英文 Wikipedia 搜索（命中率高，内容丰富）
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&srlimit=1&format=json&origin=*`;
    const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': 'CityWalkApp/1.0' } });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const title = searchData?.query?.search?.[0]?.title;
      if (title) {
        const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
        const summaryRes = await fetch(summaryUrl, { headers: { 'User-Agent': 'CityWalkApp/1.0' } });
        if (summaryRes.ok) {
          const data = await summaryRes.json();
          if (data.extract && data.extract.length > 50) return data.extract;
        }
      }
    }

    // 2. 英文没找到时，回退到中文 Wikipedia
    const zhUrl = `https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
    const zhRes = await fetch(zhUrl, { headers: { 'User-Agent': 'CityWalkApp/1.0' } });
    if (zhRes.ok) {
      const data = await zhRes.json();
      if (data.extract && data.extract.length > 50) return data.extract;
    }
  } catch (_) {
    // Wikipedia 查询失败不阻断主流程
  }
  return null;
}

// ── Gemini API 调用 ───────────────────────────────────────────────
async function callGemini(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1000 }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API错误 (${model}): ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '暂无介绍';
}
function buildStoryPrompt(place, wikiSummary) {
  return `你是一位专业的地方志撰稿人，擅长编写客观、详实、去修辞化的建筑与历史词条。

地点信息：
- 名称：${place.name}
- 地址：${place.address}
- 类型：${place.types}
${place.summary ? `- Google简介：${place.summary}` : ''}
${wikiSummary ? `\nWikipedia资料：\n${wikiSummary}` : ''}

写作要求（Fact-Only 模式）：

文体风格：使用实用说明文风格。要求行文严谨、客观，禁止使用夸张修辞。可以引用当地人的想象或者延申，但要提供出处，而不是你自己发散。

核心内容：基于提供的资料，提取该地点的确切历史年份、建筑结构参数（如高度、材料、风格）、社会功能演变及关键历史事件。

拒绝废话：严禁出现类似“跨越时空”、“见证沧桑”等无实际信息含量的文学性描述。

段落结构：以完整的叙述性段落呈现，不要使用 Bullet points 或列表。

字数与格式：300字左右。直接输出介绍正文，不加标题，不加任何前缀说明`;
}

// ── Claude API 调用 ───────────────────────────────────────────────
async function callClaude(model, prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API错误 (${model}): ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '暂无介绍';
}

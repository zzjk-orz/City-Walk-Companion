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

  // ── Action: story ────────────────────────────────────────────────
  if (action === 'story') {
    try {
      const [wikiSummary, redditPosts] = await Promise.all([
        fetchWikipedia(place.name),
        fetchReddit(place.name, place.address),
      ]);
      const prompt = buildStoryPrompt(place, wikiSummary, redditPosts);
      const model = req.body.model || 'claude-haiku-4-5-20251001';
      const story = model.startsWith('gemini')
        ? await callGemini(model, prompt)
        : await callClaude(model, prompt);
      return res.status(200).json({ story, wikiFound: !!wikiSummary, redditFound: redditPosts.length > 0 });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Action: compare ───────────────────────────────────────────────
  if (action === 'compare') {
    try {
      const [wikiSummary, redditPosts] = await Promise.all([
        fetchWikipedia(place.name),
        fetchReddit(place.name, place.address),
      ]);
      const prompt = buildStoryPrompt(place, wikiSummary, redditPosts);

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
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&srlimit=1&format=json&origin=*`;
    const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': 'CityWalkApp/1.0' } });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const title = searchData?.query?.search?.[0]?.title;
      if (title) {
        const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { 'User-Agent': 'CityWalkApp/1.0' } });
        if (summaryRes.ok) {
          const data = await summaryRes.json();
          if (data.extract && data.extract.length > 50) return data.extract;
        }
      }
    }
    // 英文没找到，回退中文
    const zhRes = await fetch(`https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`, { headers: { 'User-Agent': 'CityWalkApp/1.0' } });
    if (zhRes.ok) {
      const data = await zhRes.json();
      if (data.extract && data.extract.length > 50) return data.extract;
    }
  } catch (_) {}
  return null;
}

// ── Reddit 查询（通过 Google Custom Search） ─────────────────────
async function fetchReddit(name, address) {
  console.log('[Reddit] start, name:', name, 'address:', address);
  try {
    const city = extractCity(address);
    const query = city ? `${name} ${city}` : name;
    console.log('[Reddit] query:', query);
 
    const params = new URLSearchParams({
      key: process.env.GOOGLE_KEY,
      cx: '80fc0334f3dc04db3',
      q: query,
      num: 5,
    });
 
    const url = `https://www.googleapis.com/customsearch/v1?${params}`;
    console.log('[Reddit] fetching:', url.replace(process.env.GOOGLE_KEY, 'KEY_HIDDEN'));
 
    const res = await fetch(url);
    console.log('[Reddit] response status:', res.status);
    if (!res.ok) {
      const errText = await res.text();
      console.log('[Reddit] error body:', errText.slice(0, 300));
      return [];
    }
 
    const data = await res.json();
    console.log('[Reddit] total results:', data.searchInformation?.totalResults);
    console.log('[Reddit] items count:', data.items?.length ?? 0);
    if (data.error) console.log('[Reddit] API error:', JSON.stringify(data.error));
 
    const items = data.items || [];
    const results = items.map(item => ({
      title: item.title.replace(/\s*[-|].*reddit.*/i, '').trim(),
      text: item.snippet || '',
      subreddit: (item.link.match(/reddit\.com\/r\/([^/]+)/) || [])[1] || 'reddit',
    })).filter(p => p.text.length > 30);
 
    console.log('[Reddit] filtered results:', results.length);
    return results;
  } catch (err) {
    console.log('[Reddit] exception:', err.message);
    return [];
  }
}

function extractCity(address) {
  if (!address) return '';
  // 取地址倒数第二段（通常是城市）
  const parts = address.split(',').map(s => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

// ── Prompt 构建 ───────────────────────────────────────────────────
function buildStoryPrompt(place, wikiSummary, redditPosts = []) {
  const redditSection = redditPosts.length > 0
    ? `\nReddit本地讨论：\n${redditPosts.map(p =>
        `[r/${p.subreddit}] ${p.title}\n${p.text}`
      ).join('\n---\n')}`
    : '';

  return `你是一个了解当地情况的向导，任务是用简洁的中文介绍这个地方。

地点：${place.name}，${place.address}
${place.summary ? `Google简介：${place.summary}` : ''}
${wikiSummary ? `\nWikipedia：${wikiSummary}` : ''}
${redditSection}

写一段300字左右的介绍，要求：
1. 只写有实际信息量的内容：历史事实、社会功能演变、文化名人、具体数据或年份、真实的参与方式或社会角色、本地人和社区视角
2. 如果Reddit有相关内容，优先提炼当地人的真实评价和使用习惯，保留褒贬双方观点，可以推荐附近周期性集会或者精品小店
3. 禁止使用空洞的抒情句，例如"走在这里仿佛穿越时光"、"每一块砖都诉说着故事"这类无信息量的表达
4. 语气自然亲切，像本地人给来做客的朋友讲解，但不要无意义的感叹词或者衔接气口，例如"这地方可有意思了""说到xx""有个有意思的点是"
5. 直接输出正文，不加标题`;
}

// ── Gemini API 调用 ───────────────────────────────────────────────
async function callGemini(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 800 }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API错误 (${model}): ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '暂无介绍';
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, lat, lng, place } = req.body;

  // Action 1: 查询附近地点
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

  // Action 2: 生成故事
  if (action === 'story') {
    const prompt = `你是一位博学的城市漫游向导，擅长讲述地方历史与文化故事。

地点信息：
- 名称：${place.name}
- 地址：${place.address}
- 类型：${place.types}
${place.summary ? `- 简介：${place.summary}` : ''}

请用优美流畅的中文，为这个地方写一段200字左右的文化历史介绍。
要求：
- 讲述这个地方的历史背景、建筑特色或文化意义
- 语气像一位见多识广的朋友娓娓道来，不要太学术
- 如果不了解这个具体地点，可以结合地址中的城市/地区讲述当地的历史文化背景
- 适当加入有趣的细节或轶事
- 直接输出介绍文字，不需要任何标题或前缀`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!response.ok) throw new Error(`Claude API错误: ${response.status}`);
      const data = await response.json();
      return res.status(200).json({ story: data.content?.[0]?.text || '暂无介绍' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: '未知action' });
}

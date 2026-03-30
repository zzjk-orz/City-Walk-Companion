export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing text' });

  const truncated = text.slice(0, 1500);

  try {
    // 1. 调用 qwen3-tts-flash，返回 OSS 音频 URL
    const ttsRes = await fetch(
      'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.ALIBABA_TTS_KEY}`,
        },
        body: JSON.stringify({
          model: 'qwen3-tts-flash',
          input: {
            text: truncated,
            voice: 'Cherry',
          },
          parameters: {
            language_type: 'Auto',
          },
        }),
      }
    );

    if (!ttsRes.ok) {
      const err = await ttsRes.text();
      return res.status(500).json({ error: `Qwen TTS 错误: ${ttsRes.status} ${err}` });
    }

    const ttsData = await ttsRes.json();
    const audioUrl = ttsData?.output?.audio?.url;
    if (!audioUrl) {
      return res.status(500).json({ error: '未获取到音频 URL', detail: JSON.stringify(ttsData) });
    }

    // 2. 下载音频转 base64
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error(`音频下载失败: ${audioRes.status}`);

    const arrayBuffer = await audioRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return res.status(200).json({ audioContent: base64 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

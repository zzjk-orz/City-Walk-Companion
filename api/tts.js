export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing text' });

  // 截断避免超出 TTS 单次限制（5000 字节）
  const truncated = text.slice(0, 1500);

  try {
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: truncated },
          voice: {
            languageCode: 'cmn-CN',
            name: 'cmn-CN-Wavenet-C',   // 女声；换 B 是男声
            ssmlGender: 'FEMALE',
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: 1.0,
            pitch: 0,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: `Google TTS 错误: ${response.status} ${err}` });
    }

    const data = await response.json();
    return res.status(200).json({ audioContent: data.audioContent }); // base64 MP3
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: '프롬프트를 입력해주세요.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: "16:9",
          }
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error('Imagen API 오류: ' + err);
    }

    const data = await response.json();
    const imageBase64 = data.predictions?.[0]?.bytesBase64Encoded;

    if (!imageBase64) {
      throw new Error('이미지 데이터를 받지 못했습니다.');
    }

    return res.status(200).json({ imageBase64 });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mimeType = 'image/jpeg' } = req.body;
  if (!imageBase64) return res.status(400).json({ error: '이미지 데이터가 없습니다.' });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: 'GROQ_API_KEY가 설정되지 않았습니다.' });

  const prompt = `You are an expert in projection mapping and architectural analysis.

Analyze this building image and find flat, projectable surfaces (walls, screens, facades) suitable for projection mapping.

Find up to 10 surfaces. For each surface, provide the 4 corner points as pixel coordinates (x, y) where (0,0) is top-left.

Return ONLY a valid JSON array, no markdown, no extra text:
[
  {
    "id": 1,
    "label": "surface name (e.g. Main Wall, Left Panel)",
    "confidence": 0.95,
    "points": [
      { "x": 100, "y": 50 },
      { "x": 400, "y": 50 },
      { "x": 400, "y": 300 },
      { "x": 100, "y": 300 }
    ]
  }
]

Rules:
- Points must be in clockwise order starting from top-left
- Only include large flat surfaces suitable for projection
- Confidence should be between 0 and 1
- Coordinates must be within the image bounds`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + groqKey
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${imageBase64}`
                }
              },
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 2048
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error('Groq Vision 오류: ' + err);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const surfaces = JSON.parse(clean);

    return res.status(200).json({ surfaces, count: surfaces.length });

  } catch(e) {
    console.error('scan 오류:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

module.exports = async function handler(req, res) {  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { direction, count = 4, style, ratio } = req.body;

  if (!direction) {
    return res.status(400).json({ error: '기획 내용을 입력해주세요.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
  }

  const prompt = `You are a professional film director and storyboard artist. Analyze the following creative brief and create a detailed storyboard.

Creative Brief: "${direction}"

Create exactly ${count} scenes for this storyboard. Each scene should tell a different part of the visual story.

Respond ONLY with a valid JSON object in this exact format, no markdown, no extra text:
{
  "title": "스토리보드 제목 (한국어, 20자 이내)",
  "overview": "전체 스토리보드 개요 설명 (한국어, 100자 이내)",
  "scenes": [
    {
      "title": "씬 제목 (한국어, 10자 이내)",
      "mood": "분위기 키워드 (한국어, 10자 이내)",
      "description": "씬 설명 (한국어, 50자 이내)",
      "prompt": "detailed English image generation prompt, style: ${style}, aspect ratio: ${ratio}, include camera angle, lighting, mood, composition, technical photography details, ultra detailed, high quality"
    }
  ]
}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 2048,
          }
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error('Gemini API 오류: ' + err);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json(parsed);

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { direction, count = 4, style, ratio } = req.body;

  if (!direction) {
    return res.status(400).json({ error: '기획 내용을 입력해주세요.' });
  }

  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

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

  // 1순위: Groq 시도
  if (groqKey) {
    try {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + groqKey
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.8,
          max_tokens: 2048
        })
      });

      if (groqRes.ok) {
        const data = await groqRes.json();
        const text = data.choices?.[0]?.message?.content || '';
        const clean = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        return res.status(200).json({ ...parsed, usedApi: 'groq' });
      }

      const err = await groqRes.json();
      if (err?.error?.code !== 429) {
        throw new Error('Groq 오류: ' + JSON.stringify(err));
      }
      // 429면 Gemini로 넘어감
      console.log('Groq 한도 초과, Gemini로 전환');

    } catch (e) {
      if (!e.message.includes('429')) {
        console.error('Groq 오류:', e.message);
      }
    }
  }

  // 2순위: Gemini 시도
  if (geminiKey) {
    try {
      const geminiRes = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + geminiKey,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.8, maxOutputTokens: 2048 }
          })
        }
      );

      if (geminiRes.ok) {
        const data = await geminiRes.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const clean = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        return res.status(200).json({ ...parsed, usedApi: 'gemini' });
      }

      const err = await geminiRes.text();
      throw new Error('Gemini API 오류: ' + err);

    } catch (e) {
      console.error('Gemini 오류:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
}

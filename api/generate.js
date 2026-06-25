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

  const prompt = `You are a professional film director and storyboard artist with deep expertise in visual storytelling.

Creative Brief: "${direction}"

Follow this EXACT 3-step process to create a professional storyboard:

STEP 1 - STORY ANALYSIS: Analyze the creative brief and establish the overall narrative arc (beginning, development, climax, resolution). Define the emotional journey, visual tone, and core message.

STEP 2 - SCENE PLANNING: Divide the story into exactly ${count} scenes. For each scene, define its role in the narrative, the directorial intent, camera movement, and emotional beat.

STEP 3 - PROMPT GENERATION: Based on the directorial intent of each scene, create a detailed image generation prompt that captures the specific mood, composition, and visual language required.

Respond ONLY with a valid JSON object in this exact format, no markdown, no extra text:
{
  "title": "스토리보드 제목 (한국어, 20자 이내)",
  "storyLine": "전체 스토리 흐름 설명. 기승전결 구조와 감정선을 포함하여 어떤 이야기를 어떻게 전달할지 서술 (한국어, 200자 이내)",
  "overview": "연출 방향성 요약. 전체적인 비주얼 톤, 카메라 스타일, 색감 방향 (한국어, 100자 이내)",
  "scenes": [
    {
      "title": "씬 제목 (한국어, 10자 이내)",
      "mood": "분위기 키워드 (한국어, 10자 이내)",
      "role": "이 씬이 전체 스토리에서 담당하는 역할 (한국어, 30자 이내)",
      "direction": "연출 의도. 카메라 무빙, 감정선, 시각적 표현 방식 (한국어, 50자 이내)",
      "description": "씬 상세 설명 (한국어, 50자 이내)",
      "prompt": "detailed English image generation prompt based on the directorial intent above. Style: ${style}. Aspect ratio: ${ratio}. Include: specific camera angle and movement, lighting setup, color grading, mood, composition rules, lens type, depth of field, technical photography details. Ultra detailed, high quality, cinematic."
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
          max_tokens: 4096
        })
      });

      if (groqRes.ok) {
        const data = await groqRes.json();
        const text = data.choices?.[0]?.message?.content || '';
        const clean = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        return res.status(200).json({ ...parsed, usedApi: 'groq' });
      }

      const errData = await groqRes.json();
      if (errData?.error?.code !== 429) {
        throw new Error('Groq 오류: ' + JSON.stringify(errData));
      }
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
            generationConfig: { temperature: 0.8, maxOutputTokens: 4096 }
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { scene, models } = req.body;
  if (!scene || !models || models.length === 0) return res.status(400).json({ error: '입력값이 없습니다.' });

  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const MODEL_GUIDES = {
    midjourney: 'Midjourney v6. Start with subject description, add style keywords separated by commas, end with --ar 16:9 --v 6 --style raw --q 2. Use :: for weight. Example format: "subject, environment, lighting, mood, style keywords --ar 16:9 --v 6"',
    stable_diffusion: 'Stable Diffusion SDXL. Use (parentheses) for emphasis, start with quality tags: (masterpiece, best quality, ultra detailed), then subject, environment, lighting. Add negative prompt suggestion at end.',
    dalle3: 'DALL-E 3. Write in natural descriptive English sentences. Be specific about style, lighting, composition. No special syntax needed. Describe as if explaining to a professional photographer.',
    firefly: 'Adobe Firefly. Clear descriptive English. Mention specific art style, lighting conditions, color palette. Keep it clean and descriptive. Works best with style references like "in the style of..."',
    sora: 'Sora (OpenAI video). Describe as a cinematic video scene. Include camera movement (slow pan, dolly shot, aerial view), time of day, weather, subject action, duration feel. Write as a director\'s note.',
    higgsfield: 'Higgsfield Cinematic. Focus on cinematic quality: film stock type, lens mm, aperture, color grading style (Kodak, Fuji, etc), lighting setup, camera angle, mood. Very technical and specific.',
    runway: 'Runway Gen-3. Describe motion and transformation. Include camera movement, subject animation, environmental changes. Good for dynamic scenes. Mention transition styles.',
    kling: 'Kling AI. Detailed scene description with emphasis on motion dynamics, character actions, environmental interaction. Include shot type (close-up, wide shot, etc) and movement direction.'
  };

  const selectedGuides = models.map(m => `- ${m.toUpperCase()}: ${MODEL_GUIDES[m] || 'Standard image generation prompt'}`).join('\n');

  const prompt = `You are an expert AI prompt engineer specializing in optimizing prompts for different AI image and video generation models.

Scene Description: "${scene}"

Convert this scene description into optimized prompts for each of the following AI models. Each prompt must follow the specific syntax and best practices for that model.

Model guidelines:
${selectedGuides}

Respond ONLY with a valid JSON object, no markdown, no extra text:
{
${models.map(m => `  "${m}": "optimized prompt for ${m} here"`).join(',\n')}
}`;

  // Groq 우선 시도
  if (groqKey) {
    try {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 4096
        })
      });

      if (groqRes.ok) {
        const data = await groqRes.json();
        const text = data.choices?.[0]?.message?.content || '';
        const clean = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        return res.status(200).json({ prompts: parsed, usedApi: 'groq' });
      }

      const errData = await groqRes.json();
      if (errData?.error?.code !== 429) throw new Error('Groq 오류: ' + JSON.stringify(errData));
      console.log('Groq 한도 초과, Gemini로 전환');

    } catch(e) {
      if (!e.message.includes('429')) console.error('Groq 오류:', e.message);
    }
  }

  // Gemini 시도
  if (geminiKey) {
    try {
      const geminiRes = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + geminiKey,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
          })
        }
      );

      if (geminiRes.ok) {
        const data = await geminiRes.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const clean = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        return res.status(200).json({ prompts: parsed, usedApi: 'gemini' });
      }

      const err = await geminiRes.text();
      throw new Error('Gemini API 오류: ' + err);

    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
}

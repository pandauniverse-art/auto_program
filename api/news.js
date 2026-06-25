module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query, display = 10, sort = 'date' } = req.body;
  if (!query) return res.status(400).json({ error: '검색어를 입력해주세요.' });

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: '네이버 API 키가 설정되지 않았습니다.' });
  }

  try {
    const url = 'https://openapi.naver.com/v1/search/news.json?query=' + encodeURIComponent(query) + '&display=' + display + '&sort=' + sort;
    const response = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret
      }
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error('네이버 API 오류: ' + err);
    }

    const data = await response.json();

    // HTML 태그 제거 및 데이터 정리
    const items = data.items.map(item => ({
      title: item.title.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      description: item.description.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      link: item.link,
      originallink: item.originallink,
      pubDate: item.pubDate
    }));

    return res.status(200).json({ items, total: data.total, query });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

/**
 * @module SentimentAnalyzer
 * 1-10 Skor Sistemi ile Hibrit Analiz Motoru.
 */

// ── API Base URL (localhost vs Render) ───────────────────────────
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://127.0.0.1:5000'
  : 'https://ba-restaurant-review-analysis.onrender.com';

localStorage.removeItem('geminiApiKey');

// ── Duygu Sözlükleri ────────────────────────────────────────────
const POSITIVE_WORDS = [
  'harika', 'mükemmel', 'lezzetli', 'güzel', 'iyi', 'fevkalade', 'nefis',
  'muhteşem', 'şahane', 'taze', 'kaliteli', 'temiz', 'hızlı', 'nazik',
  'güler yüzlü', 'ilgili', 'tatmin', 'beğendim', 'tavsiye', 'başarılı',
  'enfes', 'doyurucu', 'bol', 'çeşitli', 'keyifli', 'memnun', 'harikulade',
  'süper', 'kusursuz', 'ideal', 'doğal', 'tatlı', 'mis gibi', 'pişmiş',
  'sıcak', 'hızlı servis', 'güvenilir', 'şık', 'samimi', 'hoş', 'tesekkurler', 'teşekkürler'
];

const NEGATIVE_WORDS = [
  'berbat', 'kötü', 'rezalet', 'iğrenç', 'soğuk', 'bayat', 'bozuk',
  'kirli', 'pis', 'yavaş', 'geç', 'kaba', 'ilgisiz', 'sinir', 'hayal kırıklığı',
  'pahalı', 'fahiş', 'uzun bekleme', 'tatsız', 'çiğ', 'yavan', 'eksik',
  'tuzlu', 'acı', 'ekşi', 'yanmış', 'az', 'yetersiz', 'düşük kalite',
  'zavallı', 'saçma', 'vasat', 'sıradan', 'para israf', 'israf', 'bekleme',
  'soğumuş', 'pişmemiş', 'ücret', 'şikayet', 'haksız', 'hatalı', 'yanlış',
  'kokmuş', 'kokmus', 'ayıp', 'ayip', 'az pişmiş', 'az pismis', 'yollanır mı', 'yollanir mi',
  'birdaha sipariş vermem', 'vermem', 'saçma', 'sacma', 'bekledik'
];

const NEGATORS = ['değil', 'hiç', 'asla', 'hiçbir', 'yok', 'olmadı', 'olmaz', 'etmedi', 'etmez', 'yapmadı', 'yapmaz', 'istemiyorum', 'vermem'];
const STOP_WORDS = new Set(['ve','bir','bu','ile','de','da','için','ama','fakat','çünkü','ki','mi','mı','mu','mü','ya','yani','hem','gibi','kadar','sonra','önce','her','bazı','hiç','ne','nasıl','neden','niçin','ise','bile','sadece','zaten','pek','şu','o','biz','siz','onlar','ben','sen','ol','olan','oldu','var','yok','olarak']);

const CATEGORY_KEYWORDS = {
  'Yemek Kalitesi': {
    positive: ['lezzetli', 'nefis', 'taze', 'doyurucu', 'bol', 'kaliteli yemek', 'enfes', 'leziz', 'mis gibi', 'pişmiş', 'yemek', 'yemekler', 'lezzeti', 'tad'],
    negative: ['bayat', 'soğuk yemek', 'pişmemiş', 'yanmış', 'tatsız', 'yavan', 'ekşi', 'çiğ', 'bozuk yemek', 'kötü tat', 'soğuk', 'tatsızdı', 'kokmuş', 'kokmus']
  },
  'Servis': {
    positive: ['hızlı servis', 'zamanında', 'iyi servis', 'verimli', 'düzgün', 'akıcı', 'organize', 'süratli', 'anında', 'servis', 'paket', 'sipariş'],
    negative: ['yavaş', 'yavaş servis', 'geç geldi', 'bekledik', 'uzun bekleme', 'ihmalkar', 'unutuldu', 'karışık sipariş', 'hatalı sipariş', 'eksik']
  },
  'Hijyen': {
    positive: ['temiz', 'hijyenik', 'steril', 'düzgün', 'bakımlı', 'tertemiz', 'pırıl pırıl', 'hijyen', 'temizliği'],
    negative: ['kirli', 'pis', 'hijyensiz', 'iğrenç', 'çöp', 'böcek', 'kötü koku', 'hamam böceği', 'toz', 'saç', 'kıl']
  },
  'Fiyat': {
    positive: ['uygun fiyat', 'makul', 'hesaplı', 'ekonomik', 'para değer', 'ucuz', 'fiyat performans', 'fiyatı'],
    negative: ['pahalı', 'fahiş', 'kazıklandık', 'haksız fiyat', 'aşırı pahalı', 'para israf', 'çok para', 'fiyatlar', 'para']
  },
  'Personel': {
    positive: ['nazik', 'güler yüzlü', 'yardımsever', 'ilgili', 'samimi', 'profesyonel', 'kibarlık', 'sıcakkanlı', 'personel', 'garson', 'çalışanlar', 'ekip'],
    negative: ['kaba', 'ilgisiz', 'sinirli', 'saygısız', 'itici', 'umursamaz', 'tepeden bakan', 'garsonlar']
  },
  'Bekleme Süresi': {
    positive: ['hızlı', 'beklemedik', 'anında', 'çabuk', 'kısa süre', 'süratli'],
    negative: ['uzun bekleme', 'çok bekledik', 'saatler', 'sıra', 'bekleme süresi', 'gecikme', 'geç servis', 'dakika', 'bekletildik']
  }
};

// ── 1-10 Skor Sistemi ────────────────────────────────────────────
function calculateScore(text) {
  if (!text) return 5;
  const lower = text.toLowerCase();
  let posScore = 0;
  let negScore = 0;

  const strongPos = ['mükemmel', 'harika', 'muhteşem', 'fevkalade', 'şahane', 'enfes', 'nefis', 'harikulade', 'kusursuz', 'süper'];
  const normalPos = ['iyi', 'güzel', 'lezzetli', 'temiz', 'nazik', 'hızlı', 'kaliteli', 'taze', 'beğendim', 'tavsiye', 'memnun'];
  const strongNeg = ['berbat', 'rezalet', 'iğrenç', 'korkunç', 'skandal', 'dehşet'];
  const normalNeg = ['kötü', 'yavaş', 'soğuk', 'kirli', 'pahalı', 'kaba', 'bekleme', 'geç', 'eksik', 'hayal kırıklığı', 'vasat'];

  strongPos.forEach(w => { if (lower.includes(w)) posScore += 2; });
  normalPos.forEach(w => { if (lower.includes(w)) posScore += 1; });
  strongNeg.forEach(w => { if (lower.includes(w)) negScore += 2; });
  normalNeg.forEach(w => { if (lower.includes(w)) negScore += 1; });

  NEGATORS.forEach(w => {
    if (lower.includes(w)) {
      const tmp = posScore; posScore = negScore; negScore = tmp;
    }
  });

  const net = posScore - negScore;
  if (net >= 4)  return 10;
  if (net === 3) return 9;
  if (net === 2) return 8;
  if (net === 1) return 7;
  if (net === 0) return 5;
  if (net === -1) return 4;
  if (net === -2) return 3;
  return 1;
}

function scoreToLabel(score) {
  if (score >= 9) return { label: 'Çok İyi',  emoji: '🌟', color: '#16a34a', bg: '#f0fdf4', sentiment: 'positive' };
  if (score >= 7) return { label: 'İyi',       emoji: '😊', color: '#65a30d', bg: '#f7fee7', sentiment: 'positive' };
  if (score >= 5) return { label: 'Nötr',      emoji: '😐', color: '#ca8a04', bg: '#fefce8', sentiment: 'neutral'  };
  if (score >= 3) return { label: 'Kötü',      emoji: '😞', color: '#ea580c', bg: '#fff7ed', sentiment: 'negative' };
  return             { label: 'Çok Kötü', emoji: '😡', color: '#dc2626', bg: '#fef2f2', sentiment: 'negative' };
}

function cleanRawText(text) {
  if (!text) return "";
  return text.replace(/^[\d\s\-\;]+;/, '').trim();
}

function getWordFrequency(reviews) {
  const freq = {};
  reviews.forEach(r => {
    if (!r.text) return;
    const words = r.text.toLowerCase().replace(/[^\w\sçğışöü]/gi, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  });
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 60);
}

function getTrendData(reviews, dateCol, ratingCol) {
  if (!dateCol || !ratingCol) return { labels: [], values: [] };
  const groups = {};
  reviews.forEach(r => {
    const date = r[dateCol]; const rating = r[ratingCol];
    if (!date || rating === null || rating === undefined) return;
    if (!groups[date]) groups[date] = [];
    groups[date].push(Number(rating));
  });
  return {
    labels: Object.keys(groups).sort().map(d => `${d.split('-')[2]}.${d.split('-')[1]}.${d.split('-')[0]}`),
    values: Object.keys(groups).sort().map(d => Math.round((groups[d].reduce((a, b) => a + b, 0) / groups[d].length) * 10) / 10)
  };
}

function advancedClauseAnalyze(text) {
  const cleaned = cleanRawText(text);
  if (!cleaned) return { sentiment: 'neutral', score: 5, categories: ['Yemek Kalitesi'], catSentiments: {} };

  const lower = cleaned.toLowerCase();
  const clauses = lower.split(/,?\s+(?:ama|fakat|ancak|lakin|yalnız|rağmen)\s+/);

  let finalCategories = new Set();
  let catSentiments = {};
  let negCount = 0; let posCount = 0;

  clauses.forEach(clause => {
    let clauseCats = [];
    for (const [cat, dict] of Object.entries(CATEGORY_KEYWORDS)) {
      if ([...dict.positive, ...dict.negative].some(kw => clause.includes(kw))) {
        clauseCats.push(cat); finalCategories.add(cat);
      }
    }

    let pScore = 0; let nScore = 0;
    POSITIVE_WORDS.forEach(w => { if (clause.includes(w)) pScore++; });
    NEGATIVE_WORDS.forEach(w => { if (clause.includes(w)) nScore++; });
    if (clause.includes('iyi pişsin') || clause.includes('iyi pismis')) pScore--;
    NEGATORS.forEach(w => { if (clause.includes(w)) { let tmp = pScore; pScore = nScore; nScore = tmp; } });

    let clauseSent = pScore >= nScore ? 'positive' : 'negative';
    if (NEGATIVE_WORDS.some(nw => clause.includes(nw))) clauseSent = 'negative';

    if (clauseSent === 'negative') negCount++; else posCount++;
    clauseCats.forEach(cat => { catSentiments[cat] = clauseSent; });
  });

  if (finalCategories.size === 0) finalCategories.add('Yemek Kalitesi');

  const score = calculateScore(text);
  const { sentiment } = scoreToLabel(score);

  finalCategories.forEach(cat => {
    if (!catSentiments[cat]) catSentiments[cat] = sentiment === 'neutral'
      ? (negCount >= posCount ? 'negative' : 'positive')
      : sentiment;
  });

  return { sentiment, score, categories: Array.from(finalCategories), catSentiments };
}

function calcCategoryScores(reviews) {
  const scores = {}; const counts = {};
  Object.keys(CATEGORY_KEYWORDS).forEach(cat => { scores[cat] = 0; counts[cat] = 0; });
  reviews.forEach(r => {
    if (!r.catSentiments) return;
    Object.entries(r.catSentiments).forEach(([cat, sent]) => {
      if (cat in scores) { counts[cat]++; if (sent === 'positive') scores[cat]++; }
    });
  });
  const result = {};
  Object.keys(CATEGORY_KEYWORDS).forEach(cat => {
    result[cat] = counts[cat] > 0 ? Math.round((scores[cat] / counts[cat]) * 100) : 50;
  });
  return result;
}

function calcStats(reviews, rows, ratingCol) {
  const total = reviews.length;
  const positiveCount = reviews.filter(r => r.sentiment === 'positive').length;
  const negativeCount = reviews.filter(r => r.sentiment === 'negative').length;
  const neutralCount  = reviews.filter(r => r.sentiment === 'neutral').length;
  const ratings = rows.map(r => r[ratingCol]).filter(p => p !== null && !isNaN(p));

  const veryGoodCount = reviews.filter(r => (r.score || 5) >= 9).length;
  const goodCount     = reviews.filter(r => (r.score || 5) >= 7 && (r.score || 5) < 9).length;
  const neutralCount2 = reviews.filter(r => (r.score || 5) >= 5 && (r.score || 5) < 7).length;
  const badCount      = reviews.filter(r => (r.score || 5) >= 3 && (r.score || 5) < 5).length;
  const veryBadCount  = reviews.filter(r => (r.score || 5) < 3).length;
  const avgScore      = reviews.length
    ? Math.round((reviews.reduce((a, b) => a + (b.score || 5), 0) / reviews.length) * 10) / 10
    : 5;

  return {
    total, positiveCount, negativeCount, neutralCount,
    positiveRate: total > 0 ? Math.round((positiveCount / total) * 100) : 0,
    negativeRate: total > 0 ? Math.round((negativeCount / total) * 100) : 0,
    neutralRate:  total > 0 ? Math.round((neutralCount  / total) * 100) : 0,
    avgRating: ratings.length
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
      : null,
    scoreDist: { veryGoodCount, goodCount, neutralCount: neutralCount2, badCount, veryBadCount },
    avgScore
  };
}

function localAnalyzeData(cleanedData) {
  const { rows, commentCol, ratingCol, dateCol } = cleanedData;
  const reviews = rows.map(row => {
    const text = commentCol ? row[commentCol] : null;
    const cleanText = cleanRawText(text);
    const analysis = advancedClauseAnalyze(text);
    return {
      ...row,
      [commentCol]: cleanText,
      text: cleanText,
      puan: ratingCol ? row[ratingCol] : null,
      sentiment: analysis.sentiment,
      score: analysis.score,
      categories: analysis.categories,
      catSentiments: analysis.catSentiments
    };
  });

  return {
    reviews,
    stats: calcStats(reviews, rows, ratingCol),
    catScores: calcCategoryScores(reviews),
    wordFreq: getWordFrequency(reviews),
    trend: getTrendData(rows, dateCol, ratingCol)
  };
}

async function analyzeData(cleanedData) {
  const { rows, commentCol, ratingCol, dateCol } = cleanedData;

  try {
    const response = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, commentCol }),
      signal: AbortSignal.timeout(120000)
    });

    if (!response.ok) throw new Error();

    const serverResponse = await response.json();
    const geminiResult = serverResponse.data;

    const reviews = rows.map((row, index) => {
      const text = commentCol ? row[commentCol] : null;
      const cleanText = cleanRawText(text);
      const aiData = geminiResult.find(g => g.id === index);
      const localFallback = advancedClauseAnalyze(text);

      const score = aiData ? (aiData.score || calculateScore(text)) : localFallback.score;
      const { sentiment: scoreSentiment } = scoreToLabel(score);

      return {
        ...row,
        [commentCol]: cleanText,
        text: cleanText,
        puan: ratingCol ? row[ratingCol] : null,
        sentiment: aiData ? (aiData.sentiment || scoreSentiment) : localFallback.sentiment,
        score,
        categories: aiData ? aiData.categories : localFallback.categories,
        catSentiments: aiData ? aiData.catSentiments : localFallback.catSentiments
      };
    });

    return {
      reviews,
      stats: calcStats(reviews, rows, ratingCol),
      catScores: calcCategoryScores(reviews),
      wordFreq: getWordFrequency(reviews),
      trend: getTrendData(rows, dateCol, ratingCol)
    };

  } catch (error) {
    console.warn("Python sunucusuna bağlanılamadı, lokal akıllı filtre devrede.");
    return localAnalyzeData(cleanedData);
  }
}

window.analyzeData = analyzeData;
window.calculateScore = calculateScore;
window.scoreToLabel = scoreToLabel;
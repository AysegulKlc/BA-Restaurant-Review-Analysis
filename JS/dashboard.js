/**
 * @module Dashboard
 * Dashboard sayfasını kontrol eden ana modül.
 * 1-10 Skor sistemi + Nötr filtresi destekli.
 */

const DEMO_DATA = {
  headers: ['tarih', 'yorum', 'puan'],
  rows: [
    { tarih: '2024-01-15', yorum: 'Yemekler gerçekten çok lezzetliydi, harika bir deneyimdi!', puan: 5 },
    { tarih: '2024-01-20', yorum: 'Servis yavaştı ama yemekler güzeldi.', puan: 3 },
    { tarih: '2024-01-25', yorum: 'Hijyen konusunda ciddi sorunlar var, tekrar gelmem.', puan: 1 },
    { tarih: '2024-02-01', yorum: 'Fiyatlar biraz yüksek ama kalite de yüksek.', puan: 4 },
    { tarih: '2024-02-05', yorum: 'Personel çok nazikti, mutlaka tavsiye ederim.', puan: 5 },
    { tarih: '2024-02-10', yorum: 'Bekleme süresi çok uzundu, kabul edilemez.', puan: 2 },
    { tarih: '2024-02-14', yorum: 'Nefis yemekler, mis gibi kokan bir ortam. Mükemmel!', puan: 5 },
    { tarih: '2024-02-18', yorum: 'Yemekler soğuk geldi, hayal kırıklığı yaşadım.', puan: 2 },
    { tarih: '2024-02-22', yorum: 'Çok temiz bir mekan, personel ilgili ve güler yüzlü.', puan: 5 },
    { tarih: '2024-02-28', yorum: 'Fiyat/performans açısından gayet uygun bir yer.', puan: 4 },
    { tarih: '2024-03-05', yorum: 'Kaba davrandılar, bir daha gitmem.', puan: 1 },
    { tarih: '2024-03-10', yorum: 'Lezzetli yemekler, taze malzemeler kullanıyorlar.', puan: 4.5 },
    { tarih: '2024-03-15', yorum: 'Oldukça vasat bir deneyimdi, çok para ödedik.', puan: 2 },
    { tarih: '2024-03-20', yorum: 'Harika bir atmosfer, şahane yemekler. Kesinlikle tavsiye!', puan: 5 },
    { tarih: '2024-03-25', yorum: 'Sipariş karışıklığı yaşandı ama düzelttiler.', puan: 3 },
  ],
  commentCol: 'yorum',
  ratingCol: 'puan',
  dateCol: 'tarih',
};

let currentResult = null;

// ── Skor görsel yardımcıları (analyze.js'den bağımsız çalışır) ──
function getScoreVisual(score) {
  const s = score || 5;
  if (s >= 9) return { label: 'Çok İyi',  emoji: '🌟', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' };
  if (s >= 7) return { label: 'İyi',       emoji: '😊', color: '#65a30d', bg: '#f7fee7', border: '#d9f99d' };
  if (s >= 5) return { label: 'Nötr',      emoji: '😐', color: '#ca8a04', bg: '#fefce8', border: '#fef08a' };
  if (s >= 3) return { label: 'Kötü',      emoji: '😞', color: '#ea580c', bg: '#fff7ed', border: '#fed7aa' };
  return             { label: 'Çok Kötü', emoji: '😡', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' };
}

// Skor çubuğu rengi
function getScoreBarColor(score) {
  if (score >= 9) return '#16a34a';
  if (score >= 7) return '#65a30d';
  if (score >= 5) return '#ca8a04';
  if (score >= 3) return '#ea580c';
  return '#dc2626';
}

async function init() {
  let csvData = null;
  let fileName = 'Demo Veri';
  let isDemo = false;

  const stored = localStorage.getItem('csvData');
  if (stored) {
    try {
      csvData = JSON.parse(stored);
      fileName = localStorage.getItem('csvFileName') || 'veri.csv';
    } catch {
      csvData = null;
    }
  }

  if (!csvData || !csvData.rows || csvData.rows.length === 0) {
    csvData = DEMO_DATA;
    isDemo = true;
    const banner = document.getElementById('warningBanner');
    if (banner) banner.classList.add('visible');
  }

  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.add('visible');

  try {
    currentResult = await window.analyzeData(csvData);
    renderAll(currentResult, isDemo ? '📊 Demo Veri' : fileName);
  } catch (err) {
    console.error('Analiz hatası:', err);
  } finally {
    if (overlay) overlay.classList.remove('visible');
  }
}

function renderAll(result, fileName) {
  const { stats, catScores, wordFreq, trend } = result;

  const metaEl = document.getElementById('pageMeta');
  if (metaEl) {
    metaEl.innerHTML = `
      <span>📁 ${fileName}</span>
      <span class="badge badge--gray">${stats.total} yorum</span>
    `;
  }

  const el = (id) => document.getElementById(id);
  if (el('statTotal')) el('statTotal').textContent = stats.total;
  if (el('statAvg'))   el('statAvg').textContent   = stats.avgRating !== null ? stats.avgRating + ' / 5' : '–';
  if (el('statPos'))   el('statPos').textContent   = stats.positiveRate + '%';
  if (el('statNeg'))   el('statNeg').textContent   = stats.negativeRate + '%';

  // Ortalama skor göster (varsa)
  if (el('statAvgScore') && stats.avgScore) {
    const v = getScoreVisual(stats.avgScore);
    el('statAvgScore').textContent = stats.avgScore + ' / 10';
    el('statAvgScore').style.color = v.color;
  }

  renderSentimentPie(stats);
  renderCategoryBar(catScores);
  renderTrendLine(trend);
  renderWordCloud(wordFreq);
  renderScoreBars(catScores);
  renderScoreDistribution(stats);

  renderReviews('all');
}

// ── Skor Dağılım Çubuğu (opsiyonel yeni widget) ─────────────────
function renderScoreDistribution(stats) {
  const el = document.getElementById('scoreDistribution');
  if (!el || !stats.scoreDist) return;

  const dist = stats.scoreDist;
  const total = stats.total || 1;

  const bands = [
    { label: 'Çok İyi (9-10)', count: dist.veryGoodCount,  color: '#16a34a' },
    { label: 'İyi (7-8)',      count: dist.goodCount,       color: '#65a30d' },
    { label: 'Nötr (5-6)',     count: dist.neutralCount,    color: '#ca8a04' },
    { label: 'Kötü (3-4)',     count: dist.badCount,        color: '#ea580c' },
    { label: 'Çok Kötü (1-2)',count: dist.veryBadCount,    color: '#dc2626' },
  ];

  el.innerHTML = bands.map(b => {
    const pct = Math.round((b.count / total) * 100);
    return `
      <div class="score-dist-row">
        <span class="score-dist-label">${b.label}</span>
        <div class="score-dist-bar-wrap">
          <div class="score-dist-bar" style="width:${pct}%;background:${b.color}"></div>
        </div>
        <span class="score-dist-count">${b.count}</span>
      </div>
    `;
  }).join('');
}

// ── Yorum Listesi ────────────────────────────────────────────────
function renderReviews(filter) {
  if (!currentResult) return;

  const container = document.getElementById('reviewsList');
  if (!container) return;

  let reviews = currentResult.reviews;
  if (filter === 'pos')     reviews = reviews.filter(r => r.sentiment === 'positive');
  if (filter === 'neg')     reviews = reviews.filter(r => r.sentiment === 'negative');
  if (filter === 'neutral') reviews = reviews.filter(r => r.sentiment === 'neutral');
  if (filter === 'vgood')   reviews = reviews.filter(r => (r.score || 5) >= 9);
  if (filter === 'bad')     reviews = reviews.filter(r => (r.score || 5) < 3);

  if (!reviews.length) {
    container.innerHTML = '<div style="padding:20px;color:#6b6460;text-align:center">Bu filtrede yorum bulunamadı.</div>';
    return;
  }

  container.innerHTML = reviews.map(r => {
    const score = r.score || 5;
    const v = getScoreVisual(score);

    // Tarih bul
    const dateKey = Object.keys(r).find(k => k.toLowerCase().includes('tarih') || k.toLowerCase().includes('date'));
    const date = r.tarih || r.date || (dateKey ? r[dateKey] : '') || '';

    // Puan rozeti
    const ratingBadge = (r.puan !== null && r.puan !== undefined)
      ? `<span class="badge badge--gold">★ ${r.puan}</span>` : '';

    // Kaynak rozeti (Google / Yemeksepeti)
    const sourceBadge = r.kaynak
      ? `<span class="badge badge--source">${r.kaynak === 'Google Reviews' ? '🗺️' : '🍱'} ${r.kaynak}</span>` : '';

    // Kategori etiketleri — nötr yorumlarda + / - göster
    const catTags = (r.categories || []).map(c => {
      const catSent = r.catSentiments?.[c];
      let indicator = '';
      if (catSent === 'positive') indicator = ' <span style="color:#16a34a;font-weight:700">+</span>';
      if (catSent === 'negative') indicator = ' <span style="color:#dc2626;font-weight:700">−</span>';
      return `<span class="cat-tag">${c}${indicator}</span>`;
    }).join('');

    // Skor çubuğu
    const barWidth = (score / 10) * 100;
    const barColor = getScoreBarColor(score);

    return `
      <div class="review-item" style="border-left: 3px solid ${v.color}">
        <div class="review-item__score-badge" style="background:${v.bg};border:1px solid ${v.border};color:${v.color}">
          <span class="score-badge__emoji">${v.emoji}</span>
          <span class="score-badge__num">${score}<span style="font-size:0.7em;opacity:0.7">/10</span></span>
          <span class="score-badge__label">${v.label}</span>
          <div class="score-badge__bar-wrap">
            <div class="score-badge__bar" style="width:${barWidth}%;background:${barColor}"></div>
          </div>
        </div>

        <div class="review-item__body">
          <div class="review-item__text">${r.text || '(Yorum metni yok)'}</div>
          <div class="review-item__meta">
            ${date ? `<span class="review-item__date">📅 ${date}</span>` : ''}
            ${ratingBadge}
            ${sourceBadge}
            <div class="review-item__cats">${catTags}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ── Event Listener'lar ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  init();

  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderReviews(tab.dataset.filter);
    });
  });

  const reportBtn = document.getElementById('reportBtn');
  if (reportBtn) {
    reportBtn.addEventListener('click', () => {
      window.location.href = 'rapor.html';
    });
  }
});
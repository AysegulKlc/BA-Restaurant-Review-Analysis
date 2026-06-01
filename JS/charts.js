/**
 * @module Charts
 * Chart.js kullanarak tüm grafikleri render eden modül.
 * Her grafik fonksiyonu bağımsız çalışır.
 */

// Kayıtlı Chart örneklerini takip et – yeniden render'da öncekini yok et
const chartInstances = {};

/**
 * Önceki chart örneğini temizle.
 * @param {string} id - Canvas element ID
 */
function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

/**
 * Olumlu/Olumsuz dağılım – Doughnut grafik
 * Renk: yeşil (olumlu) + tuğla kırmızı (olumsuz)
 * Ortada toplam yorum sayısı yazısı
 * @param {{ positiveCount: number, negativeCount: number, total: number }} stats
 */
function renderSentimentPie(stats) {
  const canvas = document.getElementById('sentimentChart');
  if (!canvas) return;

  destroyChart('sentimentChart');

  // Ortada toplam yorum sayısı plugin
  const centerTextPlugin = {
    id: 'centerText',
    beforeDraw(chart) {
      const { width, height, ctx } = chart;
      ctx.save();
      const x = width / 2;
      const y = height / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 28px "DM Sans", sans-serif';
      ctx.fillStyle = '#1c1a17';
      ctx.fillText(stats.total, x, y - 10);
      ctx.font = '13px "DM Sans", sans-serif';
      ctx.fillStyle = '#6b6460';
      ctx.fillText('Yorum', x, y + 14);
      ctx.restore();
    },
  };

  chartInstances['sentimentChart'] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Olumlu', 'Olumsuz'],
      datasets: [{
        data: [stats.positiveCount, stats.negativeCount],
        backgroundColor: ['#2d7a4f', '#c8410a'],
        borderWidth: 0,
        hoverOffset: 6,
      }],
    },
    options: {
      cutout: '68%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 20, font: { family: 'DM Sans', size: 13 }, color: '#1c1a17' },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const pct = Math.round((ctx.raw / stats.total) * 100);
              return ` ${ctx.raw} yorum (${pct}%)`;
            },
          },
        },
      },
    },
    plugins: [centerTextPlugin],
  });
}

/**
 * Kategori memnuniyet skorları – Yatay Bar grafik
 * Skor >= 65 → yeşil, >= 45 → altın, < 45 → kırmızı
 * X ekseni 0-100 arası, yüzde etiketi
 * @param {Object} catScores - { 'Yemek Kalitesi': 74, ... }
 */
function renderCategoryBar(catScores) {
  const canvas = document.getElementById('categoryChart');
  if (!canvas) return;

  destroyChart('categoryChart');

  const labels = Object.keys(catScores);
  const values = Object.values(catScores);

  // Skora göre renk belirle
  const colors = values.map(v => v >= 65 ? '#2d7a4f' : v >= 45 ? '#d4952a' : '#c8410a');

  chartInstances['categoryChart'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Memnuniyet Skoru (%)',
        data: values,
        backgroundColor: colors,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.raw}%` },
        },
      },
      scales: {
        x: {
          min: 0,
          max: 100,
          grid: { color: '#f0ebe4' },
          ticks: {
            callback: v => v + '%',
            font: { family: 'DM Sans', size: 12 },
            color: '#6b6460',
          },
        },
        y: {
          grid: { display: false },
          ticks: { font: { family: 'DM Sans', size: 12 }, color: '#1c1a17' },
        },
      },
    },
  });
}

/**
 * Zaman içinde puan trendi – Line grafik
 * Dolgu alanı şeffaf kırmızı
 * Noktalar hover'da büyür
 * Y ekseni 0-5 arası
 * @param {{ labels: string[], values: number[] }} trend
 */
function renderTrendLine(trend) {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;

  destroyChart('trendChart');

  if (!trend.labels.length) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '14px DM Sans, sans-serif';
    ctx.fillStyle = '#6b6460';
    ctx.textAlign = 'center';
    ctx.fillText('Trend için tarih verisi gereklidir.', canvas.width / 2, 60);
    return;
  }

  chartInstances['trendChart'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: trend.labels,
      datasets: [{
        label: 'Ortalama Puan',
        data: trend.values,
        borderColor: '#c8410a',
        backgroundColor: 'rgba(200,65,10,0.08)',
        fill: true,
        tension: 0.35,
        pointRadius: 5,
        pointHoverRadius: 8,
        pointBackgroundColor: '#c8410a',
        borderWidth: 2.5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.raw} / 5` },
        },
      },
      scales: {
        y: {
          min: 0,
          max: 5,
          grid: { color: '#f0ebe4' },
          ticks: {
            stepSize: 1,
            font: { family: 'DM Sans', size: 12 },
            color: '#6b6460',
          },
        },
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 45,
            font: { family: 'DM Sans', size: 11 },
            color: '#6b6460',
            maxTicksLimit: 12,
          },
        },
      },
    },
  });
}

/**
 * Kelime bulutu – Saf CSS/HTML ile render
 * Chart.js kullanılmaz, custom render yapılır.
 * Kelime büyüklüğü: frekansa göre 11px - 28px arası
 * Renk: yüksek frekans → vurgu rengi, düşük → gri
 * Hover'da opacity artışı
 * @param {Array} wordFreq - [[kelime, sayı], ...] sıralı dizi
 */
function renderWordCloud(wordFreq) {
  const container = document.getElementById('wordCloud');
  if (!container) return;

  if (!wordFreq.length) {
    container.innerHTML = '<span style="color:#6b6460;font-size:0.9rem">Yorum verisi bulunamadı.</span>';
    return;
  }

  const maxFreq = wordFreq[0][1];
  const minFreq = wordFreq[wordFreq.length - 1][1];
  const range = maxFreq - minFreq || 1;

  // Frekansa göre font size ve renk hesapla
  const html = wordFreq.slice(0, 50).map(([word, count]) => {
    const ratio = (count - minFreq) / range;
    const fontSize = Math.round(11 + ratio * 17); // 11px – 28px
    const opacity = 0.45 + ratio * 0.55; // 0.45 – 1.0
    const color = ratio > 0.6 ? '#c8410a' : ratio > 0.3 ? '#d4952a' : '#6b6460';

    return `<span
      class="word-cloud__word"
      style="font-size:${fontSize}px;color:${color};opacity:${opacity}"
      title="${count} kez geçiyor"
    >${word}</span>`;
  }).join('');

  container.innerHTML = html;
}

/**
 * Kategori skor barları – Animasyonlu CSS progress bar
 * Chart.js değil, custom HTML/CSS.
 * Sayfa yüklenince 0'dan hedefe kadar CSS transition animasyonu.
 * @param {Object} catScores - { 'Yemek Kalitesi': 74, ... }
 */
function renderScoreBars(catScores) {
  const container = document.getElementById('scoreBars');
  if (!container) return;

  // Renk sınıfını skora göre belirle
  function colorClass(score) {
    if (score >= 65) return 'score-bar-fill--green';
    if (score >= 45) return 'score-bar-fill--gold';
    return 'score-bar-fill--red';
  }

  // HTML oluştur – barlar başlangıçta 0 genişliğinde
  const html = Object.entries(catScores).map(([cat, score]) => `
    <div class="score-bar-item">
      <div class="score-bar-header">
        <span>${cat}</span>
        <span style="font-weight:700">${score}%</span>
      </div>
      <div class="score-bar-track">
        <div class="score-bar-fill ${colorClass(score)}" data-target="${score}" style="width:0%"></div>
      </div>
    </div>
  `).join('');

  container.innerHTML = html;

  // Kısa gecikme sonrası animasyonu başlat (CSS transition için 0 → hedef)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      container.querySelectorAll('.score-bar-fill').forEach(bar => {
        bar.style.width = bar.dataset.target + '%';
      });
    });
  });
}

// Diğer modüller kullanabilsin diye window'a bağla
window.renderSentimentPie = renderSentimentPie;
window.renderCategoryBar = renderCategoryBar;
window.renderTrendLine = renderTrendLine;
window.renderWordCloud = renderWordCloud;
window.renderScoreBars = renderScoreBars;
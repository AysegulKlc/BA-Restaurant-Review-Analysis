/**
 * @module PlatformFetch
 * Google Reviews (SerpApi) ve Yemeksepeti'nden yorum çeker.
 * Çekilen veriler mevcut analiz pipeline'ına beslenir.
 */

// ── Durum değişkenleri ───────────────────────────────────────────
let fetchedRows = null;
let fetchedSource = null; // 'google' | 'yemeksepeti'

/**
 * Aktif sekmeyi değiştirir ve ilgili formu gösterir.
 * @param {'csv'|'google'|'yemeksepeti'} tab
 */
function switchTab(tab) {
  document.querySelectorAll('.source-tab').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.source-panel').forEach(panel => panel.classList.remove('active'));

  const tabBtn = document.querySelector(`[data-tab="${tab}"]`);
  const panel = document.getElementById(`panel-${tab}`);
  if (tabBtn) tabBtn.classList.add('active');
  if (panel) panel.classList.add('active');

  // Analiz butonunu sıfırla
  const analyzeBtn = document.getElementById('analyzeBtn');
  if (analyzeBtn && tab !== 'csv') analyzeBtn.disabled = true;
}

/**
 * Google Reviews yorumlarını SerpApi üzerinden çeker.
 */
async function fetchGoogleReviews() {
  const placeName = document.getElementById('googlePlaceName')?.value?.trim();
  const serpApiKey = document.getElementById('serpApiKey')?.value?.trim();
  const statusEl = document.getElementById('googleStatus');

  if (!placeName) {
    showFetchError('googleStatus', 'Lütfen restoran adını girin.');
    return;
  }
  if (!serpApiKey) {
    showFetchError('googleStatus', 'Lütfen SerpApi key\'inizi girin.');
    return;
  }

  // SerpApi key'i localStorage'a kaydet (kullanıcı kolaylığı)
  localStorage.setItem('serpApiKey', serpApiKey);

  setFetchLoading('googleStatus', '🔍 Google Maps\'te aranıyor...');

  try {
    const response = await fetch('http://127.0.0.1:5000/api/google-reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ place_name: placeName, serpapi_key: serpApiKey })
    });

    const result = await response.json();

    if (result.status !== 'success') {
      showFetchError('googleStatus', result.message);
      return;
    }

    fetchedRows = result.rows;
    fetchedSource = 'google';

    // localStorage'a kaydet (analiz sayfası okuyacak)
    const cleanedPayload = {
      rows: result.rows,
      headers: ['yorum', 'puan', 'tarih', 'kaynak', 'yazar'],
      commentCol: 'yorum',
      ratingCol: 'puan',
      dateCol: 'tarih',
      source: 'google',
      placeName: result.place?.name || placeName
    };
    localStorage.setItem('csvData', JSON.stringify(cleanedPayload));
    localStorage.setItem('csvFileName', `Google: ${result.place?.name || placeName}`);

    showFetchSuccess('googleStatus', result);

    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) analyzeBtn.disabled = false;

  } catch (err) {
    showFetchError('googleStatus', 'Sunucuya bağlanılamadı. Flask sunucusunun çalıştığından emin olun (python app.py).');
  }
}

/**
 * Yemeksepeti yorumlarını çeker.
 */
async function fetchYemeksepeti() {
  const restaurantUrl = document.getElementById('ysUrl')?.value?.trim();
  const restaurantName = document.getElementById('ysName')?.value?.trim();

  if (!restaurantUrl && !restaurantName) {
    showFetchError('ysStatus', 'Lütfen restoran URL\'si veya adını girin.');
    return;
  }

  setFetchLoading('ysStatus', '🔍 Yemeksepeti\'nde aranıyor...');

  try {
    const response = await fetch('http://127.0.0.1:5000/api/yemeksepeti', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        restaurant_url: restaurantUrl,
        restaurant_name: restaurantName
      })
    });

    const result = await response.json();

    if (result.status !== 'success') {
      showFetchError('ysStatus', result.message);
      return;
    }

    fetchedRows = result.rows;
    fetchedSource = 'yemeksepeti';

    const cleanedPayload = {
      rows: result.rows,
      headers: ['yorum', 'puan', 'tarih', 'kaynak', 'yazar'],
      commentCol: 'yorum',
      ratingCol: 'puan',
      dateCol: 'tarih',
      source: 'yemeksepeti',
      placeName: result.place?.name || restaurantName || 'Restoran'
    };
    localStorage.setItem('csvData', JSON.stringify(cleanedPayload));
    localStorage.setItem('csvFileName', `Yemeksepeti: ${result.place?.name || restaurantName}`);

    showFetchSuccess('ysStatus', result);

    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) analyzeBtn.disabled = false;

  } catch (err) {
    showFetchError('ysStatus', 'Sunucuya bağlanılamadı. Flask sunucusunun çalıştığından emin olun (python app.py).');
  }
}

// ── UI Yardımcı Fonksiyonlar ─────────────────────────────────────

function setFetchLoading(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.className = 'fetch-status fetch-status--loading';
  el.innerHTML = `<span class="fetch-status__spinner"></span> ${msg}`;
  el.style.display = 'flex';
}

function showFetchError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.className = 'fetch-status fetch-status--error';
  el.innerHTML = `<span>⚠️</span> ${msg}`;
  el.style.display = 'flex';
}

function showFetchSuccess(elId, result) {
  const el = document.getElementById(elId);
  if (!el) return;
  const placeName = result.place?.name || '';
  const count = result.count || 0;
  const rating = result.place?.rating ? ` · ⭐ ${result.place.rating}` : '';
  const total = result.place?.total_reviews ? ` (toplam ${result.place.total_reviews} yorum)` : '';

  el.className = 'fetch-status fetch-status--success';
  el.innerHTML = `
    <span>✅</span>
    <div>
      <strong>${placeName}</strong>${rating}<br>
      <span>${count} yorum çekildi${total}. Analizi başlatmaya hazır.</span>
    </div>
  `;
  el.style.display = 'flex';
}

// ── Sayfa Yüklendiğinde ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Sekme butonları
  document.querySelectorAll('.source-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Google Reviews butonu
  const googleBtn = document.getElementById('fetchGoogleBtn');
  if (googleBtn) googleBtn.addEventListener('click', fetchGoogleReviews);

  // Yemeksepeti butonu
  const ysBtn = document.getElementById('fetchYsBtn');
  if (ysBtn) ysBtn.addEventListener('click', fetchYemeksepeti);

  // Kayıtlı SerpApi key'i geri yükle
  const savedKey = localStorage.getItem('serpApiKey');
  const serpKeyInput = document.getElementById('serpApiKey');
  if (savedKey && serpKeyInput) serpKeyInput.value = savedKey;

  // Enter tuşu desteği
  document.getElementById('googlePlaceName')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') fetchGoogleReviews();
  });
  document.getElementById('ysName')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') fetchYemeksepeti();
  });
});

window.switchTab = switchTab;
window.fetchGoogleReviews = fetchGoogleReviews;
window.fetchYemeksepeti = fetchYemeksepeti;
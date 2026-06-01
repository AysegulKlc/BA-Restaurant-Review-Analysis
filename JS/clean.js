/**
 * @module DataCleaner
 * Kirli CSV verilerini analiz edilebilir hale getiren temizleme motoru.
 * Gerçek dünya verilerinde sık karşılaşılan sorunları otomatik düzeltir.
 */

/**
 * ADIM 1 – BOŞ SATIR VE SÜTUN TEMİZLEME
 */
function removeEmptyRows(rows) {
  let removed = 0;
  const trimmed = rows.map(row => {
    const out = {};
    for (const key in row) {
      const val = row[key];
      if (typeof val === 'string') {
        const t = val.trim();
        out[key] = t === '' ? null : t;
      } else {
        out[key] = val;
      }
    }
    return out;
  });

  const filtered = trimmed.filter(row => {
    const vals = Object.values(row);
    const isEmpty = vals.every(v => v === null || v === '');
    if (isEmpty) removed++;
    return !isEmpty;
  });

  return { rows: filtered, removed };
}

/**
 * ADIM 2 – YORUM SÜTUNU DOĞRULAMA
 */
function validateCommentColumn(rows, commentCol) {
  if (!commentCol) return { rows, marked: 0, removed: 0 };
  let marked = 0; let removed = 0;
  const seen = new Set();
  const result = [];
  rows.forEach(row => {
    const text = row[commentCol];
    if (!text) { result.push(row); return; }
    const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(norm)) { removed++; return; }
    seen.add(norm);
    const out = { ...row };
    if (norm.length < 5) { out.__short = true; marked++; }
    if (text.length > 2000) { out[commentCol] = text.slice(0, 2000); out.__truncated = true; marked++; }
    result.push(out);
  });
  return { rows: result, marked, removed };
}

/**
 * ADIM 3 – PUAN SÜTUNU NORMALİZASYONU
 */
function normalizeRatingColumn(rows, ratingCol) {
  if (!ratingCol) return { rows, fixed: 0 };
  let fixed = 0;
  const result = rows.map(row => {
    const raw = row[ratingCol];
    if (raw === null || raw === undefined) return row;
    const str = String(raw).trim();
    let val = null;
    const pctMatch = str.match(/^(\d+(?:[.,]\d+)?)\s*\/\s*100$/);
    if (pctMatch) { val = (parseFloat(pctMatch[1].replace(',', '.')) / 100) * 5; }
    if (val === null) {
      const fracMatch = str.match(/^(\d+(?:[.,]\d+)?)\s*\/\s*(\d+)$/);
      if (fracMatch && fracMatch[2] !== '100') {
        val = (parseFloat(fracMatch[1].replace(',', '.')) / parseFloat(fracMatch[2])) * 5;
      }
    }
    if (val === null) {
      const wordMatch = str.match(/^(\d+(?:[.,]\d+)?)\s*(yıldız|star|puan|\/|\.|,)?/i);
      if (wordMatch) val = parseFloat(wordMatch[1].replace(',', '.'));
    }
    if (val === null) {
      const commaMatch = str.match(/^(\d+),(\d+)$/);
      if (commaMatch) val = parseFloat(`${commaMatch[1]}.${commaMatch[2]}`);
    }
    if (val === null) {
      const num = parseFloat(str);
      if (!isNaN(num)) val = num;
    }
    if (val !== null && (isNaN(val) || val < 0 || val > 5)) val = null;
    if (val !== null) val = Math.round(val * 10) / 10;
    const out = { ...row, [ratingCol]: val };
    if (String(raw) !== String(val)) { out.__ratingFixed = true; fixed++; }
    return out;
  });
  return { rows: result, fixed };
}

/**
 * ADIM 4 – TARİH SÜTUNU NORMALİZASYONU
 */
function normalizeDateColumn(rows, dateCol) {
  if (!dateCol) return { rows, fixed: 0, future: 0 };
  let fixed = 0; let future = 0;
  const now = new Date();
  const TR_MONTHS = { ocak: '01', şubat: '02', mart: '03', nisan: '04', mayıs: '05', haziran: '06', temmuz: '07', ağustos: '08', eylül: '09', ekim: '10', kasım: '11', aralık: '12' };
  const EN_MONTHS = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };

  function parseDate(str) {
    if (!str) return null;
    const s = str.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const dotMatch = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (dotMatch) return `${dotMatch[3]}-${dotMatch[2].padStart(2,'0')}-${dotMatch[1].padStart(2,'0')}`;
    const trMonth = s.toLowerCase().match(/^(?:(\d{1,2})\s+)?(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\s+(\d{4})$/);
    if (trMonth) {
      const day = trMonth[1] ? trMonth[1].padStart(2,'0') : '01';
      return `${trMonth[3]}-${TR_MONTHS[trMonth[2]]}-${day}`;
    }
    const enMonth = s.toLowerCase().match(/^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:(\d{1,2})\s+)?(\d{4})$/);
    if (enMonth) {
      const day = enMonth[2] ? enMonth[2].padStart(2,'0') : '01';
      return `${enMonth[3]}-${EN_MONTHS[enMonth[1]]}-${day}`;
    }
    return null;
  }

  const result = rows.map(row => {
    const raw = row[dateCol];
    if (!raw) return row;
    const parsed = parseDate(String(raw));
    const out = { ...row, [dateCol]: parsed };
    if (parsed && parsed !== String(raw)) { out.__dateFixed = true; fixed++; }
    if (parsed) {
      const d = new Date(parsed);
      if (!isNaN(d) && d > now) { out.__futureDate = true; future++; }
    }
    return out;
  });
  return { rows: result, fixed, future };
}

/**
 * ADIM 5 – ENCODING VE KARAKTER SORUNLARI
 */
function fixEncoding(rows, commentCol) {
  let fixed = 0;
  const ENCODING_MAP = [ [/Ã¼/g, 'ü'], [/Ã¶/g, 'ö'], [/Ã§/g, 'ç'], [/Äÿ/g, 'ğ'], [/Å/g, 'ş'], [/Ä±/g, 'ı'], [/Ã‡/g, 'Ç'], [/Ä°/g, 'İ'], [/Ãœ/g, 'Ü'], [/Ã–/g, 'Ö'], [/ÄŸ/g, 'ğ'], [/Åž/g, 'Ş'], [/â€™/g, "'"], [/â€œ/g, '"'], [/â€/g, '"'], [/Ã©/g, 'é'], [/Ã /g, 'à'] ];
  const ENTITY_MAP = [ [/&amp;/g, '&'], [/&lt;/g, '<'], [/&gt;/g, '>'], [/&quot;/g, '"'], [/&#39;/g, "'"], [/&nbsp;/g, ' '] ];

  function fixText(text) {
    if (typeof text !== 'string') return text;
    let out = text;
    for (const [pat, rep] of ENCODING_MAP) out = out.replace(pat, rep);
    for (const [pat, rep] of ENTITY_MAP) out = out.replace(pat, rep);
    out = out.replace(/([!?.,:;])\1{2,}/g, '$1$1');
    out = out.replace(/[^\S\n]+/g, ' ').trim();
    return out;
  }

  const result = rows.map(row => {
    if (!commentCol || !row[commentCol]) return row;
    const orig = row[commentCol];
    const fixed_text = fixText(orig);
    if (fixed_text !== orig) { fixed++; return { ...row, [commentCol]: fixed_text, __encodingFixed: true }; }
    return row;
  });
  return { rows: result, fixed };
}

/**
 * ADIM 6 – TEMİZLEME RAPORU OLUŞTUR
 */
function buildCleaningReport(stats, originalCount, finalCount) {
  const issues = [];
  if (stats.emptyRemoved > 0) issues.push(`${stats.emptyRemoved} boş satır silindi`);
  if (stats.duplicateRemoved > 0) issues.push(`${stats.duplicateRemoved} kopya yorum kaldırıldı`);
  if (stats.shortMarked > 0) issues.push(`${stats.shortMarked} çok kısa yorum işaretlendi`);
  if (stats.ratingFixed > 0) issues.push(`${stats.ratingFixed} puan formatı düzeltildi`);
  if (stats.dateFixed > 0) issues.push(`${stats.dateFixed} tarih formatı normalleştirildi`);
  if (stats.futureDates > 0) issues.push(`${stats.futureDates} gelecek tarihli kayıt tespit edildi`);
  if (stats.encodingFixed > 0) issues.push(`${stats.encodingFixed} encoding/karakter hatası düzeltildi`);

  return { originalCount, finalCount, removedCount: originalCount - finalCount, issues, stats };
}

/**
 * Yorum sütununu tanımlamak için sütun adlarını inceler.
 */
function detectCommentColumn(headers) {
  const patterns = ['yorum', 'text', 'review', 'açıklama', 'aciklama', 'comment', 'görüş', 'gorus', 'feedback', 'mesaj', 'değerlendirme', 'eleştiri', 'şikayet', 'içerik'];
  for (const p of patterns) {
    const found = headers.find(h => h.trim().toLowerCase().includes(p));
    if (found) return found;
  }
  const backup = headers.find(h => h.toLowerCase().includes('müşteri'));
  return backup || headers[headers.length - 1] || null;
}

/**
 * Puan sütununu tanımlamak için sütun adlarını inceler.
 */
function detectRatingColumn(headers) {
  const patterns = ['puan', 'rating', 'score', 'yıldız', 'yildiz', 'not', 'değerlendirme'];
  for (const p of patterns) {
    const found = headers.find(h => h.trim().toLowerCase().includes(p));
    if (found) return found;
  }
  return null;
}

/**
 * Tarih sütununu tanımlamak için sütun adlarını inceler.
 */
function detectDateColumn(headers) {
  const patterns = ['tarih', 'date', 'zaman', 'time', 'created', 'timestamp'];
  for (const p of patterns) {
    const found = headers.find(h => h.trim().toLowerCase().includes(p));
    if (found) return found;
  }
  return null;
}

/**
 * Ana temizleme fonksiyonu – tüm adımları sırayla çalıştırır.
 */
function cleanData(rawData) {
  const { headers, rows: rawRows } = rawData;
  const originalCount = rawRows.length;

  const commentCol = detectCommentColumn(headers);
  const ratingCol = detectRatingColumn(headers);
  const dateCol = detectDateColumn(headers);

  const step1 = removeEmptyRows(rawRows);
  const step5 = fixEncoding(step1.rows, commentCol);
  const step2 = validateCommentColumn(step5.rows, commentCol);
  const step3 = normalizeRatingColumn(step2.rows, ratingCol);
  const step4 = normalizeDateColumn(step3.rows, dateCol);

  const finalRows = step4.rows;
  const finalCount = finalRows.length;

  const report = buildCleaningReport({
    emptyRemoved: step1.removed,
    duplicateRemoved: step2.removed,
    shortMarked: step2.marked,
    ratingFixed: step3.fixed,
    dateFixed: step4.fixed,
    futureDates: step4.future,
    encodingFixed: step5.fixed,
  }, originalCount, finalCount);

  return { headers, rows: finalRows, commentCol, ratingCol, dateCol, report };
}

/**
 * Temizleme raporunu kullanıcıya mini kartlar şeklinde gösterir.
 */
function showCleaningReport(report) {
  const container = document.getElementById('cleanReport');
  if (!container) return;

  const cards = [
    { label: 'Orijinal satır', value: report.originalCount, icon: '📋' },
    { label: 'Temizlenen satır', value: report.finalCount, icon: '✅' },
    { label: 'Silinen satır', value: report.removedCount, icon: '🗑️' },
    { label: 'Sorun tespit edildi', value: report.issues.length, icon: '🔍' },
  ];

  const cardsHtml = cards.map(c =>
    `<div class="clean-card">${c.icon} <strong>${c.value}</strong> ${c.label}</div>`
  ).join('');

  const issuesHtml = report.issues.length
    ? report.issues.map(i => `<div class="clean-card">⚠️ ${i}</div>`).join('')
    : '<div class="clean-card">✨ Sorun tespit edilmedi</div>';

  container.innerHTML = cardsHtml + issuesHtml;
  container.classList.add('visible');
}

// Diğer modüller kullanabilsin diye window'a bağla
window.cleanData = cleanData;
window.showCleaningReport = showCleaningReport;
window.detectCommentColumn = detectCommentColumn;
window.detectRatingColumn = detectRatingColumn;
window.detectDateColumn = detectDateColumn;
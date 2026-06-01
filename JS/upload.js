/**
 * @module Upload
 * CSV dosyası yükleme, parse etme ve önizleme modülü.
 */

/**
 * CSV metnini satırlara ve sütunlara ayırır.
 * Tırnak içindeki virgülleri (quoted fields) doğru işler.
 * BOM karakterini (UTF-8 with BOM) baştan temizler.
 * @param {string} text - Ham CSV metni
 * @returns {{ headers: string[], rows: Object[] }}
 */
function parseCSV(text) {
  // BOM karakterini temizle
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/);

  if (lines.length < 2) return { headers: [], rows: [] };

  /**
   * Tek bir CSV satırını tırnak destekli şekilde ayrıştırır.
   * @param {string} line
   * @returns {string[]}
   */
  function parseLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        // Çift tırnak kaçış karakteri: "" → "
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  // Başlık satırını parse et
  const headers = parseLine(lines[0]).map(h => h.trim());

  // Veri satırlarını parse et
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] !== undefined ? values[idx] : null;
    });
    rows.push(row);
  }

  return { headers, rows };
}

/** Mevcut yüklü veri – önizleme için saklanır */
let currentCleanResult = null;
let currentFileName = '';

/**
 * Dosya yüklendiğinde çalışır:
 * 1. FileReader ile UTF-8 oku
 * 2. parseCSV ile parse et
 * 3. clean.js → cleanData() ile temizle
 * 4. Temizleme raporunu göster
 * 5. Önizleme tablosunu render et
 * 6. localStorage'a kaydet (Kota aşımını engellemek için sınırla)
 * @param {File} file - Kullanıcının seçtiği dosya
 */
function handleFile(file) {
  if (!file || !file.name.endsWith('.csv')) {
    showError('Lütfen geçerli bir .csv dosyası seçin.');
    return;
  }

  currentFileName = file.name;

  // FileReader ile dosyayı UTF-8 olarak oku
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const text = e.target.result;

      // CSV parse et
      const rawData = parseCSV(text);

      if (rawData.headers.length === 0 || rawData.rows.length === 0) {
        showError('CSV dosyası boş veya geçersiz format. Lütfen örnek dosyayı indirin.');
        return;
      }

      // Veri temizleme motorunu çalıştır
      let cleanResult = window.cleanData(rawData);

      // 🚨 KOTA KORUMASI: Eğer dosya çok büyükse, sadece ilk 1500 satırı al
      const MAX_ROWS = 1500;
      if (cleanResult.rows.length > MAX_ROWS) {
        cleanResult.rows = cleanResult.rows.slice(0, MAX_ROWS);
        cleanResult.report.issues.push(`Dosya çok büyük olduğu için hafıza sınırına takıldı. Analiz için sadece ilk ${MAX_ROWS} yorum kullanılacak.`);
      }

      currentCleanResult = cleanResult;

      // Temizleme raporunu göster
      window.showCleaningReport(cleanResult.report);

      // Önizleme tablosunu render et
      showPreview(file.name, cleanResult);

      // Analiz butonunu aktif et
      const analyzeBtn = document.getElementById('analyzeBtn');
      if (analyzeBtn) analyzeBtn.disabled = false;

      // localStorage'a kaydet – Hata yakalama (try-catch) bloğu ile
      try {
        localStorage.setItem('csvData', JSON.stringify(cleanResult));
        localStorage.setItem('csvFileName', file.name);
      } catch (storageError) {
        showError('Tarayıcı hafızası doldu! Lütfen verinizi biraz küçülterek tekrar yükleyin.');
        if (analyzeBtn) analyzeBtn.disabled = true;
      }

    } catch (err) {
      showError('Dosya işlenirken hata oluştu: ' + err.message);
    }
  };

  reader.onerror = () => showError('Dosya okunamadı.');
  reader.readAsText(file, 'UTF-8');
}

/**
 * İlk 8 satırı önizleme tablosuna yazar.
 * Uzun metin hücrelerini ellipsis ile kırpar.
 * Temizleme sonrası değişen hücreleri sarı ile işaretler.
 * @param {string} fileName - Yüklenen dosyanın adı
 * @param {Object} cleanResult - cleanData'dan dönen nesne
 */
function showPreview(fileName, cleanResult) {
  const section = document.getElementById('previewSection');
  const nameEl = document.getElementById('previewFileName');
  const countEl = document.getElementById('previewCount');
  const tableWrap = document.getElementById('previewTable');

  if (!section) return;

  const { headers, rows, report } = cleanResult;
  const previewRows = rows.slice(0, 8);

  // Dosya adı ve satır sayısı
  if (nameEl) nameEl.textContent = fileName;
  if (countEl) {
    countEl.innerHTML = `
      <span class="badge badge--green">${report.finalCount} satır</span>
      ${report.removedCount > 0 ? `<span class="badge badge--red">${report.removedCount} silindi</span>` : ''}
    `;
  }

  // Tablo başlıkları
  const thead = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;

  // Tablo satırları – değiştirilen hücreleri işaretle
  const tbody = `<tbody>${previewRows.map(row => {
    const cells = headers.map(h => {
      const val = row[h];
      const changed = row.__ratingFixed || row.__dateFixed || row.__encodingFixed || row.__truncated;
      const cellClass = changed ? ' class="cell--changed"' : '';
      const display = val !== null && val !== undefined
        ? String(val).length > 40 ? String(val).slice(0, 40) + '…' : String(val)
        : '–';
      return `<td${cellClass}>${display}</td>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  }).join('')}</tbody>`;

  if (tableWrap) tableWrap.innerHTML = `<table>${thead}${tbody}</table>`;

  section.classList.add('visible');
}

/**
 * Örnek CSV dosyasını oluşturup indirir.
 * 15 gerçekçi Türkçe yorum içerir.
 * Sütunlar: tarih, yorum, puan
 */
function downloadSampleCSV() {
  const rows = [
    ['tarih', 'yorum', 'puan'],
    ['15.01.2024', 'Yemekler gerçekten çok lezzetliydi, harika bir deneyimdi!', '5'],
    ['20.01.2024', 'Servis yavaştı ama yemekler güzeldi.', '3'],
    ['25.01.2024', 'Hijyen konusunda ciddi sorunlar var, tekrar gelmem.', '1'],
    ['01.02.2024', 'Fiyatlar biraz yüksek ama kalite de yüksek.', '4'],
    ['05.02.2024', 'Personel çok nazikti, mutlaka tavsiye ederim.', '5'],
    ['10.02.2024', 'Bekleme süresi çok uzundu, kabul edilemez.', '2'],
    ['14.02.2024', 'Nefis yemekler, mis gibi kokan bir ortam. Mükemmel!', '5'],
    ['18.02.2024', 'Yemekler soğuk geldi, hayal kırıklığı yaşadım.', '2'],
    ['22.02.2024', 'Çok temiz bir mekan, personel ilgili ve güler yüzlü.', '5/5'],
    ['28.02.2024', 'Fiyat/performans açısından gayet uygun bir yer.', '4'],
    ['Mart 2024', 'Kaba davrandılar, bir daha gitmem.', '1'],
    ['10.03.2024', 'Lezzetli yemekler, taze malzemeler kullanıyorlar.', '4,5'],
    ['15.03.2024', 'Oldukça vasat bir deneyimdi, çok para ödedik.', '2'],
    ['20.03.2024', 'Harika bir atmosfer, şahane yemekler. Kesinlikle tavsiye!', '5'],
    ['25.03.2024', 'Sipariş karışıklığı yaşandı ama düzelttiler.', '3'],
  ];

  // CSV satırlarını birleştir
  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  // İndirme bağlantısı oluştur ve tıkla
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ornek-restoran-yorumlari.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Hata mesajını upload zone altında gösterir.
 * @param {string} msg - Gösterilecek hata mesajı
 */
function showError(msg) {
  let el = document.getElementById('uploadError');
  if (!el) {
    el = document.createElement('div');
    el.id = 'uploadError';
    el.style.cssText = 'color:#c8410a;font-size:0.875rem;margin-top:10px;padding:10px 14px;background:#fdeee8;border-radius:8px;';
    const zone = document.getElementById('uploadZone');
    if (zone) zone.parentNode.insertBefore(el, zone.nextSibling);
  }
  el.textContent = msg;
  el.style.display = 'block';
}

// Sayfa yüklendiğinde event dinleyicileri kur
document.addEventListener('DOMContentLoaded', () => {
  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const sampleBtn = document.getElementById('sampleBtn');

  if (!uploadZone) return;

  // Drag & drop – dragover: varsayılan davranışı engelle ve görsel geri bildirim ver
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  // Drag & drop – dragleave: görsel geri bildirimi kaldır
  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
  });

  // Drag & drop – drop: dosyayı al ve işle
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // Tıklayarak dosya seçme – file input tetikle
  uploadZone.addEventListener('click', (e) => {
    if (e.target !== fileInput) fileInput.click();
  });

  // File input değişimi – kullanıcı dosya seçtiğinde
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleFile(file);
    });
  }

  // "Analizi Başlat" butonu – dashboard'a yönlendir
  if (analyzeBtn) {
  analyzeBtn.addEventListener('click', () => {
    if (currentCleanResult || localStorage.getItem('csvData')) {
      window.location.href = 'pages/dashboard.html';
    }
  });
}

  // Örnek CSV indirme butonu
  if (sampleBtn) {
    sampleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      downloadSampleCSV();
    });
  }
});

// Diğer modüller kullanabilsin diye window'a bağla
window.parseCSV = parseCSV;
window.downloadSampleCSV = downloadSampleCSV;
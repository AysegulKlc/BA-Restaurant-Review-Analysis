"""
gemini_eval.py
==============
Gemini LLM'i app.py üzerinden test eder.
Önce: python app.py  (ayrı terminalde çalışıyor olmalı)
Sonra: python gemini_eval.py

Çıktı: model_eval.py ile aynı formatta konsol raporu
"""

import re
import sys
import json
import random

try:
    import requests
    import numpy as np
    from sklearn.metrics import (accuracy_score, f1_score,
                                 precision_score, recall_score,
                                 confusion_matrix)
except ImportError:
    print("Eksik paket: pip install requests scikit-learn numpy")
    sys.exit(1)

DATA_PATH   = "Restaurant_Reviews.csv"
FLASK_URL   = "http://127.0.0.1:5000/api/analyze"
TEST_SIZE   = 50   # 25 pozitif + 25 negatif
RANDOM_SEED = 42

# ── Veriyi oku ───────────────────────────────────────────────────
def load_data(path):
    rows = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()
    for line in lines[1:]:
        clean = re.sub(r";+.*$", "", line.strip())
        m = re.match(r"^(.*),([01])$", clean.strip())
        if m:
            rows.append({"text": m.group(1).strip(),
                         "label": int(m.group(2))})
    return rows

# ── Flask sunucusu çalışıyor mu? ─────────────────────────────────
def check_server():
    try:
        r = requests.get("http://127.0.0.1:5000/", timeout=3)
        return True
    except Exception:
        try:
            # /api/analyze'a boş istek at, bağlantı varsa 4xx döner
            requests.post(FLASK_URL, json={}, timeout=3)
            return True
        except requests.exceptions.ConnectionError:
            return False

# ── Gemini'ye gönder ─────────────────────────────────────────────
def gemini_predict(samples):
    """
    app.py'deki /api/analyze endpoint'ini kullanır.
    Her sample: {"text": "...", "label": 0|1}
    Döner: tahmin listesi (0 veya 1)
    """
    rows = [{"yorum": s["text"]} for s in samples]

    try:
        resp = requests.post(
            FLASK_URL,
            json={"rows": rows, "commentCol": "yorum"},
            timeout=60
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("status") != "success":
            print(f"  API Hatası: {data.get('message')}")
            return None

        gemini_results = data["data"]

        preds = []
        for item in gemini_results:
            sentiment = item.get("sentiment", "positive")
            preds.append(1 if sentiment == "positive" else 0)

        return preds

    except requests.exceptions.Timeout:
        print("  HATA: Gemini isteği zaman aşımına uğradı (60s).")
        return None
    except requests.exceptions.ConnectionError:
        print("  HATA: Flask sunucusuna bağlanılamadı.")
        print("  Çözüm: Ayrı bir terminalde 'python app.py' çalıştırın.")
        return None
    except Exception as e:
        print(f"  HATA: {e}")
        return None

# ── Değerlendirme ────────────────────────────────────────────────
def evaluate(y_true, y_pred, model_name):
    acc  = accuracy_score(y_true, y_pred) * 100
    prec = precision_score(y_true, y_pred, zero_division=0) * 100
    rec  = recall_score(y_true, y_pred, zero_division=0) * 100
    f1   = f1_score(y_true, y_pred, zero_division=0) * 100
    cm   = confusion_matrix(y_true, y_pred)
    tn, fp, fn, tp = cm.ravel()

    print(f"\n{'='*52}")
    print(f"  {model_name}")
    print(f"  (Test seti: {len(y_true)} yorum — dengeli örnekleme)")
    print(f"{'-'*52}")
    print(f"  Accuracy  : %{acc:.2f}")
    print(f"  Precision : %{prec:.2f}")
    print(f"  Recall    : %{rec:.2f}")
    print(f"  F1-Score  : %{f1:.2f}")
    print(f"{'-'*52}")
    print(f"  TP: {int(tp):4d}  |  FP: {int(fp):4d}")
    print(f"  FN: {int(fn):4d}  |  TN: {int(tn):4d}")
    print(f"{'='*52}")

    return {
        "accuracy": round(acc, 2), "precision": round(prec, 2),
        "recall": round(rec, 2), "f1": round(f1, 2),
        "tp": int(tp), "tn": int(tn), "fp": int(fp), "fn": int(fn)
    }

# ── ANA PROGRAM ──────────────────────────────────────────────────
def main():
    print("\n" + "="*52)
    print("  GEMİNİ LLM — PERFORMANS TESTİ")
    print("  (app.py Flask API üzerinden)")
    print("="*52)

    # Sunucu kontrolü
    print("\n  Flask sunucusu kontrol ediliyor...")
    if not check_server():
        print("\n  HATA: app.py çalışmıyor!")
        print("  Çözüm: Yeni bir terminal açın ve şunu çalıştırın:")
        print("         python app.py")
        sys.exit(1)
    print("  ✓ Sunucu aktif (127.0.0.1:5000)")

    # Veriyi yükle
    try:
        rows = load_data(DATA_PATH)
    except FileNotFoundError:
        print(f"\n  HATA: '{DATA_PATH}' bulunamadı.")
        sys.exit(1)

    # Dengeli örnekleme: 25 pozitif + 25 negatif
    random.seed(RANDOM_SEED)
    pos = [r for r in rows if r["label"] == 1]
    neg = [r for r in rows if r["label"] == 0]
    samples = random.sample(pos, TEST_SIZE // 2) + random.sample(neg, TEST_SIZE // 2)
    random.shuffle(samples)

    print(f"\n  Test seti hazırlandı.")
    print(f"  Toplam  : {len(samples)} yorum")
    print(f"  Pozitif : {sum(1 for s in samples if s['label']==1)}")
    print(f"  Negatif : {sum(1 for s in samples if s['label']==0)}")
    print(f"\n  Gemini'ye gönderiliyor... (bu 10-30 saniye sürebilir)")

    # Gemini tahmini al
    preds = gemini_predict(samples)
    if preds is None:
        print("\n  Test tamamlanamadı.")
        sys.exit(1)

    if len(preds) != len(samples):
        print(f"\n  UYARI: {len(samples)} yorum gönderildi, {len(preds)} tahmin döndü.")
        # Eksik tahminleri positive olarak tamamla
        preds += [1] * (len(samples) - len(preds))

    # Değerlendir
    y_true = [s["label"] for s in samples]
    result = evaluate(y_true, preds, "Gemini 2.5 Flash (LLM)")

    # Yanlış tahminleri göster
    wrong = [(samples[i]["text"], y_true[i], preds[i])
             for i in range(len(samples)) if y_true[i] != preds[i]]
    if wrong:
        print(f"\n  Yanlış tahmin sayısı: {len(wrong)}")
        print("  İlk 3 yanlış tahmin:")
        for text, true, pred in wrong[:3]:
            true_lbl = "Pozitif" if true == 1 else "Negatif"
            pred_lbl = "Pozitif" if pred == 1 else "Negatif"
            short = text[:60] + "..." if len(text) > 60 else text
            print(f"    Gerçek:{true_lbl:9} | Tahmin:{pred_lbl:9} | {short}")

    # Dosyaya ekle
    with open("eval_sonuclari.txt", "a", encoding="utf-8") as f:
        f.write(f"\nModel    : Gemini 2.5 Flash (LLM)\n")
        f.write(f"Accuracy : %{result['accuracy']}\n")
        f.write(f"F1-Score : %{result['f1']}\n")
        f.write(f"Test seti: {len(samples)} yorum (dengeli örnekleme)\n")

    print(f"\n  Sonuç 'eval_sonuclari.txt' dosyasına eklendi.")
    print("="*52 + "\n")

if __name__ == "__main__":
    main()
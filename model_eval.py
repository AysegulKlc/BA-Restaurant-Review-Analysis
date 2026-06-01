"""
model_eval.py
=============
Restoran Yorum Analizi — Model Karşılaştırma ve Doğrulama Scripti
Veri Seti : UCI Restaurant Reviews (988 yorum, ikili etiket)

Kullanım  : python model_eval.py
Çıktı     : Konsol raporu + eval_sonuclari.txt
"""

import re
import sys

# ── Bağımlılık kontrolü ───────────────────────────────────────────
try:
    import pandas as pd
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.naive_bayes import MultinomialNB
    from sklearn.svm import LinearSVC
    from sklearn.model_selection import cross_val_score, StratifiedKFold
    from sklearn.metrics import (accuracy_score, f1_score,
                                 precision_score, recall_score,
                                 confusion_matrix, classification_report)
    import numpy as np
except ImportError:
    print("Eksik paket. Şunu çalıştırın: pip install scikit-learn pandas numpy")
    sys.exit(1)

# ── Veri yükleme ─────────────────────────────────────────────────
DATA_PATH = "Restaurant_Reviews.csv"   # script ile aynı klasörde olmalı

def load_data(path):
    rows = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()
    for line in lines[1:]:                           # başlık satırını atla
        clean = re.sub(r";+.*$", "", line.strip())   # sondaki ;; kalıntılarını sil
        m = re.match(r"^(.*),([01])$", clean.strip())
        if m:
            rows.append({"text": m.group(1).strip(),
                         "label": int(m.group(2))})
    return rows

# ── Kural Tabanlı Sözlük Motoru ──────────────────────────────────
POSITIVE = [
    "loved","great","amazing","excellent","delicious","fantastic",
    "wonderful","perfect","best","good","awesome","friendly","fresh",
    "tasty","nice","clean","fast","recommend","outstanding","superb",
    "pleasant","enjoyed","love","satisfied","happy","impressed",
    "gem","yummy","scrumptious","magnificent","stellar","incredible",
    "harika","mükemmel","lezzetli","güzel","iyi","nefis","muhteşem"
]
NEGATIVE = [
    "bad","terrible","awful","horrible","disgusting","poor","worst",
    "slow","rude","cold","nasty","gross","disappointed","overpriced",
    "mediocre","bland","stale","dirty","wrong","upset","angry","never",
    "avoid","waste","undercooked","hair","waited","not worth","not good",
    "not fresh","not tasty","not recommend","no good","no taste",
    "berbat","kötü","rezalet","iğrenç","yavaş","kirli","hayal kırıklığı"
]
NEGATORS = ["not","no","never","don't","wasn't","couldn't",
            "isn't","aren't","didn't","won't","hardly","barely"]

def lexicon_predict(text):
    lower = text.lower()
    words = lower.split()
    pos = sum(1 for w in POSITIVE if w in lower)
    neg = sum(1 for w in NEGATIVE if w in lower)
    for i, w in enumerate(words):
        if w in NEGATORS:
            for j in range(i + 1, min(i + 4, len(words))):
                if words[j] in [p for p in POSITIVE if " " not in p]:
                    pos -= 1
                    neg += 1
    return 1 if pos > neg else 0

# ── Değerlendirme Fonksiyonu ──────────────────────────────────────
def evaluate_binary(y_true, y_pred, model_name):
    acc  = accuracy_score(y_true, y_pred) * 100
    prec = precision_score(y_true, y_pred, zero_division=0) * 100
    rec  = recall_score(y_true, y_pred, zero_division=0) * 100
    f1   = f1_score(y_true, y_pred, zero_division=0) * 100
    cm   = confusion_matrix(y_true, y_pred)
    tn, fp, fn, tp = cm.ravel()
    return {
        "model": model_name,
        "accuracy": round(acc, 2),
        "precision": round(prec, 2),
        "recall": round(rec, 2),
        "f1": round(f1, 2),
        "tp": int(tp), "tn": int(tn),
        "fp": int(fp), "fn": int(fn)
    }

def print_result(r):
    sep = "-" * 52
    print(f"\n{'='*52}")
    print(f"  {r['model']}")
    print(sep)
    print(f"  Accuracy  : %{r['accuracy']:.2f}")
    print(f"  Precision : %{r['precision']:.2f}")
    print(f"  Recall    : %{r['recall']:.2f}")
    print(f"  F1-Score  : %{r['f1']:.2f}")
    print(sep)
    print(f"  TP: {r['tp']:4d}  |  FP: {r['fp']:4d}")
    print(f"  FN: {r['fn']:4d}  |  TN: {r['tn']:4d}")
    print(f"{'='*52}")

# ── ANA PROGRAM ───────────────────────────────────────────────────
def main():
    print("\n" + "="*52)
    print("  RESTORAN YORUM ANALİZİ — MODEL DEĞERLENDİRME")
    print("="*52)

    # Veriyi yükle
    try:
        rows = load_data(DATA_PATH)
    except FileNotFoundError:
        print(f"\nHATA: '{DATA_PATH}' bulunamadı.")
        print("Script ile aynı klasöre Restaurant_Reviews.csv koyun.")
        sys.exit(1)

    texts  = [r["text"]  for r in rows]
    labels = [r["label"] for r in rows]
    y      = np.array(labels)

    print(f"\n  Veri seti yüklendi.")
    print(f"  Toplam yorum : {len(rows)}")
    print(f"  Pozitif (1)  : {sum(labels)}")
    print(f"  Negatif (0)  : {len(labels) - sum(labels)}")

    results = []

    # 1. Kural Tabanlı Sözlük
    print("\n[1/3] Kural Tabanlı Sözlük (Lexicon) test ediliyor...")
    lex_preds = [lexicon_predict(t) for t in texts]
    r1 = evaluate_binary(labels, lex_preds, "Kural Tabanlı Sözlük (Lexicon)")
    print_result(r1)
    results.append(r1)

    # 2. Naive Bayes — 5-fold CV
    print("\n[2/3] Naive Bayes (TF-IDF + 5-fold CV) eğitiliyor...")
    vec = TfidfVectorizer(ngram_range=(1, 2), max_features=5000)
    X   = vec.fit_transform(texts)
    cv  = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    nb  = MultinomialNB()

    nb_acc  = cross_val_score(nb, X, y, cv=cv, scoring="accuracy").mean() * 100
    nb_f1   = cross_val_score(nb, X, y, cv=cv, scoring="f1").mean() * 100
    nb_prec = cross_val_score(nb, X, y, cv=cv, scoring="precision").mean() * 100
    nb_rec  = cross_val_score(nb, X, y, cv=cv, scoring="recall").mean() * 100

    r2 = {"model": "Naive Bayes (TF-IDF, 5-fold CV)",
          "accuracy": round(nb_acc,2), "precision": round(nb_prec,2),
          "recall": round(nb_rec,2), "f1": round(nb_f1,2),
          "tp":"-", "tn":"-", "fp":"-", "fn":"-"}
    print(f"\n{'='*52}")
    print(f"  {r2['model']}")
    print("-"*52)
    print(f"  Accuracy  : %{r2['accuracy']:.2f}  (5-fold ortalama)")
    print(f"  Precision : %{r2['precision']:.2f}")
    print(f"  Recall    : %{r2['recall']:.2f}")
    print(f"  F1-Score  : %{r2['f1']:.2f}")
    print(f"{'='*52}")
    results.append(r2)

    # 3. SVM — 5-fold CV
    print("\n[3/3] SVM / LinearSVC (TF-IDF + 5-fold CV) eğitiliyor...")
    svm = LinearSVC(max_iter=2000, random_state=42)

    svm_acc  = cross_val_score(svm, X, y, cv=cv, scoring="accuracy").mean() * 100
    svm_f1   = cross_val_score(svm, X, y, cv=cv, scoring="f1").mean() * 100
    svm_prec = cross_val_score(svm, X, y, cv=cv, scoring="precision").mean() * 100
    svm_rec  = cross_val_score(svm, X, y, cv=cv, scoring="recall").mean() * 100

    r3 = {"model": "SVM / LinearSVC (TF-IDF, 5-fold CV)",
          "accuracy": round(svm_acc,2), "precision": round(svm_prec,2),
          "recall": round(svm_rec,2), "f1": round(svm_f1,2),
          "tp":"-", "tn":"-", "fp":"-", "fn":"-"}
    print(f"\n{'='*52}")
    print(f"  {r3['model']}")
    print("-"*52)
    print(f"  Accuracy  : %{r3['accuracy']:.2f}  (5-fold ortalama)")
    print(f"  Precision : %{r3['precision']:.2f}")
    print(f"  Recall    : %{r3['recall']:.2f}")
    print(f"  F1-Score  : %{r3['f1']:.2f}")
    print(f"{'='*52}")
    results.append(r3)

    # Özet tablo
    print("\n\n" + "="*52)
    print("  ÖZET KARŞILAŞTIRMA TABLOSU")
    print("="*52)
    print(f"  {'Model':<35} {'Acc%':>6}  {'F1%':>6}")
    print("-"*52)
    for r in results:
        print(f"  {r['model']:<35} {r['accuracy']:>6.2f}  {r['f1']:>6.2f}")
    print("="*52)
    print("\n  NOT: Gemini LLM sonuçları API sandbox kısıtı nedeniyle")
    print("       bu scriptte ölçülememektedir. Rapordaki değerler")
    print("       literatür referanslarına dayanmaktadır.")

    # Dosyaya yaz
    with open("eval_sonuclari.txt", "w", encoding="utf-8") as f:
        f.write("RESTORAN YORUM ANALİZİ — MODEL DEĞERLENDİRME SONUÇLARI\n")
        f.write(f"Veri seti: {DATA_PATH} | Toplam: {len(rows)} yorum\n\n")
        for r in results:
            f.write(f"Model    : {r['model']}\n")
            f.write(f"Accuracy : %{r['accuracy']}\n")
            f.write(f"F1-Score : %{r['f1']}\n\n")

    print("\n  Sonuçlar 'eval_sonuclari.txt' dosyasına da kaydedildi.")
    print("="*52 + "\n")

if __name__ == "__main__":
    main()
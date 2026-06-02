from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from google import genai
from google.genai import types
import json
import os
import mimetypes
import requests
from bs4 import BeautifulSoup
import time
import re
import unicodedata
from urllib.parse import parse_qs, urlparse

app = Flask(__name__)
CORS(app)

# ── Statik Dosya Servisi ─────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

@app.route('/')
def index():
    return send_from_directory(BASE_DIR, 'index.html')

@app.route('/css/<path:filename>')
def css_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, 'CSS'), filename)

@app.route('/js/<path:filename>')
def js_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, 'JS'), filename)

@app.route('/pages/<path:filename>')
def pages_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, 'PAges'), filename)

@app.route('/<path:filename>')
def static_files(filename):
    mime_type, _ = mimetypes.guess_type(filename)
    if not mime_type:
        mime_type = 'application/octet-stream'
    try:
        return send_from_directory(BASE_DIR, filename, mimetype=mime_type)
    except Exception:
        return "Not Found", 404

# ── Gemini Kurulumu ──────────────────────────────────────────────
API_KEY = os.environ.get('GEMINI_API_KEY', '')
try:
    client = genai.Client(api_key=API_KEY) if API_KEY else None
except Exception as e:
    print(f"Gemini client hatası: {e}")
    client = None
MODEL_ID = "gemini-2.5-flash"
SERPAPI_API_KEY = os.environ.get('SERPAPI_API_KEY', '')

SISTEM_TALIMATI = """
Müşteri yorumlarını analiz et. SADECE aşağıda verilen saf JSON formatında bir Array döndür.
Markdown veya ekstra açıklamalar KESİNLİKLE olmayacak.

Her yorum için 1-10 arası bir "score" ver:
- 1-2: Çok Kötü
- 3-4: Kötü
- 5-6: Nötr
- 7-8: İyi
- 9-10: Çok İyi

"sentiment" alanı:
- 1-4  → "negative"
- 5-6  → "neutral"
- 7-10 → "positive"

FORMAT:
[
  {
    "id": 0,
    "score": 8,
    "sentiment": "positive",
    "categories": ["Yemek Kalitesi", "Servis"],
    "catSentiments": {
      "Yemek Kalitesi": "positive",
      "Servis": "negative"
    }
  }
]
"""

CATEGORY_KEYWORDS = {
    "Yemek Kalitesi": {
        "positive": ["lezzetli", "nefis", "taze", "doyurucu", "kaliteli", "enfes", "guzel", "güzel", "sicak", "sıcak"],
        "negative": ["bayat", "soguk", "soğuk", "pismemis", "pişmemiş", "yanmis", "yanmış", "tatsiz", "tatsız", "cig", "çiğ", "bozuk", "kokmus", "kokmuş"]
    },
    "Servis": {
        "positive": ["hizli servis", "hızlı servis", "zamaninda", "zamanında", "servis iyi", "siparis hizli", "sipariş hızlı"],
        "negative": ["yavas", "yavaş", "gec geldi", "geç geldi", "bekledik", "eksik", "unutuldu", "hatalı sipariş", "hatali siparis"]
    },
    "Hijyen": {
        "positive": ["temiz", "hijyenik", "steril", "tertemiz"],
        "negative": ["kirli", "pis", "hijyensiz", "igrenc", "iğrenç", "koku", "sac", "saç", "kil", "kıl"]
    },
    "Fiyat": {
        "positive": ["uygun fiyat", "makul", "hesapli", "hesaplı", "ekonomik", "fiyat performans"],
        "negative": ["pahali", "pahalı", "fahis", "fahiş", "kazik", "kazık", "para israf", "çok para", "cok para"]
    },
    "Personel": {
        "positive": ["nazik", "guler yuzlu", "güler yüzlü", "ilgili", "samimi", "yardimsever", "yardımsever"],
        "negative": ["kaba", "ilgisiz", "saygisiz", "saygısız", "umursamaz", "sinirli"]
    },
    "Bekleme Süresi": {
        "positive": ["hizli", "hızlı", "beklemedik", "cabuk", "çabuk", "aninda", "anında"],
        "negative": ["uzun bekleme", "cok bekledik", "çok bekledik", "gecikme", "bekletildik", "dakika bekledik"]
    }
}

POSITIVE_WORDS = [
    "harika", "mukemmel", "mükemmel", "lezzetli", "guzel", "güzel", "iyi", "nefis",
    "muhteşem", "muhtesem", "sahane", "şahane", "taze", "kaliteli", "temiz",
    "hizli", "hızlı", "nazik", "ilgili", "memnun", "tavsiye", "basarili", "başarılı",
    "enfes", "doyurucu", "bol", "keyifli", "super", "süper", "kusursuz"
]
NEGATIVE_WORDS = [
    "berbat", "kotu", "kötü", "rezalet", "igrenc", "iğrenç", "soguk", "soğuk",
    "bayat", "bozuk", "kirli", "pis", "yavas", "yavaş", "gec", "geç", "kaba",
    "ilgisiz", "pahali", "pahalı", "tatsiz", "tatsız", "cig", "çiğ", "eksik",
    "yanmis", "yanmış", "az", "yetersiz", "vasat", "bekleme", "şikayet", "sikayet",
    "hatalı", "hatali", "kokmus", "kokmuş", "ayip", "ayıp", "gelmedi", "umursamaz"
]
NEGATORS = ["degil", "değil", "hic", "hiç", "asla", "yok", "olmadı", "olmadi", "etmedi", "yapmadı", "yapmadi"]


def normalize_text(text):
    text = str(text or "").lower()
    text = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in text if not unicodedata.combining(ch))


def calculate_local_score(text):
    lower = normalize_text(text)
    if not lower.strip():
        return 5
    pos_score = sum(2 if w in ["mukemmel", "mükemmel", "harika", "muhteşem", "muhtesem", "sahane", "şahane", "kusursuz"] else 1 for w in POSITIVE_WORDS if w in lower)
    neg_score = sum(2 if w in ["berbat", "rezalet", "igrenc", "iğrenç", "skandal"] else 1 for w in NEGATIVE_WORDS if w in lower)
    if any(w in lower for w in NEGATORS):
        pos_score, neg_score = neg_score, pos_score
    net = pos_score - neg_score
    if net >= 4:
        return 10
    if net == 3:
        return 9
    if net == 2:
        return 8
    if net == 1:
        return 7
    if net == 0:
        return 5
    if net == -1:
        return 4
    if net == -2:
        return 3
    return 1


def score_to_sentiment(score):
    if score >= 7:
        return "positive"
    if score >= 5:
        return "neutral"
    return "negative"


def local_analyze_rows(rows, comment_col='yorum'):
    results = []
    for i, row in enumerate(rows):
        text = str(row.get(comment_col, '') or '')
        lower = normalize_text(text)
        score = calculate_local_score(text)
        sentiment = score_to_sentiment(score)
        categories = []
        cat_sentiments = {}
        for category, words in CATEGORY_KEYWORDS.items():
            pos_hit = any(word in lower for word in words["positive"])
            neg_hit = any(word in lower for word in words["negative"])
            if pos_hit or neg_hit:
                categories.append(category)
                cat_sentiments[category] = "negative" if neg_hit and not pos_hit else "positive"
        if not categories:
            categories = ["Yemek Kalitesi"]
            cat_sentiments["Yemek Kalitesi"] = sentiment
        results.append({
            "id": i,
            "score": score,
            "sentiment": sentiment,
            "categories": categories,
            "catSentiments": cat_sentiments
        })
    return results


def fallback_report(neg_reviews):
    categories = {}
    for item in local_analyze_rows([{"yorum": r.get("text", "")} for r in neg_reviews], "yorum"):
        for cat in item["categories"]:
            categories[cat] = categories.get(cat, 0) + 1
    top_categories = sorted(categories.items(), key=lambda pair: pair[1], reverse=True)[:5]
    lines = [
        "## Operasyonel İyileştirme Planı",
        "",
        "Gemini API kullanılamadığı için rapor lokal analizle üretildi.",
        "",
        "### Öncelikli Sorun Alanları",
    ]
    if top_categories:
        lines.extend([f"- {cat}: {count} olumsuz sinyal" for cat, count in top_categories])
    else:
        lines.append("- Belirgin kategori bulunamadı; yorumlar manuel kontrol edilmeli.")
    lines.extend([
        "",
        "### Aksiyonlar",
        "- En sık geçen şikayet kategorileri için günlük kontrol listesi oluşturun.",
        "- Düşük puanlı yorumları vardiya, ürün ve servis süresiyle eşleştirip tekrar eden nedenleri ayırın.",
        "- Personel ve servis şikayetlerinde kısa geri bildirim toplantısı ve örnek vaka eğitimi planlayın.",
        "- Yemek kalitesi veya hijyen şikayetlerinde tedarik, hazırlık ve teslim sıcaklığı kontrollerini kayıt altına alın."
    ])
    return "\n".join(lines)


def pick_first_place(search_data):
    candidates = []
    for key in ("place_results", "local_results", "organic_results"):
        value = search_data.get(key)
        if isinstance(value, dict):
            candidates.append(value)
        elif isinstance(value, list):
            candidates.extend([item for item in value if isinstance(item, dict)])
    for place in candidates:
        if place.get("data_id") or place.get("place_id") or place.get("data_cid") or place.get("cid"):
            return place
    return candidates[0] if candidates else None


def extract_place_token(place):
    for key in ("data_id", "place_id"):
        if place.get(key):
            return key, str(place[key])
    place_id_search = place.get("place_id_search") or place.get("gps_coordinates_search")
    if place_id_search:
        parsed = urlparse(place_id_search)
        query = parse_qs(parsed.query)
        for key in ("place_id", "data_id"):
            if query.get(key):
                return key, query[key][0]
    return None, ""


def parse_google_review(rev):
    text = (
        rev.get("snippet", "") or
        rev.get("text", "") or
        rev.get("comment", "") or
        rev.get("extracted_snippet", {}).get("original", "")
    )
    if not text:
        return None
    return {
        "yorum": text,
        "puan": rev.get("rating", None),
        "tarih": rev.get("date", "") or rev.get("iso_date", ""),
        "kaynak": "Google Reviews",
        "yazar": rev.get("user", {}).get("name", "Anonim")
    }


def collect_review_rows_from_json(value, rows=None):
    if rows is None:
        rows = []
    if len(rows) >= 80:
        return rows
    if isinstance(value, dict):
        text = (
            value.get("reviewBody") or value.get("comment") or value.get("text") or
            value.get("description") or value.get("message") or value.get("content")
        )
        if isinstance(text, str) and len(text.strip()) >= 5:
            rating_value = None
            rating = value.get("reviewRating") or value.get("rating") or value.get("ratingValue")
            if isinstance(rating, dict):
                rating_value = rating.get("ratingValue") or rating.get("value")
            else:
                rating_value = rating
            author = value.get("author") or value.get("user") or value.get("customer")
            if isinstance(author, dict):
                author = author.get("name") or author.get("displayName") or "Anonim"
            rows.append({
                "yorum": text.strip(),
                "puan": rating_value,
                "tarih": value.get("datePublished") or value.get("date") or value.get("createdAt") or "",
                "kaynak": "Yemeksepeti",
                "yazar": str(author or "Anonim")
            })
        for child in value.values():
            collect_review_rows_from_json(child, rows)
    elif isinstance(value, list):
        for child in value:
            collect_review_rows_from_json(child, rows)
    return rows


def unique_rows(rows):
    seen = set()
    unique = []
    for row in rows:
        key = normalize_text(row.get("yorum", ""))[:240]
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique


# ── Ping ─────────────────────────────────────────────────────────
@app.route('/api/ping')
def ping():
    return jsonify({"status": "awake"})


# ── 1. CSV Analiz Endpoint'i ─────────────────────────────────────
@app.route('/api/analyze', methods=['POST'])
def analyze_reviews():
    try:
        data = request.get_json(silent=True) or {}
        rows = data.get('rows', [])
        comment_col = data.get('commentCol', 'yorum')

        reviews_to_process = rows[:25]

        if not client:
            return jsonify({
                "status": "success",
                "provider": "local",
                "message": "Gemini API key yok; lokal analiz kullanıldı.",
                "data": local_analyze_rows(reviews_to_process, comment_col)
            })

        yorum_metinleri = ""
        for i, r in enumerate(reviews_to_process):
            text = r.get(comment_col, '')
            yorum_metinleri += f"ID: {i} | Yorum: \"{text}\"\n"

        prompt = f"{SISTEM_TALIMATI}\n\nYorumlar:\n{yorum_metinleri}"

        response = client.models.generate_content(
            model=MODEL_ID,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.1
            )
        )

        ai_raw_text = response.text.replace("```json", "").replace("```", "").strip()
        gemini_result = json.loads(ai_raw_text)

        return jsonify({"status": "success", "provider": "gemini", "data": gemini_result})

    except Exception as e:
        import traceback
        print(f"ANALIZ HATASI: {traceback.format_exc()}")
        data = request.get_json(silent=True) or {}
        rows = data.get('rows', [])
        comment_col = data.get('commentCol', 'yorum')
        return jsonify({
            "status": "success",
            "provider": "local",
            "message": f"Gemini kullanılamadı, lokal analiz devrede: {str(e)}",
            "data": local_analyze_rows(rows[:25], comment_col)
        })


# ── 2. Google Reviews – SerpApi Endpoint'i ──────────────────────
@app.route('/api/google-reviews', methods=['POST'])
def get_google_reviews():
    try:
        data = request.get_json(silent=True) or {}
        place_name = data.get('place_name', '').strip()
        serpapi_key = data.get('serpapi_key', '').strip() or SERPAPI_API_KEY
        try:
            max_reviews = int(data.get('max_reviews', 100))
        except (TypeError, ValueError):
            max_reviews = 100
        max_reviews = max(8, min(max_reviews, 300))

        if not place_name:
            return jsonify({"status": "error", "message": "Restoran adı boş olamaz."}), 400
        if not serpapi_key:
            return jsonify({"status": "error", "message": "SerpApi key gerekli. Formdan girin veya SERPAPI_API_KEY ortam değişkenini ayarlayın."}), 400

        search_params = {
            "engine": "google_maps",
            "type": "search",
            "q": place_name,
            "api_key": serpapi_key,
            "hl": "tr",
            "gl": "tr"
        }

        search_resp = requests.get("https://serpapi.com/search", params=search_params, timeout=15)
        search_resp.raise_for_status()
        search_data = search_resp.json()

        place = pick_first_place(search_data)
        if not place:
            return jsonify({"status": "error", "message": f"'{place_name}' için Google Maps'te sonuç bulunamadı."}), 404

        place_title = place.get("title", place_name)
        place_rating = place.get("rating", None)
        place_reviews_count = place.get("reviews", place.get("reviews_count", 0))
        token_key, place_token = extract_place_token(place)

        if not place_token:
            return jsonify({"status": "error", "message": "Yer bulundu ama yorum anahtarı alınamadı."}), 404

        reviews_params = {
            "engine": "google_maps_reviews",
            "api_key": serpapi_key,
            "hl": "tr",
            "sort_by": "newestFirst"
        }
        reviews_params[token_key] = place_token

        formatted_rows = []
        reviews_data = {}
        next_page_token = None
        pages_fetched = 0
        max_pages = max(1, (max_reviews + 19) // 20 + 1)

        while len(formatted_rows) < max_reviews and pages_fetched < max_pages:
            page_params = dict(reviews_params)
            if next_page_token:
                page_params["next_page_token"] = next_page_token
                page_params["num"] = min(20, max_reviews - len(formatted_rows))

            reviews_resp = requests.get("https://serpapi.com/search", params=page_params, timeout=20)
            reviews_resp.raise_for_status()
            reviews_data = reviews_resp.json()

            raw_reviews = reviews_data.get("reviews", []) or reviews_data.get("user_reviews", [])
            before_count = len(formatted_rows)
            for rev in raw_reviews:
                row = parse_google_review(rev)
                if row:
                    formatted_rows.append(row)
                if len(formatted_rows) >= max_reviews:
                    break

            pagination = reviews_data.get("serpapi_pagination", {}) or {}
            next_page_token = pagination.get("next_page_token")
            pages_fetched += 1

            if not next_page_token or len(formatted_rows) == before_count:
                break

        if not formatted_rows:
            api_error = reviews_data.get("error") or reviews_data.get("serpapi_error")
            detail = f" SerpApi mesajı: {api_error}" if api_error else ""
            return jsonify({"status": "error", "message": f"Bu restoran için yorum bulunamadı.{detail}"}), 404

        formatted_rows = unique_rows(formatted_rows)[:max_reviews]

        return jsonify({
            "status": "success",
            "place": {"name": place_title, "rating": place_rating, "total_reviews": place_reviews_count},
            "rows": formatted_rows,
            "count": len(formatted_rows),
            "pages_fetched": pages_fetched,
            "max_requested": max_reviews
        })

    except requests.exceptions.Timeout:
        return jsonify({"status": "error", "message": "SerpApi isteği zaman aşımına uğradı."}), 504
    except requests.exceptions.RequestException as e:
        return jsonify({"status": "error", "message": f"Bağlantı hatası: {str(e)}"}), 502
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ── 3. Yemeksepeti Scraper Endpoint'i ───────────────────────────
@app.route('/api/yemeksepeti', methods=['POST'])
def get_yemeksepeti_reviews():
    try:
        data = request.get_json(silent=True) or {}
        restaurant_url = data.get('restaurant_url', '').strip()
        restaurant_name = data.get('restaurant_name', '').strip()

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "tr-TR,tr;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Referer": "https://www.yemeksepeti.com/",
        }

        if not restaurant_url and restaurant_name:
            search_url = f"https://www.yemeksepeti.com/search/{requests.utils.quote(restaurant_name)}"
            search_resp = requests.get(search_url, headers=headers, timeout=15)
            soup = BeautifulSoup(search_resp.text, 'html.parser')
            restaurant_link = soup.find('a', class_=re.compile(r'restaurant|listing', re.I))
            if not restaurant_link:
                restaurant_link = soup.find('a', attrs={'data-testid': re.compile(r'restaurant', re.I)})
            if restaurant_link and restaurant_link.get('href'):
                href = restaurant_link['href']
                restaurant_url = href if href.startswith('http') else f"https://www.yemeksepeti.com{href}"
            else:
                return jsonify({"status": "error", "message": f"'{restaurant_name}' için Yemeksepeti'nde restoran bulunamadı."}), 404

        if not restaurant_url:
            return jsonify({"status": "error", "message": "Restoran URL'si veya adı gerekli."}), 400

        base_restaurant_url = restaurant_url.rstrip('/')
        reviews_url = base_restaurant_url if re.search(r'/(comments|reviews)/?$', base_restaurant_url) else base_restaurant_url + '/reviews'
        time.sleep(1)

        candidate_urls = [reviews_url]
        for suffix in ('/reviews', '/comments', ''):
            candidate = base_restaurant_url + suffix
            if candidate not in candidate_urls:
                candidate_urls.append(candidate)

        resp = None
        blocked = False
        for candidate_url in candidate_urls:
            current = requests.get(candidate_url, headers=headers, timeout=15)
            current.encoding = 'utf-8'
            if current.status_code == 403:
                blocked = True
                continue
            if current.status_code < 400 and len(current.text or '') > 500:
                resp = current
                break

        if resp is None and blocked:
            for candidate_url in candidate_urls:
                proxy_url = "https://r.jina.ai/http://r.jina.ai/http://" + candidate_url
                current = requests.get(proxy_url, headers=headers, timeout=20)
                current.encoding = 'utf-8'
                if current.status_code < 400 and len(current.text or '') > 500:
                    resp = current
                    break

        if resp is None:
            return jsonify({"status": "error", "message": "Yemeksepeti sayfasına erişilemedi veya yorum sayfası bulunamadı."}), 502

        soup = BeautifulSoup(resp.text, 'html.parser')
        place_name_tag = soup.find('h1') or soup.find(class_=re.compile(r'restaurant.name|title', re.I))
        place_name_text = place_name_tag.get_text(strip=True) if place_name_tag else restaurant_name or "Yemeksepeti Restoranı"

        review_items = (
            soup.find_all(class_=re.compile(r'comment|review|yorum', re.I)) or
            soup.find_all(attrs={'data-testid': re.compile(r'comment|review', re.I)}) or
            soup.find_all('li', class_=re.compile(r'comment', re.I))
        )

        json_reviews = []
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                ld = json.loads(script.string or '{}')
                if isinstance(ld, dict) and 'review' in ld:
                    json_reviews = ld['review']
                    break
                if isinstance(ld, list):
                    for item in ld:
                        if isinstance(item, dict) and 'review' in item:
                            json_reviews = item['review']
                            break
            except Exception:
                continue

        formatted_rows = []
        if json_reviews:
            for rev in json_reviews:
                body = rev.get('reviewBody', '') or rev.get('description', '')
                if not body:
                    continue
                rating_val = rev.get('reviewRating', {}).get('ratingValue') if rev.get('reviewRating') else None
                formatted_rows.append({
                    "yorum": body, "puan": rating_val,
                    "tarih": rev.get('datePublished', ''), "kaynak": "Yemeksepeti",
                    "yazar": rev.get('author', {}).get('name', 'Anonim') if isinstance(rev.get('author'), dict) else str(rev.get('author', 'Anonim'))
                })
        else:
            for script in soup.find_all('script'):
                script_text = (script.string or script.get_text() or '').strip()
                if not script_text or not any(k in script_text.lower() for k in ('review', 'comment', 'yorum', 'rating')):
                    continue
                json_candidates = []
                if script_text.startswith('{') or script_text.startswith('['):
                    json_candidates.append(script_text)
                for match in re.finditer(r'(\{.*?"(?:reviewBody|comment|text|rating)".*?\})', script_text, re.S):
                    json_candidates.append(match.group(1))
                for raw_json in json_candidates[:5]:
                    try:
                        parsed = json.loads(raw_json)
                    except Exception:
                        continue
                    formatted_rows.extend(collect_review_rows_from_json(parsed))
        if not formatted_rows and review_items:
            for item in review_items[:60]:
                text_tag = (item.find(class_=re.compile(r'text|body|content|description', re.I)) or item.find('p') or item.find('span', class_=re.compile(r'comment', re.I)))
                text = text_tag.get_text(strip=True) if text_tag else item.get_text(strip=True)
                if not text or len(text) < 5:
                    continue
                rating_tag = item.find(class_=re.compile(r'rating|star|puan', re.I))
                rating = None
                if rating_tag:
                    rating_match = re.search(r'[\d.,]+', rating_tag.get_text(strip=True))
                    if rating_match:
                        rating = float(rating_match.group().replace(',', '.'))
                date_tag = item.find(class_=re.compile(r'date|time|tarih', re.I)) or item.find('time')
                formatted_rows.append({
                    "yorum": text, "puan": rating,
                    "tarih": date_tag.get_text(strip=True) if date_tag else '',
                    "kaynak": "Yemeksepeti", "yazar": "Anonim"
                })

        formatted_rows = unique_rows(formatted_rows)

        if not formatted_rows:
            return jsonify({
                "status": "error",
                "message": "Yemeksepeti yorumları çekilemedi. Restoranın /reviews URL'sini doğrudan girin; sayfa yorumları gizliyorsa Yemeksepeti bot/dinamik içerik koruması engelliyor olabilir."
            }), 422

        return jsonify({"status": "success", "place": {"name": place_name_text}, "rows": formatted_rows, "count": len(formatted_rows)})

    except requests.exceptions.Timeout:
        return jsonify({"status": "error", "message": "Yemeksepeti isteği zaman aşımına uğradı."}), 504
    except requests.exceptions.RequestException as e:
        return jsonify({"status": "error", "message": f"Bağlantı hatası: {str(e)}"}), 502
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ── 4. AI Rapor Streaming Endpoint'i ────────────────────────────
@app.route('/api/report', methods=['POST'])
def generate_report():
    try:
        data = request.get_json(silent=True) or {}
        neg_reviews = data.get('negReviews', [])
        if not neg_reviews:
            return jsonify({"status": "error", "message": "Analiz edilecek olumsuz yorum bulunamadı."}), 400

        if not client:
            def local_stream_response():
                yield f"data: {json.dumps({'text': fallback_report(neg_reviews)})}\n\n"
                yield "data: [DONE]\n\n"

            return app.response_class(
                local_stream_response(),
                mimetype='text/event-stream',
                headers={
                    'Cache-Control': 'no-cache',
                    'X-Accel-Buffering': 'no'
                }
            )

        review_text = '\n\n'.join(
            f"{i+1}. \"{r.get('text', '')}\"" for i, r in enumerate(neg_reviews[:80])
        )
        prompt = (
            "Aşağıdaki olumsuz restoran müşteri şikayetlerini analiz et ve "
            "yönetici için Türkçe, madde madde bir aksiyon planı hazırla.\n"
            "Her sorun alanını başlıkla belirt, somut ve uygulanabilir öneriler sun.\n\n"
            f"Şikayetler:\n{review_text}"
        )

        def stream_response():
            sent_any = False
            try:
                response = client.models.generate_content_stream(
                    model=MODEL_ID,
                    contents=prompt,
                    config=types.GenerateContentConfig(temperature=0.4)
                )
                for chunk in response:
                    if chunk.text:
                        sent_any = True
                        yield f"data: {json.dumps({'text': chunk.text})}\n\n"
            except Exception as stream_error:
                print(f"GEMINI STREAM HATASI: {stream_error}")
                if not sent_any:
                    yield f"data: {json.dumps({'text': fallback_report(neg_reviews)})}\n\n"
            yield "data: [DONE]\n\n"

        return app.response_class(
            stream_response(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'
            }
        )
    except Exception as e:
        import traceback
        print(f"RAPOR HATASI: {traceback.format_exc()}")
        data = request.get_json(silent=True) or {}
        neg_reviews = data.get('negReviews', [])

        def local_stream_response():
            yield f"data: {json.dumps({'text': fallback_report(neg_reviews)})}\n\n"
            yield "data: [DONE]\n\n"

        return app.response_class(
            local_stream_response(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'
            }
        )


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)), debug=False)
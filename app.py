from google import genai
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import json
import os
import mimetypes
import requests
from bs4 import BeautifulSoup
import time
import re

app = Flask(__name__)
CORS(app)

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

API_KEY = os.environ.get('GEMINI_API_KEY', '')
try:
    client = genai.Client(api_key=API_KEY) if API_KEY else None
except Exception:
    client = None
MODEL_ID = "gemini-2.0-flash-lite"

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

@app.route('/api/ping')
def ping():
    return jsonify({"status": "awake"})

@app.route('/api/analyze', methods=['POST'])
def analyze_reviews():
    if not client:
        return jsonify({"status": "error", "message": "API key tanımlı değil."}), 500
    try:
        data = request.json
        rows = data.get('rows', [])
        comment_col = data.get('commentCol', 'yorum')
        reviews_to_process = rows[:10]

        yorum_metinleri = ""
        for i, r in enumerate(reviews_to_process):
            text = r.get(comment_col, '')
            yorum_metinleri += f"ID: {i} | Yorum: \"{text}\"\n"

        prompt = f"{SISTEM_TALIMATI}\n\nYorumlar:\n{yorum_metinleri}"

        response = client.models.generate_content(
            model=MODEL_ID,
            contents=prompt,
        )
        ai_raw_text = response.text.replace("```json", "").replace("```", "").strip()
        gemini_result = json.loads(ai_raw_text)

        return jsonify({"status": "success", "data": gemini_result})

    except Exception as e:
        import traceback
        return jsonify({"status": "error", "message": str(e), "detail": traceback.format_exc()}), 500

@app.route('/api/google-reviews', methods=['POST'])
def get_google_reviews():
    try:
        data = request.json
        place_name = data.get('place_name', '').strip()
        serpapi_key = data.get('serpapi_key', '').strip()

        if not place_name:
            return jsonify({"status": "error", "message": "Restoran adı boş olamaz."}), 400
        if not serpapi_key:
            return jsonify({"status": "error", "message": "SerpApi key gerekli."}), 400

        search_resp = requests.get("https://serpapi.com/search", params={
            "engine": "google_maps", "q": place_name,
            "api_key": serpapi_key, "hl": "tr", "gl": "tr"
        }, timeout=15)
        search_resp.raise_for_status()
        local_results = search_resp.json().get("local_results", [])
        if not local_results:
            return jsonify({"status": "error", "message": f"'{place_name}' için sonuç bulunamadı."}), 404

        place = local_results[0]
        data_id = place.get("data_id", "")
        if not data_id:
            return jsonify({"status": "error", "message": "Yer bulunamadı."}), 404

        reviews_resp = requests.get("https://serpapi.com/search", params={
            "engine": "google_maps_reviews", "data_id": data_id,
            "api_key": serpapi_key, "hl": "tr", "sort_by": "newestFirst"
        }, timeout=15)
        reviews_resp.raise_for_status()
        raw_reviews = reviews_resp.json().get("reviews", [])

        formatted_rows = []
        for rev in raw_reviews:
            text = rev.get("snippet", "") or rev.get("extracted_snippet", {}).get("original", "")
            if not text:
                continue
            formatted_rows.append({
                "yorum": text, "puan": rev.get("rating", None),
                "tarih": rev.get("date", ""), "kaynak": "Google Reviews",
                "yazar": rev.get("user", {}).get("name", "Anonim")
            })

        if not formatted_rows:
            return jsonify({"status": "error", "message": "Yorum bulunamadı."}), 404

        return jsonify({
            "status": "success",
            "place": {"name": place.get("title", place_name), "rating": place.get("rating"), "total_reviews": place.get("reviews", 0)},
            "rows": formatted_rows, "count": len(formatted_rows)
        })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/yemeksepeti', methods=['POST'])
def get_yemeksepeti_reviews():
    try:
        data = request.json
        restaurant_url = data.get('restaurant_url', '').strip()
        restaurant_name = data.get('restaurant_name', '').strip()

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept-Language": "tr-TR,tr;q=0.9",
        }

        if not restaurant_url and restaurant_name:
            search_resp = requests.get(f"https://www.yemeksepeti.com/search/{requests.utils.quote(restaurant_name)}", headers=headers, timeout=15)
            soup = BeautifulSoup(search_resp.text, 'html.parser')
            link = soup.find('a', class_=re.compile(r'restaurant|listing', re.I))
            if link and link.get('href'):
                href = link['href']
                restaurant_url = href if href.startswith('http') else f"https://www.yemeksepeti.com{href}"
            else:
                return jsonify({"status": "error", "message": "Restoran bulunamadı."}), 404

        if not restaurant_url:
            return jsonify({"status": "error", "message": "URL veya ad gerekli."}), 400

        reviews_url = restaurant_url.rstrip('/') + '/comments' if '/comments' not in restaurant_url else restaurant_url
        time.sleep(1)
        resp = requests.get(reviews_url, headers=headers, timeout=15)
        resp.encoding = 'utf-8'
        if resp.status_code in [403, 404]:
            resp = requests.get(restaurant_url, headers=headers, timeout=15)
            resp.encoding = 'utf-8'

        soup = BeautifulSoup(resp.text, 'html.parser')
        place_name_tag = soup.find('h1')
        place_name_text = place_name_tag.get_text(strip=True) if place_name_tag else restaurant_name or "Yemeksepeti"

        json_reviews = []
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                ld = json.loads(script.string or '{}')
                if isinstance(ld, dict) and 'review' in ld:
                    json_reviews = ld['review']; break
            except: continue

        formatted_rows = []
        if json_reviews:
            for rev in json_reviews:
                body = rev.get('reviewBody', '')
                if not body: continue
                rating_val = rev.get('reviewRating', {}).get('ratingValue') if rev.get('reviewRating') else None
                formatted_rows.append({"yorum": body, "puan": rating_val, "tarih": rev.get('datePublished', ''), "kaynak": "Yemeksepeti", "yazar": "Anonim"})

        if not formatted_rows:
            return jsonify({"status": "error", "message": "Yorumlar çekilemedi."}), 422

        return jsonify({"status": "success", "place": {"name": place_name_text}, "rows": formatted_rows, "count": len(formatted_rows)})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)), debug=False)
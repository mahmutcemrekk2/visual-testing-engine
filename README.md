# 🧪 Visual Regression Test Engine

AI destekli görsel regresyon test motoru. Piksel farklarını analiz eder, akıllı kurallarla gerçek hataları gürültüden ayırır.

---

## 📋 Gereksinimler

- **Node.js** v18+
- **Playwright** (otomatik Chromium kurulumu)
- **AI API Key** — Gemini veya OpenAI (`.env` dosyasında)

## ⚙️ Kurulum

```bash
# Bağımlılıkları ve gerekli tarayıcı motorunu kurun
npm install
npx playwright install chromium
```

Daha sonra repodaki örnek `.env.example` dosyasını kullanarak kendi ortam ayarlarınızı (`.env`) oluşturun:

```bash
cp .env.example .env
```
Ardından, oluşturduğunuz `.env` dosyasını açıp ilgili API anahtarlarınızı (Gemini veya OpenAI) ekleyin.

---

## 🚀 Kullanım

### 1. Dashboard (UI) — Test Oluşturucu

```bash
# ⚠️ dashboard/ klasöründen çalıştırılmalı
cd dashboard && node server.js
```

Tarayıcıda aç: **http://localhost:3005**

```bash
# Durdurmak
lsof -ti:3005 | xargs kill -9

# Yeniden başlatmak
lsof -ti:3005 | xargs kill -9 && cd dashboard && node server.js
```

---

### 2. Test Koşumu (CLI)

> Tüm komutlar **proje kök dizininden** çalıştırılır.

```bash
# Tüm klasörlerdeki testleri koş
node test-run.js

# Tek senaryo koş (klasörden bağımsız, senaryo adını yaz)
node test-run.js deposit_landing
node test-run.js home_page

# Belirli klasördeki tüm testleri koş
node test-run.js --folder "Mevduat"
node test-run.js --folder "Kredi Kartı"
```

---

## 📁 Proje Yapısı

```
visual-testing-hesap/
├── config/
│   ├── Anasayfa.json       # Klasör bazlı test senaryoları
│   ├── Kredi.json
│   ├── Mevduat.json
│   └── Kredi Kartı.json
├── engine/
│   ├── screenshot-engine.js
│   └── ai-analyzer.js      # Gemini + OpenAI çift provider desteği
├── dashboard/
│   ├── server.js            # Express backend (port 3005)
│   └── public/
├── screenshots/
│   ├── Anasayfa/home_page/
│   ├── Kredi/credit_page/
│   ├── Mevduat/deposit_landing/
│   └── Kredi Kartı/card_landing/
├── .gitlab-ci.yml
└── test-run.js
```

---

## 🧠 Nasıl Çalışır?

1. **Baseline alınır** → İlk koşumda referans ekran görüntüsü kaydedilir
2. **Current çekilir** → Her testte güncel ekran görüntüsü alınır
3. **Piksel karşılaştırma** → `pixelmatch` ile farklar hesaplanır
4. **AI Analizi** → Gemini veya OpenAI, farkları kurallarla değerlendirir
5. **Sonuç** → `BUG`, `CRITICAL_ISSUE`, `ACCEPTABLE_CHANGE` veya `VISUAL_NOISE`

---

## 📝 Test Senaryosu Ekleme

1. Dashboard'u aç → **http://localhost:3005**
2. Klasör seç (veya yeni klasör oluştur)
3. Test adı, URL ve Wait Selector gir
4. **📸 Görseli Getir** → Görsel üzerinde alan işaretle
5. **💾 Senaryoyu Kaydet** → `config/<Klasör>.json` dosyasına yazar + baseline kaydedilir

### 🤖 AI Kural Kapsamı

AI **sadece çizdiğin kutunun koordinat bölgesini** değerlendirir. Tüm kartları kapsamak için:

| Yöntem | Ne zaman? |
|--------|----------|
| Tüm kartları saran tek büyük kutu çiz | Aynı tipteki birden fazla elementi kontrol etmek için |
| Her element için ayrı kutu | Farklı kurallar gerektiğinde |
| Koordinatsız metin kuralı | Genel/bütünsel kontrol için (daha az hassas) |

**Örnek:** 3 kart varsa → tek kutu ile 3'ünü de kapsayacak şekilde çiz.

---

## 🔄 Baseline Yenileme

```bash
rm screenshots/Mevduat/deposit_landing/baseline.png
node test-run.js deposit_landing
```

---

## 🚢 CI/CD — GitLab Pipeline

Kod olduğu gibi push'la, `.gitlab-ci.yml` otomatik okunur.

### GitLab'da Variable Ekleme

`Settings → CI/CD → Variables → Add variable`

**Gemini için:**

| Key | Value | Masked |
|-----|-------|--------|
| `AI_PROVIDER` | `gemini` | ❌ |
| `GEMINI_API_KEY` | `AIzaSy...` | ✅ |

**OpenAI için:**

| Key | Value | Masked |
|-----|-------|--------|
| `AI_PROVIDER` | `openai` | ❌ |
| `OPENAI_API_KEY` | `sk-...` | ✅ |

> **Not:** `.env` dosyası git'e gitmez (`.gitignore`'da). Key'ler sadece GitLab kasasında durur.

Pipeline tetiklenince:
1. `npm ci` → bağımlılıklar
2. `npx playwright install chromium` → browser
3. `node test-run.js` → headless testler (CI=true otomatik)
4. `diff.png` dosyaları 7 gün artifact olarak saklanır

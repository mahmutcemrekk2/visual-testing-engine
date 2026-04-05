const fs = require('fs');
const PNG = require('pngjs').PNG;
let pixelmatch = require('pixelmatch');
if (pixelmatch.default) pixelmatch = pixelmatch.default;
const path = require('path');
require('dotenv').config();

// --- AI Provider Factory ---
// AI_PROVIDER=gemini → Google Gemini Vision
// AI_PROVIDER=openai → OpenAI GPT-4o Vision
const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

let genAI = null;
let openaiClient = null;

if (AI_PROVIDER === 'openai') {
    const { OpenAI } = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('[AI] Provider: OpenAI GPT-4o');
} else {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'PLACEHOLDER');
    console.log('[AI] Provider: Google Gemini');
}

/**
 * Resizes (pads) a PNG to match the target dimensions.
 */
function resizeImage(png, width, height) {
    const resized = new PNG({ width, height, fill: true });
    PNG.bitblt(png, resized, 0, 0, png.width, png.height, 0, 0);
    return resized;
}

/**
 * Pure JS Nearest Neighbor Downscaling
 */
function downscaleImage(png, targetWidth) {
    if (png.width <= targetWidth) return png;
    const ratio = png.width / targetWidth;
    const targetHeight = Math.floor(png.height / ratio);
    const result = new PNG({ width: targetWidth, height: targetHeight });
    for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
            const srcX = Math.floor(x * ratio);
            const srcY = Math.floor(y * ratio);
            const srcIdx = (png.width * srcY + srcX) << 2;
            const destIdx = (targetWidth * y + x) << 2;
            result.data[destIdx]     = png.data[srcIdx];
            result.data[destIdx + 1] = png.data[srcIdx + 1];
            result.data[destIdx + 2] = png.data[srcIdx + 2];
            result.data[destIdx + 3] = png.data[srcIdx + 3];
        }
    }
    return result;
}

/**
 * Compares two screenshots and identifies visual differences.
 */
async function analyzeVisuals(baselinePath, currentPath, diffPath, pageRules = []) {
    const diffDir = path.dirname(diffPath);
    if (!fs.existsSync(diffDir)) fs.mkdirSync(diffDir, { recursive: true });

    const baselineData = fs.readFileSync(baselinePath);
    const currentData  = fs.readFileSync(currentPath);

    let baselineImg = PNG.sync.read(baselineData);
    let currentImg  = PNG.sync.read(currentData);

    const maxWidth  = Math.max(baselineImg.width, currentImg.width);
    const maxHeight = Math.max(baselineImg.height, currentImg.height);

    if (baselineImg.width !== maxWidth || baselineImg.height !== maxHeight)
        baselineImg = resizeImage(baselineImg, maxWidth, maxHeight);
    if (currentImg.width !== maxWidth || currentImg.height !== maxHeight)
        currentImg = resizeImage(currentImg, maxWidth, maxHeight);

    // AI'ın kafasını karıştıran "anti-aliasing" ve ufak render kaymalarını (font gürültüsü)
    // kendi yazdığımız basit RGB farkı yerine, pixelmatch'in gelişmiş motoruna bırakıyoruz.
    const highlightedDiff = new PNG({ width: maxWidth, height: maxHeight });
    const numDiffPixels = pixelmatch(
        baselineImg.data, currentImg.data, highlightedDiff.data,
        maxWidth, maxHeight, { 
            threshold: 0.15, // ufak tolerans artışı fontlar için
            includeAA: false, // Anti-aliasing piksel farkı sayılmaz
            alpha: 0.1, // değişmeyen yerleri %10 opaklıkta (silik) çiz, referans olsun
            aaColor: [240, 240, 240], // AA piksellerini çok açık gri yap (göze batmasın)
            diffColor: [255, 30, 30] // hata varsa kırmızı diff
        }
    );

    // --- Rule-Aware Composite Diff: [BASELINE] | [DIFF] | [CURRENT] ---
    const GAP = 4;
    const totalW = maxWidth * 3 + GAP * 2;
    const totalH = maxHeight;

    const composite = new PNG({ width: totalW, height: totalH });

    // Arka plan siyah
    for (let i = 0; i < composite.data.length; i += 4) {
        composite.data[i] = 15; composite.data[i+1] = 15;
        composite.data[i+2] = 15; composite.data[i+3] = 255;
    }

    function blitPanel(src, destX) {
        for (let y = 0; y < maxHeight; y++) {
            for (let x = 0; x < maxWidth; x++) {
                const si = (y * maxWidth + x) * 4;
                const di = (y * totalW + (destX + x)) * 4;
                composite.data[di]   = src.data[si];
                composite.data[di+1] = src.data[si+1];
                composite.data[di+2] = src.data[si+2];
                composite.data[di+3] = 255;
            }
        }
    }

    // Rule bölgelerini işle: "değişebilir" → masked, "değişmemeli" → strict
    const maskedRegions  = []; // her zaman beyaz (diff ignore)
    const strictRegions  = []; // diff varsa kırmızı
    const rectRules = (pageRules || []).filter(r => r.type === 'rect');

    for (const r of rectRules) {
        const text = (r.rule || '').toLowerCase();
        if (text.includes('değişebilir') || text.includes('degisebilir')) {
            maskedRegions.push(r);
        } else if (text.includes('değişmemeli') || text.includes('degismemeli') || text.includes('aynı kalmalı')) {
            strictRegions.push(r);
        }
    }

    // Masked (değişebilir) bölgeleri highlightedDiff üzerinde bembeyaz yap (diff çıksa bile gizle)
    for (let y = 0; y < maxHeight; y++) {
        for (let x = 0; x < maxWidth; x++) {
            const isMasked = maskedRegions.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
            if (isMasked) {
                const i = (y * maxWidth + x) * 4;
                highlightedDiff.data[i]   = 255;
                highlightedDiff.data[i+1] = 255;
                highlightedDiff.data[i+2] = 255;
                highlightedDiff.data[i+3] = 255;
            }
        }
    }

    // UYGULAMA TALEBİ / CHUNK TOLERANCE MANTIĞI:
    // Sayfayı dikeyde 10 dilime bölüyoruz. Eğer bir dilim içindeki değişim %2.0'nin altındaysa
    // o dilimdeki değişiklikler muhtemelen dağınık bir UI/Text kaymasıdır (Turuncu).
    // Eğer bir dilimdeki değişim %2.0'yi aşıyorsa o dilimde yoğun bir dizayn hatası vardır (Kırmızı kalır).
    const CHUNKS = 10;
    const chunkHeight = Math.ceil(maxHeight / CHUNKS);
    const chunkPixels = maxWidth * chunkHeight;
    const chunkDiffs = new Array(CHUNKS).fill(0);

    // 1. Aşama: Her dilimdeki toplam fark pikselini say
    for (let y = 0; y < maxHeight; y++) {
        const chunkIdx = Math.floor(y / chunkHeight);
        for (let x = 0; x < maxWidth; x++) {
            const i = (y * maxWidth + x) * 4;
            // Eğer pixelmatch kırmızısıysa
            if (highlightedDiff.data[i] === 255 && highlightedDiff.data[i+1] === 30 && highlightedDiff.data[i+2] === 30) {
                chunkDiffs[chunkIdx]++;
            }
        }
    }

    // 2. Aşama: Kritik eşiği aşmayan dilimleri Turuncuya boya
    const TOLERANCE_PERCENT = 2.0; // %2.0
    for (let c = 0; c < CHUNKS; c++) {
        const chunkPerc = (chunkDiffs[c] / chunkPixels) * 100;
        if (chunkPerc > 0) {
            const status = chunkPerc <= TOLERANCE_PERCENT ? "🟠 ORANGE (Noise)" : "🔴 RED (Dense Bug)";
            console.log(`[Diff Engine] Dilim ${c+1}/${CHUNKS} -> Fark: %${chunkPerc.toFixed(2)} -> ${status}`);
        }
    }

    for (let y = 0; y < maxHeight; y++) {
        const chunkIdx = Math.floor(y / chunkHeight);
        const chunkPerc = (chunkDiffs[chunkIdx] / chunkPixels) * 100;

        if (chunkPerc > 0 && chunkPerc <= TOLERANCE_PERCENT) {
            for (let x = 0; x < maxWidth; x++) {
                const i = (y * maxWidth + x) * 4;
                // Kırmızıyı -> Turuncuya çevir
                if (highlightedDiff.data[i] === 255 && highlightedDiff.data[i+1] === 30 && highlightedDiff.data[i+2] === 30) {
                    highlightedDiff.data[i+1] = 165; // Green = 165 (Orange)
                    highlightedDiff.data[i+2] = 0;   // Blue = 0
                }
            }
        }
    }

    // Rule kutularını diff paneline çiz (sadece kenar çizgisi)
    function drawBorder(img, rx, ry, rw, rh, R, G, B) {
        const clamp = (v, max) => Math.min(Math.max(v, 0), max - 1);
        for (let dx = 0; dx <= rw; dx++) {
            for (const dy of [0, rh]) {
                const px = clamp(rx + dx, maxWidth);
                const py = clamp(ry + dy, maxHeight);
                const pi = (py * maxWidth + px) * 4;
                img.data[pi] = R; img.data[pi+1] = G; img.data[pi+2] = B; img.data[pi+3] = 255;
            }
        }
        for (let dy = 0; dy <= rh; dy++) {
            for (const dx of [0, rw]) {
                const px = clamp(rx + dx, maxWidth);
                const py = clamp(ry + dy, maxHeight);
                const pi = (py * maxWidth + px) * 4;
                img.data[pi] = R; img.data[pi+1] = G; img.data[pi+2] = B; img.data[pi+3] = 255;
            }
        }
    }
    // Mavi çerçeve = masked (değişebilir), turuncu çerçeve = strict (değişmemeli)
    for (const r of maskedRegions)  drawBorder(highlightedDiff, r.x, r.y, r.w, r.h, 100, 160, 255);
    for (const r of strictRegions)  drawBorder(highlightedDiff, r.x, r.y, r.w, r.h, 255, 140, 0);

    blitPanel(baselineImg,     0);
    blitPanel(highlightedDiff, maxWidth + GAP);
    blitPanel(currentImg,      maxWidth * 2 + GAP * 2);

    fs.writeFileSync(diffPath, PNG.sync.write(composite));

    // Sharp ile rule yazılarını imaja çiz
    try {
        const sharp = require('sharp');
        // SVG mask overlay (metinler için)
        // Diff paneli X başlangıcı: maxWidth + GAP
        let svgOverlay = `<svg width="${totalW}" height="${totalH}">
            <style>
                .mask-text { fill: rgba(100, 160, 255, 0.9); font-size: 16px; font-weight: bold; font-family: sans-serif; }
                .strict-text { fill: rgba(255, 140, 0, 0.9); font-size: 16px; font-weight: bold; font-family: sans-serif; }
            </style>`;
        
        for (const r of maskedRegions) {
            const rx = maxWidth + GAP + Math.max(0, r.x) + 5;
            const ry = Math.max(0, r.y) + 20;
            // Kural metnindeki XML/SVG bozacak karakterleri temizle
            const safeText = (r.rule || 'Masked Area').replace(/[<>&]/g, '');
            svgOverlay += `<text x="${rx}" y="${ry}" class="mask-text">${safeText}</text>`;
        }
        for (const r of strictRegions) {
            const rx = maxWidth + GAP + Math.max(0, r.x) + 5;
            const ry = Math.max(0, r.y) + 20;
            const safeText = (r.rule || 'Strict Area').replace(/[<>&]/g, '');
            svgOverlay += `<text x="${rx}" y="${ry}" class="strict-text">${safeText}</text>`;
        }
        svgOverlay += `</svg>`;

        const pngBuffer = PNG.sync.write(composite);
        const buffer = await sharp(pngBuffer)
            .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
            .png()
            .toBuffer();
        
        fs.writeFileSync(diffPath, buffer);
    } catch (err) {
        console.log("Not: Sharp ile texte yazma başarısız oldu, sade maske kaydedildi.", err.message);
    }

    const result = {
        totalPixels: maxWidth * maxHeight,
        diffPixels: numDiffPixels,
        diffPercentage: ((numDiffPixels / (maxWidth * maxHeight)) * 100).toFixed(2),
        isMatch: numDiffPixels === 0
    };

    console.log(`Analysis complete: ${numDiffPixels} pixels differ (${result.diffPercentage}%).`);

    if (process.env.SKIP_AI === 'true') {
        console.log('Skipping AI analysis as SKIP_AI=true is set.');
        result.aiLabel = 'SKIPPED_BY_USER_REQUEST';
        return result;
    }

    result.aiLabel = await classifyDifference(baselinePath, currentPath, diffPath, result, pageRules);
    return result;
}

/**
 * Builds the shared QA prompt text.
 */
function buildPrompt(pageRules) {
    const rulesText = pageRules.map(r => {
        if (typeof r === 'string') return `- ${r}`;
        if (r.type === 'rect')   return `- BÖLGE (X:${Math.round(r.x)}, Y:${Math.round(r.y)}, G:${Math.round(r.w)}, Y:${Math.round(r.h)}): ${r.rule}`;
        if (r.type === 'circle') return `- DAİRESEL BÖLGE (Merkez X:${Math.round(r.x)}, Merkez Y:${Math.round(r.y)}): ${r.rule}`;
        if (r.type === 'arrow')  return `- İŞARETLİ BÖLGE: ${r.rule}`;
        return `- ${r.rule || JSON.stringify(r)}`;
    }).join('\n');

    return `Sen profesyonel bir Kıdemli QA (Kalite Güvence) Mühendisisin.
Sana bir web sitesinin REFERANS (baseline) ve GÜNCEL (current) hallerini gönderiyorum.
Resimler hız için ölçeklenmiştir ama detaylar korunmuştur.

BU SAYFAYA ÖZEL TEST KURALLARI:
${rulesText}

GENEL QA KURALLARI:
1. REKLAM/BANNER: Eğer fark sadece değişen bir reklam görselinden kaynaklıysa 'ACCEPTABLE_CHANGE' de.
2. LAYOUT: Eğer butonlar, formlar veya metinler üst üste binmişse veya sayfa yapısı bozulmuşsa 'BUG' de.
3. ANIMASYON: Hareketli arka plan efektlerinden kaynaklı milimetrik kaymaları 'VISUAL_NOISE' kabul et.
4. KRITIK: Logo, ana menü veya fiyat bilgisi değişmişse 'CRITICAL_ISSUE' de.

Sadece şu etiketlerden birini döndür: [BUG, CRITICAL_ISSUE, ACCEPTABLE_CHANGE, VISUAL_NOISE]
Yanına çok kısa bir neden ekle (Örn: BUG - Buton kaymış).`;
}

/**
 * Classify using Gemini Vision API.
 */
async function classifyWithGemini(tempBaseline, tempCurrent, prompt) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

    const imageParts = [
        { inlineData: { data: Buffer.from(fs.readFileSync(tempBaseline)).toString('base64'), mimeType: 'image/png' } },
        { inlineData: { data: Buffer.from(fs.readFileSync(tempCurrent)).toString('base64'),  mimeType: 'image/png' } },
    ];

    const aiResult = model.generateContent([prompt, ...imageParts]);
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('AI Timeout (120s)')), 120000));
    const resultWrapper = await Promise.race([aiResult, timeoutPromise]);
    const response = await resultWrapper.response;
    return response.text().trim();
}

/**
 * Classify using OpenAI Vision API (GPT-4o).
 */
async function classifyWithOpenAI(tempBaseline, tempCurrent, prompt) {
    const baselineB64 = Buffer.from(fs.readFileSync(tempBaseline)).toString('base64');
    const currentB64  = Buffer.from(fs.readFileSync(tempCurrent)).toString('base64');

    const response = await openaiClient.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 100,
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${baselineB64}`, detail: 'low' } },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${currentB64}`,  detail: 'low' } },
            ]
        }],
    });
    return response.choices[0].message.content.trim();
}

/**
 * Main classifier — routes to the correct provider.
 */
async function classifyDifference(baselinePath, currentPath, diffPath, result, pageRules = []) {
    if (result.isMatch) return 'MATCH';

    const hasKey = AI_PROVIDER === 'openai'
        ? !!process.env.OPENAI_API_KEY
        : (!!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_api_key_here');

    if (!hasKey) {
        console.log('AI API Key not found. Using rule-based fallback...');
        return parseFloat(result.diffPercentage) > 5 ? 'MAJOR_ISSUE (Rule-based)' : 'LAYOUT_SHIFT (Rule-based)';
    }

    const tempBaseline = path.join('/tmp', `baseline_${Date.now()}.png`);
    const tempCurrent  = path.join('/tmp', `current_${Date.now()}.png`);

    try {
        console.log(`Optimizing images for AI analysis (${AI_PROVIDER})...`);
        const baselineImg = PNG.sync.read(fs.readFileSync(baselinePath));
        const currentImg  = PNG.sync.read(fs.readFileSync(currentPath));

        fs.writeFileSync(tempBaseline, PNG.sync.write(downscaleImage(baselineImg, 1024)));
        fs.writeFileSync(tempCurrent,  PNG.sync.write(downscaleImage(currentImg, 1024)));

        const prompt = buildPrompt(pageRules);
        const MAX_RETRIES = 3;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const label = AI_PROVIDER === 'openai'
                    ? await classifyWithOpenAI(tempBaseline, tempCurrent, prompt)
                    : await classifyWithGemini(tempBaseline, tempCurrent, prompt);

                if (fs.existsSync(tempBaseline)) fs.unlinkSync(tempBaseline);
                if (fs.existsSync(tempCurrent))  fs.unlinkSync(tempCurrent);
                return label;

            } catch (error) {
                console.log(`\n⚠️ AI Hatası (Deneme ${attempt}/${MAX_RETRIES}): ${error.message}`);
                if (attempt === MAX_RETRIES) {
                    if (fs.existsSync(tempBaseline)) fs.unlinkSync(tempBaseline);
                    if (fs.existsSync(tempCurrent))  fs.unlinkSync(tempCurrent);
                    return 'AI_ERROR (Check logs)';
                }
                console.log('⏳ 5 saniye beklenip tekrar deneniyor...');
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    } catch (globalError) {
        console.error('Kritik Hata:', globalError);
        return 'AI_ERROR (Check logs)';
    }
}

module.exports = { analyzeVisuals };

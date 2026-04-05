const { captureScreenshot } = require('./engine/screenshot-engine');
const { analyzeVisuals } = require('./engine/ai-analyzer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const CONFIG_DIR = path.join(__dirname, 'config');
const RESULTS_DIR = path.join(__dirname, 'allure-results');

// config/ dizinindeki tüm .json dosyalarını oku
function getAllPages() {
    const allPages = [];
    const files = fs.readdirSync(CONFIG_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
        const folderName = path.basename(file, '.json');
        const scenarios = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, file)));
        for (const page of scenarios) {
            allPages.push({ ...page, folder: folderName });
        }
    }
    return allPages;
}

// Allure native JSON result yaz (attachment, status, label tam destekli)
function writeAllureResult(pageConfig, result, durationMs, diffPath) {
    if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

    const testId  = uuidv4();
    const aiLabel = (result.aiLabel || 'N/A').replace(/\*\*/g, '').replace(/\n/g, ' ').trim();

    // Status belirleme
    let status;
    if (aiLabel.includes('AI_ERROR')) {
        status = 'broken';       // Gemini/OpenAI API sorunu — gerçek bir test sonucu değil
    } else if (result.isMatch || aiLabel.includes('MATCH') || aiLabel.includes('ACCEPTABLE_CHANGE') || aiLabel.includes('VISUAL_NOISE')) {
        status = 'passed';
    } else {
        status = 'failed';       // BUG veya CRITICAL_ISSUE
    }

    const attachments = [];
    if (fs.existsSync(diffPath)) {
        const attachSource = `${testId}-diff-attachment.png`;
        fs.copyFileSync(diffPath, path.join(RESULTS_DIR, attachSource));
        attachments.push({
            name: 'Diff: Baseline | Highlighted | Current',
            source: attachSource,
            type: 'image/png'
        });
    }

    const allureResult = {
        uuid: testId,
        name: `[${pageConfig.folder}] ${pageConfig.name}`,
        status,
        statusDetails: {
            message: aiLabel,
            trace: `URL: ${pageConfig.url}\nDiff: %${result.diffPercentage} (${result.diffPixels} piksel)\nAI Kararı: ${aiLabel}`
        },
        start: Date.now() - durationMs,
        stop: Date.now(),
        labels: [
            { name: 'suite',    value: pageConfig.folder },
            { name: 'feature',  value: pageConfig.folder },
            { name: 'story',    value: pageConfig.name },
            { name: 'severity', value: aiLabel.includes('CRITICAL') ? 'critical' : aiLabel.includes('BUG') ? 'normal' : 'minor' },
            { name: 'tag',      value: 'visual-regression' }
        ],
        parameters: [
            { name: 'URL',           value: pageConfig.url },
            { name: 'Diff %',        value: `%${result.diffPercentage}` },
            { name: 'Diff Piksel',   value: String(result.diffPixels) },
            { name: 'AI Provider',   value: (process.env.AI_PROVIDER || 'gemini').toUpperCase() }
        ],
        attachments
    };

    fs.writeFileSync(
        path.join(RESULTS_DIR, `${testId}-result.json`),
        JSON.stringify(allureResult, null, 2),
        'utf8'
    );
}

async function runTests() {
    console.log('--- Starting Visual Regression Test ---');
    const totalStartTime = Date.now();

    // Önceki sonuçları temizle
    if (fs.existsSync(RESULTS_DIR)) fs.rmSync(RESULTS_DIR, { recursive: true });
    fs.mkdirSync(RESULTS_DIR, { recursive: true });

    const allPages = getAllPages();
    let pagesToTest = allPages;

    const args = process.argv.slice(2);
    const folderFlagIndex = args.indexOf('--folder');

    if (folderFlagIndex > -1 && args[folderFlagIndex + 1]) {
        const targetFolder = args[folderFlagIndex + 1];
        pagesToTest = allPages.filter(p => p.folder === targetFolder);
        if (pagesToTest.length === 0) {
            const available = [...new Set(allPages.map(p => p.folder))].join(', ');
            console.error(`❌ Hata: '${targetFolder}' klasörü bulunamadı!`);
            console.log(`📂 Mevcut klasörler: ${available}`);
            return;
        }
        console.log(`📂 Klasör filtresi: "${targetFolder}" (${pagesToTest.length} senaryo)`);
    } else if (args.length > 0 && args[0] !== '--folder') {
        const targetPageName = args[0];
        pagesToTest = allPages.filter(p => p.name === targetPageName);
        if (pagesToTest.length === 0) {
            console.error(`❌ Hata: '${targetPageName}' senaryosu bulunamadı!`);
            return;
        }
        console.log(`📌 Filtre: Sadece "${targetPageName}" senaryosu koşturulacak...`);
    } else {
        console.log(`🚀 Tüm klasörler koşturulacak (${pagesToTest.length} senaryo)`);
    }

    const summary = [];

    for (const pageConfig of pagesToTest) {
        console.log(`\n[${pageConfig.folder}] Testing: ${pageConfig.name} (${pageConfig.url})`);

        const url          = pageConfig.url;
        const scenarioName = pageConfig.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const baseline = path.join(__dirname, 'screenshots', pageConfig.folder, scenarioName, 'baseline.png');
        const current  = path.join(__dirname, 'screenshots', pageConfig.folder, scenarioName, 'current.png');
        const diff     = path.join(__dirname, 'screenshots', pageConfig.folder, scenarioName, 'diff.png');

        const startTime = Date.now();
        const t = () => `[${((Date.now() - startTime) / 1000).toFixed(1)}s]`;

        if (!fs.existsSync(baseline)) {
            console.log(`  📸 Baseline yok, alınıyor...`);
            const baselineDir = path.dirname(baseline);
            if (!fs.existsSync(baselineDir)) fs.mkdirSync(baselineDir, { recursive: true });
            await captureScreenshot(url, baseline, { waitSelector: pageConfig.waitSelector });
            console.log(`  ✅ Baseline kaydedildi ${t()}`);
        }

        console.log(`  📷 Current screenshot alınıyor...`);
        const isCI = !!process.env.CI;
        const screenshotStart = Date.now();
        await captureScreenshot(url, current, {
            headless: isCI, slowMo: isCI ? 0 : 200,
            waitSelector: pageConfig.waitSelector
        });
        console.log(`  ✅ Screenshot tamamlandı [${((Date.now() - screenshotStart) / 1000).toFixed(1)}s]`);

        console.log(`  🔍 Piksel karşılaştırması yapılıyor... ${t()}`);
        const diffStart = Date.now();
        const results = await analyzeVisuals(baseline, current, diff, pageConfig.rules);
        const diffDone = ((Date.now() - diffStart) / 1000).toFixed(1);
        console.log(`  🤖 AI analizi tamamlandı [${diffDone}s] → Toplam: ${t()}`);

        const durationMs = Date.now() - startTime;
        const duration   = (durationMs / 1000).toFixed(2);

        // Allure XML yaz
        writeAllureResult(pageConfig, results, durationMs, diff);

        const icon = results.isMatch ? '✅' : results.aiLabel?.includes('BUG') || results.aiLabel?.includes('CRITICAL') ? '❌' : '🟡';
        console.log(`${icon} ${pageConfig.name}: ${results.aiLabel} | %${results.diffPercentage} | ${duration}s`);
        summary.push({ name: pageConfig.name, folder: pageConfig.folder, label: results.aiLabel, diff: results.diffPercentage, duration });
    }

    // Özet tablo
    console.log('\n══════════════════════════════════════════════════════');
    console.log('  SENARYO                KLASÖR         SONUÇ            SÜRE');
    console.log('══════════════════════════════════════════════════════');
    for (const r of summary) {
        const icon  = r.label?.includes('BUG') || r.label?.includes('CRITICAL') ? '❌' : r.label === 'MATCH' ? '✅' : '🟡';
        const name  = r.name.padEnd(22);
        const folder = r.folder.padEnd(14);
        const label = (r.label || 'N/A').padEnd(16);
        console.log(`  ${icon} ${name} ${folder} ${label} ${r.duration}s`);
    }
    console.log('══════════════════════════════════════════════════════');
    console.log(`\n📊 Allure sonuçları: allure-results/`);
    console.log(`   Raporu görüntülemek için: npx allure serve allure-results`);
    console.log(`\n--- ALL TESTS COMPLETED in ${((Date.now() - totalStartTime) / 1000).toFixed(2)} seconds ---`);
}

runTests().catch(err => console.error('Tests Failed:', err));

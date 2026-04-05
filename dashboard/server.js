const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { captureScreenshot } = require('../engine/screenshot-engine');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/screenshots', express.static(path.join(__dirname, '../screenshots')));

const CONFIG_DIR = path.join(__dirname, '../config');
const SCREENSHOTS_DIR = path.join(__dirname, '../screenshots');

// config/ dizinini tara: dosya adı = klasör adı
function getFolderNames() {
    return fs.readdirSync(CONFIG_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => path.basename(f, '.json'));
}

// Klasörün JSON dosyasını oku
function readFolder(folderName) {
    const filePath = path.join(CONFIG_DIR, `${folderName}.json`);
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath));
}

// Klasörün JSON dosyasına yaz
function writeFolder(folderName, scenarios) {
    const filePath = path.join(CONFIG_DIR, `${folderName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(scenarios, null, 2));
}

// Klasör listesini döndür
app.get('/api/folders', (req, res) => {
    res.json({ folders: getFolderNames() });
});

// Ekran görüntüsü al (bellekte, diske yazmaz)
app.post('/api/capture', async (req, res) => {
    try {
        const { name, url, waitSelector } = req.body;
        if (!name || !url) return res.status(400).json({ error: 'Name and URL are required' });

        const tmpPath = path.join(require('os').tmpdir(), `vt_preview_${Date.now()}.png`);
        
        console.log(`[Dashboard] Capturing preview for ${name}...`);
        await captureScreenshot(url, tmpPath, { waitSelector, headless: false });
        
        const base64Image = fs.readFileSync(tmpPath).toString('base64');
        fs.unlinkSync(tmpPath);
        
        console.log(`[Dashboard] Preview ready (in-memory, no file saved).`);
        res.json({ success: true, imageData: `data:image/png;base64,${base64Image}` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// Senaryoyu klasördeki JSON dosyasına kaydet
app.post('/api/save-test', (req, res) => {
    try {
        const { name, url, waitSelector, rules, imageData, folder } = req.body;
        const targetFolder = folder || 'Genel';

        // Klasörün mevcut senaryolarını oku
        const scenarios = readFolder(targetFolder);
        const newPage = { name, url, waitSelector: waitSelector || "", rules: rules || [] };

        const existingIndex = scenarios.findIndex(p => p.name === name);
        if (existingIndex > -1) {
            scenarios[existingIndex] = newPage;
        } else {
            scenarios.push(newPage);
        }

        writeFolder(targetFolder, scenarios);
        console.log(`[Dashboard] Saved "${name}" → config/${targetFolder}.json`);

        // Base64 → baseline.png (screenshots/<Klasör>/<senaryo>/baseline.png)
        if (imageData) {
            const scenarioName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const folderPath = path.join(SCREENSHOTS_DIR, targetFolder, scenarioName);
            if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
            
            const base64Data = imageData.replace(/^data:image\/png;base64,/, '');
            fs.writeFileSync(path.join(folderPath, 'baseline.png'), Buffer.from(base64Data, 'base64'));
            console.log(`[Dashboard] Baseline saved: ${targetFolder}/${scenarioName}/baseline.png`);
        }

        res.json({ success: true, message: `"${name}" → "${targetFolder}.json" dosyasına kaydedildi!` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3005;
app.listen(PORT, () => {
    console.log(`Dashboard Server running on http://localhost:${PORT}`);
});

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

/**
 * Captures a screenshot of a given URL.
 * @param {string} url - The URL to capture.
 * @param {string} fileName - The name of the output file.
 * @param {object} options - Optional parameters like viewport size.
 */
async function captureScreenshot(url, fileName, options = {}) {
    const browser = await chromium.launch({
        headless: options.headless !== undefined ? options.headless : true,
        slowMo: options.slowMo || 0
    });
    const context = await browser.newContext({
        viewport: options.viewport || { width: 1280, height: 720 }
    });
    const page = await context.newPage();

    console.log(`Navigating to ${url}...`);
    try {
        // Hızlı bir yükleme denemesi
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        // --- AUTO POPUP HANDLERS: Ne zaman çıkarsa otomatik kapat ---
        // Dengage push bildirimi
        const dengagePushPopup = page.locator('#dengage-push-prompt-container');
        await page.addLocatorHandler(dengagePushPopup, async () => {
            const denyBtn = page.locator('#dengage_push-refuse-button');
            await denyBtn.click({ force: true });
            console.log('[AUTO] Dengage push notification dismissed.');
        });

        // Dengage promotion modal (iframe içinde)
        const dengagePromoClose = page.frameLocator('iframe[id^="_dn_onsite_popup"]').locator('.closeBtn');
        await page.addLocatorHandler(dengagePromoClose, async () => {
            await dengagePromoClose.click({ force: true });
            console.log('[AUTO] Dengage promotion modal dismissed.');
        });

        // Cookie banner
        const cookieBtn = page.locator('button.cc-nb-okagree');
        await page.addLocatorHandler(cookieBtn, async () => {
            await cookieBtn.click({ force: true });
            console.log('[AUTO] Cookie banner dismissed.');
        });

        // Genel "Hayır" butonlu popuplar 
        const hayirBtn = page.locator('#dengage-push-prompt-container button:has-text("Hayır")');
        await page.addLocatorHandler(hayirBtn, async () => {
            await hayirBtn.click({ force: true });
            console.log('[AUTO] Generic "Hayır" popup dismissed.');
        });
        
        // Lazy-load edilen (aşağıda kaldığı için yüklenmeyen) görselleri tetiklemek için sayfayı yavaşça aşağı kaydır
        console.log('Scrolling down to trigger lazy loading...');
        await page.evaluate(async () => {
            const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
            const scrollHeight = document.body.scrollHeight;
            // Yavaş yavaş aşağı in
            for (let i = 0; i < scrollHeight; i += 400) {
                window.scrollTo(0, i);
                await delay(300);
            }
            // En aşağıda 2 saniye bekle (ağdan inen resimlerin bitmesi için) 
            window.scrollTo(0, scrollHeight);
            await delay(2000);
            
            // Tüm resimlerin yüklenmesini bekle
            const images = document.querySelectorAll('img');
            await Promise.all(
                Array.from(images)
                    .filter(img => !img.complete)
                    .map(img => new Promise(resolve => {
                        img.addEventListener('load', resolve);
                        img.addEventListener('error', resolve);
                        setTimeout(resolve, 5000); // Her resim için max 5 saniye
                    }))
            );
            
            window.scrollTo(0, 0); // En tepeye geri dön
        });
        console.log('Scroll complete. All images loaded.');
        // Scroll sonrası ek stabilizasyon
        await page.waitForTimeout(500);
        
        // Eğer özel bir element veya süre bekleniyorsa
        if (options.waitSelector) {
            if (!isNaN(options.waitSelector)) {
                const waitTime = parseInt(options.waitSelector, 10);
                console.log(`Waiting for fixed timeout: ${waitTime}ms...`);
                await page.waitForTimeout(waitTime);
            } else {
                console.log(`Waiting for selector: ${options.waitSelector}...`);
                await page.waitForSelector(options.waitSelector, { state: 'visible', timeout: 20000 });
                // Buton gelse bile sayfanın "oturması" için 2 saniye daha bekle
                console.log('Selector found. Stabilizing layout...');
                await page.waitForTimeout(2000);
            }
        } else {
            // Yoksa 2 saniye ek bir bekleme yap (render için)
            await page.waitForTimeout(2000);
        }
    } catch (e) {
        console.log(`Wait condition failed or timed out: ${e.message}`);
    }

    // Ensure the baseline/current directories exist
    const dir = path.dirname(fileName);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    await page.screenshot({ 
        path: fileName, 
        fullPage: true,
        animations: 'disabled',
        caret: 'hide'
    });
    console.log(`Screenshot saved to ${fileName}`);

    await browser.close();
    return fileName;
}

module.exports = { captureScreenshot };

const fs = require('fs');
const PNG = require('pngjs').PNG;
const sharp = require('sharp');
let pixelmatch = require('pixelmatch');
if (pixelmatch.default) pixelmatch = pixelmatch.default;

const baselinePath = './screenshots/Mevduat/deposit_landing/baseline.png';
const currentPath = './screenshots/Mevduat/deposit_landing/current.png';

async function run() {
    let baselineMeta = await sharp(baselinePath).metadata();
    let currentMeta = await sharp(currentPath).metadata();
    
    const maxWidth = Math.max(baselineMeta.width, currentMeta.width);
    const maxHeight = Math.max(baselineMeta.height, currentMeta.height);

    const baseRaw = await sharp(baselinePath)
        .resize({ width: maxWidth, height: maxHeight, fit: 'contain', background: {r:255,g:255,b:255,alpha:1} })
        .ensureAlpha()
        .raw().toBuffer();

    const currRaw = await sharp(currentPath)
        .resize({ width: maxWidth, height: maxHeight, fit: 'contain', background: {r:255,g:255,b:255,alpha:1} })
        .ensureAlpha()
        .raw().toBuffer();

    const diffImg = new PNG({ width: maxWidth, height: maxHeight });
    
    const numDiffPixels = pixelmatch(
        baseRaw, currRaw, diffImg.data,
        maxWidth, maxHeight, {
            threshold: 0.15,
            includeAA: false,
            alpha: 0.1,
            aaColor: [240, 240, 240],
            diffColor: [255, 30, 30] // Default Red
        }
    );

    const CHUNKS = 10;
    const chunkHeight = Math.ceil(maxHeight / CHUNKS);
    const chunkDiffs = new Array(CHUNKS).fill(0);
    const chunkPixels = maxWidth * chunkHeight;

    // First Loop: Count diffs per chunk
    for (let y = 0; y < maxHeight; y++) {
        for (let x = 0; x < maxWidth; x++) {
            const i = (y * maxWidth + x) * 4;
            if (diffImg.data[i] === 255 && diffImg.data[i+1] === 30 && diffImg.data[i+2] === 30) {
                const chunkIdx = Math.floor(y / chunkHeight);
                chunkDiffs[chunkIdx]++;
            }
        }
    }

    console.log(`--- CHUNK ANALYSIS (${CHUNKS} slices) ---`);
    for (let c = 0; c < CHUNKS; c++) {
        const perc = (chunkDiffs[c] / chunkPixels) * 100;
        console.log(`Chunk ${c+1}: ${chunkDiffs[c]} diff px (${perc.toFixed(2)}%)`);
    }

    const TOLERANCE_PERCENT = 1.0; // Let's test 1.0%

    // Second Loop: Paint chunks based on their density
    for (let y = 0; y < maxHeight; y++) {
        const chunkIdx = Math.floor(y / chunkHeight);
        const chunkPerc = (chunkDiffs[chunkIdx] / chunkPixels) * 100;

        for (let x = 0; x < maxWidth; x++) {
            const i = (y * maxWidth + x) * 4;
            // Draw horizontal lines to show chunks
            if (y % chunkHeight === 0) {
                 diffImg.data[i] = 0; diffImg.data[i+1] = 0; diffImg.data[i+2] = 255; diffImg.data[i+3]=255;
            }

            if (diffImg.data[i] === 255 && diffImg.data[i+1] === 30 && diffImg.data[i+2] === 30) {
                // If the chunk diff is under tolerance, paint it ORANGE (Minor Shift)
                if (chunkPerc <= TOLERANCE_PERCENT) {
                    diffImg.data[i+1] = 165; // Orange
                    diffImg.data[i+2] = 0;
                }
            }
        }
    }

    fs.writeFileSync('./debug_diff_chunked.png', PNG.sync.write(diffImg));
    console.log('Saved to debug_diff_chunked.png');
}

run().catch(console.error);

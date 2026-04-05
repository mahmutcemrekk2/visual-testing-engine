let rules = [];
let boxes = [];
let capturedImageData = null; // Base64 resim verisi bellekte tutulur
let currentBox = null;

const img = document.getElementById('screenshotImg');
const canvas = document.getElementById('annotationCanvas');
const ctx = canvas.getContext('2d');
let drawing = false;
let startX, startY;

const popup = document.getElementById('rulePopup');
const popupInput = document.getElementById('popupRuleInput');
const popupSave = document.getElementById('popupSaveBtn');

// --- Klasörleri API'dan yükle ---
async function loadFolders() {
    try {
        const res = await fetch('/api/folders');
        const data = await res.json();
        const select = document.getElementById('folderSelect');
        data.folders.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = `📂 ${f}`;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error('Klasörler yüklenemedi:', e);
    }
}
loadFolders();

// --- Yeni Klasör Toggle ---
const newFolderToggle = document.getElementById('newFolderToggle');
const newFolderInput = document.getElementById('newFolderInput');
const folderSelect = document.getElementById('folderSelect');

newFolderToggle.addEventListener('click', () => {
    const isVisible = newFolderInput.style.display !== 'none';
    if (isVisible) {
        const val = newFolderInput.value.trim();
        if (val) {
            // Yoksa seçenekler arasına ekle ve seç
            if (![...folderSelect.options].some(o => o.value === val)) {
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = `📂 ${val}`;
                folderSelect.appendChild(opt);
            }
            folderSelect.value = val;
        }
        newFolderInput.style.display = 'none';
        newFolderToggle.textContent = '📁 +';
    } else {
        newFolderInput.style.display = 'block';
        newFolderInput.focus();
        newFolderToggle.textContent = '✓';
    }
});


document.getElementById('captureBtn').addEventListener('click', async () => {
    const name = document.getElementById('testName').value;
    const url = document.getElementById('testUrl').value;
    const waitSelector = document.getElementById('waitSelector').value;

    if (!name || !url) return alert('Name and URL are required!');

    document.getElementById('loading').style.display = 'block';
    document.getElementById('workspaceArea').style.display = 'none';

    try {
        const res = await fetch('/api/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, url, waitSelector })
        });
        const data = await res.json();
        
        if (data.success) {
            capturedImageData = data.imageData;
            img.src = data.imageData;
            img.onload = () => {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('workspaceArea').style.display = 'flex';
                
                // Div görünür olduktan sonra boyutları alabilmek için micro-task bekliyoruz
                setTimeout(() => {
                    canvas.width = img.clientWidth;
                    canvas.height = img.clientHeight;
                    rules = [];
                    boxes = [];
                    renderRules();
                    redrawCanvas();
                }, 50);
            };
        } else {
            alert(data.error);
            document.getElementById('loading').style.display = 'none';
        }
    } catch (e) {
        alert("Error capturing: " + e.message);
        document.getElementById('loading').style.display = 'none';
    }
});

function renderRules() {
    const list = document.getElementById('rulesList');
    list.innerHTML = '';
    rules.forEach((r, i) => {
        const div = document.createElement('div');
        div.className = 'rule-item';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'flex-start';
        
        const textSpan = document.createElement('span');
        textSpan.innerText = `${i+1}. ${r}`;
        textSpan.style.flex = 1;
        textSpan.style.marginRight = '10px';
        textSpan.style.wordBreak = 'break-word';

        const actionsDiv = document.createElement('div');
        actionsDiv.style.flexShrink = 0;
        
        const editBtn = document.createElement('span');
        editBtn.innerText = '✏️';
        editBtn.style.cursor = 'pointer';
        editBtn.style.marginRight = '10px';
        editBtn.title = 'Düzenle';
        
        const delBtn = document.createElement('span');
        delBtn.innerText = '🗑️';
        delBtn.style.cursor = 'pointer';
        delBtn.title = 'Sil';

        editBtn.onclick = () => {
            div.innerHTML = '';
            
            const numSpan = document.createElement('span');
            numSpan.innerText = `${i+1}. `;
            numSpan.style.fontWeight = 'bold';
            numSpan.style.marginRight = '8px';
            
            const input = document.createElement('input');
            input.value = rules[i];
            input.style.flex = 1;
            input.style.padding = '4px 8px';
            input.style.background = 'var(--bg-color)';
            input.style.color = 'var(--text-primary)';
            input.style.border = '1px solid var(--accent)';
            input.style.borderRadius = '4px';
            input.style.marginRight = '8px';
            
            const saveBtn = document.createElement('button');
            saveBtn.innerText = '✓';
            saveBtn.className = 'btn-success btn-small';
            saveBtn.style.padding = '4px 10px';
            
            saveBtn.onclick = () => {
                if (input.value.trim()) {
                    rules[i] = input.value.trim();
                    if(boxes[i]) boxes[i].rule = rules[i];
                    renderRules();
                }
            };
            
            div.appendChild(numSpan);
            div.appendChild(input);
            div.appendChild(saveBtn);
            
            input.focus();
        };

        delBtn.onclick = () => {
            if (confirm(`Kural ${i+1} ve çizim alanı silinsin mi?`)) {
                rules.splice(i, 1);
                boxes.splice(i, 1);
                renderRules();
                redrawCanvas();
            }
        };

        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(delBtn);
        div.appendChild(textSpan);
        div.appendChild(actionsDiv);
        list.appendChild(div);
    });
}

function redrawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    boxes.forEach((box, i) => {
        ctx.strokeStyle = '#10b981'; // Yeşil renk
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        
        ctx.fillStyle = '#10b981';
        ctx.fillRect(box.x, Math.max(0, box.y - 20), 24, 20);
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px Inter';
        ctx.fillText(i + 1, box.x + 8, Math.max(0, box.y - 20) + 14);
    });
}

document.getElementById('saveScenarioBtn').addEventListener('click', async () => {
    const name = document.getElementById('testName').value;
    const url = document.getElementById('testUrl').value;
    const waitSelector = document.getElementById('waitSelector').value;

    try {
        const folder = document.getElementById('folderSelect').value || 'Genel';
        const res = await fetch('/api/save-test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, url, waitSelector, rules: boxes, imageData: capturedImageData, folder })
        });
        const data = await res.json();
        if (data.success) {
            alert('Senaryo Başarıyla Kaydedildi! (config/pages.json)');
        }
    } catch (e) {
        alert("Error saving: " + e.message);
    }
});

// --- Canvas & Toolbar Logic ---
let currentTool = 'rect'; // rect, circle, arrow

document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        const target = e.currentTarget; 
        target.classList.add('active');
        currentTool = target.getAttribute('data-tool');
    });
});

function drawArrow(context, fromx, fromy, tox, toy) {
    const headlen = 15;
    const dx = tox - fromx;
    const dy = toy - fromy;
    const angle = Math.atan2(dy, dx);
    context.moveTo(fromx, fromy);
    context.lineTo(tox, toy);
    context.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
    context.moveTo(tox, toy);
    context.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
}

function redrawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    boxes.forEach((shape, i) => {
        ctx.strokeStyle = '#10b981'; 
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.beginPath();
        
        if (shape.type === 'rect') {
            ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
        } else if (shape.type === 'circle') {
            ctx.arc(shape.x, shape.y, shape.r, 0, 2 * Math.PI);
            ctx.stroke();
        } else if (shape.type === 'arrow') {
            drawArrow(ctx, shape.x1, shape.y1, shape.x2, shape.y2);
            ctx.stroke();
        }
        
        const labelX = shape.type === 'arrow' ? shape.x1 : shape.x;
        const labelY = shape.type === 'arrow' ? shape.y1 : shape.y;
        
        ctx.fillStyle = '#10b981';
        ctx.fillRect(labelX, Math.max(0, labelY - 20), 24, 20);
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px Inter';
        ctx.fillText(i + 1, labelX + 8, Math.max(0, labelY - 20) + 14);
    });
}

canvas.addEventListener('mousedown', (e) => {
    if (popup.style.display === 'flex') {
        popup.style.display = 'none';
        redrawCanvas();
    }
    
    drawing = true;
    startX = e.offsetX;
    startY = e.offsetY;
});

canvas.addEventListener('mousemove', (e) => {
    if (!drawing) return;
    const x = e.offsetX;
    const y = e.offsetY;
    
    redrawCanvas();
    
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    
    if (currentTool === 'rect') {
        ctx.strokeRect(startX, startY, x - startX, y - startY);
    } else if (currentTool === 'circle') {
        const radius = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2));
        ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
        ctx.stroke();
    } else if (currentTool === 'arrow') {
        drawArrow(ctx, startX, startY, x, y);
        ctx.stroke();
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (!drawing) return;
    drawing = false;
    ctx.setLineDash([]);
    
    const endX = e.offsetX;
    const endY = e.offsetY;
    
    currentBox = { type: currentTool };
    
    if (currentTool === 'rect') {
        const w = endX - startX;
        const h = endY - startY;
        if (Math.abs(w) < 10 || Math.abs(h) < 10) { redrawCanvas(); return; }
        currentBox.x = w > 0 ? startX : endX;
        currentBox.y = h > 0 ? startY : endY;
        currentBox.w = Math.abs(w);
        currentBox.h = Math.abs(h);
    } else if (currentTool === 'circle') {
        const r = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
        if (r < 10) { redrawCanvas(); return; }
        currentBox.x = startX;
        currentBox.y = startY;
        currentBox.r = r;
    } else if (currentTool === 'arrow') {
        const dist = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
        if (dist < 10) { redrawCanvas(); return; }
        currentBox.x1 = startX;
        currentBox.y1 = startY;
        currentBox.x2 = endX;
        currentBox.y2 = endY;
    }
    
    let popupLeft = (endX > startX ? endX : startX) + 10;
    let popupTop = (endY < startY ? endY : startY) + 50; 
    
    if (popupLeft + 300 > canvas.width) popupLeft = canvas.width - 310;
    
    popup.style.left = `${popupLeft}px`;
    popup.style.top = `${popupTop}px`;
    popup.style.display = 'flex';
    popupInput.value = '';
    popupInput.focus();
});

popupSave.addEventListener('click', () => {
    const text = popupInput.value.trim();
    if (text && currentBox) {
        currentBox.rule = text;
        boxes.push(currentBox);
        rules.push(text);
        renderRules();
    }
    popup.style.display = 'none';
    currentBox = null;
    redrawCanvas();
});

popupInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') popupSave.click();
});

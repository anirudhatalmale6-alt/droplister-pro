// DropLister Pro - Popup UI Logic

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── Tab Switching ───
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    $(`#tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ─── Settings ───
const settingFields = [
  'markupPercent', 'endPrice', 'minPrice', 'maxPrice', 'promotedRate',
  'domain', 'aiProvider', 'geminiApiKey', 'openaiApiKey', 'watermarkUrl'
];

const toggleFields = [
  'veroEnabled', 'autoSubmit', 'useSimpleDesc', 'useImageTemplate',
  'useReviewImages', 'fillRequiredSpecifics', 'fillOptionalSpecifics'
];

async function loadSettings() {
  const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });

  settingFields.forEach(f => {
    const el = $(`#${f}`);
    if (el && settings[f] !== undefined) el.value = settings[f];
  });

  toggleFields.forEach(f => {
    const el = $(`#${f}`);
    if (el) el.checked = !!settings[f];
  });

  updateProviderUI(settings.aiProvider);
  updateWatermarkPreview(settings.watermarkUrl);
  loadSkuCount();
  loadVeroCount();
}

function updateProviderUI(provider) {
  $('#geminiKeyRow').style.display = provider === 'gemini' ? 'flex' : 'none';
  $('#openaiKeyRow').style.display = provider === 'openai' ? 'flex' : 'none';
}

function updateWatermarkPreview(url) {
  const preview = $('#watermarkPreview');
  if (url) {
    preview.innerHTML = `<img src="${url}" alt="Watermark" onerror="this.style.display='none'">`;
  } else {
    preview.innerHTML = '';
  }
}

$('#aiProvider').addEventListener('change', (e) => updateProviderUI(e.target.value));
$('#watermarkUrl').addEventListener('change', (e) => updateWatermarkPreview(e.target.value));

$('#saveSettings').addEventListener('click', async () => {
  const data = {};

  settingFields.forEach(f => {
    const el = $(`#${f}`);
    if (el) {
      data[f] = el.type === 'number' ? parseFloat(el.value) : el.value;
    }
  });

  toggleFields.forEach(f => {
    const el = $(`#${f}`);
    if (el) data[f] = el.checked;
  });

  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', data });
  showToast('Settings saved');
});

$('#openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ─── Bulk Lister ───
$('#startBulk').addEventListener('click', async () => {
  const links = $('#bulkLinks').value.split('\n').filter(l => l.trim());
  if (!links.length) return showToast('Enter at least one link');

  const threads = parseInt($('#threadCount').value) || 1;
  await chrome.runtime.sendMessage({ type: 'START_BULK', links, threads });

  $('#startBulk').disabled = true;
  $('#pauseBulk').disabled = false;
  $('#stopBulk').disabled = false;
  $('#bulkStatusCard').style.display = 'block';
});

$('#pauseBulk').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'PAUSE_BULK' });
  $('#pauseBulk').disabled = true;
  $('#resumeBulk').disabled = false;
});

$('#resumeBulk').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'RESUME_BULK' });
  $('#resumeBulk').disabled = true;
  $('#pauseBulk').disabled = false;
});

$('#stopBulk').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'STOP_BULK' });
  $('#startBulk').disabled = false;
  $('#pauseBulk').disabled = true;
  $('#resumeBulk').disabled = true;
  $('#stopBulk').disabled = true;
});

$('#searchAndList').addEventListener('click', async () => {
  const queries = $('#searchQueries').value.split('\n').filter(q => q.trim());
  if (!queries.length) return showToast('Enter at least one search query');
  showToast('Search & List coming in next update');
});

// Listen for bulk status updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'BULK_STATUS') {
    updateBulkUI(msg.data);
  }
});

function updateBulkUI(status) {
  const pct = status.total > 0 ? (status.position / status.total * 100) : 0;
  $('#bulkProgress').style.width = `${pct}%`;
  $('#bulkStatusText').textContent = `${status.position} / ${status.total}`;

  const resultsDiv = $('#bulkResults');
  resultsDiv.innerHTML = status.results.slice(-20).reverse().map(r =>
    `<div class="result-item ${r.status}">[${r.index + 1}] ${r.message}</div>`
  ).join('');

  if (!status.running) {
    $('#startBulk').disabled = false;
    $('#pauseBulk').disabled = true;
    $('#resumeBulk').disabled = true;
    $('#stopBulk').disabled = true;
  }
}

// ─── SKU Management ───
async function loadSkuCount() {
  const { skus } = await chrome.runtime.sendMessage({ type: 'GET_SKUS' });
  $('#skuCount').textContent = `Listed SKUs: ${skus.length}`;
}

$('#clearSkus').addEventListener('click', async () => {
  if (confirm('Clear all listed SKUs?')) {
    await chrome.runtime.sendMessage({ type: 'CLEAR_SKUS' });
    loadSkuCount();
    showToast('SKUs cleared');
  }
});

$('#exportSkus').addEventListener('click', async () => {
  const { skus } = await chrome.runtime.sendMessage({ type: 'GET_SKUS' });
  const blob = new Blob([skus.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'droplister-skus.txt';
  a.click();
  URL.revokeObjectURL(url);
});

$('#importSkus').addEventListener('click', () => {
  $('#skuFileInput').click();
});

$('#skuFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const skus = text.split('\n').map(s => s.trim()).filter(Boolean);
  for (const sku of skus) {
    await chrome.runtime.sendMessage({ type: 'ADD_SKU', sku });
  }
  loadSkuCount();
  showToast(`Imported ${skus.length} SKUs`);
});

// ─── VeRO Brands ───
async function loadVeroCount() {
  const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  const count = (settings.veroBrands || []).length;
  $('#veroCount').textContent = `VeRO Brands: ${count}`;
}

$('#loadDefaultVero').addEventListener('click', async () => {
  const defaultBrands = [
    'Nike', 'Adidas', 'Louis Vuitton', 'Gucci', 'Chanel', 'Prada', 'Hermès',
    'Burberry', 'Dior', 'Versace', 'Balenciaga', 'Fendi', 'Cartier', 'Rolex',
    'Supreme', 'Yeezy', 'Apple', 'Microsoft', 'Disney', 'Warner Bros',
    'NFL', 'NBA', 'MLB', 'FIFA', 'UFC', 'WWE',
    'Lego', 'Mattel', 'Hasbro', 'Bandai',
    'North Face', 'Patagonia', 'Canada Goose', 'Moncler',
    'Tiffany', 'Swarovski', 'Pandora',
    'Ray-Ban', 'Oakley', 'Luxottica',
    'Sonos', 'Bose', 'JBL', 'Bang & Olufsen',
    'Cricut', 'Dyson', 'iRobot', 'Vitamix',
    'OtterBox', 'LifeProof', 'CamelBak',
    'Stanley', 'YETI', 'Hydro Flask',
    'Yankee Candle', 'Bath & Body Works',
    'Weber', 'Traeger', 'Solo Stove'
  ];
  await chrome.runtime.sendMessage({
    type: 'SAVE_SETTING',
    key: 'veroBrands',
    value: defaultBrands
  });
  loadVeroCount();
  showToast(`Loaded ${defaultBrands.length} VeRO brands`);
});

$('#importVero').addEventListener('click', () => {
  $('#veroFileInput').click();
});

$('#veroFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const brands = text.split('\n').map(s => s.trim()).filter(Boolean);
  await chrome.runtime.sendMessage({
    type: 'SAVE_SETTING',
    key: 'veroBrands',
    value: brands
  });
  loadVeroCount();
  showToast(`Imported ${brands.length} VeRO brands`);
});

$('#clearVero').addEventListener('click', async () => {
  if (confirm('Clear all VeRO brands?')) {
    await chrome.runtime.sendMessage({ type: 'SAVE_SETTING', key: 'veroBrands', value: [] });
    loadVeroCount();
    showToast('VeRO list cleared');
  }
});

// ─── Tools ───
$('#btnDuplicateChecker').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#duplicate-checker') });
});

$('#btnCompetitorResearch').addEventListener('click', () => {
  showToast('Open an eBay seller page to analyze');
});

$('#btnBoostListings').addEventListener('click', () => {
  showToast('Boost feature - open your eBay active listings');
});

$('#btnProductFinder').addEventListener('click', () => {
  showToast('Open Amazon search to find products');
});

// ─── Toast ───
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = `position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:#6366f1;color:#fff;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;z-index:9999;opacity:0;transition:opacity 0.3s;white-space:nowrap;`;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(() => toast.style.opacity = '0', 2500);
}

// ─── Init ───
loadSettings();

// Poll bulk status on open
chrome.runtime.sendMessage({ type: 'GET_BULK_STATUS' }).then(status => {
  if (status && status.running) {
    $('#bulkStatusCard').style.display = 'block';
    updateBulkUI(status);
    $('#startBulk').disabled = true;
    $('#pauseBulk').disabled = status.paused;
    $('#resumeBulk').disabled = !status.paused;
    $('#stopBulk').disabled = false;
  }
});

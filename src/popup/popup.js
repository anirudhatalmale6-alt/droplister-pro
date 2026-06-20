// DropLister Pro - Popup UI Logic with Auth
import { getAuthState, login, logout, checkAccess, getTrialTimeRemaining, formatTime } from '../lib/auth.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let trialInterval = null;

// ─── Auth UI ───
async function initAuth() {
  const state = await getAuthState();

  if (!state.isLoggedIn) {
    showLoginScreen();
    return;
  }

  const access = await checkAccess();
  if (!access.allowed) {
    if (access.reason === 'trial_expired') {
      showExpiredScreen();
    } else {
      showLoginScreen();
    }
    return;
  }

  showMainApp(state, access);
}

function showLoginScreen() {
  $('#loginScreen').style.display = 'block';
  $('#mainApp').style.display = 'none';
}

function showExpiredScreen() {
  $('#loginScreen').style.display = 'none';
  $('#mainApp').style.display = 'block';
  $('#mainTabs').style.display = 'none';
  $$('.tab-content').forEach(t => t.style.display = 'none');
  $('#trialExpiredOverlay').style.display = 'block';
}

function showMainApp(state, access) {
  $('#loginScreen').style.display = 'none';
  $('#mainApp').style.display = 'block';
  $('#trialExpiredOverlay').style.display = 'none';
  $('#mainTabs').style.display = 'flex';

  $('#userEmail').textContent = state.email || 'User';

  const badge = $('#licenseBadge');
  badge.textContent = (state.licenseType || 'trial').toUpperCase();
  badge.className = 'badge ' + (state.licenseType || 'trial');

  if (state.licenseType === 'trial') {
    startTrialTimer(state.trialStart);
  } else {
    $('#trialTimer').style.display = 'none';
  }

  loadSettings();
}

function startTrialTimer(trialStart) {
  const timerEl = $('#trialTimer');
  const timerText = $('#timerText');
  timerEl.style.display = 'flex';

  function update() {
    const remaining = getTrialTimeRemaining(trialStart);
    if (remaining <= 0) {
      clearInterval(trialInterval);
      showExpiredScreen();
      chrome.storage.local.set({ dl_trial_expired: true });
      return;
    }
    timerText.textContent = formatTime(remaining);
    if (remaining < 5 * 60 * 1000) {
      timerEl.classList.add('warning');
    }
  }

  update();
  trialInterval = setInterval(update, 1000);
}

$('#loginBtn').addEventListener('click', async () => {
  const email = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value;
  const errorEl = $('#loginError');

  if (!email || !password) {
    errorEl.textContent = 'Please enter email and password';
    return;
  }

  $('#loginBtn').disabled = true;
  $('#loginBtn').textContent = 'Logging in...';
  errorEl.textContent = '';

  const result = await login(email, password);

  if (result.success) {
    const state = await getAuthState();
    const access = await checkAccess();
    showMainApp(state, access);
  } else {
    errorEl.textContent = result.error || 'Login failed';
  }

  $('#loginBtn').disabled = false;
  $('#loginBtn').textContent = 'Login';
});

$('#loginPassword').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') $('#loginBtn').click();
});

$('#logoutBtn').addEventListener('click', async () => {
  if (trialInterval) clearInterval(trialInterval);
  await logout();
  showLoginScreen();
});

$('#logoutExpiredBtn').addEventListener('click', async () => {
  await logout();
  showLoginScreen();
});

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
  preview.innerHTML = url ? `<img src="${url}" onerror="this.style.display='none'">` : '';
}

$('#aiProvider').addEventListener('change', (e) => updateProviderUI(e.target.value));
$('#watermarkUrl').addEventListener('change', (e) => updateWatermarkPreview(e.target.value));

$('#saveSettings').addEventListener('click', async () => {
  const data = {};
  settingFields.forEach(f => {
    const el = $(`#${f}`);
    if (el) data[f] = el.type === 'number' ? parseFloat(el.value) : el.value;
  });
  toggleFields.forEach(f => {
    const el = $(`#${f}`);
    if (el) data[f] = el.checked;
  });
  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', data });
  showToast('Settings saved');
});

$('#openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

// ─── Bulk Lister ───
$('#startBulk').addEventListener('click', async () => {
  const access = await checkAccess();
  if (!access.allowed) { showToast('Access expired'); return; }
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
  showToast('Search & List feature coming soon');
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'BULK_STATUS') updateBulkUI(msg.data);
});

function updateBulkUI(status) {
  const pct = status.total > 0 ? (status.position / status.total * 100) : 0;
  $('#bulkProgress').style.width = `${pct}%`;
  $('#bulkStatusText').textContent = `${status.position} / ${status.total}`;
  $('#bulkResults').innerHTML = status.results.slice(-20).reverse().map(r =>
    `<div class="result-item ${r.status}">[${r.index + 1}] ${r.message}</div>`
  ).join('');
  if (!status.running) {
    $('#startBulk').disabled = false;
    $('#pauseBulk').disabled = true;
    $('#resumeBulk').disabled = true;
    $('#stopBulk').disabled = true;
  }
}

// ─── SKU / VeRO Management ───
async function loadSkuCount() {
  const { skus } = await chrome.runtime.sendMessage({ type: 'GET_SKUS' });
  $('#skuCount').textContent = `Listed SKUs: ${skus.length}`;
}

async function loadVeroCount() {
  const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  $('#veroCount').textContent = `VeRO Brands: ${(settings.veroBrands || []).length}`;
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
  downloadFile('droplister-skus.txt', skus.join('\n'));
});

$('#importSkus').addEventListener('click', () => $('#skuFileInput').click());
$('#skuFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const skus = (await file.text()).split('\n').map(s => s.trim()).filter(Boolean);
  for (const sku of skus) await chrome.runtime.sendMessage({ type: 'ADD_SKU', sku });
  loadSkuCount();
  showToast(`Imported ${skus.length} SKUs`);
});

$('#loadDefaultVero').addEventListener('click', async () => {
  const defaultBrands = [
    'Nike','Adidas','Louis Vuitton','Gucci','Chanel','Prada','Hermes',
    'Burberry','Dior','Versace','Balenciaga','Fendi','Cartier','Rolex',
    'Supreme','Yeezy','Apple','Microsoft','Disney','Warner Bros',
    'NFL','NBA','MLB','FIFA','UFC','WWE','Lego','Mattel','Hasbro','Bandai',
    'North Face','Patagonia','Canada Goose','Moncler',
    'Tiffany','Swarovski','Pandora','Ray-Ban','Oakley',
    'Sonos','Bose','JBL','Cricut','Dyson','iRobot','Vitamix',
    'OtterBox','Stanley','YETI','Hydro Flask','Yankee Candle',
    'Weber','Traeger','Solo Stove'
  ];
  await chrome.runtime.sendMessage({ type: 'SAVE_SETTING', key: 'veroBrands', value: defaultBrands });
  loadVeroCount();
  showToast(`Loaded ${defaultBrands.length} VeRO brands`);
});

$('#importVero').addEventListener('click', () => $('#veroFileInput').click());
$('#veroFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const brands = (await file.text()).split('\n').map(s => s.trim()).filter(Boolean);
  await chrome.runtime.sendMessage({ type: 'SAVE_SETTING', key: 'veroBrands', value: brands });
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

$('#btnDuplicateChecker').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#duplicate-checker') });
});

$('#btnCompetitorResearch').addEventListener('click', () => showToast('Open an eBay seller page to analyze'));
$('#btnBoostListings').addEventListener('click', () => showToast('Open your eBay active listings'));
$('#btnProductFinder').addEventListener('click', () => showToast('Open Amazon search to find products'));

// ─── Helpers ───
function downloadFile(name, content) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:#6366f1;color:#fff;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;z-index:9999;opacity:0;transition:opacity 0.3s;white-space:nowrap;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(() => toast.style.opacity = '0', 2500);
}

// ─── Init ───
initAuth();

chrome.runtime.sendMessage({ type: 'GET_BULK_STATUS' }).then(status => {
  if (status && status.running) {
    $('#bulkStatusCard').style.display = 'block';
    updateBulkUI(status);
    $('#startBulk').disabled = true;
    $('#pauseBulk').disabled = status.paused;
    $('#resumeBulk').disabled = !status.paused;
    $('#stopBulk').disabled = false;
  }
}).catch(() => {});

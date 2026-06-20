// DropLister Pro - Options Page Logic

const $ = (sel) => document.querySelector(sel);

const optionFields = {
  text: ['itemLocation', 'itemLocationCityState', 'returnPolicyId', 'geminiApiKeyImg',
         'imagePrompt', 'descriptionPrompt', 'filteredWords'],
  number: ['promotedRate'],
  select: ['itemLocationCountry', 'scheduleListing'],
  checkbox: ['isInternational', 'hasEbaySubscription', 'hasTaxExempt', 'forceItemLocation',
             'forceReturnPolicy', 'onlyListOnePicture', 'useImageTemplate', 'useReviewImages',
             'useAIImage', 'useSimpleDescription', 'useCustomDescPrompt', 'removeSections',
             'disableThankYou', 'fillRequired', 'fillOptional']
};

async function loadOptions() {
  const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });

  Object.entries(optionFields).forEach(([type, fields]) => {
    fields.forEach(f => {
      const el = $(`#${f}`);
      if (!el) return;
      if (type === 'checkbox') {
        el.checked = !!settings[f];
      } else {
        el.value = settings[f] || el.value || '';
      }
    });
  });

  loadSkuCount();

  // Show/hide AI image section
  $('#useAIImage')?.addEventListener('change', (e) => {
    const sect = $('#aiImageSection');
    if (sect) sect.style.display = e.target.checked ? 'block' : 'none';
  });
  if ($('#useAIImage')?.checked) {
    const sect = $('#aiImageSection');
    if (sect) sect.style.display = 'block';
  }
}

async function saveOptions() {
  const data = {};

  Object.entries(optionFields).forEach(([type, fields]) => {
    fields.forEach(f => {
      const el = $(`#${f}`);
      if (!el) return;
      if (type === 'checkbox') {
        data[f] = el.checked;
      } else if (type === 'number') {
        data[f] = parseFloat(el.value) || 0;
      } else {
        data[f] = el.value;
      }
    });
  });

  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', data });
  $('#saveStatus').textContent = 'Settings saved!';
  setTimeout(() => $('#saveStatus').textContent = '', 3000);
}

async function loadSkuCount() {
  const { skus } = await chrome.runtime.sendMessage({ type: 'GET_SKUS' });
  $('#totalSkus').textContent = skus.length;
}

// Event listeners
$('#saveAll').addEventListener('click', saveOptions);

$('#exportAllSkus')?.addEventListener('click', async () => {
  const { skus } = await chrome.runtime.sendMessage({ type: 'GET_SKUS' });
  const blob = new Blob([skus.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'droplister-skus.txt';
  a.click();
  URL.revokeObjectURL(url);
});

$('#importSkuFile')?.addEventListener('click', () => {
  $('#skuFileImport').click();
});

$('#skuFileImport')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const skus = text.split('\n').map(s => s.trim()).filter(Boolean);
  for (const sku of skus) {
    await chrome.runtime.sendMessage({ type: 'ADD_SKU', sku });
  }
  loadSkuCount();
  $('#saveStatus').textContent = `Imported ${skus.length} SKUs`;
  setTimeout(() => $('#saveStatus').textContent = '', 3000);
});

$('#clearAllSkus')?.addEventListener('click', async () => {
  if (confirm('Are you sure? This will delete all saved SKUs.')) {
    await chrome.runtime.sendMessage({ type: 'CLEAR_SKUS' });
    loadSkuCount();
    $('#saveStatus').textContent = 'All SKUs cleared';
    setTimeout(() => $('#saveStatus').textContent = '', 3000);
  }
});

// Handle hash navigation (from popup tools)
if (location.hash) {
  const target = document.querySelector(location.hash);
  if (target) {
    setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  }
}

// Init
loadOptions();

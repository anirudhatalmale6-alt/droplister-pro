// DropLister Pro - Background Service Worker
// Handles messaging, AI calls, bulk listing orchestration, and storage management

const VERO_BRANDS = [];
let bulkListState = { running: false, paused: false, position: 0, links: [], results: [], threads: 1 };

// ─── Storage Helpers ───
async function getSettings() {
  const defaults = {
    markupPercent: 30,
    endPrice: 0.99,
    domain: 'com',
    veroEnabled: true,
    autoSubmit: false,
    aiProvider: 'gemini',
    geminiApiKey: '',
    openaiApiKey: '',
    useSimpleDesc: false,
    useImageTemplate: false,
    useReviewImages: false,
    minPrice: 0,
    maxPrice: 999,
    promotedRate: 2.1,
    scheduleListing: false,
    fillRequiredSpecifics: true,
    fillOptionalSpecifics: true,
    forceItemLocation: false,
    itemLocation: '',
    itemLocationCountry: 'US',
    itemLocationCityState: '',
    forceReturnPolicy: false,
    returnPolicyId: '',
    isInternational: false,
    hasTaxExempt: true,
    hasEbaySubscription: true,
    customDescPrompt: '',
    useCustomDescPrompt: false,
    watermarkUrl: '',
    listedSkus: [],
    veroBrands: []
  };
  const stored = await chrome.storage.local.get(Object.keys(defaults));
  return { ...defaults, ...stored };
}

async function saveSetting(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function saveSettings(obj) {
  await chrome.storage.local.set(obj);
}

// ─── VeRO Brand Protection ───
async function loadVeroBrands() {
  const { veroBrands } = await chrome.storage.local.get('veroBrands');
  return veroBrands || [];
}

async function checkVero(title, brand) {
  const brands = await loadVeroBrands();
  if (!brands.length) return { safe: true, reason: '' };
  const titleLower = (title || '').toLowerCase();
  const brandLower = (brand || '').toLowerCase();
  for (const vb of brands) {
    const vbLower = vb.toLowerCase();
    if (brandLower === vbLower || titleLower.includes(vbLower)) {
      return { safe: false, reason: `VeRO brand detected: ${vb}` };
    }
  }
  return { safe: true, reason: '' };
}

// ─── AI Integration ───
async function callAI(prompt, settings) {
  if (settings.aiProvider === 'gemini' && settings.geminiApiKey) {
    return callGemini(prompt, settings.geminiApiKey);
  } else if (settings.aiProvider === 'openai' && settings.openaiApiKey) {
    return callOpenAI(prompt, settings.openaiApiKey);
  }
  return null;
}

async function callGemini(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    })
  });
  const data = await resp.json();
  if (data.candidates && data.candidates[0]) {
    return data.candidates[0].content.parts[0].text;
  }
  throw new Error(data.error?.message || 'Gemini API error');
}

async function callOpenAI(prompt, apiKey) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 2048
    })
  });
  const data = await resp.json();
  if (data.choices && data.choices[0]) {
    return data.choices[0].message.content;
  }
  throw new Error(data.error?.message || 'OpenAI API error');
}

// ─── AI Title Generation ───
async function generateTitle(productData, settings) {
  const prompt = `You are an expert eBay SEO specialist. Create an optimized eBay listing title for this product.

Product: ${productData.title}
Brand: ${productData.brand || 'Unknown'}
Category: ${productData.category || 'General'}
Key Features: ${(productData.features || []).join(', ')}

Rules:
- Maximum 80 characters
- Include the most important keywords for eBay search
- Include brand name if not a VeRO brand
- Use natural language, not keyword stuffing
- Capitalize important words
- Do NOT use special characters or emojis
- Do NOT include "Amazon" or any Amazon-specific terms
- Focus on what buyers search for

Return ONLY the title, nothing else.`;

  return await callAI(prompt, settings);
}

// ─── AI Description Generation ───
async function generateDescription(productData, settings) {
  const customPrompt = settings.useCustomDescPrompt && settings.customDescPrompt
    ? settings.customDescPrompt
    : null;

  const basePrompt = customPrompt || `You are an expert eBay product copywriter.`;

  const prompt = `${basePrompt}

Create a professional eBay product description for this item.

Product: ${productData.title}
Brand: ${productData.brand || 'Unknown'}
Features:
${(productData.features || []).map(f => `- ${f}`).join('\n')}

${productData.description ? `Original Description: ${productData.description.substring(0, 500)}` : ''}

Rules:
- Write in HTML format
- Include a brief introduction paragraph
- List key features as bullet points
- Add a "What's Included" section if applicable
- Do NOT mention Amazon, Prime, or any Amazon-specific terms
- Do NOT include any URLs or links
- Keep it professional and concise
- Use clean HTML (div, p, ul, li, strong, h3 tags only)
${settings.useSimpleDesc ? '- Keep it SHORT - max 3-4 sentences total, no elaborate formatting' : ''}

Return ONLY the HTML content, no markdown code blocks.`;

  return await callAI(prompt, settings);
}

// ─── AI Item Specifics ───
async function generateItemSpecifics(productData, requiredSpecifics, settings) {
  const prompt = `You are an eBay listing expert. Fill in the item specifics for this product.

Product: ${productData.title}
Brand: ${productData.brand || 'Unknown'}
Features: ${(productData.features || []).join(', ')}
${productData.specifications ? `Specifications: ${JSON.stringify(productData.specifications)}` : ''}

Required Item Specifics to fill:
${requiredSpecifics.map(s => `- ${s.name}: ${s.options ? `Options: ${s.options.join(', ')}` : 'Free text'}`).join('\n')}

Rules:
- Return a JSON object with the specific name as key and your answer as value
- Only use values from the provided options when options are listed
- For free text fields, use accurate product information
- If you cannot determine a value, use "N/A"
- Do NOT make up specifications
- Return ONLY valid JSON, no markdown

Example: {"Brand": "Nike", "Color": "Black", "Size": "10"}`;

  const result = await callAI(prompt, settings);
  try {
    const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    return {};
  }
}

// ─── SKU Management (Duplicate Check) ───
async function getListedSkus() {
  const { listedSkus } = await chrome.storage.local.get('listedSkus');
  return listedSkus || [];
}

async function addListedSku(sku) {
  const skus = await getListedSkus();
  if (!skus.includes(sku)) {
    skus.push(sku);
    await chrome.storage.local.set({ listedSkus: skus });
  }
  return skus.length;
}

async function isSkuListed(sku) {
  const skus = await getListedSkus();
  return skus.includes(sku);
}

// ─── Price Calculation ───
function calculatePrice(amazonPrice, settings) {
  const price = parseFloat(amazonPrice) || 0;
  const markup = parseFloat(settings.markupPercent) || 30;
  const endPrice = parseFloat(settings.endPrice) || 0.99;

  let ebayPrice = price * (1 + markup / 100);
  const wholePart = Math.floor(ebayPrice);
  ebayPrice = wholePart + endPrice;

  return ebayPrice.toFixed(2);
}

// ─── Bulk Listing ───
async function startBulkList(links, threads) {
  bulkListState = {
    running: true,
    paused: false,
    position: 0,
    links: links.filter(l => l.trim()),
    results: [],
    threads: Math.min(threads, 30)
  };

  broadcastBulkStatus();
  processBulkQueue();
}

async function processBulkQueue() {
  if (!bulkListState.running || bulkListState.paused) return;

  const settings = await getSettings();
  const activeTasks = [];

  while (bulkListState.position < bulkListState.links.length && activeTasks.length < bulkListState.threads) {
    if (!bulkListState.running || bulkListState.paused) break;

    const idx = bulkListState.position;
    const link = bulkListState.links[idx];
    bulkListState.position++;

    const task = processOneLink(link, idx, settings).then(result => {
      bulkListState.results.push(result);
      broadcastBulkStatus();
    });
    activeTasks.push(task);
  }

  if (activeTasks.length > 0) {
    await Promise.all(activeTasks);
    if (bulkListState.running && !bulkListState.paused && bulkListState.position < bulkListState.links.length) {
      processBulkQueue();
    }
  }

  if (bulkListState.position >= bulkListState.links.length) {
    bulkListState.running = false;
    broadcastBulkStatus();
  }
}

async function processOneLink(link, index, settings) {
  try {
    const asin = extractASIN(link);
    if (!asin) return { index, link, status: 'error', message: 'Invalid Amazon link' };

    if (await isSkuListed(asin)) {
      return { index, link, status: 'skipped', message: 'Already listed (duplicate SKU)' };
    }

    const tab = await chrome.tabs.create({ url: link, active: false });

    await new Promise(resolve => {
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    await new Promise(r => setTimeout(r, 2000));

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeAmazonProduct
    });

    const productData = result?.result;
    if (!productData || !productData.title) {
      chrome.tabs.remove(tab.id);
      return { index, link, status: 'error', message: 'Could not scrape product' };
    }

    if (settings.veroEnabled) {
      const veroCheck = await checkVero(productData.title, productData.brand);
      if (!veroCheck.safe) {
        chrome.tabs.remove(tab.id);
        return { index, link, status: 'vero', message: veroCheck.reason };
      }
    }

    const price = parseFloat(productData.price) || 0;
    if (price < settings.minPrice || price > settings.maxPrice) {
      chrome.tabs.remove(tab.id);
      return { index, link, status: 'skipped', message: `Price $${price} outside range ($${settings.minPrice}-$${settings.maxPrice})` };
    }

    const aiTitle = await generateTitle(productData, settings);
    const aiDesc = await generateDescription(productData, settings);
    const ebayPrice = calculatePrice(productData.price, settings);

    const listingData = {
      ...productData,
      ebayTitle: aiTitle || productData.title,
      ebayDescription: aiDesc,
      ebayPrice,
      sku: asin
    };

    chrome.tabs.remove(tab.id);

    const ebayTab = await chrome.tabs.create({
      url: `https://www.ebay.${settings.domain}/sell/create`,
      active: false
    });

    await new Promise(resolve => {
      const listener = (tabId, info) => {
        if (tabId === ebayTab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    await new Promise(r => setTimeout(r, 3000));

    await chrome.tabs.sendMessage(ebayTab.id, {
      type: 'FILL_LISTING',
      data: listingData,
      settings
    });

    await addListedSku(asin);

    return { index, link, status: 'success', message: `Listed: ${aiTitle}` };
  } catch (err) {
    return { index, link, status: 'error', message: err.message };
  }
}

function broadcastBulkStatus() {
  chrome.runtime.sendMessage({
    type: 'BULK_STATUS',
    data: {
      running: bulkListState.running,
      paused: bulkListState.paused,
      position: bulkListState.position,
      total: bulkListState.links.length,
      results: bulkListState.results
    }
  }).catch(() => {});
}

function extractASIN(url) {
  const match = url.match(/(?:dp|product|ASIN)\/([A-Z0-9]{10})/i);
  return match ? match[1] : null;
}

function scrapeAmazonProduct() {
  const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
  const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || '';

  const title = getText('#productTitle') || getText('#title');

  let price = '';
  const priceEl = document.querySelector('.a-price .a-offscreen') ||
                  document.querySelector('#priceblock_ourprice') ||
                  document.querySelector('#priceblock_dealprice') ||
                  document.querySelector('.a-price-whole');
  if (priceEl) {
    price = priceEl.textContent.replace(/[^0-9.]/g, '');
  }

  let brand = getText('#bylineInfo')?.replace(/^(Visit the |Brand: )/, '').replace(/ Store$/, '') || '';
  if (!brand) {
    document.querySelectorAll('#productDetails_techSpec_section_1 tr, #detailBullets_feature_div li').forEach(el => {
      if (el.textContent.includes('Brand')) {
        brand = el.querySelector('td, .a-list-item span:last-child')?.textContent?.trim() || '';
      }
    });
  }

  const features = [];
  document.querySelectorAll('#feature-bullets li span.a-list-item').forEach(el => {
    const t = el.textContent.trim();
    if (t && !t.includes('Make sure this fits') && !t.includes('Click here')) features.push(t);
  });

  const images = [];
  document.querySelectorAll('#altImages .a-button-thumbnail img, .imgTagWrapper img').forEach(img => {
    let src = img.src || img.getAttribute('data-old-hires') || '';
    src = src.replace(/\._[A-Z]{2}\d+_\./, '._SL1500_.');
    if (src && !src.includes('sprite') && !src.includes('play-icon') && !images.includes(src)) {
      images.push(src);
    }
  });

  const mainImg = getAttr('#landingImage', 'data-old-hires') || getAttr('#landingImage', 'src') || '';
  if (mainImg && !images.includes(mainImg)) images.unshift(mainImg);

  const specifications = {};
  document.querySelectorAll('#productDetails_techSpec_section_1 tr').forEach(row => {
    const key = row.querySelector('th')?.textContent?.trim();
    const val = row.querySelector('td')?.textContent?.trim();
    if (key && val) specifications[key] = val;
  });

  let category = '';
  const breadcrumbs = document.querySelectorAll('#wayfinding-breadcrumbs_container li a');
  if (breadcrumbs.length) {
    category = breadcrumbs[breadcrumbs.length - 1].textContent.trim();
  }

  const description = getText('#productDescription p') || getText('#productDescription');

  const asin = location.href.match(/(?:dp|product)\/([A-Z0-9]{10})/i)?.[1] || '';

  return { title, price, brand, features, images, specifications, category, description, asin, url: location.href };
}

// ─── Message Handler ───
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'GET_SETTINGS':
          sendResponse(await getSettings());
          break;

        case 'SAVE_SETTINGS':
          await saveSettings(msg.data);
          sendResponse({ ok: true });
          break;

        case 'SAVE_SETTING':
          await saveSetting(msg.key, msg.value);
          sendResponse({ ok: true });
          break;

        case 'GENERATE_TITLE':
          const title = await generateTitle(msg.productData, await getSettings());
          sendResponse({ title });
          break;

        case 'GENERATE_DESCRIPTION':
          const desc = await generateDescription(msg.productData, await getSettings());
          sendResponse({ description: desc });
          break;

        case 'GENERATE_ITEM_SPECIFICS':
          const specs = await generateItemSpecifics(msg.productData, msg.requiredSpecifics, await getSettings());
          sendResponse({ specifics: specs });
          break;

        case 'CALCULATE_PRICE':
          const ebayPrice = calculatePrice(msg.price, await getSettings());
          sendResponse({ price: ebayPrice });
          break;

        case 'CHECK_VERO':
          const vero = await checkVero(msg.title, msg.brand);
          sendResponse(vero);
          break;

        case 'CHECK_DUPLICATE':
          const isDup = await isSkuListed(msg.sku);
          sendResponse({ isDuplicate: isDup });
          break;

        case 'ADD_SKU':
          const count = await addListedSku(msg.sku);
          sendResponse({ count });
          break;

        case 'GET_SKUS':
          sendResponse({ skus: await getListedSkus() });
          break;

        case 'CLEAR_SKUS':
          await chrome.storage.local.set({ listedSkus: [] });
          sendResponse({ ok: true });
          break;

        case 'START_BULK':
          startBulkList(msg.links, msg.threads || 1);
          sendResponse({ ok: true });
          break;

        case 'PAUSE_BULK':
          bulkListState.paused = true;
          broadcastBulkStatus();
          sendResponse({ ok: true });
          break;

        case 'RESUME_BULK':
          bulkListState.paused = false;
          processBulkQueue();
          broadcastBulkStatus();
          sendResponse({ ok: true });
          break;

        case 'STOP_BULK':
          bulkListState.running = false;
          broadcastBulkStatus();
          sendResponse({ ok: true });
          break;

        case 'GET_BULK_STATUS':
          sendResponse({
            running: bulkListState.running,
            paused: bulkListState.paused,
            position: bulkListState.position,
            total: bulkListState.links.length,
            results: bulkListState.results
          });
          break;

        case 'SCRAPE_PRODUCT':
          if (sender.tab?.id) {
            const [r] = await chrome.scripting.executeScript({
              target: { tabId: sender.tab.id },
              func: scrapeAmazonProduct
            });
            sendResponse(r?.result || null);
          }
          break;

        case 'OPEN_EBAY_LISTING':
          const settings = await getSettings();
          const ebayTab = await chrome.tabs.create({
            url: `https://www.ebay.${settings.domain}/sell/create`
          });
          await chrome.storage.local.set({ pendingListing: msg.data });
          sendResponse({ tabId: ebayTab.id });
          break;

        case 'GET_PENDING_LISTING':
          const { pendingListing } = await chrome.storage.local.get('pendingListing');
          sendResponse(pendingListing || null);
          break;

        case 'CLEAR_PENDING_LISTING':
          await chrome.storage.local.remove('pendingListing');
          sendResponse({ ok: true });
          break;

        case 'CALL_AI':
          const aiResult = await callAI(msg.prompt, await getSettings());
          sendResponse({ result: aiResult });
          break;

        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();
  return true;
});

// ─── Context Menu ───
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'list-on-ebay',
    title: 'List on eBay with DropLister',
    contexts: ['page'],
    documentUrlPatterns: [
      '*://*.amazon.com/*dp*',
      '*://*.amazon.ca/*dp*',
      '*://*.amazon.co.uk/*dp*',
      '*://*.amazon.com.au/*dp*'
    ]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'list-on-ebay' && tab?.id) {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeAmazonProduct
    });
    if (r?.result) {
      const settings = await getSettings();
      const title = await generateTitle(r.result, settings);
      const desc = await generateDescription(r.result, settings);
      const price = calculatePrice(r.result.price, settings);
      await chrome.storage.local.set({
        pendingListing: { ...r.result, ebayTitle: title, ebayDescription: desc, ebayPrice: price, sku: r.result.asin }
      });
      chrome.tabs.create({ url: `https://www.ebay.${settings.domain}/sell/create` });
    }
  }
});

console.log('DropLister Pro background service worker loaded');

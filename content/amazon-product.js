// DropLister Pro - Amazon Product Page Content Script
// Adds a floating toolbar on Amazon product pages for one-click eBay listing

(function() {
  'use strict';

  if (document.getElementById('droplister-toolbar')) return;

  function scrapeProduct() {
    const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
    const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || '';

    const title = getText('#productTitle') || getText('#title');

    let price = '';
    const priceEl = document.querySelector('.a-price .a-offscreen') ||
                    document.querySelector('#priceblock_ourprice') ||
                    document.querySelector('#priceblock_dealprice') ||
                    document.querySelector('.a-price-whole');
    if (priceEl) price = priceEl.textContent.replace(/[^0-9.]/g, '');

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
    const mainImg = getAttr('#landingImage', 'data-old-hires') || getAttr('#landingImage', 'src');
    if (mainImg) images.push(mainImg);

    document.querySelectorAll('#altImages .a-button-thumbnail img').forEach(img => {
      let src = img.src || '';
      src = src.replace(/\._[A-Z]{2}\d+_\./, '._SL1500_.');
      if (src && !src.includes('sprite') && !src.includes('play-icon') && !images.includes(src)) {
        images.push(src);
      }
    });

    const specifications = {};
    document.querySelectorAll('#productDetails_techSpec_section_1 tr').forEach(row => {
      const key = row.querySelector('th')?.textContent?.trim();
      const val = row.querySelector('td')?.textContent?.trim();
      if (key && val) specifications[key] = val;
    });

    document.querySelectorAll('#productDetails_detailBullets_sections1 tr').forEach(row => {
      const key = row.querySelector('th')?.textContent?.trim();
      const val = row.querySelector('td')?.textContent?.trim();
      if (key && val && !specifications[key]) specifications[key] = val;
    });

    let category = '';
    const breadcrumbs = document.querySelectorAll('#wayfinding-breadcrumbs_container li a');
    if (breadcrumbs.length) category = breadcrumbs[breadcrumbs.length - 1].textContent.trim();

    const description = getText('#productDescription p') || getText('#productDescription');
    const asin = location.href.match(/(?:dp|product)\/([A-Z0-9]{10})/i)?.[1] || '';

    let rating = '';
    const ratingEl = document.querySelector('#acrPopover .a-icon-alt');
    if (ratingEl) rating = ratingEl.textContent.trim();

    let reviewCount = '';
    const reviewEl = document.querySelector('#acrCustomerReviewText');
    if (reviewEl) reviewCount = reviewEl.textContent.replace(/[^0-9]/g, '');

    return {
      title, price, brand, features, images, specifications,
      category, description, asin, rating, reviewCount,
      url: location.href
    };
  }

  // Create toolbar
  const toolbar = document.createElement('div');
  toolbar.id = 'droplister-toolbar';
  toolbar.innerHTML = `
    <div class="dl-bar">
      <div class="dl-logo">DL</div>
      <div class="dl-info">
        <span class="dl-title">DropLister Pro</span>
        <span class="dl-price" id="dl-ebay-price">--</span>
      </div>
      <div class="dl-actions">
        <button class="dl-btn dl-btn-primary" id="dl-list-now">List on eBay</button>
        <button class="dl-btn dl-btn-secondary" id="dl-copy-data">Copy Data</button>
        <button class="dl-btn dl-btn-icon" id="dl-minimize" title="Minimize">_</button>
      </div>
    </div>
    <div class="dl-details" id="dl-details" style="display:none">
      <div class="dl-detail-row">
        <span>ASIN:</span><span id="dl-asin">--</span>
      </div>
      <div class="dl-detail-row">
        <span>Amazon Price:</span><span id="dl-amazon-price">--</span>
      </div>
      <div class="dl-detail-row">
        <span>eBay Price:</span><span id="dl-calc-price">--</span>
      </div>
      <div class="dl-detail-row">
        <span>Brand:</span><span id="dl-brand">--</span>
      </div>
      <div class="dl-detail-row">
        <span>Images:</span><span id="dl-images">--</span>
      </div>
      <div class="dl-detail-row">
        <span>VeRO Status:</span><span id="dl-vero">Checking...</span>
      </div>
      <div class="dl-detail-row">
        <span>Duplicate:</span><span id="dl-dup">Checking...</span>
      </div>
      <div class="dl-status" id="dl-status"></div>
    </div>
  `;
  document.body.appendChild(toolbar);

  let minimized = false;
  const detailsEl = document.getElementById('dl-details');

  document.getElementById('dl-minimize').addEventListener('click', () => {
    minimized = !minimized;
    toolbar.classList.toggle('dl-minimized', minimized);
  });

  toolbar.querySelector('.dl-bar').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    detailsEl.style.display = detailsEl.style.display === 'none' ? 'block' : 'none';
  });

  // Scrape and display
  const productData = scrapeProduct();

  document.getElementById('dl-asin').textContent = productData.asin || 'N/A';
  document.getElementById('dl-amazon-price').textContent = productData.price ? `$${productData.price}` : 'N/A';
  document.getElementById('dl-brand').textContent = productData.brand || 'Unknown';
  document.getElementById('dl-images').textContent = `${productData.images.length} found`;

  // Calculate eBay price
  chrome.runtime.sendMessage({ type: 'CALCULATE_PRICE', price: productData.price }, (resp) => {
    if (resp?.price) {
      document.getElementById('dl-ebay-price').textContent = `$${resp.price}`;
      document.getElementById('dl-calc-price').textContent = `$${resp.price}`;
    }
  });

  // Check VeRO
  chrome.runtime.sendMessage({ type: 'CHECK_VERO', title: productData.title, brand: productData.brand }, (resp) => {
    const veroEl = document.getElementById('dl-vero');
    if (resp?.safe) {
      veroEl.textContent = 'Safe';
      veroEl.style.color = '#4ade80';
    } else {
      veroEl.textContent = resp?.reason || 'Blocked';
      veroEl.style.color = '#f87171';
    }
  });

  // Check duplicate
  if (productData.asin) {
    chrome.runtime.sendMessage({ type: 'CHECK_DUPLICATE', sku: productData.asin }, (resp) => {
      const dupEl = document.getElementById('dl-dup');
      if (resp?.isDuplicate) {
        dupEl.textContent = 'Already Listed';
        dupEl.style.color = '#fbbf24';
      } else {
        dupEl.textContent = 'New Product';
        dupEl.style.color = '#4ade80';
      }
    });
  }

  // List on eBay button
  document.getElementById('dl-list-now').addEventListener('click', async () => {
    const statusEl = document.getElementById('dl-status');
    statusEl.textContent = 'Generating AI title...';
    statusEl.style.display = 'block';
    detailsEl.style.display = 'block';

    try {
      const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });

      // Check VeRO first
      if (settings.veroEnabled) {
        const vero = await chrome.runtime.sendMessage({
          type: 'CHECK_VERO', title: productData.title, brand: productData.brand
        });
        if (!vero.safe) {
          statusEl.textContent = `Blocked: ${vero.reason}`;
          statusEl.style.color = '#f87171';
          return;
        }
      }

      // Generate title
      statusEl.textContent = 'Generating AI title...';
      const titleResp = await chrome.runtime.sendMessage({
        type: 'GENERATE_TITLE', productData
      });

      // Generate description
      statusEl.textContent = 'Generating AI description...';
      const descResp = await chrome.runtime.sendMessage({
        type: 'GENERATE_DESCRIPTION', productData
      });

      // Calculate price
      const priceResp = await chrome.runtime.sendMessage({
        type: 'CALCULATE_PRICE', price: productData.price
      });

      const listingData = {
        ...productData,
        ebayTitle: titleResp?.title || productData.title,
        ebayDescription: descResp?.description || '',
        ebayPrice: priceResp?.price || '0.00',
        sku: productData.asin
      };

      statusEl.textContent = 'Opening eBay listing page...';

      // Store listing data and open eBay
      await chrome.runtime.sendMessage({
        type: 'OPEN_EBAY_LISTING',
        data: listingData
      });

      // Mark as listed
      if (productData.asin) {
        await chrome.runtime.sendMessage({ type: 'ADD_SKU', sku: productData.asin });
      }

      statusEl.textContent = 'Listing data sent to eBay!';
      statusEl.style.color = '#4ade80';
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.style.color = '#f87171';
    }
  });

  // Copy data button
  document.getElementById('dl-copy-data').addEventListener('click', () => {
    const data = JSON.stringify(productData, null, 2);
    navigator.clipboard.writeText(data).then(() => {
      const btn = document.getElementById('dl-copy-data');
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy Data', 1500);
    });
  });

})();

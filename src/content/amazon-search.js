// DropLister Pro - Amazon Search Page Content Script
// Adds quick-list buttons to search results

(function() {
  'use strict';

  if (document.getElementById('droplister-search-loaded')) return;
  const marker = document.createElement('div');
  marker.id = 'droplister-search-loaded';
  marker.style.display = 'none';
  document.body.appendChild(marker);

  function addListButtons() {
    const results = document.querySelectorAll('[data-asin]:not([data-dl-processed])');

    results.forEach(item => {
      const asin = item.getAttribute('data-asin');
      if (!asin || asin.length !== 10) return;
      item.setAttribute('data-dl-processed', 'true');

      const titleEl = item.querySelector('h2 a, .a-link-normal.s-no-outline');
      const priceEl = item.querySelector('.a-price .a-offscreen');
      const imgEl = item.querySelector('img.s-image');

      if (!titleEl) return;

      const btn = document.createElement('button');
      btn.className = 'dl-quick-list-btn';
      btn.textContent = 'List on eBay';
      btn.style.cssText = `
        display: inline-block;
        margin-top: 6px;
        padding: 5px 12px;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.2s;
      `;

      btn.addEventListener('mouseenter', () => btn.style.opacity = '0.8');
      btn.addEventListener('mouseleave', () => btn.style.opacity = '1');

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        btn.textContent = 'Processing...';
        btn.disabled = true;

        try {
          // Check duplicate first
          const dupCheck = await chrome.runtime.sendMessage({ type: 'CHECK_DUPLICATE', sku: asin });
          if (dupCheck?.isDuplicate) {
            btn.textContent = 'Already Listed';
            btn.style.background = '#78350f';
            return;
          }

          // Get the product URL
          const productUrl = titleEl.href || `https://www.amazon.com/dp/${asin}`;

          // Open product page in new tab, scrape, then list
          const tab = await chrome.tabs.create({ url: productUrl, active: false });

          btn.textContent = 'Scraping...';

          // Wait for page load
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

          // Send scrape request to background
          const productData = await chrome.runtime.sendMessage({ type: 'SCRAPE_PRODUCT' });

          if (productData) {
            // Generate AI content
            btn.textContent = 'AI Processing...';
            const titleResp = await chrome.runtime.sendMessage({ type: 'GENERATE_TITLE', productData });
            const descResp = await chrome.runtime.sendMessage({ type: 'GENERATE_DESCRIPTION', productData });
            const priceResp = await chrome.runtime.sendMessage({ type: 'CALCULATE_PRICE', price: productData.price });

            await chrome.runtime.sendMessage({
              type: 'OPEN_EBAY_LISTING',
              data: {
                ...productData,
                ebayTitle: titleResp?.title || productData.title,
                ebayDescription: descResp?.description || '',
                ebayPrice: priceResp?.price || '0.00',
                sku: asin
              }
            });

            await chrome.runtime.sendMessage({ type: 'ADD_SKU', sku: asin });
            btn.textContent = 'Listed!';
            btn.style.background = '#15803d';
          }

          chrome.tabs.remove(tab.id);
        } catch (err) {
          btn.textContent = 'Error';
          btn.style.background = '#991b1b';
          console.error('DropLister:', err);
        }
      });

      const parent = titleEl.closest('.a-section') || titleEl.parentElement;
      if (parent) parent.appendChild(btn);
    });
  }

  addListButtons();

  const observer = new MutationObserver(() => addListButtons());
  observer.observe(document.body, { childList: true, subtree: true });
})();

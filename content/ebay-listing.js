// DropLister Pro - eBay Listing Page Content Script
// Auto-fills eBay's sell form with product data from Amazon

(function() {
  'use strict';

  if (document.getElementById('droplister-ebay-loaded')) return;
  const marker = document.createElement('div');
  marker.id = 'droplister-ebay-loaded';
  marker.style.display = 'none';
  document.body.appendChild(marker);

  let listingData = null;

  async function init() {
    // Check for pending listing data
    listingData = await chrome.runtime.sendMessage({ type: 'GET_PENDING_LISTING' });
    if (!listingData) return;

    showOverlay('DropLister: Ready to fill listing');
    await chrome.runtime.sendMessage({ type: 'CLEAR_PENDING_LISTING' });

    // Wait for eBay's form to load
    await waitForElement('input[aria-label="Title"], #Title, input[name="title"]', 15000);
    await sleep(2000);

    fillListing(listingData);
  }

  // Also listen for direct messages from background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FILL_LISTING') {
      listingData = msg.data;
      fillListing(msg.data);
      sendResponse({ ok: true });
    }
  });

  async function fillListing(data) {
    const settings = data.settings || await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });

    showOverlay('Filling title...');

    // ─── Title ───
    const title = cleanTitle(data.ebayTitle || data.title);
    await fillInput('input[aria-label="Title"], #Title, input[name="title"], #s0-1-1-24-7-\\@title-\\@title-textbox', title);

    showOverlay('Filling price...');

    // ─── Price ───
    const price = data.ebayPrice || '0.00';
    await fillInput('input[aria-label="Price"], #Price, input[name="price"], input[aria-label="Buy It Now price"]', price);

    // ─── SKU ───
    if (data.sku) {
      await fillInput('input[aria-label="Custom label (SKU)"], input[name="sku"], input[aria-label="SKU"]', data.sku);
    }

    showOverlay('Uploading images...');

    // ─── Images ───
    if (data.images && data.images.length > 0) {
      await uploadImages(data.images.slice(0, 12));
    }

    showOverlay('Setting description...');

    // ─── Description ───
    if (data.ebayDescription) {
      await fillDescription(data.ebayDescription);
    }

    // ─── Item Specifics ───
    if (settings.fillRequiredSpecifics) {
      showOverlay('Filling item specifics with AI...');
      await fillItemSpecifics(data, settings);
    }

    // ─── Condition ───
    await setCondition('New');

    // ─── Quantity ───
    await fillInput('input[aria-label="Quantity"], input[name="quantity"]', '5');

    showOverlay('Listing filled! Review and submit.', 'success');
    setTimeout(() => hideOverlay(), 5000);
  }

  function cleanTitle(title) {
    if (!title) return '';
    // Remove Amazon-specific terms and limit to 80 chars
    return title
      .replace(/amazon/gi, '')
      .replace(/prime/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 80);
  }

  async function fillInput(selectors, value) {
    const sels = selectors.split(',').map(s => s.trim());
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el) {
        el.focus();
        el.value = '';
        // Use native input setter to trigger React's onChange
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, value);
        } else {
          el.value = value;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        await sleep(300);
        return true;
      }
    }
    return false;
  }

  async function fillDescription(html) {
    // Try iframe-based editor
    const iframe = document.querySelector('iframe[title="Description"], iframe.cke_wysiwyg_frame, #desc_ifr');
    if (iframe) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        doc.body.innerHTML = html;
        return;
      } catch (e) {}
    }

    // Try contenteditable div
    const editor = document.querySelector('[contenteditable="true"][aria-label*="escription"], .ql-editor, [role="textbox"][aria-label*="escription"]');
    if (editor) {
      editor.innerHTML = html;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    // Try textarea
    const textarea = document.querySelector('textarea[aria-label*="escription"], textarea[name="description"]');
    if (textarea) {
      textarea.value = html;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // Try clicking "HTML" tab first
    const htmlTab = Array.from(document.querySelectorAll('button, a, [role="tab"]')).find(el =>
      el.textContent.trim().toUpperCase() === 'HTML' || el.textContent.includes('Source')
    );
    if (htmlTab) {
      htmlTab.click();
      await sleep(500);
      const sourceArea = document.querySelector('textarea.cke_source, textarea[aria-label*="ource"]');
      if (sourceArea) {
        sourceArea.value = html;
        sourceArea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }

  async function uploadImages(imageUrls) {
    // eBay's image upload uses file input - we need to download images and create File objects
    const fileInput = document.querySelector('input[type="file"][accept*="image"], input[type="file"]');
    if (!fileInput) return;

    const files = [];
    for (const url of imageUrls) {
      try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        const filename = `product-${Date.now()}-${files.length}.jpg`;
        files.push(new File([blob], filename, { type: blob.type || 'image/jpeg' }));
      } catch (e) {
        console.warn('DropLister: Failed to download image:', url, e);
      }
    }

    if (files.length > 0) {
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  async function setCondition(condition) {
    // Try to find condition dropdown/button
    const condBtn = Array.from(document.querySelectorAll('button, [role="button"], [role="listbox"]')).find(el =>
      el.textContent.includes('Condition') || el.getAttribute('aria-label')?.includes('Condition')
    );
    if (condBtn) {
      condBtn.click();
      await sleep(500);
      const newOption = Array.from(document.querySelectorAll('[role="option"], li, button')).find(el =>
        el.textContent.trim() === condition || el.textContent.trim() === 'New'
      );
      if (newOption) newOption.click();
    }
  }

  async function fillItemSpecifics(data, settings) {
    // Find all required item specific fields
    const requiredFields = [];
    document.querySelectorAll('[data-testid*="item-specific"], .item-specific-row, [class*="itemSpecific"]').forEach(row => {
      const label = row.querySelector('label, .label, span')?.textContent?.trim();
      const input = row.querySelector('input, select, [role="combobox"]');
      if (label && input && !input.value) {
        const options = [];
        row.querySelectorAll('option, [role="option"]').forEach(opt => {
          if (opt.value && opt.value !== '') options.push(opt.textContent.trim());
        });
        requiredFields.push({ name: label, element: input, options });
      }
    });

    if (requiredFields.length === 0) return;

    // Call AI to fill specifics
    const specificsData = await chrome.runtime.sendMessage({
      type: 'GENERATE_ITEM_SPECIFICS',
      productData: data,
      requiredSpecifics: requiredFields.map(f => ({ name: f.name, options: f.options }))
    });

    if (specificsData?.specifics) {
      for (const field of requiredFields) {
        const value = specificsData.specifics[field.name];
        if (value && value !== 'N/A') {
          if (field.element.tagName === 'SELECT') {
            const option = Array.from(field.element.options).find(o =>
              o.text.toLowerCase() === value.toLowerCase()
            );
            if (option) {
              field.element.value = option.value;
              field.element.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else {
            await fillInput(`#${field.element.id}`, value);
          }
        }
      }
    }
  }

  // ─── UI Helpers ───
  function showOverlay(message, type = 'info') {
    let overlay = document.getElementById('dl-ebay-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'dl-ebay-overlay';
      document.body.appendChild(overlay);
    }
    const colors = {
      info: { bg: '#312e81', border: '#4338ca', text: '#c7d2fe' },
      success: { bg: '#14532d', border: '#15803d', text: '#bbf7d0' },
      error: { bg: '#7f1d1d', border: '#991b1b', text: '#fecaca' }
    };
    const c = colors[type] || colors.info;
    overlay.style.cssText = `
      position: fixed; top: 16px; right: 16px; z-index: 99999;
      padding: 12px 20px; border-radius: 10px;
      background: ${c.bg}; border: 1px solid ${c.border}; color: ${c.text};
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px; font-weight: 600;
      box-shadow: 0 4px 24px rgba(0,0,0,0.3);
      display: flex; align-items: center; gap: 8px;
    `;
    overlay.innerHTML = `<span style="font-size:16px">${type === 'success' ? '&#10004;' : '&#9881;'}</span> ${message}`;
  }

  function hideOverlay() {
    document.getElementById('dl-ebay-overlay')?.remove();
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const sels = selector.split(',').map(s => s.trim());
      const check = () => {
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el) return el;
        }
        return null;
      };

      const existing = check();
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = check();
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  // Start
  init();
})();

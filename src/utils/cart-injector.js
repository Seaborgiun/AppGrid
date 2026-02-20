/**
 * @fileoverview Cart injection strategies for Nuvemshop storefronts.
 * Tries three strategies in order of preference.
 */

/**
 * @typedef {Object} CartLineItem
 * @property {string|number} variantId
 * @property {number} quantity
 */

/**
 * Delay helper.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Show a toast message if the host page has a #cart-toast element.
 * @param {string} message
 */
function showToast(message) {
  const toast = document.getElementById('cart-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

/**
 * Strategy 1: Use window.NuvemshopCart API (modern stores).
 * @param {CartLineItem[]} items
 * @returns {Promise<boolean>} true if succeeded
 */
async function strategyNuvemshopCartApi(items) {
  if (
    typeof window === 'undefined' ||
    !window.NuvemshopCart ||
    typeof window.NuvemshopCart.add !== 'function'
  ) {
    return false;
  }
  try {
    for (const item of items) {
      if (!item.variantId || item.quantity <= 0) continue;
      await window.NuvemshopCart.add({
        variant_id: String(item.variantId),
        quantity: item.quantity,
      });
      await delay(300);
    }
    return true;
  } catch (err) {
    console.warn('[GradeAtacado] NuvemshopCart API failed:', err);
    return false;
  }
}

/**
 * Strategy 2: DOM manipulation – locate quantity inputs + add buttons on the page.
 * @param {CartLineItem[]} items
 * @returns {Promise<boolean>} true if at least one item was added
 */
async function strategyDomManipulation(items) {
  let added = 0;
  for (const item of items) {
    if (!item.variantId || item.quantity <= 0) continue;
    try {
      // Attempt to find variant select dropdown
      const variantSelect = /** @type {HTMLSelectElement|null} */ (
        document.querySelector(`select[data-variant-id="${item.variantId}"], select.js-product-variants`)
      );
      if (variantSelect) {
        const option = variantSelect.querySelector(`option[value="${item.variantId}"]`);
        if (option) {
          variantSelect.value = String(item.variantId);
          variantSelect.dispatchEvent(new Event('change', { bubbles: true }));
          await delay(300);
        }
      }

      // Find quantity input
      const qtyInput = /** @type {HTMLInputElement|null} */ (
        document.querySelector(
          `input[data-variant-id="${item.variantId}"], input.js-product-quantity, input[name="quantity"]`
        )
      );
      if (qtyInput) {
        qtyInput.value = String(item.quantity);
        qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
        qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
        await delay(100);
      }

      // Click add-to-cart button
      const addBtn = /** @type {HTMLButtonElement|null} */ (
        document.querySelector(
          `button[data-variant-id="${item.variantId}"], button.js-add-to-cart, button[name="add"]`
        )
      );
      if (addBtn) {
        addBtn.click();
        added++;
        await delay(300);
      }
    } catch (err) {
      console.warn(`[GradeAtacado] DOM strategy failed for variantId ${item.variantId}:`, err);
    }
  }
  return added > 0;
}

/**
 * Strategy 3: Redirect to /cart/add with query params.
 * @param {CartLineItem[]} items
 * @returns {Promise<boolean>}
 */
async function strategyRedirect(items) {
  if (typeof window === 'undefined') return false;
  const params = items
    .filter((i) => i.variantId && i.quantity > 0)
    .map((i) => `items[]=${i.variantId}:${i.quantity}`)
    .join('&');
  if (!params) return false;
  window.location.href = `/cart/add?${params}`;
  return true;
}

/**
 * Add items to cart using the best available strategy.
 * Dispatches a 'grade-atacado:cart-updated' custom event on success.
 *
 * @param {CartLineItem[]} items - Items to add to cart
 * @returns {Promise<void>}
 */
export async function addToCartBulk(items) {
  const validItems = items.filter(
    (i) => i && (i.variantId !== undefined && i.variantId !== null) && i.quantity > 0
  );
  if (validItems.length === 0) return;

  let success = false;

  // Strategy 1: NuvemshopCart API
  success = await strategyNuvemshopCartApi(validItems);

  // Strategy 2: DOM manipulation
  if (!success) {
    success = await strategyDomManipulation(validItems);
  }

  // Strategy 3: Redirect
  if (!success) {
    success = await strategyRedirect(validItems);
  }

  if (success) {
    const totalQty = validItems.reduce((sum, i) => sum + i.quantity, 0);
    const message = `${totalQty} produto(s) adicionado(s) ao carrinho!`;
    showToast(message);

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent('grade-atacado:cart-updated', {
          detail: { items: validItems, totalQty },
          bubbles: true,
        })
      );
    }
  }
}

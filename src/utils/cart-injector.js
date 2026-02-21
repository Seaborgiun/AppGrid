/**
 * @fileoverview Estratégias de injeção de itens no carrinho da Nuvemshop.
 * Tenta três estratégias em ordem de preferência.
 */

/**
 * @typedef {Object} CartLineItem
 * @property {string|number} variantId
 * @property {number} quantity
 */

/**
 * Aguarda o número de milissegundos informado.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exibe uma mensagem toast se a página hospedeira tiver um elemento #cart-toast.
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
 * Estratégia 1: Utiliza a API window.NuvemshopCart (lojas modernas).
 * @param {CartLineItem[]} items
 * @returns {Promise<boolean>} true se bem-sucedido
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
    console.warn('[GradeAtacado] Falha na API NuvemshopCart:', err);
    return false;
  }
}

/**
 * Estratégia 2: Manipulação do DOM – localiza inputs de quantidade e botões de adição na página.
 * @param {CartLineItem[]} items
 * @returns {Promise<boolean>} true se ao menos um item foi adicionado
 */
async function strategyDomManipulation(items) {
  let added = 0;
  for (const item of items) {
    if (!item.variantId || item.quantity <= 0) continue;
    try {
      // Tenta localizar o dropdown de seleção de variação
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

      // Localiza o campo de quantidade
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

      // Clica no botão de adicionar ao carrinho
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
      console.warn(`[GradeAtacado] Falha na estratégia DOM para variantId ${item.variantId}:`, err);
    }
  }
  return added > 0;
}

/**
 * Estratégia 3: Redireciona para /cart/add com parâmetros na URL.
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
 * Adiciona itens ao carrinho utilizando a melhor estratégia disponível.
 * Dispara o evento customizado 'grade-atacado:cart-updated' em caso de sucesso.
 *
 * @param {CartLineItem[]} items - Itens a serem adicionados ao carrinho
 * @returns {Promise<void>}
 */
export async function addToCartBulk(items) {
  const validItems = items.filter(
    (i) => i && (i.variantId !== undefined && i.variantId !== null) && i.quantity > 0
  );
  if (validItems.length === 0) return;

  let success = false;

  // Estratégia 1: API NuvemshopCart
  success = await strategyNuvemshopCartApi(validItems);

  // Estratégia 2: Manipulação do DOM
  if (!success) {
    success = await strategyDomManipulation(validItems);
  }

  // Estratégia 3: Redirecionamento
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

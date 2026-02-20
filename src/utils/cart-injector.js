/**
 * cart-injector.js - Script vanilla para injetar itens no carrinho da Nuvemshop
 *
 * Não tem acesso ao backend. Todos os dados vêm do widget frontend.
 * Injetado via Script tag na storefront da loja.
 */

(function (window) {
  'use strict';

  var DELAY_BETWEEN_ITEMS_MS = 300;

  /**
   * Aguarda um número de milissegundos antes de continuar
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Exibe um toast de confirmação se o elemento #cart-toast existir
   * @param {string} message
   */
  function showToast(message) {
    var toast = document.getElementById('cart-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(function () {
      toast.style.display = 'none';
    }, 3000);
  }

  /**
   * Dispara o evento customizado 'grade-atacado:cart-updated'
   * @param {Array<{variantId: string|number, quantity: number}>} addedItems
   */
  function dispatchCartUpdatedEvent(addedItems) {
    var event = new CustomEvent('grade-atacado:cart-updated', {
      bubbles: true,
      detail: { items: addedItems },
    });
    document.dispatchEvent(event);
  }

  /**
   * Estratégia 1: Usar API interna window.NuvemshopCart (se disponível)
   * @param {Array<{variantId: string|number, quantity: number}>} items
   * @returns {Promise<boolean>} true se bem-sucedido
   */
  async function tryNuvemshopCartAPI(items) {
    if (!window.NuvemshopCart || typeof window.NuvemshopCart.add !== 'function') {
      return false;
    }

    try {
      var cartItems = items.map(function (item) {
        return { variant_id: item.variantId, quantity: item.quantity };
      });
      await window.NuvemshopCart.add(cartItems);
      return true;
    } catch (err) {
      console.warn('[GradeAtacado] Erro ao usar NuvemshopCart.add:', err);
      return false;
    }
  }

  /**
   * Estratégia 2: Simular cliques programáticos nos elementos nativos de compra
   * @param {Array<{variantId: string|number, quantity: number}>} items
   * @returns {Promise<boolean>} true se pelo menos um item foi adicionado
   */
  async function tryProgrammaticClicks(items) {
    var addedAny = false;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var variantId = String(item.variantId);

      try {
        // Tentar selecionar a variação nos dropdowns nativos
        var selects = document.querySelectorAll('select[data-variant], select[name="variant_id"]');
        var variantSelected = false;

        for (var j = 0; j < selects.length; j++) {
          var select = selects[j];
          for (var k = 0; k < select.options.length; k++) {
            if (select.options[k].value === variantId) {
              select.value = variantId;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              variantSelected = true;
              break;
            }
          }
          if (variantSelected) break;
        }

        // Preencher campo de quantidade
        var qtyInput = document.querySelector(
          'input[name="quantity"], input[data-quantity], input#quantity'
        );
        if (qtyInput) {
          qtyInput.value = String(item.quantity);
          qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
          qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Disparar clique no botão "Adicionar ao Carrinho"
        var addBtn = document.querySelector(
          'button[data-add-to-cart], button[name="add"], #add-to-cart-btn, .js-add-to-cart'
        );
        if (addBtn) {
          addBtn.click();
          addedAny = true;
        }

        // Aguardar entre itens para evitar race conditions
        if (i < items.length - 1) {
          await sleep(DELAY_BETWEEN_ITEMS_MS);
        }
      } catch (err) {
        console.warn('[GradeAtacado] Erro ao simular clique para variante ' + variantId + ':', err);
      }
    }

    return addedAny;
  }

  /**
   * Estratégia 3: Redirecionar para /cart/add com query string
   * @param {Array<{variantId: string|number, quantity: number}>} items
   */
  function tryCartRedirect(items) {
    var params = items
      .map(function (item) {
        return 'items[]=' + encodeURIComponent(item.variantId + ':' + item.quantity);
      })
      .join('&');

    window.location.href = '/cart/add?' + params;
  }

  /**
   * Adiciona múltiplos itens ao carrinho da Nuvemshop com 3 estratégias de fallback
   *
   * @param {Array<{variantId: string|number, quantity: number}>} items - Itens a adicionar
   * @returns {Promise<void>}
   */
  async function addToCartBulk(items) {
    if (!Array.isArray(items) || items.length === 0) {
      console.warn('[GradeAtacado] addToCartBulk: nenhum item fornecido');
      return;
    }

    // Filtrar itens inválidos
    var validItems = items.filter(function (item) {
      if (!item.variantId) {
        console.warn('[GradeAtacado] Item sem variantId ignorado:', item);
        return false;
      }
      if (!item.quantity || item.quantity <= 0) {
        console.warn('[GradeAtacado] Item com quantidade inválida ignorado:', item);
        return false;
      }
      return true;
    });

    if (validItems.length === 0) {
      console.warn('[GradeAtacado] Nenhum item válido para adicionar ao carrinho');
      return;
    }

    var successMessage =
      validItems.length === 1
        ? '1 item adicionado ao carrinho!'
        : validItems.length + ' itens adicionados ao carrinho!';

    // Estratégia 1: API interna NuvemshopCart
    var strategy1Success = await tryNuvemshopCartAPI(validItems);
    if (strategy1Success) {
      dispatchCartUpdatedEvent(validItems);
      showToast(successMessage);
      return;
    }

    // Estratégia 2: Cliques programáticos
    var strategy2Success = await tryProgrammaticClicks(validItems);
    if (strategy2Success) {
      dispatchCartUpdatedEvent(validItems);
      showToast(successMessage);
      return;
    }

    // Estratégia 3: Redirecionamento para /cart/add
    console.info('[GradeAtacado] Usando fallback de redirecionamento para /cart/add');
    tryCartRedirect(validItems);
  }

  // Expor globalmente na página da loja
  window.GradeAtacado = window.GradeAtacado || {};
  window.GradeAtacado.addToCartBulk = addToCartBulk;
})(window);

import React from 'react';
import { createRoot } from 'react-dom/client';
import VariantGrid from './components/VariantGrid/VariantGrid';
import { addToCartBulk } from './utils/cart-injector';
import type { FormattedVariant, CartItem } from '../types/nuvemshop';

interface WidgetMountOptions {
  productId: string;
  apiUrl: string;
  container: HTMLElement;
}

async function fetchVariants(
  apiUrl: string,
  productId: string
): Promise<FormattedVariant[]> {
  const url = `${apiUrl.replace(/\/$/, '')}/api/products/${productId}/variants`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`Falha ao buscar variações: HTTP ${res.status}`);
  }
  return res.json() as Promise<FormattedVariant[]>;
}

function LoadingSpinner() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '32px',
        color: '#6b7280',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <span>Carregando grade de atacado…</span>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: '16px',
        background: '#fef2f2',
        border: '1px solid #fca5a5',
        borderRadius: '6px',
        color: '#b91c1c',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
      }}
    >
      <strong>Erro ao carregar Grade de Atacado:</strong> {message}
    </div>
  );
}

function WidgetApp({
  productId,
  apiUrl,
}: {
  productId: string;
  apiUrl: string;
}) {
  const [variants, setVariants] = React.useState<FormattedVariant[] | null>(
    null
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchVariants(apiUrl, productId)
      .then((data) => {
        if (!cancelled) setVariants(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, apiUrl]);

  const handleBulkAdd = React.useCallback((items: CartItem[]) => {
    addToCartBulk(
      items.map((i) => ({ variantId: i.variantId, quantity: i.quantity }))
    ).catch((err: Error) => {
      console.error('[GradeAtacado] Erro ao injetar no carrinho:', err);
    });
  }, []);

  if (error) return <ErrorMessage message={error} />;
  if (!variants) return <LoadingSpinner />;

  return <VariantGrid variants={variants} onBulkAdd={handleBulkAdd} />;
}

/**
 * Monta o widget em um único elemento contêiner.
 */
function mountWidget({ productId, apiUrl, container }: WidgetMountOptions) {
  const root = createRoot(container);
  root.render(<WidgetApp productId={productId} apiUrl={apiUrl} />);
}

/**
 * Detecta e monta automaticamente todos os elementos [data-grade-atacado] na página.
 */
function autoMount() {
  const containers = document.querySelectorAll<HTMLElement>(
    '[data-grade-atacado]'
  );
  containers.forEach((el) => {
    const productId = el.getAttribute('data-product-id');
    const apiUrl =
      el.getAttribute('data-api-url') || window.location.origin;
    if (!productId) {
      console.warn('[GradeAtacado] Atributo data-product-id ausente', el);
      return;
    }
    mountWidget({ productId, apiUrl, container: el });
  });
}

// Monta automaticamente quando o DOM estiver pronto
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }
}

export { mountWidget, autoMount };

import type { NubeSDK, NubeSDKState } from '@tiendanube/nube-sdk-types';
import type { NubeComponentBox, NubeComponentText } from '@tiendanube/nube-sdk-types';

/**
 * Entry point do widget AppGrid para o NubeSDK (Patagonia).
 * Compatível com temas Patagonia da Nuvemshop/Tiendanube.
 *
 * Uso no manifest.json:
 *   "script": "dist-widget/nube-sdk-main.js"
 */
export function App(nube: NubeSDK): void {
  const apiUrl = (process.env.WIDGET_API_URL ?? '').replace(/\/$/, '');

  function buildWidget(productId: string): NubeComponentBox {
    const label: NubeComponentText = {
      type: 'txt',
      children: `AppGrid Atacado — carregando grade para produto ${productId}`,
    };
    return {
      type: 'box',
      id: 'appgrid-atacado',
      children: label,
    };
  }

  function renderForState(state: Readonly<NubeSDKState>): NubeComponentBox | NubeComponentBox[] {
    const productId = String((state as NubeSDKState & { product?: { id: number } }).product?.id ?? '');
    return buildWidget(productId);
  }

  // Aguarda o carregamento da página para inicializar o widget
  nube.on('page:loaded', () => {
    nube.render('after_product_detail_add_to_cart', renderForState);
  });

  // Re-renderiza ao navegar entre produtos (SPA)
  nube.on('location:updated', () => {
    nube.render('after_product_detail_add_to_cart', renderForState);
  });

  // Escuta adição ao carrinho para feedback visual
  nube.on('cart:add:success', () => {
    console.info('[AppGrid NubeSDK] Item adicionado ao carrinho com sucesso.');
  });

  void apiUrl; // TODO: use in fetch call when full NubeSDK rendering is implemented
}

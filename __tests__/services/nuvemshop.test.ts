/**
 * @jest-environment node
 */
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { NuvemshopAPIService } from '../../src/services/nuvemshop';
import type { NuvemshopVariant, NuvemshopAttribute } from '../../types/nuvemshop';

// ─── Dados de teste ───────────────────────────────────────────────────────────

const mockVariant: NuvemshopVariant = {
  id: 101,
  sku: 'CAMISETA-P-AZUL',
  price: '49.90',
  promotional_price: '39.90',
  stock_management: true,
  stock: 10,
  weight: '0.3',
  values: [
    { en: 'Blue', pt: 'Azul', es: 'Azul' },
    { en: 'Small', pt: 'P', es: 'P' },
  ],
  image_id: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-15T00:00:00Z',
};

const mockAttributes: NuvemshopAttribute[] = [
  { en: 'Color', pt: 'Cor', es: 'Color' },
  { en: 'Size', pt: 'Tamanho', es: 'Talla' },
];

// ─── Servidor MSW ─────────────────────────────────────────────────────────────

const BASE = 'https://api.nuvemshop.com.br';
const USER_ID = 42;

let rateLimitCallCount = 0;

const server = setupServer(
  // Endpoint de token OAuth
  http.post('https://www.nuvemshop.com.br/apps/authorize/token', () => {
    return HttpResponse.json({
      access_token: 'test-token-abc',
      token_type: 'bearer',
      scope: 'read_products write_orders',
      user_id: USER_ID,
    });
  }),

  // Endpoint de variações – primeira página
  http.get(`${BASE}/v1/${USER_ID}/products/1/variants`, ({ request }) => {
    const url = new URL(request.url);
    const page = url.searchParams.get('page') ?? '1';
    return HttpResponse.json(page === '1' ? [mockVariant] : []);
  }),

  // Endpoint de variações – rate limit nas duas primeiras chamadas, sucesso na terceira
  http.get(`${BASE}/v1/${USER_ID}/products/999/variants`, () => {
    rateLimitCallCount++;
    if (rateLimitCallCount < 3) {
      return new HttpResponse(null, { status: 429 });
    }
    return HttpResponse.json([mockVariant]);
  }),

  // Endpoint de busca por SKU
  http.get(`${BASE}/v1/${USER_ID}/products/variants`, ({ request }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') ?? '';
    const results = q ? [mockVariant] : [];
    return HttpResponse.json(results);
  })
);

// ─── Configuração / encerramento ─────────────────────────────────────────────

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => {
  server.resetHandlers();
  rateLimitCallCount = 0;
});
afterAll(() => server.close());

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('NuvemshopAPIService – testes do serviço', () => {
  let service: NuvemshopAPIService;

  beforeEach(() => {
    service = new NuvemshopAPIService({
      baseURL: BASE,
      accessToken: 'test-token',
      userId: USER_ID,
    });
  });

  // ── OAuth ──────────────────────────────────────────────────────────────────

  test('authenticate() troca o código de autorização pelo token de acesso', async () => {
    const token = await service.authenticate(
      'auth-code-xyz',
      'client-id',
      'client-secret',
      'https://app.example.com/auth/callback'
    );

    expect(token.access_token).toBe('test-token-abc');
    expect(token.user_id).toBe(USER_ID);
    expect(token.token_type).toBe('bearer');
  });

  // ── getProductVariants ─────────────────────────────────────────────────────

  test('getProductVariants() retorna array de variações', async () => {
    const variants = await service.getProductVariants('1');

    expect(Array.isArray(variants)).toBe(true);
    expect(variants).toHaveLength(1);
    expect(variants[0].id).toBe(101);
    expect(variants[0].sku).toBe('CAMISETA-P-AZUL');
  });

  test('getProductVariants() aceita parâmetro de página', async () => {
    const page2 = await service.getProductVariants('1', 2);
    expect(page2).toHaveLength(0);
  });

  // ── Retry por rate limit ───────────────────────────────────────────────────

  test('getProductVariants() tenta novamente em 429 com backoff exponencial', async () => {
    // Acelera o teste sobrescrevendo o sleep
    const sleepSpy = jest
      .spyOn(service as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep')
      .mockResolvedValue(undefined);

    const variants = await service.getProductVariants('999');

    expect(variants).toHaveLength(1);
    expect(sleepSpy).toHaveBeenCalledTimes(2); // duas respostas 429
    expect(sleepSpy).toHaveBeenNthCalledWith(1, 500);  // 500ms * 2^0
    expect(sleepSpy).toHaveBeenNthCalledWith(2, 1000); // 500ms * 2^1
  });

  // ── formatVariantForGrid ───────────────────────────────────────────────────

  test('formatVariantForGrid() retorna o formato correto', () => {
    const formatted = service.formatVariantForGrid(mockVariant, mockAttributes);

    expect(formatted).toMatchObject({
      variantId: 101,
      sku: 'CAMISETA-P-AZUL',
      option1: 'Cor',
      value1: 'Azul',
      option2: 'Tamanho',
      value2: 'P',
      stock: 10,
      price: 49.9,
      promotionalPrice: 39.9,
      imageUrl: null,
    });
  });

  test('formatVariantForGrid() gera SKU a partir do id quando sku é null', () => {
    const noSku = { ...mockVariant, sku: null };
    const formatted = service.formatVariantForGrid(noSku, mockAttributes);
    expect(formatted.sku).toBe('variant-101');
  });

  test('formatVariantForGrid() trata promotional_price ausente', () => {
    const noPromo = { ...mockVariant, promotional_price: null };
    const formatted = service.formatVariantForGrid(noPromo, mockAttributes);
    expect(formatted.promotionalPrice).toBeNull();
  });

  // ── searchVariantsBySku (com cache) ──────────────────────────────────────

  test('searchVariantsBySku() retorna variações correspondentes', async () => {
    const results = await service.searchVariantsBySku('CAMISETA');

    expect(results).toHaveLength(1);
    expect(results[0].sku).toBe('CAMISETA-P-AZUL');
  });

  test('searchVariantsBySku() retorna resultado em cache na segunda chamada', async () => {
    // Primeira chamada vai à rede
    await service.searchVariantsBySku('CAMISETA');

    // Intercepta e bloqueia a rede – deve servir do cache
    server.use(
      http.get(`${BASE}/v1/${USER_ID}/products/variants`, () => {
        throw new Error('Não deveria ser chamado – o cache deve responder');
      })
    );

    const cached = await service.searchVariantsBySku('CAMISETA');
    expect(cached).toHaveLength(1);
  });
});

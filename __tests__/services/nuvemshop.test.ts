/**
 * @jest-environment node
 */
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { NuvemshopAPIService } from '../../src/services/nuvemshop';
import type { NuvemshopVariant, NuvemshopAttribute } from '../../types/nuvemshop';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

// ─── MSW Server ───────────────────────────────────────────────────────────────

const BASE = 'https://api.nuvemshop.com.br';
const USER_ID = 42;

let rateLimitCallCount = 0;

const server = setupServer(
  // OAuth token endpoint
  http.post('https://www.nuvemshop.com.br/apps/authorize/token', () => {
    return HttpResponse.json({
      access_token: 'test-token-abc',
      token_type: 'bearer',
      scope: 'read_products write_orders',
      user_id: USER_ID,
    });
  }),

  // Variants endpoint – first page
  http.get(`${BASE}/v1/${USER_ID}/products/1/variants`, ({ request }) => {
    const url = new URL(request.url);
    const page = url.searchParams.get('page') ?? '1';
    return HttpResponse.json(page === '1' ? [mockVariant] : []);
  }),

  // Variants endpoint – rate limit on first two calls, success on third
  http.get(`${BASE}/v1/${USER_ID}/products/999/variants`, () => {
    rateLimitCallCount++;
    if (rateLimitCallCount < 3) {
      return new HttpResponse(null, { status: 429 });
    }
    return HttpResponse.json([mockVariant]);
  }),

  // SKU search endpoint
  http.get(`${BASE}/v1/${USER_ID}/products/variants`, ({ request }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') ?? '';
    const results = q ? [mockVariant] : [];
    return HttpResponse.json(results);
  })
);

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => {
  server.resetHandlers();
  rateLimitCallCount = 0;
});
afterAll(() => server.close());

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NuvemshopAPIService', () => {
  let service: NuvemshopAPIService;

  beforeEach(() => {
    service = new NuvemshopAPIService({
      baseURL: BASE,
      accessToken: 'test-token',
      userId: USER_ID,
    });
  });

  // ── OAuth ──────────────────────────────────────────────────────────────────

  test('authenticate() exchanges code for access token', async () => {
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

  test('getProductVariants() returns array of variants', async () => {
    const variants = await service.getProductVariants('1');

    expect(Array.isArray(variants)).toBe(true);
    expect(variants).toHaveLength(1);
    expect(variants[0].id).toBe(101);
    expect(variants[0].sku).toBe('CAMISETA-P-AZUL');
  });

  test('getProductVariants() accepts page parameter', async () => {
    const page2 = await service.getProductVariants('1', 2);
    expect(page2).toHaveLength(0);
  });

  // ── Rate limit retry ───────────────────────────────────────────────────────

  test('getProductVariants() retries on 429 with exponential backoff', async () => {
    // Speed up the test by overriding the sleep
    const sleepSpy = jest
      .spyOn(service as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep')
      .mockResolvedValue(undefined);

    const variants = await service.getProductVariants('999');

    expect(variants).toHaveLength(1);
    expect(sleepSpy).toHaveBeenCalledTimes(2); // two 429 responses
    expect(sleepSpy).toHaveBeenNthCalledWith(1, 500);  // 500ms * 2^0
    expect(sleepSpy).toHaveBeenNthCalledWith(2, 1000); // 500ms * 2^1
  });

  // ── formatVariantForGrid ───────────────────────────────────────────────────

  test('formatVariantForGrid() returns correct shape', () => {
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

  test('formatVariantForGrid() generates SKU from id when sku is null', () => {
    const noSku = { ...mockVariant, sku: null };
    const formatted = service.formatVariantForGrid(noSku, mockAttributes);
    expect(formatted.sku).toBe('variant-101');
  });

  test('formatVariantForGrid() handles missing promotional_price', () => {
    const noPromo = { ...mockVariant, promotional_price: null };
    const formatted = service.formatVariantForGrid(noPromo, mockAttributes);
    expect(formatted.promotionalPrice).toBeNull();
  });

  // ── searchVariantsBySku (with cache) ──────────────────────────────────────

  test('searchVariantsBySku() returns matching variants', async () => {
    const results = await service.searchVariantsBySku('CAMISETA');

    expect(results).toHaveLength(1);
    expect(results[0].sku).toBe('CAMISETA-P-AZUL');
  });

  test('searchVariantsBySku() returns cached result on second call', async () => {
    // First call fetches from network
    await service.searchVariantsBySku('CAMISETA');

    // Intercept and block network – cache should serve
    server.use(
      http.get(`${BASE}/v1/${USER_ID}/products/variants`, () => {
        throw new Error('Should not be called – cache should be hit');
      })
    );

    const cached = await service.searchVariantsBySku('CAMISETA');
    expect(cached).toHaveLength(1);
  });
});

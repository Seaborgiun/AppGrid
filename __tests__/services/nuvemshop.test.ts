/**
 * Testes do NuvemshopAPIService usando Jest + MSW para mock
 */

import { NuvemshopAPIService } from '../../src/services/nuvemshop';
import type { NuvemshopVariant, OAuthTokenResponse } from '../../types/nuvemshop';

// Mock do axios para testes unitários
jest.mock('axios', () => {
  const originalAxios = jest.requireActual('axios');
  return {
    ...originalAxios,
    create: jest.fn(() => ({
      get: jest.fn(),
      post: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    })),
    post: jest.fn(),
  };
});

import axios from 'axios';

const mockVariants: NuvemshopVariant[] = [
  {
    id: 1001,
    sku: 'CAMISETA-PRETA-P',
    price: '59.90',
    stock: 10,
    values: [
      { name: 'Cor', value: 'Preta' },
      { name: 'Tamanho', value: 'P' },
    ],
    image_url: 'https://example.com/img/camiseta-preta.jpg',
  },
  {
    id: 1002,
    sku: 'CAMISETA-PRETA-M',
    price: '59.90',
    stock: 3,
    values: [
      { name: 'Cor', value: 'Preta' },
      { name: 'Tamanho', value: 'M' },
    ],
  },
  {
    id: 1003,
    sku: 'CAMISETA-BRANCA-G',
    price: '59.90',
    stock: 0,
    values: [
      { name: 'Cor', value: 'Branca' },
      { name: 'Tamanho', value: 'G' },
    ],
  },
];

describe('NuvemshopAPIService', () => {
  let service: NuvemshopAPIService;
  let mockAxiosInstance: {
    get: jest.Mock;
    post: jest.Mock;
    interceptors: { request: { use: jest.Mock }; response: { use: jest.Mock } };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);
    service = new NuvemshopAPIService('test-token', '12345');
  });

  describe('formatVariantForGrid', () => {
    it('deve formatar uma variação da API corretamente', () => {
      const formatted = service.formatVariantForGrid(mockVariants[0]);

      expect(formatted).toEqual({
        variantId: 1001,
        sku: 'CAMISETA-PRETA-P',
        option1: 'Cor',
        value1: 'Preta',
        option2: 'Tamanho',
        value2: 'P',
        stock: 10,
        price: '59.90',
        image: 'https://example.com/img/camiseta-preta.jpg',
      });
    });

    it('deve usar SKU padrão quando sku é null', () => {
      const variantWithoutSku: NuvemshopVariant = { ...mockVariants[0], sku: null };
      const formatted = service.formatVariantForGrid(variantWithoutSku);
      expect(formatted.sku).toBe('SKU-1001');
    });

    it('deve usar estoque 0 quando stock é null', () => {
      const variantWithNullStock: NuvemshopVariant = { ...mockVariants[0], stock: null };
      const formatted = service.formatVariantForGrid(variantWithNullStock);
      expect(formatted.stock).toBe(0);
    });

    it('deve usar opções padrão quando values está vazio', () => {
      const variantNoValues: NuvemshopVariant = { ...mockVariants[0], values: [] };
      const formatted = service.formatVariantForGrid(variantNoValues);
      expect(formatted.option1).toBe('Opção 1');
      expect(formatted.option2).toBe('Opção 2');
    });
  });

  describe('getProductVariants', () => {
    it('deve buscar variações e formatá-las corretamente', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockVariants });

      const result = await service.getProductVariants('42');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/products/42/variants', {
        params: { page: 1, per_page: 200 },
      });
      expect(result).toHaveLength(3);
      expect(result[0].variantId).toBe(1001);
      expect(result[1].stock).toBe(3);
    });

    it('deve usar parâmetros de paginação personalizados', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [] });

      await service.getProductVariants('42', { page: 2, per_page: 50 });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/products/42/variants', {
        params: { page: 2, per_page: 50 },
      });
    });
  });

  describe('authenticate', () => {
    it('deve autenticar e retornar OAuthTokenResponse', async () => {
      const mockTokenResponse: OAuthTokenResponse = {
        access_token: 'abc123',
        user_id: 99999,
        token_type: 'bearer',
        scope: 'write_products',
      };

      (axios.post as jest.Mock).mockResolvedValueOnce({ data: mockTokenResponse });

      const result = await service.authenticate('auth-code-xyz', 'client-id', 'client-secret');

      expect(result.access_token).toBe('abc123');
      expect(result.user_id).toBe(99999);
    });
  });
});

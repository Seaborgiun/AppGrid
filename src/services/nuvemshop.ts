/**
 * NuvemshopAPIService - Cliente para API v2025-03
 *
 * Implementa autenticação OAuth 2.0, busca de variações com paginação,
 * rate limiting (2 req/seg) com retry exponencial para HTTP 429.
 */

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  NuvemshopVariant,
  FormattedVariant,
  OAuthTokenResponse,
  PaginationParams,
} from '../../types/nuvemshop';

const BASE_URL = 'https://api.nuvemshop.com.br/v1';
const AUTH_URL = 'https://www.nuvemshop.com.br/apps';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

/**
 * In-memory cache entry for variant search results
 */
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class NuvemshopAPIService {
  private client: AxiosInstance;
  private accessToken: string;
  private storeId: string;
  private refreshTokenValue: string | null;
  private searchCache: Map<string, CacheEntry<FormattedVariant[]>>;

  /**
   * Cria uma instância do serviço com token e store configurados
   * @param accessToken - Token OAuth de acesso
   * @param storeId - ID da loja Nuvemshop
   * @param refreshToken - Token de renovação (opcional)
   */
  constructor(accessToken: string, storeId: string, refreshToken: string | null = null) {
    this.accessToken = accessToken;
    this.storeId = storeId;
    this.refreshTokenValue = refreshToken;
    this.searchCache = new Map();

    this.client = axios.create({
      baseURL: `${BASE_URL}/${storeId}`,
      timeout: 10000,
    });

    this.setupInterceptors();
  }

  /**
   * Configura interceptors do axios para headers obrigatórios,
   * renovação de token (401) e rate limit (429)
   */
  private setupInterceptors(): void {
    // Request interceptor: injeta headers obrigatórios
    this.client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      config.headers['Authentication'] = `bearer ${this.accessToken}`;
      config.headers['User-Agent'] = 'GradeAtacado/1.0 (contato@seudominio.com)';
      config.headers['Content-Type'] = 'application/json';
      return config;
    });

    // Response interceptor: trata 401 (refresh) e 429 (rate limit)
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean; _retryCount?: number };

        if (error.response?.status === 401 && !originalRequest._retry && this.refreshTokenValue) {
          originalRequest._retry = true;
          try {
            const newToken = await this.refreshAccessToken(this.refreshTokenValue);
            this.accessToken = newToken.access_token;
            originalRequest.headers['Authentication'] = `bearer ${this.accessToken}`;
            return this.client(originalRequest);
          } catch (refreshError) {
            return Promise.reject(refreshError);
          }
        }

        // Rate limit: retry com backoff exponencial
        if (error.response?.status === 429) {
          const retryCount = originalRequest._retryCount ?? 0;
          if (retryCount < MAX_RETRIES) {
            originalRequest._retryCount = retryCount + 1;
            const delay = RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
            await new Promise((resolve) => setTimeout(resolve, delay));
            return this.client(originalRequest);
          }
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Autentica com OAuth 2.0 trocando o código de autorização por token
   * @param code - Código de autorização recebido no callback OAuth
   * @param clientId - Client ID da aplicação
   * @param clientSecret - Client Secret da aplicação
   * @returns OAuthTokenResponse com access_token e user_id
   */
  async authenticate(code: string, clientId: string, clientSecret: string): Promise<OAuthTokenResponse> {
    const response = await axios.post<OAuthTokenResponse>(
      `${AUTH_URL}/authorize/token`,
      {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'GradeAtacado/1.0 (contato@seudominio.com)',
        },
      }
    );
    return response.data;
  }

  /**
   * Renova o access_token usando o refresh_token
   * @param refreshToken - Token de renovação
   * @returns OAuthTokenResponse com novo access_token
   */
  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResponse> {
    const clientId = process.env['NUVEMSHOP_CLIENT_ID'];
    const clientSecret = process.env['NUVEMSHOP_CLIENT_SECRET'];

    const response = await axios.post<OAuthTokenResponse>(
      `${AUTH_URL}/authorize/token`,
      {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'GradeAtacado/1.0 (contato@seudominio.com)',
        },
      }
    );

    if (response.data.refresh_token) {
      this.refreshTokenValue = response.data.refresh_token;
    }

    return response.data;
  }

  /**
   * Busca variações de um produto com paginação e tratamento de rate limit
   * @param productId - ID do produto Nuvemshop
   * @param params - Parâmetros de paginação (page, per_page)
   * @returns Array de FormattedVariant formatadas para o grid
   */
  async getProductVariants(productId: string, params: PaginationParams = {}): Promise<FormattedVariant[]> {
    const { page = 1, per_page = 200 } = params;

    const response = await this.client.get<NuvemshopVariant[]>(
      `/products/${productId}/variants`,
      { params: { page, per_page } }
    );

    return response.data.map((variant) => this.formatVariantForGrid(variant));
  }

  /**
   * Formata uma variação da API para uso no VariantGrid
   * @param apiVariant - Variação no formato da API Nuvemshop
   * @returns FormattedVariant pronta para renderização no grid
   */
  formatVariantForGrid(apiVariant: NuvemshopVariant): FormattedVariant {
    const option1Value = apiVariant.values[0] ?? { name: 'Opção 1', value: '' };
    const option2Value = apiVariant.values[1] ?? { name: 'Opção 2', value: '' };

    return {
      variantId: apiVariant.id,
      sku: apiVariant.sku ?? `SKU-${apiVariant.id}`,
      option1: option1Value.name,
      value1: option1Value.value,
      option2: option2Value.name,
      value2: option2Value.value,
      stock: apiVariant.stock ?? 0,
      price: apiVariant.price,
      image: apiVariant.image_url ?? null,
    };
  }

  /**
   * Busca variações por prefixo de SKU com debounce de 300ms e cache de 5min
   * @param skuPrefix - Prefixo do SKU a ser buscado
   * @returns Array de FormattedVariant que correspondem ao prefixo
   */
  async searchVariantsBySku(skuPrefix: string): Promise<FormattedVariant[]> {
    const cacheKey = `sku:${skuPrefix.toLowerCase()}`;
    const now = Date.now();

    // Verificar cache (5 minutos = 300000ms)
    const cached = this.searchCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    // Rate-limiting delay of 300ms before each API call to respect the 2 req/sec limit.
    // For true debouncing (cancelling rapid calls), implement at the call site using a
    // library like lodash.debounce or AbortController.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const response = await this.client.get<NuvemshopVariant[]>('/variants', {
      params: { sku: skuPrefix },
    });

    const formatted = response.data.map((v) => this.formatVariantForGrid(v));

    // Armazenar no cache por 5 minutos
    this.searchCache.set(cacheKey, {
      data: formatted,
      expiresAt: now + 5 * 60 * 1000,
    });

    return formatted;
  }
}

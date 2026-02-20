import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  NuvemshopVariant,
  NuvemshopProduct,
  NuvemshopAttribute,
  FormattedVariant,
  OAuthTokenResponse,
} from '../../types/nuvemshop';

interface ServiceConfig {
  baseURL: string;
  accessToken?: string;
  userId?: number;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/**
 * Service layer for Nuvemshop REST API v2025-03.
 * All requests use the `Authentication: bearer {token}` header format.
 */
export class NuvemshopAPIService {
  private client: AxiosInstance;
  private accessToken: string | undefined;
  private userId: number | undefined;
  private cache = new Map<string, CacheEntry<unknown>>();

  // Debounce timer for SKU search
  private skuDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSkuResolvers: Array<(variants: NuvemshopVariant[]) => void> = [];
  private pendingSkuRejecters: Array<(err: unknown) => void> = [];
  private pendingSkuPrefix = '';

  constructor(config: ServiceConfig) {
    this.accessToken = config.accessToken;
    this.userId = config.userId;

    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GradeAtacado/1.0',
      },
    });

    // Request interceptor: inject auth header
    this.client.interceptors.request.use((cfg) => {
      if (this.accessToken) {
        cfg.headers['Authentication'] = `bearer ${this.accessToken}`;
      }
      return cfg;
    });

    // Response interceptor: structured error logging
    this.client.interceptors.response.use(
      (res) => res,
      (error: AxiosError) => {
        const status = error.response?.status;
        const url = error.config?.url;
        console.error(`[NuvemshopAPI] HTTP ${status ?? 'ERR'} on ${url}`, {
          data: error.response?.data,
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Exchange OAuth authorization code for access token.
   */
  async authenticate(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
  ): Promise<OAuthTokenResponse> {
    const response = await axios.post<OAuthTokenResponse>(
      'https://www.nuvemshop.com.br/apps/authorize/token',
      {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code,
      },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
    this.accessToken = response.data.access_token;
    this.userId = response.data.user_id;
    return response.data;
  }

  /**
   * Update stored credentials after token refresh or first auth.
   */
  setAccessToken(token: string, userId: number): void {
    this.accessToken = token;
    this.userId = userId;
    this.client.defaults.headers['Authentication'] = `bearer ${token}`;
  }

  /**
   * Fetch all variants for a product with automatic retry on 429 rate-limit.
   * Max 3 retries with exponential backoff starting at 500ms.
   */
  async getProductVariants(
    productId: string,
    page = 1
  ): Promise<NuvemshopVariant[]> {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 500;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.get<NuvemshopVariant[]>(
          `/v1/${this.userId}/products/${productId}/variants`,
          { params: { page, per_page: 200 } }
        );
        return response.data;
      } catch (err) {
        const axiosErr = err as AxiosError;
        if (axiosErr.response?.status === 429 && attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          console.warn(
            `[NuvemshopAPI] Rate limited (429). Retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`
          );
          await this.sleep(delay);
          continue;
        }
        throw err;
      }
    }
    throw new Error('Max retries exceeded for getProductVariants');
  }

  /**
   * Map a raw API variant to the shape expected by the VariantGrid component.
   */
  formatVariantForGrid(
    apiVariant: NuvemshopVariant,
    attributes: NuvemshopAttribute[]
  ): FormattedVariant {
    const option1 = attributes[0]?.pt ?? attributes[0]?.en ?? 'Opção 1';
    const option2 = attributes[1]?.pt ?? attributes[1]?.en ?? 'Opção 2';
    const value1 = apiVariant.values[0]?.pt ?? apiVariant.values[0]?.en ?? '';
    const value2 = apiVariant.values[1]?.pt ?? apiVariant.values[1]?.en ?? '';

    return {
      variantId: apiVariant.id,
      sku: apiVariant.sku ?? `variant-${apiVariant.id}`,
      option1,
      value1,
      option2,
      value2,
      stock: apiVariant.stock ?? 0,
      stock_management: apiVariant.stock_management,
      price: parseFloat(apiVariant.price),
      promotionalPrice: apiVariant.promotional_price
        ? parseFloat(apiVariant.promotional_price)
        : null,
      imageUrl: null, // resolved separately via image_id lookup
    };
  }

  /**
   * Fetch full product details including variants and attributes.
   */
  async getProduct(productId: string): Promise<NuvemshopProduct> {
    const response = await this.client.get<NuvemshopProduct>(
      `/v1/${this.userId}/products/${productId}`
    );
    return response.data;
  }

  /**
   * Search variants by SKU prefix across all products.
   * Debounced 300ms; results cached in-memory for 5 minutes.
   */
  searchVariantsBySku(skuPrefix: string): Promise<NuvemshopVariant[]> {
    const cacheKey = `sku:${skuPrefix}`;
    const cached = this.cache.get(cacheKey) as CacheEntry<NuvemshopVariant[]> | undefined;
    if (cached && Date.now() < cached.expiresAt) {
      return Promise.resolve(cached.data);
    }

    this.pendingSkuPrefix = skuPrefix;

    return new Promise((resolve, reject) => {
      this.pendingSkuResolvers.push(resolve);
      this.pendingSkuRejecters.push(reject);

      if (this.skuDebounceTimer) {
        clearTimeout(this.skuDebounceTimer);
      }

      this.skuDebounceTimer = setTimeout(async () => {
        const resolvers = [...this.pendingSkuResolvers];
        const rejecters = [...this.pendingSkuRejecters];
        const prefix = this.pendingSkuPrefix;

        this.pendingSkuResolvers = [];
        this.pendingSkuRejecters = [];
        this.skuDebounceTimer = null;

        try {
          const response = await this.client.get<NuvemshopVariant[]>(
            `/v1/${this.userId}/products/variants`,
            { params: { q: prefix } }
          );
          const data = response.data;
          this.cache.set(`sku:${prefix}`, {
            data,
            expiresAt: Date.now() + 5 * 60 * 1000,
          });
          resolvers.forEach((r) => r(data));
        } catch (err) {
          rejecters.forEach((r) => r(err));
        }
      }, 300);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

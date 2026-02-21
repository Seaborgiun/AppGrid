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
 * Camada de serviço para a API REST Nuvemshop v2025-03.
 * Todas as requisições utilizam o cabeçalho `Authentication: bearer {token}`.
 */
export class NuvemshopAPIService {
  private client: AxiosInstance;
  private accessToken: string | undefined;
  private userId: number | undefined;
  private cache = new Map<string, CacheEntry<unknown>>();

  // Timer de debounce para busca por SKU
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

    // Interceptor de requisição: injeta o cabeçalho de autenticação
    this.client.interceptors.request.use((cfg) => {
      if (this.accessToken) {
        cfg.headers['Authentication'] = `bearer ${this.accessToken}`;
      }
      return cfg;
    });

    // Interceptor de resposta: registro estruturado de erros
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
   * Troca o código de autorização OAuth pelo token de acesso.
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
   * Atualiza as credenciais armazenadas após refresh ou autenticação inicial.
   */
  setAccessToken(token: string, userId: number): void {
    this.accessToken = token;
    this.userId = userId;
    this.client.defaults.headers['Authentication'] = `bearer ${token}`;
  }

  /**
   * Busca todas as variações de um produto com retry automático em caso de rate limit (429).
   * Máximo de 3 tentativas com backoff exponencial a partir de 500ms.
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
            `[NuvemshopAPI] Rate limit atingido (429). Tentativa ${attempt + 1}/${MAX_RETRIES} em ${delay}ms`
          );
          await this.sleep(delay);
          continue;
        }
        throw err;
      }
    }
    throw new Error('Número máximo de tentativas excedido para getProductVariants');
  }

  /**
   * Transforma uma variação bruta da API no formato esperado pelo componente VariantGrid.
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
      imageUrl: null, // resolvida separadamente via image_id
    };
  }

  /**
   * Busca os detalhes completos do produto, incluindo variações e atributos.
   */
  async getProduct(productId: string): Promise<NuvemshopProduct> {
    const response = await this.client.get<NuvemshopProduct>(
      `/v1/${this.userId}/products/${productId}`
    );
    return response.data;
  }

  /**
   * Busca variações por prefixo de SKU em todos os produtos.
   * Debounced por 300ms; resultados em cache por 5 minutos.
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

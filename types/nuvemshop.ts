/**
 * Nuvemshop API Types - Grade de Atacado
 * Interfaces TypeScript para integração com a API Nuvemshop REST v2025-03
 */

/**
 * Representa um valor de opção de variação (ex: Cor: Preta, Tamanho: P)
 * Origem: /products/{id}/variants → campo "values"
 */
export interface VariantOptionValue {
  /** Nome da opção (ex: "Cor", "Tamanho") */
  name: string;
  /** Valor da opção (ex: "Preta", "P") */
  value: string;
}

/**
 * Variação de produto retornada diretamente pela API Nuvemshop
 * Origem: GET /products/{id}/variants
 */
export interface NuvemshopVariant {
  /** Identificador único da variação */
  id: number;
  /** Código SKU da variação */
  sku: string | null;
  /** Preço da variação em centavos ou decimal conforme configuração da loja */
  price: string;
  /** Quantidade disponível em estoque */
  stock: number | null;
  /** Array de valores das opções de variação (ex: [{name: "Cor", value: "Preta"}]) */
  values: VariantOptionValue[];
  /** URL da imagem da variação (pode ser null se usar imagem do produto) */
  image_url?: string | null;
  /** Indica se o gerenciamento de estoque está habilitado */
  stock_management?: boolean;
}

/**
 * Variação formatada para uso no grid de atacado
 * Gerada pelo método formatVariantForGrid() do NuvemshopAPIService
 */
export interface FormattedVariant {
  /** Identificador único da variação */
  variantId: number;
  /** Código SKU da variação */
  sku: string;
  /** Nome da primeira opção (ex: "Cor") */
  option1: string;
  /** Valor da primeira opção (ex: "Preta") */
  value1: string;
  /** Nome da segunda opção (ex: "Tamanho") */
  option2: string;
  /** Valor da segunda opção (ex: "P") */
  value2: string;
  /** Quantidade disponível em estoque */
  stock: number;
  /** Preço formatado da variação */
  price: string;
  /** URL da imagem da variação */
  image?: string | null;
}

/**
 * Item do carrinho a ser adicionado via addToCartBulk
 * Utilizado na comunicação entre VariantGrid e cart-injector
 */
export interface CartItem {
  /** Identificador da variação a ser adicionada */
  variantId: number;
  /** Quantidade a ser adicionada ao carrinho */
  quantity: number;
  /** Preço unitário da variação */
  price: string;
  /** Valor total (price * quantity) */
  total: string;
}

/**
 * Resposta da autenticação OAuth 2.0 da Nuvemshop
 * Origem: POST /apps/authorize/token
 */
export interface OAuthTokenResponse {
  /** Token de acesso para autenticação nas requisições API */
  access_token: string;
  /** ID do usuário/loja autenticada */
  user_id: number;
  /** Tempo de expiração do token em segundos (se aplicável) */
  expires_in?: number;
  /** Token para renovação do access_token (se disponível) */
  refresh_token?: string;
  /** Tipo do token (geralmente "bearer") */
  token_type?: string;
  /** Escopos autorizados */
  scope?: string;
}

/**
 * Produto Nuvemshop com variações
 * Origem: GET /products/{id}
 */
export interface NuvemshopProduct {
  /** Identificador único do produto */
  id: number;
  /** Nome do produto */
  name: Record<string, string>;
  /** Descrição do produto */
  description?: Record<string, string>;
  /** Lista de variações do produto */
  variants: NuvemshopVariant[];
  /** Imagens do produto */
  images?: Array<{ id: number; src: string }>;
}

/**
 * Parâmetros de paginação da API Nuvemshop
 */
export interface PaginationParams {
  /** Número da página (inicia em 1) */
  page?: number;
  /** Quantidade de itens por página (máximo 200) */
  per_page?: number;
}

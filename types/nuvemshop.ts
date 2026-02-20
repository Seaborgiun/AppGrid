/** Valor multilíngue de variação */
export interface NuvemshopVariantValue {
  en: string;
  pt: string;
  es: string;
}

/** Variação bruta retornada pela API Nuvemshop – GET /products/{id}/variants */
export interface NuvemshopVariant {
  id: number;
  sku: string | null;
  price: string;
  promotional_price: string | null;
  stock_management: boolean;
  stock: number | null;
  weight: string | null;
  values: NuvemshopVariantValue[];
  image_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Produto completo retornado pela API Nuvemshop – GET /products/{id} */
export interface NuvemshopProduct {
  id: number;
  name: Record<string, string>;
  description: Record<string, string>;
  handle: Record<string, string>;
  variants: NuvemshopVariant[];
  images: NuvemshopImage[];
  categories: NuvemshopCategory[];
  attributes: NuvemshopAttribute[];
  published: boolean;
  free_shipping: boolean;
  requires_shipping: boolean;
  created_at: string;
  updated_at: string;
}

export interface NuvemshopImage {
  id: number;
  src: string;
  position: number;
  alt: string[];
}

export interface NuvemshopCategory {
  id: number;
  name: Record<string, string>;
}

export interface NuvemshopAttribute {
  en: string;
  pt: string;
  es: string;
}

/** Variação formatada para uso no componente VariantGrid */
export interface FormattedVariant {
  variantId: number;
  sku: string;
  option1: string;
  value1: string;
  option2: string;
  value2: string;
  stock: number;
  stock_management: boolean;
  price: number;
  promotionalPrice: number | null;
  imageUrl: string | null;
}

/** Item a ser adicionado ao carrinho */
export interface CartItem {
  variantId: number;
  quantity: number;
  price: number;
  total: number;
}

/** Resposta do token OAuth da Nuvemshop */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  user_id: number;
}

/** Estrutura de resposta paginada da API */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

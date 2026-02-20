/** Raw variant value (multilingual) */
export interface NuvemshopVariantValue {
  en: string;
  pt: string;
  es: string;
}

/** Raw variant from Nuvemshop API GET /products/{id}/variants */
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

/** Full product from Nuvemshop API GET /products/{id} */
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

/** Formatted variant for the VariantGrid component */
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

/** Item to be added to the cart */
export interface CartItem {
  variantId: number;
  quantity: number;
  price: number;
  total: number;
}

/** OAuth token response from Nuvemshop */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  user_id: number;
}

/** Paginated API response wrapper */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

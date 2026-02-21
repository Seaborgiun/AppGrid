/**
 * Add items to cart using the best available strategy.
 * @param items Items to add to cart
 */
export function addToCartBulk(
  items: Array<{ variantId: string | number; quantity: number }>
): Promise<void>;

import React, { useState, useMemo, useCallback, memo } from 'react';
import type { FormattedVariant, CartItem } from '../../../types/nuvemshop';

interface VariantGridProps {
  variants: FormattedVariant[];
  onBulkAdd: (items: CartItem[]) => void;
  maxQuantityPerVariant?: number;
}

/**
 * Componente de grade de produtos para atacado.
 * Renderiza uma tabela de variações agrupadas por option1 (cor) × option2 (tamanho).
 */
const VariantGrid: React.FC<VariantGridProps> = memo(
  ({ variants, onBulkAdd, maxQuantityPerVariant = 999 }) => {
    const [quantities, setQuantities] = useState<Record<number, number>>({});
    const [skuSearch, setSkuSearch] = useState('');
    const [stockOnly, setStockOnly] = useState(false);

    // Determina os rótulos das opções a partir da primeira variação
    const option1Label = variants[0]?.option1 ?? 'Cor';
    const option2Label = variants[0]?.option2 ?? 'Tamanho';

    // Filtra variações por busca de SKU e toggle de estoque
    const filteredVariants = useMemo(() => {
      return variants.filter((v) => {
        const matchesSku =
          skuSearch === '' ||
          v.sku.toLowerCase().includes(skuSearch.toLowerCase());
        const matchesStock = !stockOnly || v.stock > 0;
        return matchesSku && matchesStock;
      });
    }, [variants, skuSearch, stockOnly]);

    // Coleta tamanhos únicos (valores de option2) mantendo a ordem de inserção
    const sizes = useMemo(() => {
      const seen = new Set<string>();
      filteredVariants.forEach((v) => {
        if (v.value2) seen.add(v.value2);
      });
      return Array.from(seen);
    }, [filteredVariants]);

    // Agrupa variações: valorCor → valorTamanho → variação
    const grid = useMemo(() => {
      const map = new Map<string, Map<string, FormattedVariant>>();
      filteredVariants.forEach((v) => {
        if (!map.has(v.value1)) {
          map.set(v.value1, new Map());
        }
        map.get(v.value1)!.set(v.value2, v);
      });
      return map;
    }, [filteredVariants]);

    const colors = useMemo(() => Array.from(grid.keys()), [grid]);

    // Calcula o total de unidades selecionadas
    const totalUnits = useMemo(() => {
      return Object.values(quantities).reduce((sum, q) => sum + (q || 0), 0);
    }, [quantities]);

    // Calcula o preço total
    const totalPrice = useMemo(() => {
      return Object.entries(quantities).reduce((sum, [idStr, qty]) => {
        const id = parseInt(idStr, 10);
        const variant = variants.find((v) => v.variantId === id);
        if (!variant || !qty) return sum;
        const price = variant.promotionalPrice ?? variant.price;
        return sum + price * qty;
      }, 0);
    }, [quantities, variants]);

    const handleQuantityChange = useCallback(
      (variantId: number, value: string) => {
        const qty = Math.max(0, parseInt(value, 10) || 0);
        setQuantities((prev) => ({ ...prev, [variantId]: qty }));
      },
      []
    );

    const handleBulkAdd = useCallback(() => {
      const items: CartItem[] = Object.entries(quantities)
        .filter(([, qty]) => qty > 0)
        .map(([idStr, qty]) => {
          const id = parseInt(idStr, 10);
          const variant = variants.find((v) => v.variantId === id)!;
          const price = variant.promotionalPrice ?? variant.price;
          return {
            variantId: id,
            quantity: qty,
            price,
            total: price * qty,
          };
        });
      onBulkAdd(items);
    }, [quantities, variants, onBulkAdd]);

    const handleExportCsv = useCallback(() => {
      const rows: string[] = [
        `SKU,${option1Label},${option2Label},Quantidade,Preço Unitário,Total`,
      ];
      Object.entries(quantities)
        .filter(([, qty]) => qty > 0)
        .forEach(([idStr, qty]) => {
          const id = parseInt(idStr, 10);
          const v = variants.find((vv) => vv.variantId === id);
          if (!v) return;
          const price = v.promotionalPrice ?? v.price;
          rows.push(
            `${v.sku},${v.value1},${v.value2},${qty},${price.toFixed(2)},${(price * qty).toFixed(2)}`
          );
        });
      const csv = rows.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'grade-atacado.csv';
      a.click();
      URL.revokeObjectURL(url);
    }, [quantities, variants, option1Label, option2Label]);

    const handleClear = useCallback(() => {
      setQuantities({});
    }, []);

    return (
      <div
        role="region"
        aria-label="Grade de Atacado"
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '14px',
          color: '#1f2937',
        }}
      >
        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '12px',
            alignItems: 'center',
          }}
        >
          <label htmlFor="ga-sku-search" style={{ fontWeight: 600 }}>
            Buscar SKU:
          </label>
          <input
            id="ga-sku-search"
            type="search"
            value={skuSearch}
            onChange={(e) => setSkuSearch(e.target.value)}
            placeholder="Ex: ABC-001"
            aria-label="Buscar variante por SKU"
            style={{
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '13px',
              minWidth: '160px',
            }}
          />

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={stockOnly}
              onChange={(e) => setStockOnly(e.target.checked)}
              aria-label="Mostrar apenas com estoque"
            />
            Mostrar apenas com estoque
          </label>

          <button
            onClick={handleExportCsv}
            disabled={totalUnits === 0}
            aria-label="Exportar seleção como CSV"
            style={{
              marginLeft: 'auto',
              padding: '4px 12px',
              border: '1px solid #6b7280',
              borderRadius: '4px',
              background: totalUnits > 0 ? '#f9fafb' : '#f3f4f6',
              cursor: totalUnits > 0 ? 'pointer' : 'not-allowed',
              color: '#374151',
              fontSize: '13px',
            }}
          >
            Exportar CSV
          </button>
        </div>

        {/* Grid table */}
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table
            role="table"
            aria-label="Grade de variantes por cor e tamanho"
            style={{
              borderCollapse: 'collapse',
              width: '100%',
              minWidth: '480px',
            }}
          >
            <thead>
              <tr>
                <th
                  scope="col"
                  style={{
                    padding: '8px 12px',
                    background: '#f3f4f6',
                    borderBottom: '2px solid #e5e7eb',
                    textAlign: 'left',
                    fontWeight: 700,
                    position: 'sticky',
                    left: 0,
                    zIndex: 1,
                  }}
                >
                  {option1Label}
                </th>
                {sizes.map((size) => (
                  <th
                    key={size}
                    scope="col"
                    style={{
                      padding: '8px 12px',
                      background: '#f3f4f6',
                      borderBottom: '2px solid #e5e7eb',
                      textAlign: 'center',
                      fontWeight: 700,
                    }}
                  >
                    {size || option2Label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {colors.map((color, rowIdx) => (
                <tr
                  key={color}
                  style={{
                    background: rowIdx % 2 === 0 ? '#ffffff' : '#f9fafb',
                  }}
                >
                  <th
                    scope="row"
                    style={{
                      padding: '8px 12px',
                      fontWeight: 600,
                      borderBottom: '1px solid #e5e7eb',
                      whiteSpace: 'nowrap',
                      position: 'sticky',
                      left: 0,
                      background: rowIdx % 2 === 0 ? '#ffffff' : '#f9fafb',
                    }}
                  >
                    {color}
                  </th>
                  {sizes.map((size) => {
                    const variant = grid.get(color)?.get(size);
                    if (!variant) {
                      return (
                        <td
                          key={size}
                          style={{
                            padding: '8px 6px',
                            textAlign: 'center',
                            borderBottom: '1px solid #e5e7eb',
                            color: '#d1d5db',
                          }}
                        >
                          —
                        </td>
                      );
                    }
                    const qty = quantities[variant.variantId] ?? 0;
                    const isLowStock =
                      variant.stock_management &&
                      variant.stock > 0 &&
                      variant.stock < 5;
                    const isOutOfStock =
                      variant.stock_management && variant.stock === 0;

                    return (
                      <td
                        key={size}
                        style={{
                          padding: '6px',
                          textAlign: 'center',
                          borderBottom: '1px solid #e5e7eb',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '2px',
                          }}
                        >
                          <input
                            type="number"
                            min={0}
                            max={
                              variant.stock_management
                                ? Math.min(variant.stock, maxQuantityPerVariant)
                                : maxQuantityPerVariant
                            }
                            value={qty || ''}
                            onChange={(e) =>
                              handleQuantityChange(
                                variant.variantId,
                                e.target.value
                              )
                            }
                            disabled={isOutOfStock}
                            aria-label={`Quantidade de ${color} tamanho ${size}, SKU ${variant.sku}`}
                            style={{
                              width: '64px',
                              textAlign: 'center',
                              border: '1px solid #d1d5db',
                              borderRadius: '4px',
                              padding: '4px',
                              fontSize: '13px',
                              background: isOutOfStock ? '#f3f4f6' : '#fff',
                              color: isOutOfStock ? '#9ca3af' : '#1f2937',
                            }}
                          />
                          {isLowStock && (
                            <span
                              aria-label={`Estoque baixo: ${variant.stock} unidades`}
                              style={{
                                fontSize: '10px',
                                color: '#dc2626',
                                fontWeight: 600,
                                background: '#fee2e2',
                                borderRadius: '4px',
                                padding: '1px 4px',
                              }}
                            >
                              Baixo: {variant.stock}
                            </span>
                          )}
                          {isOutOfStock && (
                            <span
                              aria-label="Sem estoque"
                              style={{
                                fontSize: '10px',
                                color: '#6b7280',
                              }}
                            >
                              Esgotado
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredVariants.length === 0 && (
          <p
            style={{
              textAlign: 'center',
              color: '#6b7280',
              padding: '24px 0',
            }}
          >
            Nenhuma variante encontrada.
          </p>
        )}

        {/* Footer summary */}
        <div
          style={{
            marginTop: '16px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
            borderTop: '1px solid #e5e7eb',
            paddingTop: '12px',
          }}
        >
          <span style={{ color: '#4b5563', fontSize: '13px' }}>
            <strong>{totalUnits}</strong> unidades selecionadas
          </span>
          {totalUnits > 0 && (
            <span style={{ color: '#4b5563', fontSize: '13px' }}>
              Total:{' '}
              <strong>
                R${' '}
                {totalPrice.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                })}
              </strong>
            </span>
          )}
          <button
            onClick={handleClear}
            disabled={totalUnits === 0}
            style={{
              padding: '6px 14px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              background: '#f9fafb',
              cursor: totalUnits > 0 ? 'pointer' : 'not-allowed',
              color: '#374151',
              fontSize: '13px',
            }}
          >
            Limpar
          </button>
          <button
            onClick={handleBulkAdd}
            disabled={totalUnits === 0}
            aria-label={`Adicionar ${totalUnits} unidades ao carrinho`}
            style={{
              padding: '8px 20px',
              border: 'none',
              borderRadius: '4px',
              background: totalUnits > 0 ? '#2563eb' : '#93c5fd',
              color: '#fff',
              fontWeight: 700,
              fontSize: '14px',
              cursor: totalUnits > 0 ? 'pointer' : 'not-allowed',
              marginLeft: 'auto',
            }}
          >
            Adicionar {totalUnits} unidade{totalUnits !== 1 ? 's' : ''} ao
            carrinho
          </button>
        </div>
      </div>
    );
  }
);

VariantGrid.displayName = 'VariantGrid';

export default VariantGrid;

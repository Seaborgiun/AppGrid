import React, { useMemo, useState, memo, useCallback } from 'react';
import type { FormattedVariant, CartItem } from '../../../types/nuvemshop';

export interface VariantGridProps {
  /** Variações já formatadas pelo NuvemshopAPIService */
  variants: FormattedVariant[];
  /** Callback chamado ao confirmar adição em massa ao carrinho */
  onBulkAdd: (items: CartItem[]) => void;
  /** Limite máximo de quantidade por variação (padrão: sem limite) */
  maxQuantityPerVariant?: number;
}

/** Threshold para exibir badge de estoque baixo */
const LOW_STOCK_THRESHOLD = 5;

/**
 * VariantGrid - Grade de seleção em massa para atacado
 *
 * Exibe uma tabela onde as linhas representam a primeira opção (ex: Cor)
 * e as colunas representam a segunda opção (ex: Tamanho), com inputs
 * numéricos em cada célula para seleção de quantidade.
 */
export const VariantGrid = memo(function VariantGrid({
  variants,
  onBulkAdd,
  maxQuantityPerVariant,
}: VariantGridProps) {
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [skuFilter, setSkuFilter] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(false);

  // Filtrar variações conforme filtros ativos
  const filteredVariants = useMemo(() => {
    return variants.filter((v) => {
      if (onlyInStock && v.stock <= 0) return false;
      if (skuFilter && !v.sku.toLowerCase().includes(skuFilter.toLowerCase())) return false;
      return true;
    });
  }, [variants, skuFilter, onlyInStock]);

  // Agrupar por value1 (cor) e value2 (tamanho)
  const { rows, columns, gridMap } = useMemo(() => {
    const rowSet = new Set<string>();
    const colSet = new Set<string>();
    const map = new Map<string, FormattedVariant>();

    filteredVariants.forEach((v) => {
      rowSet.add(v.value1);
      colSet.add(v.value2);
      map.set(`${v.value1}::${v.value2}`, v);
    });

    return {
      rows: Array.from(rowSet),
      columns: Array.from(colSet),
      gridMap: map,
    };
  }, [filteredVariants]);

  // Obter nomes das opções do primeiro variant disponível
  const option1Name = filteredVariants[0]?.option1 ?? 'Opção 1';
  const option2Name = filteredVariants[0]?.option2 ?? 'Opção 2';

  // Calcular total de unidades selecionadas
  const totalSelected = useMemo(() => {
    return Object.values(quantities).reduce((sum, qty) => sum + (qty || 0), 0);
  }, [quantities]);

  const handleQuantityChange = useCallback(
    (variantId: number, stock: number, value: string) => {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed < 0) {
        setQuantities((prev) => ({ ...prev, [variantId]: 0 }));
        return;
      }
      const maxAllowed = maxQuantityPerVariant !== undefined ? Math.min(maxQuantityPerVariant, stock) : stock;
      setQuantities((prev) => ({ ...prev, [variantId]: Math.min(parsed, maxAllowed) }));
    },
    [maxQuantityPerVariant]
  );

  const handleBulkAdd = useCallback(() => {
    const items: CartItem[] = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([variantIdStr, quantity]) => {
        const variantId = parseInt(variantIdStr, 10);
        const variant = filteredVariants.find((v) => v.variantId === variantId);
        const price = variant?.price ?? '0.00';
        const total = (parseFloat(price) * quantity).toFixed(2);
        return { variantId, quantity, price, total };
      });

    if (items.length > 0) {
      onBulkAdd(items);
    }
  }, [quantities, filteredVariants, onBulkAdd]);

  /** Exporta a seleção atual como arquivo CSV */
  const handleExportCSV = useCallback(() => {
    const headers = ['SKU', option1Name, option2Name, 'Quantidade', 'Preço', 'Total'];
    const rowsData: string[][] = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([variantIdStr, quantity]) => {
        const variantId = parseInt(variantIdStr, 10);
        const variant = filteredVariants.find((v) => v.variantId === variantId);
        if (!variant) return [];
        const total = (parseFloat(variant.price) * quantity).toFixed(2);
        return [variant.sku, variant.value1, variant.value2, String(quantity), variant.price, total];
      })
      .filter((row) => row.length > 0);

    const csvContent = [headers, ...rowsData].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'selecao-atacado.csv';
    link.click();
    URL.revokeObjectURL(url);
  }, [quantities, filteredVariants, option1Name, option2Name]);

  if (variants.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        Nenhuma variação disponível para este produto.
      </div>
    );
  }

  return (
    <div className="variant-grid w-full font-sans">
      {/* Header com filtros */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <label htmlFor="sku-search" className="text-sm font-medium text-gray-700 whitespace-nowrap">
            Buscar SKU:
          </label>
          <input
            id="sku-search"
            type="text"
            value={skuFilter}
            onChange={(e) => setSkuFilter(e.target.value)}
            placeholder="Digite o SKU..."
            className="w-full sm:w-48 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={onlyInStock}
            onChange={(e) => setOnlyInStock(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          Mostrar apenas com estoque
        </label>
      </div>

      {/* Tabela de grade */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600"
              >
                {option1Name} / {option2Name}
              </th>
              {columns.map((col) => (
                <th
                  key={col}
                  scope="col"
                  className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-600"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {rows.map((row, rowIdx) => (
              <tr key={row} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">{row}</td>
                {columns.map((col) => {
                  const variant = gridMap.get(`${row}::${col}`);
                  if (!variant) {
                    return (
                      <td key={col} className="px-4 py-3 text-center text-gray-300">
                        —
                      </td>
                    );
                  }
                  const qty = quantities[variant.variantId] ?? 0;
                  const isLowStock = variant.stock > 0 && variant.stock < LOW_STOCK_THRESHOLD;
                  const isOutOfStock = variant.stock <= 0;
                  const maxAllowed =
                    maxQuantityPerVariant !== undefined
                      ? Math.min(maxQuantityPerVariant, variant.stock)
                      : variant.stock;

                  return (
                    <td key={col} className="px-2 py-2 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <label
                          htmlFor={`qty-${variant.variantId}`}
                          className="sr-only"
                        >
                          {`Quantidade de ${row} ${col} (SKU: ${variant.sku})`}
                        </label>
                        <input
                          id={`qty-${variant.variantId}`}
                          type="number"
                          min={0}
                          max={maxAllowed}
                          value={qty || ''}
                          onChange={(e) =>
                            handleQuantityChange(variant.variantId, variant.stock, e.target.value)
                          }
                          disabled={isOutOfStock}
                          placeholder="0"
                          className={`w-16 rounded border px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                            isOutOfStock
                              ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
                              : 'border-gray-300 bg-white text-gray-900'
                          }`}
                        />
                        {isOutOfStock ? (
                          <span className="text-xs font-medium text-gray-400">Esgotado</span>
                        ) : isLowStock ? (
                          <span className="text-xs font-semibold text-red-600">
                            {variant.stock} rest.
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">{variant.stock} disp.</span>
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

      {/* Footer com resumo e ações */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-600">
          Total selecionado:{' '}
          <span className="font-semibold text-gray-900">{totalSelected} unidade(s)</span>
        </p>
        <div className="flex gap-2">
          {totalSelected > 0 && (
            <button
              type="button"
              onClick={handleExportCSV}
              className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              Exportar CSV
            </button>
          )}
          <button
            type="button"
            onClick={handleBulkAdd}
            disabled={totalSelected === 0}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
          >
            Adicionar {totalSelected > 0 ? `${totalSelected} unidade(s)` : ''} ao Carrinho
          </button>
        </div>
      </div>
    </div>
  );
});

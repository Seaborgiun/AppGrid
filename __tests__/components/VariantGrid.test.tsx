import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import VariantGrid from '../../src/components/VariantGrid/VariantGrid';
import type { FormattedVariant, CartItem } from '../../types/nuvemshop';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeVariant = (
  id: number,
  color: string,
  size: string,
  stock: number,
  price: number,
  stockManagement = true
): FormattedVariant => ({
  variantId: id,
  sku: `SKU-${color.toUpperCase()}-${size}`,
  option1: 'Cor',
  value1: color,
  option2: 'Tamanho',
  value2: size,
  stock,
  stock_management: stockManagement,
  price,
  promotionalPrice: null,
  imageUrl: null,
});

const mockVariants: FormattedVariant[] = [
  makeVariant(1, 'Azul', 'P', 10, 49.9),
  makeVariant(2, 'Azul', 'M', 3, 49.9),   // low stock (< 5)
  makeVariant(3, 'Azul', 'G', 0, 49.9),   // out of stock
  makeVariant(4, 'Vermelho', 'P', 20, 59.9),
  makeVariant(5, 'Vermelho', 'M', 8, 59.9),
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VariantGrid', () => {
  test('renders table with color rows and size columns', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    // Header row should have size columns
    expect(screen.getByText('P')).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();
    expect(screen.getByText('G')).toBeInTheDocument();

    // Row labels for colors
    expect(screen.getByText('Azul')).toBeInTheDocument();
    expect(screen.getByText('Vermelho')).toBeInTheDocument();
  });

  test('all quantity inputs start at empty (zero)', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const inputs = screen.getAllByRole('spinbutton');
    inputs.forEach((input) => {
      expect((input as HTMLInputElement).value).toBe('');
    });
  });

  test('changing a quantity input updates the total unit count', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const azulPInput = screen.getByLabelText(/quantidade de azul tamanho p/i);
    fireEvent.change(azulPInput, { target: { value: '5' } });

    // Text may be split across elements: <strong>5</strong> unidades selecionadas
    expect(
      screen.getByText((_, el) =>
        el?.textContent?.replace(/\s+/g, ' ').trim() === '5 unidades selecionadas'
      )
    ).toBeInTheDocument();
  });

  test('total price is calculated correctly with multiple inputs', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const azulPInput = screen.getByLabelText(/quantidade de azul tamanho p/i);
    const vermelhoMInput = screen.getByLabelText(/quantidade de vermelho tamanho m/i);

    fireEvent.change(azulPInput, { target: { value: '2' } }); // 2 × 49.90 = 99.80
    fireEvent.change(vermelhoMInput, { target: { value: '1' } }); // 1 × 59.90 = 59.90

    // Total = 159.70
    expect(screen.getByText(/159/)).toBeInTheDocument();
  });

  test('Adicionar button is disabled when no quantities are selected', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const addBtn = screen.getByRole('button', { name: /adicionar.*unidade/i });
    expect(addBtn).toBeDisabled();
  });

  test('onBulkAdd is called with correct CartItems on submit', () => {
    const onBulkAdd = jest.fn();
    render(<VariantGrid variants={mockVariants} onBulkAdd={onBulkAdd} />);

    const azulPInput = screen.getByLabelText(/quantidade de azul tamanho p/i);
    fireEvent.change(azulPInput, { target: { value: '3' } });

    const addBtn = screen.getByRole('button', { name: /adicionar.*unidade/i });
    fireEvent.click(addBtn);

    expect(onBulkAdd).toHaveBeenCalledTimes(1);
    const items: CartItem[] = onBulkAdd.mock.calls[0][0];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      variantId: 1,
      quantity: 3,
      price: 49.9,
      total: 49.9 * 3,
    });
  });

  test('low stock badge is shown for variants with stock < 5', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    // Variant 2: Azul M stock=3 → low stock
    expect(screen.getByText(/Baixo: 3/)).toBeInTheDocument();
  });

  test('out-of-stock input is disabled', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    // Variant 3: Azul G stock=0
    const disabledInput = screen.getByLabelText(/quantidade de azul tamanho g/i);
    expect(disabledInput).toBeDisabled();
  });

  test('SKU search filters visible variants', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const skuInput = screen.getByLabelText(/buscar variante por sku/i);
    fireEvent.change(skuInput, { target: { value: 'SKU-VERMELHO' } });

    // Only Vermelho row should remain; Azul color cells should not be visible
    expect(screen.queryByText('Azul')).not.toBeInTheDocument();
    expect(screen.getByText('Vermelho')).toBeInTheDocument();
  });

  test('"Mostrar apenas com estoque" hides out-of-stock variants', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const checkbox = screen.getByLabelText(/mostrar apenas com estoque/i);
    fireEvent.click(checkbox);

    // Azul G (stock=0) should be hidden (its size column "G" might still show for other colors)
    // But the "Esgotado" text should not appear
    expect(screen.queryByText('Esgotado')).not.toBeInTheDocument();
  });

  test('CSV export button is disabled when no quantities selected', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const csvBtn = screen.getByRole('button', { name: /exportar seleção como csv/i });
    expect(csvBtn).toBeDisabled();
  });

  test('CSV export button is enabled when quantities are selected', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const azulPInput = screen.getByLabelText(/quantidade de azul tamanho p/i);
    fireEvent.change(azulPInput, { target: { value: '2' } });

    const csvBtn = screen.getByRole('button', { name: /exportar seleção como csv/i });
    expect(csvBtn).not.toBeDisabled();
  });

  test('Limpar button resets all quantities', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const azulPInput = screen.getByLabelText(/quantidade de azul tamanho p/i);
    fireEvent.change(azulPInput, { target: { value: '5' } });

    const clearBtn = screen.getByRole('button', { name: /limpar/i });
    fireEvent.click(clearBtn);

    expect((azulPInput as HTMLInputElement).value).toBe('');
    expect(
      screen.getByText((_, el) =>
        el?.textContent?.replace(/\s+/g, ' ').trim() === '0 unidades selecionadas'
      )
    ).toBeInTheDocument();
  });

  test('renders empty state message when no variants match filter', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const skuInput = screen.getByLabelText(/buscar variante por sku/i);
    fireEvent.change(skuInput, { target: { value: 'NONEXISTENT-SKU-XYZ' } });

    expect(screen.getByText(/nenhuma variante encontrada/i)).toBeInTheDocument();
  });
});

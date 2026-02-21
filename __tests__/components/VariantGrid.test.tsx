import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import VariantGrid from '../../src/components/VariantGrid/VariantGrid';
import type { FormattedVariant, CartItem } from '../../types/nuvemshop';

// ─── Dados de teste ───────────────────────────────────────────────────────────

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

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('VariantGrid', () => {
  test('renderiza tabela com linhas de cor e colunas de tamanho', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    // A linha de cabeçalho deve ter colunas de tamanho
    expect(screen.getByText('P')).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();
    expect(screen.getByText('G')).toBeInTheDocument();

    // Rótulos de linha para as cores
    expect(screen.getByText('Azul')).toBeInTheDocument();
    expect(screen.getByText('Vermelho')).toBeInTheDocument();
  });

  test('todos os inputs de quantidade começam vazios (zero)', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const inputs = screen.getAllByRole('spinbutton');
    inputs.forEach((input) => {
      expect((input as HTMLInputElement).value).toBe('');
    });
  });

  test('alterar um input de quantidade atualiza o total de unidades', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const azulPInput = screen.getByLabelText(/quantidade de azul tamanho p/i);
    fireEvent.change(azulPInput, { target: { value: '5' } });

    // O texto pode estar dividido entre elementos: <strong>5</strong> unidades selecionadas
    expect(
      screen.getByText((_, el) =>
        el?.textContent?.replace(/\s+/g, ' ').trim() === '5 unidades selecionadas'
      )
    ).toBeInTheDocument();
  });

  test('o preço total é calculado corretamente com múltiplos inputs', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const azulPInput = screen.getByLabelText(/quantidade de azul tamanho p/i);
    const vermelhoMInput = screen.getByLabelText(/quantidade de vermelho tamanho m/i);

    fireEvent.change(azulPInput, { target: { value: '2' } }); // 2 × 49.90 = 99.80
    fireEvent.change(vermelhoMInput, { target: { value: '1' } }); // 1 × 59.90 = 59.90

    // Total = 159,70
    expect(screen.getByText(/159/)).toBeInTheDocument();
  });

  test('botão Adicionar está desabilitado quando nenhuma quantidade é selecionada', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const addBtn = screen.getByRole('button', { name: /adicionar.*unidade/i });
    expect(addBtn).toBeDisabled();
  });

  test('onBulkAdd é chamado com os CartItems corretos ao confirmar', () => {
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

  test('badge de estoque baixo é exibido para variações com estoque < 5', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    // Variação 2: Azul M estoque=3 → estoque baixo
    expect(screen.getByText(/Baixo: 3/)).toBeInTheDocument();
  });

  test('input sem estoque está desabilitado', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    // Variação 3: Azul G estoque=0
    const disabledInput = screen.getByLabelText(/quantidade de azul tamanho g/i);
    expect(disabledInput).toBeDisabled();
  });

  test('busca por SKU filtra as variações visíveis', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const skuInput = screen.getByLabelText(/buscar variante por sku/i);
    fireEvent.change(skuInput, { target: { value: 'SKU-VERMELHO' } });

    // Apenas a linha Vermelho deve permanecer; células da cor Azul não devem aparecer
    expect(screen.queryByText('Azul')).not.toBeInTheDocument();
    expect(screen.getByText('Vermelho')).toBeInTheDocument();
  });

  test('"Mostrar apenas com estoque" oculta variações sem estoque', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const checkbox = screen.getByLabelText(/mostrar apenas com estoque/i);
    fireEvent.click(checkbox);

    // Azul G (estoque=0) deve estar oculto (a coluna "G" pode ainda aparecer para outras cores)
    // mas o texto "Esgotado" não deve aparecer
    expect(screen.queryByText('Esgotado')).not.toBeInTheDocument();
  });

  test('botão de exportar CSV está desabilitado quando nenhuma quantidade é selecionada', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const csvBtn = screen.getByRole('button', { name: /exportar seleção como csv/i });
    expect(csvBtn).toBeDisabled();
  });

  test('botão de exportar CSV está habilitado quando quantidades são selecionadas', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const azulPInput = screen.getByLabelText(/quantidade de azul tamanho p/i);
    fireEvent.change(azulPInput, { target: { value: '2' } });

    const csvBtn = screen.getByRole('button', { name: /exportar seleção como csv/i });
    expect(csvBtn).not.toBeDisabled();
  });

  test('botão Limpar redefine todas as quantidades', () => {
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

  test('exibe mensagem de estado vazio quando nenhuma variação corresponde ao filtro', () => {
    render(<VariantGrid variants={mockVariants} onBulkAdd={jest.fn()} />);

    const skuInput = screen.getByLabelText(/buscar variante por sku/i);
    fireEvent.change(skuInput, { target: { value: 'NONEXISTENT-SKU-XYZ' } });

    expect(screen.getByText(/nenhuma variante encontrada/i)).toBeInTheDocument();
  });
});

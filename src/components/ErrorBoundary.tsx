import React from 'react';
import { ErrorBoundary as NexoErrorBoundary } from '@tiendanube/nexo';
import nexoClient from '../nexo/nexoClient';

interface Props {
  children: React.ReactNode;
}

/**
 * ErrorBoundary que usa o componente oficial do Nexo.
 * Obrigatório para publicação na App Store Nuvemshop/Tiendanube.
 */
export function ErrorBoundary({ children }: Props) {
  return (
    <NexoErrorBoundary nexo={nexoClient}>
      {children}
    </NexoErrorBoundary>
  );
}

export default ErrorBoundary;

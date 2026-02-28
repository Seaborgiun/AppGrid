import { create } from '@tiendanube/nexo';

/**
 * Instância do cliente Nexo para comunicação com o painel Nuvemshop/Tiendanube.
 * Necessário para apps incorporados (embedded apps) na App Store.
 */
const nexoClient = create({ clientId: process.env.REACT_APP_NEXO_CLIENT_ID ?? 'appgrid' });

export default nexoClient;

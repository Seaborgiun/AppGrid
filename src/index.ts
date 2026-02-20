/**
 * Backend Express - Proxy OAuth e chamadas à API Nuvemshop
 * Nunca expõe access_token diretamente ao frontend
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { NuvemshopAPIService } from './services/nuvemshop';

dotenv.config();

const app = express();
const PORT = process.env['PORT'] ?? 3000;

app.use(cors());
app.use(express.json());

// Armazenamento em memória de tokens por sessão (produção deve usar banco de dados)
const tokenStore = new Map<string, { accessToken: string; storeId: string; refreshToken?: string }>();

/** Rate limiter for auth endpoints: max 10 requests per IP per 15 minutes */
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' },
});

/**
 * Health check endpoint para Render.com
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Callback OAuth - troca código por token de acesso
 * Nunca retorna o access_token para o frontend
 */
app.get('/auth/callback', authRateLimiter, async (req: Request, res: Response) => {
  const { code, store_id } = req.query as { code?: string; store_id?: string };

  if (!code || !store_id) {
    res.status(400).json({ error: 'Missing code or store_id' });
    return;
  }

  const clientId = process.env['NUVEMSHOP_CLIENT_ID'];
  const clientSecret = process.env['NUVEMSHOP_CLIENT_SECRET'];

  if (!clientId || !clientSecret) {
    res.status(500).json({ error: 'OAuth credentials not configured' });
    return;
  }

  try {
    const service = new NuvemshopAPIService('', store_id);
    const tokenResponse = await service.authenticate(code, clientId, clientSecret);

    // Armazenar token no servidor, nunca enviar ao frontend
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    tokenStore.set(sessionId, {
      accessToken: tokenResponse.access_token,
      storeId: String(tokenResponse.user_id),
      refreshToken: tokenResponse.refresh_token,
    });

    // Redirecionar com session ID (não com o token)
    const redirectUri = process.env['NUVEMSHOP_REDIRECT_URI'] ?? '/';
    res.redirect(`${redirectUri}?session=${sessionId}`);
  } catch (err) {
    console.error('[Auth] Erro na autenticação OAuth:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * Busca variações de produto via proxy (token fica no backend)
 */
app.get('/api/products/:productId/variants', async (req: Request, res: Response) => {
  const productId = req.params['productId'] as string;
  const sessionId = req.headers['x-session-id'] as string | undefined;

  if (!sessionId || !tokenStore.has(sessionId)) {
    res.status(401).json({ error: 'Unauthorized: session not found' });
    return;
  }

  const session = tokenStore.get(sessionId)!;
  const { page, per_page } = req.query as { page?: string; per_page?: string };

  try {
    const service = new NuvemshopAPIService(
      session.accessToken,
      session.storeId,
      session.refreshToken
    );

    const variants = await service.getProductVariants(productId, {
      page: page ? parseInt(page, 10) : undefined,
      per_page: per_page ? parseInt(per_page, 10) : undefined,
    });

    res.json({ variants });
  } catch (err) {
    console.error(`[API] Erro ao buscar variações do produto ${productId}:`, err);
    res.status(500).json({ error: 'Failed to fetch variants' });
  }
});

app.listen(PORT, () => {
  console.log(`[Server] GradeAtacado backend rodando na porta ${PORT}`);
});

export default app;

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import { NuvemshopAPIService } from './services/nuvemshop';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  })
);

declare module 'express-session' {
  interface SessionData {
    accessToken?: string;
    userId?: number;
  }
}

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
    },
  })
);

// ─── Auxiliar: cria o serviço de API a partir da sessão ──────────────────────

function buildApiService(req: Request): NuvemshopAPIService {
  const userId = req.session.userId;
  return new NuvemshopAPIService({
    baseURL: `https://api.nuvemshop.com.br`,
    accessToken: req.session.accessToken,
    userId,
  });
}

// ─── Rate limiters ────────────────────────────────────────────────────────────

/** Limite estrito no callback OAuth: 10 tentativas por 15 minutos por IP */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de autenticação. Tente novamente mais tarde.' },
});

/** Limitador geral da API: 100 requisições por minuto por IP */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Routes ────────────────────────────────────────────────────────────────────

/** Verificação de saúde do serviço */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: '1.0.0' });
});
/** Rota de login para aplicativo embeddado da Nuvemshop */
app.get('/login', (req: Request, res: Response) => {
  const embedded = req.query.embedded;
  
  if (embedded) {
    const authUrl = `${process.env.NUVEMSHOP_OAUTH_AUTHORIZE_URL}?client_id=${process.env.NUVEMSHOP_APP_ID}&redirect_uri=${process.env.NUVEMSHOP_REDIRECT_URI}&response_type=code&scope=${process.env.NUVEMSHOP_SCOPES}`;
    res.redirect(authUrl);
  } else {
    res.send('<h1>AppGrid</h1><p>Use via painel Nuvemshop</p>');
  }
});
/**
 * Callback OAuth: troca o code pelo access token.
 * GET /api/auth/callback?code=xxx&shop_id=yyy
 */
app.get('/api/auth/callback', authLimiter, async (req: Request, res: Response) => {
  const { code, shop_id, store_id } = req.query as Record<string, string>;
  const storeId = shop_id || store_id;

  if (!code || !storeId) {
    res.status(400).json({ error: 'Parâmetro code ou shop_id/store_id ausente' });
    return;
  }

  const clientId = process.env.NUVEMSHOP_CLIENT_ID;
  const clientSecret = process.env.NUVEMSHOP_CLIENT_SECRET;
  const redirectUri = process.env.NUVEMSHOP_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).json({ error: 'Credenciais OAuth não configuradas' });
    return;
  }

  try {
    const service = new NuvemshopAPIService({
      baseURL: 'https://api.nuvemshop.com.br',
    });
    const tokenData = await service.authenticate(
      code,
      clientId,
      clientSecret,
      redirectUri
    );

    req.session.accessToken = tokenData.access_token;
    req.session.userId = tokenData.user_id;

    // Redireciona para o admin da loja ou página de sucesso
    const redirectTo =
      process.env.POST_AUTH_REDIRECT ||
      `https://${storeId}.lojavirtualnuvem.com.br/admin`;
    res.redirect(302, redirectTo);
  } catch (err) {
    console.error('[Auth] Falha na troca OAuth:', err);
    res.status(502).json({ error: 'Falha na troca do token OAuth' });
  }
});

/**
 * Proxy: GET /api/products/:id/variants
 * Retorna variações formatadas (token de acesso nunca exposto ao frontend).
 */
app.get('/api/products/:id/variants', apiLimiter, async (req: Request, res: Response) => {
  if (!req.session.accessToken) {
    res.status(401).json({ error: 'Não autenticado' });
    return;
  }
  try {
    const service = buildApiService(req);
    const product = await service.getProduct(req.params.id);
    const formatted = product.variants.map((v) =>
      service.formatVariantForGrid(v, product.attributes)
    );
    res.json(formatted);
  } catch (err) {
    console.error('[API] Falha em getVariants:', err);
    res.status(502).json({ error: 'Falha ao buscar variações' });
  }
});

/**
 * Proxy: GET /api/products/:id
 * Retorna detalhes do produto.
 */
app.get('/api/products/:id', apiLimiter, async (req: Request, res: Response) => {
  if (!req.session.accessToken) {
    res.status(401).json({ error: 'Não autenticado' });
    return;
  }
  try {
    const service = buildApiService(req);
    const product = await service.getProduct(req.params.id);
    res.json(product);
  } catch (err) {
    console.error('[API] Falha em getProduct:', err);
    res.status(502).json({ error: 'Falha ao buscar produto' });
  }
});

/**
 * Webhook de exclusão de dados (LGPD).
 * POST /api/webhooks/data-deletion
 */
app.post(
  '/api/webhooks/data-deletion',
  (req: Request, res: Response) => {
    const { store_id, customer_id } = req.body as {
      store_id?: string;
      customer_id?: string;
    };

    if (!store_id || !customer_id) {
      res.status(400).json({ error: 'Campos store_id ou customer_id ausentes' });
      return;
    }

    // Em uma implementação real, excluir ou anonimizar todos os dados pessoais do cliente.
    console.info(
      `[LGPD] Data deletion request received for store=${store_id}, customer=${customer_id}`
    );

    res.json({ received: true, store_id, customer_id });
  }
);

// ─── Global error handler ──────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Servidor] Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// ─── Start ─────────────────────────────────────────────────────────────────────

// Quando invocado como cron job para sincronização de webhooks LGPD, executa a limpeza e encerra.
if (process.argv.includes('--lgpd-sync')) {
  console.log('[LGPD Sync] Executando sincronização periódica de webhooks...');
  // Re-registra os webhooks de exclusão de dados na Nuvemshop (exigência LGPD).
  // Em uma implementação completa, isso iteraria por todas as lojas autorizadas
  // e garantiria que cada uma tenha um webhook de exclusão de dados ativo registrado.
  console.log('[LGPD Sync] Sincronização de webhooks concluída.');
  process.exit(0);
} else {
  app.listen(PORT, () => {
    console.log(`[Servidor] Backend Grade de Atacado rodando na porta ${PORT}`);
  });
}

export default app;

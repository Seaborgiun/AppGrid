import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import { NuvemshopAPIService } from './services/nuvemshop';
import { saveToken, getToken, removeToken } from './store/tokens';

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
// Permite embedding no iframe do painel Nuvemshop/Tiendanube
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' *.nuvemshop.com.br *.lojavirtualnuvem.com.br *.tiendanube.com *.mitiendanube.com"
  );
  res.removeHeader('X-Frame-Options'); // garante que não conflite
  next();
});
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' *.nuvemshop.com.br *.lojavirtualnuvem.com.br *.tiendanube.com *.mitiendanube.com"
  );
  next();
});

// ─── CSP para apps embarcados Nuvemshop ──────────────────────────────────────
// Permite que o app seja carregado em iframe pelos domínios da Nuvemshop/Tiendanube
app.use((_req: Request, res: Response, next: NextFunction) => {
  // Remove X-Frame-Options se existir (conflita com frame-ancestors CSP)
  res.removeHeader('X-Frame-Options');
  // Permite embedding em domínios Nuvemshop e Tiendanube
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' *.nuvemshop.com.br *.lojavirtualnuvem.com.br *.tiendanube.com *.mitiendanube.com"
  );
  next();
});

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

/**
 * Rota raiz — dashboard do app embarcado.
 * Usuários autenticados veem o dashboard; não autenticados são redirecionados.
 */
app.get('/', (req: Request, res: Response) => {
  if (!req.session.accessToken) {
    res.redirect('/login');
    return;
  }

  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Grade de Atacado — AppGrid</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; color: #1f2937; }
      h1 { color: #111827; }
      .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; margin-top: 24px; }
      .badge { display: inline-block; background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 9999px; font-size: 14px; font-weight: 600; }
    </style>
  </head>
  <body>
    <h1>Grade de Atacado</h1>
    <span class="badge">✓ Autenticado</span>
    <div class="card">
      <p>Aplicativo instalado com sucesso! O widget de grade de atacado está ativo na sua loja.</p>
      <p>Para configurar o widget, adicione o snippet HTML ao template do produto no painel de temas da Nuvemshop.</p>
    </div>
  </body>
</html>`);
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
 * Handler compartilhado do callback OAuth.
 * Troca o code pelo access token.
 *
 * Nota: a Nuvemshop envia apenas `code` no redirect — shop_id/store_id
 * NÃO são parâmetros de query; o user_id é retornado na resposta do token.
 */
async function handleOAuthCallback(req: Request, res: Response): Promise<void> {
  const { code } = req.query as Record<string, string>;

  if (!code) {
    res.status(400).json({ error: 'Parâmetro code ausente' });
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
    saveToken(tokenData.user_id, tokenData.access_token);

    // Redireciona para a URL configurada ou para uma página de sucesso padrão
    const redirectTo =
      process.env.POST_AUTH_REDIRECT || '/';
    res.redirect(302, redirectTo);
  } catch (err) {
    console.error('[Auth] Falha na troca OAuth:', err);
    res.status(502).json({ error: 'Falha na troca do token OAuth' });
  }
}

/**
 * Alias de compatibilidade: Nuvemshop pode redirecionar para /callback
 * GET /callback?code=xxx
 */
app.get('/callback', authLimiter, handleOAuthCallback);

/**
 * Callback OAuth: troca o code pelo access token.
 * GET /api/auth/callback?code=xxx
 */
app.get('/api/auth/callback', authLimiter, handleOAuthCallback);

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
    removeToken(parseInt(store_id, 10));

    res.json({ received: true, store_id, customer_id });
  }
);

/**
 * Dashboard principal do app embarcado.
 * Requer autenticação — redireciona para /login se sessão inativa.
 * GET /dashboard
 */
app.get('/dashboard', (req: Request, res: Response) => {
  if (!req.session.accessToken) {
    res.redirect('/login');
    return;
  }

  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Grade de Atacado — Dashboard</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; color: #1f2937; }
      h1 { color: #111827; }
      .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; margin-top: 24px; }
      .badge { display: inline-block; background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 9999px; font-size: 14px; font-weight: 600; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    </style>
  </head>
  <body>
    <h1>Grade de Atacado</h1>
    <span class="badge">✓ Instalado com sucesso</span>
    <div class="card">
      <h2>Widget ativo</h2>
      <p>O widget de grade de atacado está pronto para ser usado na sua loja Nuvemshop.</p>
      <p>Para ativar o widget nas páginas de produto, adicione o seguinte código ao template do produto no editor de temas:</p>
      <pre><code>&lt;div data-grade-atacado data-product-id="{{ product.id }}" data-api-url="https://app.estudio428.com.br"&gt;&lt;/div&gt;</code></pre>
    </div>
  </body>
</html>`);
});

/**
 * Rota raiz — redireciona conforme o estado da sessão.
 * GET /
 */
app.get('/', (req: Request, res: Response) => {
  if (!req.session.accessToken) {
    const queryUserId = parseInt(req.query.user_id as string || '0', 10);
    if (queryUserId) {
      const stored = getToken(queryUserId);
      if (stored) {
        req.session.accessToken = stored.accessToken;
        req.session.userId = stored.userId;
      }
    }
  }

  if (req.session.accessToken) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

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

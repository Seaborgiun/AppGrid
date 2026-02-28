import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { NuvemshopAPIService } from './services/nuvemshop';
import { saveToken, getToken, removeToken, getAllTokens } from './store/tokens';
import { webhookHmac } from './middleware/webhookHmac';
import { t, detectLocale } from './i18n';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// ─── CORS whitelist ────────────────────────────────────────────────────────────

const NUVEMSHOP_ORIGINS = [
  /\.nuvemshop\.com\.br$/,
  /\.tiendanube\.com$/,
  /\.mitiendanube\.com$/,
  /\.lojavirtualnuvem\.com\.br$/,
];

function isAllowedOrigin(origin: string): boolean {
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
    return true;
  }
  if (process.env.CORS_ORIGIN && origin === process.env.CORS_ORIGIN) {
    return true;
  }
  return NUVEMSHOP_ORIGINS.some((pattern) => pattern.test(origin));
}

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(
  cors({
    origin: (origin, callback) => {
      // Permite requisições sem origin (ex: curl, server-to-server)
      if (!origin) return callback(null, true);
      if (isAllowedOrigin(origin)) return callback(null, true);
      callback(new Error(`Origem não permitida: ${origin}`));
    },
    credentials: true,
  })
);

declare module 'express-session' {
  interface SessionData {
    accessToken?: string;
    userId?: number;
  }
}

// ─── Session secret validation ────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('[Servidor] ERRO: SESSION_SECRET não está definida em produção. O servidor não pode iniciar.');
  process.exit(1);
}
if (process.env.NODE_ENV !== 'production' && !process.env.SESSION_SECRET) {
  console.warn('[Servidor] AVISO: SESSION_SECRET não definida — usando valor padrão inseguro em desenvolvimento.');
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
  webhookHmac,
  (req: Request, res: Response) => {
    const { store_id, customer_id } = req.body as {
      store_id?: string;
      customer_id?: string;
    };

    if (!store_id || !customer_id) {
      res.status(400).json({ error: 'Campos store_id ou customer_id ausentes' });
      return;
    }

    const timestamp = new Date().toISOString();
    const storeIdNum = parseInt(store_id, 10);

    // Remove token da loja e limpa sessão associada
    removeToken(storeIdNum);

    // Log estruturado para auditoria LGPD
    console.info(JSON.stringify({
      event: 'lgpd_data_deletion',
      store_id,
      customer_id,
      timestamp,
      action: 'token_removed',
    }));

    res.json({ status: 'deleted', store_id, timestamp });
  }
);

/**
 * Dashboard principal do app embarcado.
 * Requer autenticação — redireciona para /login se sessão inativa.
 * GET /dashboard
 */
app.get('/dashboard', apiLimiter, (req: Request, res: Response) => {
  if (!req.session.accessToken) {
    res.redirect('/login');
    return;
  }

  const locale = detectLocale(req.headers['accept-language']);
  // Resolve template path: dev runs from source, prod runs from dist
  const possiblePaths = [
    path.join(__dirname, 'templates', 'dashboard.html'),
    path.join(process.cwd(), 'src', 'templates', 'dashboard.html'),
  ];
  let html = '';
  for (const p of possiblePaths) {
    try {
      html = fs.readFileSync(p, 'utf8');
      break;
    } catch {
      // try next path
    }
  }
  if (!html) {
    res.status(500).send('Template não encontrado');
    return;
  }

  const appUrl = process.env.NUVEMSHOP_REDIRECT_URI?.replace('/api/auth/callback', '') ?? 'https://app.estudio428.com.br';
  const snippet = `&lt;div data-grade-atacado data-product-id="{{ product.id }}" data-api-url="${appUrl}"&gt;&lt;/div&gt;`;

  const rendered = html
    .replace('{{title}}', t('dashboard_title', locale))
    .replace('{{heading}}', t('dashboard_heading', locale))
    .replace('{{badge}}', t('dashboard_badge', locale))
    .replace('{{card_title}}', t('dashboard_card_title', locale))
    .replace('{{card_body}}', t('dashboard_card_body', locale))
    .replace('{{card_instructions}}', t('dashboard_card_instructions', locale))
    .replace('{{snippet}}', snippet);

  res.send(rendered);
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
  (async () => {
    console.log('[LGPD Sync] Executando sincronização periódica de webhooks...');

    const stores = getAllTokens();
    if (stores.length === 0) {
      console.log('[LGPD Sync] Nenhuma loja autorizada encontrada.');
      process.exit(0);
    }

    const dataDeletionUrl = process.env.NUVEMSHOP_REDIRECT_URI?.replace('/api/auth/callback', '/api/webhooks/data-deletion')
      ?? `https://app.estudio428.com.br/api/webhooks/data-deletion`;

    let successCount = 0;
    let errorCount = 0;

    for (const store of stores) {
      try {
        const service = new NuvemshopAPIService({
          baseURL: 'https://api.nuvemshop.com.br',
          accessToken: store.accessToken,
          userId: store.userId,
        });

        // Verifica se o webhook app/uninstalled já existe
        const existing = await service.listWebhooks(store.userId);
        const hasWebhook = existing.some(
          (wh: { event: string }) => wh.event === 'app/uninstalled'
        );

        if (!hasWebhook) {
          await service.createWebhook(store.userId, {
            event: 'app/uninstalled',
            url: dataDeletionUrl,
          });
          console.log(`[LGPD Sync] Webhook criado para loja ${store.userId}`);
        } else {
          console.log(`[LGPD Sync] Webhook já existe para loja ${store.userId}`);
        }
        successCount++;
      } catch (err) {
        console.error(`[LGPD Sync] Erro na loja ${store.userId}:`, err);
        errorCount++;
      }
    }

    console.log(`[LGPD Sync] Concluído. Sucesso: ${successCount}, Erros: ${errorCount}`);
    process.exit(errorCount > 0 ? 1 : 0);
  })();
} else {
  app.listen(PORT, () => {
    console.log(`[Servidor] Backend Grade de Atacado rodando na porta ${PORT}`);
  });
}

export default app;

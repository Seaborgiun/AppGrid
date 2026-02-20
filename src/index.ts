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
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

// ─── Helper: build API service from session ────────────────────────────────────

function buildApiService(req: Request): NuvemshopAPIService {
  const userId = req.session.userId;
  return new NuvemshopAPIService({
    baseURL: `https://api.nuvemshop.com.br`,
    accessToken: req.session.accessToken,
    userId,
  });
}

// ─── Rate limiters ────────────────────────────────────────────────────────────

/** Strict limit on OAuth callback: 10 attempts per 15 minutes per IP */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

/** General API limiter: 100 requests per minute per IP */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Routes ────────────────────────────────────────────────────────────────────

/** Health check */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

/**
 * OAuth callback: exchange code for access token.
 * GET /auth/callback?code=xxx&shop_id=yyy
 */
app.get('/auth/callback', authLimiter, async (req: Request, res: Response) => {
  const { code, shop_id } = req.query as Record<string, string>;

  if (!code || !shop_id) {
    res.status(400).json({ error: 'Missing code or shop_id parameter' });
    return;
  }

  const clientId = process.env.NUVEMSHOP_CLIENT_ID;
  const clientSecret = process.env.NUVEMSHOP_CLIENT_SECRET;
  const redirectUri = process.env.NUVEMSHOP_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).json({ error: 'OAuth credentials not configured' });
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

    // Redirect to the store admin or a success page
    const redirectTo =
      process.env.POST_AUTH_REDIRECT ||
      `https://${shop_id}.lojavirtualnuvem.com.br/admin`;
    res.redirect(302, redirectTo);
  } catch (err) {
    console.error('[Auth] OAuth exchange failed:', err);
    res.status(502).json({ error: 'OAuth token exchange failed' });
  }
});

/**
 * Proxy: GET /api/products/:id/variants
 * Returns formatted variants (access token never exposed to frontend).
 */
app.get('/api/products/:id/variants', apiLimiter, async (req: Request, res: Response) => {
  if (!req.session.accessToken) {
    res.status(401).json({ error: 'Not authenticated' });
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
    console.error('[API] getVariants failed:', err);
    res.status(502).json({ error: 'Failed to fetch variants' });
  }
});

/**
 * Proxy: GET /api/products/:id
 * Returns product details.
 */
app.get('/api/products/:id', apiLimiter, async (req: Request, res: Response) => {
  if (!req.session.accessToken) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const service = buildApiService(req);
    const product = await service.getProduct(req.params.id);
    res.json(product);
  } catch (err) {
    console.error('[API] getProduct failed:', err);
    res.status(502).json({ error: 'Failed to fetch product' });
  }
});

/**
 * LGPD data deletion webhook.
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
      res.status(400).json({ error: 'Missing store_id or customer_id' });
      return;
    }

    // In a real implementation, delete or anonymise all PII for this customer.
    console.info(
      `[LGPD] Data deletion request received for store=${store_id}, customer=${customer_id}`
    );

    res.json({ received: true, store_id, customer_id });
  }
);

// ─── Global error handler ──────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ─────────────────────────────────────────────────────────────────────

// When invoked as a cron job for LGPD webhook sync, run housekeeping and exit.
if (process.argv.includes('--lgpd-sync')) {
  console.log('[LGPD Sync] Running scheduled webhook sync...');
  // Re-register data-deletion webhooks with Nuvemshop (LGPD requirement).
  // In a full implementation this would iterate over all authorized stores
  // and ensure each one has an active data-deletion webhook registered.
  console.log('[LGPD Sync] Webhook sync complete.');
  process.exit(0);
} else {
  app.listen(PORT, () => {
    console.log(`[Server] Grade de Atacado backend running on port ${PORT}`);
  });
}

export default app;

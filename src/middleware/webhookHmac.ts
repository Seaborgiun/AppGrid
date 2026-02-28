import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware de validação de assinatura HMAC-SHA256 para webhooks Nuvemshop.
 * Verifica o header `X-Linkedstore-HMAC-SHA256` usando o `WEBHOOK_HMAC_SECRET`
 * (deve ser o `client_secret` do app). Retorna 401 se a assinatura for inválida.
 */
export function webhookHmac(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.WEBHOOK_HMAC_SECRET;

  if (!secret) {
    // Em dev, sem secret configurado, permite com aviso
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Webhook] AVISO: WEBHOOK_HMAC_SECRET não definida — validação HMAC desativada em desenvolvimento.');
      next();
      return;
    }
    res.status(500).json({ error: 'Configuração de segurança ausente no servidor.' });
    return;
  }

  const signature = req.headers['x-linkedstore-hmac-sha256'] as string | undefined;
  if (!signature) {
    res.status(401).json({ error: 'Assinatura HMAC ausente.' });
    return;
  }

  const body = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64');

  let isValid = false;
  try {
    isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    isValid = false;
  }

  if (!isValid) {
    res.status(401).json({ error: 'Assinatura HMAC inválida.' });
    return;
  }

  next();
}

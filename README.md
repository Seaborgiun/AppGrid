# AppGrid – Grade de Atacado para Nuvemshop

Widget injectable de **Grade de Atacado** (wholesale product grid) para lojas Nuvemshop. Permite que lojistas adicionem múltiplas variantes de produto ao carrinho de uma só vez através de uma tabela Cor × Tamanho.

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + TypeScript + TailwindCSS |
| Backend | Node.js 22 + Express |
| API | Nuvemshop REST v2025-03 |
| Auth | OAuth 2.0 Authorization Code Flow |
| Testes | Jest + MSW + React Testing Library |
| Build | Webpack (widget) + TypeScript compiler (backend) |

---

## Pré-requisitos

- Node.js ≥ 22
- npm ≥ 10
- Conta de parceiro Nuvemshop com app registrado

---

## Configuração

### 1. Instalar dependências

```bash
npm install
```

### 2. Variáveis de ambiente

Copie `.env.example` para `.env` e preencha os valores:

```bash
cp .env.example .env
```

| Variável | Descrição |
|----------|-----------|
| `NUVEMSHOP_CLIENT_ID` | Client ID do app no portal de parceiros |
| `NUVEMSHOP_CLIENT_SECRET` | Client Secret do app |
| `NUVEMSHOP_REDIRECT_URI` | URL de callback OAuth (ex: `https://seuapp.com/api/auth/callback`) |
| `NUVEMSHOP_APP_ID` | ID do app na Nuvemshop (para rota `/login` embedded) |
| `NUVEMSHOP_SCOPES` | Escopos OAuth (ex: `write_products,read_orders`) |
| `NODE_ENV` | `development` ou `production` |
| `PORT` | Porta do servidor Express (padrão: `3000`) |
| `SESSION_SECRET` | String aleatória segura para assinar sessões (**obrigatório em produção**) |
| `TOKEN_ENCRYPTION_KEY` | Chave AES-256-GCM para criptografar tokens (64 chars hex) |
| `WEBHOOK_HMAC_SECRET` | Segredo HMAC para validar webhooks (= `NUVEMSHOP_CLIENT_SECRET`) |
| `CORS_ORIGIN` | Origem adicional permitida para CORS |
| `WIDGET_API_URL` | URL base da API para o widget NubeSDK |
| `WIDGET_CDN_URL` | URL base do CDN para o widget |
| `MAX_VARIANTS_PER_GRID` | Limite de variantes por grade (padrão: `200`) |

---

## Desenvolvimento

### Iniciar backend (hot-reload)

```bash
npm run dev
```

### Build backend

```bash
npm run build
# Gera: dist/src/index.js + dist/src/templates/
```

### Build widget

```bash
npm run build:widget
# Gera: dist-widget/widget.js + dist-widget/widget.css
```

### Executar testes

```bash
npm test
```

---

## Requisitos para Homologação

Checklist de requisitos técnicos para publicação na App Store Nuvemshop:

- [x] **Criptografia AES-256-GCM** para tokens armazenados (`TOKEN_ENCRYPTION_KEY`)
- [x] **Validação HMAC-SHA256** nos webhooks (`WEBHOOK_HMAC_SECRET`)
- [x] **Session secret obrigatório** em produção (`SESSION_SECRET`)
- [x] **CORS restrito** a domínios Nuvemshop/Tiendanube
- [x] **Webhook LGPD** com exclusão real de dados e log de auditoria
- [x] **Cron LGPD** com sincronização real de webhooks por loja
- [x] **ErrorBoundary Nexo** para apps incorporados
- [x] **Suporte multilíngue** pt-BR e espanhol

---

## Segurança

### Criptografia de tokens

Os tokens de acesso OAuth são criptografados com **AES-256-GCM** antes de serem salvos em disco. Para habilitar:

1. Gere uma chave de 32 bytes:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Defina `TOKEN_ENCRYPTION_KEY` no `.env` com o valor gerado (64 caracteres hexadecimais).

> Em desenvolvimento sem `TOKEN_ENCRYPTION_KEY`, os tokens são salvos em texto plano com um aviso no console. Em produção, é **fortemente recomendado** definir esta variável.

### Validação HMAC de webhooks

O endpoint `POST /api/webhooks/data-deletion` valida a assinatura `X-Linkedstore-HMAC-SHA256` de cada requisição usando `WEBHOOK_HMAC_SECRET` (= `client_secret` do app). A comparação usa `crypto.timingSafeEqual` para evitar timing attacks.

---

## Suporte Multilíngue

O app suporta **pt-BR** (padrão) e **espanhol**. O idioma é detectado via header `Accept-Language`.

Strings traduzidas em `src/i18n/pt.json` e `src/i18n/es.json`:
- Interface do dashboard
- Mensagens do widget (busca, estoque, carrinho, erros)

---

## NubeSDK (Patagonia)

O arquivo `src/nube-sdk/main.ts` é o entry point alternativo para temas **Patagonia** da Nuvemshop/Tiendanube. Exporta a função `App(nube: NubeSDK)` conforme o padrão NubeSDK.

O widget React legado (`src/widget.tsx`) permanece como fallback para temas não-Patagonia.

Para compilar o entry point NubeSDK, adicione ao `webpack.widget.js` uma entrada separada apontando para `src/nube-sdk/main.ts`.

---

## Fluxo OAuth

1. Redirecione o lojista para:
   ```
   https://www.nuvemshop.com.br/apps/{CLIENT_ID}/authorize
   ```
2. Nuvemshop redireciona para `NUVEMSHOP_REDIRECT_URI?code=xxx` (apenas o `code`, sem `shop_id`)
3. O backend troca o code pelo access_token via `POST /apps/authorize/token`
4. O `user_id` da loja é retornado junto com o `access_token` (não na URL de redirect)
5. O token é **criptografado** e armazenado no servidor (**nunca exposto ao frontend**)

---

## Instalação do Widget na Loja

Adicione ao tema da loja Nuvemshop (ex: `templates/product.html`):

```html
<!-- Widget container -->
<div
  data-grade-atacado
  data-product-id="{{ product.id }}"
  data-api-url="https://seuapp.com"
></div>

<!-- Widget assets (CDN) -->
<link rel="stylesheet" href="https://cdn.seuapp.com/widget/v1/widget.css">
<script src="https://cdn.seuapp.com/widget/v1/widget.js" defer></script>
```

---

## API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/health` | Health check |
| `GET` | `/api/auth/callback` | Callback OAuth |
| `GET` | `/callback` | Alias de compatibilidade para `/api/auth/callback` |
| `GET` | `/api/products/:id/variants` | Variantes formatadas |
| `GET` | `/api/products/:id` | Detalhes do produto |
| `POST` | `/api/webhooks/data-deletion` | Webhook LGPD (requer HMAC) |
| `GET` | `/dashboard` | Dashboard do app (requer autenticação) |

---

## Deploy (Render.com)

O arquivo `render.yaml` define automaticamente:
- **Web Service** – backend Node.js
- **Static Site** – widget CDN
- **Cron Job** – sincronização LGPD diária (via `--lgpd-sync`)

```bash
# Deploy manual via Render CLI
render up
```

Ou conecte o repositório ao Render via dashboard e o deploy será automático a cada push na branch `main`.

---

## Estrutura do Projeto

```
├── src/
│   ├── index.ts                      # Express backend
│   ├── widget.tsx                    # Entry point do widget React
│   ├── services/
│   │   └── nuvemshop.ts              # Nuvemshop API service
│   ├── store/
│   │   └── tokens.ts                 # Armazenamento criptografado de tokens
│   ├── middleware/
│   │   └── webhookHmac.ts            # Validação HMAC para webhooks
│   ├── components/
│   │   ├── VariantGrid/
│   │   │   └── VariantGrid.tsx       # Componente principal
│   │   └── ErrorBoundary.tsx         # ErrorBoundary Nexo
│   ├── nexo/
│   │   └── nexoClient.ts             # Cliente Nexo para apps incorporados
│   ├── nube-sdk/
│   │   └── main.ts                   # Entry point NubeSDK (Patagonia)
│   ├── i18n/
│   │   ├── pt.json                   # Strings em português
│   │   ├── es.json                   # Strings em espanhol
│   │   └── index.ts                  # Helper de tradução
│   ├── templates/
│   │   └── dashboard.html            # Template do dashboard
│   └── utils/
│       └── cart-injector.js          # Injetor de carrinho
├── types/
│   └── nuvemshop.ts                  # TypeScript interfaces
├── __tests__/
│   ├── services/nuvemshop.test.ts
│   └── components/VariantGrid.test.tsx
├── dist/                             # Backend compilado
├── dist-widget/                      # Widget compilado
├── render.yaml                       # Deploy Render.com
└── .env.example                      # Exemplo de variáveis
```

---

## Notas de Implementação

- A API Nuvemshop usa `Authentication: bearer {token}` (não `Authorization: Bearer`)
- Rate limit: 2 req/seg por loja → retry com exponential backoff em HTTP 429
- O `access_token` **nunca** é enviado ao frontend (proxy pattern)
- Tokens salvos em disco com criptografia AES-256-GCM quando `TOKEN_ENCRYPTION_KEY` está definida
- Widget alvo: < 50KB gzipped
- Design mobile-first com TailwindCSS

---

## Licença

Veja [LICENSE](LICENSE).

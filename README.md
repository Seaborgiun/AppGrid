# AppGrid – Grade de Atacado para Nuvemshop

Widget injectable de **Grade de Atacado** (wholesale product grid) para lojas Nuvemshop. Permite que lojistas adicionem múltiplas variantes de produto ao carrinho de uma só vez através de uma tabela Cor × Tamanho.

---

## 🚀 Como obter os arquivos do projeto

> **Não consegue ver os arquivos?** Siga os passos abaixo para mesclar o PR na `main` ou acessar os arquivos diretamente.

---

### ✅ Passo 1 – Publicar o PR (mesclar na `main`)

> ⚠️ O PR pode estar em modo **Rascunho (Draft)**. Nesse caso, o botão "Merge pull request" **não aparece**. Você precisa ativá-lo primeiro:

1. Acesse: **[https://github.com/Seaborgiun/AppGrid/pull/2](https://github.com/Seaborgiun/AppGrid/pull/2)**
2. Role até o final da página.
3. Se aparecer o botão **"Ready for review"** (em cinza), **clique nele** para sair do modo rascunho.
4. Agora aparecerá o botão verde **"Merge pull request"** — clique nele.
5. Confirme clicando em **"Confirm merge"**.

Pronto! Os arquivos estarão na branch `main`.

---

### 💻 Passo 2 – Acessar os arquivos pelo terminal

#### Se você ainda **não tem** a pasta AppGrid no computador:

```bash
git clone https://github.com/Seaborgiun/AppGrid.git
cd AppGrid
```

#### Se você **já tem** a pasta AppGrid (erro `already exists`):

```bash
# Entre na pasta existente
cd AppGrid

# Baixe as atualizações do GitHub
git fetch origin

# Acesse a branch com todos os arquivos
git checkout copilot/add-product-grade-widget

# Instale as dependências
npm install

# Copie o arquivo de variáveis de ambiente
cp .env.example .env
# Edite o .env com suas credenciais Nuvemshop

# Inicie o servidor
npm run dev
```

> **Nota:** Se você já fez o merge (Passo 1), use `git checkout main && git pull origin main` em vez de `checkout copilot/add-product-grade-widget`.

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
| `NUVEMSHOP_REDIRECT_URI` | URL de callback OAuth (ex: `https://seuapp.com/auth/callback`) |
| `NODE_ENV` | `development` ou `production` |
| `PORT` | Porta do servidor Express (padrão: `3000`) |
| `SESSION_SECRET` | String aleatória segura para assinar sessões |
| `CORS_ORIGIN` | Origem permitida para CORS |
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
# Gera: dist/src/index.js
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

## Fluxo OAuth

1. Redirecione o lojista para:
   ```
   https://www.nuvemshop.com.br/apps/{CLIENT_ID}/authorize
   ```
2. Nuvemshop redireciona para `NUVEMSHOP_REDIRECT_URI?code=xxx&shop_id=yyy`
3. O backend troca o code pelo access_token via `POST /apps/authorize/token`
4. O token é armazenado na sessão do servidor (**nunca exposto ao frontend**)

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
| `GET` | `/auth/callback` | Callback OAuth |
| `GET` | `/api/products/:id/variants` | Variantes formatadas |
| `GET` | `/api/products/:id` | Detalhes do produto |
| `POST` | `/api/webhooks/data-deletion` | Webhook LGPD |

---

## Deploy (Render.com)

O arquivo `render.yaml` define automaticamente:
- **Web Service** – backend Node.js
- **Static Site** – widget CDN
- **Cron Job** – sincronização LGPD diária

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
│   ├── widget.tsx                    # Entry point do widget
│   ├── services/
│   │   └── nuvemshop.ts              # Nuvemshop API service
│   ├── components/
│   │   └── VariantGrid/
│   │       └── VariantGrid.tsx       # Componente principal
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
- Widget alvo: < 50KB gzipped
- Design mobile-first com TailwindCSS

---

## Licença

Veja [LICENSE](LICENSE).

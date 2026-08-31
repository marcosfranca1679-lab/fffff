# ⛏️ Mapa Bermuda — Sistema de Whitelist

Sistema de whitelist para servidor **Minecraft Bedrock Edition**, com painel de administração web e integração via API para addons/mods.

## 🚀 Funcionalidades

- 🎮 **Página do jogador** — solicita acesso pelo Nick do Minecraft
- 🔐 **Painel Admin** — aprova, rejeita ou remove jogadores
- 🔍 **Busca de jogadores** no painel admin
- 📊 **Estatísticas** em tempo real (pendentes / aprovados / rejeitados)
- 🛡️ **Proteção brute-force** — bloqueio após 10 tentativas de login
- ✅ **Validação de nick** — apenas nicks válidos do Minecraft (3-16 chars, letras/números/_)
- 🔑 **Troca de senha** pelo painel admin
- 🎯 **API para Addon Bedrock** — verificação de whitelist em tempo real

## 📁 Estrutura do Projeto

```
fffff/
├── server.js        # Servidor Express (API REST)
├── database.js      # Configuração do banco SQLite
├── package.json     # Dependências do projeto
├── public/
│   ├── index.html   # Página do jogador
│   └── admin.html   # Painel de administração
└── data/
    └── whitelist.db # Banco de dados (gerado automaticamente)
```

## ⚙️ Instalação

### Pré-requisitos
- [Node.js](https://nodejs.org/) v16 ou superior

### Passo a passo

```bash
# 1. Clone o repositório
git clone https://github.com/marcosfranca1679-lab/fffff.git
cd fffff

# 2. Instale as dependências
npm install

# 3. (Opcional) Configure variáveis de ambiente
# Crie um arquivo .env na raiz do projeto:
#   ADMIN_USER=meuadmin
#   ADMIN_PASS=minha_senha_segura
#   SESSION_SECRET=chave_secreta_aleatoria
#   PORT=3000

# 4. Inicie o servidor
npm start
```

O servidor estará disponível em: **http://localhost:3000**

## 🔐 Acesso Admin

| URL | Descrição |
|-----|-----------|
| `http://localhost:3000/` | Página do jogador |
| `http://localhost:3000/admin.html` | Painel de administração |

**Credenciais padrão:**
- Usuário: `admin`
- Senha: `MinecraftAdmin@2025`

> ⚠️ **IMPORTANTE:** Troque a senha padrão pelo painel Admin ou via variável de ambiente `ADMIN_PASS` antes de usar em produção!

## 🌐 API

### Endpoints Públicos

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/request` | Solicitar acesso à whitelist |
| `GET` | `/api/status/:nick` | Verificar status do pedido |
| `GET` | `/api/check/:nick` | Verificar se nick está na whitelist (usado pelo addon) |

### Endpoints Admin (requer autenticação)

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/admin/login` | Login do administrador |
| `POST` | `/api/admin/logout` | Logout |
| `GET` | `/api/admin/players` | Listar jogadores (aceita `?search=nick`) |
| `GET` | `/api/admin/stats` | Estatísticas rápidas |
| `POST` | `/api/admin/approve/:nick` | Aprovar jogador |
| `POST` | `/api/admin/reject/:nick` | Rejeitar jogador |
| `DELETE` | `/api/admin/remove/:nick` | Remover jogador |
| `POST` | `/api/admin/add` | Adicionar nick manualmente como aprovado |
| `POST` | `/api/admin/change-password` | Trocar senha do admin |

### Exemplo de uso pelo Addon Bedrock

```javascript
// No seu addon, ao jogador entrar no servidor:
fetch(`https://seu-servidor.com/api/check/${playerNick}`)
  .then(r => r.json())
  .then(data => {
    if (!data.allowed) {
      // Kickar o jogador
    }
  });
```

## 🛠️ Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3000` | Porta do servidor |
| `ADMIN_USER` | `admin` | Nome do administrador |
| `ADMIN_PASS` | `MinecraftAdmin@2025` | Senha padrão (troque!) |
| `SESSION_SECRET` | Aleatório | Segredo para sessões |

## 📝 Licença

Projeto open-source. Use e modifique à vontade!

---

Feito com ❤️ para a comunidade Minecraft Bedrock 🎮

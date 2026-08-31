# 📦 Addon de Whitelist — Minecraft Bedrock

Este addon (Behavior Pack) verifica automaticamente se os jogadores estão cadastrados e aprovados na whitelist da sua API web quando eles entram no servidor.

---

## 📋 Requisitos
- **Minecraft Bedrock Dedicated Server (BDS)** ou servidor compatível com Scripting API.
- Servidor com suporte ao módulo `@minecraft/server-net` (habilite em `server.properties` / `permissions.json` se necessário).

---

## 🛠️ Como Instalar no Servidor

1. Baixe ou copie a pasta `addon/` para dentro do diretório `behavior_packs/` do seu servidor Bedrock:
   ```
   seu-servidor-bedrock/
   ├── behavior_packs/
   │   └── mapa_bermuda_whitelist/
   │       ├── manifest.json
   │       └── scripts/
   │           └── whitelist.js
   ```
2. Adicione o addon ao arquivo `valid_known_packs.json` e ative-o no arquivo `world_behavior_packs.json` do seu mundo:
   ```json
   [
     {
       "pack_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
       "version": [1, 0, 0]
     }
   ]
   ```
3. Inicie o servidor Bedrock!

---

## ⚙️ Configurações (`scripts/whitelist.js`)

- **`API_URL`**: Altere se mudar de domínio:
  ```js
  const API_URL = "https://fffff-autoforge.vercel.app/api/check";
  ```
- **`ADMINS_BYPASS`**: Lista de nicks que nunca serão kickados:
  ```js
  const ADMINS_BYPASS = ["admin", "Marcos"];
  ```

---

## 🎮 Comandos In-Game (Admin)

Para checar se um nick está na whitelist manualmente pelo chat/console:
```
/scriptevent whitelist:check Steve123
```

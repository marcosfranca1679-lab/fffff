import { world, system } from "@minecraft/server";
import { http, HttpRequest, HttpRequestMethod } from "@minecraft/server-net";

// ─── Configuração ─────────────────────────────────────────────────────────────
const API_URL = "https://fffff-autoforge.vercel.app/api/check";

// Mensagem exibida ao jogador kickado (§c = vermelho, §e = amarelo, §f = branco)
const KICK_REASON = "Voce nao esta na Whitelist! Peca acesso em: fffff-autoforge.vercel.app";

// Admins que nunca são kickados (nicknames exatos)
const ADMINS_BYPASS = ["admin", "Marcos"];

// Tempo de espera antes de checar (ticks) — 60 ticks = 3 segundos
const CHECK_DELAY_TICKS = 60;

// ─── Lógica principal ─────────────────────────────────────────────────────────

world.afterEvents.playerSpawn.subscribe(async (event) => {
  // Só executa na primeira vez que o jogador entra na sessão (não ao renascer de morte)
  if (!event.initialSpawn) return;

  const player = event.player;
  if (!player || !player.isValid()) return;

  const nick = player.name;

  // Admins do bypass nunca são kickados
  if (ADMINS_BYPASS.includes(nick)) {
    player.sendMessage("§a✅ [Whitelist] Admin detectado! Acesso liberado.");
    return;
  }

  // Aguarda alguns ticks para o jogador carregar completamente no mundo
  await delay(CHECK_DELAY_TICKS);

  // Re-verifica se o jogador ainda está online e válido
  if (!player.isValid()) return;

  // Avisa que está verificando
  player.sendMessage("§e⏳ [Whitelist] Verificando sua permissão...");

  try {
    const allowed = await verificarWhitelist(nick);

    if (allowed) {
      player.sendMessage("§a✅ [Whitelist] Acesso liberado! Bem-vindo ao Mapa Bermuda!");
    } else {
      player.sendMessage("§c❌ [Whitelist] Seu nick não está aprovado.");
      await delay(20); // 1 segundo
      
      // Executa o kick usando API moderna do Minecraft Bedrock 1.21+
      system.run(() => {
        try {
          const dimension = world.getDimension("overworld");
          dimension.runCommandAsync(`kick "${nick}" §c${KICK_REASON}`);
        } catch (e) {
          console.error(`[Whitelist] Erro ao kickar ${nick}:`, e);
        }
      });
    }
  } catch (err) {
    // Se a API web estiver fora do ar ou sem internet, avisa no log
    world.sendMessage(`§c[Whitelist] §eAviso: Erro ao verificar ${nick} na API.`);
    console.error(`[Whitelist] Erro na API para ${nick}:`, err);
  }
});

// ─── Função que chama a API Web ───────────────────────────────────────────────
async function verificarWhitelist(nick) {
  const url = `${API_URL}/${encodeURIComponent(nick)}`;

  const request = new HttpRequest(url);
  request.method = HttpRequestMethod.Get;
  request.headers = [
    { key: "Content-Type", value: "application/json" },
    { key: "User-Agent",   value: "MinecraftBedrock-1.21-Whitelist/1.1" }
  ];
  request.timeout = 8; // 8 segundos de timeout

  const response = await http.request(request);

  if (response.status !== 200) {
    throw new Error(`API retornou status HTTP ${response.status}`);
  }

  const data = JSON.parse(response.body);
  return data.allowed === true;
}

// ─── Helper: delay assíncrono em ticks ────────────────────────────────────────
function delay(ticks) {
  return new Promise(resolve => system.runTimeout(resolve, ticks));
}

// ─── Comando de admin in-game: /scriptevent whitelist:check <nick> ─────────────
system.afterEvents.scriptEventReceive.subscribe(async (event) => {
  if (event.id !== "whitelist:check") return;

  const nick = event.message ? event.message.trim() : "";
  if (!nick) {
    event.sourceEntity?.sendMessage("§cUso: /scriptevent whitelist:check <nick>");
    return;
  }

  try {
    const allowed = await verificarWhitelist(nick);
    const msg = allowed
      ? `§a✅ [Whitelist] '${nick}' ESTÁ na whitelist.`
      : `§c❌ [Whitelist] '${nick}' NÃO está na whitelist.`;
    event.sourceEntity?.sendMessage(msg);
  } catch (err) {
    event.sourceEntity?.sendMessage(`§c[Whitelist] Erro ao consultar API: ${err.message}`);
  }
});

console.log("[Whitelist] ✅ Addon carregado com sucesso para Minecraft Bedrock 1.21+!");

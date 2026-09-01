import { world, system } from "@minecraft/server";
import { http, HttpRequest, HttpRequestMethod } from "@minecraft/server-net";

// ─── Configuração ─────────────────────────────────────────────────────────────
const API_URL = "https://fffff-autoforge.vercel.app/api/check";

// Mensagem exibida ao jogador kickado
const KICK_REASON = "Voce nao esta na Whitelist! Peca acesso no site do servidor.";

// Admins que nunca são kickados (coloque seu Nick aqui)
const ADMINS_BYPASS = ["admin", "Marcos", "marcosfranca1679"];

// Tempo de espera antes de checar (ticks) — 40 ticks = 2 segundos
const CHECK_DELAY_TICKS = 40;

// ─── Evento quando jogador entra no servidor ──────────────────────────────────
world.afterEvents.playerSpawn.subscribe(async (event) => {
  // Executa apenas na entrada inicial no servidor
  if (!event.initialSpawn) return;

  const player = event.player;
  if (!player || !player.isValid()) return;

  const nick = player.name;

  // Se for admin na lista de bypass, libera direto
  if (ADMINS_BYPASS.some(adminNick => adminNick.toLowerCase() === nick.toLowerCase())) {
    player.sendMessage("§a✅ [Whitelist] Admin detectado! Acesso liberado.");
    return;
  }

  // Aguarda 2 segundos para o jogador terminar de carregar
  await delay(CHECK_DELAY_TICKS);

  if (!player.isValid()) return;

  player.sendMessage("§e⏳ [Whitelist] Verificando sua permissão...");

  let isAllowed = false;
  let errorMsg = null;

  try {
    const res = await verificarWhitelist(nick);
    isAllowed = res.allowed === true;
    if (!isAllowed && res.message) {
      errorMsg = res.message;
    }
  } catch (err) {
    console.error(`[Whitelist] Erro ao consultar API para ${nick}:`, err);
    errorMsg = err.message;
    isAllowed = false; // MODO RESTRITO: Sem resposta da API = Não entra!
  }

  // Re-verifica se o player ainda está online
  if (!player.isValid()) return;

  if (isAllowed) {
    player.sendMessage("§a✅ [Whitelist] Acesso liberado! Bom jogo.");
  } else {
    // Jogador NÃO aprovado ou erro na API -> KICK OBRIGATÓRIO
    player.sendMessage("§c❌ [Whitelist] Acesso negado! Você não está aprovado.");
    if (errorMsg) {
      player.sendMessage(`§7Motivo: ${errorMsg}`);
    }

    await delay(30); // 1.5s para exibir o texto

    // Executa kick com fallback
    system.run(() => {
      try {
        const overworld = world.getDimension("overworld");
        overworld.runCommandAsync(`kick "${nick}" §c${KICK_REASON}`);
      } catch (e) {
        console.error(`[Whitelist] Erro no comando kick:`, e);
      }
    });
  }
});

// ─── Requisição HTTP para a API ───────────────────────────────────────────────
async function verificarWhitelist(nick) {
  const url = `${API_URL}/${encodeURIComponent(nick)}`;

  const request = new HttpRequest(url);
  request.method = HttpRequestMethod.Get;
  request.headers = [
    { key: "Content-Type", value: "application/json" },
    { key: "User-Agent",   value: "MinecraftBedrock-Whitelist/2.0" }
  ];
  request.timeout = 6; // 6 segundos de timeout

  const response = await http.request(request);

  // Se a Vercel retornar HTML (tela de login da Vercel) ou erro
  if (response.status !== 200) {
    throw new Error(`API retornou status HTTP ${response.status} (Verifique protecao Vercel)`);
  }

  try {
    const data = JSON.parse(response.body);
    return data;
  } catch (parseError) {
    throw new Error("Resposta da API nao e JSON valido (Desative Vercel Authentication)");
  }
}

function delay(ticks) {
  return new Promise(resolve => system.runTimeout(resolve, ticks));
}

// ─── Comando Admin in-game: /scriptevent whitelist:check <nick> ────────────────
system.afterEvents.scriptEventReceive.subscribe(async (event) => {
  if (event.id !== "whitelist:check") return;

  const nick = event.message ? event.message.trim() : "";
  if (!nick) {
    event.sourceEntity?.sendMessage("§cUso: /scriptevent whitelist:check <nick>");
    return;
  }

  event.sourceEntity?.sendMessage(`§e[Whitelist] Consultando '${nick}'...`);
  try {
    const res = await verificarWhitelist(nick);
    const msg = res.allowed
      ? `§a✅ [Whitelist] '${nick}' ESTÁ aprovado!`
      : `§c❌ [Whitelist] '${nick}' NÃO está aprovado.`;
    event.sourceEntity?.sendMessage(msg);
  } catch (err) {
    event.sourceEntity?.sendMessage(`§c[Whitelist] Erro na API: ${err.message}`);
  }
});

console.log("[Whitelist] ✅ Addon v2.0 (Strict Mode) inicializado!");

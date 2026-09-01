import { world, system } from "@minecraft/server";
import { http, HttpRequest, HttpRequestMethod } from "@minecraft/server-net";

// ─── Configuração da API Web (Node.js + Supabase) ─────────────────────────────
const API_URL = "https://fffff-autoforge.vercel.app/api/check";

// Admins que nunca são bloqueados (bypass de emergência)
const ADMINS_BYPASS = ["admin", "marcos", "marcosfranca1679"];

// Cache de jogadores verificados para economizar requisições
const verifiedAllowed = new Set();
const checking = new Set();

// ─── Punição e Expulsão do Jogador ────────────────────────────────────────────
function expulsarJogador(player, motivo) {
  try {
    const nick = player.name;

    // 1. Trava controles e câmera
    if (player.inputPermissions) {
      player.inputPermissions.movementEnabled = false;
      player.inputPermissions.cameraEnabled = false;
    }

    // 2. Efeitos visuais de bloqueio
    player.addEffect("blindness", 600, { amplifier: 255, showParticles: false });
    player.addEffect("slowness", 600, { amplifier: 255, showParticles: false });

    // 3. Título grande na tela
    player.onScreenDisplay.setTitle("§c§lACESSO NEGADO", {
      stayDuration: 80,
      fadeInDuration: 0,
      fadeOutDuration: 10,
      subtitle: `§e${motivo}`
    });

    // 4. Teleporta para o vazio e expulsa
    player.teleport({ x: 0, y: -100, z: 0 });

    const overworld = world.getDimension("overworld");
    overworld.runCommandAsync(`kick "${nick}" §c${motivo}`).catch(() => {});
  } catch (err) {
    console.error(`[Whitelist] Erro ao expulsar ${player.name}:`, err);
  }
}

// ─── Consulta HTTP à API Node.js / Supabase ──────────────────────────────────
async function verificarNaAPI(nick) {
  const url = `${API_URL}/${encodeURIComponent(nick)}`;
  const request = new HttpRequest(url);
  request.method = HttpRequestMethod.Get;
  request.headers = [
    { key: "Content-Type", value: "application/json" },
    { key: "User-Agent",   value: "MinecraftBedrock-HTTP-Whitelist/1.0" }
  ];
  request.timeout = 5; // 5 segundos de timeout

  const response = await http.request(request);

  if (response.status !== 200) {
    throw new Error(`API retornou status HTTP ${response.status}`);
  }

  const data = JSON.parse(response.body);
  return data.allowed === true;
}

// ─── Lógica de Verificação do Jogador ─────────────────────────────────────────
async function processarEntrada(player) {
  if (!player || !player.isValid()) return;

  const nick = player.name;
  const lowerNick = nick.toLowerCase();

  // Se for admin na lista de bypass
  if (ADMINS_BYPASS.includes(lowerNick) || verifiedAllowed.has(lowerNick)) {
    if (player.inputPermissions) {
      player.inputPermissions.movementEnabled = true;
      player.inputPermissions.cameraEnabled = true;
    }
    return;
  }

  if (checking.has(lowerNick)) return;
  checking.add(lowerNick);

  player.sendMessage("§e⏳ [Whitelist] Consultando permissão no banco de dados...");

  let permitido = false;
  let mensagemErro = "Nick não aprovado no site";

  try {
    permitido = await verificarNaAPI(nick);
  } catch (err) {
    console.error(`[Whitelist] Falha na requisição HTTP para ${nick}:`, err);
    mensagemErro = `Erro de conexão com API (${err.message || 'Sem resposta'})`;
    permitido = false;
  } finally {
    checking.delete(lowerNick);
  }

  if (!player.isValid()) return;

  if (permitido) {
    verifiedAllowed.add(lowerNick);
    if (player.inputPermissions) {
      player.inputPermissions.movementEnabled = true;
      player.inputPermissions.cameraEnabled = true;
    }
    player.sendMessage("§a✅ [Whitelist] Acesso confirmado no banco de dados! Bom jogo.");
  } else {
    player.sendMessage(`§c❌ [Whitelist] Acesso negado! (${mensagemErro})`);
    player.sendMessage("§ePeça liberação em: fffff-autoforge.vercel.app");
    expulsarJogador(player, mensagemErro);
  }
}

// ─── Evento 1: Quando o jogador nasce no servidor ─────────────────────────────
world.afterEvents.playerSpawn.subscribe((event) => {
  if (event.player && event.player.isValid()) {
    processarEntrada(event.player);
  }
});

// ─── Evento 2: Varredura de segurança periódica ──────────────────────────────
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    if (player && player.isValid()) {
      const lower = player.name.toLowerCase();
      if (!ADMINS_BYPASS.includes(lower) && !verifiedAllowed.has(lower)) {
        processarEntrada(player);
      }
    }
  }
}, 40); // a cada 2 segundos

// ─── Comando Admin in-game para consultar qualquer nick ───────────────────────
// Uso: /scriptevent whitelist:check NickDoJogador
system.afterEvents.scriptEventReceive.subscribe(async (e) => {
  if (e.id !== "whitelist:check") return;

  const target = (e.message || "").trim();
  if (!target) {
    world.sendMessage("§cUso: /scriptevent whitelist:check <Nick>");
    return;
  }

  world.sendMessage(`§e[Whitelist] Consultando '${target}' na API...`);
  try {
    const permitido = await verificarNaAPI(target);
    world.sendMessage(permitido
      ? `§a✅ [Whitelist] '${target}' ESTÁ aprovado no banco de dados!`
      : `§c❌ [Whitelist] '${target}' NÃO está aprovado no banco de dados.`
    );
  } catch (err) {
    world.sendMessage(`§c[Whitelist] Erro ao consultar API: ${err.message}`);
  }
});

console.log("[Whitelist] ✅ Addon com @minecraft/server-net carregado!");

import { world, system } from "@minecraft/server";
import { http, HttpRequest, HttpRequestMethod } from "@minecraft/server-net";

const API_URL = "https://fffff-autoforge.vercel.app/api/check";
const ADMINS_BYPASS = ["admin", "marcos", "marcosfranca1679"];

const approvedNicks = new Set();
const blockedNicks = new Set();

// ─── Mensagem de confirmação que o script está vivo no servidor ───────────────
system.runTimeout(() => {
  try {
    world.sendMessage("§a§l[Whitelist v4.0] §r§eSistema de segurança CARREGADO e ATIVO!");
  } catch (e) {}
}, 20);

// ─── Punição e Bloqueio ───────────────────────────────────────────────────────
function punirJogador(player, motivo) {
  try {
    if (player.inputPermissions) {
      player.inputPermissions.movementEnabled = false;
      player.inputPermissions.cameraEnabled = false;
    }
    player.addEffect("blindness", 400, { amplifier: 255, showParticles: false });
    player.addEffect("slowness", 400, { amplifier: 255, showParticles: false });

    player.onScreenDisplay.setTitle("§c§lACESSO NEGADO", {
      stayDuration: 80,
      fadeInDuration: 0,
      fadeOutDuration: 10,
      subtitle: `§e${motivo}`
    });

    player.teleport({ x: 0, y: -100, z: 0 });

    const overworld = world.getDimension("overworld");
    overworld.runCommandAsync(`kick "${player.name}" §c${motivo}`).catch(() => {});
  } catch (e) {
    console.error("Erro ao punir:", e);
  }
}

// ─── Verificação do jogador ───────────────────────────────────────────────────
async function checarJogador(player) {
  if (!player || !player.isValid()) return;

  const nick = player.name;
  const lower = nick.toLowerCase();

  if (ADMINS_BYPASS.includes(lower)) {
    approvedNicks.add(lower);
    player.sendMessage("§a👑 [Whitelist] Bem-vindo Administrador!");
    return;
  }

  if (approvedNicks.has(lower)) return;
  if (blockedNicks.has(lower)) {
    punirJogador(player, "Você não está na Whitelist!");
    return;
  }

  player.sendMessage("§e⏳ [Whitelist] Consultando permissão...");

  let allowed = false;
  let erro = "Não aprovado";

  try {
    const url = `${API_URL}/${encodeURIComponent(nick)}`;
    const req = new HttpRequest(url);
    req.method = HttpRequestMethod.Get;
    req.timeout = 5;
    const res = await http.request(req);

    if (res.status === 200) {
      const data = JSON.parse(res.body);
      allowed = data.allowed === true;
    } else {
      erro = `API erro ${res.status}`;
    }
  } catch (err) {
    erro = `Sem conexao com API (${err.message || 'Bloqueio de rede'})`;
    allowed = false;
  }

  if (!player.isValid()) return;

  if (allowed) {
    approvedNicks.add(lower);
    blockedNicks.delete(lower);
    if (player.inputPermissions) {
      player.inputPermissions.movementEnabled = true;
      player.inputPermissions.cameraEnabled = true;
    }
    player.sendMessage("§a✅ [Whitelist] Acesso liberado! Bom jogo!");
  } else {
    blockedNicks.add(lower);
    player.sendMessage(`§c❌ [Whitelist] Acesso Negado! (${erro})`);
    player.sendMessage("§eSolicite acesso no site do servidor!");
    punirJogador(player, erro);
  }
}

// ─── Monitoramento em tempo real ──────────────────────────────────────────────
world.afterEvents.playerSpawn.subscribe((event) => {
  if (event.player) checarJogador(event.player);
});

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    if (player && player.isValid()) {
      const lower = player.name.toLowerCase();
      if (blockedNicks.has(lower)) {
        punirJogador(player, "Não autorizado");
      } else if (!approvedNicks.has(lower) && !ADMINS_BYPASS.includes(lower)) {
        checarJogador(player);
      }
    }
  }
}, 40);

// ─── Comando Admin: /scriptevent whitelist:check <nick> ────────────────────────
system.afterEvents.scriptEventReceive.subscribe(async (e) => {
  if (e.id !== "whitelist:check") return;
  const target = (e.message || "").trim();
  if (!target) return;
  try {
    const res = await http.request(new HttpRequest(`${API_URL}/${encodeURIComponent(target)}`));
    const data = JSON.parse(res.body);
    world.sendMessage(data.allowed ? `§a✅ ${target} está aprovado.` : `§c❌ ${target} NÃO está aprovado.`);
  } catch (err) {
    world.sendMessage(`§cErro API: ${err.message}`);
  }
});

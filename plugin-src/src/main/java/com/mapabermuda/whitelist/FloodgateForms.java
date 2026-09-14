package com.mapabermuda.whitelist;

import org.bukkit.entity.Player;
import org.geysermc.cumulus.form.SimpleForm;
import org.geysermc.floodgate.api.FloodgateApi;
import org.geysermc.floodgate.api.player.FloodgatePlayer;

import java.util.List;

public class FloodgateForms {

    // ── Helper ──────────────────────────────────────────────────────────────
    public static boolean isBedrock(Player player) {
        try {
            if (FloodgateApi.getInstance() == null) return false;
            return FloodgateApi.getInstance().isFloodgatePlayer(player.getUniqueId());
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static FloodgatePlayer fp(Player player) {
        try {
            return FloodgateApi.getInstance().getPlayer(player.getUniqueId());
        } catch (Throwable ignored) {
            return null;
        }
    }

    /** Abre um SimpleForm simples de resultado (apenas conteúdo + botão Fechar) */
    private static void modalDados(Player player, PainelMenu menu, String title, String content) {
        FloodgatePlayer fp = fp(player);
        if (fp == null) return;
        try {
            SimpleForm.Builder form = SimpleForm.builder()
                .title(title)
                .content(content)
                .button("§c✕ Fechar");
            form.validResultHandler(r -> {}); // fechar sem ação
            fp.sendForm(form);
        } catch (Throwable ignored) {}
    }

    // ════════════════════════════════════════════════════════════════════════
    //  MENUS PRINCIPAIS (navegação)
    // ════════════════════════════════════════════════════════════════════════

    public static void abrirMenuPrincipal(Player player, PainelMenu menu, boolean isAdmin, boolean isReinoOwner) {
        try {
            FloodgatePlayer fp = fp(player);
            if (fp == null) {
                menu.abrirMenuPrincipalChat(player, isAdmin, isReinoOwner);
                return;
            }

            SimpleForm.Builder builder = SimpleForm.builder()
                .title("§l§6MAPA BERMUDA")
                .content("§eSelecione uma opção do painel:");

            builder.button("§c❤ Minhas Vidas\n§7Ver vidas restantes");
            builder.button("§b📜 Meu Histórico\n§7Entradas e saídas");
            builder.button("§a🏠 Meus Terrenos\n§7Gerenciar terrenos");
            builder.button("§e🏆 Rankings\n§7Horas e Reinos");

            if (isReinoOwner) {
                builder.button("§6👑 Meu Reino\n§7Membros e gestão");
            }
            if (isAdmin) {
                builder.button("§4🔧 Painel Admin\n§7Gerenciamento total");
            }

            builder.validResultHandler(response -> {
                int id = response.clickedButtonId();
                if (id == 0) menu.abrirVidas(player);
                else if (id == 1) menu.abrirHistorico(player);
                else if (id == 2) menu.abrirMeusTerrenos(player);
                else if (id == 3) menu.abrirRankings(player);
                else if (id == 4) {
                    if (isReinoOwner) menu.abrirMenuReino(player);
                    else if (isAdmin) menu.abrirMenuAdmin(player);
                } else if (id == 5 && isAdmin && isReinoOwner) {
                    menu.abrirMenuAdmin(player);
                }
            });

            fp.sendForm(builder);
        } catch (Throwable t) {
            menu.abrirMenuPrincipalChat(player, isAdmin, isReinoOwner);
        }
    }

    public static void abrirMenuAdmin(Player player, PainelMenu menu) {
        try {
            FloodgatePlayer fp = fp(player);
            if (fp == null) {
                menu.abrirMenuAdminChat(player);
                return;
            }

            SimpleForm.Builder builder = SimpleForm.builder()
                .title("§l§4PAINEL ADMIN")
                .content("§7Painel de controle do servidor Mapa Bermuda:");

            builder.button("§e📋 Whitelist Pendente\n§7Aprovar ou rejeitar");
            builder.button("§a➕ Adicionar Whitelist\n§7Inserir nick direto");
            builder.button("§c🗑 Remover Whitelist\n§7Remover jogador");
            builder.button("§4🔨 Banir Jogador\n§7Ban por nick");
            builder.button("§2🔓 Desbanir Jogador\n§7Remover ban");
            builder.button("§c🌐 Ban por IP\n§7Bloquear IP");
            builder.button("§a🌐 Desbanir IP\n§7Desbloquear IP");
            builder.button("§d❤ Gerenciar Vidas\n§7Adicionar ou tirar");
            builder.button("§b🏠 Zonas de Proteção\n§7Criar/remover zonas");
            builder.button("§6👑 Gestão de Reinos\n§7Listar ou dissolver");
            builder.button("§f📜 Sessões Recentes\n§7Entradas e saídas");
            builder.button("§e📢 Broadcast\n§7Aviso global");

            builder.validResultHandler(response -> {
                int id = response.clickedButtonId();
                switch (id) {
                    case 0 -> menu.adminPendentes(player);
                    case 1 -> menu.adminAdd(player);
                    case 2 -> menu.adminRemover(player);
                    case 3 -> menu.adminBanir(player);
                    case 4 -> menu.adminDesbanir(player);
                    case 5 -> menu.adminBanIp(player);
                    case 6 -> menu.adminDesbanIp(player);
                    case 7 -> menu.adminVerVidas(player);
                    case 8 -> menu.adminZonas(player);
                    case 9 -> menu.adminReinos(player);
                    case 10 -> menu.adminSessoes(player);
                    case 11 -> menu.adminBroadcast(player);
                }
            });

            fp.sendForm(builder);
        } catch (Throwable t) {
            menu.abrirMenuAdminChat(player);
        }
    }

    public static void abrirMenuReino(Player player, PainelMenu menu) {
        try {
            FloodgatePlayer fp = fp(player);
            if (fp == null) {
                menu.abrirMenuReinoChat(player);
                return;
            }

            SimpleForm.Builder builder = SimpleForm.builder()
                .title("§l§6MEU REINO")
                .content("§eGerencie os membros e as ações do seu reino:")
                .button("§b👥 Ver Membros & Stats\n§7Horas, Kills e Mobs")
                .button("§a➕ Convidar Jogador\n§7Enviar convite")
                .button("§c➖ Expulsar Membro\n§7Remover do reino");

            builder.validResultHandler(response -> {
                int id = response.clickedButtonId();
                if (id == 0) menu.reinoMembros(player);
                else if (id == 1) menu.reinoConvidar(player);
                else if (id == 2) menu.reinoExpulsar(player);
            });

            fp.sendForm(builder);
        } catch (Throwable t) {
            menu.abrirMenuReinoChat(player);
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  MODAIS DE DADOS (abrem um SimpleForm com os dados)
    // ════════════════════════════════════════════════════════════════════════

    /** Modal de vidas do jogador */
    public static void modalVidas(Player player, PainelMenu menu, int lives) {
        String h = "❤".repeat(Math.max(0, lives)) + "♡".repeat(Math.max(0, 5 - lives));
        String status = lives >= 4 ? "§a" : lives >= 2 ? "§e" : "§c";
        String content = "§7Suas vidas restantes:\n\n" + status + h + " §f(" + lives + "/5)";
        modalDados(player, menu, "§l§c❤ MINHAS VIDAS", content);
    }

    /** Modal de histórico de sessões */
    public static void modalHistorico(Player player, PainelMenu menu, List<String[]> sessions) {
        StringBuilder sb = new StringBuilder();
        if (sessions.isEmpty()) {
            sb.append("§7Nenhuma sessão registrada.");
        } else {
            for (String[] s : sessions) {
                boolean in = "login".equals(s[1]);
                sb.append(in ? "§a▶ " : "§c◀ ")
                  .append("§f").append(s[0])
                  .append(" §7— ").append(s[1])
                  .append(" §8— ").append(s[2])
                  .append("\n");
            }
        }
        modalDados(player, menu, "§l§b📜 MEU HISTÓRICO", sb.toString().trim());
    }

    /** Modal de terrenos do jogador — com botões de ação para donos */
    public static void modalTerrenos(Player player, PainelMenu menu, List<String[]> terrenos) {
        FloodgatePlayer fp = fp(player);
        if (fp == null) return;
        try {
            if (terrenos.isEmpty()) {
                modalDados(player, menu, "§l§a🏠 MEUS TERRENOS", "§7Você não possui terrenos protegidos.");
                return;
            }

            // Construir conteúdo descritivo e botões de ação
            StringBuilder content = new StringBuilder("§7Seus terrenos registrados:\n");
            for (String[] t : terrenos) {
                boolean owner = "owner".equalsIgnoreCase(t[2]);
                content.append(owner ? "§e👑 " : "§7▸ ").append("§f").append(t[1])
                       .append(" §8[").append(owner ? "§eDono§8" : "§7Membro§8").append("]\n");
            }

            SimpleForm.Builder form = SimpleForm.builder()
                .title("§l§a🏠 MEUS TERRENOS")
                .content(content.toString().trim());

            // Botão de ação para cada terreno onde o jogador é dono
            boolean temBotoes = false;
            for (String[] t : terrenos) {
                if ("owner".equalsIgnoreCase(t[2])) {
                    form.button("§a➕ Add membro em: §f" + t[1] + "\n§7Toque para adicionar");
                    form.button("§c➖ Rem membro de: §f" + t[1] + "\n§7Toque para remover");
                    temBotoes = true;
                }
            }
            if (!temBotoes) {
                form.button("§c✕ Fechar");
            } else {
                form.button("§c✕ Fechar");
            }

            // Mapear botões para ações
            // Botões: [add_t0, rem_t0, add_t1, rem_t1, ..., Fechar]
            final List<String[]> terrenosRef = terrenos;
            form.validResultHandler(r -> {
                int bid = r.clickedButtonId();
                // Contar donos e mapear
                int btnIdx = 0;
                for (String[] t : terrenosRef) {
                    if ("owner".equalsIgnoreCase(t[2])) {
                        if (bid == btnIdx) { menu.terrenoAddMembro(player, t[0]); return; }
                        btnIdx++;
                        if (bid == btnIdx) { menu.terrenoRemMembro(player, t[0]); return; }
                        btnIdx++;
                    }
                }
                // último botão = Fechar → sem ação
            });

            fp.sendForm(form);
        } catch (Throwable ignored) {}
    }

    /** Modal de rankings (navegação para horas ou reinos) */
    public static void modalRankings(Player player, PainelMenu menu) {
        FloodgatePlayer fp = fp(player);
        if (fp == null) return;
        try {
            SimpleForm.Builder form = SimpleForm.builder()
                .title("§l§e🏆 RANKINGS")
                .content("§eEscolha o ranking para visualizar:")
                .button("§b⏱ Top Horas Jogadas\n§7Os mais ativos")
                .button("§6👑 Top Reinos\n§7Por pontos e kills")
                .button("§c✕ Fechar\n ");

            form.validResultHandler(r -> {
                int id = r.clickedButtonId();
                if (id == 0) menu.rankingHoras(player);
                else if (id == 1) menu.rankingReinos(player);
            });

            fp.sendForm(form);
        } catch (Throwable ignored) {}
    }

    /** Modal ranking de horas */
    public static void modalRankingHoras(Player player, PainelMenu menu, List<String[]> ranking) {
        String[] medals = {"🥇", "🥈", "🥉", "4.", "5."};
        StringBuilder sb = new StringBuilder("§eMais tempo online:\n\n");
        if (ranking.isEmpty()) {
            sb.append("§7Nenhum dado disponível.");
        } else {
            for (int i = 0; i < ranking.size(); i++) {
                sb.append(i < medals.length ? medals[i] : (i+1)+".").append(" §f")
                  .append(ranking.get(i)[0]).append(" §7— ").append(ranking.get(i)[1]).append("\n");
            }
        }
        modalDados(player, menu, "§l§b⏱ TOP HORAS JOGADAS", sb.toString().trim());
    }

    /** Modal ranking de reinos */
    public static void modalRankingReinos(Player player, PainelMenu menu, List<String[]> ranking) {
        String[] medals = {"🥇", "🥈", "🥉", "4.", "5."};
        StringBuilder sb = new StringBuilder("§eReinos por pontos:\n\n");
        if (ranking.isEmpty()) {
            sb.append("§7Nenhum reino encontrado.");
        } else {
            for (int i = 0; i < ranking.size(); i++) {
                sb.append(i < medals.length ? medals[i] : (i+1)+".").append(" §6[")
                  .append(ranking.get(i)[1]).append("] §f").append(ranking.get(i)[0])
                  .append(" §7— ").append(ranking.get(i)[2]).append(" pts\n");
            }
        }
        modalDados(player, menu, "§l§6👑 TOP REINOS", sb.toString().trim());
    }

    /** Modal membros do reino */
    public static void modalReinoMembros(Player player, PainelMenu menu, List<String[]> membros) {
        StringBuilder sb = new StringBuilder("§eMembros do seu reino:\n\n");
        if (membros.isEmpty()) {
            sb.append("§7Nenhum membro encontrado.");
        } else {
            for (String[] m : membros) {
                sb.append("§f▸ ").append(m[0])
                  .append("  §7⏱").append(m[1])
                  .append(" ⚔").append(m[2])
                  .append(" 🐉").append(m[3]).append("\n");
            }
        }
        modalDados(player, menu, "§l§b👥 MEMBROS DO REINO", sb.toString().trim());
    }

    /** Modal pendentes com botões Aprovar/Rejeitar por nick */
    public static void modalAdminPendentes(Player player, PainelMenu menu, List<String> nicks) {
        FloodgatePlayer fp = fp(player);
        if (fp == null) return;
        try {
            if (nicks.isEmpty()) {
                modalDados(player, menu, "§l§e📋 PEDIDOS PENDENTES", "§7Nenhum pedido pendente.");
                return;
            }

            SimpleForm.Builder form = SimpleForm.builder()
                .title("§l§e📋 PEDIDOS PENDENTES")
                .content("§7Selecione a ação para cada pedido:");

            for (String nick : nicks) {
                form.button("§a✅ Aprovar: §f" + nick + "\n§7Toque para aprovar");
                form.button("§c❌ Rejeitar: §f" + nick + "\n§7Toque para rejeitar");
            }
            form.button("§c✕ Fechar\n ");

            final List<String> nicksRef = nicks;
            form.validResultHandler(r -> {
                int bid = r.clickedButtonId();
                for (int i = 0; i < nicksRef.size(); i++) {
                    if (bid == i * 2) { menu.adminAprovar(player, nicksRef.get(i)); return; }
                    if (bid == i * 2 + 1) { menu.adminRejeitar(player, nicksRef.get(i)); return; }
                }
                // Fechar → sem ação
            });

            fp.sendForm(form);
        } catch (Throwable ignored) {}
    }

    /** Modal zonas de proteção admin */
    public static void modalAdminZonas(Player player, PainelMenu menu, List<String[]> zonas) {
        StringBuilder sb = new StringBuilder("§eZonas de proteção registradas:\n\n");
        if (zonas.isEmpty()) {
            sb.append("§7Nenhuma zona cadastrada.");
        } else {
            for (String[] z : zonas) {
                sb.append("§a🏠 §f").append(z[1]).append(" §8[").append(z[2]).append("]\n");
            }
        }
        modalDados(player, menu, "§l§b🏠 ZONAS DE PROTEÇÃO", sb.toString().trim());
    }

    /** Modal sessões admin */
    public static void modalAdminSessoes(Player player, PainelMenu menu, List<String[]> sessions) {
        StringBuilder sb = new StringBuilder("§eHistórico de sessões:\n\n");
        if (sessions.isEmpty()) {
            sb.append("§7Nenhuma sessão registrada.");
        } else {
            for (String[] s : sessions) {
                boolean in = "login".equals(s[1]);
                sb.append(in ? "§a▶ " : "§c◀ ")
                  .append("§f").append(s[0])
                  .append(" §7— ").append(s[1])
                  .append(" §8— ").append(s[2]).append("\n");
            }
        }
        modalDados(player, menu, "§l§f📜 SESSÕES RECENTES", sb.toString().trim());
    }

    /** Modal todos os reinos (admin) */
    public static void modalAdminReinos(Player player, PainelMenu menu, List<String[]> reinos) {
        StringBuilder sb = new StringBuilder("§eTodos os reinos:\n\n");
        if (reinos.isEmpty()) {
            sb.append("§7Nenhum reino encontrado.");
        } else {
            for (String[] r : reinos) {
                sb.append("§6[").append(r[1]).append("] §f").append(r[0])
                  .append(" §7— Dono: ").append(r[3])
                  .append(" §8— ").append(r[2]).append(" pts\n");
            }
        }
        modalDados(player, menu, "§l§6👑 TODOS OS REINOS", sb.toString().trim());
    }
}

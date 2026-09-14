package com.mapabermuda.whitelist;

import org.bukkit.entity.Player;
import org.geysermc.cumulus.form.CustomForm;
import org.geysermc.cumulus.form.SimpleForm;
import org.geysermc.floodgate.api.FloodgateApi;
import org.geysermc.floodgate.api.player.FloodgatePlayer;

public class FloodgateForms {

    public static boolean isBedrock(Player player) {
        try {
            if (FloodgateApi.getInstance() == null) return false;
            return FloodgateApi.getInstance().isFloodgatePlayer(player.getUniqueId());
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static void abrirMenuPrincipal(Player player, PainelMenu menu, boolean isAdmin, boolean isReinoOwner) {
        try {
            FloodgatePlayer fp = FloodgateApi.getInstance().getPlayer(player.getUniqueId());
            if (fp == null) {
                menu.abrirMenuPrincipalChat(player, isAdmin, isReinoOwner);
                return;
            }

            SimpleForm.Builder builder = SimpleForm.builder()
                .title("§l§6MAPA BERMUDA")
                .content("§eSelecione uma opção do painel:");

            builder.button("§c❤ Minhas Vidas\n§7Ver vidas restantes");
            builder.button("§b📜 Meu Histórico\n§7Entradas e saídas");
            builder.button("§a🏠 Meus Terrenos\n§7Gerenciar amigos");
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
            FloodgatePlayer fp = FloodgateApi.getInstance().getPlayer(player.getUniqueId());
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
            FloodgatePlayer fp = FloodgateApi.getInstance().getPlayer(player.getUniqueId());
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
}

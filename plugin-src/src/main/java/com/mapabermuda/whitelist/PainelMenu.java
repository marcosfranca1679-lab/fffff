package com.mapabermuda.whitelist;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.entity.Player;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

public class PainelMenu {

    private final WhitelistPlugin plugin;
    private final HttpClient http;
    private final String apiBase;
    private final String pluginSecret;
    private final Map<UUID, Consumer<String>> pendingInput = new HashMap<>();

    public PainelMenu(WhitelistPlugin plugin, HttpClient http, String apiBase, String pluginSecret) {
        this.plugin = plugin;
        this.http = http;
        this.apiBase = apiBase;
        this.pluginSecret = pluginSecret;
    }

    // ── Input via chat ──
    public boolean hasPendingInput(UUID uuid) { return pendingInput.containsKey(uuid); }

    public void handleChatInput(Player player, String message) {
        Consumer<String> cb = pendingInput.remove(player.getUniqueId());
        if (cb != null) cb.accept(message);
    }

    private void awaitInput(Player p, String prompt, Consumer<String> cb) {
        p.sendMessage(Component.text("✏ " + prompt, NamedTextColor.YELLOW)
            .append(Component.text(" (ou 'cancelar')", NamedTextColor.GRAY)));
        pendingInput.put(p.getUniqueId(), input -> {
            if (input.equalsIgnoreCase("cancelar")) p.sendMessage(Component.text("❌ Cancelado.", NamedTextColor.RED));
            else cb.accept(input);
        });
    }

    // ── UI helpers ──
    private void hdr(Player p, String t) {
        p.sendMessage(Component.empty());
        p.sendMessage(Component.text("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", NamedTextColor.DARK_GRAY));
        p.sendMessage(Component.text("  " + t, NamedTextColor.GOLD, TextDecoration.BOLD));
        p.sendMessage(Component.text("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", NamedTextColor.DARK_GRAY));
    }
    private void ftr(Player p) {
        p.sendMessage(Component.text("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", NamedTextColor.DARK_GRAY));
    }
    private Component btn(String e, String l, String cmd, String tip) {
        return Component.text(" [" + e + " " + l + "]", NamedTextColor.AQUA)
            .clickEvent(ClickEvent.runCommand(cmd))
            .hoverEvent(HoverEvent.showText(Component.text(tip, NamedTextColor.GRAY)));
    }
    private Component btnR(String e, String l, String cmd, String tip) {
        return Component.text(" [" + e + " " + l + "]", NamedTextColor.RED)
            .clickEvent(ClickEvent.runCommand(cmd))
            .hoverEvent(HoverEvent.showText(Component.text(tip, NamedTextColor.GRAY)));
    }
    private Component btnG(String e, String l, String cmd, String tip) {
        return Component.text(" [" + e + " " + l + "]", NamedTextColor.GREEN)
            .clickEvent(ClickEvent.runCommand(cmd))
            .hoverEvent(HoverEvent.showText(Component.text(tip, NamedTextColor.GRAY)));
    }
    private void ok(Player p, String m) { p.sendMessage(Component.text("✅ " + m, NamedTextColor.GREEN)); }
    private void err(Player p, String m) { p.sendMessage(Component.text("❌ " + m, NamedTextColor.RED)); }

    // ── HTTP ──
    private CompletableFuture<String> get(String path) {
        HttpRequest r = HttpRequest.newBuilder()
            .uri(URI.create(apiBase + path))
            .header("x-plugin-secret", pluginSecret)
            .timeout(Duration.ofSeconds(8)).GET().build();
        return http.sendAsync(r, HttpResponse.BodyHandlers.ofString()).thenApply(HttpResponse::body);
    }
    private CompletableFuture<String> post(String path, String body) {
        HttpRequest r = HttpRequest.newBuilder()
            .uri(URI.create(apiBase + path))
            .header("x-plugin-secret", pluginSecret)
            .header("Content-Type", "application/json")
            .timeout(Duration.ofSeconds(8))
            .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build();
        return http.sendAsync(r, HttpResponse.BodyHandlers.ofString()).thenApply(HttpResponse::body);
    }
    private String esc(String s) { return s == null ? "" : s.replace("\\","\\\\").replace("\"","\\\""); }
    private String encUrl(String s) {
        try { return java.net.URLEncoder.encode(s, StandardCharsets.UTF_8); } catch (Exception e) { return s; }
    }
    private String f(String json, String key) {
        String k = "\"" + key + "\":"; int i = json.indexOf(k); if (i < 0) return "";
        int s = i + k.length(); char c = json.charAt(s);
        if (c == '"') { int e = json.indexOf('"', s + 1); return e > 0 ? json.substring(s+1,e) : ""; }
        int e = s; while (e < json.length() && ",}]".indexOf(json.charAt(e)) < 0) e++;
        return json.substring(s,e).trim();
    }
    private int fi(String json, String key) { try { return Integer.parseInt(f(json,key).trim()); } catch(Exception e){ return 0; } }
    private String err(String json) { String e = f(json,"error"); return e.isEmpty() ? "Erro desconhecido." : e; }

    // ── Run on main thread ──
    private void run(Runnable r) { plugin.getServer().getScheduler().runTask(plugin, r); }

    // ════════════════════════════════════════════════════════
    //  MENU PRINCIPAL
    // ════════════════════════════════════════════════════════
    public void abrirMenuPrincipal(Player p, boolean isAdmin, boolean isReinoOwner) {
        if (FloodgateForms.isBedrock(p)) {
            FloodgateForms.abrirMenuPrincipal(p, this, isAdmin, isReinoOwner);
            return;
        }
        abrirMenuPrincipalChat(p, isAdmin, isReinoOwner);
    }

    public void abrirMenuPrincipalChat(Player p, boolean isAdmin, boolean isReinoOwner) {
        hdr(p, "🗺 MAPA BERMUDA — PAINEL");
        p.sendMessage(Component.text("  ── Jogador ──", NamedTextColor.YELLOW));
        p.sendMessage(btn("❤","Minhas Vidas","/mb:vidas","Ver suas vidas restantes"));
        p.sendMessage(btn("📜","Meu Histórico","/mb:historico","Entradas e saídas recentes"));
        p.sendMessage(btn("🏠","Meus Terrenos","/mb:terrenos","Seus terrenos protegidos"));
        p.sendMessage(btn("🏆","Rankings","/mb:rankings","Rankings de horas e reinos"));
        if (isReinoOwner) {
            p.sendMessage(Component.empty());
            p.sendMessage(Component.text("  ── Seu Reino ──", NamedTextColor.GOLD));
            p.sendMessage(btn("👑","Gerenciar Reino","/mb:reino","Membros, info e convites"));
        }
        if (isAdmin) {
            p.sendMessage(Component.empty());
            p.sendMessage(Component.text("  ── Administração ──", NamedTextColor.RED));
            p.sendMessage(btn("🔧","Painel Admin","/mb:admin","Todas as funções de admin"));
        }
        ftr(p);
    }

    // ════════════════════════════════════════════════════════
    //  VIDAS
    // ════════════════════════════════════════════════════════
    public void abrirVidas(Player p) {
        hdr(p, "❤ MINHAS VIDAS");
        get("/api/plugin/painel/player/" + encUrl(p.getName())).thenAccept(body -> run(() -> {
            int v = fi(body,"lives");
            String h = "❤".repeat(Math.max(0,v)) + "♡".repeat(Math.max(0,5-v));
            NamedTextColor c = v>=4?NamedTextColor.GREEN:v>=2?NamedTextColor.YELLOW:NamedTextColor.RED;
            p.sendMessage(Component.text("  Vidas: ", NamedTextColor.WHITE).append(Component.text(h+" ("+v+"/5)",c)));
            ftr(p);
        })).exceptionally(e -> { err(p,"Falha ao buscar vidas."); return null; });
    }

    // ════════════════════════════════════════════════════════
    //  HISTÓRICO
    // ════════════════════════════════════════════════════════
    public void abrirHistorico(Player p) {
        hdr(p, "📜 MEU HISTÓRICO");
        get("/api/plugin/painel/sessions/" + encUrl(p.getName())).thenAccept(body -> run(() -> {
            List<String[]> ss = parseSessions(body);
            if (ss.isEmpty()) p.sendMessage(Component.text("  Nenhuma sessão registrada.", NamedTextColor.GRAY));
            else for (String[] s : ss) {
                boolean in = "login".equals(s[1]);
                p.sendMessage(Component.text("  "+(in?"▶ ":"◀ ")+s[0]+" — "+s[1]+" — "+s[2], in?NamedTextColor.GREEN:NamedTextColor.RED));
            }
            ftr(p);
        })).exceptionally(e -> { err(p,"Falha."); return null; });
    }

    // ════════════════════════════════════════════════════════
    //  TERRENOS
    // ════════════════════════════════════════════════════════
    public void abrirMeusTerrenos(Player p) {
        hdr(p, "🏠 MEUS TERRENOS");
        get("/api/plugin/painel/terrenos/" + encUrl(p.getName())).thenAccept(body -> run(() -> {
            List<String[]> ts = parseTerrenos(body);
            if (ts.isEmpty()) p.sendMessage(Component.text("  Nenhum terreno encontrado.", NamedTextColor.GRAY));
            else for (String[] t : ts) {
                p.sendMessage(Component.text("  🏠 "+t[1]+" ["+t[2]+"]", NamedTextColor.YELLOW));
                if ("owner".equalsIgnoreCase(t[2]))
                    p.sendMessage(btnG("➕","Add Membro","/mb:terreno-add "+t[0],"Adicionar membro")
                        .append(btnR("➖","Rem Membro","/mb:terreno-rem "+t[0],"Remover membro")));
            }
            ftr(p);
        })).exceptionally(e -> { err(p,"Falha."); return null; });
    }
    public void terrenoAddMembro(Player p, String id) {
        awaitInput(p,"Nick para ADICIONAR ao terreno:", nick ->
            post("/api/plugin/painel/terrenos/"+id+"/members",
                "{\"nick\":\""+esc(p.getName())+"\",\"targetNick\":\""+esc(nick)+"\",\"action\":\"add\"}")
            .thenAccept(b -> run(() -> { if(b.contains("\"success\":true")) ok(p,nick+" adicionado!"); else err(p,err(b)); }))
            .exceptionally(e->{err(p,"Falha.");return null;}));
    }
    public void terrenoRemMembro(Player p, String id) {
        awaitInput(p,"Nick para REMOVER do terreno:", nick ->
            post("/api/plugin/painel/terrenos/"+id+"/members",
                "{\"nick\":\""+esc(p.getName())+"\",\"targetNick\":\""+esc(nick)+"\",\"action\":\"remove\"}")
            .thenAccept(b -> run(() -> { if(b.contains("\"success\":true")) ok(p,nick+" removido!"); else err(p,err(b)); }))
            .exceptionally(e->{err(p,"Falha.");return null;}));
    }

    // ════════════════════════════════════════════════════════
    //  RANKINGS
    // ════════════════════════════════════════════════════════
    public void abrirRankings(Player p) {
        hdr(p,"🏆 RANKINGS");
        p.sendMessage(btn("⏱","Top Horas","/mb:ranking-horas","Top 5 por horas jogadas"));
        p.sendMessage(btn("👑","Top Reinos","/mb:ranking-reinos","Ranking de reinos por pontos"));
        ftr(p);
    }
    public void rankingHoras(Player p) {
        hdr(p,"⏱ TOP HORAS JOGADAS");
        get("/api/ranking/horas").thenAccept(body -> run(() -> {
            List<String[]> r = parseRkHoras(body);
            String[] m = {"🥇","🥈","🥉","4.","5."};
            if(r.isEmpty()) p.sendMessage(Component.text("  Nenhum dado.", NamedTextColor.GRAY));
            else for(int i=0;i<r.size();i++) p.sendMessage(Component.text("  "+(i<m.length?m[i]:(i+1)+".")+" "+r.get(i)[0]+" — "+r.get(i)[1], NamedTextColor.WHITE));
            ftr(p);
        })).exceptionally(e->{err(p,"Falha.");return null;});
    }
    public void rankingReinos(Player p) {
        hdr(p,"👑 TOP REINOS");
        get("/api/ranking/kingdoms").thenAccept(body -> run(() -> {
            List<String[]> r = parseRkReinos(body);
            String[] m = {"🥇","🥈","🥉","4.","5."};
            if(r.isEmpty()) p.sendMessage(Component.text("  Nenhum reino.", NamedTextColor.GRAY));
            else for(int i=0;i<r.size();i++) p.sendMessage(Component.text("  "+(i<m.length?m[i]:(i+1)+".")+" ["+r.get(i)[1]+"] "+r.get(i)[0]+" — "+r.get(i)[2]+" pts", NamedTextColor.GOLD));
            ftr(p);
        })).exceptionally(e->{err(p,"Falha.");return null;});
    }

    // ════════════════════════════════════════════════════════
    //  REINO (dono)
    // ════════════════════════════════════════════════════════
    public void abrirMenuReino(Player p) {
        if (FloodgateForms.isBedrock(p)) {
            FloodgateForms.abrirMenuReino(p, this);
            return;
        }
        abrirMenuReinoChat(p);
    }

    public void abrirMenuReinoChat(Player p) {
        hdr(p,"👑 MEU REINO");
        get("/api/plugin/painel/reino/"+encUrl(p.getName())).thenAccept(body -> run(() -> {
            String nome=f(body,"nome"), tag=f(body,"tag"), kills=f(body,"kills"), pts=f(body,"totalPoints"), tempo=f(body,"playtimeFormatted");
            if(nome.isEmpty()){p.sendMessage(Component.text("  Você não possui reino.",NamedTextColor.GRAY));ftr(p);return;}
            p.sendMessage(Component.text("  👑 ["+tag+"] "+nome, NamedTextColor.GOLD));
            p.sendMessage(Component.text("  ⚔ Kills: "+kills+" | 🏆 Pontos: "+pts+" | ⏱ "+tempo, NamedTextColor.WHITE));
            p.sendMessage(Component.empty());
            p.sendMessage(btn("👥","Ver Membros","/mb:reino-membros","Lista membros + stats"));
            p.sendMessage(btn("➕","Convidar","/mb:reino-convidar","Convidar jogador"));
            p.sendMessage(btnR("➖","Expulsar","/mb:reino-expulsar","Expulsar membro"));
            ftr(p);
        })).exceptionally(e->{err(p,"Falha ao buscar reino.");return null;});
    }
    public void reinoMembros(Player p) {
        hdr(p,"👥 MEMBROS DO REINO");
        get("/api/plugin/painel/reino/membros/"+encUrl(p.getName())).thenAccept(body -> run(() -> {
            List<String[]> ms = parseMembros(body);
            if(ms.isEmpty()) p.sendMessage(Component.text("  Nenhum membro.",NamedTextColor.GRAY));
            else for(String[] m:ms) p.sendMessage(Component.text("  ▸ "+m[0]+"  ⏱"+m[1]+" ⚔"+m[2]+" 🐉"+m[3], NamedTextColor.WHITE));
            ftr(p);
        })).exceptionally(e->{err(p,"Falha.");return null;});
    }
    public void reinoConvidar(Player p) {
        awaitInput(p,"Nick para CONVIDAR:", nick ->
            post("/api/plugin/painel/reino/convidar","{\"ownerNick\":\""+esc(p.getName())+"\",\"targetNick\":\""+esc(nick)+"\"}")
            .thenAccept(b->run(()->{if(b.contains("\"success\":true"))ok(p,"Convite enviado para "+nick+"!");else err(p,err(b));}))
            .exceptionally(e->{err(p,"Falha.");return null;}));
    }
    public void reinoExpulsar(Player p) {
        awaitInput(p,"Nick para EXPULSAR:", nick ->
            post("/api/plugin/painel/reino/expulsar","{\"ownerNick\":\""+esc(p.getName())+"\",\"targetNick\":\""+esc(nick)+"\"}")
            .thenAccept(b->run(()->{if(b.contains("\"success\":true"))ok(p,nick+" expulso.");else err(p,err(b));}))
            .exceptionally(e->{err(p,"Falha.");return null;}));
    }

    // ════════════════════════════════════════════════════════
    //  PAINEL ADMIN
    // ════════════════════════════════════════════════════════
    public void abrirMenuAdmin(Player p) {
        if (FloodgateForms.isBedrock(p)) {
            FloodgateForms.abrirMenuAdmin(p, this);
            return;
        }
        abrirMenuAdminChat(p);
    }

    public void abrirMenuAdminChat(Player p) {
        hdr(p,"🔧 PAINEL ADMIN");
        p.sendMessage(Component.text("  ── Jogadores ──",NamedTextColor.YELLOW));
        p.sendMessage(btn("📋","Pendentes","/mb:admin-pendentes","Ver pedidos de whitelist"));
        p.sendMessage(btnG("✅","Aprovar","/mb:admin-aprovar","Aprovar nick"));
        p.sendMessage(btnR("❌","Rejeitar","/mb:admin-rejeitar","Rejeitar pedido"));
        p.sendMessage(btnG("➕","Add Whitelist","/mb:admin-add","Adicionar nick direto"));
        p.sendMessage(btnR("🗑","Rem Whitelist","/mb:admin-remover","Remover nick"));
        p.sendMessage(Component.empty());
        p.sendMessage(Component.text("  ── Banimentos ──",NamedTextColor.RED));
        p.sendMessage(btnR("🔨","Banir","/mb:admin-banir","Banir jogador"));
        p.sendMessage(btnG("🔓","Desbanir","/mb:admin-desbanir","Desbanir jogador"));
        p.sendMessage(btnR("🌐","Ban IP","/mb:admin-banip","Banir IP"));
        p.sendMessage(btnG("🌐","Desban IP","/mb:admin-desbanip","Desbanir IP"));
        p.sendMessage(Component.empty());
        p.sendMessage(Component.text("  ── Vidas ──",NamedTextColor.LIGHT_PURPLE));
        p.sendMessage(btn("👁","Ver Vidas","/mb:admin-vidas","Ver vidas de jogador"));
        p.sendMessage(btnG("➕","Dar Vidas","/mb:admin-darvidas","Adicionar vidas"));
        p.sendMessage(btnR("➖","Tirar Vidas","/mb:admin-tirarvidas","Reduzir vidas"));
        p.sendMessage(Component.empty());
        p.sendMessage(Component.text("  ── Terrenos Admin ──",NamedTextColor.AQUA));
        p.sendMessage(btn("📋","Listar Zonas","/mb:admin-zonas","Ver zonas de proteção"));
        p.sendMessage(btnG("➕","Criar Zona","/mb:admin-criarzona","Criar zona de proteção"));
        p.sendMessage(btnR("🗑","Remover Zona","/mb:admin-remzona","Remover zona"));
        p.sendMessage(Component.empty());
        p.sendMessage(Component.text("  ── Reinos ──",NamedTextColor.GOLD));
        p.sendMessage(btn("📋","Listar Reinos","/mb:admin-reinos","Ver todos os reinos"));
        p.sendMessage(btnR("🗑","Dissolver Reino","/mb:admin-dissolver","Dissolver reino"));
        p.sendMessage(Component.empty());
        p.sendMessage(Component.text("  ── Outros ──",NamedTextColor.WHITE));
        p.sendMessage(btn("📜","Sessões","/mb:admin-sessoes","Histórico de entradas/saídas"));
        p.sendMessage(btn("📢","Broadcast","/mb:admin-broadcast","Mensagem para todos"));
        ftr(p);
    }

    public void adminPendentes(Player p) {
        hdr(p,"📋 PEDIDOS PENDENTES");
        get("/api/plugin/painel/admin/pendentes").thenAccept(body -> run(() -> {
            List<String> ns = parseStrList(body,"nick");
            if(ns.isEmpty()) p.sendMessage(Component.text("  Nenhum pedido pendente.",NamedTextColor.GRAY));
            else for(String n:ns) p.sendMessage(Component.text("  ▸ "+n+" ",NamedTextColor.WHITE)
                .append(btnG("✅","Aprovar","/mb:admin-aprovar "+n,"Aprovar "+n))
                .append(btnR("❌","Rejeitar","/mb:admin-rejeitar "+n,"Rejeitar "+n)));
            ftr(p);
        })).exceptionally(e->{err(p,"Falha.");return null;});
    }
    public void adminAprovar(Player p, String nickArg) {
        if(nickArg!=null&&!nickArg.isEmpty()) execAprovar(p,nickArg);
        else awaitInput(p,"Nick para APROVAR:",nick->execAprovar(p,nick));
    }
    private void execAprovar(Player p,String nick) {
        post("/api/plugin/painel/admin/aprovar","{\"adminNick\":\""+esc(p.getName())+"\",\"nick\":\""+esc(nick)+"\"}")
        .thenAccept(b->run(()->{if(b.contains("\"success\":true"))ok(p,nick+" aprovado!");else err(p,err(b));}))
        .exceptionally(e->{err(p,"Falha.");return null;});
    }
    public void adminRejeitar(Player p, String nickArg) {
        if(nickArg!=null&&!nickArg.isEmpty()) execRejeitar(p,nickArg);
        else awaitInput(p,"Nick para REJEITAR:",nick->execRejeitar(p,nick));
    }
    private void execRejeitar(Player p,String nick) {
        post("/api/plugin/painel/admin/rejeitar","{\"adminNick\":\""+esc(p.getName())+"\",\"nick\":\""+esc(nick)+"\"}")
        .thenAccept(b->run(()->{if(b.contains("\"success\":true"))ok(p,nick+" rejeitado.");else err(p,err(b));}))
        .exceptionally(e->{err(p,"Falha.");return null;});
    }
    public void adminAdd(Player p) {
        awaitInput(p,"Nick para ADICIONAR na whitelist:", nick ->
            post("/api/plugin/painel/admin/add","{\"adminNick\":\""+esc(p.getName())+"\",\"nick\":\""+esc(nick)+"\"}")
            .thenAccept(b->run(()->{if(b.contains("\"success\":true"))ok(p,nick+" adicionado!");else err(p,err(b));}))
            .exceptionally(e->{err(p,"Falha.");return null;}));
    }
    public void adminRemover(Player p) {
        awaitInput(p,"Nick para REMOVER da whitelist:", nick ->
            post("/api/plugin/painel/admin/remover","{\"adminNick\":\""+esc(p.getName())+"\",\"nick\":\""+esc(nick)+"\"}")
            .thenAccept(b->run(()->{if(b.contains("\"success\":true"))ok(p,nick+" removido.");else err(p,err(b));}))
            .exceptionally(e->{err(p,"Falha.");return null;}));
    }
    public void adminBanir(Player p) {
        awaitInput(p,"Nick para BANIR:", nick ->
            awaitInput(p,"Motivo do ban:", motivo ->
                post("/api/plugin/painel/admin/banir","{\"adminNick\":\""+esc(p.getName())+"\",\"nick\":\""+esc(nick)+"\",\"reason\":\""+esc(motivo)+"\"}")
                .thenAccept(b->run(()->{if(b.contains("\"success\":true"))ok(p,nick+" banido!");else err(p,err(b));}))
                .exceptionally(e->{err(p,"Falha.");return null;})));
    }
    public void adminDesbanir(Player p) {
        awaitInput(p,"Nick para DESBANIR:", nick ->
            post("/api/plugin/painel/admin/desbanir","{\"adminNick\":\""+esc(p.getName())+"\",\"nick\":\""+esc(nick)+"\"}")
            .thenAccept(b->run(()->{if(b.contains("\"success\":true"))ok(p,nick+" desbanido!");else err(p,err(b));}))
            .exceptionally(e->{err(p,"Falha.");return null;}));
    }
    public void adminBanIp(Player p) {
        awaitInput(p,"IP para BANIR:", ip ->
            awaitInput(p,"Motivo:", motivo ->
                post("/api/plugin/painel/admin/banip","{\"adminNick\":\""+esc(p.getName())+"\",\"ip\":\""+esc(ip)+"\",\"reason\":\""+esc(motivo)+"\"}")
                .thenAccept(b->run(()->{if(b.contains("\"success\":true"))ok(p,"IP "+ip+" banido!");else err(p,err(b));}))
                .exceptionally(e->{err(p,"Falha.");return null;})));
    }
    public void adminDesbanIp(Player p) {
        awaitInput(p,"IP para DESBANIR:", ip ->
            post("/api/plugin/painel/admin/desbanip","{\"adminNick\":\""+esc(p.getName())+"\",\"ip\":\""+esc(ip)+"\"}")
            .thenAccept(b->run(()->{if(b.contains("\"success\":true"))ok(p,"IP "+ip+" desbanido!");else err(p,err(b));}))
            .exceptionally(e->{err(p,"Falha.");return null;}));
    }
    public void adminVerVidas(Player p) {
        awaitInput(p,"Nick para ver vidas:", nick ->
            get("/api/plugin/painel/player/"+encUrl(nick)).thenAccept(body -> run(() -> {
                int v=fi(body,"lives"); String h="❤".repeat(Math.max(0,v))+"♡".repeat(Math.max(0,5-v));
                p.sendMessage(Component.text("  "+nick+": "+h+" ("+v+"/5)", NamedTextColor.WHITE));
            })).exceptionally(e->{err(p,"Falha.");return null;}));
    }
    public void adminDarVidas(Player p) {
        awaitInput(p,"Nick:", nick -> awaitInput(p,"Quantas vidas adicionar:", qtd ->
            post("/api/plugin/painel/admin/vidas","{\"adminNick\":\""+esc(p.getName())+"\",\"nick\":\""+esc(nick)+"\",\"action\":\"add\",\"amount\":"+qtd+"}")
            .thenAccept(b->run(()->{if(b.contains("\"success\":true"))ok(p,"Vidas adicionadas para "+nick+"!");else err(p,err(b));}))
            .exceptionally(e->{err(p,"Falha.");return null;})));
    }
    public void adminTirarVidas(Player p) {
        awaitInput(p,"Nick:", nick -> awaitInput(p,"Quantas vidas tirar:", qtd ->
            post("/api/plugin/painel/admin/vidas","{\"adminNick\":\""+esc(p.getName())+"\",\"nick\":\""+esc(nick)+"\",\"action\":\"remove\",\"amount\":"+qtd+"}")
            .thenAccept(b->run(()->{if(b.contains("\"success\":true"))ok(p,"Vidas reduzidas de "+nick+".");else err(p,err(b));}))
            .exceptionally(e->{err(p,"Falha.");return null;})));
    }
    public void adminZonas(Player p) {
        hdr(p,"🏠 ZONAS DE PROTEÇÃO ADMIN");
        get("/api/plugin/painel/admin/zonas").thenAccept(body -> run(() -> {
            List<String[]> zs=parseZonas(body);
            if(zs.isEmpty()) p.sendMessage(Component.text("  Nenhuma zona.",NamedTextColor.GRAY));
            else for(String[] z:zs) p.sendMessage(Component.text("  🏠 ["+z[0]+"] "+z[1]+" — "+z[2], NamedTextColor.YELLOW));
            ftr(p);
        })).exceptionally(e->{err(p,"Falha.");return null;});
    }
    public void adminCriarZona(Player p) {
        awaitInput(p,"Nome da zona:", nome -> awaitInput(p,"Mundo (ex: world):", mundo ->
            awaitInput(p,"Coords: X1 Z1 X2 Z2 (ex: 100 200 150 250):", coords -> {
                String[] c=coords.trim().split("\\s+");
                if(c.length<4){err(p,"Formato inválido. Use: X1 Z1 X2 Z2");return;}
                post("/api/plugin/painel/admin/zonas/criar",
                    "{\"adminNick\":\""+esc(p.getName())+"\",\"name\":\""+esc(nome)+"\",\"world\":\""+esc(mundo)+"\",\"x1\":"+c[0]+",\"z1\":"+c[1]+",\"x2\":"+c[2]+",\"z2\":"+c[3]+"}")
                .thenAccept(b->run(()->{if(b.contains("\"success\":true"))ok(p,"Zona '"+nome+"' criada!");else err(p,err(b));}))
                .exceptionally(e->{err(p,"Falha.");return null;});})));
    }
    public void adminRemZona(Player p) {
        awaitInput(p,"Nome da zona para REMOVER:", nome ->
            post("/api/plugin/painel/admin/zonas/remover","{\"adminNick\":\""+esc(p.getName())+"\",\"name\":\""+esc(nome)+"\"}")
            .thenAccept(b->run(()->{if(b.contains("\"success\":true"))ok(p,"Zona removida.");else err(p,err(b));}))
            .exceptionally(e->{err(p,"Falha.");return null;}));
    }
    public void adminReinos(Player p) {
        hdr(p,"👑 TODOS OS REINOS");
        get("/api/ranking/kingdoms").thenAccept(body -> run(() -> {
            List<String[]> rs=parseRkReinos(body);
            if(rs.isEmpty()) p.sendMessage(Component.text("  Nenhum reino.",NamedTextColor.GRAY));
            else for(String[] r:rs) p.sendMessage(Component.text("  ["+r[1]+"] "+r[0]+" — Dono: "+r[3]+" — "+r[2]+" pts", NamedTextColor.GOLD));
            ftr(p);
        })).exceptionally(e->{err(p,"Falha.");return null;});
    }
    public void adminDissolver(Player p) {
        awaitInput(p,"Nick do DONO do reino a dissolver:", dono ->
            post("/api/plugin/painel/admin/dissolverreino","{\"adminNick\":\""+esc(p.getName())+"\",\"ownerNick\":\""+esc(dono)+"\"}")
            .thenAccept(b->run(()->{if(b.contains("\"success\":true"))ok(p,"Reino de "+dono+" dissolvido.");else err(p,err(b));}))
            .exceptionally(e->{err(p,"Falha.");return null;}));
    }
    public void adminSessoes(Player p) {
        hdr(p,"📜 HISTÓRICO DE SESSÕES");
        get("/api/plugin/painel/admin/sessoes").thenAccept(body -> run(() -> {
            List<String[]> ss=parseSessions(body);
            if(ss.isEmpty()) p.sendMessage(Component.text("  Nenhuma sessão.",NamedTextColor.GRAY));
            else for(String[] s:ss) { boolean in="login".equals(s[1]);
                p.sendMessage(Component.text("  "+(in?"▶ ":"◀ ")+s[0]+" — "+s[1]+" — "+s[2], in?NamedTextColor.GREEN:NamedTextColor.RED)); }
            ftr(p);
        })).exceptionally(e->{err(p,"Falha.");return null;});
    }
    public void adminBroadcast(Player p) {
        awaitInput(p,"Mensagem para enviar a TODOS:", msg -> {
            post("/api/plugin/painel/admin/broadcast","{\"adminNick\":\""+esc(p.getName())+"\",\"message\":\""+esc(msg)+"\"}")
            .thenAccept(b->run(()->{
                if(b.contains("\"success\":true")){
                    ok(p,"Broadcast enviado!");
                    plugin.getServer().broadcast(Component.text("📢 [Admin] ",NamedTextColor.GOLD).append(Component.text(msg,NamedTextColor.WHITE)));
                }else err(p,err(b));
            })).exceptionally(e->{err(p,"Falha.");return null;});
        });
    }

    // ════════════════════════════════════════════════════════
    //  PARSE HELPERS
    // ════════════════════════════════════════════════════════
    private List<String> parseStrList(String json, String key) {
        List<String> r=new ArrayList<>(); String k="\""+key+"\":\""; int i=0;
        while((i=json.indexOf(k,i))>=0){int s=i+k.length(),e=json.indexOf('"',s);if(e>0)r.add(json.substring(s,e));i=e+1;if(r.size()>=25)break;}
        return r;
    }
    private List<String[]> parseSessions(String json) {
        List<String[]> r=new ArrayList<>();
        for(String it:json.split("\\{")) {
            if(!it.contains("\"event\""))continue;
            String nick=f("{"+it,"nick"),ev=f("{"+it,"event"),dt=f("{"+it,"created_at");
            if(ev.isEmpty())continue; if(dt.length()>16)dt=dt.substring(0,16).replace("T"," ");
            r.add(new String[]{nick.isEmpty()?"?":nick,ev,dt}); if(r.size()>=15)break;
        }
        return r;
    }
    private List<String[]> parseTerrenos(String json) {
        List<String[]> r=new ArrayList<>();
        for(String it:json.split("\\{")) {
            String id=f("{"+it,"id"),nome=f("{"+it,"name"),role=f("{"+it,"role");
            if(nome.isEmpty())continue; r.add(new String[]{id,nome,role.isEmpty()?"member":role}); if(r.size()>=20)break;
        }
        return r;
    }
    private List<String[]> parseMembros(String json) {
        List<String[]> r=new ArrayList<>();
        for(String it:json.split("\\{")) {
            String nick=f("{"+it,"nick"); if(nick.isEmpty())continue;
            r.add(new String[]{nick,f("{"+it,"playtimeFormatted"),f("{"+it,"pvpKills"),f("{"+it,"mobKills")}); if(r.size()>=20)break;
        }
        return r;
    }
    private List<String[]> parseRkHoras(String json) {
        List<String[]> r=new ArrayList<>();
        for(String it:json.split("\\{")) {
            String nick=f("{"+it,"nick"); if(nick.isEmpty())continue;
            r.add(new String[]{nick,f("{"+it,"playtimeFormatted")}); if(r.size()>=5)break;
        }
        return r;
    }
    private List<String[]> parseRkReinos(String json) {
        List<String[]> r=new ArrayList<>();
        for(String it:json.split("\\{")) {
            String nome=f("{"+it,"nome"); if(nome.isEmpty())continue;
            r.add(new String[]{nome,f("{"+it,"tag"),f("{"+it,"totalPoints"),f("{"+it,"owner_nick")}); if(r.size()>=10)break;
        }
        return r;
    }
    private List<String[]> parseZonas(String json) {
        List<String[]> r=new ArrayList<>();
        for(String it:json.split("\\{")) {
            String nome=f("{"+it,"name"); if(nome.isEmpty())continue;
            r.add(new String[]{f("{"+it,"id"),nome,f("{"+it,"world")}); if(r.size()>=20)break;
        }
        return r;
    }
}

package com.mapabermuda.whitelist;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Set;
import java.util.logging.Logger;

public class WhitelistPlugin extends JavaPlugin implements Listener {

    private static final String API_URL = "https://fffff-autoforge.vercel.app/api/check/";

    private static final Set<String> BYPASS = Set.of(
        "admin",
        "marcos",
        "marcosfranca1679"
    );

    private HttpClient httpClient;
    private Logger log;

    @Override
    public void onEnable() {
        this.log = getLogger();
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(6))
            .build();
        getServer().getPluginManager().registerEvents(this, this);
        log.info("Mapa Bermuda Whitelist & Ban - ATIVA! Conectada em: " + API_URL);
    }

    @Override
    public void onDisable() {
        log.info("[Whitelist] Plugin desativado.");
    }

    private Component buildBanMessage(String cleanName) {
        return Component.text()
            .append(Component.text("VOCE FOI BANIDO DO SERVIDOR!\n\n", NamedTextColor.DARK_RED, TextDecoration.BOLD))
            .append(Component.text("Nick: ", NamedTextColor.RED))
            .append(Component.text(cleanName + "\n\n", NamedTextColor.WHITE, TextDecoration.BOLD))
            .append(Component.text("Seu acesso foi bloqueado pelo administrador.\n\n", NamedTextColor.YELLOW))
            .append(Component.text("Mais informacoes em:\n", NamedTextColor.GRAY))
            .append(Component.text("fffff-autoforge.vercel.app", NamedTextColor.AQUA))
            .build();
    }

    private Component buildKickMessage(String cleanName) {
        return Component.text()
            .append(Component.text("ACESSO NEGADO!\n\n", NamedTextColor.RED, TextDecoration.BOLD))
            .append(Component.text("O nick '", NamedTextColor.YELLOW))
            .append(Component.text(cleanName, NamedTextColor.WHITE, TextDecoration.BOLD))
            .append(Component.text("' nao esta na Whitelist.\n\n", NamedTextColor.YELLOW))
            .append(Component.text("Solicite acesso em:\n", NamedTextColor.WHITE))
            .append(Component.text("fffff-autoforge.vercel.app", NamedTextColor.GREEN))
            .build();
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onAsyncPreLogin(AsyncPlayerPreLoginEvent event) {
        String name = event.getName();
        String cleanName = name.startsWith(".") ? name.substring(1) : name;

        if (BYPASS.contains(cleanName.toLowerCase())) {
            log.info("[Whitelist] Admin: " + cleanName + " - Liberado!");
            return;
        }

        log.info("[Whitelist] Verificando '" + cleanName + "' na API...");

        try {
            String encodedName = URLEncoder.encode(cleanName, StandardCharsets.UTF_8);
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(API_URL + encodedName))
                .timeout(Duration.ofSeconds(5))
                .header("User-Agent", "MapaBermuda-Whitelist-Plugin/1.2")
                .GET()
                .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            String body = response.body() != null ? response.body() : "";

            boolean banned  = body.contains("\"banned\":true");
            boolean allowed = body.contains("\"allowed\":true");

            if (banned) {
                log.info("[Whitelist] 🔨 '" + cleanName + "' esta BANIDO! Bloqueando entrada...");
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_BANNED, buildBanMessage(cleanName));

            } else if (!allowed) {
                log.info("[Whitelist] ❌ '" + cleanName + "' NAO aprovado. Expulsando...");
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_WHITELIST, buildKickMessage(cleanName));

            } else {
                log.info("[Whitelist] ✅ '" + cleanName + "' aprovado! Acesso liberado.");
            }

        } catch (Exception e) {
            log.warning("[Whitelist] Erro na API para '" + cleanName + "': " + e.getMessage());
            event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER,
                Component.text("Erro ao verificar whitelist. Tente novamente.", NamedTextColor.RED)
            );
        }
    }
}

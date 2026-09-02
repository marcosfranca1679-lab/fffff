package com.mapabermuda.whitelist;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
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

    // ─── URL da API do site (Vercel + Supabase) ───────────────────────────────
    private static final String API_URL = "https://fffff-autoforge.vercel.app/api/check/";

    // ─── Admins liberados sem verificação (em letras minúsculas) ──────────────
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
        log.info("╔══════════════════════════════════════╗");
        log.info("║  Mapa Bermuda Whitelist - ATIVA!     ║");
        log.info("║  Conectada em: " + API_URL.substring(0, 30) + "... ║");
        log.info("╚══════════════════════════════════════╝");
    }

    @Override
    public void onDisable() {
        log.info("[Whitelist] Plugin desativado.");
    }

    // ─── Evento assíncrono (perfeito para requisições web!) ──────────────────
    @EventHandler(priority = EventPriority.HIGHEST)
    public void onAsyncPreLogin(AsyncPlayerPreLoginEvent event) {
        String name = event.getName();

        // Remove o prefixo '.' do Geyser para jogadores de Bedrock/Celular
        String cleanName = name.startsWith(".") ? name.substring(1) : name;

        // Verifica se é um Admin liberado
        if (BYPASS.contains(cleanName.toLowerCase())) {
            log.info("[Whitelist] ✅ Admin detectado: " + cleanName + " - Acesso liberado!");
            return;
        }

        log.info("[Whitelist] 🔍 Verificando '" + cleanName + "' na API...");

        try {
            String encodedName = URLEncoder.encode(cleanName, StandardCharsets.UTF_8);
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(API_URL + encodedName))
                .timeout(Duration.ofSeconds(5))
                .header("User-Agent", "MapaBermuda-Whitelist-Plugin/1.0")
                .GET()
                .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            boolean allowed = response.statusCode() == 200
                && response.body() != null
                && response.body().contains("\"allowed\":true");

            if (allowed) {
                log.info("[Whitelist] ✅ '" + cleanName + "' aprovado no site! Acesso liberado.");
            } else {
                log.info("[Whitelist] ❌ '" + cleanName + "' NÃO aprovado no site! Expulsando...");
                Component kickMsg = LegacyComponentSerializer.legacySection().deserialize(
                    "&c&l╔══════════════════════════╗\n" +
                    "&c&l║     ACESSO NEGADO!       ║\n" +
                    "&c&l╚══════════════════════════╝\n\n" +
                    "&eSeu Nick &f'" + cleanName + "' &enão está\n" +
                    "&ena Whitelist do servidor.\n\n" +
                    "&fSolicite acesso em:\n" +
                    "&bfffff-autoforge.vercel.app"
                );
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_WHITELIST, kickMsg);
            }

        } catch (Exception e) {
            log.warning("[Whitelist] ⚠️ Erro ao consultar API para '" + cleanName + "': " + e.getMessage());
            // Em caso de falha na API, bloqueia por segurança
            event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER,
                LegacyComponentSerializer.legacySection().deserialize(
                    "&c[Whitelist] Erro ao verificar permissão.\n&eTente novamente em alguns segundos."
                )
            );
        }
    }
}

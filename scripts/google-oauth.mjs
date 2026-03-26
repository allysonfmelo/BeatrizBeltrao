/**
 * Script para gerar refresh token do Google OAuth2.
 * Usa apenas módulos nativos do Node.js — sem dependências externas.
 */
import http from "node:http";
import { URL } from "node:url";
import { execFileSync } from "node:child_process";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ Erro: As variáveis de ambiente GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET são obrigatórias.");
  process.exit(1);
}

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
];

const PORT = 8844;
const REDIRECT_URI = `http://localhost:${PORT}`;

// Step 1: Start local server to catch the callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    console.error("\n❌ Erro na autorização:", error);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h1>Erro: ${error}</h1><p>Verifique o Google Cloud Console.</p>`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(200);
    res.end("Aguardando...");
    return;
  }

  console.log("\n✅ Código de autorização recebido. Trocando por tokens...");

  // Step 3: Exchange code for tokens
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      console.error("\n❌ Erro ao trocar código:", tokens.error, tokens.error_description);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<h1>Erro: ${tokens.error}</h1><p>${tokens.error_description}</p>`);
      server.close();
      process.exit(1);
    }

    console.log("\n✅ Tokens obtidos com sucesso!");
    console.log("\n========================================");
    console.log("REFRESH_TOKEN:", tokens.refresh_token);
    console.log("========================================");
    console.log("\nAccess Token (expira em 1h):", tokens.access_token?.substring(0, 30) + "...");
    console.log("Scopes:", tokens.scope);

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <h1 style="color: green;">✅ Autorização concluída!</h1>
      <p>Refresh token gerado com sucesso. Pode fechar esta aba.</p>
    `);

    server.close();
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Erro:", err.message);
    res.writeHead(500);
    res.end("Erro interno");
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  // Step 2: Generate and open auth URL
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  const url = authUrl.toString();
  console.log("\n🔐 Abrindo browser para autorização Google...");
  console.log("   URL:", url);

  // Open browser (macOS)
  try {
    execFileSync("open", [url]);
    console.log("\n⏳ Aguardando autorização no browser...");
  } catch {
    console.log("\n⚠️  Abra manualmente a URL acima no browser.");
  }
});

// Timeout after 2 minutes
setTimeout(() => {
  console.error("\n⏰ Timeout — nenhuma resposta recebida em 2 minutos.");
  server.close();
  process.exit(1);
}, 120000);

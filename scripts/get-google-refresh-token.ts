/**
 * Script para gerar um novo Google OAuth refresh token.
 *
 * Uso: npx tsx scripts/get-google-refresh-token.ts
 *
 * 1. Abre o browser para autorização
 * 2. Você autoriza com sua conta Google
 * 3. O script retorna o novo refresh token
 * 4. Atualize o .env com o novo token
 */

import http from "node:http";
import { URL } from "node:url";
import { execFile } from "node:child_process";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ Variáveis GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET são obrigatórias no .env");
  process.exit(1);
}
const REDIRECT_PORT = 3333;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;
const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("\n🔐 Abrindo browser para autorização Google...\n");
console.log("Se não abrir automaticamente, acesse:");
console.log(authUrl.toString());
console.log("");

// Open browser using execFile (safe, no shell injection)
const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
execFile(openCmd, [authUrl.toString()]);

// Start local server to receive callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`);
  const code = url.searchParams.get("code");

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end("<h1>Erro: código de autorização não recebido</h1>");
    return;
  }

  // Exchange code for tokens
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

  const tokens = await tokenResponse.json() as { refresh_token?: string; access_token?: string; error?: string };

  if (tokens.error) {
    console.error("❌ Erro:", tokens);
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h1>Erro: ${tokens.error}</h1>`);
    server.close();
    process.exit(1);
  }

  console.log("\n✅ Tokens obtidos com sucesso!\n");
  console.log("=== REFRESH TOKEN (copie para o .env) ===");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log("==========================================\n");

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`
    <html><body style="font-family: sans-serif; text-align: center; padding: 40px;">
      <h1>✅ Autorização concluída!</h1>
      <p>Pode fechar esta aba e voltar ao terminal.</p>
      <pre style="background: #f0f0f0; padding: 20px; border-radius: 8px; text-align: left; max-width: 600px; margin: 20px auto; word-break: break-all;">
GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}
      </pre>
    </body></html>
  `);

  server.close();
  process.exit(0);
});

server.listen(REDIRECT_PORT, () => {
  console.log(`🔄 Aguardando callback em http://localhost:${REDIRECT_PORT}...\n`);
});

// Timeout after 2 minutes
setTimeout(() => {
  console.error("⏰ Timeout — autorização não completada em 2 minutos");
  server.close();
  process.exit(1);
}, 120000);

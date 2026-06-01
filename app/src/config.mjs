// ============================================================================
// Configuração central — lê segredos de variáveis de ambiente OU de arquivos
// locais (.service_role.txt / .skymail.txt) na raiz do projeto.
// Em produção (SquareCloud) usar env vars; em dev, os arquivos locais.
// ============================================================================
import { readFileSync, existsSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url); // raiz do projeto (../../ de app/src/)

function lerArquivo(nome){
  const u = new URL(nome, ROOT);
  return existsSync(u) ? readFileSync(u, "utf8") : null;
}
function parseKV(txt){
  const o = {};
  for(const l of String(txt||"").split(/\r?\n/)){ const m=l.match(/^(\w+)=(.*)$/); if(m) o[m[1].trim()]=m[2].trim(); }
  return o;
}

// Supabase — URL vem de env (prod) ou arquivo local .supabase_url.txt (dev).
// Não hardcodar o ref do projeto (repo é público).
const SUPABASE_URL = process.env.SUPABASE_URL || (lerArquivo(".supabase_url.txt") || "").trim();
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  (lerArquivo(".service_role.txt") || "").trim();

// SkyMail
const sky = parseKV(lerArquivo(".skymail.txt"));
const SKYMAIL_USER = process.env.SKYMAIL_USER || sky.usuario || "";
const SKYMAIL_PASS = process.env.SKYMAIL_PASS || sky.senha || "";

// Destinatários do e-mail de pedido (dados de terceiros → NÃO versionar).
// Dev: arquivo .destinatarios.json na raiz. Prod: env DESTINATARIOS_JSON (string JSON).
let destinatarios = { para: [], copia: [] };
try {
  const txt = process.env.DESTINATARIOS_JSON || lerArquivo(".destinatarios.json");
  if(txt) destinatarios = JSON.parse(txt);
} catch(e){ /* fica vazio */ }

export const config = {
  supabase: { url: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_KEY },
  skymail:  { usuario: SKYMAIL_USER, senha: SKYMAIL_PASS },
  destinatarios,
};

export function checar(necessita = ["supabase","skymail"]){
  const faltas = [];
  if(necessita.includes("supabase") && !config.supabase.serviceKey) faltas.push("SUPABASE_SERVICE_KEY / .service_role.txt");
  if(necessita.includes("skymail") && (!config.skymail.usuario || !config.skymail.senha)) faltas.push("SKYMAIL_USER/PASS / .skymail.txt");
  return faltas;
}

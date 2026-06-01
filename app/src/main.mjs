// ============================================================================
// MAIN — ponto de entrada do robô diário de Multas ANTT (rodado pelo GitHub Actions).
// Executa Agente A (coleta SIFAMA → grava Aguardando → rascunho) e Agente B
// (arquiva e-mails + lê PDFs → completa Concluído + arquiva PDFs no SkyMail).
// ⛔ NUNCA envia e-mail (Agente A só cria RASCUNHO; envio é manual pelo usuário).
//
// Flags por env/CLI:
//   SO_AGENTE=A|B   → roda só um agente (default: ambos)
//   DIAS=NN         → janela do Agente B (default 45 dias). Evita reprocessar histórico.
//   DRY_RUN=1       → simula, não grava/arquiva.
//   CRIAR_RASCUNHO=1→ Agente A cria rascunho do e-mail (default: não, p/ segurança)
// ============================================================================
import { rodarAgenteA } from "./agents/agenteA.mjs";
import { rodarAgenteB } from "./agents/agenteB.mjs";
import { checar } from "./config.mjs";

function env(k, def){ return process.env[k] !== undefined ? process.env[k] : def; }

// "agora" injetado via env opcional (testabilidade); senão usa relógio do runner.
function agora(){
  const iso = env("AGORA_ISO", "");
  return iso ? new Date(iso) : new Date();
}

async function main(){
  const dryRun = env("DRY_RUN","") === "1";
  const so = (env("SO_AGENTE","") || "").toUpperCase();
  const dias = parseInt(env("DIAS","45"), 10) || 45;
  // janela do Agente A: mês atual + N anteriores (default 2 = 3 meses). Cobre multas
  // antigas lavradas recentemente (ex.: infração de abril lançada em maio).
  const mesesAtras = parseInt(env("MESES_ATRAS","2"), 10);
  // rascunho automático LIGADO por padrão (rascunho ≠ envio; usuário revisa e envia).
  // p/ desligar: CRIAR_RASCUNHO=0
  const criarRascunhos = env("CRIAR_RASCUNHO","1") !== "0";

  const faltas = checar(["supabase","skymail"]);
  if(faltas.length){ console.error("ERRO: faltam credenciais:", faltas.join(", ")); process.exit(1); }

  const hoje = agora();
  const desde = new Date(hoje.getTime() - dias*24*60*60*1000);
  console.log(`=== Robô Multas ANTT | ${hoje.toISOString()} | janela ${dias}d (desde ${desde.toISOString().slice(0,10)}) | dryRun=${dryRun} ===`);

  let falhou = false;

  if(so !== "B"){
    console.log("\n--- AGENTE A (coleta SIFAMA) ---");
    try{
      const a = await rodarAgenteA({ hoje, dryRun, criarRascunhos, mesesAtras });
      a.log.forEach(l=>console.log("  "+l));
      console.log(`  RESUMO A: novos=${a.novos} inseridos=${a.inseridos} emails=${a.emails.length} rascunhos=${a.rascunhos.length}`);
    }catch(e){ falhou = true; console.error("  FALHA Agente A:", e.message); }
  }

  if(so !== "A"){
    console.log("\n--- AGENTE B (processa PDFs da Fernanda) ---");
    try{
      const b = await rodarAgenteB({ desde, dryRun });
      b.log.forEach(l=>console.log("  "+l));
      console.log(`  RESUMO B: processados=${b.processados} concluidos=${b.concluidos} jaConcluidos=${b.jaConcluidos} pdfsSalvos=${b.pdfsSalvos||0} avisos=${b.comAvisos.length} erros=${b.erros.length}`);
      if(b.comAvisos.length) b.comAvisos.slice(0,20).forEach(w=>console.log("    aviso", w.auto, ":", w.avisos.join("; ")));
      if(b.erros.length){ falhou = true; b.erros.slice(0,20).forEach(e=>console.error("    ERRO", e.auto, ":", e.erro)); }
    }catch(e){ falhou = true; console.error("  FALHA Agente B:", e.message); }
  }

  console.log("\n=== FIM ===");
  process.exit(falhou ? 1 : 0);
}

main().catch(e=>{ console.error("FATAL:", e.message); process.exit(1); });

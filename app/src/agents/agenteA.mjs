// ============================================================================
// AGENTE A (coletor, diário) — Multas ANTT
// SIFAMA → autos novos (diff vs banco) → grava 'Aguardando' → cria RASCUNHO do
// e-mail de pedido (NÃO envia). Idempotente. Ver fluxo-multas-antt (memória).
// ============================================================================
import { config, checar } from "../config.mjs";
import { bootstrap, coletarAutos, normalizarLinha, SIFAMA_DEFAULT } from "../lib/sifama.mjs";
import { makeClient } from "../lib/supabase.mjs";
import { montarEmailsPedido } from "../lib/emailPedido.mjs";
import { abrir, criarRascunho } from "../lib/email.mjs";
import { autosNaPlanilha } from "../lib/planilha.mjs";

// período padrão: do 1º dia do mês passado até hoje (datas passadas pelo chamador p/ testabilidade)
export function periodoPadrao(hoje){
  const fim = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
  const ini = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth()-1, 1));
  return { ini, fim };
}
function dentro(brDate, ini, fim){
  const m = String(brDate).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if(!m) return false;
  const d = new Date(Date.UTC(+m[3], +m[2]-1, +m[1]));
  return d >= ini && d <= fim;
}

// opts: { hoje:Date, dryRun:bool (não grava/rascunha), criarRascunhos:bool }
export async function rodarAgenteA(opts = {}){
  const hoje = opts.hoje || new Date();
  const dryRun = !!opts.dryRun;
  const faltas = checar(["supabase"]);
  if(faltas.length && !dryRun) throw new Error("Faltam credenciais: " + faltas.join(", "));

  const log = [];
  const { ini, fim } = periodoPadrao(hoje);
  log.push(`Período: ${ini.toISOString().slice(0,10)} → ${fim.toISOString().slice(0,10)}`);

  // 1) coleta SIFAMA (2 empresas)
  const ctx = await bootstrap();
  const coletados = [];
  for(const emp of SIFAMA_DEFAULT.empresas){
    const r = await coletarAutos(ctx, emp.sifama);
    for(const row of r.autos){
      const n = normalizarLinha(row, emp.banco);
      if(dentro(n.dataInfracao, ini, fim)) coletados.push(n);
    }
    log.push(`SIFAMA ${emp.banco}: ${r.total} autos (período: ${coletados.filter(c=>c.empresa===emp.banco).length})`);
  }

  // 2) diff vs DUAS fontes: banco (Supabase) + planilha Google (CSV público).
  // Evita pedir à Fernanda autos que já foram estratificados (estão em qualquer uma).
  const db = makeClient(config.supabase);
  const existentes = await db.autosExistentes();
  let naPlanilha = new Set();
  try {
    naPlanilha = await autosNaPlanilha();
    log.push(`Planilha (MULTAS ANTT): ${naPlanilha.size} autos lidos`);
  } catch(e){
    log.push(`AVISO: não consegui ler a planilha (${e.message.slice(0,60)}) — diff só com o banco`);
  }
  const conhecido = (auto) => existentes.has(auto) || naPlanilha.has(auto);
  const novos = coletados.filter(c => !conhecido(c.autoInfracao));
  log.push(`Novos (nem no banco nem na planilha): ${novos.length}`);

  // 3) grava 'Aguardando' (idempotente)
  let inseridos = 0;
  if(!dryRun && novos.length){
    const reg = novos.map(n => ({
      autoInfracao: n.autoInfracao, empresa: n.empresa, dataHora: `${n.dataInfracao} ${n.horaInfracao}`.trim(),
      codigoInfracao: n.codigoInfracao, placaVeiculo: n.placaVeiculo, status: "Aguardando",
    }));
    const res = await db.inserirAguardando(reg);
    inseridos = res.inseridos;
    log.push(`Inseridos 'Aguardando': ${inseridos} (pulados ${res.pulados})`);
  }

  // 4) monta e-mails de pedido (sempre) e cria RASCUNHO (se pedido)
  const emails = montarEmailsPedido(novos);
  log.push(`E-mails de pedido montados: ${emails.length}`);
  const rascunhos = [];
  if(opts.criarRascunhos && !dryRun && emails.length){
    const client = await abrir(config.skymail);
    try{
      for(const e of emails){
        const r = await criarRascunho(client, `LUIS LIMA <${config.skymail.usuario}>`, e);
        rascunhos.push({ assunto: e.assunto, uid: r.uid });
      }
    } finally { await client.logout(); }
    log.push(`Rascunhos criados: ${rascunhos.length}`);
  }

  return { novos: novos.length, inseridos, emails, rascunhos, log };
}

// ============================================================================
// AGENTE B (processador, diário) — Multas ANTT
// Lê respostas da Fernanda (SkyMail) → baixa PDFs (nome=auto) → extrai + regras
// → completa a multa no Supabase (status 'Concluído'). ⛔ NÃO envia e-mail.
// Ver fluxo-multas-antt (memória).
// ============================================================================
import { config, checar } from "../config.mjs";
import { abrir, listarRespostasFernanda, baixarAnexo, arquivarEstratificacoes } from "../lib/email.mjs";
import { lerPDF } from "../lib/pdf.mjs";
import { arquivarPDFnoEmail } from "../lib/arquivo_pdf_imap.mjs";
import { montarMultaCompleta, normNome, indexarMotoristas } from "../rules/multas.mjs";
import { makeClient } from "../lib/supabase.mjs";

// opts: { desde:Date, somentePastas:[..], dryRun:bool, max:n, arquivar, arquivarPDF }
export async function rodarAgenteB(opts = {}){
  const dryRun = !!opts.dryRun;
  const faltas = checar(["supabase","skymail"]);
  if(faltas.length) throw new Error("Faltam credenciais: " + faltas.join(", "));

  const log = [];
  const db = makeClient(config.supabase);
  const aux = await db.tabelasAuxiliares(normNome, indexarMotoristas);
  log.push(`Aux: ${Object.keys(aux.tabelaCodigos).length} códigos, ${Object.keys(aux.veiculosPorPlaca).length} veículos, ${Object.keys(aux.motoristasPorNome).length} motoristas`);

  const client = await abrir(config.skymail);
  const resultados = { processados: 0, concluidos: 0, jaConcluidos: 0, semRegistro: 0, comAvisos: [], erros: [], arquivados: 0 };
  try{
    // 0) arquiva (copia) as estratificações da Fernanda da INBOX → pasta FERNANDA ANTT
    if(opts.arquivar !== false && !dryRun){
      try{ const arq = await arquivarEstratificacoes(client, { mover:false }); resultados.arquivados = arq.arquivados; log.push(`Arquivados p/ FERNANDA ANTT: ${arq.arquivados}`); }
      catch(e){ log.push(`Aviso arquivamento: ${e.message.slice(0,100)}`); }
    }
    const respostas = await listarRespostasFernanda(client, opts.somentePastas ? { pastas: opts.somentePastas, desde: opts.desde } : { desde: opts.desde });
    log.push(`Respostas da Fernanda com PDFs: ${respostas.length}`);

    let count = 0;
    for(const r of respostas){
      for(const a of r.autos){
        if(opts.max && count >= opts.max) break;
        count++;
        try{
          // já está concluído? pula (evita reprocessar)
          const existente = dryRun ? null : await db.existeAuto(a.auto);
          if(existente && existente.status === "Concluído"){ resultados.jaConcluidos++; continue; }

          const buf = await baixarAnexo(client, r.pasta, r.uid, a.partId);
          const campos = await lerPDF(buf, a.auto);
          const { registro, avisos } = montarMultaCompleta(campos, aux);
          resultados.processados++;
          if(avisos.length) resultados.comAvisos.push({ auto: a.auto, avisos });

          // arquiva o PDF em subpasta do SkyMail (MULTAS ANTT/ANO/Mês/SETOR)
          if(opts.arquivarPDF !== false && !dryRun){
            try{
              const sv = await arquivarPDFnoEmail(client, buf, {
                de: `LUIS LIMA <${config.skymail.usuario}>`,
                dataInfracao: campos.dataInfracao, setor: registro.setor,
                autoInfracao: campos.autoInfracao, empresa: registro.empresa,
              });
              if(sv.ok && !sv.jaExistia) resultados.pdfsSalvos = (resultados.pdfsSalvos||0)+1;
            }catch(e){ /* não bloqueia o processamento */ }
          }

          if(!dryRun){
            if(existente){
              // completa a linha existente
              const dados = { ...registro }; delete dados.autoInfracao;
              await db.completarMulta(a.auto, dados);
            } else {
              // não existe 'Aguardando' (Agente A não rodou p/ esse) → cria já concluída
              await db.inserirAguardando([{ ...registro }]);  // entra com status do registro (Concluído)
            }
            resultados.concluidos++;
          }
        }catch(e){
          resultados.erros.push({ auto: a.auto, erro: e.message.slice(0,160) });
        }
      }
    }
  } finally { await client.logout(); }

  log.push(`Processados: ${resultados.processados} | concluídos: ${resultados.concluidos} | já concluídos: ${resultados.jaConcluidos} | erros: ${resultados.erros.length}`);
  return { ...resultados, log };
}

// ============================================================================
// Arquiva PDFs de multa em subpastas do SkyMail (IMAP), organizadas por
//   MULTAS ANTT.<ANO>.<Mês>.<SETOR>   (separador hierárquico do SkyMail = ".")
// Cada multa = 1 mensagem (assunto = autoInfracao) com o PDF anexo.
// Funciona na nuvem (IMAP puro). Evita duplicar (checa assunto na subpasta).
// ============================================================================

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
               "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const RAIZ = "MULTAS ANTT";        // pasta já existente no SkyMail
const DELIM = ".";

// "." no nome de uma parte quebraria a hierarquia → trocar por "-"
function parteSegura(s){ return String(s||"").replace(/\./g,"-").replace(/[\r\n\t]/g," ").trim(); }

function anoMes(dataInfracao){
  const m = String(dataInfracao||"").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!m) return null;
  const i = parseInt(m[2],10)-1;
  if(i<0||i>11) return null;
  return { ano: m[3], mesNome: MESES[i] };
}

// garante que a subpasta existe (cria a cadeia se preciso). Retorna o path final.
export async function garantirSubpasta(client, partes){
  let atual = RAIZ;
  // cria raiz se não existir
  const existentes = new Set((await client.list()).map(m=>m.path));
  if(!existentes.has(atual)){ try{ await client.mailboxCreate(atual); }catch(e){} }
  for(const p of partes){
    atual = atual + DELIM + parteSegura(p);
    if(!existentes.has(atual)){ try{ await client.mailboxCreate(atual); existentes.add(atual); }catch(e){} }
  }
  return atual;
}

// monta um .eml com o PDF anexo (multipart/mixed)
function montarEmlComPDF(de, assunto, corpo, pdfBuffer, nomePdf){
  const bd = "____MULTA_BOUNDARY_" + assunto.replace(/[^A-Za-z0-9]/g,"") + "____";
  const b64 = pdfBuffer.toString("base64").replace(/(.{76})/g,"$1\r\n");
  return [
    `From: ${de}`,
    `Subject: ${assunto}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${bd}"`,
    ``,
    `--${bd}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    corpo,
    ``,
    `--${bd}`,
    `Content-Type: application/pdf; name="${nomePdf}"`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: attachment; filename="${nomePdf}"`,
    ``,
    b64,
    `--${bd}--`,
    ``,
  ].join("\r\n");
}

// já existe mensagem com esse assunto (auto) na subpasta?
async function jaArquivado(client, pasta, auto){
  let lock;
  try { lock = await client.getMailboxLock(pasta); } catch(e){ return false; }
  try{
    if(!client.mailbox.exists) return false;
    const uids = await client.search({ header: { subject: auto } }, { uid:true });
    return uids && uids.length > 0;
  } finally { lock.release(); }
}

// Arquiva 1 PDF. opts: { de, dataInfracao, setor, autoInfracao }
export async function arquivarPDFnoEmail(client, pdfBuffer, opts){
  const am = anoMes(opts.dataInfracao);
  if(!am) return { ok:false, motivo:"data inválida" };
  const setor = parteSegura(opts.setor) || "SEM SETOR";
  const auto = parteSegura(opts.autoInfracao);
  const pasta = await garantirSubpasta(client, [am.ano, am.mesNome, setor]);
  if(await jaArquivado(client, pasta, auto)) return { ok:true, pasta, jaExistia:true };
  const corpo = `Auto: ${auto}\nData: ${opts.dataInfracao}\nSetor: ${setor}\nEmpresa: ${opts.empresa||""}`;
  const eml = montarEmlComPDF(opts.de, auto, corpo, pdfBuffer, auto + ".pdf");
  await client.append(pasta, Buffer.from(eml, "utf8"), ["\\Seen"]);
  return { ok:true, pasta, jaExistia:false };
}

export { MESES, RAIZ };

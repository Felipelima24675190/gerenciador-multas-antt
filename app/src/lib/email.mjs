// ============================================================================
// Módulo E-mail SkyMail (IMAP) — Agente B (ler respostas Fernanda + baixar PDFs)
// e criação de RASCUNHO do pedido (Agente A). ⛔ NUNCA ENVIA e-mail (sem SMTP send).
// Servidor: imap.skymail.com.br:993 SSL (sem 2FA). Ver fluxo-multas-antt (memória).
// ============================================================================
import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { ImapFlow } = require("imapflow");

// remetente da advogada vem de config.destinatarios (env/arquivo) p/ não versionar e-mail de terceiro.
import { config } from "../config.mjs";
export const SKYMAIL = {
  host: "imap.skymail.com.br", port: 993, secure: true,
  pastaFernanda: "FERNANDA ANTT",
  pastaInbox: "INBOX",
  pastaRascunhos: "Rascunhos",
  remetenteFernanda: (config.destinatarios && config.destinatarios.remetenteFernanda) || process.env.REMETENTE_FERNANDA || "",
};

export function lerCredenciais(txt){
  const cred = {};
  for(const l of String(txt).split(/\r?\n/)){ const m=l.match(/^(\w+)=(.*)$/); if(m) cred[m[1].trim()]=m[2].trim(); }
  return cred;
}

export async function abrir({ usuario, senha }){
  const client = new ImapFlow({
    host: SKYMAIL.host, port: SKYMAIL.port, secure: SKYMAIL.secure,
    auth: { user: usuario, pass: senha }, logger: false, socketTimeout: 60000,
  });
  await client.connect();
  return client;
}

// Lista respostas da Fernanda (em FERNANDA ANTT + INBOX), com os PDFs anexos (nome=auto).
// Retorna [{ seq, uid, pasta, assunto, data, autos:[{auto, partId, filename}] }]
export async function listarRespostasFernanda(client, { pastas = [SKYMAIL.pastaFernanda, SKYMAIL.pastaInbox], desde } = {}){
  const out = [];
  for(const pasta of pastas){
    let lock;
    try { lock = await client.getMailboxLock(pasta); } catch(e){ continue; }
    try{
      const criteria = { from: SKYMAIL.remetenteFernanda };
      if(desde) criteria.since = desde;
      const uids = await client.search(criteria, { uid: true });
      if(!uids || !uids.length) continue;
      for await (const msg of client.fetch({ uid: uids.join(",") }, { uid:true, envelope:true, bodyStructure:true }, { uid:true })){
        const env = msg.envelope || {};
        const autos = [];
        (function walk(node){
          if(!node) return;
          const fn = (node.dispositionParameters&&node.dispositionParameters.filename) || (node.parameters&&node.parameters.name);
          if(fn && /^PASLD\d+\.pdf$/i.test(fn)){
            autos.push({ auto: fn.replace(/\.pdf$/i,""), partId: node.part || node.partID || node.id, filename: fn });
          }
          (node.childNodes||[]).forEach(walk);
        })(msg.bodyStructure);
        if(autos.length) out.push({ uid: msg.uid, pasta, assunto: env.subject||"", data: env.date||null, autos });
      }
    } finally { if(lock) lock.release(); }
  }
  return out;
}

// Baixa o conteúdo (Buffer) de um anexo PDF específico de uma mensagem.
export async function baixarAnexo(client, pasta, uid, partId){
  let lock = await client.getMailboxLock(pasta);
  try{
    const { content } = await client.download(uid, partId, { uid: true });
    const chunks = [];
    for await (const c of content) chunks.push(c);
    return Buffer.concat(chunks);
  } finally { lock.release(); }
}

// Arquiva (COPIA, mantém na origem) as respostas de "Estratificação de Multas ANTT"
// da Fernanda que estão na INBOX e ainda NÃO estão na pasta FERNANDA ANTT.
// ⛔ IGNORA "Relatório Semanal de Multas" e outros assuntos. Cópia interna (não envia).
export async function arquivarEstratificacoes(client, { mover = false } = {}){
  const ASSUNTO_OK = /estratifica[çc][aã]o de multas antt/i;
  // 1) coleta os Message-IDs já presentes na pasta destino (p/ não duplicar)
  const idsDestino = new Set();
  let lockDest = await client.getMailboxLock(SKYMAIL.pastaFernanda);
  try{
    const exists = client.mailbox.exists;
    if(exists){
      for await (const m of client.fetch("1:*", { envelope:true })){
        const mid = m.envelope && m.envelope.messageId;
        if(mid) idsDestino.add(mid);
      }
    }
  } finally { lockDest.release(); }

  // 2) varre a INBOX por e-mails da Fernanda com assunto de estratificação
  const movidos = [];
  let lockIn = await client.getMailboxLock(SKYMAIL.pastaInbox);
  try{
    const uids = await client.search({ from: SKYMAIL.remetenteFernanda }, { uid: true });
    if(uids && uids.length){
      const alvo = [];
      for await (const m of client.fetch({ uid: uids.join(",") }, { uid:true, envelope:true }, { uid:true })){
        const subj = (m.envelope && m.envelope.subject) || "";
        const mid = m.envelope && m.envelope.messageId;
        if(ASSUNTO_OK.test(subj) && !(mid && idsDestino.has(mid))){
          alvo.push({ uid: m.uid, subj });
        }
      }
      for(const a of alvo){
        if(mover) await client.messageMove(a.uid, SKYMAIL.pastaFernanda, { uid:true });
        else      await client.messageCopy(a.uid, SKYMAIL.pastaFernanda, { uid:true });
        movidos.push(a.subj);
      }
    }
  } finally { lockIn.release(); }
  return { arquivados: movidos.length, assuntos: movidos };
}

// Cria um RASCUNHO (não envia) na pasta Rascunhos. email = {para,copia,assunto,corpo}
// Monta um .eml mínimo (cabeçalhos + corpo texto). De: o próprio usuário.
export async function criarRascunho(client, de, email){
  const fmt = (arr)=> (arr||[]).map(p=> p.nome ? `${p.nome} <${p.email}>` : p.email).filter(Boolean).join(", ");
  const headers = [
    `From: ${de}`,
    `To: ${fmt(email.para)}`,
    email.copia && email.copia.length ? `Cc: ${fmt(email.copia)}` : null,
    `Subject: ${email.assunto}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
  ].filter(Boolean).join("\r\n");
  const eml = headers + "\r\n\r\n" + String(email.corpo).replace(/\n/g,"\r\n");
  const res = await client.append(SKYMAIL.pastaRascunhos, Buffer.from(eml, "utf8"), ["\\Draft"]);
  return res; // {uid, ...}
}

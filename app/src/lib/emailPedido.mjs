// ============================================================================
// Gera o e-mail de PEDIDO de estratificação (Fase 1: autos novos do SIFAMA).
// Modelo ensinado pelo usuário + exemplo real ("Estratificação de Multas ANTT
// Maio 2026 - Dias 11,12,13,14,15,18 e 19"). 1 e-mail por empresa (96% Progresso).
// Ver fluxo-multas-antt (memória). NÃO envia — só monta (envio exige confirmação).
// ============================================================================

const MESES = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO",
               "JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
const MES_TITULO = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                    "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

// Destinatários — lidos de config (env/arquivo). Não versionar e-mails de terceiros.
// Formato em config.destinatarios = { para:[{nome,email}], copia:[{nome,email}] }.
import { config } from "../config.mjs";
export const DESTINATARIOS = (config.destinatarios && config.destinatarios.para && config.destinatarios.para.length)
  ? config.destinatarios
  : { para: [], copia: [] };

// "AUTO VIACAO PROGRESSO LTDA" -> "Progresso" ; "...CRUZEIRO LTDA" -> "Cruzeiro"
function empresaCurta(empresaBanco){
  const u = (empresaBanco||"").toUpperCase();
  if(u.includes("PROGRESSO")) return "Progresso";
  if(u.includes("CRUZEIRO")) return "Cruzeiro";
  return empresaBanco;
}

// dias [11,12,13] -> "11, 12 e 13" ; [21] -> "21"
function formatarDias(dias){
  const d = [...new Set(dias)].sort((a,b)=>a-b);
  if(d.length === 1) return String(d[0]);
  return d.slice(0,-1).join(", ") + " e " + d[d.length-1];
}

// parse DD/MM/YYYY -> {dia, mes(0-11), ano}
function parseData(br){
  const m = String(br).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!m) return null;
  return { dia: +m[1], mes: +m[2]-1, ano: +m[3] };
}

// Agrupa autos novos por (empresa, ano, mês) e monta um e-mail para cada grupo.
// autos: [{autoInfracao, empresa, dataInfracao(DD/MM/YYYY)}]
export function montarEmailsPedido(autos){
  const grupos = new Map();
  for(const a of autos){
    const p = parseData(a.dataInfracao);
    if(!p) continue;
    const key = `${a.empresa}|${p.ano}|${p.mes}`;
    if(!grupos.has(key)) grupos.set(key, { empresa:a.empresa, ano:p.ano, mes:p.mes, dias:[], autos:[] });
    const g = grupos.get(key);
    g.dias.push(p.dia);
    g.autos.push(a);
  }

  const emails = [];
  for(const g of grupos.values()){
    const curta = empresaCurta(g.empresa);
    const diasFmt = formatarDias(g.dias);
    const nDias = new Set(g.dias).size;
    const mesNome = MES_TITULO[g.mes];
    const mesUpper = MESES[g.mes];
    const palavraDia = nDias === 1 ? "Dia" : "Dias";
    const palavraDiaCorpo = nDias === 1 ? "ao DIA" : "aos DIAS";

    // ordena autos por data depois por número
    const autosOrd = [...g.autos].sort((x,y)=>{
      const px=parseData(x.dataInfracao), py=parseData(y.dataInfracao);
      if(px.dia!==py.dia) return px.dia-py.dia;
      return x.autoInfracao.localeCompare(y.autoInfracao);
    });
    const listaAutos = autosOrd.map(a=>a.autoInfracao).join("\n");

    const assunto = `Estratificação de Multas ANTT ${mesNome} ${g.ano} - ${palavraDia} ${diasFmt}`;
    const corpo =
`Por gentileza, solicito a estratificação das multas ANTT referentes ${palavraDiaCorpo} ${diasFmt} de ${mesUpper} da ${curta}

${listaAutos}

--
Atenciosamente,`;

    emails.push({
      empresa: g.empresa, empresaCurta: curta, ano: g.ano, mes: g.mes+1, mesNome,
      dias: [...new Set(g.dias)].sort((a,b)=>a-b), qtdAutos: autosOrd.length,
      assunto, corpo,
      para: DESTINATARIOS.para, copia: DESTINATARIOS.copia,
      autos: autosOrd.map(a=>a.autoInfracao),
    });
  }
  // mais recentes/maior volume primeiro
  emails.sort((a,b)=> b.qtdAutos - a.qtdAutos);
  return emails;
}

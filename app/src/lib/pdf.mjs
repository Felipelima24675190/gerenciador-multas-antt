// ============================================================================
// Módulo PDF — extrai os campos de um Auto de Infração de Passageiros (ANTT).
// O PDF é texto puro com rótulos numerados ("14 - DATA" seguido do valor).
// Validado em 2026-05-31 contra 21 PDFs reais. Ver docs/pdf-multa-mapeamento.md.
// ============================================================================
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

// Rótulos exatos como aparecem no PDF (ordem importa p/ delimitar o valor).
// ⚠️ A numeração dos campos VARIA entre PDFs (ex.: CÓDIGO ora é "23 -", ora "24 -").
// Por isso casamos pelo TEXTO do rótulo (sem o número). Cada chave canônica tem
// uma lista de textos aceitos (uppercase, sem o "N - " inicial).
const FIELD_TEXTS = {
  "AUTO":            ["AUTO Nº", "AUTO N°", "AUTO No"],
  "NOME INFRATOR":   ["NOME DO INFRATOR"],
  "CPF/CNPJ":        ["CPF/CNPJ"],
  "UF/ORIGEM":       ["UF/ORIGEM"],
  "MUNICIPIO/ORIGEM":["MUNICÍPIO/ORIGEM"],
  "UF/DESTINO":      ["UF/DESTINO"],
  "MUNICIPIO/DESTINO":["MUNICÍPIO/DESTINO"],
  "PREFIXO":         ["PREFIXO"],
  "PLACA":           ["PLACA"],
  "UF VEICULO":      ["UF"],            // 1ª "UF" após PLACA (tratado por ordem)
  "MARCA":           ["MARCA"],
  "MODELO":          ["MODELO"],
  "NOME CONDUTOR":   ["NOME DO CONDUTOR"],
  "CPF CONDUTOR":    ["CPF"],
  "DATA":            ["DATA"],
  "HORA":            ["HORA"],
  "UF INFRACAO":     ["UF"],            // 2ª "UF" (local) — tratado por ordem
  "MUNICIPIO":       ["MUNICÍPIO"],
  "TERMINAL":        ["TERMINAL"],
  "ARTIGO":          ["ARTIGO"],
  "INCISO":          ["INCISO"],
  "ALINEA":          ["ALÍNEA"],
  "RESOLUCAO":       ["RESOLUÇÃO"],
  "CODIGO":          ["CÓDIGO"],
  "DESCRICAO":       ["DESCRIÇÃO DA INFRAÇÃO"],
  "OBSERVACOES":     ["OBSERVAÇÕES DO AGENTE DE FISCALIZAÇÃO", "OBSERVAÇÕES DO AGENTE"],
  "PRAZO":           ["PRAZO DE APRESENTAÇÃO DE DEFESA"],
  "ORDEM CESSACAO":  ["ORDEM DE CESSAÇÃO DA PRÁTICA IRREGULAR"],
  "ENTIDADE":        ["NOME DA ENTIDADE OU ORGÃO", "NOME DA ENTIDADE OU ÓRGÃO"],
  "MATRICULA AGENTE":["MATRICULA DO AGENTE", "MATRÍCULA DO AGENTE"],
};
// remove o prefixo "N - " ou "N- " de uma linha de rótulo
function semNumero(linha){
  return linha.replace(/^\s*\d{1,2}\s*[-–]\s*/, "").trim().toUpperCase();
}

// Cabeçalhos de seção (não numerados) que aparecem ENTRE campos — devem cortar o valor.
const SECTION_HEADERS = [
  "IDENTIFICAÇÃO DO INFRATOR",
  "IDENTIFICAÇÃO DO SERVIÇO",
  "IDENTIFICAÇÃO DO VEÍCULO",
  "IDENTIFICAÇÃO DO CONDUTOR",
  "LOCAL DA INFRAÇÃO",
  "PENALIDADE PREVISTA E AMPARO LEGAL",
  "ENTIDADE FISCALIZADORA",
  "ENTIDADE   FISCALIZADORA",
];

// Faz o parse em SEQUÊNCIA: percorre as linhas; quando uma linha (sem número) bate
// num texto de rótulo conhecido, o valor são as linhas seguintes até o próximo
// rótulo/cabeçalho. Casa por TEXTO (robusto à variação de numeração) e por ORDEM
// (resolve as duas "UF": a 1ª após PLACA = veículo; a 2ª = infração).
function fieldsFromText(text){
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length);
  const headerSet = new Set(SECTION_HEADERS.map(h=>h.toUpperCase()));
  // texto-rótulo -> chave canônica (1ª que contém). "UF" é especial (ordem).
  function chaveDoRotulo(txtUpper, jaVistas){
    for(const [chave, textos] of Object.entries(FIELD_TEXTS)){
      for(const t of textos){
        if(txtUpper === t.toUpperCase()){
          if(chave === "UF VEICULO" || chave === "UF INFRACAO"){
            // "UF" sozinho: 1ª ocorrência = veículo, 2ª = infração
            return jaVistas.has("UF VEICULO") ? "UF INFRACAO" : "UF VEICULO";
          }
          return chave;
        }
      }
    }
    return null;
  }
  // marca quais linhas são rótulos
  const marks = []; // {line, chave}
  const jaVistas = new Set();
  for(let i=0;i<lines.length;i++){
    const semNum = semNumero(lines[i]);
    let chave = chaveDoRotulo(semNum, jaVistas);
    if(chave){ jaVistas.add(chave); marks.push({ i, chave }); }
  }
  const out = {};
  for(let m=0;m<marks.length;m++){
    const start = marks[m].i + 1;
    const end = (m+1 < marks.length) ? marks[m+1].i : lines.length;
    const vals = [];
    for(let k=start;k<end;k++){
      const up = lines[k].toUpperCase();
      if(headerSet.has(up)) break;
      vals.push(lines[k]);
    }
    out[marks[m].chave] = vals.join(" ").trim();
  }
  return out;
}

// Mapeia os campos crus -> objeto da multa (campos do PDF; regras de negócio à parte)
export function extrairCamposPDF(text, fallbackAuto){
  const f = fieldsFromText(text);
  const auto = (f["AUTO"] || fallbackAuto || "").replace(/\s+/g,"");
  const data = f["DATA"] || "";
  const hora = f["HORA"] || "";
  return {
    autoInfracao: auto,
    nomeInfrator: f["NOME INFRATOR"] || "",
    cnpj: f["CPF/CNPJ"] || "",
    ufOrigem: f["UF/ORIGEM"] || "",
    municipioOrigem: f["MUNICIPIO/ORIGEM"] || "",
    ufDestino: f["UF/DESTINO"] || "",
    municipioDestino: f["MUNICIPIO/DESTINO"] || "",
    prefixoPDF: f["PREFIXO"] || "",                // ⚠️ NÃO é o prefixo do banco (usar veiculos via placa)
    placaVeiculo: f["PLACA"] || "",
    ufVeiculo: f["UF VEICULO"] || "",
    marca: f["MARCA"] || "",
    modelo: f["MODELO"] || "",
    nomeCondutor: f["NOME CONDUTOR"] || "",
    cpfCondutor: f["CPF CONDUTOR"] || "",
    dataInfracao: data,
    horaInfracao: hora,
    dataHora: (data && hora) ? `${data} ${hora}` : data,
    ufInfracao: f["UF INFRACAO"] || "",
    municipioInfracao: f["MUNICIPIO"] || "",
    terminal: f["TERMINAL"] || "",
    codigoInfracao: (f["CODIGO"] || "").replace(/\D/g,""),
    descricaoCodigo: f["DESCRICAO"] || "",          // genérico (= antt_code_descriptions)
    descricaoInfracao: f["OBSERVACOES"] || "",      // específico (vai p/ o banco)
    matriculaAgente: f["MATRICULA AGENTE"] || "",   // do FISCAL, não do motorista
  };
}

// Lê um PDF (Buffer) e devolve os campos
export async function lerPDF(buffer, fallbackAuto){
  const data = await pdfParse(buffer);
  return extrairCamposPDF(data.text, fallbackAuto);
}

// ============================================================================
// Regras de negócio das Multas ANTT — derivam os campos que NÃO vêm no PDF.
// Ver docs/pdf-multa-mapeamento.md e docs/codigo-setor.md.
// ============================================================================
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const codigoSetor = require("./codigo-setor.json"); // { "111": "Manutenção", ... }

// 1) EMPRESA: normaliza string do PDF/SIFAMA → string do banco
const EMPRESA_MAP = {
  "EMPRESA AUTO VIACAO PROGRESSO LTDA": "AUTO VIACAO PROGRESSO LTDA",
  "AUTO VIACAO PROGRESSO LTDA": "AUTO VIACAO PROGRESSO LTDA",
  "AUTO VIACAO CRUZEIRO LIMITADA": "AUTO VIACAO CRUZEIRO LTDA",
  "AUTO VIACAO CRUZEIRO LTDA": "AUTO VIACAO CRUZEIRO LTDA",
};
export function normalizarEmpresa(nome){
  if(!nome) return "";
  const up = nome.trim().toUpperCase().replace(/\s+/g," ");
  return EMPRESA_MAP[up] || up;
}

// 2) SETOR: VLOOKUP código → setor (planilha _CONFIG). Banco usa MAIÚSCULAS.
function chaveCodigo(codigo){ return String(codigo).replace(/\.0+$/,"").trim(); }
export function setorDoCodigo(codigo){
  if(codigo == null || codigo === "") return "";
  const s = codigoSetor[chaveCodigo(codigo)];
  return s ? s.toUpperCase() : ""; // vazio se código novo não mapeado → sinalizar
}
export function codigoConhecido(codigo){ return !!codigoSetor[chaveCodigo(codigo)]; }

// 3) VALOR: lookup em antt_code_descriptions (passado como mapa {codigo: {descricao, valor}})
export function valorDoCodigo(codigo, tabelaCodigos){
  const row = tabelaCodigos && tabelaCodigos[String(codigo).trim()];
  return row ? Number(row.valor) : null;
}

// 4) PREFIXO + PLACA: o prefixo do banco vem da Base Veículos via PLACA (não do PDF).
//    veiculosPorPlaca = mapa { placa: {prefixo, empresa, ...} }
export function resolverVeiculo(placaPDF, veiculosPorPlaca){
  const placa = (placaPDF||"").trim().toUpperCase();
  const v = placa && veiculosPorPlaca ? veiculosPorPlaca[placa] : null;
  return {
    placaVeiculo: placa && placa !== "NÃO INFORMADO" ? placa : "",
    prefixoVeiculo: v ? String(v.prefixo) : "",   // vazio se placa não achada
    veiculoEncontrado: !!v,
  };
}

// 5) MATRÍCULA: cruza NOME do condutor com Base Motoristas. Sem match → vazio + flag.
//    motoristasPorNome = mapa { nomeNormalizado: [{matricula, nome, filial}] }
// normaliza: maiúsculas, sem acento, remove sufixos variáveis (JR/FILHO/NETO/SOBRINHO),
// remove conectores (DE/DA/DO/DOS/DAS/E) p/ comparar por conjunto de tokens "fortes".
const SUFIXOS = new Set(["JR","JUNIOR","FILHO","FO","NETO","NETTO","SOBRINHO","SEGUNDO","II","III"]);
const CONECTORES = new Set(["DE","DA","DO","DOS","DAS","E"]);
function normNome(n){
  return (n||"").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g,"")
    .replace(/[^A-Z ]/g," ").replace(/\s+/g," ").trim();
}
// tokens "fortes" (sem conectores nem sufixos), como Set
function tokensFortes(nomeNorm){
  return new Set(nomeNorm.split(" ").filter(t => t && !CONECTORES.has(t) && !SUFIXOS.has(t)));
}
function subsetDe(a, b){ for(const t of a){ if(!b.has(t)) return false; } return true; }

export function resolverMatricula(nomeCondutor, motoristasPorNome, indexFortes){
  const alvoNorm = normNome(nomeCondutor);
  if(!alvoNorm || !motoristasPorNome) return { matriculaMotorista:"", motoristaStatus:"sem_nome" };

  // 1) match exato pelo nome normalizado
  const exatos = motoristasPorNome[alvoNorm];
  if(exatos && exatos.length === 1) return { matriculaMotorista: String(exatos[0].matricula), motoristaStatus:"ok" };
  if(exatos && exatos.length > 1)  return { matriculaMotorista:"", motoristaStatus:"homonimo", candidatos: exatos.map(x=>x.matricula) };

  // 2) match por conjunto de tokens fortes (tolera NETTO, JR, acento, conectores)
  if(indexFortes){
    const alvoT = tokensFortes(alvoNorm);
    const cands = [];
    for(const item of indexFortes){
      // match se um conjunto contém o outro (nome do PDF ⊇ banco, ou banco ⊇ PDF)
      if(alvoT.size && item.tokens.size && (subsetDe(item.tokens, alvoT) || subsetDe(alvoT, item.tokens))){
        cands.push(item);
      }
    }
    const uniqMat = [...new Set(cands.map(c=>String(c.matricula)))];
    if(uniqMat.length === 1) return { matriculaMotorista: uniqMat[0], motoristaStatus:"ok_fuzzy" };
    if(uniqMat.length > 1)   return { matriculaMotorista:"", motoristaStatus:"homonimo", candidatos: uniqMat };
  }
  return { matriculaMotorista:"", motoristaStatus:"nao_encontrado", nomePDF: nomeCondutor };
}

// constrói o índice de tokens fortes a partir da lista de motoristas
export function indexarMotoristas(motoristas){
  return motoristas.map(m => ({ matricula: m.matricula, nome: m.nome, tokens: tokensFortes(normNome(m.nome)) }));
}
export { normNome, tokensFortes };

// terminal no banco = NOME DO MUNICÍPIO (cidade pura). Usa campo 17 (município);
// fallback: tira o prefixo "TERMINAL DE/DO/DA " do campo 18 (sem cortar nomes compostos).
export function terminalCidade(camposPDF){
  const mun = (camposPDF.municipioInfracao || "").trim();
  if(mun) return mun;
  const t = (camposPDF.terminal || "").trim();
  return t.replace(/^TERMINAL\s+(DE|DO|DA|DOS|DAS)\s+/i, "").trim();
}

// ---- Monta o registro final p/ multas_antt a partir do PDF + tabelas auxiliares ----
// camposPDF = saída de pdf.lerPDF(); aux = { tabelaCodigos, veiculosPorPlaca, motoristasPorNome }
export function montarMultaCompleta(camposPDF, aux){
  const codigo = camposPDF.codigoInfracao;
  const empresa = normalizarEmpresa(camposPDF.nomeInfrator);
  const veic = resolverVeiculo(camposPDF.placaVeiculo, aux.veiculosPorPlaca);
  const mot = resolverMatricula(camposPDF.nomeCondutor, aux.motoristasPorNome, aux.indexFortes);
  const valor = valorDoCodigo(codigo, aux.tabelaCodigos);
  const setor = setorDoCodigo(codigo);

  const avisos = [];
  if(!setor) avisos.push(`codigo ${codigo} sem setor mapeado`);
  if(valor == null) avisos.push(`codigo ${codigo} sem valor em antt_code_descriptions`);
  if(!veic.veiculoEncontrado) avisos.push(`placa ${camposPDF.placaVeiculo} não achada em veiculos`);
  if(mot.motoristaStatus !== "ok" && mot.motoristaStatus !== "ok_fuzzy") avisos.push(`motorista ${mot.motoristaStatus}: ${camposPDF.nomeCondutor}`);

  return {
    registro: {
      autoInfracao: camposPDF.autoInfracao,
      empresa,
      dataHora: camposPDF.dataHora,
      setor,
      terminal: terminalCidade(camposPDF),     // MUNICÍPIO da infração (cidade pura), não "TERMINAL DE X"
      codigoInfracao: codigo,
      descricaoInfracao: camposPDF.descricaoInfracao,  // campo 25 (específico do fiscal)
      matriculaMotorista: mot.matriculaMotorista,
      placaVeiculo: veic.placaVeiculo,
      prefixoVeiculo: veic.prefixoVeiculo,
      valor,
      status: "Concluído",                     // Fase 2 (PDF processado)
    },
    avisos,
    motoristaStatus: mot.motoristaStatus,
  };
}

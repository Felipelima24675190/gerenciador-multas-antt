// Teste do Agente B (extração de PDF + regras de negócio) com os PDFs de amostra.
// Uso: a partir de app/  ->  node test/agenteB.test.mjs
// Requer tabelas auxiliares em ../_dev/aux_tables.json (gerar com .run_sql.mjs e a query de aux).
import { lerPDF } from "../src/lib/pdf.mjs";
import { montarMultaCompleta, normNome } from "../src/rules/multas.mjs";
import { lerResultadoSQL } from "../src/lib/dbresult.mjs";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const AUX = "../_dev/aux_tables.json";
if(!existsSync(AUX)){
  console.log("Faltam tabelas auxiliares. Gere com:");
  console.log("  (na raiz) escreva em .query.sql a query de aux (codigos/veiculos/motoristas) e rode:");
  console.log("  node .run_sql.mjs .query.sql _dev/aux_tables.json");
  process.exit(0);
}
const data = lerResultadoSQL(AUX)[0].result;
const tabelaCodigos = data.codigos;
const veiculosPorPlaca = {}; for(const v of data.veiculos){ if(v.placa) veiculosPorPlaca[String(v.placa).toUpperCase().trim()]=v; }
const motoristasPorNome = {}; for(const m of data.motoristas){ (motoristasPorNome[normNome(m.nome)] ||= []).push(m); }
const aux = { tabelaCodigos, veiculosPorPlaca, motoristasPorNome };

const dir = "../amostras_multas";
const files = readdirSync(dir).filter(f=>f.endsWith(".pdf"));
let setor=0,valor=0,prefixo=0,matricula=0; const status={};
for(const fn of files){
  const campos = await lerPDF(readFileSync(dir+"/"+fn), fn.replace(/\.pdf$/i,""));
  const { registro, motoristaStatus } = montarMultaCompleta(campos, aux);
  if(registro.setor) setor++; if(registro.valor!=null) valor++;
  if(registro.prefixoVeiculo) prefixo++; if(registro.matriculaMotorista) matricula++;
  status[motoristaStatus]=(status[motoristaStatus]||0)+1;
}
const n=files.length;
console.log(`Agente B em ${n} PDFs: setor ${setor}/${n}, valor ${valor}/${n}, prefixo ${prefixo}/${n}, matricula ${matricula}/${n}`);
console.log("status motorista:", JSON.stringify(status));
const ok = setor===n && valor===n && prefixo===n;
console.log(ok ? "OK ✅" : "ATENÇÃO: revisar campos faltantes");

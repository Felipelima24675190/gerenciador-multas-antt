// Testa o gerador de e-mail de pedido com os autos NOVOS reais do SIFAMA.
// A partir de app/:  node test/emailPedido.test.mjs
import { readFileSync } from "node:fs";
import { bootstrap, coletarAutos, normalizarLinha, SIFAMA_DEFAULT } from "../src/lib/sifama.mjs";
import { montarEmailsPedido } from "../src/lib/emailPedido.mjs";

// autos do banco (extraídos do dump do .run_sql, se existir) — senão considera todos "novos"
function autosBanco(){
  try{
    const raw = readFileSync("../_dev/autos_banco.json","utf8");
    return new Set(raw.match(/PASLD\d{10,}/g)||[]);
  }catch(e){ return new Set(); }
}

function dentroPeriodo(br, ini, fim){
  const m=String(br).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if(!m) return false;
  const d=new Date(Date.UTC(+m[3],+m[2]-1,+m[1])); return d>=ini && d<=fim;
}

const hoje=new Date();
const fim=new Date(Date.UTC(hoje.getUTCFullYear(),hoje.getUTCMonth(),hoje.getUTCDate()));
const ini=new Date(Date.UTC(hoje.getUTCFullYear(),hoje.getUTCMonth()-1,1));

const banco=autosBanco();
const ctx=await bootstrap();
let novos=[];
for(const emp of SIFAMA_DEFAULT.empresas){
  const r=await coletarAutos(ctx, emp.sifama);
  for(const row of r.autos){
    const n=normalizarLinha(row, emp.banco);
    if(!banco.has(n.autoInfracao) && dentroPeriodo(n.dataInfracao, ini, fim)) novos.push(n);
  }
}
console.log("autos novos no período:", novos.length, "(banco conhecia", banco.size, "autos)\n");

const emails = montarEmailsPedido(novos);
console.log("e-mails gerados:", emails.length, "\n"+"=".repeat(70));
for(const e of emails){
  console.log("\nPARA:", e.para.map(p=>p.nome).join(", "));
  console.log("CC  :", e.copia.map(p=>p.nome).join(", "));
  console.log("ASSUNTO:", e.assunto);
  console.log("("+e.qtdAutos+" autos | empresa "+e.empresaCurta+")");
  console.log("-".repeat(70));
  console.log(e.corpo);
  console.log("=".repeat(70));
}

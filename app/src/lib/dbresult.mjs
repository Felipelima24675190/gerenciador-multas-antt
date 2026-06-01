// Helper: extrai o payload JSON do resultado do .run_sql.mjs (que vem embrulhado
// num wrapper {"result":"...<untrusted-data>...[{...}]...</untrusted-data>..."}).
import { readFileSync } from "node:fs";

export function lerResultadoSQL(path){
  const raw = readFileSync(path, "utf8");
  let text = raw;
  try { const o = JSON.parse(raw); if(o && typeof o.result === "string") text = o.result; } catch(e){}
  // acha o início do array JSON do resultado
  const i = text.indexOf('[{"result"');
  if(i < 0){
    // fallback: primeiro '[' depois de <untrusted-data>
    const j = text.indexOf("<untrusted-data");
    const k = text.indexOf("[", j>=0?j:0);
    if(k<0) throw new Error("payload JSON não encontrado");
    return JSON.parse(recortarBalanceado(text, k));
  }
  return JSON.parse(recortarBalanceado(text, i));
}

// recorta de start até o fechamento balanceado do colchete/chave inicial
function recortarBalanceado(s, start){
  let depth=0, inStr=false, esc=false;
  for(let p=start; p<s.length; p++){
    const c=s[p];
    if(inStr){ if(esc) esc=false; else if(c==="\\") esc=true; else if(c==='"') inStr=false; continue; }
    if(c==='"'){ inStr=true; continue; }
    if(c==="["||c==="{") depth++;
    else if(c==="]"||c==="}"){ depth--; if(depth===0) return s.slice(start, p+1); }
  }
  throw new Error("não fechou o JSON");
}

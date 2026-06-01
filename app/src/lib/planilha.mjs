// ============================================================================
// Lê a planilha Google (aba MULTAS ANTT) como CSV PÚBLICO — sem credencial Google.
// Usado no diff do Agente A: não pedir autos que já estão na planilha (2ª fonte).
// A planilha precisa estar com link de leitura público/qualquer-um-com-link.
// ============================================================================

const SHEET_ID = "1wMh9YtTU2GtkKkPYrfBFZa5iuGeHluRkWEuMFM6w08s";
const ABA = "MULTAS ANTT";

function csvUrl(sheetId, aba){
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(aba)}`;
}

// parser CSV simples (campos entre aspas, vírgulas, aspas escapadas "")
function parseCSV(txt){
  const linhas = [];
  let campo = "", linha = [], emAspas = false;
  for(let i=0;i<txt.length;i++){
    const c = txt[i];
    if(emAspas){
      if(c === '"'){ if(txt[i+1] === '"'){ campo += '"'; i++; } else emAspas = false; }
      else campo += c;
    } else {
      if(c === '"') emAspas = true;
      else if(c === ","){ linha.push(campo); campo = ""; }
      else if(c === "\n"){ linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
      else if(c === "\r"){ /* ignora */ }
      else campo += c;
    }
  }
  if(campo.length || linha.length){ linha.push(campo); linhas.push(linha); }
  return linhas;
}

// Retorna um Set com todos os "Nº DO AUTO DE INFRAÇÃO" (PASLD...) da planilha.
export async function autosNaPlanilha({ sheetId = SHEET_ID, aba = ABA, timeoutMs = 60000 } = {}){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeoutMs);
  try{
    const res = await fetch(csvUrl(sheetId, aba), { signal: ctrl.signal });
    if(!res.ok) throw new Error("CSV planilha HTTP " + res.status);
    const txt = await res.text();
    const rows = parseCSV(txt);
    if(!rows.length) return new Set();
    // acha a coluna do nº do auto pelo cabeçalho
    const hdr = rows[0].map(h => (h||"").toUpperCase());
    let col = hdr.findIndex(h => h.includes("AUTO DE INFRA"));
    if(col < 0) col = hdr.findIndex(h => h.includes("AUTO"));
    const set = new Set();
    for(let i=1;i<rows.length;i++){
      const v = (rows[i][col] || "").trim();
      if(/^PASLD\d+/i.test(v)) set.add(v);
    }
    return set;
  } finally { clearTimeout(t); }
}

// ============================================================================
// Módulo SIFAMA — coleta autos de infração de passageiros do BI público da ANTT
// (Power BI publish-to-web). Funciona 100% via HTTPS, sem navegador, sem login.
// Descoberto e validado em 2026-05-31. Ver docs/sifama-api.md.
// ============================================================================

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Config padrão (pode mudar se a ANTT republicar o relatório → re-descobrir via bootstrap()).
export const SIFAMA_DEFAULT = {
  viewUrl: "https://app.powerbi.com/view?r=eyJrIjoiNDk2NTI3MTEtMjJkOC00MTg0LWIzYjctMDI2ZGEzOTZkYWIyIiwidCI6Ijg3YmJlOWRlLWE4OTItNGNkZS1hNDY2LTg4Zjk4MmZiYzQ5MCJ9",
  resourceKey: "49652711-22d8-4184-b3b7-026da396dab2",
  apiBase: "https://wabi-brazil-south-d-primary-api.analysis.windows.net",
  // empresas exatas no SIFAMA -> nome no banco
  empresas: [
    { sifama: "EMPRESA AUTO VIACAO PROGRESSO LTDA", banco: "AUTO VIACAO PROGRESSO LTDA" },
    { sifama: "AUTO VIACAO CRUZEIRO LIMITADA",      banco: "AUTO VIACAO CRUZEIRO LTDA" },
  ],
};

// ---- Bootstrap: descobre IDs reais (dbName/modelId/report/section) dinamicamente ----
export async function bootstrap(cfg = SIFAMA_DEFAULT){
  const url = `${cfg.apiBase}/public/reports/${cfg.resourceKey}/modelsAndExploration?preferReadOnlySession=true`;
  const res = await fetch(url, { headers: {
    "User-Agent": UA, "X-PowerBI-ResourceKey": cfg.resourceKey, "Accept": "application/json, text/plain, */*"
  }});
  if(!res.ok) throw new Error("bootstrap falhou: HTTP " + res.status);
  const j = await res.json();
  const model = j.models[0];
  const expl = j.exploration;
  const reportObjId = expl.report.objectId;
  const passSec = expl.sections.find(s => /passageir/i.test(s.displayName || s.name || ""));
  // acha o visual tableEx da RELAÇÃO DOS AUTOS e extrai o prototypeQuery
  let proto = null;
  for(const vc of passSec.visualContainers){
    let c; try{ c = JSON.parse(vc.config); }catch(e){ continue; }
    const sv = c.singleVisual || {};
    const blob = JSON.stringify(c);
    if(sv.visualType === "tableEx" && blob.includes("Nome Autuado") && blob.includes("Número Auto de Infra")){
      proto = sv.prototypeQuery || c.prototypeQuery; break;
    }
  }
  if(!proto) throw new Error("prototypeQuery da tabela de autos não encontrado");
  return {
    apiBase: cfg.apiBase,
    resourceKey: cfg.resourceKey,
    modelId: model.id,
    dbName: model.dbName,                 // = DatasetId
    reportObjId,
    sectionId: passSec.objectId,
    proto,
    autuadoAlias: (proto.From.find(f=>/Autuado/i.test(f.Entity))||{Name:"d2"}).Name,
  };
}

// ---- Monta o body do querydata (filtro por empresa exata + paginação) ----
function buildBody(ctx, empresaSifama, restartTokens){
  const q = JSON.parse(JSON.stringify(ctx.proto));
  q.Where = [{
    Condition: { In: {
      Expressions: [{ Column: { Expression:{SourceRef:{Source:ctx.autuadoAlias}}, Property:"Nome Autuado" } }],
      Values: [[ { Literal: { Value: "'" + empresaSifama.replace(/'/g,"''") + "'" } } ]]
    }}
  }];
  const primary = { Window: { Count: 500 } };
  if(restartTokens) primary.Window.RestartTokens = restartTokens;
  return {
    version: "1.0.0",
    queries: [{
      Query: { Commands: [{ SemanticQueryDataShapeCommand: {
        Query: q,
        Binding: { Primary: { Groupings: [{ Projections: [0,1,2,3,4,5,6,7] }] },
                   DataReduction: { DataVolume: 3, Primary: primary }, Version: 1 },
        ExecutionMetricsKind: 1
      }}]},
      QueryId: "",
      ApplicationContext: { DatasetId: ctx.dbName, Sources: [{ ReportId: ctx.reportObjId, VisualId: ctx.sectionId + "_x" }] }
    }],
    cancelQueries: [], modelId: ctx.modelId
  };
}

async function postQuery(ctx, empresaSifama, restartTokens){
  const res = await fetch(`${ctx.apiBase}/public/reports/querydata?synchronous=true`, {
    method:"POST",
    headers:{ "User-Agent":UA, "X-PowerBI-ResourceKey":ctx.resourceKey,
      "Content-Type":"application/json;charset=UTF-8", "Accept":"application/json, text/plain, */*",
      "Origin":"https://app.powerbi.com", "Referer":"https://app.powerbi.com/" },
    body: JSON.stringify(buildBody(ctx, empresaSifama, restartTokens))
  });
  if(!res.ok){ throw new Error("querydata HTTP " + res.status + ": " + (await res.text()).slice(0,200)); }
  return res.json();
}

// ---- Parser DSR (Power BI Data Shape Result) → array de objetos ----
function parseDSR(j){
  const data = j.results[0].result.data;
  const cols = data.descriptor.Select.map(s => s.Name.split(".").pop()); // só o nome da coluna
  const ds = data.dsr.DS[0];
  const dicts = ds.ValueDicts || {};
  const dm = ds.PH[0].DM0 || [];
  // o 1º item traz S (schema das colunas) com DN (nome do dict) por coluna
  let colDict = new Array(cols.length).fill(null);
  if(dm[0] && dm[0].S){ dm[0].S.forEach((s, i) => { colDict[i] = s.DN || null; }); }

  const out = [];
  let prev = [];
  for(const item of dm){
    const C = item.C || [];
    const R = item.R || 0;       // bit i => repetir valor anterior
    const Onull = item["Ø"] || 0; // bit i => null
    const vals = [];
    let ci = 0;
    for(let col=0; col<cols.length; col++){
      let v;
      if(Onull & (1<<col)) v = null;
      else if(R & (1<<col)) v = prev[col];
      else v = C[ci++];
      vals.push(v);
    }
    prev = vals;
    // resolve dicionários (valor numérico = índice no dict da coluna)
    const obj = {};
    for(let col=0; col<cols.length; col++){
      let v = vals[col];
      const dn = colDict[col];
      if(dn && typeof v === "number" && dicts[dn]) v = dicts[dn][v];
      obj[cols[col]] = v;
    }
    out.push(obj);
  }
  // RestartTokens p/ próxima página (se houver)
  const rt = ds.RT || null;
  return { rows: out, restartTokens: rt, hasMore: !!rt };
}

// ---- Coleta TODOS os autos de uma empresa (com paginação) ----
export async function coletarAutos(ctx, empresaSifama, { maxPaginas = 50 } = {}){
  let restart = null, todas = [], paginas = 0, seen = new Set();
  do {
    const j = await postQuery(ctx, empresaSifama, restart);
    const { rows, restartTokens } = parseDSR(j);
    // dedup por número do auto (a paginação pode repetir a linha de fronteira)
    let novos = 0;
    for(const r of rows){
      const auto = r["Número Auto de Infração"];
      if(auto && !seen.has(auto)){ seen.add(auto); todas.push(r); novos++; }
    }
    paginas++;
    if(!restartTokens || novos === 0) break;
    restart = restartTokens;
  } while(paginas < maxPaginas);
  return { empresa: empresaSifama, total: todas.length, paginas, autos: todas };
}

// ---- Normaliza uma linha do SIFAMA p/ o formato do nosso domínio ----
export function normalizarLinha(r, empresaBanco){
  // Data Infração: epoch ms (número) OU ISO sem timezone (string "YYYY-MM-DDT...").
  // Hora Infração: ISO 1899 sem timezone "1899-12-30THH:MM:SS".
  // ⚠️ Datas ISO sem 'Z' são interpretadas como hora LOCAL pelo JS → para horas/datas
  // assim, extrair direto do texto (sem conversão de fuso). Para epoch, usar UTC.
  function dataBR(v){
    if(v == null) return "";
    if(typeof v === "number"){
      const d = new Date(v);
      if(isNaN(d)) return String(v);
      return `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}/${d.getUTCFullYear()}`;
    }
    // string ISO: pega a parte da data direto do texto
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m) return `${m[3]}/${m[2]}/${m[1]}`;
    return String(v);
  }
  function horaBR(v){
    if(v == null) return "";
    // string ISO 1899: extrai HH:MM direto do texto (sem fuso)
    const m = String(v).match(/T(\d{2}):(\d{2})/);
    if(m) return `${m[1]}:${m[2]}`;
    if(typeof v === "number"){
      const d = new Date(v);
      if(!isNaN(d)) return `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`;
    }
    return String(v);
  }
  return {
    autoInfracao: r["Número Auto de Infração"],
    empresa: empresaBanco,
    dataInfracao: dataBR(r["Data Infração"]),
    horaInfracao: horaBR(r["Hora Infração"]),
    ufInfracao: r["UF Infração"],
    municipioInfracao: r["Município Infração"],
    placaVeiculo: r["Placa"],
    codigoInfracao: r["Código Tipo Infração"] != null ? String(r["Código Tipo Infração"]) : "",
  };
}

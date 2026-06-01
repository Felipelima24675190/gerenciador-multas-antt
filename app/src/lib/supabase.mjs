// ============================================================================
// Módulo Supabase — escrita/leitura em multas_antt via PostgREST (REST API).
// Usa service_role (ignora RLS). HTTPS puro → roda na nuvem. NUNCA versionar a key.
// Schema multas_antt (2026-05-31): id(text, NOT NULL, SEM default → gerar UUID),
//   autoInfracao, dataHora, empresa, setor, terminal, codigoInfracao,
//   descricaoInfracao, matriculaMotorista?, placaVeiculo?, prefixoVeiculo?,
//   valor(real, default 0), status(default 'Aguardando'). SEM primary key/unique.
// ============================================================================
import { randomUUID } from "node:crypto";

export function makeClient({ url, serviceKey }){
  if(!url || !serviceKey) throw new Error("supabase: url e serviceKey obrigatórios");
  const base = url.replace(/\/$/,"") + "/rest/v1";
  const H = {
    "apikey": serviceKey,
    "Authorization": "Bearer " + serviceKey,
    "Content-Type": "application/json",
  };

  async function req(path, opts={}){
    const res = await fetch(base + path, { ...opts, headers: { ...H, ...(opts.headers||{}) } });
    const txt = await res.text();
    if(!res.ok) throw new Error(`Supabase ${opts.method||"GET"} ${path} → ${res.status}: ${txt.slice(0,300)}`);
    return txt ? JSON.parse(txt) : null;
  }

  return {
    // helpers genéricos
    async _insert(tabela, rows){
      return req(`/${tabela}`, { method:"POST", headers:{ "Prefer":"return=minimal" }, body: JSON.stringify(rows) });
    },
    async _patch(tabela, filtro, patch){
      return req(`/${tabela}?${filtro}`, { method:"PATCH", headers:{ "Prefer":"return=minimal" }, body: JSON.stringify(patch) });
    },

    // lê todos os autoInfracao já no banco (p/ o diff). Pagina de 1000 em 1000.
    async autosExistentes(){
      const set = new Set();
      let from = 0;
      for(;;){
        const rows = await req(`/multas_antt?select=autoInfracao`, {
          headers: { "Range-Unit":"items", "Range": `${from}-${from+999}` }
        });
        rows.forEach(r => r.autoInfracao && set.add(r.autoInfracao));
        if(rows.length < 1000) break;
        from += 1000;
      }
      return set;
    },

    // existe um auto? (consulta pontual)
    async existeAuto(autoInfracao){
      const rows = await req(`/multas_antt?autoInfracao=eq.${encodeURIComponent(autoInfracao)}&select=id,status&limit=1`);
      return rows[0] || null;
    },

    // Fase 1: cria multas novas como 'Aguardando'. registros = [{autoInfracao, empresa, dataHora?, codigoInfracao?, placaVeiculo?}]
    // Só insere os que ainda não existem (idempotente). Retorna {inseridos, pulados}.
    async inserirAguardando(registros){
      const existentes = await this.autosExistentes();
      const novos = registros.filter(r => r.autoInfracao && !existentes.has(r.autoInfracao));
      if(!novos.length) return { inseridos: 0, pulados: registros.length };
      const payload = novos.map(r => ({
        id: randomUUID(),
        autoInfracao: r.autoInfracao,
        empresa: r.empresa || "",
        dataHora: r.dataHora || "",
        setor: r.setor || "",
        terminal: r.terminal || "",
        codigoInfracao: r.codigoInfracao || "",
        descricaoInfracao: r.descricaoInfracao || "",
        matriculaMotorista: r.matriculaMotorista ?? null,
        placaVeiculo: r.placaVeiculo ?? null,
        prefixoVeiculo: r.prefixoVeiculo ?? null,
        valor: (r.valor != null ? r.valor : 0),
        status: r.status || "Aguardando",
      }));
      // insere em lotes de 500
      let inseridos = 0;
      for(let i=0; i<payload.length; i+=500){
        const lote = payload.slice(i, i+500);
        await req(`/multas_antt`, { method:"POST", headers:{ "Prefer":"return=minimal" }, body: JSON.stringify(lote) });
        inseridos += lote.length;
      }
      return { inseridos, pulados: registros.length - novos.length };
    },

    // Fase 2: completa uma multa (por autoInfracao) com os dados do PDF + regras, status 'Concluído'.
    async completarMulta(autoInfracao, dados){
      const patch = { ...dados };
      delete patch.id; delete patch.autoInfracao; // não mexer na chave lógica
      const r = await req(`/multas_antt?autoInfracao=eq.${encodeURIComponent(autoInfracao)}`, {
        method:"PATCH", headers:{ "Prefer":"return=representation" }, body: JSON.stringify(patch)
      });
      return r; // array de linhas atualizadas
    },

    // lê uma tabela inteira (paginado) com select de colunas
    async lerTabela(tabela, select){
      const linhas = [];
      let from = 0;
      for(;;){
        const rows = await req(`/${tabela}?select=${encodeURIComponent(select)}`, {
          headers: { "Range-Unit":"items", "Range": `${from}-${from+999}` }
        });
        linhas.push(...rows);
        if(rows.length < 1000) break;
        from += 1000;
      }
      return linhas;
    },

    // tabelas auxiliares p/ as regras (códigos→valor, veículos por placa, motoristas por nome)
    // normNome e indexarMotoristas vêm de rules/multas.mjs (passados pelo chamador).
    async tabelasAuxiliares(normNome, indexarMotoristas){
      const [codigos, veiculos, motoristas] = await Promise.all([
        this.lerTabela("antt_code_descriptions", "codigo,descricao,valor"),
        this.lerTabela("veiculos", "placa,prefixo,empresa"),
        this.lerTabela("motoristas", "matricula,nome,filial"),
      ]);
      const tabelaCodigos = {};
      for(const c of codigos) tabelaCodigos[String(c.codigo).trim()] = { descricao: c.descricao, valor: c.valor };
      const veiculosPorPlaca = {};
      for(const v of veiculos){ if(v.placa) veiculosPorPlaca[String(v.placa).toUpperCase().trim()] = v; }
      const motoristasPorNome = {};
      for(const m of motoristas){ const k = normNome(m.nome); (motoristasPorNome[k] ||= []).push(m); }
      const indexFortes = indexarMotoristas ? indexarMotoristas(motoristas) : null;
      return { tabelaCodigos, veiculosPorPlaca, motoristasPorNome, indexFortes };
    },

    // util de teste: conta linhas
    async contar(){
      const res = await fetch(base + `/multas_antt?select=id`, { headers: { ...H, "Range-Unit":"items", "Range":"0-0", "Prefer":"count=exact" } });
      const cr = res.headers.get("content-range") || "";
      return cr.split("/")[1] || "?";
    },
  };
}

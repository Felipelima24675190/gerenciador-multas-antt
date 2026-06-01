// ============================================================================
// Manutenção do banco (operações pontuais autorizadas pelo usuário via chat).
// Update/insert OK. ⛔ NUNCA DELETE permanente — usar soft-delete (status).
// ============================================================================
import { makeClient } from "./supabase.mjs";

// Atualiza o status de uma LISTA de autos (em lotes, via PATCH com filtro in.()).
// db: cliente supabase; autos: string[]; novoStatus: string. Retorna nº atualizado.
export async function atualizarStatusEmLote(db, autos, novoStatus, { lote = 100 } = {}){
  let total = 0;
  for(let i=0; i<autos.length; i+=lote){
    const chunk = autos.slice(i, i+lote);
    // PostgREST: ?autoInfracao=in.("a","b",...)  — valores entre aspas duplas, vírgula-separados
    const inList = chunk.map(a => `"${String(a).replace(/"/g,'')}"`).join(",");
    await db._patch("multas_antt", `autoInfracao=in.(${encodeURIComponent(inList)})`, { status: novoStatus });
    total += chunk.length;
  }
  return total;
}

// Soft-delete: marca autos como inválidos (em vez de apagar). Reversível.
export async function invalidar(db, autos, motivo = "Inválido"){
  return atualizarStatusEmLote(db, autos, motivo);
}

// Atualiza status por ID (UUID único) — preciso quando há duplicatas do mesmo auto.
export async function marcarPorId(db, ids, novoStatus, { lote = 100 } = {}){
  let total = 0;
  for(let i=0;i<ids.length;i+=lote){
    const chunk = ids.slice(i,i+lote);
    const inList = chunk.map(x=>`"${String(x)}"`).join(",");
    await db._patch("multas_antt", `id=in.(${encodeURIComponent(inList)})`, { status: novoStatus });
    total += chunk.length;
  }
  return total;
}

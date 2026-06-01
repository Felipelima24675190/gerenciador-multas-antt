// ============================================================================
// Sincroniza a base de MOTORISTAS: planilha Google (fonte mais recente) → banco.
// Banco tabela `motoristas` (matricula, nome, filial, area, status).
// status do banco = coluna OBSERVAÇÃO da planilha (decisão do usuário 2026-06-01).
// Insere novos + atualiza alterados, por MATRÍCULA (chave lógica).
// ============================================================================

// motoristasPlanilha: [{matricula,nome,filial,area,status}]
// db: cliente supabase (makeClient)
export async function planejarSync(motoristasPlanilha, db){
  const atuais = await db.lerTabela("motoristas", "matricula,nome,filial,area,status");
  const porMat = new Map(atuais.map(m => [String(m.matricula).trim(), m]));

  const inserir = [], atualizar = [], iguais = [];
  for(const p of motoristasPlanilha){
    const mat = String(p.matricula).trim();
    const atual = porMat.get(mat);
    if(!atual){ inserir.push(p); continue; }
    // compara campos
    const dif = ["nome","filial","area","status"].filter(k => (atual[k]||"") !== (p[k]||""));
    if(dif.length) atualizar.push({ matricula: mat, de: atual, para: p, campos: dif });
    else iguais.push(mat);
  }
  // motoristas no banco que NÃO estão na planilha (não mexer, só reportar)
  const matPlan = new Set(motoristasPlanilha.map(p=>String(p.matricula).trim()));
  const soNoBanco = atuais.filter(m => !matPlan.has(String(m.matricula).trim())).map(m=>m.matricula);

  return { inserir, atualizar, iguais: iguais.length, soNoBanco, totalPlanilha: motoristasPlanilha.length, totalBanco: atuais.length };
}

export async function aplicarSync(plano, db){
  let inseridos = 0, atualizados = 0;
  // inserir novos (lotes de 500)
  for(let i=0;i<plano.inserir.length;i+=500){
    const lote = plano.inserir.slice(i,i+500).map(p=>({
      matricula:String(p.matricula).trim(), nome:p.nome||"", filial:p.filial||"", area:p.area||"", status:p.status||"",
    }));
    if(lote.length){ await db._insert("motoristas", lote); inseridos += lote.length; }
  }
  // atualizar alterados (PATCH por matricula)
  for(const u of plano.atualizar){
    const patch = { nome:u.para.nome||"", filial:u.para.filial||"", area:u.para.area||"", status:u.para.status||"" };
    await db._patch("motoristas", `matricula=eq.${encodeURIComponent(u.matricula)}`, patch);
    atualizados++;
  }
  return { inseridos, atualizados };
}

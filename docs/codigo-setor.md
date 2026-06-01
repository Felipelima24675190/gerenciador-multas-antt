# Lógica do SETOR (mapeada da planilha do usuário) — 2026-05-31

Fonte: Google Sheets "PLANILHAS OPERAÇÃO" (id `1wMh9YtTU2GtkKkPYrfBFZa5iuGeHluRkWEuMFM6w08s`), aba **MULTAS ANTT**, coluna **P "SETOR RESPONSÁVEL"**.

## Fórmula real (replicar no app)
```
=IFERROR(IF(M2="","", VLOOKUP(M2, '_CONFIG'!$A$2:$B$50, 2, FALSE)), "")
```
Tradução: **setor = lookup(codigoInfracao) na tabela `_CONFIG` (coluna A=CODIGO → coluna B=SETOR)**. Se código vazio ou não encontrado → setor vazio.

Ou seja: o setor depende SÓ do `codigoInfracao`. No app, virar um dicionário código→setor (abaixo) OU idealmente uma coluna em `antt_code_descriptions`.

⚠️ Capitalização: a planilha usa "Manutenção/Comercial/Operação/RH/Atraso" (Title Case). O banco `multas_antt.setor` hoje usa MAIÚSCULAS ("MANUTENÇÃO", "ATRASO"...). → ao gravar, **usar o padrão do banco (MAIÚSCULAS)** para manter consistência. Confirmar se quer manter assim.

## Tabela código → setor (46 códigos, aba _CONFIG A2:B47). Fonte de verdade.
(salvo também em `docs/codigo-setor.json`)

| Código | Setor || Código | Setor || Código | Setor |
|---|---|---|---|---|---|---|---|
|101|Comercial||201|Comercial||306|Comercial|
|102|Comercial||202|**Atraso**||308|Operação|
|105|Comercial||203|Comercial||311|Comercial|
|106|Comercial||204|Comercial||312|Comercial|
|108|Comercial||205|Manutenção||313|Comercial|
|109|Comercial||206|Operação||317|Comercial|
|110|Comercial||209|Operação||318|Manutenção|
|111|Manutenção||210|Comercial||319|Operação|
|112|RH||211|Comercial||401|Comercial|
|116|Operação||212|Comercial||402|Operação|
|117|Comercial||213|Operação||406|Operação|
| | ||217|Manutenção||410|Operação|
| | ||218|Comercial||413|Operação|
| | ||233|Manutenção||414|Operação|
| | ||301|Comercial||415|Comercial|
| | ||302|Comercial||418|Comercial|
| | ||303|Operação||  |  |
| | ||304|Comercial||  |  |
| | ||305|Comercial||  |  |

Distribuição: Comercial 27, Operação 12, Manutenção 5, RH 1, Atraso 1.

## Bônus achado na _CONFIG
A aba `_CONFIG` tem mais colunas: **A=CODIGO, B=SETOR, D=COD4, E=JUSTIFICATIVA** (texto explicando o que é cada código, ex.: 102 "Condutor não utilizou o cinto..."). COD4 parece um código alternativo (ex.: 101→5002, 102→5185). Pode ser útil depois; não usado no fluxo atual.

## Decisão p/ o app
1. Extrair `codigoInfracao` do PDF (campo 23).
2. setor = lookup neste mapa (MAIÚSCULAS no banco).
3. Se código novo não estiver no mapa → setor vazio + avisar (manter mapa sincronizado com _CONFIG, que tem só 46 códigos hoje — podem surgir novos).

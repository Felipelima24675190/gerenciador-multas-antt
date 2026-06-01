# Contrato da API SIFAMA (Power BI público) — ✅✅ RESOLVIDO E VALIDADO (2026-05-31)

> STATUS: **FUNCIONA de ponta a ponta via HTTPS puro (sem navegador, sem login).** Implementado em `app/src/lib/sifama.mjs` e testado: HTTP 200, 5193 autos coletados (4650 Progresso + 543 Cruzeiro), diff vs banco OK (37 novos em maio/2026). Resolvido FORA do navegador (sem o guard de cookie do Claude-in-Chrome), provando a tese.

## A receita que funciona (2 passos)
**Passo 1 — Bootstrap (descobre IDs reais, sem chute):**
`GET {apiBase}/public/reports/{resourceKey}/modelsAndExploration?preferReadOnlySession=true`
header `X-PowerBI-ResourceKey: {resourceKey}`. Retorna 900KB JSON com:
- `models[0].id` = **modelId** (hoje 439287 — ⚠️ o 1067913 que capturei antes no browser estava ERRADO/desatualizado; SEMPRE pegar do bootstrap)
- `models[0].dbName` = **DatasetId** (hoje `ef42fea5-eaf8-4c88-a0fa-e694170e9caf`)
- `exploration.report.objectId` = ReportId (hoje `ad8953e7-...`)
- `exploration.sections[].objectId` — seção "Passageiros" (hoje `4d6e93d9-...`)
- dentro da seção Passageiros, o visual `tableEx` com "Nome Autuado"+"Número Auto de Infra" traz o **`prototypeQuery`** (o molde exato do querydata).

**Passo 2 — querydata:**
`POST {apiBase}/public/reports/querydata?synchronous=true`
headers: `X-PowerBI-ResourceKey`, `Content-Type: application/json;charset=UTF-8`, `Origin/Referer: https://app.powerbi.com`. SEM cookie/login.
body: usa o `prototypeQuery` do bootstrap (NÃO inventar) + `Where` + `Binding.DataReduction.Primary.Window.Count=500` + `ApplicationContext{DatasetId: dbName, Sources:[{ReportId: reportObjId, VisualId: sectionId+"_x"}]}` + `modelId`.

apiBase real: `https://wabi-brazil-south-d-primary-api.analysis.windows.net` (achei via clusterUri no HTML da view: `wabi-brazil-south-d-primary-redirect...`).

## Modelo de dados REAL (não é tabela única!)
Esquema estrela: Fato `Fato FIS Fiscalização` + dims `Dim FIS Infração`, `Dim COR Autuado`, `Dim FIS Veículo`, `Dim FIS Tipo Infração`. 8 colunas: Data Infração, Hora Infração, UF Infração(dim), Município Infração(dim), Nome Autuado(dim), Placa(dim), Número Auto de Infração(dim), Código Tipo Infração(dim).

## Filtro por empresa (CONFIRMADO)
`Where` com `In` na coluna `Nome Autuado` (igualdade exata; Contains pega empresas demais tipo "VIACAO PROGRESSO E TURISMO"). Strings exatas: `EMPRESA AUTO VIACAO PROGRESSO LTDA`, `AUTO VIACAO CRUZEIRO LIMITADA`. Literal entre aspas simples DENTRO da string.

## Resposta = DSR (parser implementado em sifama.mjs)
- `results[0].result.data.dsr.DS[0]`: `PH[0].DM0` = linhas; `ValueDicts` (D0..D4) = dicionários; `RT` = RestartToken (paginação); `descriptor.Select` = ordem/nome das colunas.
- 1ª linha traz `S` (schema) com `DN` = qual dict cada coluna usa.
- Cada linha: `C`=valores presentes, `R`=bitmask repete-anterior (bit i, LSB=col0), `Ø`=bitmask null. Valor numérico em coluna com DN = índice no ValueDict.
- **Datas/horas**: Data vem epoch-ms (número, meia-noite UTC) OU ISO sem tz; Hora vem ISO 1899 SEM timezone → extrair HH:MM direto do TEXTO (senão JS aplica fuso -03:12 de 1899 e erra). 
- Paginação: enviar `Window.RestartTokens = DS.RT` na próxima chamada até não vir novo.

## Observações
- 1 linha lixo na origem: auto `PASLD00062042025` com data `13/08/1925` (erro da ANTT/linha especial). Irrelevante (robô filtra por data recente).
- GUIDs/modelId podem mudar em republicação → por isso o app SEMPRE faz bootstrap, nunca hardcoda.

## Diagnóstico do 401 (hipótese forte)
A página envia o POST com header só `X-PowerBI-ResourceKey` = o `k` da URL, e funciona. Replay idêntico (mesmo body, mesmo header) de DENTRO da página → 401. Padrão conhecido do Power BI "publish to web": o `k` da URL serve para o **bootstrap** (GET de config/exploração do relatório), e esse bootstrap devolve o contexto/ável que habilita o `querydata`. Ou seja, o app precisa primeiro fazer a sequência de bootstrap (GET dos metadados do relatório com o `k`) e só então o querydata é aceito (cookie de sessão / token derivado). **Resolver isso é tarefa de desenvolvimento do app**, com um HTTP client de verdade (seguir o mesmo handshake que o powerbi-client faz). Não dá pra concluir só inspecionando no browser sem capturar a cadeia inteira de bootstrap.

## Schema REAL da tabela (confirmado ao vivo)
A query natural da tabela "RELAÇÃO DOS AUTOS DE INFRAÇÃO" seleciona **8 colunas**:
`Data Infração`, `Hora Infração`, `UF Infração`, `Município Infração`, `Nome Autuado`, `Placa`, `Número Auto de Infração`, **`Código Tipo Infração`**.
(A última é a fonte do `codigoInfracao` do banco — bônus que não aparecia na 1ª inspeção.)

## Confirmado vs aberto
- ✅ É Power BI público (sem login). Host: `wabi-brazil-south-d-primary-api.analysis.windows.net`. Entity DAX: `AUTOS DE INFRACAO PASSAGEIROS`. 8 colunas acima. Filtro por empresa na UI = busca textual em "Nome Autuado".
- ❓ Sequência de bootstrap que habilita o querydata (causa do 401) — resolver no dev do app.
- ❓ Sintaxe exata do `Where` por data — capturar aplicando o filtro de data na UI, OU paginar tudo e diffar vs banco.

## Nota histórica (resolvido)
O 401 que eu via NO BROWSER não era falta de cookie — era eu usando body reconstruído errado + modelId desatualizado. FORA do browser, com o prototypeQuery real do bootstrap + modelId/dbName/reportObjId corretos, dá **200 sem cookie nenhum**. Confirmou a tese: o que travava era o guard do Claude-in-Chrome (bloqueia cookie/querystring), não o Power BI. Lição: reverse-engineering de API faz-se com http client real, não pelo browser-tool.


Fonte: BI do SIFAMA (ANTT), relatório Power BI público (SEM login).
URL pública: https://app.powerbi.com/view?r=eyJrIjoiNDk2NTI3MTEtMjJkOC00MTg0LWIzYjctMDI2ZGEzOTZkYWIyIiwidCI6Ijg3YmJlOWRlLWE4OTItNGNkZS1hNDY2LTg4Zjk4MmZiYzQ5MCJ9

## Endpoint
```
POST https://wabi-brazil-south-d-primary-api.analysis.windows.net/public/reports/querydata?synchronous=true
```
Headers obrigatórios:
- `X-PowerBI-ResourceKey: 49652711-22d8-4184-b3b7-026da396dab2`  (autentica sozinho; SEM cookie/login)
- `Content-Type: application/json;charset=UTF-8`

`modelId`: 1067913 (parte do body; veio do bootstrap — reconfirmar se mudar).

## Body (SemanticQueryDataShapeCommand) — SEM filtro (aba Registros, Empresa=Todos)
- Entity (tabela DAX): `AUTOS DE INFRACAO PASSAGEIROS`, alias `a`.
- Select (7 colunas): `Data Infração`, `Hora Infração`, `UF Infração`, `Município Infração`, `Nome Autuado`, `Placa`, `Número Auto de Infração`.
- OrderBy: `Data Infração` ASC (Direction 1).
- DataReduction: Window Count = 500 (máx 500 linhas/resposta → paginar com RestartTokens p/ mais).

Body cru capturado salvo em `docs/sifama-querydata-body.json`.

## O que falta confirmar
- Sintaxe EXATA do `Where` para filtrar por EMPRESA e por intervalo de DATA (capturar uma query filtrada ou validar por tentativa).
- String exata da empresa na coluna `Nome Autuado` (validar: deve ser "AUTO VIACAO PROGRESSO LTDA" e "AUTO VIACAO CRUZEIRO LTDA", iguais ao banco).
- Formato do range de data no Where (provável `Between`/comparações em `Data Infração`).

## Parsing da resposta
Formato Power BI DSR (Data Shape Result): `results[0].result.data.dsr.DS[0].PH[0].DM0` = linhas; valores usam dicionários (`ValueDicts`) + arrays `C`/`R` (repeat bitmask). Precisa de um parser DSR (escrever no app).

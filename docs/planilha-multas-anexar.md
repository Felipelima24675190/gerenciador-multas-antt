# Gravar multa na PLANILHA (aba MULTAS ANTT) — Fase 2 do pipeline

Destino DUPLO da multa concluída: **Supabase `multas_antt`** + **planilha "PLANILHAS OPERAÇÃO" aba "MULTAS ANTT"**.
Sheets id: `1wMh9YtTU2GtkKkPYrfBFZa5iuGeHluRkWEuMFM6w08s`.

## Regra de ouro
Anexar a multa nova **na primeira linha vazia abaixo da última** (hoje última = linha **3039**, ou seja escrever na 3040+). **NÃO** sobrescrever a coluna **P (SETOR RESPONSÁVEL)** que é FÓRMULA — ao inserir nova linha, **copiar a fórmula de P para a nova linha** (ajustando o número da linha) em vez de escrever texto. Todas as outras colunas (A–O, Q, R) são DADOS.

## Colunas da aba MULTAS ANTT (A..R) e origem dos dados
| Col | Header | Tipo | Origem para a nova linha |
|---|---|---|---|
| A | PLACA | dado | PDF campo 8 (ou veiculos via lookup) |
| B | ORDEM | dado | = ? número interno (parece = prefixo do veículo na base; ex L2 ORDEM 6147). CONFIRMAR o que é "ORDEM". |
| C | PREFIXO | dado | ⚠️ valores estranhos (L2=20003561, L3039=3030) — NÃO é o prefixo curto do banco. CONFIRMAR o que vai aqui. |
| D | EMPRESA | dado | "AUTO VIACAO PROGRESSO LTDA" (normalizado) |
| E | LINHA | dado | origem→destino do PDF (campos 3-6), ex "MACEIÓ(AL) - RECIFE(PE)". CONFIRMAR formato. |
| F | MOTORISTA | dado | PDF campo 12 (nome) |
| G | MATRÍCULA DO MOTORISTA | dado | lookup motoristas por nome |
| H | DATA | dado (date) | PDF campo 14 |
| I | MÊS | dado | nome do mês da data (ex "Maio") |
| J | ANO | dado | ano da data |
| K | LOCAL | dado | PDF campo 17 (município) ou 18 (terminal)? L2="MACEIO". CONFIRMAR (parece município/cidade) |
| L | HORA | dado | PDF campo 15 |
| M | CÓDIGO INFRAÇÃO | dado | PDF campo 23 |
| N | DESCRIÇÃO DO FISCAL | dado | PDF campo 25 (observações específicas) ✔ confirma mapeamento |
| O | Nº DO AUTO DE INFRAÇÃO | dado | nome do arquivo / AUTO Nº |
| P | SETOR RESPONSÁVEL | **FÓRMULA** | COPIAR fórmula (VLOOKUP código→_CONFIG). NÃO escrever valor. |
| Q | DATA DE RECEBIMENTO | dado | data em que o PDF foi recebido/processado |
| R | SITUAÇÃO | dado | provavelmente o status; L2/L3039 vazios. CONFIRMAR o que vai em SITUAÇÃO |

## Fatos
- Última multa na planilha: linha 3039 (auto PASLD00025792026, 20/05/2026). Banco tem 3038 linhas. → planilha e banco ~sincronizados (planilha = fonte que populou o Supabase, provavelmente).
- Só P é fórmula. _CONFIG A2:B50 dá o setor.
- DATA é datetime; HORA às vezes datetime.time, às vezes texto "10:14" (inconsistência histórica).

## ✅ Colunas DECIFRADAS (cruzando auto PASLD00008222026: planilha linha 2890 × banco × veiculos, 2026-06-01)
- **B "ORDEM" = o PREFIXO REAL do veículo** (6314) → é ISSO que vai p/ `multas_antt.prefixoVeiculo`. (placa SJT4H87 → veiculos.prefixo 6314 ✓). 
- **C "PREFIXO" (planilha)** = outro número (3030) que **NÃO** vai p/ o banco. Provável código de linha/itinerário interno. IGNORAR p/ o banco.
- **A "PLACA"** = placa (SJT4H87). No banco `placaVeiculo` fica VAZIO historicamente (só prefixo). Confirmado: banco tem placaVeiculo="".
- **E "LINHA"** = itinerário origem-destino ("RECIFE X SAO LUIS"). NÃO existe coluna equivalente em multas_antt. É info só da planilha.
- **K "LOCAL"** = município ("RECIFE"). No banco, `terminal` guarda esse valor ("RECIFE") — NÃO o "TERMINAL DE RECIFE" do PDF! ⚠️ Ver descoberta abaixo.
- **R "SITUAÇÃO"** = vazio nesses exemplos (None). Provável campo livre (defesa/pago/etc.) — não crítico.
- DATA/HORA na planilha = datetime/time separados; banco junta "DD/MM/YYYY HH:MM".

## ⚠️ DESCOBERTAS que corrigem o mapeamento PDF→banco (2026-06-01)
1. **terminal**: o BANCO guarda o MUNICÍPIO ("RECIFE"), não o "TERMINAL DE RECIFE" do PDF. Ou seja, o campo 17 (município) do PDF, não o 18 (terminal). REVISAR pdf→regra (hoje uso campo 18). Confirmar com usuário: terminal do banco = município?
2. **prefixoVeiculo** vem da placa→veiculos (6314) ✓ como já implementado. A "ORDEM" da planilha = esse mesmo 6314.
3. As multas de FEV/2026 da Fernanda JÁ estão completas no banco (todos os campos), só com status "Aguardando" em vez de "Concluído" → o passo que falhou no fluxo manual foi só atualizar o status.

## Como escrever (dev)
Sheets API (append) preservando fórmulas: ler última linha, escrever A..O + Q + R por valor, e P por fórmula. Conector Drive atual NÃO tem update de células (só create/read). → no app, usar Google Sheets API com credenciais de serviço, OU manter a planilha como espelho secundário e priorizar o Supabase. CONFIRMAR com usuário a prioridade (banco é a fonte do app; planilha é histórico do usuário).

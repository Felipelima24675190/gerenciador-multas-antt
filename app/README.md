# App — Gerenciador Operacional (automações Auto Viação Progresso)

App standalone (Node.js, ESM) para rodar na nuvem (SquareCloud) e atualizar o Supabase
do app https://gerenciador-operacional.vercel.app/ automaticamente, todo dia.

## Status (2026-06-01)
Primeira automação: **Multas ANTT** — TODAS as integrações prontas e testadas com dados reais.

### ✅ Pronto e testado
- `src/lib/sifama.mjs` — coleta autos do SIFAMA (Power BI público). bootstrap dinâmico + querydata paginado + parser DSR. (5193 autos coletados nos testes)
- `src/lib/supabase.mjs` — escrita/leitura via PostgREST (service_role). inserirAguardando (idempotente), completarMulta, tabelasAuxiliares, lerTabela, _insert/_patch.
- `src/lib/pdf.mjs` — extrai campos do auto. Parser por TEXTO do rótulo (robusto à variação de numeração). 21/21 PDFs.
- `src/rules/multas.mjs` — regras: empresa, setor (codigo→setor), valor, prefixo (placa→veículos), matrícula (nome→motoristas, com fuzzy/tokens), terminal (município). + codigo-setor.json.
- `src/lib/email.mjs` — SkyMail IMAP: listarRespostasFernanda, baixarAnexo, arquivarEstratificacoes (copia p/ FERNANDA ANTT), criarRascunho. ⛔ NUNCA envia.
- `src/lib/emailPedido.mjs` — monta o e-mail de pedido (Fase 1) no formato do usuário, destinatários reais.
- `src/lib/sync_motoristas.mjs` — sincroniza base motoristas (planilha→banco).
- `src/agents/agenteA.mjs` — SIFAMA→diff→grava 'Aguardando'→cria rascunho do pedido.
- `src/agents/agenteB.mjs` — arquiva e-mails Fernanda + lê PDFs→regras→completa 'Concluído'.
- `src/config.mjs` — credenciais via env (prod) ou arquivos locais (dev).

### 🚧 Falta
- Espelho na planilha Google Sheets (aba MULTAS ANTT) via service account — anexar linha sem quebrar fórmula do SETOR.
- Assinatura (card LUIS LIMA) no rascunho do e-mail.
- Agendador diário + deploy SquareCloud.

## Como rodar (dev, na raiz do projeto)
- Agentes dry-run: `node _dev/test_agentes_dryrun.mjs`
- Conexão IMAP: `node _dev/test_imap_connect.mjs`
- Supabase leitura: `node _dev/test_supabase_read.mjs`

## Credenciais (NUNCA versionar — já no .gitignore)
- `.service_role.txt` — service_role do Supabase
- `.skymail.txt` — usuario=/senha= do SkyMail (IMAP imap.skymail.com.br:993)
- Em produção: usar variáveis de ambiente (SUPABASE_SERVICE_KEY, SKYMAIL_USER, SKYMAIL_PASS).

## Docs (../docs/)
sifama-api.md, pdf-multa-mapeamento.md, codigo-setor.md, planilha-multas-anexar.md.

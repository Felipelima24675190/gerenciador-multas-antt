# Gerenciador Operacional — Robô de Multas ANTT (Auto Viação Progresso)

Robô que **todo dia** atualiza o banco (Supabase) do app
[Gerenciador Operacional](https://gerenciador-operacional.vercel.app/) com as multas ANTT.
Roda de graça no **GitHub Actions** (sem servidor, sem custo).

## O que ele faz
**Agente A** — coleta no SIFAMA (BI público da ANTT) os autos de infração novos das
empresas, grava no banco como `Aguardando` e cria um **rascunho** de e-mail pedindo a
estratificação (você revisa e envia — o robô nunca envia sozinho).

**Agente B** — lê as respostas da advogada no e-mail (SkyMail/IMAP), baixa os PDFs,
extrai os dados, aplica as regras (setor, valor, prefixo, matrícula), completa a multa
no banco como `Concluído` e arquiva o PDF em subpastas `MULTAS ANTT/Ano/Mês/Setor`.

## Estrutura
```
app/src/main.mjs          → ponto de entrada (roda A e B)
app/src/agents/           → agenteA, agenteB
app/src/lib/              → sifama, supabase, email, pdf, arquivo_pdf_imap...
app/src/rules/            → regras de negócio (setor/valor/prefixo/matrícula)
.github/workflows/        → agendamento diário (GitHub Actions)
docs/                     → documentação técnica (API SIFAMA, mapeamentos)
```

## Como publicar (resumo)
1. Subir este repositório no GitHub (privado).
2. Em **Settings → Secrets and variables → Actions**, cadastrar os segredos:
   - `SUPABASE_URL` , `SUPABASE_SERVICE_KEY`
   - `SKYMAIL_USER` , `SKYMAIL_PASS`
   - `DESTINATARIOS_JSON` (JSON com remetenteFernanda/para/copia)
3. O workflow roda sozinho às 09:00 (BRT). Dá pra rodar manual em **Actions → Run workflow**.

## Configuração local (dev)
Arquivos na raiz (NÃO versionados — ver `.gitignore`):
`.service_role.txt`, `.skymail.txt` (usuario=/senha=), `.destinatarios.json`.

## Segurança
- Nenhum segredo ou dado pessoal (CPF, e-mails de terceiros, PDFs) vai para o Git.
- O robô só **lê** e cria **rascunhos** de e-mail — nunca envia automaticamente.

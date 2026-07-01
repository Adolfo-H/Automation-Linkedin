# LinkedIn Share Automation

Automação simples em Node.js para compartilhar uma publicação do LinkedIn por mensagem privada com uma lista de contatos.

---

## O que o projeto faz

O script acessa uma publicação do LinkedIn e compartilha o post com cada contato da lista. Ele personaliza a mensagem usando o primeiro nome do contato, tenta enviar duas vezes em caso de falha e registra os envios concluídos.

---

## Arquivos do projeto

- `linkedin-share-automation.js` – script principal
- `contatos.csv` – lista de contatos com coluna `nome`
- `mensagem.txt` – texto da mensagem enviada
- `.env` – credenciais do LinkedIn
- `session.json` – sessão salva do navegador
- `session-meta.json` – metadados da sessão
- `enviados.json` – registros de envios concluídos
- `log.txt` – histórico de execução
- `package.json` – dependências do projeto

---

## Pré-requisitos

- Node.js 18 ou superior
- Conta ativa no LinkedIn
- Contatos já conectados com você no LinkedIn para receber DM

---

## Instalação

Abra o terminal na pasta do projeto e rode:

```bash
npm install
npx playwright install chromium
```

---

## Configuração

### 1. Credenciais

Crie ou edite o arquivo `.env` com seu login do LinkedIn:

```
LINKEDIN_EMAIL=seu_email@exemplo.com
LINKEDIN_PASSWORD=sua_senha
```

### 2. Lista de contatos

O `contatos.csv` deve conter uma coluna `nome`:

```csv
nome
João Silva
Maria Oliveira
Carlos Souza
```

O script usa automaticamente o primeiro nome para personalizar a mensagem.

### 3. Mensagem

Edite o `mensagem.txt` com o texto que será enviado. Use `{{firstName}}` para inserir o primeiro nome do contato.

### 4. Publicação do LinkedIn

No início do `linkedin-share-automation.js`, atualize `CONFIG.postUrl` para a URL do post que você quer compartilhar.

---

## Uso

Execute o script:

```bash
node linkedin-share-automation.js
```

### Funcionamento

- Na primeira execução, o navegador abre e você precisa fazer login manualmente.
- Se o LinkedIn pedir verificação por código, complete no browser e pressione `ENTER` no terminal.
- Depois do login, o script salva a sessão em `session.json` e segue com os envios.
- Nas próximas execuções, ele tenta usar a sessão salva antes de fazer login novamente.

---

## Ajustes úteis

- Mude `batchSize` em `linkedin-share-automation.js` para alterar o número de contatos por lote.
- Se o script estiver usando a conta errada, delete `session.json` e `session-meta.json` antes de rodar de novo.

---

## Comportamento de segurança

O script inclui alguns controles para reduzir risco de bloqueio:

- intervalos aleatórios entre envios
- navegação pelo feed ou notificações a cada dois envios
- navegador visível (`headless: false`)
- duas tentativas por envio antes de pular o contato

Use com moderação e evite enviar muitas mensagens em sequência.

---

## Arquivos gerados

- `session.json` – guarda a sessão do navegador
- `session-meta.json` – registra a conta usada
- `enviados.json` – contatos já processados
- `log.txt` – log detalhado de execução

---

## Dependências

- `dotenv` – carrega variáveis do `.env`
- `csv-parser` – lê o arquivo `contatos.csv`
- `playwright` – controla o navegador Chrome

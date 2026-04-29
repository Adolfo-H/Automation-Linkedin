# 🤖 LinkedIn Share Automation
 
Automação de marketing B2B em Node.js com Playwright para compartilhar publicações do LinkedIn via mensagem privada (DM) para uma lista de contatos.
 
---
 
## 📋 Índice
 
- [O que faz](#-o-que-faz)
- [Estrutura do projeto](#-estrutura-do-projeto)
- [Pré-requisitos](#-pré-requisitos)
- [Instalação](#-instalação)
- [Configuração](#-configuração)
- [Como usar](#-como-usar)
- [Segurança anti-ban](#-segurança-anti-ban)
- [Arquivos gerados automaticamente](#-arquivos-gerados-automaticamente)
- [Solução de problemas](#-solução-de-problemas)
---
 
## ✅ O que faz
 
Para cada contato da sua lista CSV, o script:
 
1. Acessa a publicação configurada no LinkedIn
2. Clica em "Enviar" para abrir o modal de mensagens
3. Busca o contato pelo nome completo e valida antes de clicar
4. Digita a mensagem personalizada com o primeiro nome da pessoa
5. Envia e registra o sucesso em `enviados.json`
6. Aguarda um tempo aleatório antes do próximo envio
7. A cada 2 envios, simula navegação humana no feed ou notificações
Se um envio falhar, o script tenta **mais uma vez automaticamente** antes de pular para o próximo contato.
 
---
 
## 📁 Estrutura do projeto
 
```
📁 linkedin/
├── linkedin-share-automation.js  ← Script principal
├── contatos.csv                  ← Sua lista de leads
├── mensagem.txt                  ← Texto da mensagem (editável)
├── .env                          ← Credenciais (nunca sobe pro Git)
├── .gitignore                    ← Proteção dos arquivos sensíveis
├── package.json
├── package-lock.json
│
│   (gerados automaticamente na execução)
├── session.json                  ← Sessão do LinkedIn salva
├── enviados.json                 ← Registro de quem já recebeu
└── log.txt                       ← Log completo de execução
```
 
---
 
## 🔧 Pré-requisitos
 
- [Node.js](https://nodejs.org/) versão **18 ou superior**
- Conta no LinkedIn
- Conexão com os contatos da lista (LinkedIn exige conexão para enviar DM)
---
 
## 📦 Instalação
 
```bash
# 1. Clone ou baixe o projeto na sua máquina
 
# 2. Entre na pasta do projeto
cd linkedin
 
# 3. Instale as dependências
npm install
 
# 4. Instale os navegadores do Playwright
npx playwright install chromium
```
 
---
 
## ⚙️ Configuração
 
### 1. Credenciais (`.env`)
 
Crie um arquivo `.env` na raiz do projeto:
 
```
LINKEDIN_EMAIL=seu_email@exemplo.com
LINKEDIN_PASSWORD=sua_senha
```
 
> ⚠️ Nunca compartilhe este arquivo. Ele está protegido pelo `.gitignore`.
 
### 2. Lista de contatos (`contatos.csv`)
 
O arquivo deve ter um cabeçalho `nome` com um contato por linha:
 
```csv
nome
Natan Kainak
Samuel Malaquias Sadovnik
Maria Fernanda Silva
```
 
> O script usa o **primeiro nome** automaticamente para personalizar a mensagem.
 
### 3. Mensagem (`mensagem.txt`)
 
Edite o texto que será enviado para cada contato. Use `{{firstName}}` onde quiser que o primeiro nome apareça:
 
```
Olá, {{firstName}}, tudo tranquilo?
 
Passando para compartilhar uma publicação nova da nossa página ExportControl sobre um tema extremamente relevante para empresas que realizam vendas com fim específico de exportações.
 
Fico à disposição caso queira trocar alguma ideia sobre o assunto.
```
 
### 4. URL da publicação (`linkedin-share-automation.js`)
 
No início do script, atualize a URL do post que deseja divulgar:
 
```javascript
const CONFIG = {
  postUrl: 'https://www.linkedin.com/posts/SEU-POST-AQUI',
  ...
};
```
 
---
 
## ▶️ Como usar
 
```bash
node linkedin-share-automation.js
```
 
**Na primeira execução:**
- Um navegador abrirá na tela de login do LinkedIn
- Faça o login **manualmente**
- Aguarde carregar o feed
- O script salva a sessão automaticamente e começa os envios
**Nas execuções seguintes:**
- O script entra direto, sem precisar logar novamente
- Contatos que já receberam mensagem são pulados automaticamente
---
 
## 🛡️ Segurança anti-ban
 
O script foi construído para minimizar o risco de bloqueio da conta:
 
| Recurso | Descrição |
|---|---|
| **Delays aleatórios** | Espera entre 60 e 150 segundos entre cada envio |
| **Simulação humana** | A cada 2 envios, navega pelo feed ou notificações |
| **Digitação cadenciada** | Digita a mensagem letra por letra com delay de 60ms |
| **Seletores com validação** | Verifica o nome antes de clicar no contato |
| **Headless: false** | Navegador visível, comportamento menos suspeito |
| **Retry automático** | 2 tentativas por contato antes de desistir |
 
> ⚠️ Mesmo com todas as proteções, use com moderação. Recomenda-se no máximo **20 a 30 envios por dia**.
 
---
 
## 📄 Arquivos gerados automaticamente
 
| Arquivo | Função |
|---|---|
| `session.json` | Cookies de sessão do LinkedIn. Delete para forçar novo login. |
| `enviados.json` | Lista de quem já recebeu mensagem. Impede reenvios em caso de reinício. |
| `log.txt` | Registro completo com data e hora de cada ação e erro. |
 
---
 
## 🔍 Solução de problemas
 
**O script não encontra o botão "Enviar" da publicação**
- Verifique se a URL do post em `CONFIG.postUrl` está correta e acessível
- O post pode ter sido removido ou a URL mudou
**O contato não é encontrado na busca**
- Verifique se o nome no CSV está exatamente igual ao do LinkedIn
- Confirme que vocês são conexões (o LinkedIn bloqueia DMs para não-conexões)
**Erro de sessão / redirecionado para o login**
- Delete o arquivo `session.json` e execute novamente para fazer um novo login
**A mensagem aparece vazia ao enviar**
- Verifique se o arquivo `mensagem.txt` existe e tem conteúdo
- Confirme que o marcador está escrito exatamente como `{{firstName}}`
**Variáveis de ambiente não carregadas**
- Confirme que o arquivo se chama exatamente `.env` (não `.evn` ou `env.txt`)
- Verifique se o `require('dotenv').config()` está na primeira linha do script
---
 
## 📌 Dependências
 
| Pacote | Versão | Função |
|---|---|---|
| `playwright` | ^1.59.1 | Controle do navegador |
| `csv-parser` | ^3.2.0 | Leitura do CSV de contatos |
| `dotenv` | latest | Leitura do arquivo `.env` |
 
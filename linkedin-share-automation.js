require('dotenv').config(); // ← ESSENCIAL para ler o .env
const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-parser');

const template = fs.readFileSync('mensagem.txt', 'utf-8');
const SESSION_FILE = 'session.json';
const SENT_FILE = 'enviados.json';

const CONFIG = {
  postUrl: 'https://www.linkedin.com/posts/export-control_comercioexterior-exportaaexaeto-fiscal-activity-7454976608831979520-PZ22',
  csvFile: 'contatos.csv',
  minDelay: 60000,
  maxDelay: 150000,
  linkedinEmail: process.env.LINKEDIN_EMAIL,
  linkedinPassword: process.env.LINKEDIN_PASSWORD
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = () => Math.floor(Math.random() * (CONFIG.maxDelay - CONFIG.minDelay + 1)) + CONFIG.minDelay;

// ✅ Log em arquivo
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync('log.txt', line + '\n');
}

// ✅ Carrega lista de enviados
const sent = fs.existsSync(SENT_FILE) ? JSON.parse(fs.readFileSync(SENT_FILE)) : [];

async function loadContacts() {
  return new Promise((resolve, reject) => {
    const contacts = [];
    if (!fs.existsSync(CONFIG.csvFile)) return reject(new Error('Arquivo CSV não encontrado!'));
    fs.createReadStream(CONFIG.csvFile)
      .pipe(csv())
      .on('data', row => {
        if (row.nome) {
          const fullName = row.nome.trim();
          const firstName = fullName.split(' ')[0];
          contacts.push({ fullName, firstName });
        }
      })
      .on('end', () => resolve(contacts))
      .on('error', reject);
  });
}

async function randomActivity(page) {
  const actions = ['feed', 'notifications'];
  const action = actions[Math.floor(Math.random() * actions.length)];
  log(`--- Disfarçando: Indo para ${action} ---`);
  if (action === 'feed') {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
    await page.mouse.wheel(0, 400);
  } else {
    await page.goto('https://www.linkedin.com/notifications/', { waitUntil: 'domcontentloaded' });
  }
  await sleep(4000);
}

async function sendToContact(page, contact) {
  try {
    log(`\nProcessando: ${contact.fullName}`);

    await page.goto(CONFIG.postUrl, { waitUntil: 'domcontentloaded' });
    await sleep(5000);

    const sendButton = page.locator('button[aria-label*="Enviar"], button[aria-label*="Send"]').first();
    await sendButton.waitFor({ state: 'visible', timeout: 15000 });
    await sendButton.click();

    const searchInput = page.locator('input[placeholder*="Pesquisar"], input[placeholder*="Search"]');
    await searchInput.waitFor({ state: 'visible' });
    await searchInput.fill(contact.fullName);
    await sleep(3000);

    // ✅ CORRIGIDO: só o loop com validação, sem o firstResult.click() duplicado
    const results = await page.locator('[role="option"]').all();
    let clicked = false;
    for (const result of results) {
      const text = await result.textContent();
      if (text.includes(contact.fullName)) {
        await result.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      log(`✗ Contato "${contact.fullName}" não encontrado nos resultados.`);
      return false;
    }
    log('Contato selecionado...');

    await sleep(6000);

    const messageBox = page.locator([
      '.artdeco-rich-editable-content[role="textbox"]',
      '.msg-form__contenteditable[contenteditable="true"]',
      'div[aria-label="Escreva uma mensagem..."]',
      'div[aria-label="Write a message..."]'
    ].join(', ')).filter({ visible: true }).first();

    await messageBox.waitFor({ state: 'visible', timeout: 15000 });
    await messageBox.click();
    await sleep(1000);

    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await sleep(1000);

    const personalMessage = template.replace('{{firstName}}', contact.firstName);
    await page.keyboard.type(personalMessage, { delay: 60 });
    log('Mensagem escrita. Aguardando...');
    await sleep(5000);

    const finalSendBtn = page.locator('button.artdeco-button--primary').filter({ hasText: /Enviar|Send/, visible: true }).last();

    if (await finalSendBtn.isEnabled()) {
      await finalSendBtn.click();
      log(`✓ SUCESSO: Enviado para ${contact.fullName}`);
      await sleep(3000);
      return true;
    } else {
      log('✗ Botão de enviar está desativado.');
      return false;
    }
  } catch (error) {
    log(`✗ ERRO com ${contact.fullName}: ${error.message}`);
    await page.keyboard.press('Escape');
    await sleep(1000);
    await page.keyboard.press('Escape');
    return false;
  }
}

// ✅ Retry no lugar certo
async function sendWithRetry(page, contact, maxTries = 2) {
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const result = await sendToContact(page, contact);
    if (result) return true;
    if (attempt < maxTries) {
      log(`Tentativa ${attempt} falhou. Re-tentando em 15s...`);
      await sleep(15000);
    }
  }
  return false;
}

// BLOCO DE EXECUÇÃO
(async () => {
  log('Iniciando automação...');
  const contacts = await loadContacts();

  // EXECUTAR EM PRODUÇÃO  
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });
  // CASO QUEIRA FAZER TESTES VENDO RODANDO, USAR BLOCO ABAIXO
  // const browser = await chromium.launch({
  //headless: false,
  //args: [
  //  '--disable-background-timer-throttling',
  //  '--disable-backgrounding-occluded-windows',
  //  '--disable-renderer-backgrounding'
  //]
  //}); 
  let context;

  if (fs.existsSync(SESSION_FILE)) {
    log('Sessão encontrada. Entrando direto...');
    context = await browser.newContext({ storageState: SESSION_FILE });
  } else {
    log('Sem sessão. Fazendo login automático...');
    context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
    await sleep(2000);

    // Preenche email
    await page.locator('#username').fill(CONFIG.linkedinEmail);
    await sleep(1000);

    // Preenche senha
    await page.locator('#password').fill(CONFIG.linkedinPassword);
    await sleep(1000);

    // Clica em entrar
    await page.locator('button[type="submit"]').click();
    log('Credenciais enviadas. Aguardando feed...');

    // Aguarda carregar o feed (até 60 segundos)
    await page.waitForURL('**/feed/**', { timeout: 60000 });

    await context.storageState({ path: SESSION_FILE });
    log('Sessão salva! Não precisará logar novamente.');
  }

  const page = await context.newPage();

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    // ✅ Pula quem já recebeu
    if (sent.includes(contact.fullName)) {
      log(`⏭ Pulando ${contact.fullName} (já enviado)`);
      continue;
    }

    // ✅ Usa retry
    const success = await sendWithRetry(page, contact);

    // ✅ Registra sucesso
    if (success) {
      sent.push(contact.fullName);
      fs.writeFileSync(SENT_FILE, JSON.stringify(sent, null, 2));
    }

    if (i < contacts.length - 1) {
      if (i % 2 === 0) await randomActivity(page);
      const delay = randomDelay();
      log(`Pausa de segurança: ${Math.round(delay / 1000)} segundos...`);
      await sleep(delay);
    }
  }

  log('Processo finalizado!');
  await browser.close();
})();
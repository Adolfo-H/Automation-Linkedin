require('dotenv').config();
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
const normalizeText = (text = '') =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  if (!fs.existsSync('log.txt')) fs.writeFileSync('log.txt', '');
  fs.appendFileSync('log.txt', line + '\n');
}

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

async function openShareDialog(page) {
  const dmShareSelectors = [
    'a[aria-label="Enviar"]',
    'a[aria-label="Send"]',
    'a[aria-label*="Enviar"]',
    'a[aria-label*="Send"]',
    'button[aria-label*="Enviar em mensagem"]',
    'button[aria-label*="Send in a private message"]',
    'button[aria-label*="Compartilhar em mensagem"]',
    'button[aria-label*="Share in a message"]',
    'button[aria-label*="Enviar por mensagem"]',
    'button[aria-label*="Send privately"]',
    'button[aria-label*="Enviar como mensagem"]'
  ];

  for (const selector of dmShareSelectors) {
    const button = page.locator(selector).first();
    if (await button.count() && await button.isVisible()) {
      log(`Abrindo envio por DM com seletor: ${selector}`);
      await button.click();
      return;
    }
  }

  throw new Error('Nao foi possivel localizar o botao de enviar a publicacao por DM.');
}

async function selectContactFromSharePanel(sharePanel, contact) {
  const normalizedFullName = normalizeText(contact.fullName);

  const textMatch = sharePanel.getByText(contact.fullName, { exact: false }).first();
  if (await textMatch.count() && await textMatch.isVisible()) {
    const row = textMatch.locator('xpath=ancestor::*[.//input[@type="checkbox"]][1]').first();
    if (await row.count()) {
      await row.scrollIntoViewIfNeeded();
      await row.click({ force: true });
      return true;
    }
    await textMatch.scrollIntoViewIfNeeded();
    await textMatch.click({ force: true });
    return true;
  }

  const candidates = await sharePanel.locator('label, li, button, div, span, a').all();
  for (const candidate of candidates) {
    const text = await candidate.textContent();
    if (!text) continue;
    if (normalizeText(text).includes(normalizedFullName)) {
      const row = candidate.locator('xpath=ancestor::*[.//input[@type="checkbox"]][1]').first();
      if (await row.count()) {
        await row.scrollIntoViewIfNeeded();
        await row.click({ force: true });
        return true;
      }
      await candidate.scrollIntoViewIfNeeded();
      await candidate.click({ force: true });
      return true;
    }
  }

  return false;
}

async function findMessageBox(context) {
  const selectors = [
    'div[aria-label="Adicionar uma mensagem..."]',
    'div[aria-label="Add a message..."]',
    'div[aria-label="Escreva uma mensagem"]',
    'div[aria-label="Escreva uma mensagem..."]',
    'div[aria-label="Write a message..."]',
    'textarea[placeholder*="Escrever mensagem"]',
    'textarea[placeholder*="Write a message"]',
    '[placeholder*="Escrever mensagem"]',
    '[placeholder*="Write a message"]',
    '.artdeco-rich-editable-content[role="textbox"]',
    '.msg-form__contenteditable[contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    '[contenteditable="true"]',
    'textarea'
  ];

  for (const selector of selectors) {
    const locator = context.locator(selector).filter({ visible: true }).first();
    if (await locator.count() && await locator.isVisible()) {
      const placeholder = (await locator.getAttribute('placeholder')) || '';
      if (normalizeText(placeholder).includes('pesquisar') || normalizeText(placeholder).includes('search')) {
        continue;
      }
      return locator;
    }
  }

  const textbox = context.locator('[role="textbox"]:not(input)').filter({ visible: true }).last();
  if (await textbox.count() && await textbox.isVisible()) {
    return textbox;
  }

  return null;
}

async function sendToContact(page, contact) {
  try {
    log(`\nProcessando: ${contact.fullName}`);

    await page.goto(CONFIG.postUrl, { waitUntil: 'domcontentloaded' });
    await sleep(5000);

    await openShareDialog(page);
    await sleep(3000);

    const sharePanel = page.locator('[data-testid="lazy-column"], .artdeco-modal, .send-privately-flyout').first();
    await sharePanel.waitFor({ state: 'visible', timeout: 15000 });

    const searchInput = sharePanel.locator('input[placeholder*="Pesquisar"], input[placeholder*="Search"], input[type="text"]').first();
    await searchInput.waitFor({ state: 'visible', timeout: 15000 });
    await searchInput.fill(contact.fullName);
    await sleep(3000);

    const clicked = await selectContactFromSharePanel(sharePanel, contact);
    if (!clicked) {
      log(`✗ Contato "${contact.fullName}" não encontrado nos resultados.`);
      return false;
    }
    log('Contato selecionado...');

    await sleep(6000);

    let messageBox = await findMessageBox(sharePanel);
    if (!messageBox) {
      log('Caixa não encontrada no painel, buscando na página inteira...');
      messageBox = await findMessageBox(page);
    }
    if (!messageBox) {
      throw new Error('Nao foi possivel localizar a caixa de mensagem apos selecionar o contato.');
    }

    await messageBox.click();
    await sleep(1000);

    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await sleep(1000);

    const personalMessage = template.replace('{{firstName}}', contact.firstName);
    await page.keyboard.type(personalMessage, { delay: 60 });
    log('Mensagem escrita. Aguardando...');
    await sleep(5000);
   
    // ✅ MELHORIA: Seletores de botão de envio mais robustos
    const sendButtonSelectors = [
      'button.artdeco-button--primary:has-text("Enviar")',
      'button.artdeco-button--primary:has-text("Send")',
      'button:has-text("Enviar")',
      'button:has-text("Send")',
      '.share-box-footer__main-actions button',
      '.artdeco-modal__footer button.artdeco-button--primary',
      'button[aria-label*="Enviar"]',
      'button[aria-label*="Send"]'
    ];

    let finalSendBtn = null;
    for (const selector of sendButtonSelectors) {
      const btn = page.locator(selector).filter({ visible: true }).last();
      if (await btn.count() > 0) {
        finalSendBtn = btn;
        break;
      }
    }

    if (finalSendBtn && await finalSendBtn.isVisible({ timeout: 10000 })) {
      await finalSendBtn.click();
      log(`✓ SUCESSO: Enviado para ${contact.fullName}`);
      await sleep(3000);
      return true;
    } else {
      log('✗ Botão de enviar não encontrado ou não visível.');
      // Tenta um último recurso: Enter se a caixa de mensagem ainda tiver foco
      log('Tentando enviar com a tecla Enter...');
      await page.keyboard.press('Control+Enter');
      await sleep(3000);
      return true; // Assume sucesso ou verifica se o modal fechou
    }
  } catch (error) {
    log(`✗ ERRO com ${contact.fullName}: ${error.message}`);
    await page.keyboard.press('Escape');
    await sleep(1000);
    await page.keyboard.press('Escape');
    return false;
  }
}

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

(async () => {
  log('Iniciando automação...');
  const contacts = await loadContacts();

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

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

    await page.locator('#username').fill(CONFIG.linkedinEmail);
    await sleep(1000);

    await page.locator('#password').fill(CONFIG.linkedinPassword);
    await sleep(1000);

    await page.locator('button[type="submit"]').click();
    log('Credenciais enviadas. Aguardando feed...');

    await page.waitForURL('**/feed/**', { timeout: 60000 });

    await context.storageState({ path: SESSION_FILE });
    log('Sessão salva! Não precisará logar novamente.');
  }

  const page = await context.newPage();

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    if (sent.includes(contact.fullName)) {
      log(`⏭ Pulando ${contact.fullName} (já enviado)`);
      continue;
    }

    const success = await sendWithRetry(page, contact);

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

require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-parser');

const template = fs.readFileSync('mensagem.txt', 'utf-8');
const SESSION_FILE = 'session.json';
const SENT_FILE = 'enviados.json';

const CONFIG = {
  postUrl: 'https://www.linkedin.com/posts/export-control_a-trading-%C3%A9-respons%C3%A1vel-n%C3%A3o-preciso-me-activity-7460683085328621568-Kcie?utm_source=social_share_send&utm_medium=member_desktop_web&rcm=ACoAAE6h4DIBN3u9tybRm2aS5FNVwT9cUKwdWKk',
  csvFile: 'contatos.csv',
  minDelay: 60000,
  maxDelay: 150000,
  linkedinEmail: process.env.LINKEDIN_EMAIL,
  linkedinPassword: process.env.LINKEDIN_PASSWORD
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = () => Math.floor(Math.random() * (CONFIG.maxDelay - CONFIG.minDelay + 1)) + CONFIG.minDelay;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
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

async function sendToContact(page, contact) {
  try {
    log(`\nProcessando: ${contact.fullName}`);

    await page.goto(CONFIG.postUrl, { waitUntil: 'domcontentloaded' });
    await sleep(5000);

    // ✅ DEBUG: loga TODOS os botões visíveis da página
    const allBtns = await page.locator('button').all();
    for (const btn of allBtns) {
      const label = await btn.getAttribute('aria-label').catch(() => '');
      const visible = await btn.isVisible().catch(() => false);
      if (visible) log(`  [BTN] "${label}"`);
    }

    // ✅ Tenta clicar no botão de enviar por várias variações
    let found = false;
    const candidates = [
      'button[aria-label*="parte"]',
      'button[aria-label*="Parte"]',
      'button[aria-label*="privad"]',
      'button[aria-label*="Enviar em"]',
      'button[aria-label*="Send in"]',
      'button[aria-label*="private"]',
    ];

    for (const selector of candidates) {
      const btn = page.locator(selector).first();
      const count = await btn.count();
      if (count > 0 && await btn.isVisible()) {
        await btn.click();
        found = true;
        log(`Botão encontrado com seletor: ${selector}`);
        break;
      }
    }

    // ✅ Fallback: clica no 4º li da barra de ações
    if (!found) {
      log('Fallback: clicando nos li da barra de ações...');
      const liButtons = page.locator('li.feed-shared-social-action-bar__action-button');
      const liCount = await liButtons.count();
      log(`  [DEBUG] li buttons: ${liCount}`);
      if (liCount >= 4) {
        await liButtons.nth(3).click();
        found = true;
      } else if (liCount > 0) {
        await liButtons.last().click();
        found = true;
      }
    }

    // ✅ Fallback final: clica no último botão da página antes do campo de comentário
    if (!found) {
      log('Fallback final: tentando pelo data-control-name...');
      const btn = page.locator('[data-control-name*="share"], [data-control-name*="send"]').first();
      if (await btn.count() > 0) {
        await btn.click();
        found = true;
      }
    }

    if (!found) {
      log(`✗ Não encontrou o botão de enviar.`);
      return false;
    }

    // ✅ Modal aberto — busca o contato
    await sleep(2000);

    const searchInput = page.locator('input[placeholder="Pesquisar"]').first();
    await searchInput.waitFor({ state: 'visible', timeout: 15000 });
    await searchInput.fill(contact.fullName);
    log(`Buscando: ${contact.fullName}...`);
    await sleep(3000);

    // ✅ Seleciona o contato
    const results = await page.locator('[role="option"], [role="listitem"], li').all();
    let clicked = false;
    for (const result of results) {
      const text = await result.textContent();
      if (text && text.includes(contact.fullName)) {
        await result.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      for (const result of results) {
        const text = await result.textContent();
        if (text && text.includes(contact.firstName)) {
          await result.click();
          clicked = true;
          log(`Selecionado pelo primeiro nome: ${contact.firstName}`);
          break;
        }
      }
    }
    if (!clicked) {
      log(`✗ Contato "${contact.fullName}" não encontrado nos resultados.`);
      return false;
    }
    log('Contato selecionado...');
    await sleep(2000);

    // ✅ Escreve a mensagem
    const messageBox = page.locator([
      'div[contenteditable="true"]',
      '.msg-form__contenteditable[contenteditable="true"]',
      '.artdeco-rich-editable-content[role="textbox"]',
      'div[aria-label="Escreva uma mensagem..."]',
      'div[aria-label="Write a message..."]',
    ].join(', ')).filter({ visible: true }).first();

    await messageBox.waitFor({ state: 'visible', timeout: 15000 });
    await messageBox.click();
    await sleep(1000);

    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await sleep(500);

    const personalMessage = template.replace('{{firstName}}', contact.firstName);
    await page.keyboard.type(personalMessage, { delay: 60 });
    log('Mensagem escrita. Aguardando...');
    await sleep(3000);

    // ✅ Botão final de enviar
    const finalSendBtn = page.locator('button.artdeco-button--primary').filter({ hasText: /Enviar|Send/ }).last();
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
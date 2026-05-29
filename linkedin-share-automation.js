require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-parser');

const template = fs.readFileSync('mensagem.txt', 'utf-8');
const SESSION_FILE = 'session.json';
const SENT_FILE = 'enviados.json';

const CONFIG = {
  postUrl: 'https://www.linkedin.com/posts/export-control_e-o-pior-%C3%A9-um-dinheiro-que-voc%C3%AA-perde-em-activity-7465758231273922560-MzCE?utm_source=social_share_send&utm_medium=member_desktop_web&rcm=ACoAAE6h4DIBN3u9tybRm2aS5FNVwT9cUKwdWKk',
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

function formatMessageHtml(message) {
  const escapeHtml = (text) => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const paragraphs = message
    .split(/\r?\n\r?\n/)
    .map(block => block.trim())
    .filter(Boolean);

  return paragraphs
    .map(paragraph => escapeHtml(paragraph).replace(/\r?\n/g, '<br>'))
    .join('<br><br>');
}

async function fillMessageInModal(modal, contact) {
  const message = template.replace(/\{\{\s*firstName\s*\}\}/gi, contact.firstName);
  const candidateSelectors = [
    'textarea[placeholder*="mensagem"]',
    'textarea[placeholder*="Message"]',
    'textarea[placeholder*="Adicionar uma mensagem"]',
    'textarea[placeholder*="add a message"]',
    'textarea',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]'
  ];

  for (const selector of candidateSelectors) {
    const editor = modal.locator(selector).first();
    if (await editor.count() === 0) continue;
    await editor.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
    if (!(await editor.isVisible())) continue;

    await editor.scrollIntoViewIfNeeded();
    log(`Preenchendo mensagem no editor encontrado com seletor: ${selector}`);
    await editor.click({ force: true });
    await sleep(300);

    const isTextInput = await editor.evaluate((el) => el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement);
    if (isTextInput) {
      await editor.fill(message);
      await editor.evaluate((el) => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    } else {
      const htmlMessage = formatMessageHtml(message);
      await editor.evaluate((el, html) => {
        if (el.isContentEditable) {
          el.innerHTML = html;
          el.dispatchEvent(new InputEvent('input', { bubbles: true }));
        } else {
          el.textContent = html;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, htmlMessage);
    }

    await sleep(800);
    return true;
  }

  return false;
}

async function selectSuggestionRow(page, modal, row, logPrefix = '') {
  const label = row.locator('label').first();
  const checkbox = row.locator('input[type="checkbox"]').first();

  const attemptClick = async (target, description) => {
    if ((await target.count()) === 0) return false;

    try {
      await target.scrollIntoViewIfNeeded();
    } catch (e) {
      // Seguimos tentando; alguns itens já estão parcialmente visíveis.
    }

    try {
      await target.click({ force: true });
      return true;
    } catch (err) {
      log(`${logPrefix}Falha ao clicar ${description}: ${err.message}`);
      return false;
    }
  };

  if (await attemptClick(label, 'label')) return true;

  try {
    await row.scrollIntoViewIfNeeded();
  } catch (e) {
    // sem bloqueio: vamos tentar o próximo fallback
  }

  if (await attemptClick(row, 'linha')) return true;

  if ((await checkbox.count()) > 0) {
    try {
      await checkbox.scrollIntoViewIfNeeded();
    } catch (e) {
      // continuar mesmo assim
    }

    try {
      await checkbox.click({ force: true });
      return true;
    } catch (err) {
      log(`${logPrefix}Falha ao clicar checkbox: ${err.message}`);
    }

    try {
      const id = await checkbox.getAttribute('id');
      if (id) {
        await page.evaluate((elId) => {
          const el = document.getElementById(elId);
          if (el) {
            el.checked = true;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, id);
      } else {
        await checkbox.evaluate((el) => {
          el.checked = true;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
      return true;
    } catch (err) {
      log(`${logPrefix}Falha ao forçar checkbox via JS: ${err.message}`);
    }
  }

  return false;
}

async function sendToContact(page, contact) {
  try {
    log(`\n========== PROCESSANDO: ${contact.fullName} ==========`);

    // 1️⃣ ACESSAR A PUBLICAÇÃO
    await page.goto(CONFIG.postUrl, { waitUntil: 'domcontentloaded' });
    await sleep(3000);

    // 2️⃣ CLICAR NO BOTÃO "ENVIAR" (Share/Send)
    log('Clicando no botão de compartilhar...');
    const shareBtn = page.locator('button:has-text("Enviar"), [aria-label="Enviar"]').first();
    
    if (!(await shareBtn.isVisible())) {
      log('✗ Botão de compartilhar não encontrado!');
      return false;
    }
    await shareBtn.click();

    // 3️⃣ ESPERAR O MODAL ABRIR (testa vários seletores e salva debug se falhar)
    log('Aguardando modal...');
    const modalSelectors = ['dialog[open]', 'dialog[data-testid="dialog"]', 'dialog', '.artdeco-modal', '[role="dialog"]', 'div[aria-modal="true"]', '.share-box', '.msg-overlay-conversation-container'];
    let modal = null;
    let found = false;

    for (const sel of modalSelectors) {
      try {
        const loc = page.locator(sel).last();
        await loc.waitFor({ state: 'visible', timeout: 10000 });
        modal = loc;
        found = true;
        break;
      } catch (e) {
        // continua tentando outros seletores
      }
    }

    if (!found) {
      try {
        const loc = page.locator('[role="dialog"], div[aria-modal="true"]').last();
        await loc.waitFor({ state: 'visible', timeout: 5000 });
        modal = loc;
        found = true;
      } catch (e) {
        // nada
      }
    }

    if (!found) {
      log('✗ Modal não detectado pelo Playwright! Salvando debug...');
      const debugTime = Date.now();
      const screenshotPath = `debug_modal_${debugTime}.png`;
      const htmlPath = `debug_modal_${debugTime}.html`;
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      const html = await page.content();
      fs.writeFileSync(htmlPath, html);
      log(`✎ Debug salvo: ${screenshotPath}, ${htmlPath}`);
      return false;
    }

    // 4️⃣ PROCURAR E PREENCHER O CAMPO DE BUSCA DENTRO DO MODAL
    const searchInput = modal.locator('input[placeholder*="Pesquisar"], input[placeholder*="Search"]').first();
    await searchInput.waitFor({ state: 'visible', timeout: 5000 });

    // Garantir foco e digitar com pequena latência para acionar o autocomplete
    await searchInput.click({ force: true });
    await searchInput.fill('');
    log(`Digitando nome: ${contact.fullName}`);
    await searchInput.type(contact.fullName, { delay: 100 });
    await sleep(1500); // Aguardar sugestões carregarem

    // 5️⃣ TENTAR SELECIONAR O CONTATO NAS SUGESTÕES
    log('Buscando contato nos resultados...');
    const rowSelector = 'div[role="menuitem"], [role="option"], div[role="option"], li[role="option"]';
    const rows = modal.locator(rowSelector);

    try {
      await rows.first().waitFor({ state: 'visible', timeout: 8000 });
    } catch (e) {
      log('Nenhuma linha de resultado visível encontrada.');
    }

    const count = await rows.count();
    log(`Resultados encontrados: ${count}`);

    let selected = false;
    let matchedIndex = -1;
    let confirmed = false;

    for (let i = 0; i < count; i++) {
      const r = rows.nth(i);
      const text = (await r.innerText()).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (text.includes(contact.fullName) || text.includes(contact.firstName)) {
        matchedIndex = i;
        log(`Correspondência encontrada na linha ${i}: ${text}`);
        selected = await selectSuggestionRow(page, modal, r, 'Sugestão correspondente: ');

        if (selected) {
          await sleep(500);
          // verificar se o contato entrou na lista de selecionados
          try {
            const selList = modal.locator('[data-testid="typeahead-selected-recipient-list"], [data-testid*="selected-recipient-list"]');
            if (await selList.count() > 0) {
              const selectedText = (await selList.first().innerText()).replace(/\s+/g,' ').trim();
              if (selectedText && (selectedText.includes(contact.fullName) || selectedText.includes(contact.firstName))) {
                confirmed = true;
                log('Destinatário aparece na lista de selecionados após clique.');
              }
            }
          } catch (e) {
            // sem lista visible ainda
          }
        }
        break;
      }
    }

    if (!selected && count > 0) {
      log('Nenhuma correspondência exata encontrada; marcando a primeira sugestão disponível.');
      const first = rows.first();
      selected = await selectSuggestionRow(page, modal, first, 'Primeira sugestão: ');
    }

    if (selected) {
      log('✓ Contato selecionado!');
      await sleep(500);

      // Confirmar visualmente que o checkbox foi marcado ou que o destinatário aparece na lista
      confirmed = false;
      try {
        const checkedCount = await modal.locator('input[type="checkbox"]:checked').count();
        if (checkedCount > 0) {
          confirmed = true;
          log('Checkbox confirmado como marcado.');
        }
      } catch (e) {}

      if (!confirmed) {
        try {
          const selList = modal.locator('[data-testid="typeahead-selected-recipient-list"], [data-testid*="selected-recipient-list"]');
          if (await selList.count() > 0) {
            const text = (await selList.first().innerText()).replace(/\s+/g,' ').trim();
            if (text && (text.includes(contact.fullName) || text.includes(contact.firstName))) {
              confirmed = true;
              log('Destinatário aparece na lista de selecionados.');
            }
          }
        } catch (e) {}
      }

      // Se ainda não confirmado, forçar via JS dentro da linha encontrada (matchedIndex)
      if (!confirmed && matchedIndex >= 0) {
        try {
          const row = rows.nth(matchedIndex);
          await row.evaluate((el) => {
            const cb = el.querySelector('input[type="checkbox"]');
            if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
          });
          // re-check
          const checkedCount2 = await modal.locator('input[type="checkbox"]:checked').count();
          if (checkedCount2 > 0) {
            confirmed = true;
            log('Checkbox marcado via JS fallback.');
          }
        } catch (e) {
          log(`Aviso: falha ao forçar checkbox via JS: ${e.message}`);
        }
      }

      // 5.1️⃣ PREENCHER A MENSAGEM ANTES DE ENVIAR
      const messageFilled = await fillMessageInModal(modal, contact);
      if (messageFilled) {
        log('Mensagem preenchida com sucesso.');
      } else {
        log('⚠️ Campo de mensagem não encontrado no modal. Prosseguindo sem preenchê-lo.');
      }

      // 6️⃣ CLICAR NO BOTÃO DE ENVIAR FINAL (Dentro do modal)
      log('Aguardando botão Enviar ficar habilitado...');
      const sendBtn = modal.locator('button:has-text("Enviar"), button:has-text("Send"), a:has-text("Enviar"), a:has-text("Send"), [aria-label="Enviar"], [aria-label="Send"]').first();
      const start = Date.now();
      const waitTimeout = 10000;
      let sendEnabled = false;
      let buttonVisible = false;

      if (await sendBtn.count() > 0) {
        buttonVisible = await sendBtn.isVisible().catch(() => false);
      }

      if (!buttonVisible) {
        log('✗ Botão Enviar não encontrado no modal. Tentando encontrar via fallback global...');
      }

      while (Date.now() - start < waitTimeout) {
        try {
          if (await sendBtn.isVisible() && await sendBtn.isEnabled()) { sendEnabled = true; break; }
        } catch (e) {}
        await sleep(300);
      }

      if (!sendEnabled) {
        log('Botão Enviar não ficou habilitado; tentando forçar ações de UI para atualizar estado...');
        try { await searchInput.click({ force: true }); await sleep(200); await page.keyboard.press('Tab'); await sleep(300); } catch (e) {}
        try {
          if (await sendBtn.isVisible() && await sendBtn.isEnabled()) sendEnabled = true;
        } catch (e) {}
      }

      if (!sendEnabled) {
        log('Tentando habilitar botão Enviar via JS (DOM direto)');
        try {
          const didClick = await page.evaluate(() => {
            const actions = Array.from(document.querySelectorAll('button, a'));
            const btn = actions.find(el => {
              const text = el.textContent?.trim();
              const aria = el.getAttribute('aria-label');
              return text === 'Enviar' || text === 'Send' || aria === 'Enviar' || aria === 'Send';
            });
            if (btn) {
              btn.removeAttribute('disabled');
              btn.click();
              return true;
            }
            const form = document.querySelector('form');
            if (form) {
              form.submit();
              return true;
            }
            return false;
          });
          await sleep(500);
          if (didClick) sendEnabled = true;
        } catch (e) {
          log(`Aviso: falha ao forçar botão via JS: ${e.message}`);
        }
      }

      if (sendEnabled) {
        try {
          await sendBtn.click({ force: true });
        } catch (err) {
          log(`Aviso: falha ao clicar no botão Enviar via Playwright: ${err.message} - tentando fallback JS...`);
          await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, a')).find(el => {
              const text = el.textContent?.trim();
              const aria = el.getAttribute('aria-label');
              return text === 'Enviar' || text === 'Send' || aria === 'Enviar' || aria === 'Send';
            });
            btn?.click();
          });
        }

        log(`✓✓✓ SUCESSO: COMPARTILHADO COM ${contact.fullName} ✓✓✓`);
        await sleep(2000);
        return true;
      } else {
        // último recurso: tentar clicar forçado
        try {
          await sendBtn.click({ force: true });
          log(`✓✓✓ SUCESSO (forçado): COMPARTILHADO COM ${contact.fullName} ✓✓✓`);
          await sleep(2000);
          return true;
        } catch (err) {
          log('✗ Botão de envio desativado (contato pode já ter recebido ou erro de seleção)');
          await page.keyboard.press('Escape');
          return false;
        }
      }
    } else {
      log('✗ Não foi possível selecionar nenhum contato nos resultados.');
      // tentar fallback por teclado
      await searchInput.press('ArrowDown');
      await sleep(300);
      await searchInput.press('Enter');
      await sleep(800);
    }

  } catch (error) {
    log(`✗ ERRO CRÍTICO COM ${contact.fullName}: ${error.message}`);
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }
}

async function sendWithRetry(page, contact, maxTries = 2) {
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const result = await sendToContact(page, contact);
    if (result) return true;
    
    if (attempt < maxTries) {
      log(`❌ Tentativa ${attempt} falhou. Re-tentando em 15s...`);
      await sleep(15000);
    }
  }
  return false;
}

(async () => {
  log('🚀 INICIANDO AUTOMAÇÃO...');
  const contacts = await loadContacts();
  log(`📋 ${contacts.length} contatos carregados`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });

  let context;
  if (fs.existsSync(SESSION_FILE)) {
    log('✓ Usando sessão existente...');
    context = await browser.newContext({ storageState: SESSION_FILE });
  } else {
    log('⚠️ Fazendo login...');
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://www.linkedin.com/login');
    await page.locator('#username').fill(CONFIG.linkedinEmail);
    await page.locator('#password').fill(CONFIG.linkedinPassword);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/feed/**', { timeout: 60000 });
    await context.storageState({ path: SESSION_FILE });
    log('💾 Sessão salva!');
  }

  const page = await context.newPage();

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    if (sent.includes(contact.fullName)) {
      log(`⏭️  PULANDO ${contact.fullName} (já enviado)`);
      continue;
    }

    const success = await sendWithRetry(page, contact);

    if (success) {
      sent.push(contact.fullName);
      fs.writeFileSync(SENT_FILE, JSON.stringify(sent, null, 2));
    }

    if (i < contacts.length - 1) {
      if (i % 3 === 0) await randomActivity(page);
      const delay = randomDelay();
      log(`⏰ Pausa de segurança: ${Math.round(delay / 1000)}s\n`);
      await sleep(delay);
    }
  }

  log('\n✅ PROCESSO FINALIZADO!');
  await browser.close();
})();

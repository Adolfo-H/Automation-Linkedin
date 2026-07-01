require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-parser');
const readline = require('readline');

const template = fs.readFileSync('mensagem.txt', 'utf-8');
const SESSION_FILE = 'session.json';
const SESSION_META_FILE = 'session-meta.json';
const SENT_FILE = 'enviados.json';

const CONFIG = {
  postUrl: 'https://www.linkedin.com/posts/export-control_alerta-fiscal-mudan%C3%A7a-na-manifesta%C3%A7%C3%A3o-activity-7467284055873544192-i2d1?utm_source=social_share_send&utm_medium=member_desktop_web&rcm=ACoAAE6h4DIBN3u9tybRm2aS5FNVwT9cUKwdWKk',
  csvFile: 'contatos.csv',
  batchSize: 10,
  minDelay: 60000,
  maxDelay: 150000,
  linkedinEmail: process.env.LINKEDIN_EMAIL,
  linkedinPassword: process.env.LINKEDIN_PASSWORD
};

if (!CONFIG.linkedinEmail || !CONFIG.linkedinPassword) {
  throw new Error('As variáveis de ambiente LINKEDIN_EMAIL e LINKEDIN_PASSWORD devem estar definidas no arquivo .env.');
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = () => Math.floor(Math.random() * (CONFIG.maxDelay - CONFIG.minDelay + 1)) + CONFIG.minDelay;

function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Pressione ENTER quando completar a verificação no LinkedIn...\n', () => {
      rl.close();
      resolve();
    });
  });
}

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
  try {
    if (action === 'feed') {
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.mouse.wheel(0, 400).catch(() => {});
    } else {
      await page.goto('https://www.linkedin.com/notifications/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
  } catch (e) {
    log(`⚠️ Disfarce ignorado: ${e.message}`);
  }
  await sleep(4000);
}

async function debugPage(page, prefix) {
  try {
    await page.screenshot({ path: `${prefix}.png`, fullPage: true });
  } catch (e) {
    // ignore screenshot failures
  }

  try {
    const html = await page.content();
    fs.writeFileSync(`${prefix}.html`, html, 'utf-8');
  } catch (e) {
    // ignore HTML capture failures
  }
}

async function fillFirstVisible(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) continue;

    try {
      await locator.waitFor({ state: 'visible', timeout: 5000 });
      await locator.fill(value);
      return selector;
    } catch (e) {
      continue;
    }
  }

  return null;
}

async function fillByLabelOrSelector(page, candidates, value) {
  for (const candidate of candidates) {
    try {
      if (candidate.type === 'label') {
        const locator = page.getByLabel(candidate.value, { exact: false });
        const count = await locator.count();
        if (count === 0) continue;

        for (let i = 0; i < count; i++) {
          const field = locator.nth(i);
          if (!(await field.isVisible().catch(() => false))) continue;
          await field.fill(value);
          return `label:${candidate.value}`;
        }
        continue;
      }

      const locator = page.locator(candidate.value);
      const count = await locator.count();
      if (count === 0) continue;

      for (let i = 0; i < count; i++) {
        const field = locator.nth(i);
        if (!(await field.isVisible().catch(() => false))) continue;
        await field.fill(value);
        return candidate.value;
      }
    } catch (e) {
      log(`Tentativa falhou em ${candidate.type}:${candidate.value} -> ${e.message}`);
      continue;
    }
  }

  return null;
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
    const shareCandidates = [
      page.getByRole('button', { name: /enviar/i }).first(),
      page.locator('button:has(svg[aria-label="send-privately-small"])').first(),
      page.locator('a:has(svg[aria-label="send-privately-small"])').first(),
      page.locator('button:has-text("Enviar")').first(),
      page.locator('a:has-text("Enviar")').first(),
      page.locator('[aria-label="Enviar"]').first()
    ];

    let shareBtn = null;
    for (const candidate of shareCandidates) {
      if ((await candidate.count().catch(() => 0)) === 0) continue;
      if (await candidate.isVisible().catch(() => false)) {
        shareBtn = candidate;
        break;
      }
    }

    if (!shareBtn) {
      log('✗ Botão de compartilhar não encontrado!');
      return false;
    }

    await shareBtn.click({ force: true });

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

async function sendBatchToContacts(page, contactsBatch) {
  if (contactsBatch.length === 0) return true;

  log(`\n========== PROCESSANDO LOTE DE ${contactsBatch.length} CONTATOS ==========`);

  await page.goto(CONFIG.postUrl, { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  log('Clicando no botão de compartilhar...');
  const shareCandidates = [
    page.getByRole('button', { name: /enviar/i }).first(),
    page.locator('button:has(svg[aria-label="send-privately-small"])').first(),
    page.locator('a:has(svg[aria-label="send-privately-small"])').first(),
    page.locator('button:has-text("Enviar")').first(),
    page.locator('a:has-text("Enviar")').first(),
    page.locator('[aria-label="Enviar"]').first()
  ];

  let shareBtn = null;
  for (const candidate of shareCandidates) {
    if ((await candidate.count().catch(() => 0)) === 0) continue;
    if (await candidate.isVisible().catch(() => false)) {
      shareBtn = candidate;
      break;
    }
  }

  if (!shareBtn) {
    log('✗ Botão de compartilhar não encontrado!');
    return false;
  }

  await shareBtn.click({ force: true });

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
    } catch (e) {}
  }

  if (!found) {
    try {
      const loc = page.locator('[role="dialog"], div[aria-modal="true"]').last();
      await loc.waitFor({ state: 'visible', timeout: 5000 });
      modal = loc;
      found = true;
    } catch (e) {}
  }

  if (!found) {
    log('✗ Modal não detectado pelo Playwright! Salvando debug...');
    const debugTime = Date.now();
    await page.screenshot({ path: `debug_modal_${debugTime}.png`, fullPage: true }).catch(() => {});
    fs.writeFileSync(`debug_modal_${debugTime}.html`, await page.content());
    return false;
  }

  const selectedRecipients = new Set();

  for (const contact of contactsBatch) {
    const searchInput = modal.locator('input[placeholder*="Pesquisar"], input[placeholder*="Search"]').first();
    await searchInput.waitFor({ state: 'visible', timeout: 5000 });
    await searchInput.click({ force: true });
    await searchInput.fill('');
    log(`Digitando nome: ${contact.fullName}`);
    await searchInput.type(contact.fullName, { delay: 100 });
    await sleep(1500);

    log('Buscando contato nos resultados...');
    const rowSelector = 'div[role="menuitem"], [role="option"], div[role="option"], li[role="option"]';
    const rows = modal.locator(rowSelector);
    try { await rows.first().waitFor({ state: 'visible', timeout: 8000 }); } catch (e) {}
    const count = await rows.count();
    log(`Resultados encontrados: ${count}`);

    let selected = false;
    for (let i = 0; i < count; i++) {
      const r = rows.nth(i);
      const text = (await r.innerText()).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (text.includes(contact.fullName) || text.includes(contact.firstName)) {
        log(`Correspondência encontrada na linha ${i}: ${text}`);
        selected = await selectSuggestionRow(page, modal, r, 'Sugestão correspondente: ');
        break;
      }
    }

    if (!selected && count > 0) {
      log('Nenhuma correspondência exata encontrada; marcando a primeira sugestão disponível.');
      selected = await selectSuggestionRow(page, modal, rows.first(), 'Primeira sugestão: ');
    }

    if (!selected) {
      log(`✗ Não foi possível selecionar ${contact.fullName}`);
      continue;
    }

    selectedRecipients.add(contact.fullName);
    await sleep(600);
  }

  const firstContact = contactsBatch[0];
  const messageFilled = await fillMessageInModal(modal, firstContact);
  if (messageFilled) log('Mensagem preenchida com sucesso.');

  log('Aguardando botões finais do modal...');
  const sendSeparatelyCandidates = [
    modal.getByRole('button', { name: /enviar separadamente/i }).first(),
    modal.locator('button:has-text("Enviar separadamente")').first(),
    modal.locator('a:has-text("Enviar separadamente")').first(),
    modal.locator('[aria-label="Enviar separadamente"]').first()
  ];

  let sendSeparatelyBtn = null;
  for (const candidate of sendSeparatelyCandidates) {
    if ((await candidate.count().catch(() => 0)) === 0) continue;
    if (await candidate.isVisible().catch(() => false)) {
      sendSeparatelyBtn = candidate;
      break;
    }
  }

  if (!sendSeparatelyBtn) {
    log('✗ Botão "Enviar separadamente" não encontrado.');
    return false;
  }

  const start = Date.now();
  while (Date.now() - start < 10000) {
    try {
      if (await sendSeparatelyBtn.isVisible() && await sendSeparatelyBtn.isEnabled()) break;
    } catch (e) {}
    await sleep(300);
  }

  try {
    await sendSeparatelyBtn.click({ force: true });
  } catch (err) {
    log(`Aviso: falha ao clicar no botão "Enviar separadamente" via Playwright: ${err.message}`);
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button, a')).find(el => {
        const text = el.textContent?.trim();
        const aria = el.getAttribute('aria-label');
        return /enviar separadamente/i.test(text || '') || /enviar separadamente/i.test(aria || '');
      });
      btn?.click();
    });
  }

  log(`✓✓✓ SUCESSO: COMPARTILHADO COM LOTE DE ${selectedRecipients.size} CONTATOS ✓✓✓`);
  await sleep(2000);
  return true;
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

function chunkContacts(contacts, size) {
  const chunks = [];
  for (let i = 0; i < contacts.length; i += size) {
    chunks.push(contacts.slice(i, i + size));
  }
  return chunks;
}

(async () => {
  log('🚀 INICIANDO AUTOMAÇÃO...');
  const contacts = await loadContacts();
  log(`📋 ${contacts.length} contatos carregados`);
  const pendingContacts = contacts.filter(contact => !sent.includes(contact.fullName));
  const skippedCount = contacts.length - pendingContacts.length;
  if (skippedCount > 0) {
    log(`⏭️  ${skippedCount} contato(s) já estavam em enviados.json e serão pulados antes de iniciar`);
  }
  const batches = chunkContacts(pendingContacts, CONFIG.batchSize);
  log(`📦 Processando em lotes de ${CONFIG.batchSize} contatos (${batches.length} lote(s))`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });

  let context;
  let useExistingSession = false;

  if (fs.existsSync(SESSION_FILE)) {
    if (fs.existsSync(SESSION_META_FILE)) {
      try {
        const meta = JSON.parse(fs.readFileSync(SESSION_META_FILE, 'utf-8'));
        if (meta.linkedinEmail === CONFIG.linkedinEmail) {
          useExistingSession = true;
        } else {
          log('⚠️ A sessão existente pertence a outra conta. Irei usar as credenciais do .env e criar nova sessão.');
        }
      } catch (e) {
        log('⚠️ Não foi possível ler session-meta.json. Recriando sessão para garantir o usuário correto.');
      }
    } else {
      log('⚠️ session.json existe mas não há metadados de sessão. Recriando sessão com as credenciais atuais.');
    }
  }

  if (useExistingSession) {
    log('✓ Usando sessão existente...');
    context = await browser.newContext({ storageState: SESSION_FILE });
  } else {
    log('⚠️ Fazendo login...');
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(3000);

    log(`Login URL atual: ${page.url()}`);

    const userSelector = await fillByLabelOrSelector(page, [
      { type: 'label', value: 'E-mail ou telefone' },
      { type: 'label', value: 'Email or phone' },
      { type: 'selector', value: 'input[name="session_key"]' },
      { type: 'selector', value: 'input[autocomplete*="username"]' },
      { type: 'selector', value: 'input[type="email"]' },
      { type: 'selector', value: 'input[id^=":r"]' }
    ], CONFIG.linkedinEmail);

    const passSelector = await fillByLabelOrSelector(page, [
      { type: 'label', value: 'Senha' },
      { type: 'label', value: 'Password' },
      { type: 'selector', value: 'input[name="session_password"]' },
      { type: 'selector', value: 'input[autocomplete="current-password"]' },
      { type: 'selector', value: 'input[type="password"]' },
      { type: 'selector', value: 'input[id^=":r"]' }
    ], CONFIG.linkedinPassword);

    log(`Seletores usados: user=${userSelector || 'none'}, pass=${passSelector || 'none'}`);

    if (!userSelector || !passSelector) {
      log(`❌ Formulário de login não encontrado. Seletores: user=${userSelector}, pass=${passSelector}`);
      await debugPage(page, 'login-debug');
      throw new Error('Não foi possível localizar o formulário de login do LinkedIn.');
    }

    const passwordField = page.locator('input[name="session_password"], input[autocomplete="current-password"], input[type="password"]').first();
    if (await passwordField.count()) {
      await passwordField.press('Enter');
    } else {
      const submitCandidates = page.locator('button:has-text("Entrar"), button:has-text("Sign in"), button[type="submit"]');
      const submitCount = await submitCandidates.count();
      let clicked = false;

      for (let i = 0; i < submitCount; i++) {
        const button = submitCandidates.nth(i);
        if (!(await button.isVisible().catch(() => false))) continue;
        await button.click();
        clicked = true;
        break;
      }

      if (!clicked) {
        throw new Error('Não encontrei um botão de envio visível no formulário de login.');
      }
    }
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForURL(/linkedin\.com\/feed|linkedin\.com\/checkpoint|linkedin\.com\/signup|linkedin\.com\/login/i, { timeout: 60000 });

    let currentUrl = page.url();
    if (/linkedin\.com\/feed/i.test(currentUrl)) {
      log('✓ Login concluído e feed carregado.');
    } else if (/checkpoint|signup|login/i.test(currentUrl)) {
      log(`⚠️ Verificação detectada na URL: ${currentUrl}`);
      log('Por favor, complete o código de confirmação no browser do LinkedIn. O script vai aguardar até que a página do feed seja carregada.');
      await waitForEnter();
      try {
        await page.waitForURL(/linkedin\.com\/feed/i, { timeout: 300000 });
        log('✓ Login concluído após confirmação.');
      } catch (e) {
        log('❌ Tempo limite ao aguardar a página do feed após confirmação.');
        await debugPage(page, 'login-debug-after-confirmation');
        throw new Error('Login não avançou para o feed depois da verificação. Confira o browser e tente novamente.');
      }
    }

    await context.storageState({ path: SESSION_FILE });
    fs.writeFileSync(SESSION_META_FILE, JSON.stringify({
      linkedinEmail: CONFIG.linkedinEmail,
      createdAt: new Date().toISOString()
    }, null, 2), 'utf-8');
    log('💾 Sessão salva!');
  }

  const page = await context.newPage();

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    log(`\n========== LOTE ${batchIndex + 1}/${batches.length} (${batch.length} contatos) ==========`);

    const batchToSend = batch.filter(contact => !sent.includes(contact.fullName));
    const skipped = batch.length - batchToSend.length;
    if (skipped > 0) {
      log(`⏭️  PULANDO ${skipped} contato(s) já enviados neste lote`);
    }

    const success = await sendBatchToContacts(page, batchToSend);
    if (success) {
      for (const contact of batchToSend) {
        sent.push(contact.fullName);
      }
      fs.writeFileSync(SENT_FILE, JSON.stringify(sent, null, 2));
    }

    if (batchIndex < batches.length - 1) {
      if (batchIndex % 2 === 0) await randomActivity(page);
      const delay = randomDelay();
      log(`⏰ Pausa de segurança: ${Math.round(delay / 1000)}s\n`);
      await sleep(delay);
    }
  }

  log('\n✅ PROCESSO FINALIZADO!');
  await browser.close();
})();

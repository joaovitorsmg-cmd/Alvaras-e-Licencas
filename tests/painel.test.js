/**
 * Bateria de testes do Painel Alvarás & Licenças
 * Cobre: init, KPIs, filtros, sort, edição, auditoria, abas, importação, relatórios
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FILE_URL = 'file://' + path.resolve(__dirname, '../index.html');
const RESULTS = [];
let passed = 0, failed = 0, warnings = 0;

// ─── Test runner helpers ────────────────────────────────────────────────────
function result(name, ok, detail = '') {
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) passed++; else failed++;
  RESULTS.push({ status, name, detail });
  const icon = ok ? '✔' : '✘';
  console.log(`  ${icon} [${status}] ${name}${detail ? ' — ' + detail : ''}`);
}
function warn(name, detail = '') {
  warnings++;
  RESULTS.push({ status: 'WARN', name, detail });
  console.log(`  ⚠ [WARN] ${name}${detail ? ' — ' + detail : ''}`);
}
async function section(label) {
  console.log(`\n── ${label} ${'─'.repeat(60 - label.length)}`);
}

async function waitReady(page) {
  await page.waitForFunction(() => {
    const tb = document.getElementById('mainTbody');
    return tb && tb.querySelectorAll('tr').length > 0;
  }, { timeout: 10000 });
}

// ─── Main test suite ────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   PAINEL ALVARÁS & LICENÇAS — Bateria de Testes Completa    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // ══════════════════════════════════════════════════════
  // BLOCO 1 — CARGA INICIAL
  // ══════════════════════════════════════════════════════
  await section('BLOCO 1 — CARGA INICIAL');
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('PageError: ' + err.message));

  await page.goto(FILE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const fatalErrors = consoleErrors.filter(e =>
    !e.includes('ipify') && !e.includes('jsonbin') &&
    !e.includes('Failed to fetch') && !e.includes('ERR_TUNNEL') &&
    !e.includes('net::ERR') && !e.includes('favicon')
  );
  result('Página carrega sem erros fatais', fatalErrors.length === 0, fatalErrors.join('; '));

  const title = await page.title();
  result('Título da página correto', title.includes('Alvarás'), title);

  await waitReady(page).catch(() => {});
  const rowCount = await page.locator('#mainTbody tr').count();
  result('Tabela carrega com registros', rowCount > 0, `${rowCount} linhas`);

  const headerSub = await page.locator('#headerSub').textContent();
  result('Header sub mostra totais', headerSub.includes('registros'), headerSub);

  // ══════════════════════════════════════════════════════
  // BLOCO 2 — KPI CARDS
  // ══════════════════════════════════════════════════════
  await section('BLOCO 2 — KPI CARDS');

  const kpiCards = await page.locator('.kpi-card').count();
  result('KPI cards renderizados', kpiCards >= 7, `${kpiCards} cards`);

  // Verify correct labels
  const kpiText = await page.locator('.kpi-bar').innerText();
  const kpiUpper = kpiText.toUpperCase();
  result('Label "A Regularizar" presente', kpiUpper.includes('A REGULARIZAR'), kpiText.substring(0, 200));
  result('Label "Aberto/Pendente" presente', kpiUpper.includes('ABERTO/PENDENTE') || kpiUpper.includes('ABERTO'), '');
  result('Label "Vencidos" presente', kpiUpper.includes('VENCIDOS') || kpiUpper.includes('VENCIDO'), '');
  result('Label "Aprovados" presente', kpiUpper.includes('APROVADOS') || kpiUpper.includes('APROVADO'), '');

  // KPI filter click
  const firstKpiCard = page.locator('.kpi-card').first();
  await firstKpiCard.click();
  await page.waitForTimeout(300);
  const rowsAfterKpi = await page.locator('#mainTbody tr').count();
  result('Clique KPI filtra a tabela', rowsAfterKpi !== rowCount, `${rowCount} → ${rowsAfterKpi} linhas`);

  // Click "Total" to reset
  const totalCard = page.locator('.kpi-card').last();
  await totalCard.click();
  await page.waitForTimeout(300);
  const rowsAfterReset = await page.locator('#mainTbody tr').count();
  result('Clique "Total" limpa filtro KPI', rowsAfterReset === rowCount, `${rowsAfterReset} linhas`);

  // ══════════════════════════════════════════════════════
  // BLOCO 3 — FILTROS
  // ══════════════════════════════════════════════════════
  await section('BLOCO 3 — FILTROS');

  // Search box
  await page.fill('#searchBox', 'MTZ');
  await page.waitForTimeout(400);
  const rowsMTZ = await page.locator('#mainTbody tr').count();
  result('Busca por sigla filtra tabela', rowsMTZ > 0 && rowsMTZ < rowCount, `${rowsMTZ} linhas`);
  await page.fill('#searchBox', '');
  await page.waitForTimeout(200);

  // Filter by filial
  const filialOpts = await page.locator('#filterFilial option').count();
  result('Select de filiais populado', filialOpts > 1, `${filialOpts} opções`);
  await page.selectOption('#filterFilial', { index: 1 });
  await page.waitForTimeout(300);
  const rowsFilial = await page.locator('#mainTbody tr').count();
  result('Filtro por filial funciona', rowsFilial > 0 && rowsFilial < rowCount, `${rowsFilial} linhas`);

  // Obrigatório filter
  await page.selectOption('#filterFilial', '');
  await page.selectOption('#filterObrig', '1');
  await page.waitForTimeout(300);
  const rowsObrig = await page.locator('#mainTbody tr').count();
  result('Filtro "Somente obrigatórios" funciona', rowsObrig > 0, `${rowsObrig} obrigatórios`);
  await page.selectOption('#filterObrig', '');

  // Clear filters button
  await page.fill('#searchBox', 'teste');
  await page.click('button:has-text("Limpar")');
  await page.waitForTimeout(300);
  const rowsCleared = await page.locator('#mainTbody tr').count();
  result('Botão Limpar filtros restaura tabela', rowsCleared === rowCount, `${rowsCleared} linhas`);

  // Auditor filter
  const auditorOpts = await page.locator('#filterAuditor option').count();
  result('Select de auditores populado', auditorOpts > 1, `${auditorOpts} opções`);

  // Regional filter
  const regionalOpts = await page.locator('#filterRegional option').count();
  result('Select de regionais populado', regionalOpts > 1, `${regionalOpts} opções`);

  // ══════════════════════════════════════════════════════
  // BLOCO 4 — ORDENAÇÃO
  // ══════════════════════════════════════════════════════
  await section('BLOCO 4 — ORDENAÇÃO (SORT)');

  // Click sort on filial
  await page.click('th[data-col="filial"]');
  await page.waitForTimeout(300);
  const firstFilial_asc = await page.locator('#mainTbody tr:first-child td:first-child').innerText();
  await page.click('th[data-col="filial"]');
  await page.waitForTimeout(300);
  const firstFilial_desc = await page.locator('#mainTbody tr:first-child td:first-child').innerText();
  result('Sort por filial ASC≠DESC', firstFilial_asc !== firstFilial_desc, `"${firstFilial_asc.slice(0,20)}" → "${firstFilial_desc.slice(0,20)}"`);

  // Sort by dias (numeric)
  await page.click('th[data-col="diasParaVencer"]');
  await page.waitForTimeout(300);
  const cells = await page.locator('#mainTbody tr td:nth-child(6)').allInnerTexts();
  const nums = cells.map(c => parseInt(c)).filter(n => !isNaN(n));
  const isSortedAsc = nums.every((v, i) => i === 0 || nums[i - 1] <= v);
  result('Sort numérico por dias funciona', isSortedAsc || nums.length < 2, `${nums.slice(0, 5).join(',')}…`);

  // Sort by urgencia
  await page.click('th[data-col="urgencia"]');
  await page.waitForTimeout(300);
  const firstUrg = await page.locator('#mainTbody tr:first-child td:nth-child(4)').innerText();
  result('Sort por urgência funciona', firstUrg.length > 0, firstUrg.slice(0, 30));

  // Sort icon present
  const sortedTh = await page.locator('th.sorted').count();
  result('Ícone de coluna ordenada visível', sortedTh > 0, `${sortedTh} colunas marcadas`);

  // ══════════════════════════════════════════════════════
  // BLOCO 5 — BADGE OBRIGATÓRIO
  // ══════════════════════════════════════════════════════
  await section('BLOCO 5 — BADGE OBRIGATÓRIO');

  const obrigBadges = await page.locator('.obrig-badge').count();
  result('Badges OBRIGATÓRIO visíveis na tabela', obrigBadges > 0, `${obrigBadges} badges`);
  const obrigText = await page.locator('.obrig-badge').first().innerText();
  result('Badge OBRIGATÓRIO tem texto correto', obrigText.includes('OBRIGATÓRIO'), obrigText);

  // ══════════════════════════════════════════════════════
  // BLOCO 6 — MODAL EDIÇÃO
  // ══════════════════════════════════════════════════════
  await section('BLOCO 6 — MODAL DE EDIÇÃO');

  // Click edit on first row
  await page.locator('#mainTbody tr:first-child button:has-text("Editar")').click();
  await page.waitForTimeout(500);

  const editOverlayVisible = await page.locator('#editOverlay').isVisible();
  result('Modal de edição abre', editOverlayVisible, '');

  // No status dropdown
  const statusDropdown = await page.locator('#popStatus').count();
  result('Status dropdown REMOVIDO do modal', statusDropdown === 0, 'status só via importação');

  // Status info box present
  const statusInfoBox = await page.locator('.status-info-box').isVisible();
  result('Caixa info de status presente', statusInfoBox, '');

  const statusBadge = await page.locator('#editStatusBadge').isVisible();
  result('Badge de status atual visível', statusBadge, '');

  // Obs field
  const obsField = await page.locator('#popObs').isVisible();
  result('Campo Observação presente', obsField, '');

  const obsHint = await page.locator('#popObs').evaluate(el => el.closest('.form-row').querySelector('.hint')?.textContent || '');
  result('Hint do campo Obs correto', obsHint.includes('auditoria') || obsHint.includes('histórico') || obsHint.includes('log'), obsHint);

  // Just field
  const justField = await page.locator('#popJust').isVisible();
  result('Campo Justificativa presente', justField, '');

  // Name field
  const nomeField = await page.locator('#popNome').isVisible();
  result('Campo Nome/identificação presente', nomeField, '');

  // Date field
  const dataField = await page.locator('#popData').isVisible();
  result('Campo Data de vencimento presente', dataField, '');

  // Fill and save
  try {
    await page.fill('#popNome', 'Testador Automático');
    await page.fill('#popObs', 'Observação de teste automatizado — movimentação simulada para auditoria.');
    await page.fill('#popJust', 'Justificativa de teste inserida pelos testes automatizados.');
    result('Campos do modal preenchidos', true, '');
  } catch(e) {
    result('Campos do modal preenchidos', false, e.message.slice(0, 80));
  }

  const saveBtn = page.locator('#editSaveBtn');
  result('Botão Salvar presente', await saveBtn.isVisible().catch(() => false), '');

  await saveBtn.click().catch(() => {});
  await page.waitForTimeout(800);

  result('Modal fecha após salvar', !(await page.locator('#editOverlay').isVisible()), '');

  // Toast
  const toast = await page.locator('.toast').first();
  const toastVisible = await toast.isVisible().catch(() => false);
  result('Toast de confirmação exibe após salvar', toastVisible, '');

  // ══════════════════════════════════════════════════════
  // BLOCO 7 — INDICADOR DE EDIÇÃO NA TABELA
  // ══════════════════════════════════════════════════════
  await section('BLOCO 7 — INDICADOR DE EDIÇÃO');

  // After saving, the edited row should have the blue dot
  await page.waitForTimeout(500);
  const editDot = await page.locator('#mainTbody tr:first-child span[title="Editado manualmente"]').count();
  result('Indicador de edição manual aparece na tabela', editDot > 0, `${editDot} pontos encontrados`);

  // ══════════════════════════════════════════════════════
  // BLOCO 8 — ABA HISTÓRICO
  // ══════════════════════════════════════════════════════
  await section('BLOCO 8 — ABA HISTÓRICO');

  await page.click('button[data-tab="historico"]');
  await page.waitForTimeout(600);

  const histTab = await page.locator('#tab-historico').isVisible();
  result('Aba Histórico ativa', histTab, '');

  const histEntries = await page.locator('#histTimeline .tl-entry').count();
  result('Entradas no histórico após edição', histEntries >= 1, `${histEntries} entradas`);

  // Check audit entry content
  if (histEntries > 0) {
    const firstEntry = await page.locator('#histTimeline .tl-entry').first().innerText();
    result('Entrada contém nome do usuário', firstEntry.includes('Testador Automático'), firstEntry.slice(0, 100));
    result('Entrada contém ação "Edição"', firstEntry.toUpperCase().includes('EDIÇÃO') || firstEntry.toUpperCase().includes('EDICAO'), firstEntry.slice(0, 80));
    const hasObs = firstEntry.includes('Observação de teste automatizado');
    result('Observação registrada no histórico', hasObs, firstEntry.slice(0, 150));
  }

  // History filters
  const histFilialOpts = await page.locator('#histFilial option').count();
  result('Select filial no histórico populado', histFilialOpts > 1, `${histFilialOpts} opções`);

  const histUserOpts = await page.locator('#histUser option').count();
  result('Select usuário no histórico populado', histUserOpts > 1, `${histUserOpts} opções`);

  // Filter by user
  await page.selectOption('#histUser', 'Testador Automático');
  await page.waitForTimeout(300);
  const filteredEntries = await page.locator('#histTimeline .tl-entry').count();
  result('Filtro por usuário no histórico funciona', filteredEntries >= 1, `${filteredEntries} entradas`);
  await page.selectOption('#histUser', '');

  // CSV export button
  const auditCsvBtn = await page.locator('button:has-text("CSV Auditoria")').isVisible();
  result('Botão exportar CSV auditoria visível', auditCsvBtn, '');

  // ══════════════════════════════════════════════════════
  // BLOCO 9 — HISTÓRICO POR LICENÇA
  // ══════════════════════════════════════════════════════
  await section('BLOCO 9 — HISTÓRICO POR LICENÇA');

  // Go back to Visão Geral
  await page.click('button[data-tab="geral"]');
  await page.waitForTimeout(400);

  // Click Hist. button on first row
  await page.locator('#mainTbody tr:first-child button:has-text("Hist.")').click();
  await page.waitForTimeout(500);

  const licHistVisible = await page.locator('#licHistOverlay').isVisible();
  result('Modal histórico da licença abre', licHistVisible, '');

  if (licHistVisible) {
    const licHistTitle = await page.locator('#licHistTitle').innerText();
    result('Título do modal de histórico presente', licHistTitle.length > 3, licHistTitle);

    const licHistEntries = await page.locator('#licHistBody .tl-entry').count();
    result('Entradas no histórico da licença', licHistEntries >= 1, `${licHistEntries} entradas`);

    // Status info in modal
    const licStatusBox = await page.locator('#licHistBody .badge').first().isVisible().catch(() => false);
    result('Badge de status no modal de licença', licStatusBox, '');

    // CSV button
    const licCsvBtn = await page.locator('#licHistCsvBtn').isVisible();
    result('Botão CSV no modal de licença', licCsvBtn, '');

    await page.click('#licHistOverlay button:has-text("Fechar")');
    await page.waitForTimeout(300);
    result('Modal histórico fecha corretamente', !(await page.locator('#licHistOverlay').isVisible()), '');
  }

  // ══════════════════════════════════════════════════════
  // BLOCO 10 — ABA RELATÓRIOS
  // ══════════════════════════════════════════════════════
  await section('BLOCO 10 — ABA RELATÓRIOS');

  await page.click('button[data-tab="relatorios"]');
  await page.waitForTimeout(600);

  const relTab = await page.locator('#tab-relatorios').isVisible();
  result('Aba Relatórios ativa', relTab, '');

  // Auditor dashboard
  const auditorTable = await page.locator('.aud-table').first();
  result('Tabela de auditores renderizada', await auditorTable.isVisible(), '');

  const auditorRows = await page.locator('.aud-table tbody tr').count();
  result('Linhas de auditores presentes', auditorRows > 0, `${auditorRows} auditores`);

  // Conformidade progress bars
  const progressBars = await page.locator('.progress-bar').count();
  result('Barras de progresso de conformidade', progressBars > 0, `${progressBars} barras`);

  // Auditor detail button
  const detailBtn = page.locator('.aud-table tbody tr:first-child button:has-text("Ver detalhes")');
  result('Botão "Ver detalhes" no painel de auditores', await detailBtn.isVisible(), '');
  await detailBtn.click();
  await page.waitForTimeout(600);

  const audDetailVisible = await page.locator('#audDetailOverlay').isVisible();
  result('Modal detalhes do auditor abre', audDetailVisible, '');

  if (audDetailVisible) {
    const audDetailTitle = await page.locator('#audDetailTitle').innerText();
    result('Título do modal de auditor presente', audDetailTitle.length > 3, audDetailTitle);

    const audDetailRegs = await page.locator('#audDetailBody .aud-table').isVisible().catch(() => false);
    result('Tabela de registros no modal do auditor', audDetailRegs, '');

    const audCsvBtn = await page.locator('#audDetailOverlay button:has-text("CSV Auditor")').isVisible().catch(() => false);
    result('Botão CSV Auditor no modal', audCsvBtn, '');

    await page.click('#audDetailOverlay button:has-text("Fechar")');
    await page.waitForTimeout(300);
    result('Modal auditor fecha', !(await page.locator('#audDetailOverlay').isVisible()), '');
  }

  // Export buttons
  const rptAudSel = await page.locator('#rptAuditorSel').isVisible();
  result('Select auditor no módulo exportação', rptAudSel, '');
  const rptFilSel = await page.locator('#rptFilialSel').isVisible();
  result('Select filial no módulo exportação', rptFilSel, '');
  const rptExportBtn = await page.locator('button:has-text("Exportar CSV")').isVisible();
  result('Botão Exportar CSV nos relatórios', rptExportBtn, '');

  // ══════════════════════════════════════════════════════
  // BLOCO 11 — ABA IMPORTAR PLANILHA
  // ══════════════════════════════════════════════════════
  await section('BLOCO 11 — IMPORTAR PLANILHA');

  await page.click('button[data-tab="importar"]');
  await page.waitForTimeout(400);

  const importTab = await page.locator('#tab-importar').isVisible();
  result('Aba Importar ativa', importTab, '');

  const dropZone = await page.locator('#dropZone').isVisible();
  result('Zona de drop visível', dropZone, '');

  const importFileBtn = await page.locator('#importFileInput').count();
  result('Input de arquivo presente', importFileBtn > 0, '');

  // Test with invalid JSON
  const tempInvalidJson = '/tmp/test_invalid.json';
  fs.writeFileSync(tempInvalidJson, 'NOT JSON {{{');
  await page.locator('#importFileInput').setInputFiles(tempInvalidJson);
  await page.waitForTimeout(600);
  const errorMsg = await page.locator('#importStatus').innerText();
  result('Erro exibido para JSON inválido', errorMsg.length > 0 && (errorMsg.toLowerCase().includes('erro') || errorMsg.toLowerCase().includes('inválid') || errorMsg.toLowerCase().includes('invalid') || errorMsg.toLowerCase().includes('json')), errorMsg.slice(0, 100));

  // Test with valid JSON — read DADOS directly from HTML source (DADOS is a single long line)
  let parsedData = null;
  try {
    const htmlSrc = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf-8');
    const m = htmlSrc.match(/const DADOS = (\{.+\});/);
    parsedData = JSON.parse(m ? m[1] : 'null') || { geradoEm: '2026-12-01', filiais: [], registros: [], catalogo: [] };
  } catch(e) { parsedData = { geradoEm: '2026-12-01', filiais: [{ id: 1, sigla: 'TST', nome: 'Teste', regional: 'REG1', auditor: 'Auditor Teste' }], registros: [{ id: 'test-1', filialId: 1, docKey: 'TESTE', docNome: 'DOCUMENTO TESTE', obrigatorio: true, status: 'Aprovado', dataVencimento: '2027-01-01', sintetico: false, justificativa: '' }], catalogo: [{ key: 'TESTE', nome: 'Documento Teste' }] }; }
  // Modify one status to trigger diff
  if (parsedData.registros && parsedData.registros.length > 0) {
    const origStatus = parsedData.registros[0].status;
    parsedData.registros[0].status = origStatus === 'Aprovado' ? 'Vencido' : 'Aprovado';
    parsedData.geradoEm = '2026-12-01';
  }
  const tempValidJson = '/tmp/test_valid.json';
  fs.writeFileSync(tempValidJson, JSON.stringify(parsedData));
  await page.locator('#importFileInput').setInputFiles(tempValidJson);
  await page.waitForTimeout(800);

  const diffOverlayVisible = await page.locator('#importDiffOverlay').isVisible();
  result('Modal de diff abre com JSON válido', diffOverlayVisible, '');

  if (diffOverlayVisible) {
    const diffBody = await page.locator('#importDiffBody').innerText();
    result('Diff body tem conteúdo', diffBody.length > 50, diffBody.slice(0, 100));

    const hasDiffEntry = await page.locator('.diff-entry').count() > 0;
    result('Entradas de diff exibidas', hasDiffEntry, '');

    // Check summary line
    const hasSummary = diffBody.includes('registros') || diffBody.includes('filiais');
    result('Resumo da importação presente', hasSummary, '');

    // Cancel
    await page.click('#importDiffOverlay button:has-text("Cancelar")');
    await page.waitForTimeout(300);
    result('Cancelar importação fecha modal', !(await page.locator('#importDiffOverlay').isVisible()), '');

    // Re-open and confirm
    await page.locator('#importFileInput').setInputFiles(tempValidJson);
    await page.waitForTimeout(800);
    if (await page.locator('#importDiffOverlay').isVisible()) {
      await page.click('#importConfirmBtn');
      await page.waitForTimeout(800);
      result('Confirmação de importação fecha modal', !(await page.locator('#importDiffOverlay').isVisible()), '');

      // Verify audit log updated
      await page.click('button[data-tab="historico"]');
      await page.waitForTimeout(500);
      const histAfterImport = await page.locator('#histTimeline .tl-entry').count();
      result('Importação gera entrada no histórico', histAfterImport > histEntries, `${histEntries} → ${histAfterImport} entradas`);

      // Import history card
      await page.click('button[data-tab="importar"]');
      await page.waitForTimeout(400);
      const importHistCard = await page.locator('#importHistCard').isVisible();
      result('Card histórico de importações visível', importHistCard, '');
    }
  }

  // ══════════════════════════════════════════════════════
  // BLOCO 12 — TEMA CLARO/ESCURO
  // ══════════════════════════════════════════════════════
  await section('BLOCO 12 — TEMA CLARO / ESCURO');

  const themeBtn = page.locator('#themeToggleBtn');
  result('Botão de tema presente', await themeBtn.isVisible(), '');

  const themeBefore = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await themeBtn.click();
  await page.waitForTimeout(200);
  const themeAfter = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  result('Clique alterna o tema', themeBefore !== themeAfter, `${themeBefore} → ${themeAfter}`);

  await themeBtn.click();
  await page.waitForTimeout(200);
  const themeRestored = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  result('Segundo clique restaura tema', themeRestored === themeBefore, `${themeRestored}`);

  // ══════════════════════════════════════════════════════
  // BLOCO 13 — FILTRO AUDITOR NO HEADER
  // ══════════════════════════════════════════════════════
  await section('BLOCO 13 — FILTRO AUDITOR NO HEADER');

  await page.click('button[data-tab="geral"]');
  await page.waitForTimeout(400);

  const hAudSel = page.locator('#filterAuditorHeader');
  result('Filtro auditor no header existe', await hAudSel.isVisible(), '');

  const hAudOpts = await hAudSel.locator('option').count();
  result('Opções de auditor no header populadas', hAudOpts > 1, `${hAudOpts} opções`);

  await hAudSel.selectOption({ index: 1 });
  await page.waitForTimeout(400);
  const rowsHAud = await page.locator('#mainTbody tr').count();
  result('Filtro auditor header filtra tabela', rowsHAud < rowCount, `${rowsHAud} linhas`);
  await hAudSel.selectOption('');
  await page.waitForTimeout(200);

  // ══════════════════════════════════════════════════════
  // BLOCO 14 — LABELS / URGÊNCIA
  // ══════════════════════════════════════════════════════
  await section('BLOCO 14 — LABELS E URGÊNCIA');

  // Verify urgency labels in table
  const urgTexts = await page.locator('.urg').allInnerTexts();
  const allUrgLabels = urgTexts.join(' ');
  const urgUpper = allUrgLabels.toUpperCase();
  result('"Sem Protocolo" label correto', urgUpper.includes('SEM PROTOCOLO') || (await page.evaluate(() => Object.values(window.URGENCY_META).some(m => m.label === 'Sem Protocolo'))), '');
  result('"Aberto/Pendente" label correto', urgUpper.includes('ABERTO/PENDENTE') || (await page.evaluate(() => Object.values(window.URGENCY_META).some(m => m.label === 'Aberto/Pendente'))), '');
  result('"Em Andamento" NÃO aparece mais', !urgUpper.includes('EM ANDAMENTO'), '');
  result('"Não Iniciado" NÃO aparece nos badges', !urgUpper.includes('NÃO INICIADO') && !urgUpper.includes('NAO INICIADO'), '');

  // URGENCY_META correct values
  const urgMeta = await page.evaluate(() => window.URGENCY_META);
  result('URGENCY_META.sem_protocolo.label = "Sem Protocolo"', urgMeta?.sem_protocolo?.label === 'Sem Protocolo', urgMeta?.sem_protocolo?.label);
  result('URGENCY_META.pendente.label = "Aberto/Pendente"', urgMeta?.pendente?.label === 'Aberto/Pendente', urgMeta?.pendente?.label);

  // ══════════════════════════════════════════════════════
  // BLOCO 15 — ESTADO LOCAL (localStorage)
  // ══════════════════════════════════════════════════════
  await section('BLOCO 15 — PERSISTÊNCIA LOCAL');

  const localOverrides = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('painelLic_overrides') || 'null'); } catch { return null; }
  });
  result('overrides salvo no localStorage', localOverrides !== null && typeof localOverrides === 'object', JSON.stringify(localOverrides).slice(0, 80));

  const localAuditLog = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('painelLic_auditLog') || 'null'); } catch { return null; }
  });
  result('auditLog salvo no localStorage', Array.isArray(localAuditLog) && localAuditLog.length > 0, `${localAuditLog?.length} entradas`);

  const userName = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('painelLic_userName') || 'null'); } catch { return null; }
  });
  result('Nome do usuário persistido', userName === 'Testador Automático', userName);

  // ══════════════════════════════════════════════════════
  // BLOCO 16 — RELOAD PERSISTE ESTADO
  // ══════════════════════════════════════════════════════
  await section('BLOCO 16 — RELOAD PERSISTE ESTADO');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await waitReady(page).catch(() => {});

  const rowsAfterReload = await page.locator('#mainTbody tr').count();
  result('Tabela carrega após reload', rowsAfterReload > 0, `${rowsAfterReload} linhas`);

  // Audit log should still have entries
  const histEntriesAfterReload = await page.evaluate(() => window.auditLog?.length || 0);
  result('Audit log persistido após reload', histEntriesAfterReload > 0, `${histEntriesAfterReload} entradas`);

  // Check overrides persisted
  const ovAfterReload = await page.evaluate(() => Object.keys(window.overrides || {}).length);
  result('Overrides persistidos após reload', ovAfterReload > 0, `${ovAfterReload} overrides`);

  // ══════════════════════════════════════════════════════
  // BLOCO 17 — MODAL EDIÇÃO: CANCELAR
  // ══════════════════════════════════════════════════════
  await section('BLOCO 17 — MODAL EDIÇÃO: CANCELAR SEM SALVAR');

  await page.locator('#mainTbody tr:nth-child(2) button:has-text("Editar")').click();
  await page.waitForTimeout(400);
  result('Modal abre na 2a linha', await page.locator('#editOverlay').isVisible(), '');

  await page.fill('#popObs', 'Esta observação não deve ser salva');
  await page.click('button:has-text("Cancelar")');
  await page.waitForTimeout(300);
  result('Modal fecha ao cancelar', !(await page.locator('#editOverlay').isVisible()), '');

  // Check that no new audit entry was created
  const histCountBeforeCancel = await page.evaluate(() => window.auditLog?.length || 0);
  result('Cancelar não cria entrada de auditoria', histCountBeforeCancel === histEntriesAfterReload, `${histCountBeforeCancel} vs ${histEntriesAfterReload}`);

  // Also test X button
  await page.locator('#mainTbody tr:first-child button:has-text("Editar")').click();
  await page.waitForTimeout(400);
  await page.click('#editOverlay button:has-text("✕")');
  await page.waitForTimeout(300);
  result('Botão ✕ fecha modal', !(await page.locator('#editOverlay').isVisible()), '');

  // ══════════════════════════════════════════════════════
  // BLOCO 18 — FOOTER E CONTADORES
  // ══════════════════════════════════════════════════════
  await section('BLOCO 18 — FOOTER E CONTADORES');

  const tableFooter = await page.locator('#tableFooter').innerText();
  result('Footer da tabela exibe contagem', tableFooter.includes('registros'), tableFooter);

  // Apply a filter and check footer updates
  await page.selectOption('#filterObrig', '1');
  await page.waitForTimeout(300);
  const footerFiltered = await page.locator('#tableFooter').innerText();
  result('Footer atualiza com filtro aplicado', footerFiltered !== tableFooter, footerFiltered);
  await page.selectOption('#filterObrig', '');

  // ══════════════════════════════════════════════════════
  // BLOCO 19 — MÚLTIPLAS EDIÇÕES (SIMULAÇÃO 1 MÊS)
  // ══════════════════════════════════════════════════════
  await section('BLOCO 19 — SIMULAÇÃO DE 30 DIAS DE USO');

  // Get all rows to edit
  const totalRows = await page.locator('#mainTbody tr').count();
  const rowsToEdit = Math.min(totalRows, 12); // Edit 12 records

  const auditsBefore = await page.evaluate(() => window.auditLog?.length || 0);

  const nomes = ['Adriano Silva', 'Maria Costa', 'João Souza', 'Fernanda Lima', 'Carlos Rocha'];
  const observacoes = [
    'Documentação enviada para análise do fiscal. Aguardando retorno em 5 dias.',
    'Reunião com o responsável da filial. Pendente assinatura do gerente regional.',
    'Licença renovada junto ao órgão emissor. Em trâmite de aprovação.',
    'Notificação de vencimento enviada ao auditor. Prazo: 30 dias.',
    'Fiscal fez levantamento in-loco. Resultado esperado na próxima semana.',
    'Documentos entregues no cartório. Protocolo emitido.',
    'Aguardando posicionamento do departamento jurídico.',
    'Cobrança realizada ao auditor. Sem retorno até o momento.',
    'Visita técnica agendada para próxima semana.',
    'Aprovação parcial recebida. Pendente complemento de documentação.',
    'Regularização em andamento. Prazo acordado: 45 dias.',
    'Novo contato com o órgão emissor. Prazo estimado: 15 dias úteis.',
  ];

  let editedCount = 0;
  for (let i = 0; i < rowsToEdit; i++) {
    try {
      const editBtn = page.locator(`#mainTbody tr:nth-child(${i + 1}) button:has-text("Editar")`);
      if (!(await editBtn.isVisible())) continue;
      await editBtn.click();
      await page.waitForTimeout(300);

      if (!(await page.locator('#editOverlay').isVisible())) continue;

      const nome = nomes[i % nomes.length];
      const obs = observacoes[i % observacoes.length];
      const daysOffset = (i + 1) * 30;
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + daysOffset);
      const dateStr = futureDate.toISOString().split('T')[0];

      await page.fill('#popNome', nome);
      await page.fill('#popObs', obs);
      await page.fill('#popJust', `Situação: ${obs.slice(0, 50)}`);
      await page.fill('#popData', dateStr);
      await page.click('#editSaveBtn');
      await page.waitForTimeout(300);
      editedCount++;
    } catch (e) {
      // skip this row
    }
  }

  const auditsAfter = await page.evaluate(() => window.auditLog?.length || 0);
  result(`${editedCount} registros editados com sucesso`, editedCount === rowsToEdit, `${editedCount}/${rowsToEdit}`);
  result('Auditoria acumulou todas as entradas', auditsAfter >= auditsBefore + editedCount, `${auditsBefore} → ${auditsAfter} (+${auditsAfter - auditsBefore})`);

  // Verify all different users appear
  const usersInLog = await page.evaluate(() => [...new Set((window.auditLog || []).map(e => e.userName))]);
  result('Múltiplos usuários no log', usersInLog.length >= 2, usersInLog.join(', '));

  // Check history tab shows all
  await page.click('button[data-tab="historico"]');
  await page.waitForTimeout(600);
  const totalHistEntries = await page.locator('#histTimeline .tl-entry').count();
  result('Histórico exibe todas as movimentações', totalHistEntries >= editedCount, `${totalHistEntries} entradas visíveis`);

  // Verify Adriano's entries
  await page.selectOption('#histUser', 'Adriano Silva');
  await page.waitForTimeout(300);
  const adrianoEntries = await page.locator('#histTimeline .tl-entry').count();
  result('Filtro por Adriano Silva funciona', adrianoEntries > 0, `${adrianoEntries} entradas`);
  await page.selectOption('#histUser', '');

  // ══════════════════════════════════════════════════════
  // BLOCO 20 — DADOS DO AUDIT LOG (INTEGRIDADE)
  // ══════════════════════════════════════════════════════
  await section('BLOCO 20 — INTEGRIDADE DO AUDIT LOG');

  const auditData = await page.evaluate(() => window.auditLog || []);
  result('Audit log é um array', Array.isArray(auditData), '');
  result('Cada entrada tem id', auditData.every(e => e.id), `${auditData.filter(e => e.id).length}/${auditData.length}`);
  result('Cada entrada tem ts (timestamp)', auditData.every(e => e.ts), `${auditData.filter(e => e.ts).length}/${auditData.length}`);
  result('Cada entrada tem date e time', auditData.every(e => e.date && e.time), `${auditData.filter(e => e.date && e.time).length}/${auditData.length}`);
  result('Cada entrada tem ip field', auditData.every(e => e.ip !== undefined), `${auditData.filter(e => e.ip !== undefined).length}/${auditData.length}`);
  result('Cada entrada tem action', auditData.every(e => e.action), `${auditData.filter(e => e.action).length}/${auditData.length}`);
  result('Cada entrada tem regId', auditData.every(e => e.regId), `${auditData.filter(e => e.regId).length}/${auditData.length}`);
  result('IDs únicos no log', new Set(auditData.map(e => e.id)).size === auditData.length, `${new Set(auditData.map(e => e.id)).size} únicos / ${auditData.length} total`);
  result('Timestamps em ordem ISO', auditData.length < 2 || auditData.every((e, i) => i === 0 || e.ts >= auditData[i - 1].ts), '');

  // ══════════════════════════════════════════════════════
  // BLOCO 21 — RELATÓRIOS APÓS SIMULAÇÃO
  // ══════════════════════════════════════════════════════
  await section('BLOCO 21 — RELATÓRIOS PÓS-SIMULAÇÃO');

  await page.click('button[data-tab="relatorios"]');
  await page.waitForTimeout(600);

  const audTableRows = await page.locator('.aud-table tbody tr').count();
  result('Dashboard de auditores atualizado', audTableRows > 0, `${audTableRows} auditores`);

  // Each auditor row should show conformidade
  const conformBars = await page.locator('.progress-bar-fill').count();
  result('Barras de conformidade presentes', conformBars > 0, `${conformBars} barras`);

  // Open first auditor detail
  await page.locator('.aud-table tbody tr:first-child button:has-text("Ver detalhes")').click();
  await page.waitForTimeout(600);
  const audDetailOpen = await page.locator('#audDetailOverlay').isVisible();
  result('Modal detalhes auditor abre pós-simulação', audDetailOpen, '');
  if (audDetailOpen) {
    const audBodyText = await page.locator('#audDetailBody').innerText();
    result('Modal auditor tem dados de registros', audBodyText.length > 100, `${audBodyText.length} chars`);
    await page.click('#audDetailOverlay button:has-text("Fechar")');
    await page.waitForTimeout(300);
  }

  // ══════════════════════════════════════════════════════
  // BLOCO 22 — RESPONSIVIDADE E CSS
  // ══════════════════════════════════════════════════════
  await section('BLOCO 22 — RESPONSIVIDADE');

  // Must be on geral tab so kpi-bar and table are visible
  await page.click('button[data-tab="geral"]');
  await page.waitForTimeout(300);

  await page.setViewportSize({ width: 375, height: 812 }); // iPhone
  await page.waitForTimeout(400);
  const headerVisible375 = await page.locator('.header').isVisible();
  result('Header visível em 375px', headerVisible375, '');
  const kpiVisible375 = await page.locator('.kpi-bar').isVisible();
  result('KPI bar visível em 375px', kpiVisible375, '');

  await page.setViewportSize({ width: 768, height: 1024 }); // iPad
  await page.waitForTimeout(300);
  const tabsVisible768 = await page.locator('.tabs-nav').isVisible();
  result('Tabs visíveis em 768px', tabsVisible768, '');

  await page.setViewportSize({ width: 1440, height: 900 }); // Desktop
  await page.click('button[data-tab="geral"]');
  await page.waitForTimeout(300);
  const tableVisible1440 = await page.locator('#mainTable').isVisible();
  result('Tabela visível em 1440px', tableVisible1440, '');

  // ══════════════════════════════════════════════════════
  // BLOCO 23 — NAVEGAÇÃO ENTRE ABAS
  // ══════════════════════════════════════════════════════
  await section('BLOCO 23 — NAVEGAÇÃO ENTRE ABAS');

  const tabs = ['geral', 'historico', 'relatorios', 'importar'];
  for (const tab of tabs) {
    await page.click(`button[data-tab="${tab}"]`);
    await page.waitForTimeout(300);
    const panelVisible = await page.locator(`#tab-${tab}`).isVisible();
    const btnActive = await page.locator(`button[data-tab="${tab}"]`).evaluate(el => el.classList.contains('active'));
    result(`Aba ${tab}: painel visível + botão ativo`, panelVisible && btnActive, '');
  }

  // Return to geral
  await page.click('button[data-tab="geral"]');
  await page.waitForTimeout(300);
  const otherTabsHidden = await Promise.all(['historico', 'relatorios', 'importar'].map(
    t => page.locator(`#tab-${t}`).isVisible()
  ));
  result('Outras abas ficam ocultas', otherTabsHidden.every(v => !v), '');

  // ══════════════════════════════════════════════════════
  // BLOCO 24 — OVERLAY CLICK-OUTSIDE FECHA MODAL
  // ══════════════════════════════════════════════════════
  await section('BLOCO 24 — CLICK-OUTSIDE FECHA MODAIS');

  await page.click('button[data-tab="geral"]');
  await page.waitForTimeout(300);
  await page.locator('#mainTbody tr:first-child button:has-text("Editar")').click();
  await page.waitForTimeout(400);
  // Click on overlay background
  await page.locator('#editOverlay').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(300);
  result('Click no overlay fecha modal de edição', !(await page.locator('#editOverlay').isVisible()), '');

  await page.locator('#mainTbody tr:first-child button:has-text("Hist.")').click();
  await page.waitForTimeout(400);
  await page.locator('#licHistOverlay').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(300);
  result('Click no overlay fecha modal de histórico', !(await page.locator('#licHistOverlay').isVisible()), '');

  // ══════════════════════════════════════════════════════
  // BLOCO 25 — FUNÇÕES JS EXPOSTAS
  // ══════════════════════════════════════════════════════
  await section('BLOCO 25 — FUNÇÕES JS EXPOSTAS NO GLOBAL');

  const fns = ['renderAll', 'sortDerived', 'deriveRegistro', 'computeUrgencia',
    'appendAuditEntry', 'openEditModal', 'saveEdit', 'openLicHist',
    'openAudDetail', 'renderReports', 'renderHistory', 'exportCsvAll',
    'exportAuditCsv', 'queueSync', 'pushOverrides', 'loadOverrides',
    'toggleTheme', 'clearFilters', 'confirmImport', 'showImportDiff'];

  const fnsPresent = await page.evaluate((fns) => {
    return fns.map(fn => ({ fn, ok: typeof window[fn] === 'function' }));
  }, fns);

  const allFns = fnsPresent.every(r => r.ok);
  const missingFns = fnsPresent.filter(r => !r.ok).map(r => r.fn);
  result('Todas as funções JS exportadas globalmente', allFns, missingFns.join(', ') || 'ok');

  // ─── SUMÁRIO FINAL ──────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTADO FINAL: ${passed} PASSOU | ${failed} FALHOU | ${warnings} AVISO(S)${' '.repeat(Math.max(0, 20 - String(passed + failed + warnings).length))}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  if (failed > 0) {
    console.log('FALHAS:');
    RESULTS.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ✘ ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
    });
    console.log('');
  }

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    passed, failed, warnings,
    results: RESULTS
  };
  fs.writeFileSync('/tmp/test-report.json', JSON.stringify(report, null, 2));
  console.log('Relatório salvo em /tmp/test-report.json');

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();

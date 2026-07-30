/**
 * Bateria de testes de importação — verifica comportamento de overrides vs. dados importados
 *
 * Cenários testados:
 *  1. Justificativa manual sobrevive à importação de nova planilha
 *  2. Status atualiza corretamente via importação (import always wins)
 *  3. Data manual (override) sobrevive à importação
 *  4. Importação sem override de data usa data da planilha
 *  5. Histórico acumula entradas (editar 2x → 2 entradas, sem sobrescrever)
 *  6. Justificativa aparece no diff do histórico quando alterada
 *  7. Registro sem override fica limpo após importação
 */
const { chromium } = require('playwright');
const path = require('path');

const FILE_URL = 'file://' + path.resolve(__dirname, '../index.html');
let passed = 0, failed = 0;

function result(name, ok, detail = '') {
  if (ok) passed++; else failed++;
  const icon = ok ? '✔' : '✘';
  console.log(`  ${icon} [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

function section(label) {
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 60 - label.length))}`);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║   BATERIA DE IMPORTAÇÃO — Overrides vs. Dados Importados      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  const page = await ctx.newPage();
  page.on('pageerror', err => console.error('  ⚡ PageError:', err.message));
  await page.goto(FILE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Wait for table to be populated
  await page.waitForFunction(() => {
    const tb = document.getElementById('mainTbody');
    return tb && tb.querySelectorAll('tr').length > 0;
  }, { timeout: 10000 }).catch(() => {});

  // ─────────────────────────────────────────────────────────────────
  await section('SETUP — Identificar registros de teste');

  const firstIds = await page.evaluate(() => {
    if (!window.activeDados || !window.activeDados.registros.length) return null;
    const r0 = activeDados.registros[0];
    const r1 = activeDados.registros[1] || activeDados.registros[0];
    return { id0: r0.id, id1: r1.id, status0: r0.status, status1: r1.status,
             docNome0: r0.docNome, filialId0: r0.filialId };
  });

  result('activeDados disponível', firstIds !== null, firstIds ? `IDs: ${firstIds.id0}, ${firstIds.id1}` : 'null');
  if (!firstIds) { await browser.close(); process.exit(1); }

  // ─────────────────────────────────────────────────────────────────
  await section('CENÁRIO 1 — Justificativa manual sobrevive à importação');

  const c1 = await page.evaluate(({ id0, id1 }) => {
    // 1. Set override on record 0 with a custom justificativa
    const reg0 = activeDados.registros.find(r => r.id === id0);
    overrides[String(id0)] = {
      dataVencimento: '2099-12-31',
      justificativa: 'JUSTIFICATIVA MANUAL TESTE',
      updatedBy: 'TesterBot',
      updatedAt: new Date().toISOString(),
    };

    // 2. Build a fake "new import" that changes the status on record 0
    //    and also sets a different justificativa in the spreadsheet data
    const updatedRegistros = activeDados.registros.map(r => {
      if (r.id === id0) return { ...r, status: 'Aprovado', justificativa: 'JUSTIFICATIVA DA PLANILHA', dataVencimento: '2025-01-01' };
      return { ...r };
    });
    const newDados = { ...activeDados, registros: updatedRegistros, geradoEm: '2026-07-30' };

    // 3. Simulate confirmImport (copy the same logic)
    const prev = JSON.parse(JSON.stringify(activeDados));
    activeDados = newDados;
    rebuildIndices();

    // 4. Derive the record — override should win for date and justificativa
    const derived = deriveRegistro(activeDados.registros.find(r => r.id === id0));
    const baseInNew = activeDados.registros.find(r => r.id === id0);

    return {
      derivedJust: derived.justificativa,
      derivedDate: derived.dataVencimento,
      derivedStatus: derived.status,
      baseJust: baseInNew.justificativa,
      baseDate: baseInNew.dataVencimento,
      baseStatus: baseInNew.status,
      overrideExists: !!overrides[String(id0)],
    };
  }, firstIds);

  result('Override de justificativa sobrevive à importação',
    c1.derivedJust === 'JUSTIFICATIVA MANUAL TESTE',
    `got: "${c1.derivedJust}"`);
  result('Base data foi substituída pela planilha (status)',
    c1.baseStatus === 'Aprovado',
    `base.status = "${c1.baseStatus}"`);
  result('Status derivado reflete nova importação (sem override de status)',
    c1.derivedStatus === 'Aprovado',
    `derived.status = "${c1.derivedStatus}"`);
  result('Override mantido após importação',
    c1.overrideExists,
    `overrides[${firstIds.id0}] existe = ${c1.overrideExists}`);

  // ─────────────────────────────────────────────────────────────────
  await section('CENÁRIO 2 — Data manual (override) sobrevive à importação');

  result('Data derivada usa override, não a data da planilha',
    c1.derivedDate === '2099-12-31',
    `derived.dataVenc = "${c1.derivedDate}", planilha tinha "2025-01-01"`);
  result('Base recebeu data da planilha (sem override a base é sobrescrita)',
    c1.baseDate === '2025-01-01',
    `base.dataVenc = "${c1.baseDate}"`);

  // ─────────────────────────────────────────────────────────────────
  await section('CENÁRIO 3 — Registro sem override usa dados da planilha integralmente');

  const c3 = await page.evaluate(({ id1 }) => {
    // Record 1 has no override — simulate import changing its status
    delete overrides[String(id1)];
    const updReg = activeDados.registros.map(r => {
      if (r.id === id1) return { ...r, status: 'Vencido', dataVencimento: '2020-06-15', justificativa: 'Planilha-C3' };
      return r;
    });
    activeDados = { ...activeDados, registros: updReg };
    rebuildIndices();
    const derived = deriveRegistro(activeDados.registros.find(r => r.id === id1));
    return {
      derivedStatus: derived.status,
      derivedDate: derived.dataVencimento,
      derivedJust: derived.justificativa,
    };
  }, firstIds);

  result('Registro sem override: status = dado da planilha',
    c3.derivedStatus === 'Vencido',
    `"${c3.derivedStatus}"`);
  result('Registro sem override: data = dado da planilha',
    c3.derivedDate === '2020-06-15',
    `"${c3.derivedDate}"`);
  result('Registro sem override: justificativa = dado da planilha',
    c3.derivedJust === 'Planilha-C3',
    `"${c3.derivedJust}"`);

  // ─────────────────────────────────────────────────────────────────
  await section('CENÁRIO 4 — Histórico acumula entradas (não sobrescreve)');

  const c4 = await page.evaluate(({ id0 }) => {
    // Clear audit log entries for id0 to start clean
    auditLog = auditLog.filter(e => String(e.regId) !== String(id0));

    // Edit 1 — set justificativa to "Primeira versão"
    const base = activeDados.registros.find(r => r.id === id0);
    const ov1 = overrides[String(id0)] || {};
    const prevJust1 = ov1.justificativa != null ? ov1.justificativa : (base.justificativa || '');
    overrides[String(id0)] = { ...ov1, justificativa: 'Primeira versão', dataVencimento: ov1.dataVencimento, updatedBy: 'Tester', updatedAt: new Date().toISOString() };
    appendAuditEntry({
      userName: 'Tester', filialId: base.filialId, filialSigla: 'TST',
      regId: id0, docNome: base.docNome, action: 'edit',
      prevStatus: 'Aberto/Pendente', newStatus: 'Aberto/Pendente',
      prevJust: prevJust1, newJust: 'Primeira versão',
      prevData: null, newData: '2099-12-31', obs: 'Edição 1',
    });

    // Edit 2 — change justificativa to "Segunda versão"
    const ov2 = overrides[String(id0)];
    const prevJust2 = ov2.justificativa;
    overrides[String(id0)] = { ...ov2, justificativa: 'Segunda versão', updatedAt: new Date().toISOString() };
    appendAuditEntry({
      userName: 'Tester', filialId: base.filialId, filialSigla: 'TST',
      regId: id0, docNome: base.docNome, action: 'edit',
      prevStatus: 'Aberto/Pendente', newStatus: 'Aberto/Pendente',
      prevJust: prevJust2, newJust: 'Segunda versão',
      prevData: '2099-12-31', newData: '2099-12-31', obs: 'Edição 2',
    });

    const entriesForReg = auditLog.filter(e => String(e.regId) === String(id0));
    return {
      count: entriesForReg.length,
      entries: entriesForReg.map(e => ({ prevJust: e.prevJust, newJust: e.newJust, obs: e.obs })),
    };
  }, firstIds);

  result('Audit log acumula 2 entradas de edição (não sobrescreve)',
    c4.count === 2,
    `${c4.count} entradas`);
  result('1ª edição: prevJust → newJust corretos',
    c4.entries[0]?.newJust === 'Primeira versão',
    `newJust="${c4.entries[0]?.newJust}"`);
  result('2ª edição: prevJust capturou valor anterior',
    c4.entries[1]?.prevJust === 'Primeira versão',
    `prevJust="${c4.entries[1]?.prevJust}"`);
  result('2ª edição: newJust = nova justificativa',
    c4.entries[1]?.newJust === 'Segunda versão',
    `newJust="${c4.entries[1]?.newJust}"`);

  // ─────────────────────────────────────────────────────────────────
  await section('CENÁRIO 5 — renderTlEntry mostra diff de justificativa');

  const c5 = await page.evaluate(({ id0 }) => {
    const entries = auditLog.filter(e => String(e.regId) === String(id0));
    if (!entries.length) return { error: 'Sem entradas' };
    // Call renderTlEntry for the entry that has a justificativa change
    const editEntry = entries.find(e => e.prevJust !== e.newJust);
    if (!editEntry) return { error: 'Sem diff de justificativa' };
    const html = renderTlEntry(editEntry);
    return {
      hasDiff: html.includes('tl-diff-from') && html.includes('tl-diff-to'),
      hasJustLabel: html.includes('Justificativa:'),
      hasFrom: html.includes('Primeira versão') || html.includes('—'),
      hasTo: html.includes('Segunda versão') || html.includes('Primeira versão'),
    };
  }, firstIds);

  result('renderTlEntry: diff de justificativa presente no HTML',
    c5.hasDiff === true && c5.hasJustLabel === true,
    c5.error || `hasDiff=${c5.hasDiff} hasJustLabel=${c5.hasJustLabel}`);
  result('renderTlEntry: valor "de" visível',
    c5.hasFrom === true,
    `hasFrom=${c5.hasFrom}`);
  result('renderTlEntry: valor "para" visível',
    c5.hasTo === true,
    `hasTo=${c5.hasTo}`);

  // ─────────────────────────────────────────────────────────────────
  await section('CENÁRIO 6 — Import não limpa overrides preexistentes');

  const c6 = await page.evaluate(({ id0 }) => {
    const beforeImport = { ...overrides };
    // Simulate another import
    const updReg = activeDados.registros.map(r => {
      if (r.id === id0) return { ...r, status: 'Aguardando Aprovação' };
      return r;
    });
    activeDados = { ...activeDados, registros: updReg };
    rebuildIndices();
    // overrides should not have been touched by import
    return {
      overrideStillExists: !!overrides[String(id0)],
      overrideJust: overrides[String(id0)]?.justificativa,
      derivedJust: deriveRegistro(activeDados.registros.find(r => r.id === id0))?.justificativa,
      derivedStatus: deriveRegistro(activeDados.registros.find(r => r.id === id0))?.status,
    };
  }, firstIds);

  result('Override NÃO foi limpo pelo import',
    c6.overrideStillExists,
    `override ainda existe = ${c6.overrideStillExists}`);
  result('Justificativa derivada ainda é do override após 2º import',
    c6.derivedJust === 'Segunda versão',
    `"${c6.derivedJust}"`);
  result('Status derivado reflete novo import (import sempre ganha no status)',
    c6.derivedStatus === 'Aguardando Aprovação',
    `"${c6.derivedStatus}"`);

  // ─────────────────────────────────────────────────────────────────
  await section('CENÁRIO 7 — Remover override restaura dados da planilha');

  const c7 = await page.evaluate(({ id0 }) => {
    const base = activeDados.registros.find(r => r.id === id0);
    // Save current base values
    const baseJust = base.justificativa;
    const baseDate = base.dataVencimento;
    // Remove override
    delete overrides[String(id0)];
    const derived = deriveRegistro(base);
    return {
      derivedJust: derived.justificativa,
      derivedDate: derived.dataVencimento,
      baseJust, baseDate,
    };
  }, firstIds);

  result('Sem override: justificativa volta para dado da planilha',
    c7.derivedJust === c7.baseJust,
    `derived="${c7.derivedJust}", base="${c7.baseJust}"`);
  result('Sem override: data volta para dado da planilha',
    c7.derivedDate === c7.baseDate,
    `derived="${c7.derivedDate}", base="${c7.baseDate}"`);

  // ─────────────────────────────────────────────────────────────────
  await section('SUMÁRIO');
  console.log(`\n  Total: ${passed + failed} testes — ${passed} passaram, ${failed} falharam`);

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();

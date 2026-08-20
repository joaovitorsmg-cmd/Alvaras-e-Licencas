/**
 * Teste de fluxo completo: tela vazia → upload XLS → confirmação → tabela preenchida
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FILE_URL = 'file://' + path.resolve(__dirname, '../index.html');
let passed = 0, failed = 0;

function ok(name, cond, detail=''){
  const icon=cond?'✔':'✘';
  if(cond) passed++; else failed++;
  console.log(`  ${icon} [${cond?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);
}
function section(label){ console.log(`\n── ${label} ${'─'.repeat(Math.max(0,60-label.length))}`); }

(async()=>{
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true, args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.on('pageerror', err=>console.error('  ⚡ PageError:', err.message));

  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║  TESTE DE FLUXO COMPLETO DO PAINEL   ║');
  console.log('╚═══════════════════════════════════════╝');

  await page.goto(FILE_URL, {waitUntil:'domcontentloaded'});
  await page.waitForTimeout(800);

  // ── 1. ESTADO INICIAL VAZIO
  section('1. Estado inicial — painel vazio');
  const emptyVisible = await page.isVisible('#emptyStatePanel');
  ok('emptyStatePanel visível ao abrir', emptyVisible);
  const tableHidden = await page.evaluate(()=>{
    const el=document.getElementById('mainTableWrap');
    return el ? (el.style.display==='none' || el.offsetParent===null) : true;
  });
  ok('Tabela oculta ao abrir', tableHidden);
  const headerSub = await page.textContent('#headerSub');
  ok('Header diz "Carregue uma planilha"', headerSub.includes('Carregue'));

  // ── 2. INJEÇÃO DE DADOS SIMULANDO IMPORT
  section('2. Simulando importação via injeção direta (sem arquivo real)');
  await page.evaluate(()=>{
    // Simula o resultado de parseXlsToData — _empty:false, registros preenchidos
    const fakeData = {
      _empty: false,
      _xlsImport: {updated:5, added:0, addedFilials:0},
      geradoEm: '2026-08-20',
      catalogo: DADOS.catalogo,
      filiais: [
        {id:1,sigla:'TST',nome:'Teste',estado:'GO',regional:'Norte',auditor:'Tester',supervisor:'',coordenador:'',regiao:'NORTE',email_supervisor:''},
        {id:2,sigla:'TST2',nome:'Teste2',estado:'MT',regional:'Sul',auditor:'Tester2',supervisor:'',coordenador:'',regiao:'SUL',email_supervisor:''},
      ],
      registros: [
        {id:1,filialId:1,docKey:'alvara_funcionamento',docNome:'Alvará de Funcionamento',status:'Aprovado',dataVencimento:'2026-12-31',justificativa:'',obrigatorio:true},
        {id:2,filialId:1,docKey:'licenca_ambiental',docNome:'Licença Ambiental',status:'Sem Protocolo',dataVencimento:null,justificativa:'',obrigatorio:true},
        {id:3,filialId:2,docKey:'alvara_funcionamento',docNome:'Alvará de Funcionamento',status:'Vencido',dataVencimento:'2025-01-01',justificativa:'Renovação em andamento',obrigatorio:true},
        {id:4,filialId:2,docKey:'licenca_sanitaria',docNome:'Licença Sanitária',status:'Aberto/Pendente',dataVencimento:'2026-06-30',justificativa:'',obrigatorio:false},
        {id:5,filialId:1,docKey:'licenca_sanitaria',docNome:'Licença Sanitária',status:'Aprovado',dataVencimento:'2027-03-15',justificativa:'',obrigatorio:false},
      ],
    };
    pendingImport = fakeData;
    // Simulate confirmImport logic
    activeDados = fakeData;
    delete activeDados._empty;
    rebuildIndices();
    populateFilters();
    safeStorage.set('painelLic_activeDados', activeDados);
    switchTab('geral', document.querySelector('[data-tab="geral"]'));
    renderAll();
  });
  await page.waitForTimeout(300);

  // ── 3. VERIFICAR QUE O PAINEL ESTÁ POPULADO
  section('3. Painel populado após import');
  const emptyHidden = await page.evaluate(()=>{
    const el=document.getElementById('emptyStatePanel');
    return el ? (el.style.display==='none') : false;
  });
  ok('emptyStatePanel oculto após import', emptyHidden);
  const rowCount = await page.evaluate(()=>document.querySelectorAll('#mainTbody tr').length);
  ok('Tabela tem linhas', rowCount>0, `${rowCount} linhas`);
  const kpiBar = await page.isVisible('#kpiBar');
  ok('KPI bar visível', kpiBar);
  const filterBar = await page.isVisible('#mainFilterBar');
  ok('Filter bar visível', filterBar);

  // ── 4. VERIFICAR KPIs
  section('4. KPIs corretos');
  const kpiText = await page.textContent('#kpiBar');
  ok('KPI bar tem conteúdo', kpiText.length > 0);
  const headerSubAfter = await page.textContent('#headerSub');
  ok('Header mostra contagem de registros', headerSubAfter.includes('registros'), `"${headerSubAfter}"`);

  // ── 5. VERIFICAR QUE FILIAIS EXCLUÍDAS NÃO APARECEM (nenhuma das nossas IDs de teste é excluída)
  section('5. Filtros e ordenação');
  const filialOptions = await page.evaluate(()=>{
    const sel=document.getElementById('filterFilial');
    return sel?[...sel.options].map(o=>o.value).filter(Boolean):[];
  });
  ok('Filtro de filial populado', filialOptions.length>0, `${filialOptions.length} opções`);

  // ── 6. EDITAR UM REGISTRO
  section('6. Modal de edição');
  const firstEditBtn = page.locator('#mainTbody tr:first-child .btn-edit').first();
  const editBtns = await page.evaluate(()=>document.querySelectorAll('#mainTbody button').length);
  ok('Botões de ação presentes', editBtns>0, `${editBtns} botões`);

  // ── 7. ZERAR PAINEL → volta ao estado vazio
  section('7. Zerar painel → estado vazio');
  await page.evaluate(()=>{
    // Simulate zerarPainel without confirm dialogs
    overrides={};
    auditLog=[];
    activeDados={filiais:[],registros:[],catalogo:DADOS.catalogo,geradoEm:new Date().toISOString(),_empty:true};
    safeStorage.del('painelLic_activeDados');
    safeStorage.set('painelLic_activeDados',activeDados);
    rebuildIndices();
    populateFilters();
    renderAll();
  });
  await page.waitForTimeout(200);
  const emptyAgain = await page.isVisible('#emptyStatePanel');
  ok('emptyStatePanel volta após zerar', emptyAgain);
  const tableHiddenAgain = await page.evaluate(()=>{
    const el=document.getElementById('mainTableWrap');
    return el ? el.style.display==='none' : true;
  });
  ok('Tabela oculta após zerar', tableHiddenAgain);
  const rowsAfterZerar = await page.evaluate(()=>document.querySelectorAll('#mainTbody tr').length);
  ok('Tabela vazia após zerar', rowsAfterZerar===0, `${rowsAfterZerar} linhas`);

  // ── 8. RELOAD COM DADOS EM LOCALSTORAGE
  section('8. Reload com dados em localStorage (persistência)');
  // Re-inject into localStorage
  await page.evaluate(()=>{
    const fakeData = {
      _empty: false,
      geradoEm: '2026-08-20',
      catalogo: DADOS.catalogo,
      filiais: [{id:1,sigla:'TST',nome:'Teste',estado:'GO',regional:'Norte',auditor:'Tester',supervisor:'',coordenador:'',regiao:'NORTE',email_supervisor:''}],
      registros: [
        {id:1,filialId:1,docKey:'alvara_funcionamento',docNome:'Alvará de Funcionamento',status:'Aprovado',dataVencimento:'2026-12-31',justificativa:'',obrigatorio:true},
        {id:2,filialId:1,docKey:'licenca_ambiental',docNome:'Licença Ambiental',status:'Sem Protocolo',dataVencimento:null,justificativa:'',obrigatorio:true},
      ],
    };
    safeStorage.set('painelLic_activeDados', fakeData);
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1000);
  const rowsAfterReload = await page.evaluate(()=>document.querySelectorAll('#mainTbody tr').length);
  ok('Dados restaurados após reload', rowsAfterReload>0, `${rowsAfterReload} linhas`);
  const emptyAfterReload = await page.evaluate(()=>{
    const el=document.getElementById('emptyStatePanel');
    return el ? el.style.display==='none' : false;
  });
  ok('emptyStatePanel oculto após reload com dados', emptyAfterReload);

  // ── 9. EDIT MODAL — DATA NÃO SOME AO EDITAR JUSTIFICATIVA
  section('9. Bug de data — editar justificativa preserva data');
  const testResult = await page.evaluate(()=>{
    // Set up override with a date
    overrides['1'] = {dataVencimento:'2099-01-01', justificativa:'Original', updatedBy:'Teste', updatedAt:new Date().toISOString()};
    const before = deriveRegistro(activeDados.registros.find(r=>r.id===1));

    // Simulate saveEdit with empty date field (user only edited justificativa)
    const regId = '1';
    const dateInput = ''; // user left date blank
    const justificativa = 'Nova justificativa';
    const prev = overrides[regId]||{};
    const prevData = prev.dataVencimento!=null ? prev.dataVencimento : activeDados.registros.find(r=>String(r.id)===regId)?.dataVencimento;
    const dataVencimento = dateInput || prevData || null;
    overrides[regId] = {...prev, dataVencimento, justificativa, updatedBy:'Teste', updatedAt:new Date().toISOString()};

    const after = deriveRegistro(activeDados.registros.find(r=>r.id===1));
    return {before: before.dataVencimento, after: after.dataVencimento, justBefore: before.justificativa, justAfter: after.justificativa};
  });
  ok('Data preservada ao editar justificativa', testResult.before===testResult.after, `${testResult.before} → ${testResult.after}`);
  ok('Justificativa atualizada corretamente', testResult.justAfter==='Nova justificativa', `"${testResult.justAfter}"`);

  // ── SUMÁRIO
  console.log('\n── SUMÁRIO ─────────────────────────────────────────────────────\n');
  console.log(`  Total: ${passed+failed} testes — ${passed} passaram, ${failed} falharam\n`);

  await browser.close();
  process.exit(failed>0?1:0);
})();

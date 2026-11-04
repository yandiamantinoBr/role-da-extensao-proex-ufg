/**
 * PROEX UFG · Conector da planilha (Google Apps Script)
 *
 * Mantém esta planilha ligada ao portal de gestão: exporta todas as tabelas do
 * formato portátil, importa as edições permitidas (colunas editáveis e aba
 * Operações) com controle de versão e copia fotos e termos para uma pasta privada
 * do Drive. Funciona com qualquer conta Google (pessoal ou institucional) e com o
 * portal hospedado em qualquer endereço.
 *
 * Instalação (uma vez, por um responsável institucional do portal):
 *   1. Na planilha: Extensões → Apps Script. Apague o conteúdo e cole este arquivo.
 *   2. Salve, volte à planilha e recarregue a página. Aparece o menu "PROEX".
 *   3. PROEX → Conectar ao portal… Informe o endereço do portal e a chave de
 *      sincronização gerada em Configurações → Dados e sincronização.
 *   4. PROEX → Sincronizar agora. Depois, se quiser, ative a sincronização automática.
 *
 * Segurança: a chave fica nas propriedades do usuário que conectou (outros editores
 * não conseguem lê-la), mas quem pode editar a planilha também pode editar este
 * script. Compartilhe a planilha com permissão de edição somente com pessoas que
 * também poderiam administrar o portal; para o restante da equipe, use "leitor".
 *
 * Regras que este script respeita (as mesmas do portal):
 *   - Valores são gravados como texto literal (sem fórmulas).
 *   - Saldos, permissões, resultados e histórico nunca são importados da planilha.
 *   - Uma edição só é aplicada se a linha não mudou no portal desde a última
 *     sincronização; caso contrário vira conflito, registrado na aba Conflitos
 *     com o conteúdo desejado.
 *   - Linhas apagadas na planilha não apagam nada no portal.
 */

var CONTROL = 'Controle', OPERATIONS = 'Operações', CONFLICTS = 'Conflitos';
var OPERATIONS_HEADER = ['changeKey', 'action', 'input', 'status', 'entityId', 'code'];
var CONFLICTS_HEADER = ['id', 'entity_type', 'entity_id', 'expected_version', 'actual_version', 'reason', 'status', 'created_at'];
var BASELINE_NOTE = 'portable-v1: original confirmado; preserve até nova leitura de retorno.';
var EDITABLE_COLOR = '#FFF4D6', SYSTEM_COLOR = '#ECECEC';
var ATTACHMENTS_FOLDER = 'PROEX · Anexos privados';
var CONNECTOR_VERSION = '2026-11-04.1';
// O Apps Script encerra execuções após 6 minutos; paramos com folga.
var SYNC_BUDGET_MS = 5 * 60 * 1000, ATTACHMENTS_BUDGET_MS = 4 * 60 * 1000;
var ISOLATE_CODES = ['sync_operation_changed', 'sync_invalid_change_key', 'sync_invalid_action', 'sync_system_field', 'sync_invalid_row', 'sync_invalid_version', 'sync_change_limit', 'sync_input_limit'];
// Estes serviços preservam o valor atual quando um campo é omitido na edição.
// Campanhas exigem a linha completa; tabelas novas precisam da mesma conferência.
var PARTIAL_METADATA_TABLES = ['project_types', 'projects', 'project_links', 'project_schedule_items', 'calls', 'material_categories', 'items', 'organizational_units'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('PROEX')
    .addItem('Cadastrar material', 'cadastrarMaterial')
    .addItem('Sincronizar agora', 'sincronizarAgora')
    .addItem('Copiar fotos e termos para o Drive', 'copiarAnexos')
    .addSeparator()
    .addItem('Ativar sincronização automática', 'ativarAutomatico')
    .addItem('Desativar sincronização automática', 'desativarAutomatico')
    .addSeparator()
    .addItem('Preparar pasta privada de backups', 'prepararPastaBackup')
    .addItem('Ativar backup diário', 'ativarBackupDiario')
    .addItem('Desativar backup diário', 'desativarBackupDiario')
    .addItem('Executar backup completo agora', 'backupCompletoAgora')
    .addItem('Ver estado do backup', 'verEstadoBackup')
    .addItem('Liberar recibo de backup pendente…', 'liberarReciboBackup')
    .addSeparator()
    .addItem('Conectar ao portal…', 'conectar')
    .addItem('Ver estado da conexão', 'verEstado')
    .addToUi();
}

// ---------------------------------------------------------------- conexão

function propriedades_() { return PropertiesService.getUserProperties(); }

function conectar() {
  var ui = SpreadsheetApp.getUi();
  var url = ui.prompt('Endereço do portal', 'Exemplo: https://proex-gestao.vercel.app', ui.ButtonSet.OK_CANCEL);
  if (url.getSelectedButton() !== ui.Button.OK) return;
  var token = ui.prompt('Chave de sincronização', 'Gere em Configurações → Dados e sincronização. Ela começa com pxs_ e aparece uma única vez.', ui.ButtonSet.OK_CANCEL);
  if (token.getSelectedButton() !== ui.Button.OK) return;
  var portal = url.getResponseText().trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+$/.test(portal) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(portal)) throw new Error('Informe somente a origem HTTPS do portal, sem caminho.');
  var key = token.getResponseText().trim();
  if (!/^pxs_[A-Za-z0-9_-]{40,60}$/.test(key)) throw new Error('A chave informada não tem o formato esperado (pxs_…).');
  var props = propriedades_();
  props.setProperties({ PORTAL_URL: portal, SYNC_TOKEN: key });
  PropertiesService.getScriptProperties().deleteProperty('SYNC_TOKEN'); // versões antigas guardavam aqui

  // Pasta de anexos no "Meu Drive" de quem conecta, nunca dentro de pastas compartilhadas.
  var folder = pastaFilha_(DriveApp.getRootFolder(), ATTACHMENTS_FOLDER);
  conferirPastaPrivada_(folder);
  var ss = SpreadsheetApp.getActive(), parents = DriveApp.getFileById(ss.getId()).getParents();
  var parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  chamar_('proex_sync_configure', { spreadsheetId: ss.getId(), folderId: parent.getId(), attachmentsFolderId: folder.getId() });
  props.setProperty('ATTACHMENTS_FOLDER_ID', folder.getId());
  ui.alert('Planilha conectada ao portal. Use PROEX → Sincronizar agora para a primeira carga.\n\nLembre-se: quem pode editar esta planilha também pode editar o script. Dê permissão de edição somente a responsáveis do portal.');
}

function verEstado() {
  var status = chamar_('proex_sync_describe', {});
  var last = (status.runs || [])[0], triggers = estadoGatilhos_(), attachments = lerEstadoAnexos_();
  var linhas = [
    'Conector: ' + CONNECTOR_VERSION,
    'Portal: ' + propriedades_().getProperty('PORTAL_URL'),
    'Tabelas no formato portátil: ' + status.schemas.tables.length,
    'Última execução: ' + (last ? last.status + ' em ' + (last.finished_at || last.started_at) + ' (' + (last.exported_count || 0) + ' linhas)' : 'nenhuma'),
    'Conflitos abertos: ' + (status.conflicts || []).length,
    'Gatilho de dados nesta conta: ' + triggers.data,
    'Gatilho de anexos nesta conta: ' + triggers.attachments,
    'Última cópia de anexos: ' + (attachments ? resumoAnexos_(attachments) + ' em ' + attachments.at : 'não registrada nesta conta'),
    'Gatilhos de outras contas não são visíveis aqui. Um gatilho instalado não comprova uma execução concluída.',
  ];
  SpreadsheetApp.getUi().alert(linhas.join('\n'));
}
function estadoGatilhos_() {
  var handlers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  function count(handler) { var n = handlers.filter(function (h) { return h === handler; }).length; return n ? n + ' instalado(s); confira o histórico de execuções' : 'não instalado'; }
  return { data: count('sincronizarAutomatico'), attachments: count('copiarAnexosAutomatico'), backup: count('backupDiarioAutomatico') };
}

function ativarAutomatico() {
  // Não instale uma rotina que já começa sem autenticação ou configuração.
  chamar_('proex_sync_describe', {});
  if (!propriedades_().getProperty('ATTACHMENTS_FOLDER_ID')) throw new Error('Conecte a planilha e a pasta privada antes de ativar os gatilhos.');
  desativarAutomatico();
  ScriptApp.newTrigger('sincronizarAutomatico').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('copiarAnexosAutomatico').timeBased().everyHours(1).create();
  SpreadsheetApp.getActive().toast('Dados a cada 30 minutos; fotos e termos a cada hora.', 'PROEX');
}
function desativarAutomatico() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['sincronizarAutomatico', 'copiarAnexosAutomatico'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
}
function sincronizarAutomatico() { sincronizar_(); }
function copiarAnexosAutomatico() { copiarAnexos_(); }
function sincronizarAgora() { SpreadsheetApp.getActive().toast(sincronizar_(), 'PROEX', 8); }
function copiarAnexos() { copiarAnexos_(); SpreadsheetApp.getActive().toast(resumoAnexos_(lerEstadoAnexos_()), 'PROEX', 8); }

// ---------------------------------------------------------------- cadastro de material

var CADASTRO_MATERIAL = 'CADASTRO_MATERIAL';
var TIPOS_MATERIAL = {
  gift: 'Brinde', equipment: 'Equipamento retornável',
  distribution: 'Distribuição institucional', consumption: 'Consumo interno',
};

function cadastrarMaterial() {
  var sidebar = HtmlService.createHtmlOutput(CADASTRO_MATERIAL_HTML).setTitle('Cadastrar material · PROEX');
  SpreadsheetApp.getUi().showSidebar(sidebar);
}

function conferirPlanilhaCadastroMaterial_() {
  var ss = SpreadsheetApp.getActive();
  var status = chamar_('proex_sync_describe', {});
  if (!ss || !status.configuration || status.configuration.spreadsheetId !== ss.getId()) {
    throw new Error('Abra a planilha mestre configurada no Portal PROEX para cadastrar materiais.');
  }
}

function rascunhoMaterial_() {
  return JSON.parse(propriedades_().getProperty(CADASTRO_MATERIAL) || 'null');
}

function chaveMaterial_() { return { changeKey: 'material-' + Utilities.getUuid() }; }

function carregarCadastroMaterial() {
  conferirPlanilhaCadastroMaterial_();
  var projects = lerTabela_('projects').filter(function (row) { return row.status === 'active'; }).map(function (row) {
    return { id: row.id, name: row.name + (row.short_name ? ' · ' + row.short_name : '') };
  });
  projects.sort(function (a, b) { return a.name.localeCompare(b.name, 'pt-BR'); });
  var active = new Set(projects.map(function (project) { return project.id; }));
  var categories = lerTabela_('material_categories').filter(function (row) {
    return row.status === 'active' && active.has(row.project_id) && Object.prototype.hasOwnProperty.call(TIPOS_MATERIAL, row.core_kind);
  }).map(function (row) {
    return { id: row.id, projectId: row.project_id, kind: row.core_kind, label: row.label };
  });
  categories.sort(function (a, b) { return a.label.localeCompare(b.label, 'pt-BR'); });
  return { projects: projects, categories: categories, kinds: TIPOS_MATERIAL, draft: rascunhoMaterial_() || chaveMaterial_() };
}

function normalizarCadastroMaterial_(form) {
  function campo(value, label, limit, required) {
    if (value === undefined || value === null) value = '';
    if (typeof value !== 'string' || value.trim().length > limit || (required && !value.trim())) {
      throw new Error('Confira ' + label + ' (até ' + limit + ' caracteres).');
    }
    return value.trim();
  }
  if (!form || typeof form.changeKey !== 'string' || !/^material-[a-f0-9-]{36}$/i.test(form.changeKey)) {
    throw new Error('Reabra o formulário pelo menu PROEX para iniciar o cadastro.');
  }
  if (typeof form.category !== 'string' || !Object.prototype.hasOwnProperty.call(TIPOS_MATERIAL, form.category)) {
    throw new Error('Escolha um tipo de material.');
  }
  var alert = form.lowStock === undefined ? 0 : form.lowStock;
  if (typeof alert !== 'number' || !Number.isSafeInteger(alert) || alert < 0 || alert > (form.category === 'equipment' ? 1 : 1000000)) {
    throw new Error(form.category === 'equipment' ? 'O alerta de um equipamento individual pode ser zero ou uma unidade.' : 'Informe um alerta inteiro entre zero e 1.000.000.');
  }
  return {
    projectId: campo(form.projectId, 'o projeto', 200, true),
    category: form.category,
    categoryId: campo(form.categoryId, 'a categoria', 100, false) || null,
    name: campo(form.name, 'o nome', 200, true),
    unit: campo(form.unit, 'a unidade', 40, true),
    lowStock: alert,
    description: campo(form.description, 'a descrição', 2000, false),
    assetCode: campo(form.assetCode, 'o código patrimonial', 100, false),
  };
}

function mensagemCadastroMaterial_(code) {
  switch (code) {
    case 'category_mismatch':
    case 'category_not_found': return 'A categoria mudou ou deixou de estar disponível. Atualize o formulário e selecione outra categoria.';
    case 'project_not_found': return 'O projeto deixou de estar disponível. Atualize o formulário para escolher um projeto.';
    case 'equipment_unit': return 'O alerta de um equipamento individual pode ser zero ou uma unidade.';
    case 'invalid_quantity':
    case 'invalid_input': return 'Confira os campos e os limites informados no formulário.';
    default: return 'O Portal recusou o cadastro. Confira o projeto, os campos e se o patrimônio já existe.';
  }
}

function salvarCadastroMaterial(form) {
  var input = normalizarCadastroMaterial_(form);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1500)) throw new Error('A planilha está sincronizando ou registrando uma operação. Aguarde e tente novamente.');
  try {
    conferirPlanilhaCadastroMaterial_();
    var props = propriedades_(), draft = rascunhoMaterial_();
    var serialized = JSON.stringify(input);
    if (draft) {
      var sameInput = draft.result ? draft.fingerprint === hex_(serialized) : JSON.stringify(draft.input) === serialized;
      if (draft.changeKey !== form.changeKey || !sameInput) {
        throw new Error('Há um cadastro para retomar nesta conta. Reabra o formulário para recuperar os dados e a confirmação.');
      }
      if (draft.result) return draft.result;
    } else {
      if (!lerTabela_('projects').some(function (row) { return row.id === input.projectId && row.status === 'active'; })) {
        return { status: 'rejected', changeKey: chaveMaterial_().changeKey, message: mensagemCadastroMaterial_('project_not_found') };
      }
      if (input.assetCode && lerTabela_('items').some(function (row) { return row.project_id === input.projectId && row.asset_code === input.assetCode; })) {
        return { status: 'rejected', changeKey: chaveMaterial_().changeKey, message: 'Já existe um material com esse patrimônio neste projeto. Confira a identificação.' };
      }
      draft = { changeKey: form.changeKey, input: input };
      props.setProperty(CADASTRO_MATERIAL, JSON.stringify(draft));
    }
    var response;
    try {
      response = chamar_('proex_sync_apply', {
        connectionId: 'google-sheets',
        changes: [{ changeKey: draft.changeKey, action: 'item.create', input: draft.input }],
      });
    } catch (error) {
      if (['sync_token_required', 'sync_token_invalid', 'sync_forbidden', 'unauthenticated'].indexOf(error.code) >= 0) throw error;
      throw new Error('Não foi possível confirmar o envio. Reabra o formulário e retome o mesmo cadastro.');
    }
    var result = response && Array.isArray(response.results) && response.results[0];
    if (!result || result.changeKey !== draft.changeKey) throw new Error('A confirmação ficou pendente. Retome o mesmo cadastro para conferir.');
    if (result.status === 'rejected' || result.status === 'conflict') {
      props.deleteProperty(CADASTRO_MATERIAL);
      return { status: 'rejected', changeKey: chaveMaterial_().changeKey, message: mensagemCadastroMaterial_(result.code) };
    }
    if (result.status !== 'applied' && result.status !== 'duplicate') throw new Error('A confirmação ficou pendente. Retome o mesmo cadastro para conferir.');
    var receipt = {
      status: result.status,
      entityId: result.entityId || null,
      message: 'Material cadastrado no Portal com saldo zero. Para vê-lo na planilha, use PROEX → Sincronizar agora.',
    };
    props.setProperty(CADASTRO_MATERIAL, JSON.stringify({ changeKey: draft.changeKey, fingerprint: hex_(serialized), result: receipt }));
    return receipt;
  } finally {
    lock.releaseLock();
  }
}

function novoCadastroMaterial(changeKey) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1500)) throw new Error('A planilha está ocupada. Aguarde e tente novamente.');
  try {
    var draft = rascunhoMaterial_();
    if (!draft || draft.changeKey !== changeKey || !draft.result) {
      throw new Error('Reabra o formulário para consultar o cadastro em andamento.');
    }
    propriedades_().deleteProperty(CADASTRO_MATERIAL);
    return chaveMaterial_();
  } finally {
    lock.releaseLock();
  }
}

var CADASTRO_MATERIAL_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { font: 14px/1.5 system-ui, sans-serif; color: #292333; }
  body { margin: 16px; }
  h1 { color: #3b1753; font-size: 20px; line-height: 1.2; margin: 0 0 8px; }
  p { margin: 0 0 14px; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  label { display: grid; gap: 4px; margin: 0 0 12px; font-weight: 600; }
  input, select, textarea, button { box-sizing: border-box; min-height: 44px; width: 100%; font: inherit; }
  input, select, textarea { border: 1px solid #8d7e99; border-radius: 8px; padding: 8px; background: #fff; color: inherit; }
  textarea { min-height: 72px; resize: vertical; }
  :focus-visible { outline: 3px solid #54216c; outline-offset: 2px; }
  button { background: #3b1753; color: #fff; border: 0; border-radius: 8px; padding: 8px; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: .65; cursor: default; }
  small { color: #5d5168; font-weight: 400; }
  #erro { color: #981f33; }
</style>
</head>
<body>
<h1>Cadastrar material</h1>
<p>O cadastro começa com saldo zero. Registre entradas pelo fluxo de movimentações.</p>
<p id="estado" role="status">Carregando projetos e categorias…</p>
<p id="erro" role="alert" hidden></p>
<form id="material" hidden>
  <fieldset id="campos">
    <label>Projeto <select name="projectId" required></select></label>
    <label>Tipo de material <select name="category" required></select></label>
    <label>Categoria do projeto <select name="categoryId"></select><small>Opcional. Mostra as categorias ativas do tipo selecionado.</small></label>
    <label>Nome <input name="name" type="text" maxlength="200" required></label>
    <label>Unidade de medida <input name="unit" type="text" list="unidades" maxlength="40" placeholder="Ex.: unidade ou kit" required></label>
    <datalist id="unidades">
      <option value="unidade"><option value="kit"><option value="par"><option value="pacote"><option value="caixa">
      <option value="kg"><option value="g"><option value="L"><option value="mL"><option value="m">
    </datalist>
    <label>Alerta de estoque <input name="lowStock" type="number" min="0" max="1000000" step="1" inputmode="numeric" value="0"></label>
    <label>Identificação patrimonial <input name="assetCode" type="text" maxlength="100"></label>
    <label>Descrição <textarea name="description" maxlength="2000"></textarea><small>Registre características úteis do material.</small></label>
  </fieldset>
  <button id="enviar" type="submit">Cadastrar no Portal</button>
  <button id="novo" type="button" hidden>Cadastrar outro material</button>
</form>
<script>
(function () {
  var form = document.getElementById('material'), fields = document.getElementById('campos');
  var status = document.getElementById('estado'), error = document.getElementById('erro');
  var submit = document.getElementById('enviar'), next = document.getElementById('novo');
  var project = form.elements.projectId, kind = form.elements.category, category = form.elements.categoryId;
  var model, busy = false;
  function showError(message) { error.textContent = message || ''; error.hidden = !message; }
  function setBusy(value) { busy = value; submit.disabled = value; next.disabled = value; }
  function selectOptions(select, rows, placeholder, selected) {
    select.replaceChildren(new Option(placeholder, ''));
    rows.forEach(function (row) { select.add(new Option(row.label, row.id)); });
    if (selected && !rows.some(function (row) { return row.id === selected; })) select.add(new Option('Seleção do cadastro em andamento', selected));
    select.value = selected || '';
  }
  function categories(selected) {
    selectOptions(category, model.categories.filter(function (row) {
      return row.projectId === project.value && row.kind === kind.value;
    }), 'Sem categoria específica', selected);
    form.elements.lowStock.max = kind.value === 'equipment' ? '1' : '1000000';
  }
  function displayDraft(draft) {
    model.draft = draft;
    var input = draft.input;
    var confirmed = Boolean(draft.result);
    if (input) {
      selectOptions(project, model.projects.map(function (p) { return { id: p.id, label: p.name }; }), 'Selecione um projeto', input.projectId);
      kind.value = input.category;
      categories(input.categoryId);
      ['name', 'unit', 'lowStock', 'assetCode', 'description'].forEach(function (key) { form.elements[key].value = input[key]; });
    }
    fields.disabled = Boolean(input) || confirmed;
    fields.hidden = confirmed;
    submit.hidden = confirmed;
    submit.textContent = input ? 'Retomar cadastro' : 'Cadastrar no Portal';
    next.hidden = !confirmed;
    status.textContent = confirmed ? draft.result.message : input ? 'Há um cadastro aguardando confirmação. Retome com os mesmos dados.' : '';
  }
  function start() {
    google.script.run.withSuccessHandler(function (data) {
      model = data;
      if (!data.projects.length && !data.draft.input && !data.draft.result) {
        status.textContent = 'Nenhum projeto ativo está disponível. Cadastre ou ative um projeto no Portal.';
        return;
      }
      selectOptions(project, data.projects.map(function (p) { return { id: p.id, label: p.name }; }), 'Selecione um projeto', data.projects.length === 1 ? data.projects[0].id : '');
      selectOptions(kind, Object.keys(data.kinds).map(function (key) { return { id: key, label: data.kinds[key] }; }), 'Selecione um tipo', '');
      categories();
      form.hidden = false;
      displayDraft(data.draft);
    }).withFailureHandler(function (problem) {
      status.textContent = '';
      showError(problem.message || 'Não foi possível carregar o formulário.');
    }).carregarCadastroMaterial();
  }
  project.addEventListener('change', function () { categories(); });
  kind.addEventListener('change', function () { categories(); });
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy || !model || model.draft.result) return;
    var input = model.draft.input || {
      projectId: project.value, category: kind.value, categoryId: category.value,
      name: form.elements.name.value, unit: form.elements.unit.value,
      lowStock: Number(form.elements.lowStock.value || 0), assetCode: form.elements.assetCode.value,
      description: form.elements.description.value,
    };
    setBusy(true);
    fields.disabled = true;
    status.textContent = 'Confirmando no Portal…';
    showError('');
    google.script.run.withSuccessHandler(function (result) {
      setBusy(false);
      if (result.status === 'rejected') {
        displayDraft({ changeKey: result.changeKey });
        showError(result.message);
        return;
      }
      displayDraft({ changeKey: model.draft.changeKey, input: input, result: result });
      next.focus();
    }).withFailureHandler(function (problem) {
      setBusy(false);
      fields.disabled = Boolean(model.draft.input);
      status.textContent = '';
      showError(problem.message || 'Não foi possível confirmar. Reabra o formulário para retomar o cadastro.');
    }).salvarCadastroMaterial(Object.assign({ changeKey: model.draft.changeKey }, input));
  });
  next.addEventListener('click', function () {
    if (busy) return;
    setBusy(true);
    showError('');
    google.script.run.withSuccessHandler(function (draft) {
      form.reset();
      selectOptions(project, model.projects.map(function (p) { return { id: p.id, label: p.name }; }), 'Selecione um projeto', model.projects.length === 1 ? model.projects[0].id : '');
      categories();
      setBusy(false);
      displayDraft(draft);
      project.focus();
    }).withFailureHandler(function (problem) {
      setBusy(false);
      showError(problem.message || 'Não foi possível iniciar outro cadastro.');
    }).novoCadastroMaterial(model.draft.changeKey);
  });
  start();
}());
</script>
</body>
</html>`;

// ---------------------------------------------------------------- sincronização

function sincronizar_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return 'Outra sincronização já está em andamento.';
  var started = Date.now();
  try {
    var ss = SpreadsheetApp.getActive();
    var status = chamar_('proex_sync_describe', {});
    if (!ss || !status.configuration || status.configuration.spreadsheetId !== ss.getId()) {
      throw new Error('Abra a planilha mestre configurada no Portal PROEX para sincronizar.');
    }
    var schemas = status.schemas.tables;
    var run = chamar_('proex_sync_run_start', { requestId: Utilities.getUuid(), spreadsheetId: ss.getId() });
    var outcome = 'completed', exported = 0, verified = 0, applied = 0, conflicts = [];
    try {
      garantirAbasDeControle_(ss);
      var control = lerControle_(ss);

      // 1. Edições nas colunas editáveis, comparadas com a base da última sincronização.
      var edits = coletarEdicoes_(ss, schemas, control.baselines);
      conflicts = conflicts.concat(edits.problems);
      // 2. Operações digitadas (criações e movimentos permitidos pelo portal).
      var ops = coletarOperacoes_(ss);
      var results = aplicar_(edits.changes.concat(ops.changes), run.id);
      Object.keys(results).forEach(function (k) { if (results[k].status === 'applied') applied++; });
      edits.changes.forEach(function (change) {
        var r = results[change.changeKey];
        if (r && (r.status === 'conflict' || r.status === 'rejected')) conflicts.push(conflito_(r.conflictId || change.changeKey, change.table, change.id, change.expectedVersion, '', (r.code || r.status) + ' · conteúdo desejado: ' + JSON.stringify(change.fields)));
      });
      conflicts = conflicts.concat(gravarRetornoOperacoes_(ss, ops.rows, results));

      // 3. Exportação tabela por tabela; a base de cada tabela é gravada logo após sua releitura.
      for (var i = 0; i < schemas.length; i++) {
        var schema = schemas[i];
        if (Date.now() - started > SYNC_BUDGET_MS) { outcome = 'failed'; break; }
        var rows = lerTabela_(schema.table);
        if (Date.now() - started > SYNC_BUDGET_MS) { outcome = 'failed'; break; }
        // A leitura do portal pode levar várias chamadas HTTP. Confira a planilha
        // depois delas, imediatamente antes da escrita, preservando edições novas.
        if (Object.prototype.hasOwnProperty.call(edits.snapshots, schema.table) && alteradaDuranteSync_(ss, schema, edits.snapshots[schema.table])) {
          conflicts.push(conflito_('', schema.table, '', '', '', 'A aba foi editada durante a sincronização e não foi sobrescrita. As edições serão lidas na próxima execução.'));
          continue;
        }
        escreverTabela_(ss, schema, rows);
        exported += rows.length;
        if (!conferirTabela_(ss, schema, rows)) continue;
        verified++;
        if (schema.mode === 'metadata') {
          control.replace(schema.table, rows.map(function (row) { return ['baseline:' + schema.table + ':' + row._rowKey, JSON.stringify(row), BASELINE_NOTE]; }));
          control.save(verified, schemas.length, 'running');
        }
      }
      registrarConflitos_(ss, conflicts);
      if (outcome === 'completed' && verified !== schemas.length) outcome = conflicts.length ? 'conflict' : 'failed';
      else if (outcome === 'completed' && conflicts.length) outcome = 'conflict';
      control.save(verified, schemas.length, outcome);
    } catch (error) {
      outcome = 'failed';
      if (control) { try { control.save(verified, schemas.length, outcome); } catch (_saveError) { /* preserve o erro original */ } }
      throw error;
    } finally {
      chamar_('proex_sync_run_finish', { id: run.id, status: outcome, exportedCount: exported, readbackVerified: verified === schemas.length, tablesVerified: verified });
    }
    return outcome === 'completed'
      ? 'Sincronizado: ' + exported + ' linhas exportadas, ' + applied + ' alteração(ões) aplicada(s).'
      : outcome === 'conflict' ? 'Sincronizado com ' + conflicts.length + ' conflito(s). Veja a aba Conflitos.'
      : 'Sincronização interrompida (tempo ou conferência). As bases já conferidas foram preservadas; a próxima execução relê as tabelas desde o início.';
  } finally {
    lock.releaseLock();
  }
}

/** Envia em lotes de 25; se um lote for recusado por uma linha, reenvia linha a linha. */
function aplicar_(changes, runId) {
  var results = Object.create(null);
  for (var i = 0; i < changes.length; i += 25) {
    var batch = changes.slice(i, i + 25), response;
    try {
      response = chamar_('proex_sync_apply', { connectionId: 'google-sheets', runId: runId, changes: batch });
      response.results.forEach(function (r) { results[r.changeKey] = r; });
    } catch (error) {
      if (!isolavel_(error)) throw error;
      if (batch.length === 1) {
        results[batch[0].changeKey] = { changeKey: batch[0].changeKey, status: 'rejected', code: error.code };
        continue;
      }
      batch.forEach(function (change) {
        try {
          chamar_('proex_sync_apply', { connectionId: 'google-sheets', runId: runId, changes: [change] }).results.forEach(function (r) { results[r.changeKey] = r; });
        } catch (single) {
          if (!isolavel_(single)) throw single;
          results[change.changeKey] = { changeKey: change.changeKey, status: 'rejected', code: single.code };
        }
      });
    }
  }
  return results;
}
function isolavel_(error) { return error && ISOLATE_CODES.indexOf(error.code) >= 0; }

function lerTabela_(table) {
  for (var attempt = 0; attempt < 3; attempt++) {
    var rows = [], after = null, digest = null, restarted = false;
    do {
      var args = { table: table, limit: 100 };
      if (after) args.after = after;
      if (digest) args.expectedDigest = digest;
      var page;
      try { page = chamar_('proex_sync_read', args); }
      catch (e) { if (e.code === 'sync_snapshot_changed' || e.code === 'sync_invalid_cursor') { restarted = true; break; } throw e; }
      digest = page.digest;
      rows = rows.concat(page.rows);
      after = page.nextCursor;
    } while (after);
    if (!restarted) return rows;
  }
  throw new Error('A tabela ' + table + ' mudou durante a leitura. Tente novamente.');
}

function coletarEdicoes_(ss, schemas, baselines) {
  var changes = [], problems = [], snapshots = {};
  schemas.filter(function (s) { return s.mode === 'metadata'; }).forEach(function (schema) {
    var sheet = ss.getSheetByName(schema.sheetName);
    if (!sheet) { snapshots[schema.table] = null; return; }
    var values = sheet.getLastRow() ? sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues() : [];
    snapshots[schema.table] = values;
    if (values.length < 2) return;
    var header = values[0], editable = schema.columns.filter(function (c) { return c.editable; });
    values.slice(1).forEach(function (cells) {
      if (cells.every(function (v) { return v === ''; })) return;
      var row = {};
      header.forEach(function (name, i) { row[name] = cells[i]; });
      var base = baselines[schema.table + ':' + row._rowKey];
      if (!base) { problems.push(conflito_('', schema.table, row.id || row._rowKey, '', '', 'Linha sem base de comparação (nova ou com chave alterada). Use a aba Operações para criar registros. Conteúdo: ' + JSON.stringify(row))); return; }
      var edited = {};
      editable.forEach(function (c) { if ((c.name in row) && texto_(row[c.name]) !== texto_(base[c.name])) edited[c.name] = row[c.name]; });
      if (texto_(row.id) !== texto_(base.id) || texto_(row.version) !== texto_(base.version) || row._rowHash !== base._rowHash) {
        problems.push(conflito_('', schema.table, base.id, base.version, row.version, 'Identificador, versão ou resumo alterados manualmente; nada foi importado. Edições na linha: ' + JSON.stringify(edited)));
        return;
      }
      if (!Object.keys(edited).length) return;
      // Envia os campos conhecidos; uma coluna nova ausente também na base não é
      // uma edição vazia. O serviço preserva seu valor atual até atualizar a aba.
      var fields = {}, invalid = [];
      editable.forEach(function (c) {
        if (!(c.name in row) && !(c.name in base)) {
          if (PARTIAL_METADATA_TABLES.indexOf(schema.table) < 0) invalid.push(c.name + ': coluna ausente; atualize a aba e reaplique a edição');
          return;
        }
        var source = (c.name in row) ? row[c.name] : texto_(base[c.name]);
        var converted = converter_(source, c);
        if (converted.error) invalid.push(c.name + ': ' + converted.error); else fields[c.name] = converted.value;
      });
      if (invalid.length) { problems.push(conflito_('', schema.table, base.id, base.version, '', 'Valor inválido (' + invalid.join('; ') + '). Conteúdo desejado: ' + JSON.stringify(edited))); return; }
      var key = 'm_' + hex_(schema.table + '\n' + base.id + '\n' + base.version + '\n' + JSON.stringify(fields)).slice(0, 48);
      changes.push({ changeKey: key, table: schema.table, id: base.id, expectedVersion: Number(base.version), fields: fields });
    });
  });
  return { changes: changes, problems: problems, snapshots: snapshots };
}

function alteradaDuranteSync_(ss, schema, before) {
  var sheet = ss.getSheetByName(schema.sheetName);
  if (!sheet) return before !== null;
  if (before === null) return true;
  var now = sheet.getLastRow() ? sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues() : [];
  return JSON.stringify(now) !== JSON.stringify(before);
}

function coletarOperacoes_(ss) {
  var sheet = ss.getSheetByName(OPERATIONS), rows = [], changes = [];
  if (sheet.getLastRow() < 2) return { rows: rows, changes: changes };
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, OPERATIONS_HEADER.length).getDisplayValues();
  var pendingCounts = Object.create(null);
  values.forEach(function (cells) {
    var key = cells[0].trim();
    if (key && !cells[3]) pendingCounts[key] = (pendingCounts[key] || 0) + 1;
  });
  values.forEach(function (cells) {
    var key = cells[0].trim(), action = cells[1].trim();
    if (!key || cells[3]) return; // linha vazia ou já processada
    var entry = { changeKey: key, action: action, rawInput: cells[2] };
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(key)) { entry.local = { status: 'rejected', code: 'invalid_change_key' }; rows.push(entry); return; }
    if (pendingCounts[key] > 1) { entry.local = { status: 'rejected', code: 'duplicate_pending_change_key' }; rows.push(entry); return; }
    try {
      var input = JSON.parse(cells[2] || '{}');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input');
      changes.push({ changeKey: key, action: action, input: input });
    } catch (e) { entry.local = { status: 'rejected', code: 'invalid_json' }; }
    rows.push(entry);
  });
  return { rows: rows, changes: changes };
}

/** O recibo pertence à chave e ao conteúdo enviado, mesmo quando as linhas mudam de posição. */
function gravarRetornoOperacoes_(ss, rows, results) {
  var conflicts = [];
  if (!rows.length) return conflicts;
  var sheet = ss.getSheetByName(OPERATIONS);
  var current = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 4).getDisplayValues();
  var used = Object.create(null);
  function pendingKey(cells, entry) { return !cells[3] && cells[0].trim() === entry.changeKey; }
  function sameInput(cells, entry) { return cells[1].trim() === entry.action && cells[2] === entry.rawInput; }
  rows.forEach(function (entry) {
    var r = entry.local || results[entry.changeKey];
    if (!r) return;
    var index = current.findIndex(function (cells, i) { return !used[i] && pendingKey(cells, entry) && sameInput(cells, entry); });
    if (index < 0) index = current.findIndex(function (cells, i) { return !used[i] && pendingKey(cells, entry); });
    if (index < 0) {
      if (!entry.local) conflicts.push(conflito_('', OPERATIONS, r.entityId || '', '', '', 'operation_row_changed · A linha não está mais pendente com a chave enviada. Retorno anterior: ' + r.status + '. Confira o Portal antes de repetir.'));
      return;
    }
    used[index] = true;
    var range = sheet.getRange(index + 2, 4, 1, 3);
    range.setNumberFormat('@');
    var live = sheet.getRange(index + 2, 1, 1, 4).getDisplayValues()[0];
    if (!pendingKey(live, entry) || !sameInput(live, entry)) {
      if (pendingKey(live, entry)) range.setValues([['conflict', '', 'operation_row_changed']]);
      conflicts.push(conflito_('', OPERATIONS, r.entityId || '', '', '', 'operation_row_changed · O conteúdo da operação mudou durante o envio. Retorno anterior: ' + r.status + '. Confira o Portal antes de usar uma nova chave.'));
      return;
    }
    range.setValues([[r.status || '', r.entityId || '', r.code || '']]);
  });
  return conflicts;
}

function escreverTabela_(ss, schema, rows) {
  var sheet = ss.getSheetByName(schema.sheetName) || ss.insertSheet(schema.sheetName);
  var header = schema.columns.map(function (c) { return c.name; });
  var width = header.length, height = rows.length + 1;
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  if (sheet.getMaxRows() < height + 1) sheet.insertRowsAfter(sheet.getMaxRows(), height + 1 - sheet.getMaxRows());
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), width)).clearContent();
  var data = [header].concat(rows.map(function (row) { return header.map(function (name) { return texto_(row[name]); }); }));
  var range = sheet.getRange(1, 1, data.length, width);
  range.setNumberFormat('@'); // texto literal: nada vira fórmula, data ou número
  range.setValues(data);
  var head = sheet.getRange(1, 1, 1, width);
  head.setFontWeight('bold').setBackgrounds([schema.columns.map(function (c) { return c.editable ? EDITABLE_COLOR : SYSTEM_COLOR; })]);
  head.setNotes([schema.columns.map(function (c) { return c.label + (c.editable ? ' · editável na planilha' : ' · calculado pelo portal'); })]);
  if (sheet.getFrozenRows() !== 1) sheet.setFrozenRows(1);
  if (sheet.getFrozenColumns() !== 1) sheet.setFrozenColumns(1);
}

function conferirTabela_(ss, schema, rows) {
  var sheet = ss.getSheetByName(schema.sheetName);
  if (!sheet || sheet.getLastRow() !== rows.length + 1) return false;
  var header = sheet.getRange(1, 1, 1, schema.columns.length).getDisplayValues()[0];
  if (header.join('\u0001') !== schema.columns.map(function (c) { return c.name; }).join('\u0001')) return false;
  if (!rows.length) return true;
  var values = sheet.getRange(2, 1, rows.length, header.length).getDisplayValues();
  // Os hashes armazenados são células também: mantê-los intactos não prova que
  // nome, saldo, texto ou qualquer outro valor foi gravado e relido corretamente.
  return rows.every(function (row, i) { return header.every(function (name, j) { return values[i][j] === texto_(row[name]); }); });
}

function garantirAbasDeControle_(ss) {
  [[CONTROL, ['key', 'value', 'note']], [OPERATIONS, OPERATIONS_HEADER], [CONFLICTS, CONFLICTS_HEADER]].forEach(function (spec) {
    var sheet = ss.getSheetByName(spec[0]) || ss.insertSheet(spec[0]);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, spec[1].length).setValues([spec[1]]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  });
}

/** Lê o Controle e devolve as bases e um gravador que substitui as bases de uma tabela. */
function lerControle_(ss) {
  var sheet = ss.getSheetByName(CONTROL), rows = [], baselines = {};
  if (sheet.getLastRow() >= 2) rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues().map(function (r) { return [String(r[0]), String(r[1]), String(r[2])]; });
  var entries = rows.filter(function (r) { return r[0].indexOf('baseline:') === 0; });
  var previousVerified = rows.filter(function (r) { return r[0] === 'lastVerifiedAt'; })[0];
  var lastVerifiedAt = previousVerified ? previousVerified[1] : '';
  entries.forEach(function (r) { try { baselines[r[0].slice(9)] = JSON.parse(r[1]); } catch (e) { /* base corrompida: a linha vira conflito */ } });
  return {
    baselines: baselines,
    replace: function (table, fresh) {
      var prefix = 'baseline:' + table + ':';
      entries = entries.filter(function (r) { return r[0].indexOf(prefix) !== 0; }).concat(fresh);
    },
    save: function (verified, total, state) {
      var now = new Date().toISOString();
      var complete = state === 'completed' && verified === total;
      if (complete) lastVerifiedAt = now;
      var data = [
        ['key', 'value', 'note'],
        ['formatVersion', '1', 'Versão do formato portátil. Alterar somente com migração coordenada.'],
        ['syncState', complete ? 'verified' : 'partial', 'Verificada somente após releitura de todas as tabelas e ausência de conflitos nesta execução.'],
        ['lastVerifiedAt', lastVerifiedAt, 'Última execução integralmente verificada; não comprova gatilho ativo.'],
        ['tablesVerified', String(verified), 'Abas conferidas nesta execução.'],
        ['lastAttemptAt', now, 'Horário da tentativa atual.'],
        ['lastAttemptStatus', state || 'partial', 'Resultado desta tentativa; bases parciais já conferidas são preservadas.'],
        ['connectorVersion', CONNECTOR_VERSION, 'Versão instalada do conector Apps Script.'],
      ].concat(entries);
      if (sheet.getMaxRows() < data.length + 1) sheet.insertRowsAfter(sheet.getMaxRows(), data.length + 1 - sheet.getMaxRows());
      if (sheet.getLastRow() > 0) sheet.getRange(1, 1, sheet.getLastRow(), 3).clearContent();
      var range = sheet.getRange(1, 1, data.length, 3);
      range.setNumberFormat('@');
      range.setValues(data);
    },
  };
}

function registrarConflitos_(ss, conflicts) {
  if (!conflicts.length) return;
  var sheet = ss.getSheetByName(CONFLICTS);
  var range = sheet.getRange(sheet.getLastRow() + 1, 1, conflicts.length, CONFLICTS_HEADER.length);
  range.setNumberFormat('@');
  range.setValues(conflicts);
}

function conflito_(id, table, entityId, expected, actual, reason) {
  return [id || Utilities.getUuid(), table, texto_(entityId), texto_(expected), texto_(actual), String(reason).slice(0, 45000), 'open', new Date().toISOString()];
}

// ---------------------------------------------------------------- anexos

function copiarAnexos_() {
  var folderId = propriedades_().getProperty('ATTACHMENTS_FOLDER_ID');
  if (!folderId) {
    salvarEstadoAnexos_({ status: 'failed', copied: 0, failed: 1, codes: ['attachment_folder_missing'] });
    throw new Error('Conecte a planilha e a pasta privada antes de copiar anexos.');
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) { salvarEstadoAnexos_({ status: 'busy', copied: 0, failed: 0 }); return 0; }
  var result = { status: 'completed', copied: 0, failed: 0, existing: 0, codes: [] };
  try {
    var folder = DriveApp.getFolderById(folderId);
    conferirPastaPrivada_(folder);
    var after = null, started = Date.now();
    do {
      var args = { limit: 50 };
      if (after) args.after = after;
      var page = chamar_('proex_sync_attachment_list', args);
      for (var i = 0; i < page.attachments.length; i++) {
        var item = page.attachments[i];
        if (item.driveExport && !item.driveExport.deletedAt) { result.existing++; continue; }
        if (Date.now() - started > ATTACHMENTS_BUDGET_MS) {
          result.status = result.failed ? 'failed' : 'partial';
          salvarEstadoAnexos_(result);
          if (result.failed) throw new Error('Falha na cópia de anexos. Veja PROEX → Ver estado da conexão.');
          return result.copied;
        }
        try {
          var ticket = chamar_('proex_sync_attachment_ticket', { kind: item.kind, id: item.id });
          var response = UrlFetchApp.fetch(ticket.url, { muteHttpExceptions: true, followRedirects: false });
          if (response.getResponseCode() !== 200) {
            var downloadError = new Error('Download de anexo recusado.');
            downloadError.code = 'download_http_' + response.getResponseCode(); throw downloadError;
          }
          var blob = response.getBlob();
          var bytes = blob.getBytes(), hash = hexBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
          var ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[item.mime] || 'bin';
          var file = folder.createFile(blob.setName(item.kind + '-' + item.id + '.' + ext));
          var reread = DriveApp.getFileById(file.getId());
          var privateConfirmed = reread.getSharingAccess() === DriveApp.Access.PRIVATE && reread.getEditors().length === 0 && reread.getViewers().length === 0;
          var readbackVerified = false;
          if (privateConfirmed && reread.getSize() === bytes.length) {
            var storedBytes = reread.getBlob().getBytes();
            readbackVerified = storedBytes.length === bytes.length && hexBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, storedBytes)) === hash;
          }
          if (!privateConfirmed || !readbackVerified) {
            var readbackError = new Error('A cópia privada não passou na conferência.');
            readbackError.code = privateConfirmed ? 'attachment_readback_failed' : 'attachment_not_private'; throw readbackError;
          }
          chamar_('proex_sync_attachment_ack', {
            kind: item.kind, id: item.id, driveFileId: file.getId(), driveUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
            contentHash: hash, size: bytes.length, privateConfirmed: privateConfirmed, readbackVerified: readbackVerified,
          });
          result.copied++;
        } catch (error) {
          result.failed++;
          var code = error && /^[a-z0-9_]{1,80}$/i.test(error.code || '') ? error.code : 'attachment_copy_failed';
          if (result.codes.indexOf(code) < 0 && result.codes.length < 5) result.codes.push(code);
          // Falha de autenticação não deve provocar uma chamada por anexo.
          if (['sync_token_invalid', 'sync_forbidden', 'unauthenticated'].indexOf(code) >= 0) throw error;
        }
      }
      after = page.nextCursor;
    } while (after);
    result.status = result.failed ? 'failed' : 'completed';
    salvarEstadoAnexos_(result);
    if (result.failed) throw new Error('Falha na cópia de ' + result.failed + ' anexo(s); ' + result.copied + ' confirmado(s). Veja PROEX → Ver estado da conexão.');
    return result.copied;
  } catch (_error) {
    result.status = 'failed';
    if (!result.failed) result.failed = 1;
    salvarEstadoAnexos_(result);
    // Não inclua nomes, URLs de tickets ou texto bruto do provedor nos logs.
    throw new Error('Cópia de anexos incompleta: ' + result.copied + ' confirmado(s), ' + result.failed + ' falha(s). Veja PROEX → Ver estado da conexão.');
  } finally {
    lock.releaseLock();
  }
}
function salvarEstadoAnexos_(result) {
  result.at = new Date().toISOString();
  propriedades_().setProperty('LAST_ATTACHMENTS_RESULT', JSON.stringify(result));
}
function lerEstadoAnexos_() {
  try { return JSON.parse(propriedades_().getProperty('LAST_ATTACHMENTS_RESULT') || 'null'); } catch (_error) { return null; }
}
function resumoAnexos_(result) {
  if (!result) return 'nenhuma cópia registrada';
  if (result.status === 'busy') return 'não executada: outra sincronização está em andamento';
  var text = result.copied + ' cópia(s) confirmada(s), ' + result.failed + ' falha(s)';
  if (result.status === 'partial') text += '; interrompida pelo limite de tempo, há anexos por conferir';
  if (result.existing) text += '; ' + result.existing + ' cópia(s) anterior(es) não revalidadas';
  if (result.codes && result.codes.length) text += '; códigos: ' + result.codes.join(', ');
  return text;
}

/** Interrompe se a pasta de anexos estiver compartilhada por link ou com outras pessoas. */
function conferirPastaPrivada_(folder) {
  var shared = folder.getSharingAccess() !== DriveApp.Access.PRIVATE || folder.getEditors().length > 0 || folder.getViewers().length > 0;
  if (shared) throw new Error('A pasta "' + ATTACHMENTS_FOLDER + '" está compartilhada. Remova o compartilhamento antes de copiar fotos e termos.');
}

// ---------------------------------------------------------------- utilitários

function chamar_(tool, args) {
  var props = propriedades_();
  var portal = props.getProperty('PORTAL_URL'), token = props.getProperty('SYNC_TOKEN');
  if (!portal || !token) throw new Error('Conecte a planilha primeiro: PROEX → Conectar ao portal…');
  var response = UrlFetchApp.fetch(portal + '/api/sync/connector', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, followRedirects: false,
    headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ tool: tool, args: args }),
  });
  var body;
  try { body = JSON.parse(response.getContentText()); } catch (e) { throw new Error('Resposta inesperada do portal (' + response.getResponseCode() + ').'); }
  if (!body.ok) { var error = new Error((body.code || 'erro') + ': ' + (body.error || 'falha na integração')); error.code = body.code; throw error; }
  return body.result;
}
function pastaFilha_(parent, name) {
  var found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}
function texto_(value) { return value === null || value === undefined ? '' : String(value); }
/** Converte o texto da célula para o tipo da coluna; valores ambíguos viram erro, nunca nulo silencioso. */
function converter_(value, column) {
  var text = texto_(value).trim();
  if (column.type === 'number') {
    if (text === '') return { value: null };
    if (!/^-?\d+(\.\d+)?$/.test(text)) return { error: 'use números com ponto decimal (ex.: 3 ou 2.5)' };
    return { value: Number(text) };
  }
  if (column.type === 'boolean') {
    var lower = text.toLowerCase();
    if (['true', '1', 'sim', 'verdadeiro'].indexOf(lower) >= 0) return { value: true };
    if (['false', '0', 'não', 'nao', 'falso'].indexOf(lower) >= 0) return { value: false };
    return { error: 'use sim/não, verdadeiro/falso ou 1/0' };
  }
  if (text === '') return { value: column.type === 'text' && !/_id$/.test(column.name) ? '' : null };
  return { value: text };
}
function hex_(text) { return hexBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)); }
function hexBytes_(bytes) { return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join(''); }

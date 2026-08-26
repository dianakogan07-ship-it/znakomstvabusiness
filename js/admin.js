import { call, ApiError } from './supabase-client.js';
import {
  saveAdminSession, getAdminSession, clearAdminSession, copyToClipboard, showToast, el,
  generatePassword, generateUsernameFromName, fallbackAvatar, rowsToCSV, parseCSV, downloadTextFile,
} from './utils.js';

const loginScreen = document.getElementById('adminLoginScreen');
const panel = document.getElementById('adminPanel');

function showLoginScreen() {
  clearAdminSession();
  loginScreen.style.display = 'flex';
  panel.hidden = true;
}

function showPanel() {
  loginScreen.style.display = 'none';
  panel.hidden = false;
  loadCompanies();
}

/* ---------------------------- Admin login ---------------------------- */
const loginForm = document.getElementById('adminLoginForm');
const loginError = document.getElementById('adminLoginError');
const loginBtn = document.getElementById('adminLoginBtn');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.remove('is-visible');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Входим…';
  try {
    const token = await call('admin_login', { p_password: document.getElementById('adminPassword').value });
    saveAdminSession(token);
    showPanel();
  } catch (err) {
    loginError.textContent = err instanceof ApiError ? err.message : 'Не удалось войти';
    loginError.classList.add('is-visible');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Войти';
  }
});

document.getElementById('adminLogoutBtn').addEventListener('click', showLoginScreen);

function handleAuthError(err) {
  if (err instanceof ApiError && /администратора/.test(err.message)) {
    showToast('Сессия истекла, войдите заново', 'error');
    showLoginScreen();
    return true;
  }
  return false;
}

/* ---------------------------- Companies table ---------------------------- */
const tableBody = document.getElementById('companiesTableBody');
const searchInput = document.getElementById('companySearch');
let companiesCache = [];

async function loadCompanies() {
  tableBody.innerHTML = '';
  tableBody.appendChild(el('tr', {}, [el('td', { colspan: '5' }, [el('div', { class: 'spinner' })])]));
  try {
    companiesCache = (await call('admin_list_companies', { p_admin_token: getAdminSession() })) || [];
  } catch (err) {
    if (handleAuthError(err)) return;
    showToast('Не удалось загрузить список компаний', 'error');
    companiesCache = [];
  }
  renderTable();
}

function getFilteredCompanies() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) return companiesCache;
  return companiesCache.filter((c) => [c.name, c.industry, c.contact_first_name, c.username]
    .some((field) => (field || '').toLowerCase().includes(q)));
}

searchInput.addEventListener('input', renderTable);

function renderTable() {
  tableBody.innerHTML = '';
  const list = getFilteredCompanies();
  if (companiesCache.length === 0) {
    tableBody.appendChild(el('tr', {}, [el('td', { colspan: '5' }, [
      el('div', { class: 'empty-state', text: 'Пока нет ни одной компании — добавьте первую' }),
    ])]));
    return;
  }
  if (list.length === 0) {
    tableBody.appendChild(el('tr', {}, [el('td', { colspan: '5' }, [
      el('div', { class: 'empty-state', text: 'Ничего не найдено по этому запросу' }),
    ])]));
    return;
  }
  list.forEach((c) => {
    const row = el('tr', {}, [
      el('td', {}, [el('div', { style: 'display:flex; align-items:center; gap:10px;' }, [
        el('img', { src: c.photo_url || fallbackAvatar(c.name), alt: '', style: 'width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;' }),
        el('span', { style: 'font-weight:600;', text: c.name }),
      ])]),
      el('td', { text: c.industry || '—' }),
      el('td', { text: c.contact_first_name || '—' }),
      el('td', {}, [buildCredentialCell(c)]),
      el('td', {}, [buildRowActions(c)]),
    ]);
    tableBody.appendChild(row);
  });
}

function buildCredentialCell(c) {
  const wrap = el('div', { style: 'display:flex; flex-direction:column; gap:6px;' });

  const userChip = el('div', { class: 'credential-chip' }, [
    el('span', { text: c.username }),
    el('button', { type: 'button', text: '⧉', title: 'Скопировать логин', onClick: () => copyAndNotify(c.username, 'Логин скопирован') }),
  ]);

  let revealed = false;
  const passValue = el('span', { text: '••••••••' });
  const passChip = el('div', { class: 'credential-chip' }, [
    passValue,
    el('button', { type: 'button', text: '👁', title: 'Показать пароль', onClick: (e) => {
      revealed = !revealed;
      passValue.textContent = revealed ? c.password : '••••••••';
      e.currentTarget.textContent = revealed ? '🙈' : '👁';
    } }),
    el('button', { type: 'button', text: '⧉', title: 'Скопировать пароль', onClick: () => copyAndNotify(c.password, 'Пароль скопирован') }),
  ]);

  wrap.appendChild(userChip);
  wrap.appendChild(passChip);
  return wrap;
}

function buildRowActions(c) {
  return el('div', { class: 'row-actions' }, [
    el('button', { class: 'btn btn--sm', text: 'Изменить', onClick: () => openForm(c) }),
    el('button', { class: 'btn btn--sm btn--danger', text: 'Удалить', onClick: () => deleteCompany(c) }),
  ]);
}

async function copyAndNotify(text, message) {
  const ok = await copyToClipboard(text);
  showToast(ok ? message : 'Не удалось скопировать', ok ? 'success' : 'error');
}

async function deleteCompany(c) {
  if (!confirm(`Удалить компанию «${c.name}»? Это действие необратимо.`)) return;
  try {
    await call('admin_delete_company', { p_admin_token: getAdminSession(), p_company_id: c.id });
    showToast('Компания удалена', 'success');
    loadCompanies();
  } catch (err) {
    if (handleAuthError(err)) return;
    showToast(err instanceof ApiError ? err.message : 'Не удалось удалить компанию', 'error');
  }
}

/* ---------------------------- Add / edit form ---------------------------- */
const formModal = document.getElementById('companyFormModal');
const companyForm = document.getElementById('companyForm');
const formTitle = document.getElementById('companyFormTitle');
const passwordHint = document.getElementById('passwordHint');

function openForm(company = null) {
  companyForm.reset();
  document.getElementById('companyId').value = company?.id || '';
  document.getElementById('f_name').value = company?.name || '';
  document.getElementById('f_photo_url').value = company?.photo_url || '';

  const industrySelect = document.getElementById('f_industry');
  industrySelect.querySelectorAll('option[data-custom]').forEach((o) => o.remove());
  if (company?.industry && ![...industrySelect.options].some((o) => o.value === company.industry)) {
    industrySelect.appendChild(el('option', { value: company.industry, text: company.industry, 'data-custom': '1' }));
  }
  industrySelect.value = company?.industry || '';

  document.getElementById('f_contact_first_name').value = company?.contact_first_name || '';
  document.getElementById('f_description').value = company?.description || '';
  document.getElementById('f_offer').value = company?.offer || '';
  document.getElementById('f_discuss_topics').value = company?.discuss_topics || '';
  document.getElementById('f_username').value = company?.username || '';
  document.getElementById('f_password').value = '';

  formTitle.textContent = company ? 'Изменить компанию' : 'Добавить компанию';
  passwordHint.textContent = company ? '(оставьте пустым, чтобы не менять)' : '';
  document.getElementById('f_password').required = !company;
  ['f_description', 'f_offer', 'f_discuss_topics'].forEach(updateCharCounter);
  formModal.classList.add('is-open');
}

function closeForm() {
  formModal.classList.remove('is-open');
}

// Ограничение длины полей карточки не просто для порядка: попап с полной
// информацией собран без прокрутки под конкретный размер текста — слишком
// длинное описание вылезет за пределы экрана на маленьких телефонах.
function updateCharCounter(fieldId) {
  const field = document.getElementById(fieldId);
  const counter = document.getElementById(`count_${fieldId.replace('f_', '')}`);
  if (!field || !counter) return;
  const max = Number(field.getAttribute('maxlength')) || 0;
  const len = field.value.length;
  counter.textContent = `${len} / ${max}`;
  counter.classList.toggle('is-near-limit', len >= max);
}
['f_description', 'f_offer', 'f_discuss_topics'].forEach((id) => {
  document.getElementById(id).addEventListener('input', () => updateCharCounter(id));
});

document.getElementById('openAddFormBtn').addEventListener('click', () => openForm());
document.getElementById('cancelFormBtn').addEventListener('click', closeForm);
formModal.addEventListener('click', (e) => { if (e.target === formModal) closeForm(); });
document.getElementById('genPasswordBtn').addEventListener('click', () => {
  document.getElementById('f_password').value = generatePassword();

  const usernameField = document.getElementById('f_username');
  if (!usernameField.value.trim()) {
    usernameField.value = generateUsernameFromName(document.getElementById('f_name').value);
  }
});

companyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveBtn = document.getElementById('saveCompanyBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Сохраняем…';

  const id = document.getElementById('companyId').value;
  const fields = {
    p_name: document.getElementById('f_name').value.trim(),
    p_photo_url: document.getElementById('f_photo_url').value.trim() || null,
    p_industry: document.getElementById('f_industry').value.trim() || null,
    p_description: document.getElementById('f_description').value.trim() || null,
    p_offer: document.getElementById('f_offer').value.trim() || null,
    p_discuss_topics: document.getElementById('f_discuss_topics').value.trim() || null,
    p_contact_first_name: document.getElementById('f_contact_first_name').value.trim() || null,
    p_username: document.getElementById('f_username').value.trim(),
  };
  const password = document.getElementById('f_password').value;

  try {
    if (id) {
      await call('admin_update_company', {
        p_admin_token: getAdminSession(),
        p_company_id: id,
        ...fields,
        p_new_password: password || null,
      });
      showToast('Изменения сохранены', 'success');
      closeForm();
      loadCompanies();
    } else {
      const rows = await call('admin_create_company', {
        p_admin_token: getAdminSession(),
        ...fields,
        p_password: password,
      });
      closeForm();
      loadCompanies();
      showCredentialsPanel(rows?.[0]);
    }
  } catch (err) {
    if (handleAuthError(err)) return;
    showToast(err instanceof ApiError ? err.message : 'Не удалось сохранить компанию', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Сохранить';
  }
});

function showCredentialsPanel(cred) {
  const container = document.getElementById('newCredentialsPanel');
  container.innerHTML = '';
  if (!cred) return;
  container.appendChild(el('div', { class: 'credentials-panel' }, [
    el('h3', { text: '✅ Компания добавлена — доступы для передачи участнику:' }),
    el('div', { style: 'display:flex; gap:10px; flex-wrap:wrap; align-items:center;' }, [
      el('div', { class: 'credential-chip' }, [
        el('span', { text: `Логин: ${cred.username}` }),
        el('button', { type: 'button', text: '⧉', onClick: () => copyAndNotify(cred.username, 'Логин скопирован') }),
      ]),
      el('div', { class: 'credential-chip' }, [
        el('span', { text: `Пароль: ${cred.password}` }),
        el('button', { type: 'button', text: '⧉', onClick: () => copyAndNotify(cred.password, 'Пароль скопирован') }),
      ]),
      el('button', { class: 'btn btn--sm', text: 'Скрыть', onClick: () => { container.innerHTML = ''; } }),
    ]),
  ]));
}

/* ---------------------------- Шаблон: скачать / загрузить, массовая генерация паролей ---------------------------- */
const TEMPLATE_HEADERS = [
  'Название компании', 'Ссылка на фото (URL)', 'Сфера деятельности',
  'Имя контактного лица', 'Чем занимается', 'Что предлагает',
  'Что интересно обсудить', 'Логин (необязательно)',
];
const FIELD_MAX = 110;

document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
  downloadTextFile('shablon-kompaniy.csv', rowsToCSV([TEMPLATE_HEADERS]), 'text/csv;charset=utf-8;');
});

document.getElementById('uploadTemplateBtn').addEventListener('click', () => {
  document.getElementById('uploadTemplateInput').click();
});

document.getElementById('uploadTemplateInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  await importTemplate(await file.text());
});

function renderBulkResult({ title, created = [], failed = [] }) {
  const panel = document.getElementById('bulkResultPanel');
  panel.innerHTML = '';
  const box = el('div', { class: 'import-summary' }, [
    el('h3', { text: title }),
    el('div', { text: `Успешно: ${created.length}${failed.length ? `, не удалось: ${failed.length}` : ''}` }),
  ]);
  if (failed.length) {
    const list = el('ul', { class: 'import-summary__errors' });
    failed.forEach((f) => list.appendChild(el('li', { text: `${f.name}: ${f.reason}` })));
    box.appendChild(list);
  }
  if (created.length) {
    box.appendChild(el('button', {
      class: 'btn btn--sm btn--primary', text: 'Скачать доступы (логин + пароль)', style: 'margin-top:10px;',
      onClick: () => {
        const rows = [['Компания', 'Логин', 'Пароль'], ...created.map((c) => [c.name, c.username, c.password])];
        downloadTextFile('dostupy-kompaniy.csv', rowsToCSV(rows), 'text/csv;charset=utf-8;');
      },
    }));
  }
  box.appendChild(el('button', {
    class: 'btn btn--sm', text: 'Скрыть', style: 'margin-top:10px; margin-left:8px;',
    onClick: () => { panel.innerHTML = ''; },
  }));
  panel.appendChild(box);
}

async function importTemplate(text) {
  const rows = parseCSV(text);
  const dataRows = rows.slice(1).filter((r) => (r[0] || '').trim());
  if (dataRows.length === 0) {
    showToast('В файле нет ни одной заполненной строки с компанией (первая строка — заголовки)', 'error');
    return;
  }

  const uploadBtn = document.getElementById('uploadTemplateBtn');
  const originalText = uploadBtn.textContent;
  const created = [];
  const failed = [];
  const usedUsernames = new Set(companiesCache.map((c) => c.username));

  for (let i = 0; i < dataRows.length; i++) {
    uploadBtn.disabled = true;
    uploadBtn.textContent = `Загружаем ${i + 1} из ${dataRows.length}…`;
    const [name, photoUrl, industry, contact, description, offer, discussTopics, usernameCol] = dataRows[i];
    const companyLabel = (name || '').trim() || `Строка ${i + 2}`;

    if (!name || !name.trim()) {
      failed.push({ name: companyLabel, reason: 'Не указано название компании' });
      continue;
    }

    let username = (usernameCol || '').trim() || generateUsernameFromName(name);
    if (usedUsernames.has(username)) {
      username = `${username}${Math.floor(10 + Math.random() * 89)}`;
    }
    const password = generatePassword();

    const fields = {
      p_name: name.trim(),
      p_photo_url: (photoUrl || '').trim() || null,
      p_industry: (industry || '').trim() || null,
      p_description: (description || '').trim().slice(0, FIELD_MAX) || null,
      p_offer: (offer || '').trim().slice(0, FIELD_MAX) || null,
      p_discuss_topics: (discussTopics || '').trim().slice(0, FIELD_MAX) || null,
      p_contact_first_name: (contact || '').trim() || null,
      p_username: username,
    };

    try {
      const result = await call('admin_create_company', { p_admin_token: getAdminSession(), ...fields, p_password: password });
      const row = result?.[0];
      usedUsernames.add(username);
      created.push({ name: fields.p_name, username: row?.username || username, password });
    } catch (err) {
      if (handleAuthError(err)) return;
      failed.push({ name: companyLabel, reason: err instanceof ApiError ? err.message : 'Не удалось сохранить' });
    }
  }

  uploadBtn.disabled = false;
  uploadBtn.textContent = originalText;
  await loadCompanies();
  renderBulkResult({ title: '📥 Загрузка шаблона завершена', created, failed });
}

document.getElementById('regenAllPasswordsBtn').addEventListener('click', async () => {
  if (companiesCache.length === 0) {
    showToast('Список компаний пуст', 'error');
    return;
  }
  const ok = confirm(
    `Сгенерировать новые пароли для всех компаний (${companiesCache.length})?\n\n` +
    'Старые пароли перестанут работать сразу же — участникам нужно будет передать новые.'
  );
  if (!ok) return;

  const btn = document.getElementById('regenAllPasswordsBtn');
  const originalText = btn.textContent;
  const created = [];
  const failed = [];

  for (let i = 0; i < companiesCache.length; i++) {
    const c = companiesCache[i];
    btn.disabled = true;
    btn.textContent = `Обрабатываем ${i + 1} из ${companiesCache.length}…`;
    const password = generatePassword();
    try {
      await call('admin_update_company', {
        p_admin_token: getAdminSession(),
        p_company_id: c.id,
        p_name: c.name,
        p_photo_url: c.photo_url,
        p_industry: c.industry,
        p_description: c.description,
        p_offer: c.offer,
        p_discuss_topics: c.discuss_topics,
        p_contact_first_name: c.contact_first_name,
        p_username: c.username,
        p_new_password: password,
      });
      created.push({ name: c.name, username: c.username, password });
    } catch (err) {
      if (handleAuthError(err)) return;
      failed.push({ name: c.name, reason: err instanceof ApiError ? err.message : 'Не удалось обновить' });
    }
  }

  btn.disabled = false;
  btn.textContent = originalText;
  await loadCompanies();
  renderBulkResult({ title: '🔑 Пароли обновлены для всех компаний', created, failed });
});

/* ---------------------------- Init ---------------------------- */
if (getAdminSession()) {
  showPanel();
} else {
  showLoginScreen();
}

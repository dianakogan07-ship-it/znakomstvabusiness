import { call, ApiError } from './supabase-client.js';
import { saveAdminSession, getAdminSession, clearAdminSession, copyToClipboard, showToast, el, generatePassword, generateUsernameFromName, fallbackAvatar } from './utils.js';

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

function renderTable() {
  tableBody.innerHTML = '';
  if (companiesCache.length === 0) {
    tableBody.appendChild(el('tr', {}, [el('td', { colspan: '5' }, [
      el('div', { class: 'empty-state', text: 'Пока нет ни одной компании — добавьте первую' }),
    ])]));
    return;
  }
  companiesCache.forEach((c) => {
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
  formModal.classList.add('is-open');
}

function closeForm() {
  formModal.classList.remove('is-open');
}

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

/* ---------------------------- Init ---------------------------- */
if (getAdminSession()) {
  showPanel();
} else {
  showLoginScreen();
}

import { call, ApiError } from './supabase-client.js';
import { saveCompanySession, getCompanySession } from './utils.js';

if (getCompanySession()) {
  window.location.href = 'app.html';
}

const form = document.getElementById('loginForm');
const errorBox = document.getElementById('loginError');
const submitBtn = document.getElementById('loginBtn');

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.add('is-visible');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.remove('is-visible');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Входим…';

  const username = form.username.value.trim();
  const password = form.password.value;

  try {
    const rows = await call('company_login', { p_username: username, p_password: password });
    const row = rows?.[0];
    if (!row) throw new ApiError('Неверный логин или пароль');

    saveCompanySession({
      token: row.token,
      id: row.id,
      name: row.name,
      photo_url: row.photo_url,
      industry: row.industry,
      description: row.description,
      offer: row.offer,
      discuss_topics: row.discuss_topics,
      contact_first_name: row.contact_first_name,
    });

    window.location.href = 'app.html';
  } catch (err) {
    showError(err instanceof ApiError ? err.message : 'Не удалось войти. Попробуйте ещё раз.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Войти';
  }
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

class ApiError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const MESSAGES = {
  invalid_credentials: 'Неверный логин или пароль',
  invalid_admin_password: 'Неверный пароль администратора',
  invalid_session: 'Сессия истекла, войдите заново',
  invalid_admin_session: 'Сессия администратора истекла, войдите заново',
  username_required: 'Укажите логин',
  password_too_short: 'Пароль должен быть не короче 4 символов',
  invalid_direction: 'Некорректное действие',
  not_matched: 'Диалог недоступен: нет взаимного совпадения',
  empty_message: 'Сообщение не может быть пустым',
};

function friendlyMessage(rawMessage) {
  const code = (rawMessage || '').split(':')[0].trim();
  return MESSAGES[code] || 'Что-то пошло не так. Попробуйте ещё раз.';
}

export async function call(fn, args = {}) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    throw new ApiError(friendlyMessage(error.message));
  }
  return data;
}

export { ApiError };

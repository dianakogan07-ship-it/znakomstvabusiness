-- ============================================================================
-- Схема БД для B2B-сервиса деловых знакомств
-- Выполнить целиком в Supabase → SQL Editor → New query → Run
-- ============================================================================
--
-- АРХИТЕКТУРА АУТЕНТИФИКАЦИИ (как это устроено и почему)
--
-- В ТЗ было два варианта: (1) Supabase Auth с синтетическими email вида
-- login@internal.local, (2) своя таблица с хешем пароля + проверка через
-- Edge Function. Выбран третий, более простой вариант на основе идеи (2):
-- своя таблица `companies` с паролем + проверка через Postgres-функции
-- (RPC), вызываемые напрямую из фронтенда через supabase-js `.rpc()`.
--
-- Почему не Supabase Auth: у ТЗ есть жёсткое требование — админ должен
-- в любой момент посмотреть и скопировать пароль компании повторно
-- («если понадобится напомнить»). Supabase Auth (как и любая нормальная
-- система) хранит только необратимый хеш пароля и никогда не отдаёт
-- пароль обратно — то есть это требование с Supabase Auth физически
-- нереализуемо. Поэтому пароли компаний хранятся в БД в виде, которое
-- можно расшифровать обратно (симметричное шифрование pgcrypto), а не
-- в виде одностороннего хеша.
--
-- Почему не Edge Function, а обычные SQL-функции (RPC): результат тот же
-- (код выполняется на сервере Supabase, а не в браузере, секретный ключ
-- шифрования наружу не уходит), но не нужен отдельный деплой через
-- Supabase CLI — весь «бэкенд» это один SQL-файл, который просто
-- запускается один раз в SQL Editor. Для админа форума без своей
-- инфраструктуры это заметно проще в поддержке.
--
-- Как это работает:
--  - Таблицы `companies`, `swipes`, `messages`, `*_sessions` НЕ доступны
--    напрямую через REST/anon-ключ (все прямые grants отозваны, RLS
--    включён без разрешающих политик — доступ запрещён по умолчанию).
--  - Единственный способ поработать с данными — вызвать одну из функций
--    ниже через `supabase.rpc(...)`. Функции объявлены `SECURITY DEFINER`,
--    то есть выполняются с правами владельца функции и сами решают, что
--    можно, а что нет — это и есть весь контроль доступа вместо
--    классических RLS-политик на auth.uid() (своей аутентификации через
--    Supabase Auth здесь нет, поэтому auth.uid() всегда NULL).
--  - Компания логинится через `company_login` → получает токен сессии
--    (случайная строка, хранится в `company_sessions`). Токен кладётся
--    в localStorage браузера и передаётся первым параметром во все
--    остальные функции. Функции сами проверяют токен и вычисляют, какая
--    это компания — id компании из браузера напрямую никогда не
--    используется для определения «кто я».
--  - Админ логинится по единому паролю через `admin_login` → получает
--    отдельный admin-токен (`admin_sessions`), тоже передаётся во все
--    admin_*-функции.
--
-- ЧТО НУЖНО ПОМЕНЯТЬ ПЕРЕД ЗАПУСКОМ (см. README.md, шаг 2):
--   1. `_enc_key()`     — секретный ключ шифрования паролей компаний.
--   2. `_admin_password()` — единый пароль администратора.
-- Меняйте эти значения только в SQL Editor вашего Supabase-проекта.
-- НЕ коммитьте свои реальные секреты обратно в этот файл в открытом
-- репозитории — в git должны остаться только плейсхолдеры.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Таблицы
-- ----------------------------------------------------------------------------

create table if not exists companies (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  photo_url            text,
  industry             text,
  description          text,
  offer                text,
  discuss_topics       text,
  contact_first_name   text,
  username             text not null unique,
  password_encrypted   bytea not null,
  created_at           timestamptz not null default now()
);

create table if not exists swipes (
  id               bigserial primary key,
  from_company_id  uuid not null references companies(id) on delete cascade,
  to_company_id    uuid not null references companies(id) on delete cascade,
  direction        text not null check (direction in ('left', 'right')),
  created_at       timestamptz not null default now(),
  unique (from_company_id, to_company_id),
  check (from_company_id <> to_company_id)
);

create index if not exists swipes_to_company_idx on swipes (to_company_id, direction);
create index if not exists swipes_from_company_idx on swipes (from_company_id);

create table if not exists messages (
  id                  bigserial primary key,
  company_1           uuid not null references companies(id) on delete cascade,
  company_2           uuid not null references companies(id) on delete cascade,
  sender_company_id   uuid not null references companies(id) on delete cascade,
  body                text not null check (char_length(body) between 1 and 2000),
  created_at          timestamptz not null default now(),
  check (company_1 < company_2)
);

create index if not exists messages_pair_idx on messages (company_1, company_2, created_at);

create table if not exists company_sessions (
  token        text primary key,
  company_id   uuid not null references companies(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days'
);

create table if not exists admin_sessions (
  token        text primary key,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days'
);

-- Запрещаем прямой доступ к таблицам через REST/anon-ключ: RLS включён,
-- разрешающих политик нет → доступ только через SECURITY DEFINER функции.
alter table companies enable row level security;
alter table swipes enable row level security;
alter table messages enable row level security;
alter table company_sessions enable row level security;
alter table admin_sessions enable row level security;

revoke all on companies, swipes, messages, company_sessions, admin_sessions
  from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Секреты (поменяйте перед запуском — см. README.md)
-- ----------------------------------------------------------------------------

create or replace function _enc_key() returns text
language sql immutable as $$
  select 'CHANGE_ME_RANDOM_ENCRYPTION_KEY_123'::text;
$$;

create or replace function _admin_password() returns text
language sql immutable as $$
  select 'CHANGE_ME_ADMIN_PASSWORD'::text;
$$;

-- ----------------------------------------------------------------------------
-- Служебные функции: проверка токенов
-- ----------------------------------------------------------------------------

create or replace function _current_company(p_token text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_company_id uuid;
begin
  if p_token is null then
    raise exception 'invalid_session';
  end if;

  select company_id into v_company_id
  from company_sessions
  where token = p_token and expires_at > now();

  if v_company_id is null then
    raise exception 'invalid_session';
  end if;

  return v_company_id;
end;
$$;

create or replace function _require_admin(p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_token is null or not exists (
    select 1 from admin_sessions where token = p_token and expires_at > now()
  ) then
    raise exception 'invalid_admin_session';
  end if;
end;
$$;

create or replace function _is_matched(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from swipes s1
    where s1.from_company_id = p_a and s1.to_company_id = p_b and s1.direction = 'right'
  ) and exists (
    select 1 from swipes s2
    where s2.from_company_id = p_b and s2.to_company_id = p_a and s2.direction = 'right'
  );
$$;

-- ----------------------------------------------------------------------------
-- Админ: логин
-- ----------------------------------------------------------------------------

create or replace function admin_login(p_password text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text;
begin
  if p_password is null or p_password <> _admin_password() then
    raise exception 'invalid_admin_password';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into admin_sessions (token) values (v_token);
  return v_token;
end;
$$;

-- ----------------------------------------------------------------------------
-- Админ: CRUD компаний
-- ----------------------------------------------------------------------------

create or replace function admin_list_companies(p_admin_token text)
returns table (
  id uuid, name text, photo_url text, industry text, description text,
  offer text, discuss_topics text, contact_first_name text,
  username text, password text, created_at timestamptz
)
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_admin_token);

  return query
    select c.id, c.name, c.photo_url, c.industry, c.description, c.offer,
           c.discuss_topics, c.contact_first_name, c.username,
           pgp_sym_decrypt(c.password_encrypted, _enc_key()) as password,
           c.created_at
    from companies c
    order by c.created_at desc;
end;
$$;

create or replace function admin_create_company(
  p_admin_token text, p_name text, p_photo_url text, p_industry text,
  p_description text, p_offer text, p_discuss_topics text,
  p_contact_first_name text, p_username text, p_password text
) returns table (id uuid, username text, password text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  perform _require_admin(p_admin_token);

  if p_username is null or length(trim(p_username)) = 0 then
    raise exception 'username_required';
  end if;
  if p_password is null or length(p_password) < 4 then
    raise exception 'password_too_short';
  end if;

  insert into companies (
    name, photo_url, industry, description, offer, discuss_topics,
    contact_first_name, username, password_encrypted
  ) values (
    p_name, p_photo_url, p_industry, p_description, p_offer, p_discuss_topics,
    p_contact_first_name, trim(p_username), pgp_sym_encrypt(p_password, _enc_key())
  ) returning companies.id into v_id;

  return query select v_id, trim(p_username), p_password;
end;
$$;

create or replace function admin_update_company(
  p_admin_token text, p_company_id uuid, p_name text, p_photo_url text,
  p_industry text, p_description text, p_offer text, p_discuss_topics text,
  p_contact_first_name text, p_username text, p_new_password text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_admin_token);

  update companies set
    name = p_name,
    photo_url = p_photo_url,
    industry = p_industry,
    description = p_description,
    offer = p_offer,
    discuss_topics = p_discuss_topics,
    contact_first_name = p_contact_first_name,
    username = trim(p_username),
    password_encrypted = case
      when p_new_password is not null and length(p_new_password) > 0
        then pgp_sym_encrypt(p_new_password, _enc_key())
      else password_encrypted
    end
  where id = p_company_id;
end;
$$;

create or replace function admin_delete_company(p_admin_token text, p_company_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_admin_token);
  delete from companies where id = p_company_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Компании: логин
-- ----------------------------------------------------------------------------

create or replace function company_login(p_username text, p_password text)
returns table (
  token text, id uuid, name text, photo_url text, industry text,
  description text, offer text, discuss_topics text, contact_first_name text
)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_row companies%rowtype;
  v_token text;
begin
  select * into v_row from companies where username = trim(p_username);

  if not found or pgp_sym_decrypt(v_row.password_encrypted, _enc_key()) <> p_password then
    raise exception 'invalid_credentials';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into company_sessions (token, company_id) values (v_token, v_row.id);

  return query select v_token, v_row.id, v_row.name, v_row.photo_url, v_row.industry,
                      v_row.description, v_row.offer, v_row.discuss_topics, v_row.contact_first_name;
end;
$$;

-- ----------------------------------------------------------------------------
-- Компании: лента, свайпы, приглашения, диалоги
-- ----------------------------------------------------------------------------

create or replace function get_feed(p_token text)
returns table (
  id uuid, name text, photo_url text, industry text, description text,
  offer text, discuss_topics text, contact_first_name text
)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_me uuid;
begin
  v_me := _current_company(p_token);

  return query
    select c.id, c.name, c.photo_url, c.industry, c.description, c.offer,
           c.discuss_topics, c.contact_first_name
    from companies c
    where c.id <> v_me
      and not exists (
        select 1 from swipes s where s.from_company_id = v_me and s.to_company_id = c.id
      )
    order by c.created_at asc;
end;
$$;

create or replace function record_swipe(p_token text, p_to_company_id uuid, p_direction text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_me uuid;
  v_is_match boolean;
begin
  v_me := _current_company(p_token);

  if p_direction not in ('left', 'right') then
    raise exception 'invalid_direction';
  end if;

  insert into swipes (from_company_id, to_company_id, direction)
  values (v_me, p_to_company_id, p_direction)
  on conflict (from_company_id, to_company_id) do nothing;

  if p_direction = 'right' then
    v_is_match := _is_matched(v_me, p_to_company_id);
  else
    v_is_match := false;
  end if;

  return v_is_match;
end;
$$;

create or replace function get_invitations(p_token text)
returns table (
  company_id uuid, name text, photo_url text, industry text, description text,
  offer text, discuss_topics text, contact_first_name text, status text, received_at timestamptz
)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_me uuid;
begin
  v_me := _current_company(p_token);

  return query
    select c.id, c.name, c.photo_url, c.industry, c.description, c.offer,
           c.discuss_topics, c.contact_first_name,
           case when my.direction = 'left' then 'declined' else 'pending' end as status,
           s.created_at as received_at
    from swipes s
    join companies c on c.id = s.from_company_id
    left join swipes my on my.from_company_id = v_me and my.to_company_id = s.from_company_id
    where s.to_company_id = v_me
      and s.direction = 'right'
      and (my.direction is null or my.direction = 'left')
    order by s.created_at desc;
end;
$$;

create or replace function get_matches(p_token text)
returns table (
  company_id uuid, name text, photo_url text, contact_first_name text,
  last_message text, last_message_at timestamptz, matched_at timestamptz
)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_me uuid;
begin
  v_me := _current_company(p_token);

  return query
    with my_matches as (
      select s1.to_company_id as other_id, s1.created_at as matched_at
      from swipes s1
      where s1.from_company_id = v_me and s1.direction = 'right'
        and _is_matched(v_me, s1.to_company_id)
    )
    select c.id, c.name, c.photo_url, c.contact_first_name,
           m.body as last_message, m.created_at as last_message_at, mm.matched_at
    from my_matches mm
    join companies c on c.id = mm.other_id
    left join lateral (
      select msg.body, msg.created_at
      from messages msg
      where (msg.company_1 = v_me and msg.company_2 = mm.other_id)
         or (msg.company_1 = mm.other_id and msg.company_2 = v_me)
      order by msg.created_at desc
      limit 1
    ) m on true
    order by coalesce(m.created_at, mm.matched_at) desc;
end;
$$;

create or replace function get_messages(p_token text, p_other_company_id uuid)
returns table (sender_company_id uuid, body text, created_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_me uuid;
begin
  v_me := _current_company(p_token);

  if not _is_matched(v_me, p_other_company_id) then
    raise exception 'not_matched';
  end if;

  return query
    select msg.sender_company_id, msg.body, msg.created_at
    from messages msg
    where (msg.company_1 = v_me and msg.company_2 = p_other_company_id)
       or (msg.company_1 = p_other_company_id and msg.company_2 = v_me)
    order by msg.created_at asc;
end;
$$;

create or replace function send_message(p_token text, p_other_company_id uuid, p_body text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_me uuid;
begin
  v_me := _current_company(p_token);

  if not _is_matched(v_me, p_other_company_id) then
    raise exception 'not_matched';
  end if;

  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'empty_message';
  end if;

  insert into messages (company_1, company_2, sender_company_id, body)
  values (least(v_me, p_other_company_id), greatest(v_me, p_other_company_id), v_me, trim(p_body));
end;
$$;

create or replace function get_invitations_count(p_token text) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_me uuid;
  v_count int;
begin
  v_me := _current_company(p_token);

  select count(*) into v_count
  from swipes s
  left join swipes my on my.from_company_id = v_me and my.to_company_id = s.from_company_id
  where s.to_company_id = v_me and s.direction = 'right' and my.direction is null;

  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- Права: только выполнение функций через anon-ключ
-- ----------------------------------------------------------------------------
-- Эти функции — единственная предназначенная для вызова с фронтенда
-- «публичная» поверхность API, поэтому им явно выдаётся EXECUTE.

grant execute on function admin_login(text) to anon, authenticated;
grant execute on function admin_list_companies(text) to anon, authenticated;
grant execute on function admin_create_company(text, text, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function admin_update_company(text, uuid, text, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function admin_delete_company(text, uuid) to anon, authenticated;
grant execute on function company_login(text, text) to anon, authenticated;
grant execute on function get_feed(text) to anon, authenticated;
grant execute on function record_swipe(text, uuid, text) to anon, authenticated;
grant execute on function get_invitations(text) to anon, authenticated;
grant execute on function get_matches(text) to anon, authenticated;
grant execute on function get_messages(text, uuid) to anon, authenticated;
grant execute on function send_message(text, uuid, text) to anon, authenticated;
grant execute on function get_invitations_count(text) to anon, authenticated;

-- Служебные (_current_company, _require_admin, _is_matched, _enc_key,
-- _admin_password) выполняются только изнутри других SECURITY DEFINER
-- функций и не должны быть вызываемы напрямую с anon-ключом.
revoke all on function _current_company(text), _require_admin(text), _is_matched(uuid, uuid),
  _enc_key(), _admin_password() from public, anon, authenticated;

-- ============================================================================
-- Готово. Дальше — см. README.md: как включить Auth-настройки (тут не
-- требуется), как получить URL и anon key проекта, куда их вставить.
-- ============================================================================

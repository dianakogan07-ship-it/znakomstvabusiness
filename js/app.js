import { call, ApiError } from './supabase-client.js';
import { getCompanySession, clearCompanySession, fallbackAvatar, showToast, el, timeAgo } from './utils.js';
import { makeSwipeable } from './swipe.js';

const session = getCompanySession();
if (!session) {
  window.location.href = 'index.html';
}

document.getElementById('myCompanyName').textContent = session.name;
document.getElementById('logoutBtn').addEventListener('click', () => {
  clearCompanySession();
  window.location.href = 'index.html';
});

function handleAuthError(err) {
  if (err instanceof ApiError && /Сессия/.test(err.message)) {
    clearCompanySession();
    window.location.href = 'index.html';
    return true;
  }
  return false;
}

/* ---------------------------- Tabs ---------------------------- */
const tabbar = document.getElementById('tabbar');
const views = {
  feed: document.getElementById('view-feed'),
  invitations: document.getElementById('view-invitations'),
  dialogs: document.getElementById('view-dialogs'),
  chat: document.getElementById('view-chat'),
};

function showView(name) {
  Object.values(views).forEach((v) => v.classList.remove('is-active'));
  views[name].classList.add('is-active');
  tabbar.style.display = name === 'chat' ? 'none' : 'flex';
  if (name !== 'chat') {
    tabbar.querySelectorAll('.tabbar__item').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tab === name);
    });
  }
  if (name === 'invitations') loadInvitations();
  if (name === 'dialogs') loadDialogs();
}

tabbar.addEventListener('click', (e) => {
  const btn = e.target.closest('.tabbar__item');
  if (btn) showView(btn.dataset.tab);
});

/* ---------------------------- Card rendering helper ---------------------------- */
function buildCardBody(company) {
  const hasMore = Boolean(company.description || company.offer || company.contact_first_name);

  const more = el('div', { class: 'swipe-card__more' }, [
    company.description ? el('div', { class: 'swipe-card__section' }, [
      el('div', { class: 'swipe-card__section-title', text: 'Чем занимается' }),
      el('div', { class: 'swipe-card__section-text', text: company.description }),
    ]) : null,
    company.offer ? el('div', { class: 'swipe-card__section' }, [
      el('div', { class: 'swipe-card__section-title', text: 'Что предлагает' }),
      el('div', { class: 'swipe-card__section-text', text: company.offer }),
    ]) : null,
    company.contact_first_name ? el('div', { class: 'swipe-card__contact', text: `Контакт: ${company.contact_first_name}` }) : null,
  ]);

  const body = el('div', { class: 'swipe-card__body' }, [
    el('div', { class: 'swipe-card__name', text: company.name }),
    company.industry ? el('div', { class: 'swipe-card__industry', text: company.industry }) : null,
    company.discuss_topics ? el('div', { class: 'swipe-card__section' }, [
      el('div', { class: 'swipe-card__section-title', text: 'Что интересно обсудить' }),
      el('div', { class: 'swipe-card__section-text', text: company.discuss_topics }),
    ]) : null,
    more,
    hasMore ? el('div', { class: 'swipe-card__hint', text: 'Нажмите на карточку, чтобы узнать больше →' }) : null,
  ]);
  return body;
}

function buildCardEl(company, { collapsedByDefault = true } = {}) {
  const card = el('div', { class: `swipe-card${collapsedByDefault ? ' swipe-card--collapsed' : ''}` });
  const img = el('img', { class: 'swipe-card__photo', src: company.photo_url || fallbackAvatar(company.name), alt: company.name });
  img.onerror = () => { img.src = fallbackAvatar(company.name); };
  card.appendChild(img);
  card.appendChild(buildCardBody(company));
  card.appendChild(el('div', { class: 'swipe-badge swipe-badge--like', text: 'Интересно' }));
  card.appendChild(el('div', { class: 'swipe-badge swipe-badge--nope', text: 'Мимо' }));
  if (collapsedByDefault) {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.round-btn')) return;
      openInfoModal(company);
    });
  }
  return card;
}

function openInfoModal(company) {
  cardModalContent.innerHTML = '';
  const card = buildCardEl(company, { collapsedByDefault: false });
  card.classList.add('swipe-card--static');
  cardModalContent.appendChild(card);
  cardModalContent.appendChild(el('button', { class: 'btn btn--block', text: 'Закрыть', onClick: closeCardModal, style: 'margin-top: 16px;' }));
  cardModal.classList.add('is-open');
}

/* ---------------------------- Feed ---------------------------- */
const feedStack = document.getElementById('feedStack');
const feedActions = document.getElementById('feedActions');
let feedQueue = [];
let currentSwipe = null;

async function loadFeed() {
  feedStack.innerHTML = '';
  feedStack.appendChild(el('div', { class: 'spinner' }));
  try {
    feedQueue = (await call('get_feed', { p_token: session.token })) || [];
  } catch (err) {
    if (handleAuthError(err)) return;
    showToast(err instanceof ApiError ? err.message : 'Не удалось загрузить ленту', 'error');
    feedQueue = [];
  }
  renderFeedStack();
}

function renderFeedStack() {
  feedStack.innerHTML = '';
  if (feedQueue.length === 0) {
    feedActions.style.display = 'none';
    feedStack.appendChild(el('div', { class: 'empty-state' }, [
      el('div', { class: 'empty-state__icon', text: '🎉' }),
      el('div', { text: 'Пока новых компаний нет — загляните позже' }),
    ]));
    return;
  }
  feedActions.style.display = 'flex';

  const visible = feedQueue.slice(0, 2).reverse();
  visible.forEach((company, i) => {
    const isTop = i === visible.length - 1;
    const card = buildCardEl(company);
    card.style.zIndex = String(i + 1);
    if (!isTop) {
      card.style.transform = 'scale(0.96) translateY(8px)';
      card.style.pointerEvents = 'none';
    }
    feedStack.appendChild(card);
    if (isTop) {
      currentSwipe = makeSwipeable(card, {
        onDecide: (direction) => handleFeedDecision(company, direction),
      });
    }
  });
}

async function handleFeedDecision(company, direction) {
  feedQueue = feedQueue.filter((c) => c.id !== company.id);
  setTimeout(renderFeedStack, 420);
  try {
    const isMatch = await call('record_swipe', { p_token: session.token, p_to_company_id: company.id, p_direction: direction });
    if (isMatch) showMatchOverlay(company);
    if (direction === 'right') refreshInvitationsBadge();
  } catch (err) {
    if (handleAuthError(err)) return;
    showToast(err instanceof ApiError ? err.message : 'Не удалось сохранить решение', 'error');
  }
}

document.getElementById('feedNope').addEventListener('click', () => currentSwipe?.programmaticDecide('left'));
document.getElementById('feedLike').addEventListener('click', () => currentSwipe?.programmaticDecide('right'));

/* ---------------------------- Match overlay ---------------------------- */
const matchOverlay = document.getElementById('matchOverlay');
let matchTargetCompany = null;

function showMatchOverlay(company) {
  matchTargetCompany = company;
  document.getElementById('matchAvatarMe').src = session.photo_url || fallbackAvatar(session.name);
  document.getElementById('matchAvatarThem').src = company.photo_url || fallbackAvatar(company.name);
  document.getElementById('matchText').textContent = `Вы и «${company.name}» хотите пообщаться`;
  matchOverlay.classList.add('is-open');
}
document.getElementById('matchContinue').addEventListener('click', () => matchOverlay.classList.remove('is-open'));
document.getElementById('matchGoToChat').addEventListener('click', () => {
  matchOverlay.classList.remove('is-open');
  if (matchTargetCompany) openChat(matchTargetCompany);
});

/* ---------------------------- Invitations ---------------------------- */
const invitationsList = document.getElementById('invitationsList');
const invitationsBadge = document.getElementById('invitationsBadge');
const tabInvitationsBadge = document.querySelector('[data-tab="invitations"] .badge');

async function refreshInvitationsBadge() {
  try {
    const count = await call('get_invitations_count', { p_token: session.token });
    [invitationsBadge, tabInvitationsBadge].forEach((b) => {
      if (!b) return;
      b.textContent = String(count);
      b.hidden = !count;
    });
  } catch (err) {
    handleAuthError(err);
  }
}

async function loadInvitations() {
  invitationsList.innerHTML = '';
  invitationsList.appendChild(el('div', { class: 'spinner' }));
  let rows = [];
  try {
    rows = (await call('get_invitations', { p_token: session.token })) || [];
  } catch (err) {
    if (handleAuthError(err)) return;
    showToast('Не удалось загрузить приглашения', 'error');
  }
  invitationsList.innerHTML = '';
  if (rows.length === 0) {
    invitationsList.appendChild(el('div', { class: 'empty-state' }, [
      el('div', { class: 'empty-state__icon', text: '📭' }),
      el('div', { text: 'Пока никто не приглашал вас к общению' }),
    ]));
  }
  rows.forEach((row) => {
    const item = el('div', { class: `list-item${row.status === 'declined' ? ' is-declined' : ''}` }, [
      el('img', { class: 'list-item__avatar', src: row.photo_url || fallbackAvatar(row.name), alt: '' }),
      el('div', { class: 'list-item__main' }, [
        el('div', { class: 'list-item__title' }, [
          row.name,
          row.status === 'pending' ? el('span', { class: 'pill pill--new', text: 'Новое' }) : el('span', { class: 'pill', text: 'Отклонено' }),
        ]),
        el('div', { class: 'list-item__subtitle', text: row.industry || '' }),
      ]),
      el('div', { class: 'list-item__time', text: timeAgo(row.received_at) }),
    ]);
    item.addEventListener('click', () => openInvitationCard(row));
    invitationsList.appendChild(item);
  });
  refreshInvitationsBadge();
}

/* ---------------------------- Invitation detail modal ---------------------------- */
const cardModal = document.getElementById('cardModal');
const cardModalContent = document.getElementById('cardModalContent');

function closeCardModal() {
  cardModal.classList.remove('is-open');
  cardModalContent.innerHTML = '';
}
cardModal.addEventListener('click', (e) => {
  if (e.target === cardModal) closeCardModal();
});

function openInvitationCard(row) {
  cardModalContent.innerHTML = '';
  const company = { ...row, id: row.company_id };
  const card = buildCardEl(company, { collapsedByDefault: false });
  card.classList.add('swipe-card--static');
  cardModalContent.appendChild(card);

  if (row.status === 'declined') {
    cardModalContent.appendChild(el('div', { class: 'empty-state', text: 'Вы уже отклонили это приглашение' }));
    cardModal.classList.add('is-open');
    return;
  }

  const actions = el('div', { class: 'swipe-actions' }, [
    el('button', { class: 'round-btn round-btn--nope', text: '✕', onClick: () => decideOnInvitation(company, 'left') }),
    el('button', { class: 'round-btn round-btn--like', text: '♥', onClick: () => decideOnInvitation(company, 'right') }),
  ]);
  cardModalContent.appendChild(actions);
  cardModal.classList.add('is-open');
}

async function decideOnInvitation(company, direction) {
  closeCardModal();
  try {
    const isMatch = await call('record_swipe', { p_token: session.token, p_to_company_id: company.id, p_direction: direction });
    feedQueue = feedQueue.filter((c) => c.id !== company.id);
    if (isMatch) showMatchOverlay(company);
    loadInvitations();
  } catch (err) {
    if (handleAuthError(err)) return;
    showToast(err instanceof ApiError ? err.message : 'Не удалось сохранить решение', 'error');
  }
}

/* ---------------------------- Dialogs ---------------------------- */
const dialogsList = document.getElementById('dialogsList');
const dialogsBadge = document.getElementById('dialogsBadge');
const tabDialogsBadge = document.querySelector('[data-tab="dialogs"] .badge');

async function refreshDialogsBadge() {
  try {
    const count = await call('get_dialogs_count', { p_token: session.token });
    [dialogsBadge, tabDialogsBadge].forEach((b) => {
      if (!b) return;
      b.textContent = String(count);
      b.hidden = !count;
    });
  } catch (err) {
    handleAuthError(err);
  }
}

async function loadDialogs() {
  dialogsList.innerHTML = '';
  dialogsList.appendChild(el('div', { class: 'spinner' }));
  let rows = [];
  try {
    rows = (await call('get_matches', { p_token: session.token })) || [];
  } catch (err) {
    if (handleAuthError(err)) return;
    showToast('Не удалось загрузить диалоги', 'error');
  }
  dialogsList.innerHTML = '';
  if (rows.length === 0) {
    dialogsList.appendChild(el('div', { class: 'empty-state' }, [
      el('div', { class: 'empty-state__icon', text: '💬' }),
      el('div', { text: 'Пока нет совпадений. Свайпайте карточки в ленте!' }),
    ]));
  }
  rows.forEach((row) => {
    const item = el('div', { class: 'list-item' }, [
      el('img', { class: 'list-item__avatar', src: row.photo_url || fallbackAvatar(row.name), alt: '' }),
      el('div', { class: 'list-item__main' }, [
        el('div', { class: 'list-item__title' }, [
          row.name,
          row.is_unread ? el('span', { class: 'pill pill--new', text: 'Новое' }) : null,
        ]),
        el('div', { class: 'list-item__subtitle', text: row.last_message || `Контакт: ${row.contact_first_name || ''}` }),
      ]),
      el('div', { class: 'list-item__time', text: timeAgo(row.last_message_at || row.matched_at) }),
    ]);
    item.addEventListener('click', () => openChat(row));
    dialogsList.appendChild(item);
  });
  refreshDialogsBadge();
}

/* ---------------------------- Chat ---------------------------- */
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
let chatOther = null;

async function openChat(company) {
  chatOther = { id: company.id || company.company_id, name: company.name, photo_url: company.photo_url, contact_first_name: company.contact_first_name };
  document.getElementById('chatAvatar').src = chatOther.photo_url || fallbackAvatar(chatOther.name);
  document.getElementById('chatName').textContent = chatOther.name;
  document.getElementById('chatContact').textContent = chatOther.contact_first_name ? `Контакт: ${chatOther.contact_first_name}` : '';
  showView('chat');
  await loadMessages();
  try {
    await call('mark_dialog_read', { p_token: session.token, p_other_company_id: chatOther.id });
    refreshDialogsBadge();
  } catch (err) {
    handleAuthError(err);
  }
}

document.getElementById('chatBack').addEventListener('click', () => showView('dialogs'));

async function loadMessages() {
  chatMessages.innerHTML = '';
  chatMessages.appendChild(el('div', { class: 'spinner' }));
  try {
    const rows = (await call('get_messages', { p_token: session.token, p_other_company_id: chatOther.id })) || [];
    chatMessages.innerHTML = '';
    rows.forEach((row) => {
      const mine = row.sender_company_id === session.id;
      chatMessages.appendChild(el('div', { class: `msg ${mine ? 'msg--out' : 'msg--in'}`, text: row.body }));
    });
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } catch (err) {
    if (handleAuthError(err)) return;
    chatMessages.innerHTML = '';
    showToast('Не удалось загрузить сообщения', 'error');
  }
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  try {
    await call('send_message', { p_token: session.token, p_other_company_id: chatOther.id, p_body: text });
    await loadMessages();
  } catch (err) {
    if (handleAuthError(err)) return;
    showToast(err instanceof ApiError ? err.message : 'Не удалось отправить сообщение', 'error');
  }
}

document.getElementById('chatSend').addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

/* ---------------------------- Init ---------------------------- */
loadFeed();
refreshInvitationsBadge();
refreshDialogsBadge();
setInterval(refreshInvitationsBadge, 20000);
setInterval(refreshDialogsBadge, 20000);
setInterval(() => {
  if (views.dialogs.classList.contains('is-active')) loadDialogs();
  if (views.chat.classList.contains('is-active') && chatOther) loadMessages();
}, 8000);

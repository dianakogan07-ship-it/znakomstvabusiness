// Drag/touch-жест свайпа карточки. Работает через Pointer Events —
// единый код для мыши и тач-жестов на телефоне.
export function makeSwipeable(cardEl, { onDecide, threshold = 100 } = {}) {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dy = 0;
  let dragging = false;
  let pointerId = null;
  let dragMoved = false;
  const CLICK_SUPPRESS_DISTANCE = 6;

  function setTransform(x, y, animate = false) {
    cardEl.style.transition = animate ? 'transform 0.35s ease, opacity 0.35s ease' : 'none';
    const rotate = x / 18;
    cardEl.style.transform = `translate(${x}px, ${y}px) rotate(${rotate}deg)`;
    const opacity = Math.max(1 - Math.abs(x) / 400, 0);
    cardEl.querySelectorAll('.swipe-badge--like').forEach((b) => (b.style.opacity = String(Math.max((x - 30) / 80, 0))));
    cardEl.querySelectorAll('.swipe-badge--nope').forEach((b) => (b.style.opacity = String(Math.max((-x - 30) / 80, 0))));
    void opacity;
  }

  function reset() {
    dx = 0;
    dy = 0;
    setTransform(0, 0, true);
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    dragMoved = false;
    pointerId = e.pointerId;
    cardEl.setPointerCapture?.(pointerId);
    startX = e.clientX;
    startY = e.clientY;
    cardEl.style.transition = 'none';
  }

  function onPointerMove(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    if (Math.abs(dx) > CLICK_SUPPRESS_DISTANCE || Math.abs(dy) > CLICK_SUPPRESS_DISTANCE) {
      dragMoved = true;
    }
    setTransform(dx, dy);
  }

  // Мышь (а иногда и тач) после отпускания кнопки в конце перетаскивания
  // всё равно шлёт обычный click — без этой проверки свайп карточки
  // попутно ещё и открывал попап "подробнее", будто что-то "дёргалось".
  function onClickCapture(e) {
    if (dragMoved) {
      e.stopPropagation();
      e.preventDefault();
      dragMoved = false;
    }
  }

  function finishDrag() {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(dx) > threshold) {
      const direction = dx > 0 ? 'right' : 'left';
      flyOut(direction);
    } else {
      reset();
    }
  }

  function onPointerUp(e) {
    if (e.pointerId !== pointerId) return;
    finishDrag();
  }

  function flyOut(direction) {
    const flyX = direction === 'right' ? window.innerWidth : -window.innerWidth;
    cardEl.style.transition = 'transform 0.4s ease, opacity 0.4s ease';
    cardEl.style.transform = `translate(${flyX}px, ${dy}px) rotate(${flyX / 18}deg)`;
    cardEl.style.opacity = '0';
    onDecide?.(direction);
  }

  cardEl.addEventListener('pointerdown', onPointerDown);
  cardEl.addEventListener('pointermove', onPointerMove);
  cardEl.addEventListener('pointerup', onPointerUp);
  cardEl.addEventListener('pointercancel', onPointerUp);
  cardEl.addEventListener('click', onClickCapture, { capture: true });

  return {
    programmaticDecide(direction) {
      dx = direction === 'right' ? threshold + 1 : -(threshold + 1);
      dy = 0;
      flyOut(direction);
    },
    destroy() {
      cardEl.removeEventListener('pointerdown', onPointerDown);
      cardEl.removeEventListener('pointermove', onPointerMove);
      cardEl.removeEventListener('pointerup', onPointerUp);
      cardEl.removeEventListener('pointercancel', onPointerUp);
      cardEl.removeEventListener('click', onClickCapture, { capture: true });
    },
  };
}

import { useEffect, useMemo, useState, useCallback, memo, useRef } from 'react';

const INGREDIENTS = [
  { key: 'egg', label: '味玉', image: '/assets/egg_720.png' },
  { key: 'negi', label: 'ねぎ', image: '/assets/negi_480.png' },
  { key: 'chashu', label: 'チャーシュー', image: '/assets/chashu.png' },
  { key: 'naruto', label: 'なると', image: '/assets/naruto.png' },
  { key: 'menma', label: 'メンマ', image: '/assets/menma.png' },
];
const INGREDIENT_KEYS = new Set(INGREDIENTS.map((i) => i.key));

// 具材ごとの初期サイズ（scale）
const BASE_SCALES = {
  egg: 1.0,        // 中くらい
  chashu: 1.30,    // 大きめ
  negi: 0.85,      // やや小さく
  menma: 0.75,     // 小さめ
  naruto: 0.95,    // 少しだけ小さく
};

// 具材ごとのベース幅（CSS長さ）
const BASE_SIZES = {
  egg: 'clamp(120px, 34vw, 190px)',
  chashu: 'clamp(140px, 38vw, 220px)',
  negi: 'clamp(100px, 30vw, 165px)',
  menma: 'clamp(96px, 28vw, 155px)',
  naruto: 'clamp(110px, 32vw, 175px)',
};

const STORAGE_KEY = 'ramen-tasks-v1';
const randomBetween = (min, max) => Math.random() * (max - min) + min;

const loadTasks = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t) =>
          t &&
          typeof t === 'object' &&
          typeof t.name === 'string' &&
          INGREDIENT_KEYS.has(t.ingredient)
      )
      .map((t) => ({
        ...t,
        position: confineToBowl(
          Number.isFinite(t.position?.left) ? t.position.left : randomBetween(26, 74),
          Number.isFinite(t.position?.top) ? t.position.top : randomBetween(30, 70)
        ),
        scale: Number.isFinite(t.scale) ? t.scale : BASE_SCALES[t.ingredient] ?? 1,
        locked: t.locked ?? false,
      }))
      .map((t) => ({
        ...t,
        position: {
          ...t.position,
          rotate: Number.isFinite(t.position?.rotate) ? t.position.rotate : randomBetween(-14, 14),
        },
      }));
  } catch (err) {
    console.error('failed to load tasks', err);
    return [];
  }
};

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const normalizeAngle = (rad) => {
  const pi = Math.PI;
  if (rad > pi) return rad - 2 * pi;
  if (rad < -pi) return rad + 2 * pi;
  return rad;
};

const confineToBowl = (left, top) => {
  // 0-100 (%) space; keep within inner circle so具が丼からはみ出さない
  left = clamp(left, 10, 90);
  top = clamp(top, 12, 88);

  const dx = left - 50;
  const dy = top - 50;
  const dist = Math.hypot(dx, dy);
  const maxR = 36; // tune to bowl interior
  if (dist > maxR) {
    const f = maxR / dist;
    left = 50 + dx * f;
    top = 50 + dy * f;
  }
  return { left, top };
};

const Topping = memo(function Topping({
  task,
  ingredient,
  onPointerDown,
  dragging,
  selected,
  onSelect,
  onScale,
  onRotate,
  onDelete,
  onEat,
  showEat
}) {
  const width = BASE_SIZES[task.ingredient] ?? 'clamp(110px, 32vw, 180px)';
  const labelColor = task.ingredient === 'naruto' ? '#1b120d' : '#ffffff';
  const labelShadow = task.ingredient === 'naruto' ? '0 1px 4px rgba(255,255,255,0.4)' : '0 2px 8px rgba(0, 0, 0, 0.6)';
  const style = {
    width,
    top: `${task.position.top}%`,
    left: `${task.position.left}%`,
    transform: `translate(-50%, -50%) rotate(${task.position.rotate}deg) scale(${task.scale ?? 1})`
  };

  return (
    <div
      className={`topping ${task.status === 'eating' ? 'eating' : ''} ${dragging ? 'dragging' : ''} ${selected ? 'selected' : ''} ${task.locked ? 'locked' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onClick={(e) => { e.stopPropagation(); if (!task.locked) onSelect?.(); }}
    >
      <img src={ingredient.image} alt={ingredient.label} draggable={false} />
      <div className="label" style={{ color: labelColor, textShadow: labelShadow }}>{task.name}</div>

      <div className="hover-actions">
        <button
          className="ghost small"
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
        >
          削除
        </button>
        {showEat && (
          <button
            className="accent small"
            type="button"
            onClick={(e) => { e.stopPropagation(); onEat?.(); }}
          >
            食べた！
          </button>
        )}
      </div>

      {selected && !task.locked && (
        <>
          <button
            className="handle rotate"
            type="button"
            onPointerDown={(e) => onRotate?.(e)}
            aria-label="回転"
          >
            ↻
          </button>
          <button className="handle corner tl" type="button" onPointerDown={(e) => onScale?.(e)} aria-label="拡大縮小" />
          <button className="handle corner tr" type="button" onPointerDown={(e) => onScale?.(e)} aria-label="拡大縮小" />
          <button className="handle corner bl" type="button" onPointerDown={(e) => onScale?.(e)} aria-label="拡大縮小" />
          <button className="handle corner br" type="button" onPointerDown={(e) => onScale?.(e)} aria-label="拡大縮小" />
        </>
      )}
    </div>
  );
});

export default function App() {
  const [tasks, setTasks] = useState(() => loadTasks());
  const [renderReady, setRenderReady] = useState(false);
  const [draggingId, setDraggingId] = useState(null); // 既存具のドラッグ
  const [draggingIngredient, setDraggingIngredient] = useState(null); // パレットからの新規具ドラッグ
  const [dragPreview, setDragPreview] = useState(null);
  const [dragPointer, setDragPointer] = useState(null); // 画面上のポインタ位置（ゴースト表示用）
  const [pendingTask, setPendingTask] = useState(null); // { ingredient, position }
  const [nameInput, setNameInput] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [transformSession, setTransformSession] = useState(null); // { type, id, startDist, startScale, center, startAngle, startRotate }
  const [confirmed, setConfirmed] = useState(false); // 一度でも「確定」したら true
  const [confirmLockOpen, setConfirmLockOpen] = useState(false); // 確定前の注意ポップアップ
  const transformSessionRef = useRef(null);
  const bowlRef = useRef(null);
  const nameInputRef = useRef(null);

  const ingredientMap = useMemo(
    () => Object.fromEntries(INGREDIENTS.map((i) => [i.key, i])),
    []
  );
  const hasTasks = tasks.length > 0;
  const allEaten = confirmed && tasks.length === 0;
  const bowlSrc = allEaten ? '/assets/don.png' : '/assets/don+chashu.png';
  const canEat = confirmed;

  const resetBowl = useCallback(() => {
    setTasks([]);
    setConfirmed(false);
    setSelectedId(null);
    setDraggingId(null);
    transformSessionRef.current = null;
    setTransformSession(null);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (err) {
      console.error('failed to save tasks', err);
    }
  }, [tasks]);

  // avoid hydration mismatch on SSR/Next; also delays heavy render until mounted
  useEffect(() => {
    setRenderReady(true);
  }, []);

  const positionFromEvent = useCallback((event) => {
    const rect = bowlRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const left = ((event.clientX - rect.left) / rect.width) * 100;
    const top = ((event.clientY - rect.top) / rect.height) * 100;
    if (Number.isNaN(left) || Number.isNaN(top)) return null;
    if (left < 0 || left > 100 || top < 0 || top > 100) return null; // outside bowl box
    return confineToBowl(left, top);
  }, []);

  const openTaskDialog = useCallback((ingredientKey, position) => {
    setPendingTask({ ingredient: ingredientKey, position });
    setNameInput('');
  }, []);

  const cancelTaskDialog = useCallback(() => {
    setPendingTask(null);
    setNameInput('');
  }, []);

  const submitTask = useCallback(() => {
    if (!pendingTask) return;
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    const newTask = {
      id: crypto.randomUUID(),
      name: trimmed,
      ingredient: pendingTask.ingredient,
      position: { ...pendingTask.position, rotate: randomBetween(-14, 14) },
      scale: BASE_SCALES[pendingTask.ingredient] ?? 1,
      status: 'ready',
      createdAt: Date.now(),
    };
    setTasks((prev) => [...prev, newTask]);
    setConfirmed(false); // 新しい具を追加したら完食フラグをリセット
    setPendingTask(null);
    setNameInput('');
  }, [nameInput, pendingTask]);

  useEffect(() => {
    if (!pendingTask) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [pendingTask]);

  useEffect(() => {
    if (pendingTask && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [pendingTask]);

  useEffect(() => {
    if (!confirmLockOpen) return undefined;
    const handler = (e) => {
      if (e.key === 'Escape') setConfirmLockOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [confirmLockOpen]);

  // モーダルが開いている間のEnter/Escapeショートカット
  useEffect(() => {
    if (!pendingTask) return undefined;
    const handler = (e) => {
      if (e.isComposing) return; // IME変換中は無視
      if (e.key === 'Enter') {
        e.preventDefault();
        submitTask();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelTaskDialog();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pendingTask, submitTask, cancelTaskDialog]);

  // 既存具のドラッグ移動
  const moveExistingDrag = useCallback((event, idOverride = null) => {
    const targetId = idOverride ?? draggingId;
    if (!targetId) return;
    const nextPos = positionFromEvent(event);
    if (!nextPos) return;

    setTasks((prev) =>
      prev.map((t) =>
        t.id === targetId
          ? { ...t, position: { ...t.position, top: nextPos.top, left: nextPos.left } }
          : t
      )
    );
  }, [draggingId, positionFromEvent]);

  const startExistingDrag = useCallback((id, event) => {
    const target = tasks.find((t) => t.id === id);
    if (target?.locked) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.pointerId && event.target?.setPointerCapture) {
      event.target.setPointerCapture(event.pointerId);
    }
    setDraggingId(id);
    setSelectedId(id);
    moveExistingDrag(event, id);
  }, [moveExistingDrag, tasks]);

  useEffect(() => {
    if (!draggingId) return;
    const handleUp = () => setDraggingId(null);
    const handleMove = (e) => moveExistingDrag(e);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [draggingId, moveExistingDrag]);

  // パレットから新規具をドラッグ＆ドロップ
  const startPaletteDrag = useCallback((ingredientKey, event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.pointerId && event.target?.setPointerCapture) {
      event.target.setPointerCapture(event.pointerId);
    }
    setDraggingIngredient(ingredientKey);
    setDragPointer({ x: event.clientX, y: event.clientY });
    const pos = positionFromEvent(event);
    setDragPreview(pos);
  }, [positionFromEvent]);

  useEffect(() => {
    if (!draggingIngredient) return;
    const handleMove = (e) => {
      setDragPointer({ x: e.clientX, y: e.clientY });
      const pos = positionFromEvent(e);
      setDragPreview(pos);
    };
    const handleUp = (e) => {
      const pos = positionFromEvent(e);
      if (pos) {
        openTaskDialog(draggingIngredient, pos);
      }
      setDraggingIngredient(null);
      setDragPreview(null);
      setDragPointer(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [draggingIngredient, positionFromEvent, openTaskDialog]);

  // スケール・回転のドラッグハンドル
  useEffect(() => {
    if (!transformSession) return;
    const handleMove = (e) => {
      const session = transformSessionRef.current || transformSession;
      if (!session) return;
      if (session.type === 'scale') {
        const dist = Math.hypot(e.clientX - session.center.x, e.clientY - session.center.y);
        const ratio = dist / session.startDist;
        const nextScale = clamp(session.startScale * ratio, 0.65, 1.3);
        setTasks((prev) =>
          prev.map((t) => (t.id === session.id ? { ...t, scale: nextScale } : t))
        );
      } else if (session.type === 'rotate') {
        const angle = Math.atan2(e.clientY - session.center.y, e.clientX - session.center.x);
        if (Number.isNaN(angle)) return;
        const delta = normalizeAngle(angle - session.lastAngle);
        const deg = session.accumRotate + (delta * 180) / Math.PI;
        setTasks((prev) =>
          prev.map((t) =>
            t.id === session.id
              ? { ...t, position: { ...t.position, rotate: deg } }
              : t
          )
        );
        const nextSession = { ...session, lastAngle: angle, accumRotate: deg };
        transformSessionRef.current = nextSession;
        setTransformSession(nextSession);
      }
    };
    const handleUp = () => {
      transformSessionRef.current = null;
      setTransformSession(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
    window.addEventListener('pointercancel', handleUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [transformSession]);

  const handleComplete = useCallback((id) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: 'eating' } : t))
    );
    setTimeout(() => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
    }, 260);
  }, []);

  const removeTask = useCallback((id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  const confirmToday = useCallback(() => {
    if (tasks.length === 0) return;
    setTasks((prev) => prev.map((t) => ({ ...t, locked: true })));
    setConfirmed(true);
    setSelectedId(null);
    setDraggingId(null);
    transformSessionRef.current = null;
    setTransformSession(null);
    setConfirmLockOpen(false);
  }, [tasks.length]);

  const getCenterPx = useCallback((task) => {
    const rect = bowlRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: rect.left + (task.position.left / 100) * rect.width,
      y: rect.top + (task.position.top / 100) * rect.height,
    };
  }, []);

  const startScale = useCallback((task, event) => {
    if (task.locked) return;
    event.stopPropagation();
    event.preventDefault();
    if (event.pointerId && event.target?.setPointerCapture) {
      event.target.setPointerCapture(event.pointerId);
    }
    const center = getCenterPx(task);
    if (!center) return;
    const startDist = Math.hypot(event.clientX - center.x, event.clientY - center.y);
    const session = {
      type: 'scale',
      id: task.id,
      startDist: Math.max(startDist, 1),
      startScale: task.scale ?? 1,
      center,
    };
    transformSessionRef.current = session;
    setTransformSession(session);
  }, [getCenterPx]);

  const startRotate = useCallback((task, event) => {
    if (task.locked) return;
    event.stopPropagation();
    event.preventDefault();
    if (event.pointerId && event.target?.setPointerCapture) {
      event.target.setPointerCapture(event.pointerId);
    }
    const center = getCenterPx(task);
    if (!center) return;
    const startAngle = Math.atan2(event.clientY - center.y, event.clientX - center.x);
    const session = {
      type: 'rotate',
      id: task.id,
      lastAngle: startAngle,
      accumRotate: task.position.rotate ?? 0,
      center,
    };
    transformSessionRef.current = session;
    setTransformSession(session);
  }, [getCenterPx]);

  return (
    <div className="page">
      <div className="headline">🍜 ラーメンをモチーフにした Todo 丼</div>

      <div className="panel confirm-bar">
        <div>
          <div className="confirm-title">今日のタスクを確定</div>
          <div className="confirm-note">確定すると今ある具は動かせなくなります（新しく追加した具は動かせます）。</div>
        </div>
        <button onClick={() => setConfirmLockOpen(true)} disabled={!hasTasks}>確定する</button>
      </div>

      <div className="panel">
        <div className="palette-header">具材をドラッグして丼に入れ、名前を付けてください</div>
        <div className="palette" role="list">
          {INGREDIENTS.map((ing) => (
            <button
              key={ing.key}
              type="button"
              className="palette-item"
              onPointerDown={(e) => startPaletteDrag(ing.key, e)}
              onClick={() => {
                const pos = { top: randomBetween(30, 70), left: randomBetween(26, 74) };
                openTaskDialog(ing.key, confineToBowl(pos.left, pos.top));
              }}
            >
              <img src={ing.image} alt={ing.label} />
              <div className="palette-label">{ing.label}</div>
              <div className="palette-hint">ドラッグで追加</div>
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className={`bowl-wrapper ${draggingIngredient ? 'drag-target' : ''}`} ref={bowlRef}>
          <img
            src={bowlSrc}
            alt="ラーメンのどんぶり"
            className="bowl"
            draggable={false}
          />

          {renderReady && draggingIngredient && dragPreview && (
            <div
              className="topping drag-preview"
              style={{
                top: `${dragPreview.top}%`,
                left: `${dragPreview.left}%`,
                transform: 'translate(-50%, -50%)'
              }}
            >
              <img
                src={ingredientMap[draggingIngredient].image}
                alt={ingredientMap[draggingIngredient].label}
                draggable={false}
              />
            </div>
          )}

          {renderReady &&
            tasks.map((task) => (
              ingredientMap[task.ingredient] ? (
              <Topping
                key={task.id}
                task={task}
                ingredient={ingredientMap[task.ingredient]}
                onPointerDown={(e) => startExistingDrag(task.id, e)}
                dragging={draggingId === task.id}
                selected={selectedId === task.id}
                onSelect={() => setSelectedId(task.id)}
                onScale={(e) => startScale(task, e)}
                onRotate={(e) => startRotate(task, e)}
                onDelete={() => removeTask(task.id)}
                onEat={() => handleComplete(task.id)}
                showEat={canEat}
              />
              ) : null
            ))}

          {allEaten && (
            <div className="finish-overlay">
              <div className="finish-stack">
                <div className="finish-text">完食！</div>
                <button className="accent restart" onClick={resetBowl}>
                  もう一杯！
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {renderReady && draggingIngredient && dragPointer && (
        <div
          className="cursor-ghost"
          style={{ top: dragPointer.y, left: dragPointer.x }}
        >
          <img
            src={ingredientMap[draggingIngredient].image}
            alt={ingredientMap[draggingIngredient].label}
            draggable={false}
          />
        </div>
      )}

      {pendingTask && (
        <div className="modal-backdrop" role="presentation" onClick={cancelTaskDialog}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">具の名前を入力</div>
            <div className="modal-row">
              <img
                src={ingredientMap[pendingTask.ingredient].image}
                alt={ingredientMap[pendingTask.ingredient].label}
                className="modal-thumb"
                draggable={false}
              />
              <div className="modal-info">
                <div className="modal-label">{ingredientMap[pendingTask.ingredient].label}</div>
                <input
                  ref={nameInputRef}
                  type="text"
                  placeholder="例: 資料作成 / 洗濯物 / 買い出し"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitTask();
                    if (e.key === 'Escape') cancelTaskDialog();
                  }}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="ghost" onClick={cancelTaskDialog}>キャンセル</button>
              <button disabled={!nameInput.trim()} onClick={submitTask}>追加する</button>
            </div>
          </div>
        </div>
      )}

      {confirmLockOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setConfirmLockOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">確定すると編集できなくなります</div>
            <p className="modal-note">既存の具はドラッグ・回転・拡大縮小できなくなります。よろしいですか？</p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setConfirmLockOpen(false)}>やめる</button>
              <button onClick={confirmToday}>確定する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

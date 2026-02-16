import { useEffect, useMemo, useState, useCallback, memo, useRef } from 'react';

const INGREDIENTS = [
  { key: 'egg', label: '味玉', image: '/assets/egg_720.png' },
  { key: 'negi', label: 'ねぎ', image: '/assets/negi_480.png' },
  { key: 'chashu', label: 'チャーシュー', image: '/assets/chashu.png' },
  { key: 'naruto', label: 'なると', image: '/assets/naruto.png' },
  { key: 'menma', label: 'メンマ', image: '/assets/menma.png' },
];

const STORAGE_KEY = 'ramen-tasks-v1';
const randomBetween = (min, max) => Math.random() * (max - min) + min;

const loadTasks = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t) => ({
      ...t,
      position: {
        ...t.position,
        rotate: t.position?.rotate ?? randomBetween(-14, 14),
      },
      scale: t.scale ?? 1,
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
  onRotate
}) {
  const style = {
    top: `${task.position.top}%`,
    left: `${task.position.left}%`,
    transform: `translate(-50%, -50%) rotate(${task.position.rotate}deg) scale(${task.scale ?? 1})`
  };

  return (
    <div
      className={`topping ${task.status === 'eating' ? 'eating' : ''} ${dragging ? 'dragging' : ''} ${selected ? 'selected' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
    >
      <img src={ingredient.image} alt={ingredient.label} draggable={false} />
      <div className="label">{task.name}</div>

      {selected && (
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
  const transformSessionRef = useRef(null);
  const bowlRef = useRef(null);
  const nameInputRef = useRef(null);

  const ingredientMap = useMemo(
    () => Object.fromEntries(INGREDIENTS.map((i) => [i.key, i])),
    []
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
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
      scale: 1,
      status: 'ready',
      createdAt: Date.now(),
    };
    setTasks((prev) => [...prev, newTask]);
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
    event.preventDefault();
    event.stopPropagation();
    if (event.pointerId && event.target?.setPointerCapture) {
      event.target.setPointerCapture(event.pointerId);
    }
    setDraggingId(id);
    setSelectedId(id);
    moveExistingDrag(event, id);
  }, [moveExistingDrag]);

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

  const getCenterPx = useCallback((task) => {
    const rect = bowlRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: rect.left + (task.position.left / 100) * rect.width,
      y: rect.top + (task.position.top / 100) * rect.height,
    };
  }, []);

  const startScale = useCallback((task, event) => {
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
            src="/assets/don+chashu.png"
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
              />
            ))}
        </div>
      </div>

      <div className="panel list">
        {tasks.length === 0 && <div className="mini">具をドラッグして追加してください。</div>}
        {tasks.map((task) => (
          <div key={task.id} className="list-item">
            <div className="name">{task.name}</div>
            <div className="mini">{ingredientMap[task.ingredient]?.label}</div>
            <div className="list-actions">
              <button className="ghost" onClick={() => removeTask(task.id)}>削除</button>
              <button onClick={() => handleComplete(task.id)}>食べた！</button>
            </div>
          </div>
        ))}
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
    </div>
  );
}

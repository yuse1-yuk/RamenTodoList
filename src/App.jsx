import { useEffect, useMemo, useState, useCallback, memo, useRef } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

const INGREDIENTS = [
  { key: 'egg', label: '味玉', image: '/assets/egg_720.png' },
  { key: 'negi', label: 'ねぎ', image: '/assets/negi_480.png' },
  { key: 'chashu', label: 'チャーシュー', image: '/assets/chashu.png' },
  { key: 'naruto', label: 'なると', image: '/assets/naruto.png' },
  { key: 'menma', label: 'メンマ', image: '/assets/menma.png' },
  { key: 'nori', label: 'のり', image: '/assets/nori.png' },
];
const INGREDIENT_KEYS = new Set(INGREDIENTS.map((i) => i.key));

// 具材ごとの初期サイズ（scale）
const BASE_SCALES = {
  egg: 1.0,        // 中くらい
  chashu: 1.30,    // 大きめ
  negi: 0.85,      // やや小さく
  menma: 0.75,     // 小さめ
  naruto: 0.95,    // 少しだけ小さく
  nori: 0.78,      // 小さめ
};

// 具材ごとのベース幅（CSS長さ）
const BASE_SIZES = {
  egg: 'clamp(120px, 34vw, 190px)',
  chashu: 'clamp(140px, 38vw, 220px)',
  negi: 'clamp(100px, 30vw, 165px)',
  menma: 'clamp(96px, 28vw, 155px)',
  naruto: 'clamp(110px, 32vw, 175px)',
  nori: 'clamp(86px, 24vw, 136px)',
};

const TASK_STORAGE_PREFIX = 'ramen-tasks-v1';
const GUEST_TASK_STORAGE_KEY = `${TASK_STORAGE_PREFIX}-guest`;
const DRAG_START_DISTANCE_PX = 4;
const SAVE_DEBOUNCE_MS = 220;
const randomBetween = (min, max) => Math.random() * (max - min) + min;
const getTaskStorageKey = (accountId) => `${TASK_STORAGE_PREFIX}-${accountId}`;
const getUserTasksDocRef = (uid) => doc(db, 'users', uid, 'apps', 'ramenTodo');
const defaultRotateForIngredient = (ingredient) => {
  if (ingredient === 'nori') {
    const sign = Math.random() < 0.5 ? -1 : 1;
    return sign * randomBetween(8, 22);
  }
  return randomBetween(-14, 14);
};

const mapAuthError = (code) => {
  const messages = {
    'auth/invalid-email': 'メールアドレスの形式が正しくありません。',
    'auth/missing-password': 'パスワードを入力してください。',
    'auth/weak-password': 'パスワードは6文字以上にしてください。',
    'auth/email-already-in-use': 'このメールアドレスは既に登録されています。',
    'auth/user-not-found': 'ユーザーが見つかりません。',
    'auth/wrong-password': 'パスワードが違います。',
    'auth/invalid-credential': 'メールアドレスまたはパスワードが正しくありません。',
    'auth/popup-closed-by-user': 'Googleログインがキャンセルされました。',
    'auth/cancelled-popup-request': 'Googleログインをもう一度試してください。',
    'auth/popup-blocked': 'ポップアップがブロックされました。許可して再試行してください。',
    'auth/unauthorized-domain': 'Firebase の許可ドメイン設定を確認してください。',
    'auth/network-request-failed': 'ネットワークエラーです。接続を確認してください。',
  };
  return messages[code] ?? 'ログインに失敗しました。時間をおいて再試行してください。';
};

const sanitizeTasks = (parsed) => {
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
        rotate: Number.isFinite(t.position?.rotate)
          ? t.position.rotate
          : defaultRotateForIngredient(t.ingredient),
        },
      }));
};

const serializeTasks = (tasks) =>
  sanitizeTasks(tasks).map((t) => ({
    id: t.id,
    name: t.name,
    ingredient: t.ingredient,
    position: {
      left: t.position.left,
      top: t.position.top,
      rotate: t.position.rotate,
    },
    scale: t.scale ?? BASE_SCALES[t.ingredient] ?? 1,
    status: 'ready',
    locked: !!t.locked,
    createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
  }));

const loadTasks = (storageKey) => {
  try {
    if (!storageKey) return [];
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    return sanitizeTasks(JSON.parse(raw));
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
  transforming,
  selected,
  onSelect,
  onScale,
  onRotate,
  onDelete,
  onArmDelete,
  deleteArmed,
  onEat,
  showEat
}) {
  const width = BASE_SIZES[task.ingredient] ?? 'clamp(110px, 32vw, 180px)';
  const labelColor = task.ingredient === 'naruto' ? '#1b120d' : '#ffffff';
  const labelShadow =
    task.ingredient === 'naruto'
      ? '0 1px 4px rgba(255,255,255,0.4)'
      : '0 2px 8px rgba(0, 0, 0, 0.6)';
  const style = {
    width,
    top: `${task.position.top}%`,
    left: `${task.position.left}%`,
    transform: `translate(-50%, -50%) rotate(${task.position.rotate}deg) scale(${task.scale ?? 1})`
  };

  return (
    <div
      className={`topping ingredient-${task.ingredient} ${task.status === 'eating' ? 'eating' : ''} ${dragging ? 'dragging' : ''} ${transforming ? 'transforming' : ''} ${selected ? 'selected' : ''} ${task.locked ? 'locked' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
    >
      <img src={ingredient.image} alt={ingredient.label} draggable={false} />
      <div className="label" style={{ color: labelColor, textShadow: labelShadow }}>{task.name}</div>

      <div className="hover-actions">
        <button
          className={`ghost small delete ${deleteArmed ? 'armed' : ''}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (deleteArmed) onDelete?.();
            else onArmDelete?.();
          }}
          aria-label={deleteArmed ? 'もう一度押して削除を実行' : '削除（2回押すと実行）'}
        >
          {deleteArmed ? '削除実行' : '削除×2'}
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
  const [tasks, setTasks] = useState([]);
  const [renderReady, setRenderReady] = useState(false);
  const [draggingId, setDraggingId] = useState(null); // 既存具のドラッグ
  const [draggingIngredient, setDraggingIngredient] = useState(null); // パレットからの新規具ドラッグ
  const [dragPreview, setDragPreview] = useState(null);
  const [dragPointer, setDragPointer] = useState(null); // 画面上のポインタ位置（ゴースト表示用）
  const [pendingTask, setPendingTask] = useState(null); // { ingredient, position }
  const [nameInput, setNameInput] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [deleteArmedId, setDeleteArmedId] = useState(null);
  const [transformSession, setTransformSession] = useState(null); // { type, id, startDist, startScale, center, startAngle, startRotate }
  const [confirmed, setConfirmed] = useState(false); // 一度でも「確定」したら true
  const [confirmLockOpen, setConfirmLockOpen] = useState(false); // 確定前の注意ポップアップ
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // login | signup
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [showGoogleAuth, setShowGoogleAuth] = useState(false);
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  const [pendingConfirmAfterAuth, setPendingConfirmAfterAuth] = useState(false);
  const transformSessionRef = useRef(null);
  const pendingExistingDragRef = useRef(null);
  const deleteArmTimerRef = useRef(null);
  const bowlRef = useRef(null);
  const nameInputRef = useRef(null);

  const ingredientMap = useMemo(
    () => Object.fromEntries(INGREDIENTS.map((i) => [i.key, i])),
    []
  );
  const taskStorageKey = authUser ? getTaskStorageKey(authUser.uid) : GUEST_TASK_STORAGE_KEY;
  const hasTasks = tasks.length > 0;
  const allEaten = confirmed && tasks.length === 0;
  const bowlSrc = allEaten ? '/assets/don.png' : '/assets/don+chashu.png';
  const canEat = confirmed;

  const clearInteractionState = useCallback(() => {
    setConfirmed(false);
    setSelectedId(null);
    setDraggingId(null);
    setDraggingIngredient(null);
    setDragPreview(null);
    setDragPointer(null);
    setPendingTask(null);
    setNameInput('');
    setDeleteArmedId(null);
    setConfirmLockOpen(false);
    pendingExistingDragRef.current = null;
    if (deleteArmTimerRef.current) {
      window.clearTimeout(deleteArmTimerRef.current);
      deleteArmTimerRef.current = null;
    }
    transformSessionRef.current = null;
    setTransformSession(null);
  }, []);

  useEffect(() => () => {
    if (deleteArmTimerRef.current) {
      window.clearTimeout(deleteArmTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setAuthUser(nextUser);
      setAuthReady(true);
      setAuthError('');
      setSyncError('');
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    clearInteractionState();
    setSyncError('');
    if (!taskStorageKey) {
      setTasks([]);
      return;
    }
    let active = true;
    const userCachedTasks = authUser ? loadTasks(taskStorageKey) : [];
    const guestCachedTasks = authUser ? loadTasks(GUEST_TASK_STORAGE_KEY) : [];
    const cachedTasks = authUser
      ? (userCachedTasks.length > 0 ? userCachedTasks : guestCachedTasks)
      : loadTasks(taskStorageKey);
    setTasks(cachedTasks);

    if (authUser && userCachedTasks.length === 0 && guestCachedTasks.length > 0) {
      try {
        localStorage.setItem(taskStorageKey, JSON.stringify(guestCachedTasks));
      } catch (cacheErr) {
        console.error('failed to migrate guest cache', cacheErr);
      }
    }

    if (!authUser) {
      return () => {
        active = false;
      };
    }

    const hydrateFromCloud = async () => {
      try {
        const ref = getUserTasksDocRef(authUser.uid);
        const snap = await getDoc(ref);
        if (!active) return;
        const data = snap.data() ?? {};
        const remoteRaw = Array.isArray(data.items)
          ? data.items
          : Array.isArray(data.tasks)
            ? data.tasks
            : Array.isArray(data.tasks?.items)
              ? data.tasks.items
            : null;
        if (Array.isArray(remoteRaw)) {
          const remoteTasks = sanitizeTasks(remoteRaw);
          setTasks(remoteTasks);
          try {
            localStorage.setItem(taskStorageKey, JSON.stringify(remoteTasks));
          } catch (cacheErr) {
            console.error('failed to cache remote tasks', cacheErr);
          }
          return;
        }
        if (cachedTasks.length > 0) {
          const serialized = serializeTasks(cachedTasks);
          await setDoc(
            ref,
            { items: serialized, taskCount: serialized.length, savedAt: serverTimestamp() },
            { merge: true }
          );
        }
      } catch (err) {
        console.error('failed to load cloud tasks', err);
        if (active) {
          setSyncError('クラウド同期に失敗したため、端末保存データを使用しています。');
        }
      }
    };

    hydrateFromCloud();
    return () => {
      active = false;
    };
  }, [authUser, taskStorageKey, clearInteractionState]);

  const resetBowl = useCallback(() => {
    setTasks([]);
    clearInteractionState();
  }, [clearInteractionState]);

  useEffect(() => {
    // ドラッグ/変形中の同期保存は体感を悪化させるので、操作停止後にまとめて保存する
    if (!taskStorageKey) return undefined;
    if (draggingId || draggingIngredient || transformSession) return undefined;
    const timer = window.setTimeout(() => {
      const serialized = serializeTasks(tasks);
      try {
        localStorage.setItem(taskStorageKey, JSON.stringify(serialized));
      } catch (err) {
        console.error('failed to save tasks', err);
      }
      if (!authUser) return;
      void (async () => {
        try {
          await setDoc(
            getUserTasksDocRef(authUser.uid),
            { items: serialized, taskCount: serialized.length, savedAt: serverTimestamp() },
            { merge: true }
          );
          setSyncError('');
        } catch (err) {
          console.error('failed to save cloud tasks', err);
          setSyncError('クラウド保存に失敗しました。ネットワーク状態を確認してください。');
        }
      })();
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [tasks, draggingId, draggingIngredient, transformSession, authUser, taskStorageKey]);

  const clearAuthForm = useCallback(() => {
    setPasswordInput('');
    setDisplayNameInput('');
    setAuthError('');
  }, []);

  const handleEmailAuth = useCallback(async () => {
    const email = emailInput.trim();
    const password = passwordInput.trim();
    if (!email || !password) {
      setAuthError('メールアドレスとパスワードを入力してください。');
      return;
    }
    if (authMode === 'signup' && displayNameInput.trim().length === 0) {
      setAuthError('表示名を入力してください。');
      return;
    }
    setAuthSubmitting(true);
    setAuthError('');
    try {
      if (authMode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: displayNameInput.trim() });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      clearAuthForm();
      setEmailInput('');
    } catch (err) {
      setAuthError(mapAuthError(err?.code));
    } finally {
      setAuthSubmitting(false);
    }
  }, [authMode, clearAuthForm, displayNameInput, emailInput, passwordInput]);

  const handleGoogleLogin = useCallback(async () => {
    setAuthSubmitting(true);
    setAuthError('');
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      setAuthError(mapAuthError(err?.code));
    } finally {
      setAuthSubmitting(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    setAuthSubmitting(true);
    setAuthError('');
    try {
      await signOut(auth);
      setEmailInput('');
      clearAuthForm();
    } catch (err) {
      setAuthError(mapAuthError(err?.code));
    } finally {
      setAuthSubmitting(false);
    }
  }, [clearAuthForm]);

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
      position: {
        ...pendingTask.position,
        rotate: defaultRotateForIngredient(pendingTask.ingredient),
      },
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
    if (target?.locked) {
      setSelectedId(id);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.pointerId && event.target?.setPointerCapture) {
      event.target.setPointerCapture(event.pointerId);
    }
    setSelectedId(id);
    pendingExistingDragRef.current = {
      id,
      pointerId: event.pointerId ?? null,
      startX: event.clientX,
      startY: event.clientY,
    };
  }, [tasks]);

  useEffect(() => {
    const handleMove = (e) => {
      if (draggingId) {
        moveExistingDrag(e);
        return;
      }
      const pending = pendingExistingDragRef.current;
      if (!pending) return;
      if (pending.pointerId != null && e.pointerId != null && pending.pointerId !== e.pointerId) return;
      const distance = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
      if (distance < DRAG_START_DISTANCE_PX) return;
      pendingExistingDragRef.current = null;
      setDraggingId(pending.id);
      moveExistingDrag(e, pending.id);
    };
    const handleUp = (e) => {
      const pending = pendingExistingDragRef.current;
      if (pending && pending.pointerId != null && e.pointerId != null && pending.pointerId !== e.pointerId) return;
      pendingExistingDragRef.current = null;
      setDraggingId(null);
    };
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
        const nextScale = clamp(session.startScale * Math.pow(ratio, 0.92), 0.55, 1.55);
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
    if (deleteArmedId === id) setDeleteArmedId(null);
    if (deleteArmTimerRef.current) {
      window.clearTimeout(deleteArmTimerRef.current);
      deleteArmTimerRef.current = null;
    }
  }, [deleteArmedId, selectedId]);

  const armDelete = useCallback((id) => {
    setDeleteArmedId(id);
    if (deleteArmTimerRef.current) {
      window.clearTimeout(deleteArmTimerRef.current);
    }
    deleteArmTimerRef.current = window.setTimeout(() => {
      setDeleteArmedId(null);
      deleteArmTimerRef.current = null;
    }, 1400);
  }, []);

  const confirmToday = useCallback(() => {
    if (tasks.length === 0) return;
    setTasks((prev) => prev.map((t) => ({ ...t, locked: true })));
    setConfirmed(true);
    setSelectedId(null);
    setDraggingId(null);
    pendingExistingDragRef.current = null;
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
    pendingExistingDragRef.current = null;
    setDraggingId(null);
    const center = getCenterPx(task);
    if (!center) return;
    const startDist = Math.hypot(event.clientX - center.x, event.clientY - center.y);
    const session = {
      type: 'scale',
      id: task.id,
      startDist: Math.max(startDist, 24),
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
    pendingExistingDragRef.current = null;
    setDraggingId(null);
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

  useEffect(() => {
    if (!authUser || !pendingConfirmAfterAuth) return;
    setPendingConfirmAfterAuth(false);
    setAuthPromptOpen(false);
    if (tasks.length > 0) setConfirmLockOpen(true);
  }, [authUser, pendingConfirmAfterAuth, tasks.length]);

  useEffect(() => {
    if (!authUser || !authPromptOpen || pendingConfirmAfterAuth) return;
    setAuthPromptOpen(false);
  }, [authUser, authPromptOpen, pendingConfirmAfterAuth]);

  const openAuthPrompt = useCallback((forConfirm = false) => {
    setAuthMode('login');
    setAuthError(forConfirm ? '確定するにはログインしてください。' : '');
    setShowGoogleAuth(false);
    setPendingConfirmAfterAuth(forConfirm);
    setAuthPromptOpen(true);
  }, []);

  const closeAuthPrompt = useCallback(() => {
    if (authSubmitting) return;
    setAuthPromptOpen(false);
    setPendingConfirmAfterAuth(false);
    setAuthError('');
    setShowGoogleAuth(false);
  }, [authSubmitting]);

  const handleConfirmIntent = useCallback(() => {
    if (!hasTasks) return;
    if (!authUser) {
      openAuthPrompt(true);
      return;
    }
    setConfirmLockOpen(true);
  }, [authUser, hasTasks, openAuthPrompt]);

  return (
    <div className="page">
      <div className="headline">🍜 EATO</div>

      {authUser && (
        <div className="panel account-bar">
          <div className="account-info">
            <div className="account-meta">
              <span className="account-chip">ログイン中</span>
              <span className="account-name">{authUser.displayName || authUser.email}</span>
            </div>
            {syncError && <div className="account-sync-error">{syncError}</div>}
          </div>
          <button type="button" className="account-logout" onClick={handleLogout} disabled={authSubmitting}>
            ログアウト
          </button>
        </div>
      )}

      <div className="panel confirm-bar">
        <div>
          <div className="confirm-title">今日のタスクを確定</div>
          <div className="confirm-note">確定すると今ある具は動かせなくなります（新しく追加した具は動かせます）。</div>
        </div>
        <button onClick={handleConfirmIntent} disabled={!hasTasks}>確定する</button>
      </div>

      <div className="panel">
        <div className="palette-header">具材をドラッグして丼に入れ、名前を付けてください</div>
        <div className="palette" role="list">
          {INGREDIENTS.map((ing) => (
            <button
              key={ing.key}
              type="button"
              className={`palette-item is-${ing.key}`}
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
                transforming={transformSession?.id === task.id}
                selected={selectedId === task.id}
                onSelect={() => setSelectedId(task.id)}
                onScale={(e) => startScale(task, e)}
                onRotate={(e) => startRotate(task, e)}
                onDelete={() => removeTask(task.id)}
                onArmDelete={() => armDelete(task.id)}
                deleteArmed={deleteArmedId === task.id}
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

      {authPromptOpen && !authUser && (
        <div className="modal-backdrop" role="presentation" onClick={closeAuthPrompt}>
          <div className="modal auth-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              {pendingConfirmAfterAuth ? '確定するにはログインが必要です' : 'ログイン'}
            </div>
            {!authReady ? (
              <div className="auth-loading">ログイン状態を確認中...</div>
            ) : (
              <>
                <div className="auth-mode-tabs">
                  <button
                    type="button"
                    className={`auth-tab ${authMode === 'login' ? 'active' : ''}`}
                    onClick={() => {
                      setAuthMode('login');
                      setAuthError('');
                    }}
                    disabled={authSubmitting}
                  >
                    メールログイン
                  </button>
                  <button
                    type="button"
                    className={`auth-tab ${authMode === 'signup' ? 'active' : ''}`}
                    onClick={() => {
                      setAuthMode('signup');
                      setAuthError('');
                    }}
                    disabled={authSubmitting}
                  >
                    新規登録
                  </button>
                </div>

                <form
                  className="auth-fields"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleEmailAuth();
                  }}
                >
                  {authMode === 'signup' && (
                    <>
                      <label className="auth-label" htmlFor="auth-display-name">表示名</label>
                      <input
                        id="auth-display-name"
                        type="text"
                        value={displayNameInput}
                        autoComplete="nickname"
                        onChange={(e) => setDisplayNameInput(e.target.value)}
                        disabled={authSubmitting}
                      />
                    </>
                  )}
                  <label className="auth-label" htmlFor="auth-email">メールアドレス</label>
                  <input
                    id="auth-email"
                    type="email"
                    value={emailInput}
                    autoComplete="email"
                    onChange={(e) => setEmailInput(e.target.value)}
                    disabled={authSubmitting}
                  />
                  <label className="auth-label" htmlFor="auth-password">パスワード</label>
                  <input
                    id="auth-password"
                    type="password"
                    value={passwordInput}
                    autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    disabled={authSubmitting}
                  />

                  {authError && <div className="auth-error">{authError}</div>}

                  <div className="modal-actions">
                    <button type="button" className="ghost" onClick={closeAuthPrompt} disabled={authSubmitting}>
                      あとで
                    </button>
                    <button type="submit" disabled={authSubmitting}>
                      {authSubmitting ? '処理中...' : authMode === 'signup' ? '登録して続ける' : 'ログイン'}
                    </button>
                  </div>
                </form>

                <div className="auth-actions">
                  {!showGoogleAuth ? (
                    <button
                      type="button"
                      className="auth-google"
                      onClick={() => {
                        setShowGoogleAuth(true);
                        setAuthError('');
                      }}
                      disabled={authSubmitting}
                    >
                      Googleアカウントを使う
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="auth-google"
                      onClick={() => void handleGoogleLogin()}
                      disabled={authSubmitting}
                    >
                      Googleでログイン
                    </button>
                  )}
                  <button
                    type="button"
                    className="auth-secondary-toggle"
                    onClick={() => {
                      setAuthMode((prev) => (prev === 'login' ? 'signup' : 'login'));
                      setAuthError('');
                    }}
                    disabled={authSubmitting}
                  >
                    {authMode === 'login' ? '新規登録に切り替える' : 'ログインに切り替える'}
                  </button>
                </div>

                <div className="auth-note">
                  タスクの作成は未ログインでも可能です。確定時のみログインが必要です。
                </div>
              </>
            )}
          </div>
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

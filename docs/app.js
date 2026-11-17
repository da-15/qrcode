'use strict';

const $ = (id) => document.getElementById(id);
const video = $('video'), canvas = $('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
const msg = $('msg'), result = $('result'), text = $('text');

let stream = null;
let scanning = false;
let torchOn = false;
let detector = null;

// ネイティブの BarcodeDetector があれば優先（高速）、なければ jsQR
if ('BarcodeDetector' in window) {
  BarcodeDetector.getSupportedFormats?.().then((f) => {
    if (f.includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] });
  }).catch(() => {});
}

async function startCamera() {
  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    startRender();
    msg.textContent = 'QRコードを枠内に合わせてください';
    setupTorch();
    scanning = true;
    requestAnimationFrame(tick);
  } catch (e) {
    console.error(e);
    msg.textContent = location.protocol !== 'https:' && location.hostname !== 'localhost'
      ? 'カメラにはHTTPS接続が必要です'
      : 'カメラを使えません（権限を確認してください）。「画像から読む」も使えます';
  }
}

// 映像は <video> をそのまま見せず、表示用 canvas に毎フレーム描く。
// iPhoneは <video> の表示サイズを起動直後に小さく描くことがあるため、
// 描く大きさを自分で決めて、最初から枠いっぱいに表示する
const view = $('view'), viewCtx = view.getContext('2d');
let rendering = false;

function fitView() {
  const r = view.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (w && h && (view.width !== w || view.height !== h)) { view.width = w; view.height = h; }
}
new ResizeObserver(fitView).observe(view);

function startRender() {
  if (rendering) return;
  rendering = true;
  const draw = () => {
    if (!stream) { rendering = false; return; }
    const vw = video.videoWidth, vh = video.videoHeight;
    if (vw && vh && view.width && view.height) {
      // object-fit: cover と同じ切り抜き
      const scale = Math.max(view.width / vw, view.height / vh);
      const dw = vw * scale, dh = vh * scale;
      viewCtx.drawImage(video, (view.width - dw) / 2, (view.height - dh) / 2, dw, dh);
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

function stopCamera() {
  scanning = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  viewCtx.clearRect(0, 0, view.width, view.height);
}

function setupTorch() {
  const track = stream?.getVideoTracks()[0];
  // 他の画面やアプリにカメラを奪われたら、表示中なら起動し直す
  if (track) track.onended = () => {
    if (!document.hidden && !historyOpen() && !result.classList.contains('show')) startCamera();
  };
  const caps = track?.getCapabilities?.() || {};
  // ライト非対応の端末（iPhoneなど）では薄く表示
  $('btnTorch').classList.toggle('unavailable', !caps.torch);
  torchOn = false;
  $('btnTorch').setAttribute('aria-pressed', 'false');
}

let msgTimer = null;
function flashMsg(t) {
  const prev = 'QRコードを枠内に合わせてください';
  msg.textContent = t;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => (msg.textContent = prev), 2500);
}

$('btnTorch').onclick = async () => {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  if ($('btnTorch').classList.contains('unavailable')) { flashMsg('この端末ではライトを使えません'); return; }
  torchOn = !torchOn;
  try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); }
  catch { torchOn = false; }
  $('btnTorch').setAttribute('aria-pressed', String(torchOn));
};

let lastScan = 0;
async function tick(ts) {
  if (!scanning) return;
  // 約10fpsに間引いてバッテリー節約
  if (ts - lastScan > 100 && video.readyState === video.HAVE_ENOUGH_DATA) {
    lastScan = ts;
    const data = await decodeSource(video, video.videoWidth, video.videoHeight);
    if (data) return onDetected(data);
  }
  requestAnimationFrame(tick);
}

async function decodeSource(source, w, h) {
  if (detector) {
    try {
      const codes = await detector.detect(source);
      if (codes.length) return codes[0].rawValue;
      return null;
    } catch { /* jsQRにフォールバック */ }
  }
  // 大きすぎる画像は縮小して処理
  const scale = Math.min(1, 1024 / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
  return code ? code.data : null;
}

function onDetected(data) {
  scanning = false;
  navigator.vibrate?.(80);
  saveHistory(data);
  showResult(data);
}

function isUrl(s) {
  try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol); } catch { return false; }
}

function showResult(data) {
  text.textContent = data;
  const open = $('btnOpen');
  if (isUrl(data)) {
    open.href = data;
    const sameApp = data.startsWith(new URL('./', location.href).href);
    if (sameApp) open.removeAttribute('target'); else open.target = '_blank';
    open.style.display = '';
  }
  else { open.removeAttribute('href'); open.style.display = 'none'; }
  $('btnShare').style.display = navigator.share ? '' : 'none';
  result.classList.add('show');
}

$('btnCopy').onclick = async () => {
  try { await navigator.clipboard.writeText(text.textContent); $('btnCopy').textContent = 'コピー済'; }
  catch { $('btnCopy').textContent = '失敗'; }
  setTimeout(() => ($('btnCopy').textContent = 'コピー'), 1500);
};

$('btnShare').onclick = () => {
  const t = text.textContent;
  navigator.share(isUrl(t) ? { url: t } : { text: t }).catch(() => {});
};

// 結果を閉じて読み取りを再開
$('btnCloseResult').onclick = () => {
  result.classList.remove('show');
  if (stream && stream.active) { scanning = true; requestAnimationFrame(tick); } else startCamera();
};

// 画像ファイルから読み取り
$('file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  scanning = false;
  try {
    const bmp = await createImageBitmap(file);
    const data = await decodeSource(bmp, bmp.width, bmp.height);
    if (data) onDetected(data);
    else { alert('QRコードが見つかりませんでした'); if (stream) { scanning = true; requestAnimationFrame(tick); } }
  } catch { alert('画像を読み込めませんでした'); }
};

// 履歴（端末内のlocalStorageのみに保存）
const KEY = 'qr-history';
function loadHistory() {
  try {
    const h = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(h) ? h.filter((x) => x && typeof x.data === 'string') : [];
  } catch { return []; }
}
function saveHistory(data) {
  try {
    const h = loadHistory().filter((x) => x.data !== data);
    h.unshift({ data, at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(h.slice(0, 100)));
  } catch {}
}
const SVG = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON_LINK = SVG('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>');
const ICON_TEXT = SVG('<path d="M5 6h14M5 11h14M5 16h9"/>');
const ICON_TRASH = SVG('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>');
const ICON_EMPTY = SVG('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2M20 14v6h-6"/>');

// 日付の見出し（今日／昨日／11月15日(土)／2025年12月1日）
function dayLabel(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return '今日';
  if (diff === 1) return '昨日';
  const opt = { month: 'long', day: 'numeric', weekday: 'short' };
  if (day.getFullYear() !== today.getFullYear()) opt.year = 'numeric';
  return day.toLocaleDateString('ja-JP', opt);
}

function renderHistory() {
  const list = $('list');
  list.textContent = '';
  const h = loadHistory();
  $('hCount').textContent = h.length ? `${h.length}件` : '';
  $('btnClear').disabled = !h.length;
  if (!h.length) {
    list.innerHTML = `<div class="empty">${ICON_EMPTY}<strong>まだ履歴はありません</strong><p>読み取ったQRコードがここに残ります</p></div>`;
    return;
  }
  let section = null, ul = null, label = null;
  for (const item of h) {
    const d = new Date(item.at);
    const l = isNaN(d) ? '日付不明' : dayLabel(d);
    if (l !== label) {
      label = l;
      section = document.createElement('section');
      const h3 = document.createElement('h3');
      h3.textContent = l;
      ul = document.createElement('ul');
      section.append(h3, ul);
      list.appendChild(section);
    }
    ul.appendChild(historyItem(item, d));
  }
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = '左にスワイプで削除';
  list.appendChild(hint);
}

function historyItem(item, d) {
  const li = document.createElement('li');
  const del = document.createElement('div');
  del.className = 'del';
  del.innerHTML = ICON_TRASH + '<span>削除</span>';
  const body = document.createElement('div');
  body.className = 'item';

  const kind = document.createElement('div');
  const main = document.createElement('div');
  main.className = 'main';
  const ttl = document.createElement('div');
  ttl.className = 'ttl';
  main.appendChild(ttl);
  if (isUrl(item.data)) {
    // URLはサイト名を大きく、残りを小さく
    const u = new URL(item.data);
    kind.className = 'kind';
    kind.innerHTML = ICON_LINK;
    ttl.textContent = u.hostname.replace(/^www\./, '');
    const rest = decodeURIComponentSafe(u.pathname + u.search + u.hash);
    if (rest && rest !== '/') {
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = rest;
      main.appendChild(sub);
    }
  } else {
    kind.className = 'kind text';
    kind.innerHTML = ICON_TEXT;
    ttl.textContent = item.data;
  }
  const time = document.createElement('time');
  if (!isNaN(d)) {
    time.dateTime = d.toISOString();
    time.textContent = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }
  body.append(kind, main, time);
  li.append(del, body);
  attachSwipe(li, body, item);
  return li;
}

function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

// 左スワイプで削除、軽いタップで結果を表示
function attachSwipe(li, body, item) {
  let startX = 0, startY = 0, dx = 0, dragging = false, decided = false, horizontal = false, id = null;

  body.addEventListener('pointerdown', (e) => {
    id = e.pointerId; startX = e.clientX; startY = e.clientY; dx = 0;
    dragging = true; decided = false; horizontal = false;
    body.classList.remove('snap');
  });
  body.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== id) return;
    const mx = e.clientX - startX, my = e.clientY - startY;
    if (!decided && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
      decided = true;
      horizontal = Math.abs(mx) > Math.abs(my);
      if (horizontal) { try { body.setPointerCapture(id); } catch {} }
    }
    if (horizontal) {
      dx = Math.min(0, mx);  // 左方向のみ
      body.style.transform = `translateX(${dx}px)`;
    }
  });
  const end = (e) => {
    if (!dragging || e.pointerId !== id) return;
    dragging = false;
    if (!decided && e.type === 'pointerup') {
      // タップ
      closeHistory(false); showResult(item.data);
      return;
    }
    body.classList.add('snap');
    if (horizontal && dx < -body.offsetWidth * 0.35) {
      body.style.transform = `translateX(-100%)`;
      setTimeout(() => removeItem(li, item), 180);
    } else {
      body.style.transform = '';
    }
  };
  body.addEventListener('pointerup', end);
  body.addEventListener('pointercancel', end);
}

let undoState = null, toastTimer = null;
function removeItem(li, item) {
  const h = loadHistory();
  const index = h.findIndex((x) => x.data === item.data && x.at === item.at);
  if (index < 0) return;
  h.splice(index, 1);
  try { localStorage.setItem(KEY, JSON.stringify(h)); } catch {}
  navigator.vibrate?.(30);
  // 縮めて消す
  li.style.height = li.offsetHeight + 'px';
  requestAnimationFrame(() => { li.style.height = '0'; li.style.opacity = '0'; });
  setTimeout(() => {
    const ul = li.parentElement;
    li.remove();
    if (ul && !ul.children.length) ul.parentElement.remove();  // その日の行が空になったら見出しごと消す
    const n = loadHistory().length;
    if (!n) renderHistory(); else $('hCount').textContent = `${n}件`;
  }, 220);
  undoState = { item, index };
  const toast = $('toast');
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.remove('show'); undoState = null; }, 4000);
}
// iPhoneではスワイプ直後の1回目のタップが click にならないことがあるため、
// 指を離した時点（pointerup）で実行する。click は同じ操作の二重実行を防ぐだけ
function undoDelete(e) {
  e?.preventDefault();
  if (!undoState) return;
  const h = loadHistory();
  h.splice(Math.min(undoState.index, h.length), 0, undoState.item);
  try { localStorage.setItem(KEY, JSON.stringify(h.slice(0, 100))); } catch {}
  undoState = null;
  $('toast').classList.remove('show');
  renderHistory();
}
$('btnUndo').addEventListener('pointerup', undoDelete);
$('btnUndo').addEventListener('click', undoDelete);

const historyEl = $('history');
const historyOpen = () => historyEl.classList.contains('show');

function openHistory() {
  // 履歴を見ている間はカメラを止める（裏で読み取りが走らないように）
  stopCamera();
  result.classList.remove('show');
  try { renderHistory(); } catch (e) { showError(e); }
  historyEl.classList.add('show');
  // スマホの「戻る」で閉じられるようにする
  try { history.pushState({ qrHistory: true }, ''); } catch {}
}

function closeHistory(resume = true) {
  if (!historyOpen()) return;
  historyEl.classList.remove('show');
  $('toast').classList.remove('show');
  if (history.state?.qrHistory) { try { history.back(); } catch {} }
  if (resume) startCamera();
}

window.addEventListener('popstate', () => {
  if (historyOpen()) { historyEl.classList.remove('show'); startCamera(); }
});

$('btnHistory').onclick = openHistory;
$('btnClose').onclick = () => closeHistory();
$('btnClear').onclick = () => {
  if (!confirm('履歴をすべて削除しますか？')) return;
  try { localStorage.removeItem(KEY); } catch {}
  renderHistory();
};

// 予期しないエラーは画面に表示（原因調査用）。タップで消える
function showError(e) {
  const el = $('err');
  el.textContent = 'エラー: ' + (e?.message || e?.reason?.message || e?.reason || e);
  el.classList.add('show');
}
$('err').onclick = () => $('err').classList.remove('show');
window.addEventListener('error', (e) => showError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

// バックグラウンドではカメラを止める
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
  else if (!result.classList.contains('show') && !historyOpen()) startCamera();
});

// Service Worker 登録
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(console.error));
}

startCamera();

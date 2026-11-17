'use strict';

const $ = (id) => document.getElementById(id);
const video = $('video'), canvas = $('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
const msg = $('msg'), result = $('result'), text = $('text');

let stream = null;
let facingMode = 'environment';
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
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
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

function stopCamera() {
  scanning = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function setupTorch() {
  const track = stream?.getVideoTracks()[0];
  // 他の画面やアプリにカメラを奪われたら、表示中なら起動し直す
  if (track) track.onended = () => {
    if (!document.hidden && !historyOpen() && !result.classList.contains('show')) startCamera();
  };
  const caps = track?.getCapabilities?.() || {};
  $('btnTorch').hidden = !caps.torch;
  torchOn = false;
}

$('btnTorch').onclick = async () => {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  torchOn = !torchOn;
  try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch {}
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

$('btnAgain').onclick = () => {
  result.classList.remove('show');
  if (stream && stream.active) { scanning = true; requestAnimationFrame(tick); } else startCamera();
};

$('btnSwitch').onclick = () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  result.classList.remove('show');
  startCamera();
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
function renderHistory() {
  const list = $('list');
  list.textContent = '';
  const h = loadHistory();
  if (!h.length) {
    const li = document.createElement('li');
    li.textContent = 'まだ履歴はありません';
    list.appendChild(li);
    return;
  }
  for (const item of h) {
    const li = document.createElement('li');
    li.textContent = item.data;
    const sm = document.createElement('small');
    const d = new Date(item.at);
    sm.textContent = isNaN(d) ? '' : d.toLocaleString('ja-JP');
    li.appendChild(sm);
    li.onclick = () => { closeHistory(false); showResult(item.data); };
    list.appendChild(li);
  }
}

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

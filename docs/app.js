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
  if (isUrl(data)) { open.href = data; open.style.display = ''; }
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
  if (stream) { scanning = true; requestAnimationFrame(tick); } else startCamera();
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
function loadHistory() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function saveHistory(data) {
  try {
    const h = loadHistory().filter((x) => x.data !== data);
    h.unshift({ data, at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(h.slice(0, 100)));
  } catch {}
}
function renderHistory() {
  const list = $('list');
  list.innerHTML = '';
  const h = loadHistory();
  if (!h.length) { list.innerHTML = '<li>まだ履歴はありません</li>'; return; }
  for (const item of h) {
    const li = document.createElement('li');
    li.textContent = item.data;
    const sm = document.createElement('small');
    sm.textContent = new Date(item.at).toLocaleString('ja-JP');
    li.appendChild(sm);
    li.onclick = () => { $('history').classList.remove('show'); scanning = false; showResult(item.data); };
    list.appendChild(li);
  }
}
$('btnHistory').onclick = () => { renderHistory(); $('history').classList.add('show'); };
$('btnClose').onclick = () => $('history').classList.remove('show');
$('btnClear').onclick = () => { if (confirm('履歴をすべて削除しますか？')) { localStorage.removeItem(KEY); renderHistory(); } };

// バックグラウンドではカメラを止める
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
  else if (!result.classList.contains('show')) startCamera();
});

// Service Worker 登録
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(console.error));
}

startCamera();

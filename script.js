/* MUKTI AI Photo Enhancer
 * Tahap 1: frontend berjalan tanpa backend (mode demo lokal, canvas).
 * Tahap 2: isi CONFIG.API_URL agar foto dikirim ke backend Real-ESRGAN.
 *
 * KEAMANAN: jangan pernah menaruh API key di file ini. Key disimpan di server
 * (environment variable) dan backend Anda yang memanggil layanan Real-ESRGAN.
 *
 * Server Real-ESRGAN (Hugging Face Space) memakai pekerjaan asinkron:
 *   POST {API_URL}/enhance      form: image, scale ("2" | "4" | "4k"), max_side
 *                               -> {"job_id": "..."}
 *   GET  {API_URL}/status/{id}  -> {"status": "queued|processing|done|error", "progress": 0..1}
 *   GET  {API_URL}/result/{id}  -> file gambar hasil
 *   Galat: status non-2xx dengan JSON {"detail": "pesan"}
 */
const CONFIG = {
  API_URL: "",          // contoh: "https://USERNAME-mukti-esrgan.hf.space" (tanpa garis miring di akhir)
  MAX_SIDE: 3840,       // batas sisi terpanjang hasil (4K UHD)
  BROWSER_AI: true,     // Real-ESRGAN dijalankan di HP/komputer pengguna (gratis, tanpa server)
  AI_MAX_PIXELS_GPU: 1200000, // batas foto masuk jika WebGPU tersedia (sekitar 1,2 MP)
  AI_MAX_PIXELS_CPU: 350000,  // batas foto masuk tanpa WebGPU (lebih lambat)
  MAX_FILE_MB: 25,
  SHARPEN_AMOUNT: 0.8   // mempertegas detail tepi, tidak mengubah bentuk wajah
};

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const $ = (id) => document.getElementById(id);

const el = {
  dropzone: $("dropzone"), fileInput: $("fileInput"),
  dzEmpty: $("dzEmpty"), dzPreview: $("dzPreview"), previewImg: $("previewImg"),
  fileName: $("fileName"), fileInfo: $("fileInfo"), sizeHint: $("sizeHint"),
  enhanceBtn: $("enhanceBtn"), errorBox: $("errorBox"), modeBadge: $("modeBadge"),
  progressCard: $("progressCard"), progressText: $("progressText"),
  progressPct: $("progressPct"), bar: $("bar"), barFill: $("barFill"),
  resultCard: $("resultCard"), resultChip: $("resultChip"),
  compare: $("compare"), beforeImg: $("beforeImg"), afterImg: $("afterImg"),
  cmpRange: $("cmpRange"), downloadBtn: $("downloadBtn"), resetBtn: $("resetBtn"),
  uploadCard: $("uploadCard"), dlError: $("dlError")
};

// Jaga-jaga jika index.html versi lama masih dipakai: buat elemen pesan unduhan sendiri.
if (!el.dlError) {
  const p = document.createElement("p");
  p.className = "error";
  p.hidden = true;
  el.downloadBtn.parentNode.before(p);
  el.dlError = p;
}

const state = { file: null, img: null, srcURL: null, outURL: null, scale: 2, busy: false };

if (CONFIG.API_URL || CONFIG.BROWSER_AI) {
  el.modeBadge.textContent = CONFIG.API_URL ? "Real-ESRGAN (server)" : "Real-ESRGAN di perangkat";
  el.modeBadge.classList.add("live");
}

/* ---------- Utilitas ---------- */
const tick = () => new Promise((r) => setTimeout(r, 0));
const fmtMB = (b) => (b / 1048576).toFixed(b > 10485760 ? 0 : 1) + " MB";

function showError(msg) {
  el.errorBox.textContent = msg;
  el.errorBox.hidden = !msg;
}

function setProgress(pct, text) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  el.barFill.style.width = p + "%";
  el.progressPct.textContent = p + "%";
  el.bar.setAttribute("aria-valuenow", p);
  if (text) el.progressText.textContent = text;
}

function targetSize() {
  const k4 = state.scale === "4k"
    ? CONFIG.MAX_SIDE / Math.max(state.img.naturalWidth, state.img.naturalHeight)
    : state.scale;
  let w = state.img.naturalWidth * k4;
  let h = state.img.naturalHeight * k4;
  const longest = Math.max(w, h);
  let capped = false;
  if (longest > CONFIG.MAX_SIDE) {
    const k = CONFIG.MAX_SIDE / longest;
    w = Math.round(w * k); h = Math.round(h * k); capped = true;
  }
  return { w: Math.round(w), h: Math.round(h), capped };
}

function updateHint() {
  if (!state.img) return;
  const t = targetSize();
  const mp = ((t.w * t.h) / 1e6).toFixed(1);
  let msg = `Hasil: ${t.w} × ${t.h} px (${mp} MP)` + (t.capped ? ". Dibatasi 4K." : ".");
  if (CONFIG.BROWSER_AI && !CONFIG.API_URL && state.img.naturalWidth * state.img.naturalHeight > aiCap()) {
    msg += ` Foto ini melebihi batas AI (${(aiCap() / 1e6).toFixed(2)} MP), jadi memakai mode demo.`;
  }
  el.sizeHint.textContent = msg;
}

/* ---------- Pilih file ---------- */
function loadFile(file) {
  showError("");
  if (!file) return;
  if (!ALLOWED.includes(file.type)) {
    return showError("Format tidak didukung. Gunakan JPG, JPEG, PNG, atau WEBP.");
  }
  if (file.size > CONFIG.MAX_FILE_MB * 1048576) {
    return showError(`Ukuran file ${fmtMB(file.size)} melebihi batas ${CONFIG.MAX_FILE_MB} MB.`);
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    if (state.srcURL) URL.revokeObjectURL(state.srcURL);
    Object.assign(state, { file, img, srcURL: url });
    el.previewImg.src = url;
    el.fileName.textContent = file.name;
    el.fileInfo.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${fmtMB(file.size)}`;
    el.dzEmpty.hidden = true;
    el.dzPreview.hidden = false;
    el.enhanceBtn.disabled = false;
    el.resultCard.hidden = true;
    updateHint();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    showError("Foto tidak bisa dibuka. File mungkin rusak.");
  };
  img.src = url;
}

el.fileInput.addEventListener("change", (e) => {
  loadFile(e.target.files[0]);
  e.target.value = "";
});

["dragenter", "dragover"].forEach((ev) =>
  el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.add("drag"); })
);
["dragleave", "drop"].forEach((ev) =>
  el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.remove("drag"); })
);
el.dropzone.addEventListener("drop", (e) => loadFile(e.dataTransfer.files[0]));

document.addEventListener("paste", (e) => {
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
  if (f) loadFile(f);
});

/* ---------- Pilihan 2x / 4x ---------- */
document.querySelectorAll(".seg").forEach((btn) =>
  btn.addEventListener("click", () => {
    state.scale = btn.dataset.scale === "4k" ? "4k" : Number(btn.dataset.scale);
    document.querySelectorAll(".seg").forEach((b) => {
      const on = b === btn;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", on);
    });
    updateHint();
  })
);

/* ---------- Mode demo lokal (canvas) ---------- */
function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

// Kernel Lanczos-3: resampling kualitas tinggi, jauh lebih tajam dari bilinear.
function lanczos(x) {
  if (x === 0) return 1;
  if (x <= -3 || x >= 3) return 0;
  const p = Math.PI * x;
  return (3 * Math.sin(p) * Math.sin(p / 3)) / (p * p);
}

function lanczosWeights(srcLen, dstLen) {
  const ratio = dstLen / srcLen;
  const start = new Int32Array(dstLen);
  const w = new Float32Array(dstLen * 6);
  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) / ratio - 0.5;
    const s = Math.floor(center) - 2;
    start[i] = s;
    let sum = 0;
    for (let k = 0; k < 6; k++) {
      const v = lanczos(center - (s + k));
      w[i * 6 + k] = v; sum += v;
    }
    for (let k = 0; k < 6; k++) w[i * 6 + k] /= sum;
  }
  return { start, w };
}

// Pengurang blok JPEG ringan: hanya meratakan beda kecil, tepi tetap utuh.
async function denoise(data, w, h, sigma) {
  const src = new Uint8ClampedArray(data);
  const inv = 1 / (2 * sigma * sigma);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const lc = (src[i] * 3 + src[i + 1] * 6 + src[i + 2]) / 10;
      let r = 0, g = 0, b = 0, ws = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = i + (dy * w + dx) * 4;
          const d = (src[j] * 3 + src[j + 1] * 6 + src[j + 2]) / 10 - lc;
          const wt = Math.exp(-d * d * inv);
          r += src[j] * wt; g += src[j + 1] * wt; b += src[j + 2] * wt; ws += wt;
        }
      }
      data[i] = r / ws; data[i + 1] = g / ws; data[i + 2] = b / ws;
    }
    if (y % 120 === 0) await tick();
  }
}

async function lanczosResize(img, tw, th) {
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const c0 = makeCanvas(sw, sh);
  const x0 = c0.getContext("2d");
  x0.drawImage(img, 0, 0);
  const src = x0.getImageData(0, 0, sw, sh).data;

  if (sw * sh <= 4e6) {
    setProgress(10, "Merapikan blok kompresi…");
    await tick();
    await denoise(src, sw, sh, 8);
  }

  const wx = lanczosWeights(sw, tw), wy = lanczosWeights(sh, th);

  // Lintasan horizontal
  const mid = new Uint8ClampedArray(tw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 4, orow = y * tw * 4;
    for (let x = 0; x < tw; x++) {
      const s = wx.start[x]; let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < 6; k++) {
        let sx = s + k; sx = sx < 0 ? 0 : sx >= sw ? sw - 1 : sx;
        const wt = wx.w[x * 6 + k], i = row + sx * 4;
        r += src[i] * wt; g += src[i + 1] * wt; b += src[i + 2] * wt; a += src[i + 3] * wt;
      }
      const o = orow + x * 4;
      mid[o] = r; mid[o + 1] = g; mid[o + 2] = b; mid[o + 3] = a;
    }
    if (y % 48 === 47) { setProgress(20 + (y / sh) * 20, "Memperbesar resolusi…"); await tick(); }
  }

  // Lintasan vertikal
  const canvas = makeCanvas(tw, th);
  const ctx = canvas.getContext("2d");
  const out = ctx.createImageData(tw, th), od = out.data;
  const offs = new Int32Array(6);
  for (let y = 0; y < th; y++) {
    const s = wy.start[y];
    for (let k = 0; k < 6; k++) {
      let sy = s + k; sy = sy < 0 ? 0 : sy >= sh ? sh - 1 : sy;
      offs[k] = sy * tw * 4;
    }
    const wbase = y * 6, orow = y * tw * 4;
    for (let x = 0; x < tw; x++) {
      const xo = x * 4; let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < 6; k++) {
        const wt = wy.w[wbase + k], i = offs[k] + xo;
        r += mid[i] * wt; g += mid[i + 1] * wt; b += mid[i + 2] * wt; a += mid[i + 3] * wt;
      }
      const o = orow + xo;
      od[o] = r; od[o + 1] = g; od[o + 2] = b; od[o + 3] = a;
    }
    if (y % 48 === 47) { setProgress(40 + (y / th) * 25, "Memperbesar resolusi…"); await tick(); }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

// Blur kotak terpisah (cepat) untuk unsharp mask.
function boxBlurRGB(s, w, h, r) {
  const tmp = new Uint8ClampedArray(s.length), out = new Uint8ClampedArray(s.length);
  const n = 2 * r + 1, cl = (v, m) => (v < 0 ? 0 : v > m ? m : v);
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += s[row + cl(k, w - 1) * 4 + c];
      for (let x = 0; x < w; x++) {
        tmp[row + x * 4 + c] = sum / n;
        sum += s[row + cl(x + r + 1, w - 1) * 4 + c] - s[row + cl(x - r, w - 1) * 4 + c];
      }
    }
  }
  const st = w * 4;
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += tmp[cl(k, h - 1) * st + x * 4 + c];
      for (let y = 0; y < h; y++) {
        out[y * st + x * 4 + c] = sum / n;
        sum += tmp[cl(y + r + 1, h - 1) * st + x * 4 + c] - tmp[cl(y - r, h - 1) * st + x * 4 + c];
      }
    }
  }
  return out;
}

// Unsharp mask: abaikan beda sangat kecil (noise) dan batasi beda besar (halo).
async function sharpen(canvas, amount, radius) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext("2d");
  const frame = ctx.getImageData(0, 0, w, h);
  const d = frame.data, s = new Uint8ClampedArray(d);
  setProgress(72, "Mempertajam detail…");
  await tick();
  const b = boxBlurRGB(s, w, h, radius);
  await tick();
  const SOFT = 5, LIM = 40, STEP = 1600000;
  for (let st = 0; st < d.length; st += STEP) {
    const end = Math.min(d.length, st + STEP);
    for (let i = st; i < end; i += 4) {
      for (let c = 0; c < 3; c++) {
        let diff = s[i + c] - b[i + c];
        const a = diff < 0 ? -diff : diff;
        if (a < SOFT) diff *= a / SOFT;
        else if (a > LIM) diff = diff < 0 ? -LIM : LIM;
        d[i + c] = s[i + c] + amount * diff;
      }
    }
    setProgress(72 + (end / d.length) * 20, "Mempertajam detail…");
    await tick();
  }
  ctx.putImageData(frame, 0, 0);
  return canvas;
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob gagal"))), type, 0.95)
  );
}

async function enhanceLocal() {
  const { w, h } = targetSize();
  const sw = state.img.naturalWidth, sh = state.img.naturalHeight;
  setProgress(5, "Membaca foto…");
  await tick();
  let canvas;
  if (w <= sw && h <= sh) {
    canvas = makeCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(state.img, 0, 0, w, h);
  } else {
    canvas = await lanczosResize(state.img, w, h);
  }
  canvas = await sharpen(canvas, CONFIG.SHARPEN_AMOUNT, w / sw >= 3 ? 2 : 1);
  setProgress(94, "Menyimpan hasil…");
  const outType = state.file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  const blob = await canvasToBlob(canvas, outType);
  return { blob, width: w, height: h };
}

/* ---------- Mode AI di perangkat (Real-ESRGAN via ONNX Runtime Web) ---------- */
// Model realesr-general-x4v3 (resmi Real-ESRGAN, ~5 MB) berjalan di browser pengguna.
// Tanpa server dan tanpa biaya. Tidak memakai face enhance, jadi wajah tidak dirombak.
const ORT_VER = "1.20.1";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;
const MODELS = {
  webgpu: [
    "https://huggingface.co/vlad-grig/realesr-general-x4v3-onnx/resolve/main/onnx/model_fp16.onnx",
    "https://huggingface.co/skillsafe-ai/realesr-general-x4v3/resolve/main/model_fp16.onnx"
  ],
  wasm: [
    "model/realesr-general-x4v3.onnx", // opsional: taruh file model sendiri di folder model/
    "https://huggingface.co/vlad-grig/realesr-general-x4v3-onnx/resolve/main/onnx/model.onnx",
    "https://huggingface.co/skillsafe-ai/realesr-general-x4v3/resolve/main/model.onnx",
    "https://huggingface.co/Heliosoph/realesrgan-onnx/resolve/main/realesr-general-x4v3.onnx"
  ]
};
const AI = { session: null, backend: null };

function aiCap() {
  return navigator.gpu ? CONFIG.AI_MAX_PIXELS_GPU : CONFIG.AI_MAX_PIXELS_CPU;
}

function noteError(msg, note) {
  const e = new Error(msg);
  e.note = note;
  return e;
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (window.ort) return resolve();
    const sc = document.createElement("script");
    sc.src = url;
    sc.onload = resolve;
    sc.onerror = () => reject(new Error("Pustaka AI gagal dimuat."));
    document.head.appendChild(sc);
  });
}

async function fetchModel(urls) {
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const buf = await r.arrayBuffer();
      if (buf.byteLength > 1e6) return new Uint8Array(buf);
    } catch (_) { /* coba alamat berikutnya */ }
  }
  throw new Error("Model AI tidak bisa diunduh.");
}

async function loadAI(forceWasm) {
  if (AI.session && (!forceWasm || AI.backend === "wasm")) return AI;
  setProgress(6, "Memuat mesin AI…");
  await loadScript(ORT_BASE + "ort.webgpu.min.js");
  ort.env.wasm.wasmPaths = ORT_BASE;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  const order = navigator.gpu && !forceWasm ? ["webgpu", "wasm"] : ["wasm"];
  for (const ep of order) {
    try {
      setProgress(9, "Mengunduh model AI (sekitar 5 MB, sekali saja)…");
      const model = await fetchModel(MODELS[ep]);
      setProgress(11, "Menyiapkan model…");
      AI.session = await ort.InferenceSession.create(model, { executionProviders: [ep] });
      AI.backend = ep;
      return AI;
    } catch (e) {
      console.warn("Backend AI gagal:", ep, e);
    }
  }
  throw new Error("Model AI gagal dimuat.");
}

// Memproses foto per petak 128 px (+ tepi 10 px) agar hemat memori. Setiap petak
// berukuran sama, jadi model tidak perlu dikompilasi ulang. Keluaran: RGBA 4x.
async function aiUpscaleRGBA(src, sw, sh, runTile, onTile) {
  const T = 128, PAD = 10, P = T + 2 * PAD, S = 4, OW = P * S;
  const outW = sw * S, outH = sh * S;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const plane = P * P, oplane = OW * OW;
  const total = Math.ceil(sw / T) * Math.ceil(sh / T);
  let n = 0;
  for (let ty = 0; ty < sh; ty += T) {
    for (let tx = 0; tx < sw; tx += T) {
      const buf = new Float32Array(3 * plane);
      for (let y = 0; y < P; y++) {
        let sy = ty - PAD + y; sy = sy < 0 ? 0 : sy >= sh ? sh - 1 : sy;
        for (let x = 0; x < P; x++) {
          let sx = tx - PAD + x; sx = sx < 0 ? 0 : sx >= sw ? sw - 1 : sx;
          const i = (sy * sw + sx) * 4, o = y * P + x;
          buf[o] = src[i] / 255;
          buf[plane + o] = src[i + 1] / 255;
          buf[2 * plane + o] = src[i + 2] / 255;
        }
      }
      const res = await runTile(buf, P);
      const vw = Math.min(T, sw - tx) * S, vh = Math.min(T, sh - ty) * S;
      for (let y = 0; y < vh; y++) {
        const ro = (PAD * S + y) * OW + PAD * S;
        const dst = ((ty * S + y) * outW + tx * S) * 4;
        for (let x = 0; x < vw; x++) {
          const d = dst + x * 4;
          out[d] = res[ro + x] * 255;
          out[d + 1] = res[oplane + ro + x] * 255;
          out[d + 2] = res[2 * oplane + ro + x] * 255;
          out[d + 3] = 255;
        }
      }
      onTile(++n / total);
      await tick();
    }
  }
  return out;
}

async function runAI(ai) {
  const sw = state.img.naturalWidth, sh = state.img.naturalHeight;
  const cap = ai.backend === "webgpu" ? CONFIG.AI_MAX_PIXELS_GPU : CONFIG.AI_MAX_PIXELS_CPU;
  if (sw * sh > cap) {
    throw noteError("Foto melebihi batas AI.", `demo lokal, batas AI ${(cap / 1e6).toFixed(2)} MP`);
  }
  const c0 = makeCanvas(sw, sh);
  const x0 = c0.getContext("2d");
  x0.drawImage(state.img, 0, 0);
  const src = x0.getImageData(0, 0, sw, sh).data;
  for (let i = 3; i < src.length; i += 4) {
    if (src[i] < 255) throw noteError("Foto transparan.", "demo lokal, foto transparan");
  }

  const inName = ai.session.inputNames[0], outName = ai.session.outputNames[0];
  const runTile = async (buf, P) => {
    const res = await ai.session.run({ [inName]: new ort.Tensor("float32", buf, [1, 3, P, P]) });
    return res[outName].data;
  };
  const out = await aiUpscaleRGBA(src, sw, sh, runTile, (f) =>
    setProgress(14 + f * 76, "Real-ESRGAN memproses…")
  );

  setProgress(92, "Menyusun hasil…");
  await tick();
  const aw = sw * 4, ah = sh * 4;
  const big = makeCanvas(aw, ah);
  big.getContext("2d").putImageData(new ImageData(out, aw, ah), 0, 0);

  const { w, h } = targetSize();
  let canvas = big;
  if (w !== aw || h !== ah) {
    canvas = makeCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(big, 0, 0, w, h);
    if (w > aw) canvas = await sharpen(canvas, 0.4, 2); // di atas 4x: sedikit penajaman
  }
  setProgress(97, "Menyimpan hasil…");
  const outType = state.file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  const blob = await canvasToBlob(canvas, outType);
  return { blob, width: w, height: h, note: "Real-ESRGAN" };
}

async function enhanceAI(forceWasm = false) {
  const ai = await loadAI(forceWasm);
  try {
    return await runAI(ai);
  } catch (err) {
    // WebGPU kadang gagal di perangkat tertentu: ulangi dengan WASM.
    if (ai.backend === "webgpu" && !forceWasm && !err.note) {
      console.warn("WebGPU gagal, beralih ke WASM:", err);
      AI.session = null;
      return enhanceAI(true);
    }
    throw err;
  }
}

/* ---------- Mode server Real-ESRGAN (Hugging Face Space) ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Galat yang berasal dari server (mis. foto terlalu besar): tampilkan apa adanya, tanpa fallback.
class ServerError extends Error {}

async function serverMessage(res, fallback) {
  try { const j = await res.json(); return j.detail || j.error || fallback; }
  catch (_) { return fallback; }
}

// Space gratis tidur saat lama tidak dipakai; tunggu sampai /health menjawab.
async function wakeServer(base) {
  for (let i = 0; i < 45; i++) {
    try {
      const r = await fetch(base + "/health", { cache: "no-store" });
      const j = await r.json();
      if (j && j.ok) return;
    } catch (_) { /* masih bangun */ }
    setProgress(6, "Membangunkan server gratis, bisa 1–2 menit…");
    await sleep(3000);
  }
  throw new Error("Server AI tidak merespons.");
}

async function enhanceRemote() {
  const base = CONFIG.API_URL.replace(/\/+$/, "");
  setProgress(5, "Menghubungi server…");
  await wakeServer(base);

  setProgress(10, "Mengunggah foto…");
  const form = new FormData();
  form.append("image", state.file);
  form.append("scale", String(state.scale));
  form.append("max_side", String(CONFIG.MAX_SIDE));
  const res = await fetch(base + "/enhance", { method: "POST", body: form });
  if (!res.ok) {
    throw new ServerError(await serverMessage(res, `Server menolak permintaan (${res.status}).`));
  }
  const { job_id } = await res.json();

  for (let misses = 0; ;) {
    await sleep(1500);
    let st;
    try {
      const r = await fetch(`${base}/status/${job_id}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      st = await r.json();
      misses = 0;
    } catch (_) {
      if (++misses > 8) throw new ServerError("Koneksi ke server terputus. Coba lagi.");
      continue;
    }
    if (st.status === "error") throw new ServerError(st.error || "Server gagal memproses foto.");
    if (st.status === "queued") setProgress(12, `Dalam antrean (urutan ${st.position})…`);
    if (st.status === "processing") setProgress(15 + st.progress * 75, "Real-ESRGAN memproses…");
    if (st.status === "done") break;
  }

  setProgress(94, "Mengunduh hasil…");
  const r = await fetch(`${base}/result/${job_id}`);
  if (!r.ok) throw new ServerError(await serverMessage(r, "Hasil tidak bisa diambil."));
  const blob = await r.blob();
  const dims = await new Promise((resolve, reject) => {
    const u = URL.createObjectURL(blob), im = new Image();
    im.onload = () => { URL.revokeObjectURL(u); resolve({ width: im.naturalWidth, height: im.naturalHeight }); };
    im.onerror = () => reject(new ServerError("Hasil dari server bukan gambar valid."));
    im.src = u;
  });
  return { blob, ...dims };
}

/* ---------- Jalankan proses ---------- */
el.enhanceBtn.addEventListener("click", async () => {
  if (state.busy || !state.img) return;
  state.busy = true;
  showError("");
  el.enhanceBtn.disabled = true;
  el.resultCard.hidden = true;
  el.progressCard.hidden = false;
  setProgress(0, "Menyiapkan…");
  el.progressCard.scrollIntoView({ behavior: "smooth", block: "nearest" });

  try {
    let out;
    if (CONFIG.API_URL) {
      try {
        out = await enhanceRemote();
      } catch (err) {
        if (err instanceof ServerError) throw err;
        console.error(err);
        setProgress(5, "Server AI tidak tersedia, memakai mode demo lokal…");
        out = { ...(await enhanceLocal()), note: "demo lokal" };
      }
    } else if (CONFIG.BROWSER_AI) {
      try {
        out = await enhanceAI();
      } catch (err) {
        console.error(err);
        setProgress(10, "Memakai mode demo lokal…");
        out = { ...(await enhanceLocal()), note: err.note || "demo lokal, AI gagal dimuat" };
      }
    } else {
      out = await enhanceLocal();
    }
    showResult(out);
  } catch (err) {
    console.error(err);
    const memory = /memory|toBlob|canvas/i.test(String(err.message));
    showError(memory
      ? "Memori perangkat tidak cukup untuk ukuran ini. Coba pilih 2x atau gunakan foto yang lebih kecil."
      : err.message || "Terjadi kesalahan saat memproses foto.");
  } finally {
    state.busy = false;
    el.enhanceBtn.disabled = false;
    el.progressCard.hidden = true;
  }
});

/* ---------- Hasil & perbandingan ---------- */
function showResult({ blob, width, height, note }) {
  if (state.outURL) URL.revokeObjectURL(state.outURL);
  state.outURL = URL.createObjectURL(blob);

  const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
  const base = state.file.name.replace(/\.[^.]+$/, "") || "foto";

  el.beforeImg.src = state.srcURL;
  el.afterImg.src = state.outURL;
  // Rasio mengikuti hasil agar kedua lapisan sejajar.
  el.compare.style.aspectRatio = `${width} / ${height}`;
  el.compare.style.maxHeight = "75vh";
  el.cmpRange.value = 50;
  el.compare.style.setProperty("--pos", "50%");

  el.resultChip.textContent = `${width} × ${height} px · ${fmtMB(blob.size)}` + (note ? ` · ${note}` : "");
  state.outBlob = blob;
  state.outName = `${base}-mukti-${state.scale === "4k" ? "4k" : state.scale + "x"}.${ext}`;
  el.dlError.hidden = true;
  el.downloadBtn.href = state.outURL;
  el.downloadBtn.download = state.outName;

  setProgress(100, "Selesai");
  el.resultCard.hidden = false;
  el.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Peramban dalam aplikasi (WebView, misalnya preview Acode) tidak bisa mengunduh
// tautan blob:. Di sana gunakan menu Bagikan Android, atau arahkan ke Chrome.
el.downloadBtn.addEventListener("click", async (e) => {
  const inAppBrowser = /;\s*wv\)/.test(navigator.userAgent);
  if (!inAppBrowser || !state.outBlob) return; // Chrome/desktop: unduhan normal
  e.preventDefault();
  el.dlError.hidden = true;
  try {
    const file = new File([state.outBlob], state.outName, { type: state.outBlob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: state.outName });
      return;
    }
  } catch (err) {
    if (err && err.name === "AbortError") return; // pengguna menutup menu Bagikan
  }
  el.dlError.textContent =
    "Peramban ini tidak bisa menyimpan file. Buka " + location.href +
    " di Chrome, lalu ulangi prosesnya.";
  el.dlError.hidden = false;
});

el.cmpRange.addEventListener("input", (e) =>
  el.compare.style.setProperty("--pos", e.target.value + "%")
);

/* ---------- Foto baru ---------- */
el.resetBtn.addEventListener("click", () => {
  el.resultCard.hidden = true;
  el.dzEmpty.hidden = false;
  el.dzPreview.hidden = true;
  el.enhanceBtn.disabled = true;
  el.sizeHint.textContent = "Pilih foto untuk melihat ukuran hasil.";
  if (state.srcURL) URL.revokeObjectURL(state.srcURL);
  if (state.outURL) URL.revokeObjectURL(state.outURL);
  Object.assign(state, { file: null, img: null, srcURL: null, outURL: null });
  el.uploadCard.scrollIntoView({ behavior: "smooth", block: "start" });
});

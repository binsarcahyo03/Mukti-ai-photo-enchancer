/* MUKTI AI Photo Enhancer
 * Tahap 1: frontend berjalan tanpa backend (mode demo lokal, canvas).
 * Tahap 2: isi CONFIG.API_URL agar foto dikirim ke backend Real-ESRGAN.
 *
 * KEAMANAN: jangan pernah menaruh API key di file ini. Key disimpan di server
 * (environment variable) dan backend Anda yang memanggil layanan Real-ESRGAN.
 *
 * Kontrak API backend (POST multipart/form-data):
 *   field "image"  : file foto asli
 *   field "scale"  : "2" atau "4"
 *   Respons sukses : file gambar (Content-Type image/*) ATAU JSON {"url": "https://..."}
 *   Respons gagal  : status non-2xx dengan JSON {"error": "pesan"}
 */
const CONFIG = {
  API_URL: "",          // contoh: "/api/enhance"
  MAX_SIDE: 3840,       // batas sisi terpanjang hasil (4K UHD)
  MAX_FILE_MB: 25,
  SHARPEN_AMOUNT: 0.35  // lembut, hanya mempertegas detail, tidak mengubah bentuk wajah
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

if (CONFIG.API_URL) {
  el.modeBadge.textContent = "Real-ESRGAN aktif";
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
  let w = state.img.naturalWidth * state.scale;
  let h = state.img.naturalHeight * state.scale;
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
  el.sizeHint.textContent = `Hasil: ${t.w} × ${t.h} px (${mp} MP)` + (t.capped ? ". Dibatasi 4K." : ".");
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
    state.scale = Number(btn.dataset.scale);
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

// Pembesaran bertahap (maks 2x per langkah) agar tepi lebih halus.
async function stepUpscale(img, tw, th) {
  let cur = img, cw = img.naturalWidth, ch = img.naturalHeight, canvas = null;
  const steps = Math.max(1, Math.ceil(Math.log2(Math.max(tw / cw, th / ch))));
  for (let i = 1; i <= steps; i++) {
    const nw = i === steps ? tw : Math.min(tw, Math.round(cw * 2));
    const nh = i === steps ? th : Math.min(th, Math.round(ch * 2));
    canvas = makeCanvas(nw, nh);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, nw, nh);
    cur = canvas; cw = nw; ch = nh;
    setProgress(15 + (i / steps) * 40, `Memperbesar resolusi (${i}/${steps})…`);
    await tick();
  }
  return canvas;
}

// Unsharp mask lembut: hasil = asli + jumlah × (asli − blur 3×3).
async function sharpen(canvas, amount) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext("2d");
  const frame = ctx.getImageData(0, 0, w, h);
  const d = frame.data, s = new Uint8ClampedArray(d);
  const CHUNK = 160;
  for (let y0 = 1; y0 < h - 1; y0 += CHUNK) {
    const y1 = Math.min(h - 1, y0 + CHUNK);
    for (let y = y0; y < y1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const k = i + c;
          const blur = (
            s[k - w * 4 - 4] + s[k - w * 4] + s[k - w * 4 + 4] +
            s[k - 4] + s[k] + s[k + 4] +
            s[k + w * 4 - 4] + s[k + w * 4] + s[k + w * 4 + 4]
          ) / 9;
          d[k] = s[k] + amount * (s[k] - blur);
        }
      }
    }
    setProgress(55 + (y1 / h) * 35, "Mempertajam detail…");
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
  setProgress(8, "Membaca foto…");
  await tick();
  let canvas = await stepUpscale(state.img, w, h);
  canvas = await sharpen(canvas, CONFIG.SHARPEN_AMOUNT);
  setProgress(94, "Menyimpan hasil…");
  const outType = state.file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  const blob = await canvasToBlob(canvas, outType);
  return { blob, width: w, height: h };
}

/* ---------- Mode backend Real-ESRGAN ---------- */
async function enhanceRemote() {
  setProgress(10, "Mengunggah foto…");
  const form = new FormData();
  form.append("image", state.file);
  form.append("scale", String(state.scale));

  // Progres semu selagi menunggu server (server tidak mengirim progres).
  let fake = 20;
  const timer = setInterval(() => {
    fake = Math.min(88, fake + 2);
    setProgress(fake, "Real-ESRGAN sedang memproses…");
  }, 700);

  try {
    const res = await fetch(CONFIG.API_URL, { method: "POST", body: form });
    if (!res.ok) {
      let msg = `Server menolak permintaan (${res.status}).`;
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    let blob;
    if ((res.headers.get("content-type") || "").includes("application/json")) {
      const { url } = await res.json();
      if (!url) throw new Error("Respons server tidak berisi URL hasil.");
      setProgress(92, "Mengunduh hasil…");
      blob = await (await fetch(url)).blob();
    } else {
      blob = await res.blob();
    }
    const dims = await new Promise((resolve, reject) => {
      const u = URL.createObjectURL(blob), im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); resolve({ width: im.naturalWidth, height: im.naturalHeight }); };
      im.onerror = () => reject(new Error("Hasil dari server bukan gambar valid."));
      im.src = u;
    });
    return { blob, ...dims };
  } finally {
    clearInterval(timer);
  }
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
    const out = CONFIG.API_URL ? await enhanceRemote() : await enhanceLocal();
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
function showResult({ blob, width, height }) {
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

  el.resultChip.textContent = `${width} × ${height} px · ${fmtMB(blob.size)}`;
  state.outBlob = blob;
  state.outName = `${base}-mukti-${state.scale}x.${ext}`;
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

/**
 * EasyStarImage MVP · Cloudflare Worker
 *
 * 功能：
 *   GET  /              — 前端页面
 *   GET  /css/style.css  — 样式
 *   GET  /js/app.js      — 前端逻辑
 *   POST /api/generate   — 接收用户照片 + 模板选择 → 提交 EvoLink 任务 → 返回 task_id
 *   GET  /api/status/:id — 代理 EvoLink 任务状态查询
 *
 * 部署：
 *   wrangler deploy
 *   设置 secret: wrangler secret put EVOLINK_API_KEY
 *
 * 约束：
 *   - API Key 仅存于 Worker 环境变量，不暴露给前端
 *   - 用户照片仅用于本次 API 调用，Worker 不存储
 */

// ── 配置 ──────────────────────────────────────────────────────────────────────
const EVOLINK_BASE = 'https://api.evolink.ai';
const MODEL = 'gpt-image-2';
const QUALITY = 'medium';     // low / medium / high（high 约是 medium 的 4 倍价格）
const SIZE = '3:4';           // 比例，配合 RESOLUTION 使用
const RESOLUTION = '1K';      // 1K / 2K / 4K

// ── 静态文件 ───────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EasyStarImage · AI法式写真</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>

<!-- Hero -->
<header class="hero">
    <h1 class="hero-title">EasyStarImage</h1>
    <p class="hero-sub">上传 1-3 张照片，生成你的 AI 法式大片</p>
</header>

<main class="container">
<div class="app-grid">

    <!-- ── 左栏：输入 ── -->
    <div class="panel-input">

        <!-- 模板展示 -->
        <section class="template-card" id="templateSection">
            <div class="template-badge">首发模板</div>
            <div class="template-info">
                <h2 class="template-name">Chanel · 法式极简风</h2>
                <p class="template-desc">香奈儿品牌美学，巴黎公寓午后窗光，珍珠与斜纹软呢的永恒优雅。</p>
            </div>
            <div class="template-tags">
                <span>黑白经典配色</span>
                <span>无妆感底妆</span>
                <span>法式自然窗光</span>
                <span>珍珠配饰</span>
            </div>
        </section>

        <!-- 上传区：三张照片 -->
        <section class="upload-section" id="uploadSection">
            <p class="upload-section-hint">上传 1-3 张照片，多角度照片可大幅提升面部保真度</p>
            <div class="slots-grid" id="slotsGrid">
                <!-- 插槽 1 -->
                <div class="slot" data-slot="0">
                    <input type="file" class="slot-input" accept="image/jpeg,image/png,image/webp" hidden>
                    <div class="slot-empty">
                        <div class="slot-icon">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                                <polyline points="17 8 12 3 7 8"/>
                                <line x1="12" y1="3" x2="12" y2="15"/>
                            </svg>
                        </div>
                        <p class="slot-label">正面照</p>
                        <p class="slot-tip">点击 / 拖拽 / 粘贴</p>
                    </div>
                    <div class="slot-filled hidden">
                        <img class="slot-preview" alt="">
                        <button class="slot-remove" title="移除">&times;</button>
                    </div>
                </div>
                <!-- 插槽 2 -->
                <div class="slot" data-slot="1">
                    <input type="file" class="slot-input" accept="image/jpeg,image/png,image/webp" hidden>
                    <div class="slot-empty">
                        <div class="slot-icon">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                                <polyline points="17 8 12 3 7 8"/>
                                <line x1="12" y1="3" x2="12" y2="15"/>
                            </svg>
                        </div>
                        <p class="slot-label">侧面 / 半身</p>
                        <p class="slot-tip">点击 / 拖拽 / 粘贴</p>
                    </div>
                    <div class="slot-filled hidden">
                        <img class="slot-preview" alt="">
                        <button class="slot-remove" title="移除">&times;</button>
                    </div>
                </div>
                <!-- 插槽 3 -->
                <div class="slot" data-slot="2">
                    <input type="file" class="slot-input" accept="image/jpeg,image/png,image/webp" hidden>
                    <div class="slot-empty">
                        <div class="slot-icon">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                                <polyline points="17 8 12 3 7 8"/>
                                <line x1="12" y1="3" x2="12" y2="15"/>
                            </svg>
                        </div>
                        <p class="slot-label">其他角度</p>
                        <p class="slot-tip">点击 / 拖拽 / 粘贴</p>
                    </div>
                    <div class="slot-filled hidden">
                        <img class="slot-preview" alt="">
                        <button class="slot-remove" title="移除">&times;</button>
                    </div>
                </div>
            </div>
            <p class="upload-requirements" id="uploadRequirements">
                正面照为必填。三张不同角度的照片能让 AI 更好保留你的面部结构，减少失真。
            </p>
        </section>

        <!-- 生成按钮 -->
        <section class="action-section">
            <button class="btn-generate" id="generateBtn" disabled>
                开始生成我的法式大片
            </button>
            <p class="privacy-note">你的照片仅用于本次生成，不会公开或保存</p>
        </section>

    </div><!-- /panel-input -->

    <!-- ── 右栏：结果 ── -->
    <div class="panel-result">
        <div class="result-section" id="resultSection">

            <!-- 空状态（初始） -->
            <div class="result-empty" id="resultEmpty">
                <div class="result-empty-icon">
                    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="0.8">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                    </svg>
                </div>
                <p class="result-empty-text">上传照片后点击「开始生成」<br>你的法式大片将出现在这里</p>
            </div>

            <!-- 生成中 -->
            <div class="result-status hidden" id="resultStatus">
                <div class="spinner hidden" id="spinner"></div>
                <p class="status-text" id="statusText">正在提交生成请求...</p>
            </div>

            <!-- 结果图 -->
            <div class="result-image-area hidden" id="resultImageArea">
                <img id="resultImage" alt="生成结果">
                <div class="result-actions">
                    <button class="btn-download" id="downloadBtn">保存图片</button>
                    <button class="btn-ghost" id="regenerateBtn">重新生成</button>
                </div>
            </div>

            <!-- 错误 -->
            <div class="result-error hidden" id="resultError">
                <p class="error-text">生成失败，请稍后重试</p>
                <button class="btn-ghost" id="retryBtn">重试</button>
            </div>

        </div>
    </div><!-- /panel-result -->

</div><!-- /app-grid -->
</main>

<footer class="footer">
    <p>你的照片仅用于本次生成，不会公开或保存。风格参考仅供展示。</p>
    <p class="footer-by">by CC</p>
</footer>

<script src="js/app.js"></script>
</body>
</html>`;

const CSS = `/* ── Reset & Base ─────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
    --black: #1a1a1a;
    --white: #fafaf8;
    --ivory: #f5f0e8;
    --gold: #c8a96e;
    --gold-light: #d4bc8c;
    --gray-100: #f5f4f2;
    --gray-200: #e8e6e1;
    --gray-400: #999893;
    --gray-600: #5c5b58;
    --gray-800: #2d2d2b;
    --radius: 8px;
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    --font-serif: "Georgia", "Noto Serif SC", "STSong", serif;
}

html { font-size: 16px; -webkit-text-size-adjust: 100%; }

body {
    font-family: var(--font-sans);
    color: var(--gray-800);
    background: var(--white);
    line-height: 1.6;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
}

/* ── Hero ─────────────────────────────────────────────────────────────────── */
.hero {
    text-align: center;
    padding: 3rem 1.5rem 2rem;
}

.hero-title {
    font-family: var(--font-serif);
    font-size: 2rem;
    font-weight: 400;
    letter-spacing: 0.04em;
    color: var(--black);
    margin-bottom: 0.5rem;
}

.hero-sub {
    font-size: 1rem;
    color: var(--gray-600);
    font-weight: 300;
}

/* ── Container ────────────────────────────────────────────────────────────── */
.container {
    max-width: 980px;
    width: 100%;
    margin: 0 auto;
    padding: 0 1.5rem;
    flex: 1;
}

/* ── Two-column Grid ──────────────────────────────────────────────────────── */
.app-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
    align-items: start;
    padding-bottom: 3rem;
}

.panel-result {
    position: sticky;
    top: 1.5rem;
}

/* ── Result Panel (right side, always visible) ────────────────────────────── */
.result-section {
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    min-height: 480px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: var(--gray-100);
}

/* ── Empty State ──────────────────────────────────────────────────────────── */
.result-empty {
    text-align: center;
    padding: 3rem 2rem;
    color: var(--gray-400);
}

.result-empty-icon {
    color: var(--gray-200);
    margin-bottom: 1.25rem;
}

.result-empty-text {
    font-size: 0.85rem;
    color: var(--gray-400);
    line-height: 1.8;
}

/* ── Mobile: single column ────────────────────────────────────────────────── */
@media (max-width: 680px) {
    .app-grid {
        grid-template-columns: 1fr;
    }
    .panel-result {
        position: static;
    }
}

/* ── Template Card ────────────────────────────────────────────────────────── */
.template-card {
    background: var(--gray-100);
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    padding: 1.25rem;
    margin-bottom: 1.5rem;
    position: relative;
}

.template-badge {
    display: inline-block;
    background: var(--black);
    color: var(--ivory);
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    padding: 0.2rem 0.6rem;
    border-radius: 3px;
    margin-bottom: 0.75rem;
    text-transform: uppercase;
}

.template-name {
    font-family: var(--font-serif);
    font-size: 1.25rem;
    font-weight: 400;
    color: var(--black);
    margin-bottom: 0.35rem;
}

.template-desc {
    font-size: 0.85rem;
    color: var(--gray-600);
    line-height: 1.5;
    margin-bottom: 0.75rem;
}

.template-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
}

.template-tags span {
    font-size: 0.72rem;
    color: var(--gray-600);
    background: var(--white);
    border: 1px solid var(--gray-200);
    padding: 0.15rem 0.55rem;
    border-radius: 3px;
}

/* ── Upload Section ───────────────────────────────────────────────────────── */
.upload-section { margin-bottom: 1.5rem; }

.upload-section-hint {
    font-size: 0.82rem;
    color: var(--gray-600);
    text-align: center;
    margin-bottom: 0.75rem;
}

/* ── Three-Slot Grid ──────────────────────────────────────────────────────── */
.slots-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.6rem;
}

/* ── Single Slot ──────────────────────────────────────────────────────────── */
.slot {
    position: relative;
    aspect-ratio: 3 / 4;
    border: 2px dashed var(--gray-400);
    border-radius: var(--radius);
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
    overflow: hidden;
}

.slot:hover,
.slot.dragover {
    border-color: var(--gold);
    background: var(--ivory);
}

.slot.filled {
    border-style: solid;
    border-color: var(--gray-200);
}

/* ── Empty State ──────────────────────────────────────────────────────────── */
.slot-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 0.5rem;
    text-align: center;
}

.slot-icon {
    color: var(--gray-400);
    margin-bottom: 0.3rem;
}

.slot-label {
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--gray-600);
    margin-bottom: 0.15rem;
}

.slot-tip {
    font-size: 0.65rem;
    color: var(--gray-400);
}

/* ── Filled State ─────────────────────────────────────────────────────────── */
.slot-filled {
    position: absolute;
    inset: 0;
}

.slot-filled img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.slot-remove {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: none;
    background: rgba(0,0,0,0.55);
    color: #fff;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
}

.slot-remove:hover { background: rgba(0,0,0,0.8); }

/* ── Paste toast ──────────────────────────────────────────────────────────── */
.paste-toast {
    position: fixed;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--black);
    color: var(--ivory);
    padding: 0.65rem 1.25rem;
    border-radius: 20px;
    font-size: 0.82rem;
    z-index: 999;
    animation: toastIn 0.3s ease, toastOut 0.3s ease 1.2s forwards;
    pointer-events: none;
}

@keyframes toastIn  { from { opacity: 0; transform: translateX(-50%) translateY(10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
@keyframes toastOut { from { opacity: 1; transform: translateX(-50%) translateY(0); } to { opacity: 0; transform: translateX(-50%) translateY(10px); } }

/* ── Upload Requirements ──────────────────────────────────────────────────── */
.upload-requirements {
    text-align: center;
    margin-top: 0.6rem;
    font-size: 0.75rem;
    color: var(--gray-400);
}

/* ── Buttons ──────────────────────────────────────────────────────────────── */
.btn-generate {
    display: block;
    width: 100%;
    padding: 0.9rem;
    font-size: 1rem;
    font-weight: 500;
    letter-spacing: 0.03em;
    color: var(--ivory);
    background: var(--black);
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.2s, opacity 0.2s;
    font-family: var(--font-sans);
}

.btn-generate:hover:not(:disabled) { background: var(--gray-800); }

.btn-generate:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}

.btn-ghost {
    padding: 0.5rem 1.25rem;
    font-size: 0.85rem;
    color: var(--gray-600);
    background: transparent;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    cursor: pointer;
    font-family: var(--font-sans);
    transition: border-color 0.2s, color 0.2s;
}

.btn-ghost:hover { border-color: var(--gray-800); color: var(--gray-800); }

.btn-download {
    padding: 0.65rem 1.5rem;
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--ivory);
    background: var(--black);
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
    font-family: var(--font-sans);
    transition: background 0.2s;
}

.btn-download:hover { background: var(--gray-800); }

/* ── Action Section ───────────────────────────────────────────────────────── */
.action-section {
    margin-bottom: 1.5rem;
}

.privacy-note {
    text-align: center;
    font-size: 0.72rem;
    color: var(--gray-400);
    margin-top: 0.65rem;
}

.result-status {
    text-align: center;
    padding: 2rem 1rem;
}

.spinner {
    width: 36px;
    height: 36px;
    border: 3px solid var(--gray-200);
    border-top-color: var(--gold);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 1rem;
}

@keyframes spin { to { transform: rotate(360deg); } }

.status-text {
    font-size: 0.9rem;
    color: var(--gray-600);
}

.result-image-area {
    text-align: center;
    width: 100%;
}

.result-image-area img {
    width: 100%;
    display: block;
    border-radius: 0;
    margin-bottom: 0;
}

.result-image-area .result-actions {
    padding: 0.85rem;
    background: var(--white);
    border-top: 1px solid var(--gray-200);
}

.result-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    flex-wrap: wrap;
}

.result-error {
    text-align: center;
    padding: 2rem 1rem;
}

.error-text {
    font-size: 0.9rem;
    color: #c44;
    margin-bottom: 0.75rem;
}

/* ── Footer ───────────────────────────────────────────────────────────────── */
.footer {
    text-align: center;
    padding: 1.5rem 1.25rem 2rem;
    font-size: 0.72rem;
    color: var(--gray-400);
    line-height: 1.6;
}

.footer-by { margin-top: 0.3rem; }

/* ── Utilities ────────────────────────────────────────────────────────────── */
.hidden { display: none !important; }

/* ── Mobile (base styles are mobile-first) ────────────────────────────────── */
@media (min-width: 640px) {
    .hero { padding: 4rem 1.5rem 2.5rem; }
    .hero-title { font-size: 2.4rem; }
    .container { padding: 0 2rem; }
}

/* ── Small screen: stack slots vertically ─────────────────────────────────── */
@media (max-width: 380px) {
    .slots-grid {
        grid-template-columns: 1fr;
        gap: 0.5rem;
    }
    .slot { aspect-ratio: 4 / 3; }
}`;

const JS = `/**
 * EasyStarImage MVP · 前端交互逻辑
 * - 三个照片上传插槽（点击 / 拖拽 / 粘贴）
 * - API 调用与轮询
 * - 结果展示与下载
 */

(function () {
    'use strict';

    // ── DOM 引用 ──────────────────────────────────────────────────────────
    var slots    = document.querySelectorAll('.slot');
    var slotInputs = document.querySelectorAll('.slot-input');
    var generateBtn = document.getElementById('generateBtn');

    var resultSection  = document.getElementById('resultSection');
    var resultEmpty    = document.getElementById('resultEmpty');
    var resultStatus   = document.getElementById('resultStatus');
    var spinner        = document.getElementById('spinner');
    var statusText     = document.getElementById('statusText');
    var resultImgArea  = document.getElementById('resultImageArea');
    var resultImage    = document.getElementById('resultImage');
    var downloadBtn    = document.getElementById('downloadBtn');
    var regenerateBtn  = document.getElementById('regenerateBtn');
    var resultError    = document.getElementById('resultError');
    var retryBtn       = document.getElementById('retryBtn');

    // 每个插槽存储的 File 对象，null = 未上传
    var slotFiles = [null, null, null];

    // ── API 配置 ──────────────────────────────────────────────────────────
    var API_BASE = '/api';

    // ── 任务状态追踪（防止重复提交）────────────────────────────────────────
    var currentTaskId = null;   // 当前正在运行的 task ID
    var isGenerating  = false;  // 是否正在生成中

    // ── 插槽交互：点击 ────────────────────────────────────────────────────
    slots.forEach(function (slot) {
        slot.addEventListener('click', function (e) {
            if (e.target.closest('.slot-remove')) return;
            var idx = parseInt(slot.dataset.slot);
            slotInputs[idx].click();
        });
    });

    // ── 插槽交互：文件选择 ────────────────────────────────────────────────
    slotInputs.forEach(function (input, idx) {
        input.addEventListener('change', function () {
            if (input.files.length > 0) {
                setSlotFile(idx, input.files[0]);
            }
        });
    });

    // ── 插槽交互：拖拽 ────────────────────────────────────────────────────
    slots.forEach(function (slot) {
        slot.addEventListener('dragover', function (e) {
            e.preventDefault();
            slot.classList.add('dragover');
        });
        slot.addEventListener('dragleave', function () {
            slot.classList.remove('dragover');
        });
        slot.addEventListener('drop', function (e) {
            e.preventDefault();
            slot.classList.remove('dragover');
            var files = e.dataTransfer.files;
            if (files.length > 0) {
                var idx = parseInt(slot.dataset.slot);
                setSlotFile(idx, files[0]);
            }
        });
    });

    // ── 全局粘贴（Ctrl+V 图片 → 填入下一个空槽）──────────────────────────
    document.addEventListener('paste', function (e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;

        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                var blob = items[i].getAsFile();
                var emptyIdx = nextEmptySlot();
                if (emptyIdx !== -1) {
                    setSlotFile(emptyIdx, blob);
                    showToast('已粘贴到 ' + slotLabel(emptyIdx));
                } else {
                    showToast('三个插槽已满，请先移除一张');
                }
                return;
            }
        }
    });

    // ── 设置插槽文件 ──────────────────────────────────────────────────────
    function setSlotFile(idx, file) {
        if (!file.type.match(/^image\\/(jpeg|png|webp)$/)) {
            showToast('请上传 JPG、PNG 或 WEBP 格式的照片');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            showToast('照片大小不能超过 10MB');
            return;
        }

        slotFiles[idx] = file;

        var slot = slots[idx];
        var emptyEl = slot.querySelector('.slot-empty');
        var filledEl = slot.querySelector('.slot-filled');
        var previewImg = slot.querySelector('.slot-preview');

        var reader = new FileReader();
        reader.onload = function (ev) {
            previewImg.src = ev.target.result;
            emptyEl.classList.add('hidden');
            filledEl.classList.remove('hidden');
            slot.classList.add('filled');
            updateGenerateBtn();
        };
        reader.readAsDataURL(file);

        // 移除按钮事件
        filledEl.querySelector('.slot-remove').onclick = function (ev) {
            ev.stopPropagation();
            clearSlot(idx);
        };
    }

    // ── 清空插槽 ──────────────────────────────────────────────────────────
    function clearSlot(idx) {
        slotFiles[idx] = null;
        slotInputs[idx].value = '';

        var slot = slots[idx];
        slot.querySelector('.slot-empty').classList.remove('hidden');
        slot.querySelector('.slot-filled').classList.add('hidden');
        slot.classList.remove('filled');
        updateGenerateBtn();
        resetResult();
    }

    // ── 查找下一个空插槽 ──────────────────────────────────────────────────
    function nextEmptySlot() {
        for (var i = 0; i < 3; i++) {
            if (!slotFiles[i]) return i;
        }
        return -1;
    }

    function filledCount() {
        var n = 0;
        for (var i = 0; i < 3; i++) { if (slotFiles[i]) n++; }
        return n;
    }

    function slotLabel(idx) {
        return ['正面照', '侧面/半身', '其他角度'][idx];
    }

    // ── 生成按钮状态 ──────────────────────────────────────────────────────
    function updateGenerateBtn() {
        generateBtn.disabled = (filledCount() === 0);
    }

    // ── Toast ─────────────────────────────────────────────────────────────
    function showToast(msg) {
        var el = document.createElement('div');
        el.className = 'paste-toast';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1600);
    }

    // ── 生成流程 ──────────────────────────────────────────────────────────
    generateBtn.addEventListener('click', startGeneration);

    // 重试：优先恢复已有任务的轮询，而不是重新提交
    retryBtn.addEventListener('click', function () {
        if (currentTaskId && !isGenerating) {
            resumePolling(currentTaskId);
        } else {
            startGeneration();
        }
    });

    // 重新生成：清除旧任务，提交新任务
    regenerateBtn.addEventListener('click', function () {
        currentTaskId = null;
        startGeneration();
    });

    function setGeneratingState(generating) {
        isGenerating = generating;
        generateBtn.disabled = generating || (filledCount() === 0);
        regenerateBtn.disabled = generating;
        retryBtn.disabled = generating;
    }

    async function startGeneration() {
        if (filledCount() === 0) return;
        if (isGenerating) return; // 防止重复点击

        setGeneratingState(true);
        resultEmpty.classList.add('hidden');
        resultStatus.classList.remove('hidden');
        spinner.classList.remove('hidden');
        resultImgArea.classList.add('hidden');
        resultError.classList.add('hidden');
        statusText.textContent = '正在提交生成请求...';

        try {
            // 收集所有上传的照片 → base64 数组
            var images = [];
            for (var i = 0; i < 3; i++) {
                if (slotFiles[i]) {
                    images.push(await fileToBase64(slotFiles[i]));
                }
            }

            // 提交任务
            var submitRes = await fetch(API_BASE + '/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    images: images,
                    template: 'chanel_17',
                    shot: 1
                })
            });

            if (!submitRes.ok) {
                var errData = await submitRes.json().catch(function() { return {}; });
                throw new Error(errData.error || '提交失败');
            }

            var submitData = await submitRes.json();
            var taskId = submitData.task_id;
            if (!taskId) throw new Error('未获取到任务ID');

            // 记录当前任务 ID，防止重复提交
            currentTaskId = taskId;

            // 轮询
            statusText.textContent = '任务已提交，正在生成中，预计需要1-2分钟...';
            var imageUrl = await pollTask(taskId);

            showResult(imageUrl);

        } catch (err) {
            console.error(err);
            showError();
        }

        setGeneratingState(false);
    }

    // 恢复对已有任务的轮询（重试时使用）
    async function resumePolling(taskId) {
        if (isGenerating) return;

        setGeneratingState(true);
        resultEmpty.classList.add('hidden');
        resultStatus.classList.remove('hidden');
        spinner.classList.remove('hidden');
        resultImgArea.classList.add('hidden');
        resultError.classList.add('hidden');
        statusText.textContent = '正在重新连接，继续等待生成结果...';

        try {
            var imageUrl = await pollTask(taskId);
            showResult(imageUrl);
        } catch (err) {
            console.error(err);
            showError();
        }

        setGeneratingState(false);
    }

    function showResult(imageUrl) {
        resultStatus.classList.add('hidden');
        spinner.classList.add('hidden');
        resultImgArea.classList.remove('hidden');
        // 直接设置 src，img 标签天然支持跨域显示
        resultImage.src = imageUrl;
        // 如果直连失败（URL 需要签名/已过期），回退到 Worker 代理
        resultImage.onerror = function () {
            if (resultImage.src.indexOf('/api/proxy') === -1) {
                resultImage.src = '/api/proxy?url=' + encodeURIComponent(imageUrl);
            }
        };
        downloadBtn.onclick = function () { downloadImage(imageUrl); };
    }

    function showError() {
        resultStatus.classList.add('hidden');
        spinner.classList.add('hidden');
        resultError.classList.remove('hidden');
        // 如果有任务ID，提示用户可以重试而不是重新提交
        if (currentTaskId) {
            document.querySelector('.error-text').textContent =
                '连接中断，任务可能仍在生成中，点击「重试」继续等待';
        } else {
            document.querySelector('.error-text').textContent = '生成失败，请稍后重试';
        }
    }

    async function pollTask(taskId, timeoutSec) {
        timeoutSec = timeoutSec || 240; // 延长到4分钟
        var deadline = Date.now() + timeoutSec * 1000;
        var pollErrors = 0;            // 连续查询失败次数
        var maxPollErrors = 5;         // 允许最多5次连续失败再放弃

        while (Date.now() < deadline) {
            try {
                var res = await fetch(API_BASE + '/status/' + taskId);

                if (!res.ok) {
                    pollErrors++;
                    if (pollErrors >= maxPollErrors) throw new Error('状态查询持续失败');
                    statusText.textContent = '网络波动，正在重试... (' + pollErrors + '/' + maxPollErrors + ')';
                    await sleep(5000);
                    continue;
                }

                pollErrors = 0; // 成功就清零
                var data = await res.json();
                var status = data.status;

                if (status === 'completed') return data.image_url;
                if (status === 'failed') throw new Error(data.error || '生成失败');

                var elapsed = Math.round((Date.now() - (deadline - timeoutSec * 1000)) / 1000);
                var progress = data.progress || 0;
                statusText.textContent = progress > 0
                    ? '正在生成中... ' + progress + '%（已等待 ' + elapsed + 's）'
                    : '正在生成中，请耐心等待...（已等待 ' + elapsed + 's）';

            } catch (err) {
                // 只有明确的业务失败才直接抛出
                if (err.message === '生成失败' || err.message === '状态查询持续失败') {
                    throw err;
                }
                // 网络错误：计入错误次数，继续重试
                pollErrors++;
                if (pollErrors >= maxPollErrors) throw new Error('网络连接不稳定，请检查后重试');
                statusText.textContent = '网络波动，正在重试... (' + pollErrors + '/' + maxPollErrors + ')';
            }

            await sleep(4000);
        }

        throw new Error('生成超时，任务可能仍在运行，可点击「重试」继续等待');
    }

    // ── 工具函数 ──────────────────────────────────────────────────────────
    function fileToBase64(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function downloadImage(url) {
        // 跨域图片无法直接 <a download>，通过 Worker 代理拉取后转 blob 下载
        var proxyUrl = '/api/proxy?url=' + encodeURIComponent(url);
        fetch(proxyUrl)
            .then(function (r) { return r.blob(); })
            .then(function (blob) {
                var blobUrl = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = blobUrl;
                a.download = 'easystarimage_chanel.jpg';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 1000);
            })
            .catch(function () { window.open(url, '_blank'); }); // 兜底：新标签打开
    }

    function resetResult() {
        resultEmpty.classList.remove('hidden');
        resultStatus.classList.add('hidden');
        spinner.classList.add('hidden');
        resultImgArea.classList.add('hidden');
        resultError.classList.add('hidden');
    }

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

})();`;

// ── Chanel法式极简风 · 预构建融合提示词 ──────────────────────────────────────

function buildChanelPrompt(shot, imageCount) {
    shot = shot || 1;
    imageCount = imageCount || 1;

    // 多图时强化身份锚定语言
    var multiRefNote = imageCount >= 3
        ? 'MULTI-ANGLE REFERENCE: Three photos (front, side, and alternate angle) of this person have been provided. These show the SAME individual from different viewpoints. Use ALL three references to reconstruct an accurate 3D understanding of this person\'s facial structure — do NOT average them into a generic face.'
        : imageCount === 2
        ? 'TWO-ANGLE REFERENCE: Two photos of this person from different angles have been provided. Use both to better understand the 3D facial structure.'
        : '';

    const faceSegment = `SUBJECT IDENTITY (DO NOT ALTER FACE):
An Asian woman with oval face shape and soft jawline,
almond-shaped medium-large dark brown eyes with warm gentle gaze,
straight nose with rounded tip, M-shaped natural lips with pale rosy pink tone,
warm neutral fair skin with smooth natural texture and subtle glow,
shoulder-length straight dark brown hair with slight natural wave at ends,
youthful appearance in late twenties with gentle intellectual aura.
Distinctive features: expressive almond eyes, defined cheekbones, warm serene expression.

${multiRefNote}

CRITICAL: The generated image MUST look like THIS SPECIFIC PERSON.
Multiple reference photos have been provided from different angles — use them to preserve the true 3D facial structure.
Preserve exact face shape, eye shape, nose, lips, and skin tone in ALL angles.
This is NOT a celebrity face substitute.`;

    const shots = {
        1: `STYLE SETTINGS — Apply to the person described above:
half-body portrait, classic Chanel black tweed jacket with gold buttons,
layered pearl necklaces, camellia brooch on lapel,
French window light from left side, soft directional natural light,
warm neutral tone (4000-4500K), clean mid-high key exposure,
85mm f/2.0, background softly blurred,
classic red lips (the only makeup emphasis), bare eye makeup,
effortless Parisian elegance, timeless Chanel advertisement aesthetic,
warm ivory background, herringbone wooden floor partially visible.

IMPORTANT: Style elements applied to the SPECIFIC PERSON above, not any celebrity.`,

        2: `STYLE SETTINGS — Apply to the person described above:
subject silhouetted against tall Parisian window,
classic LBD (little black dress) silhouette in black,
French low bun hairstyle with loose strands,
afternoon backlight creating soft rim light on hair and shoulders,
85mm f/1.8, romantic and mysterious French light,
warm window glow, clean composition,
minimal jewelry — single pearl earring,
mood: quiet confidence, private sophistication,
Chanel No.5 advertisement mood, timeless French femininity.

IMPORTANT: Style elements applied to the SPECIFIC PERSON above, not any celebrity.`
    };

    const qualitySegment = `QUALITY & CONSISTENCY REQUIREMENTS:
Ultra-high definition, 8K resolution, luxury brand commercial quality,
Natural skin texture with subtle realistic details,
Anatomically correct body proportions,
Face must remain this specific person — NO face substitution,
Lighting consistent across face, body, and background,
No plastic or waxy skin appearance,
Black-white-gold Chanel palette maintained.

NEGATIVE CONSTRAINTS:
deformed face, distorted features, asymmetric eyes, crooked nose,
wrong face shape, face swap, different person, celebrity substitution,
generic AI face, stock photo face, idealized composite face,
extra fingers, missing fingers, fused hands,
over-smoothed plastic skin, wax figure effect, doll-like face,
colorful non-Chanel palette, heavy jewelry overkill, busy patterns,
harsh industrial setting, cold blue tones, cheap-looking fabrics,
blurry, watermark, text overlay, signature, low quality,
bad anatomy, malformed body, unnatural pose`;

    return [faceSegment, shots[shot] || shots[1], qualitySegment].join('\n\n');
}

// ── EvoLink API 封装 ─────────────────────────────────────────────────────────

async function submitEvoLinkTask(prompt, apiKey) {
    const res = await fetch(EVOLINK_BASE + '/v1/images/generations', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: MODEL,
            prompt: prompt,
            size: SIZE,
            resolution: RESOLUTION,
            quality: QUALITY,
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error('EvoLink submit failed: ' + err.slice(0, 200));
    }

    const data = await res.json();
    return data.id;
}

async function queryEvoLinkTask(taskId, apiKey) {
    const res = await fetch(EVOLINK_BASE + '/v1/tasks/' + taskId, {
        headers: { 'Authorization': 'Bearer ' + apiKey },
    });

    if (!res.ok) {
        throw new Error('EvoLink status query failed');
    }

    const data = await res.json();
    const status = data.status;

    if (status === 'completed') {
        // 兼容多种响应结构
        // EvoLink 可能返回: result_data[{url}], results["url字符串"], data[{url}], 或顶层 url/image_url
        const results = data.result_data || data.data || data.results || data.output?.data || [];
        const first = Array.isArray(results) ? results[0] : results;
        const url = (typeof first === 'string') ? first
            : (first && (first.url || first.image_url))
            || data.url || data.image_url || data.output_url || null;
        return { status: 'completed', image_url: url, _raw: data };
    }

    if (status === 'failed') {
        const errMsg = (data.error && data.error.message) || 'Unknown error';
        return { status: 'failed', error: errMsg };
    }

    // pending / processing
    return {
        status: status,
        progress: data.progress || 0,
    };
}

// ── CORS 头 ──────────────────────────────────────────────────────────────────

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function jsonResponse(data, status) {
    status = status || 200;
    return new Response(JSON.stringify(data), {
        status: status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders(),
        },
    });
}

// ── 静态文件服务 ─────────────────────────────────────────────────────────────

function serveStatic(content, contentType) {
    return new Response(content, {
        status: 200,
        headers: {
            'Content-Type': contentType + '; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
        },
    });
}

// ── 路由 ─────────────────────────────────────────────────────────────────────

async function handleRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const apiKey = env.EVOLINK_API_KEY;

    if (!apiKey) {
        return jsonResponse({ error: 'Server config error: API key not set' }, 500);
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // ── 静态文件 ──────────────────────────────────────────────────────────

    if (path === '/' || path === '/index.html') {
        return serveStatic(HTML, 'text/html');
    }
    if (path === '/css/style.css') {
        return serveStatic(CSS, 'text/css');
    }
    if (path === '/js/app.js') {
        return serveStatic(JS, 'application/javascript');
    }

    // ── API ────────────────────────────────────────────────────────────────

    // POST /api/generate
    if (path === '/api/generate' && request.method === 'POST') {
        try {
            const body = await request.json();
            const shot = body.shot || 1;
            const images = body.images || [];
            const imageCount = images.length || 1;

            const prompt = buildChanelPrompt(shot, imageCount);
            const taskId = await submitEvoLinkTask(prompt, apiKey);

            return jsonResponse({ task_id: taskId });
        } catch (err) {
            return jsonResponse({ error: err.message }, 500);
        }
    }

    // GET /api/status/:taskId
    const statusMatch = path.match(/^\/api\/status\/(.+)$/);
    if (statusMatch && request.method === 'GET') {
        try {
            const taskId = statusMatch[1];
            const result = await queryEvoLinkTask(taskId, apiKey);
            return jsonResponse(result);
        } catch (err) {
            return jsonResponse({ error: err.message }, 500);
        }
    }

    // GET /api/proxy?url=... — 代理外部图片，解决跨域下载问题
    if (path === '/api/proxy' && request.method === 'GET') {
        const imageUrl = url.searchParams.get('url');
        if (!imageUrl) return jsonResponse({ error: 'Missing url param' }, 400);
        try {
            const imgRes = await fetch(imageUrl);
            if (!imgRes.ok) return jsonResponse({ error: 'Upstream image not available' }, 502);
            const contentType = imgRes.headers.get('Content-Type') || 'image/jpeg';
            return new Response(imgRes.body, {
                status: 200,
                headers: {
                    'Content-Type': contentType,
                    'Content-Disposition': 'attachment; filename="easystarimage_chanel.jpg"',
                    'Cache-Control': 'private, max-age=300',
                    ...corsHeaders(),
                },
            });
        } catch (err) {
            return jsonResponse({ error: 'Proxy failed: ' + err.message }, 502);
        }
    }

    // 404
    return jsonResponse({ error: 'Not found' }, 404);
}

// ── Worker 入口 ─────────────────────────────────────────────────────────────

export default {
    async fetch(request, env) {
        return handleRequest(request, env);
    },
};

// ---
// by CC

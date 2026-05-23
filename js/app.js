/**
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
        if (!file.type.match(/^image\/(jpeg|png|webp)$/)) {
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
    retryBtn.addEventListener('click', startGeneration);
    regenerateBtn.addEventListener('click', startGeneration);

    async function startGeneration() {
        if (filledCount() === 0) return;

        generateBtn.disabled = true;
        resultSection.classList.remove('hidden');
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

            // 轮询
            statusText.textContent = '正在生成中，预计需要1-2分钟...';
            var imageUrl = await pollTask(taskId);

            // 展示结果
            resultStatus.classList.add('hidden');
            spinner.classList.add('hidden');
            resultImgArea.classList.remove('hidden');
            resultImage.src = imageUrl;

            downloadBtn.onclick = function () { downloadImage(imageUrl); };

        } catch (err) {
            console.error(err);
            resultStatus.classList.add('hidden');
            spinner.classList.add('hidden');
            resultError.classList.remove('hidden');
        }

        generateBtn.disabled = false;
    }

    async function pollTask(taskId, timeoutSec) {
        timeoutSec = timeoutSec || 180;
        var deadline = Date.now() + timeoutSec * 1000;

        while (Date.now() < deadline) {
            var res = await fetch(API_BASE + '/status/' + taskId);
            if (!res.ok) throw new Error('状态查询失败');

            var data = await res.json();
            var status = data.status;

            if (status === 'completed') return data.image_url;
            if (status === 'failed') throw new Error(data.error || '生成失败');

            var progress = data.progress || 0;
            statusText.textContent = '正在生成中... ' + progress + '%';
            await sleep(3000);
        }

        throw new Error('生成超时，请重试');
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
        var a = document.createElement('a');
        a.href = url;
        a.download = 'easystarimage_chanel.jpg';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    function resetResult() {
        resultSection.classList.add('hidden');
        resultStatus.classList.remove('hidden');
        spinner.classList.add('hidden');
        resultImgArea.classList.add('hidden');
        resultError.classList.add('hidden');
    }

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

})();

// ---
// by CC

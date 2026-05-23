/**
 * EasyStarImage MVP · Cloudflare Worker
 *
 * 功能：
 *   POST /api/generate  — 接收用户照片 + 模板选择 → 提交 EvoLink 任务 → 返回 task_id
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
const MODEL = 'gemini-3.1-flash-image-preview';
const QUALITY = '2K';
const SIZE = '3:4';

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
            quality: QUALITY,
            model_params: {
                image_search: true,
                thinking_level: 'auto',
            },
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
    const res = await fetch(EVOLINK_BASE + '/v1/task/' + taskId, {
        headers: { 'Authorization': 'Bearer ' + apiKey },
    });

    if (!res.ok) {
        throw new Error('EvoLink status query failed');
    }

    const data = await res.json();
    const status = data.status;

    if (status === 'completed') {
        const results = data.data || data.results || [];
        const url = results.length > 0
            ? (results[0].url || results[0].image_url)
            : (data.url || data.image_url);
        return { status: 'completed', image_url: url };
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

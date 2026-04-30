// Dashboard'dan gelen config'i state.json'a yazar (GitHub'a push eder)
// Auth: SHARED_SECRET env variable

'use strict';

const REPO   = 'melihbalcii/kripto-bot';
const BRANCH = 'main';
const FILE   = 'state.json';
const API    = `https://api.github.com/repos/${REPO}/contents/${FILE}`;

exports.handler = async (event) => {
  // CORS
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Secret',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method not allowed' };

  const secret    = event.headers['x-secret'] || event.headers['X-Secret'];
  const expected  = process.env.SHARED_SECRET;
  if (!expected || secret !== expected) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Yetkisiz' }) };
  }

  const ghToken = process.env.GH_TOKEN;
  if (!ghToken) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'GH_TOKEN env eksik' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: 'Geçersiz JSON' }; }

  const { config, action, initialBalance } = body;

  try {
    // 1. Mevcut state'i çek
    const getRes = await fetch(API, {
      headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' },
    });
    if (!getRes.ok) {
      const err = await getRes.text();
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: `GitHub GET ${getRes.status}: ${err}` }) };
    }
    const file  = await getRes.json();
    const text  = Buffer.from(file.content, 'base64').toString('utf8');
    const state = JSON.parse(text);

    let message = 'config güncellendi';

    if (action === 'reset') {
      const bal = parseFloat(initialBalance) || 100;
      state.balance        = bal;
      state.initialBalance = bal;
      state.positions      = [];
      state.history        = [];
      state.balanceHistory = [{ time: Date.now(), value: bal }];
      state.dailyStart     = bal;
      state.dailyStartTime = new Date().setHours(0, 0, 0, 0);
      state.totalTrades    = 0;
      state.wins           = 0;
      state.lastRun        = null;
      if (config) state.config = { ...state.config, ...config };
      message = `bot $${bal} ile sıfırlandı`;
    } else {
      // Sadece config güncelleme
      if (!config) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'config gerekli' }) };
      }
      state.config = { ...state.config, ...config };
    }

    // 2. Push
    const newContent = Buffer.from(JSON.stringify(state, null, 2)).toString('base64');
    const putRes = await fetch(API, {
      method:  'PUT',
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept:        'application/vnd.github+json',
        'Content-Type':'application/json',
      },
      body: JSON.stringify({
        message: `dashboard: ${message}`,
        content: newContent,
        sha:     file.sha,
        branch:  BRANCH,
      }),
    });
    if (!putRes.ok) {
      const err = await putRes.text();
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: `GitHub PUT ${putRes.status}: ${err}` }) };
    }

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, message }),
    };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};

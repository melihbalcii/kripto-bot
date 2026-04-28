'use strict';

const fs   = require('fs');
const path = require('path');
const { analyze } = require('./strategy');

const STATE_FILE = path.join(__dirname, '..', 'state.json');
const KLINE_LIMIT = 100;

// CryptoCompare sembol eşleştirme
const CC_SYMBOL = {
  BTCUSDT: 'BTC', ETHUSDT: 'ETH', SOLUSDT: 'SOL',
  BNBUSDT: 'BNB', XRPUSDT: 'XRP', DOGEUSDT: 'DOGE',
  ADAUSDT: 'ADA', AVAXUSDT: 'AVAX', LINKUSDT: 'LINK',
  DOTUSDT: 'DOT', LTCUSDT: 'LTC', ATOMUSDT: 'ATOM',
};

// ── Durum yükle ──────────────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return defaultState();
  }
}

function defaultState() {
  return {
    balance: 100,
    initialBalance: 100,
    positions: [],
    history: [],
    balanceHistory: [{ time: Date.now(), value: 100 }],
    dailyStart: 100,
    dailyStartTime: todayStart(),
    totalTrades: 0,
    wins: 0,
    config: {
      leverage: 5,
      stopLoss: 2,
      takeProfit: 4,
      positionSize: 30,
      maxPositions: 3,
      emaShort: 9,
      emaLong: 21,
      rsiPeriod: 14,
      rsiBuy: 45,
      rsiSell: 55,
      activeSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'],
    },
    lastRun: null,
  };
}

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function saveState(state) {
  state.lastRun = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── CryptoCompare API (GitHub Actions'dan erişilebilir, ücretsiz) ─

async function fetchKlines(symbol) {
  const fsym = CC_SYMBOL[symbol];
  if (!fsym) throw new Error(`Bilinmeyen sembol: ${symbol}`);
  const url = `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${fsym}&tsym=USDT&limit=${KLINE_LIMIT}&aggregate=15`;
  const res  = await fetch(url, { headers: { 'User-Agent': 'KriptoBot/1.0' } });
  if (!res.ok) throw new Error(`CryptoCompare ${symbol}: ${res.status}`);
  const json = await res.json();
  if (json.Response !== 'Success') throw new Error(`CryptoCompare ${symbol}: ${json.Message}`);
  return json.Data.Data.map(k => ({
    time:   k.time * 1000,
    open:   k.open,
    high:   k.high,
    low:    k.low,
    close:  k.close,
    volume: k.volumefrom,
  }));
}

async function fetchPrice(symbol) {
  const fsym = CC_SYMBOL[symbol];
  if (!fsym) return null;
  const url = `https://min-api.cryptocompare.com/data/price?fsym=${fsym}&tsyms=USDT`;
  const res  = await fetch(url, { headers: { 'User-Agent': 'KriptoBot/1.0' } });
  if (!res.ok) return null;
  const json = await res.json();
  return json.USDT || null;
}

// ── Pozisyon işlemleri ────────────────────────────────────────────

function openPosition(state, symbol, direction, price) {
  const cfg = state.config;
  if (state.positions.find(p => p.symbol === symbol)) return null;
  if (state.positions.length >= cfg.maxPositions) return null;

  const margin = state.balance * (cfg.positionSize / 100);
  if (margin < 1) return null;

  const pos = {
    id: Date.now(),
    symbol,
    direction,
    entryPrice: price,
    margin,
    leverage: cfg.leverage,
    size: margin * cfg.leverage,
    stopLossPrice: direction === 'LONG'
      ? price * (1 - cfg.stopLoss / 100)
      : price * (1 + cfg.stopLoss / 100),
    takeProfitPrice: direction === 'LONG'
      ? price * (1 + cfg.takeProfit / 100)
      : price * (1 - cfg.takeProfit / 100),
    openTime: Date.now(),
  };

  state.balance -= margin;
  state.positions.push(pos);
  console.log(`✅ AÇILDI: ${symbol} ${direction} @ $${price.toFixed(4)} | Marjin: $${margin.toFixed(2)}`);
  return pos;
}

function closePosition(state, pos, closePrice, reason) {
  const priceMove = (closePrice - pos.entryPrice) / pos.entryPrice;
  const pnl = pos.direction === 'LONG'
    ? priceMove * pos.size
    : -priceMove * pos.size;

  state.balance += pos.margin + pnl;
  state.totalTrades++;
  if (pnl > 0) state.wins++;

  state.history.unshift({
    id: pos.id, symbol: pos.symbol, direction: pos.direction,
    entryPrice: pos.entryPrice, closePrice,
    leverage: pos.leverage, pnl,
    pnlPct: (pnl / pos.margin) * 100,
    reason, openTime: pos.openTime, closeTime: Date.now(),
  });

  state.balanceHistory.push({ time: Date.now(), value: state.balance });
  if (state.balanceHistory.length > 500) state.balanceHistory = state.balanceHistory.slice(-500);
  if (state.history.length > 200) state.history = state.history.slice(0, 200);

  const sign = pnl >= 0 ? '+' : '';
  console.log(`${pnl >= 0 ? '💰' : '💸'} KAPANDI: ${pos.symbol} (${reason}) ${sign}$${pnl.toFixed(2)} | Bakiye: $${state.balance.toFixed(2)}`);
}

function checkStopLossTakeProfit(state, prices) {
  const toClose = [];

  for (const pos of state.positions) {
    const price = prices[pos.symbol];
    if (!price) continue;

    let reason = null;
    if (pos.direction === 'LONG') {
      if (price <= pos.stopLossPrice)  reason = 'SL';
      if (price >= pos.takeProfitPrice) reason = 'TP';
    } else {
      if (price >= pos.stopLossPrice)  reason = 'SL';
      if (price <= pos.takeProfitPrice) reason = 'TP';
    }

    if (reason) toClose.push({ pos, price, reason });
  }

  for (const { pos, price, reason } of toClose) {
    state.positions = state.positions.filter(p => p.id !== pos.id);
    closePosition(state, pos, price, reason);
  }
}

// ── Günlük sıfırlama ─────────────────────────────────────────────

function resetDailyIfNeeded(state) {
  if (state.dailyStartTime < todayStart()) {
    state.dailyStart = state.balance;
    state.dailyStartTime = todayStart();
  }
}

// ── Ana çalışma ───────────────────────────────────────────────────

async function run() {
  console.log(`\n🤖 Bot çalışıyor: ${new Date().toISOString()}`);

  const state = loadState();
  resetDailyIfNeeded(state);

  const cfg = state.config;

  // Tüm aktif coinler için fiyat çek (tek seferde)
  const prices = {};
  try {
    const fsyms = cfg.activeSymbols.map(s => CC_SYMBOL[s]).filter(Boolean).join(',');
    const url   = `https://min-api.cryptocompare.com/data/pricemulti?fsyms=${fsyms}&tsyms=USDT`;
    const res   = await fetch(url, { headers: { 'User-Agent': 'KriptoBot/1.0' } });
    if (res.ok) {
      const data = await res.json();
      for (const sym of cfg.activeSymbols) {
        const fsym = CC_SYMBOL[sym];
        if (fsym && data[fsym]?.USDT) prices[sym] = data[fsym].USDT;
      }
    }
  } catch (e) {
    console.error('Fiyat alınamadı:', e.message);
  }

  // SL/TP kontrolü (her zaman çalışır)
  checkStopLossTakeProfit(state, prices);

  // Sinyal kontrolü: her aktif coin için kline çek ve strateji uygula
  for (const symbol of cfg.activeSymbols) {
    try {
      const candles = await fetchKlines(symbol);
      const analysis = analyze(candles, cfg);

      if (!analysis || !analysis.signal) {
        console.log(`📊 ${symbol}: RSI=${analysis?.rsi?.toFixed(1) ?? '--'} | Sinyal yok`);
      } else {
        console.log(`📊 ${symbol}: RSI=${analysis.rsi.toFixed(1)} | Sinyal: ${analysis.signal}`);
        const price = prices[symbol] || candles[candles.length - 1].close;
        openPosition(state, symbol, analysis.signal, price);
      }
    } catch (e) {
      console.error(`${symbol} strateji hatası:`, e.message);
    }
    // Rate limit için bekleme
    await new Promise(r => setTimeout(r, 2000));
  }

  // Özet
  const unrealized = state.positions.reduce((s, p) => {
    const price = prices[p.symbol] || p.entryPrice;
    const move  = (price - p.entryPrice) / p.entryPrice;
    return s + (p.direction === 'LONG' ? move : -move) * p.size;
  }, 0);

  console.log(`\n📈 Bakiye: $${(state.balance + unrealized).toFixed(2)} | Pozisyon: ${state.positions.length} | İşlem: ${state.totalTrades}`);

  saveState(state);
  console.log('💾 Durum kaydedildi.\n');
}

run().catch(err => {
  console.error('Bot hatası:', err);
  process.exit(1);
});

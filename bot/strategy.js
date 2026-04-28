'use strict';

function ema(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let val = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    val = prices[i] * k + val * (1 - k);
  }
  return val;
}

function rsi(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const changes = [];
  for (let i = 1; i < prices.length; i++) changes.push(prices[i] - prices[i - 1]);
  const recent = changes.slice(-period);
  const gains = recent.filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
  const losses = Math.abs(recent.filter(c => c < 0).reduce((a, b) => a + b, 0)) / period;
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function analyze(candles, config) {
  const { emaShort, emaLong, rsiPeriod, rsiBuy, rsiSell } = config;
  const closes = candles.map(c => c.close);
  if (closes.length < emaLong + 5) return null;

  const currentRsi  = rsi(closes, rsiPeriod);
  const emaShortVal = ema(closes, emaShort);
  const emaLongVal  = ema(closes, emaLong);
  const prev3closes = closes.slice(0, -3);
  const emaShortPrev = ema(prev3closes, emaShort);
  const emaLongPrev  = ema(prev3closes, emaLong);

  if (!currentRsi || !emaShortVal || !emaLongVal) return null;

  const spreadNow  = emaShortVal - emaLongVal;
  const spreadPrev = (emaShortPrev && emaLongPrev) ? emaShortPrev - emaLongPrev : 0;

  let signal = null;
  if (emaShortVal > emaLongVal && spreadNow > spreadPrev && currentRsi < rsiBuy) signal = 'LONG';
  else if (emaShortVal < emaLongVal && spreadNow < spreadPrev && currentRsi > rsiSell) signal = 'SHORT';

  return { signal, rsi: currentRsi, emaShort: emaShortVal, emaLong: emaLongVal };
}

module.exports = { analyze };

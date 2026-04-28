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
  const gains  = recent.filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
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
  if (!currentRsi || !emaShortVal || !emaLongVal) return null;

  const bullTrend = emaShortVal > emaLongVal;
  const bearTrend = emaShortVal < emaLongVal;

  let signal = null;

  // LONG: EMA uptrend + oversold  VEYA  extreme oversold (RSI<30, trend fark etmez)
  if (currentRsi < rsiBuy && (bullTrend || currentRsi < 30)) {
    signal = 'LONG';
  }
  // SHORT: EMA downtrend + overbought  VEYA  extreme overbought (RSI>70, trend fark etmez)
  else if (currentRsi > rsiSell && (bearTrend || currentRsi > 70)) {
    signal = 'SHORT';
  }

  return { signal, rsi: currentRsi, emaShort: emaShortVal, emaLong: emaLongVal, trend: bullTrend ? 'BULL' : 'BEAR' };
}

module.exports = { analyze };

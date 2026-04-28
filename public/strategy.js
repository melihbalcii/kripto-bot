// EMA + RSI Strategy Engine

const Strategy = {
  // EMA hesaplama
  ema(prices, period) {
    if (prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
  },

  // RSI hesaplama
  rsi(prices, period = 14) {
    if (prices.length < period + 1) return null;
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }
    const recent = changes.slice(-period);
    const gains = recent.filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
    const losses = Math.abs(recent.filter(c => c < 0).reduce((a, b) => a + b, 0)) / period;
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
  },

  analyze(prices, config) {
    const { emaShort, emaLong, rsiPeriod, rsiBuy, rsiSell } = config;
    const closePrices  = prices.map(c => c.close);
    if (closePrices.length < emaLong + 5) return null;

    const currentRsi  = this.rsi(closePrices, rsiPeriod);
    const emaShortVal = this.ema(closePrices, emaShort);
    const emaLongVal  = this.ema(closePrices, emaLong);
    const currentPrice = closePrices[closePrices.length - 1];

    const result = {
      rsi: currentRsi ? currentRsi.toFixed(1) : '--',
      emaShort: emaShortVal, emaLong: emaLongVal,
      price: currentPrice, signal: null,
      trend: emaShortVal > emaLongVal ? 'BULL' : 'BEAR',
    };

    if (currentRsi === null || !emaShortVal || !emaLongVal) return result;

    const bullTrend = emaShortVal > emaLongVal;
    const bearTrend = emaShortVal < emaLongVal;

    // LONG: EMA uptrend + oversold  VEYA  extreme oversold (RSI<30)
    if (currentRsi < rsiBuy && (bullTrend || currentRsi < 30)) {
      result.signal = 'LONG';
    }
    // SHORT: EMA downtrend + overbought  VEYA  extreme overbought (RSI>70)
    else if (currentRsi > rsiSell && (bearTrend || currentRsi > 70)) {
      result.signal = 'SHORT';
    }

    return result;
  },
};

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

  // EMA trend yönü + momentum bazlı sinyal
  // Crossover yerine trend durumu kullanıyoruz → çok daha sık tetiklenir
  analyze(prices, config) {
    const { emaShort, emaLong, rsiPeriod, rsiBuy, rsiSell } = config;
    const closePrices = prices.map(c => c.close);

    if (closePrices.length < emaLong + 5) return null;

    const currentRsi   = this.rsi(closePrices, rsiPeriod);
    const emaShortVal  = this.ema(closePrices, emaShort);
    const emaLongVal   = this.ema(closePrices, emaLong);
    const currentPrice = closePrices[closePrices.length - 1];

    // EMA eğimi: son 3 mumun ortalamasıyla karşılaştır
    const prev3 = closePrices.slice(0, -3);
    const emaShortPrev = this.ema(prev3, emaShort);
    const emaLongPrev  = this.ema(prev3, emaLong);

    const result = {
      rsi: currentRsi ? currentRsi.toFixed(1) : '--',
      emaShort: emaShortVal,
      emaLong: emaLongVal,
      price: currentPrice,
      signal: null,
      trend: emaShortVal > emaLongVal ? 'BULL' : 'BEAR',
    };

    if (currentRsi === null || !emaShortVal || !emaLongVal) return result;

    const bullTrend = emaShortVal > emaLongVal;
    const bearTrend = emaShortVal < emaLongVal;

    // EMA momentum: trend güçleniyor mu?
    const spreadNow  = emaShortVal - emaLongVal;
    const spreadPrev = emaShortPrev - emaLongPrev;
    const momentumUp   = spreadNow > spreadPrev;  // boğa trendi güçleniyor
    const momentumDown = spreadNow < spreadPrev;  // ayı trendi güçleniyor

    // LONG: boğa trend + RSI aşırı satım bölgesinden çıkıyor + momentum yukarı
    if (bullTrend && momentumUp && currentRsi < rsiBuy) {
      result.signal = 'LONG';
    }
    // SHORT: ayı trend + RSI aşırı alım bölgesinden dönüyor + momentum aşağı
    else if (bearTrend && momentumDown && currentRsi > rsiSell) {
      result.signal = 'SHORT';
    }

    return result;
  },
};

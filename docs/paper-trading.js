// Paper Trading Engine

const PaperTrading = {
  state: null,

  defaultState() {
    return {
      balance: 100,
      initialBalance: 100,
      positions: [],
      history: [],
      balanceHistory: [{ time: Date.now(), value: 100 }],
      dailyStart: 100,
      dailyStartTime: this._todayStart(),
      totalTrades: 0,
      wins: 0,
    };
  },

  _todayStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  },

  load() {
    try {
      const saved = localStorage.getItem('kriptobot_state');
      this.state = saved ? JSON.parse(saved) : this.defaultState();
    } catch {
      this.state = this.defaultState();
    }
    this._resetDailyIfNeeded();
  },

  save() {
    localStorage.setItem('kriptobot_state', JSON.stringify(this.state));
  },

  reset(newBalance = 100) {
    this.state = this.defaultState();
    this.state.balance = newBalance;
    this.state.initialBalance = newBalance;
    this.state.balanceHistory = [{ time: Date.now(), value: newBalance }];
    this.state.dailyStart = newBalance;
    this.save();
  },

  _resetDailyIfNeeded() {
    if (this.state.dailyStartTime < this._todayStart()) {
      this.state.dailyStart = this.state.balance;
      this.state.dailyStartTime = this._todayStart();
      this.save();
    }
  },

  // Pozisyon aç
  openPosition(symbol, direction, price, config) {
    const { leverage, stopLoss, takeProfit, positionSize, maxPositions } = config;

    // Aynı coinde açık pozisyon var mı?
    if (this.state.positions.find(p => p.symbol === symbol)) return null;

    // Max pozisyon kontrolü
    if (this.state.positions.length >= maxPositions) return null;

    // Yetersiz bakiye
    const margin = this.state.balance * (positionSize / 100);
    if (margin < 1) return null;

    const position = {
      id: Date.now(),
      symbol,
      direction,
      entryPrice: price,
      margin,
      leverage,
      size: margin * leverage,
      stopLossPrice: direction === 'LONG'
        ? price * (1 - stopLoss / 100)
        : price * (1 + stopLoss / 100),
      takeProfitPrice: direction === 'LONG'
        ? price * (1 + takeProfit / 100)
        : price * (1 - takeProfit / 100),
      openTime: Date.now(),
      unrealizedPnl: 0,
    };

    this.state.balance -= margin;
    this.state.positions.push(position);
    this.save();
    return position;
  },

  // Pozisyon güncelle + SL/TP kontrolü
  updatePositions(prices) {
    const closed = [];

    this.state.positions = this.state.positions.filter(pos => {
      const currentPrice = prices[pos.symbol];
      if (!currentPrice) return true;

      const priceMove = (currentPrice - pos.entryPrice) / pos.entryPrice;
      const pnl = pos.direction === 'LONG'
        ? priceMove * pos.size
        : -priceMove * pos.size;

      pos.unrealizedPnl = pnl;
      pos.currentPrice = currentPrice;

      let closeReason = null;

      if (pos.direction === 'LONG') {
        if (currentPrice <= pos.stopLossPrice) closeReason = 'SL';
        else if (currentPrice >= pos.takeProfitPrice) closeReason = 'TP';
      } else {
        if (currentPrice >= pos.stopLossPrice) closeReason = 'SL';
        else if (currentPrice <= pos.takeProfitPrice) closeReason = 'TP';
      }

      if (closeReason) {
        this._closePosition(pos, currentPrice, closeReason);
        closed.push({ ...pos, closeReason, closePrice: currentPrice, finalPnl: pnl });
        return false;
      }

      return true;
    });

    if (closed.length > 0) this.save();
    return closed;
  },

  _closePosition(pos, closePrice, reason) {
    const priceMove = (closePrice - pos.entryPrice) / pos.entryPrice;
    const pnl = pos.direction === 'LONG'
      ? priceMove * pos.size
      : -priceMove * pos.size;

    this.state.balance += pos.margin + pnl;
    this.state.totalTrades++;
    if (pnl > 0) this.state.wins++;

    this.state.history.unshift({
      id: pos.id,
      symbol: pos.symbol,
      direction: pos.direction,
      entryPrice: pos.entryPrice,
      closePrice,
      leverage: pos.leverage,
      pnl,
      pnlPct: (pnl / pos.margin) * 100,
      reason,
      openTime: pos.openTime,
      closeTime: Date.now(),
    });

    // Bakiye geçmişine kaydet
    this.state.balanceHistory.push({ time: Date.now(), value: this.state.balance });
    if (this.state.balanceHistory.length > 200) {
      this.state.balanceHistory = this.state.balanceHistory.slice(-200);
    }
  },

  manualClose(positionId, currentPrice) {
    const idx = this.state.positions.findIndex(p => p.id === positionId);
    if (idx === -1) return;
    const pos = this.state.positions[idx];
    this._closePosition(pos, currentPrice, 'MANUAL');
    this.state.positions.splice(idx, 1);
    this.save();
  },

  // İstatistikler
  stats() {
    const { balance, initialBalance, dailyStart, totalTrades, wins, positions } = this.state;
    const totalPnl = balance - initialBalance;
    const totalPnlPct = (totalPnl / initialBalance) * 100;
    const dailyPnl = balance - dailyStart;
    const dailyPnlPct = dailyStart > 0 ? (dailyPnl / dailyStart) * 100 : 0;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const unrealizedTotal = positions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
    const activeValue = positions.reduce((s, p) => s + p.margin, 0);

    return {
      balance: balance + unrealizedTotal,
      totalPnl: totalPnl + unrealizedTotal,
      totalPnlPct: ((totalPnl + unrealizedTotal) / initialBalance) * 100,
      dailyPnl,
      dailyPnlPct,
      totalTrades,
      winRate,
      activePositions: positions.length,
      activeValue,
      targetProgress: Math.min(((balance / (initialBalance * 3)) * 100), 100),
    };
  },
};

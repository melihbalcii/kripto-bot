// Kripto Bot - Ana Uygulama

const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT',
  'NEARUSDT', 'TRXUSDT', 'OPUSDT', 'MATICUSDT',
  'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'LTCUSDT', 'ATOMUSDT',
];
const KLINE_INTERVAL = '15m';
const KLINE_LIMIT = 100;

// GitHub reposundaki state.json URL'si — repo oluşturduktan sonra güncelle
// Örnek: 'https://raw.githubusercontent.com/KULLANICI/kripto-bot/main/state.json'
const GITHUB_STATE_URL = 'https://raw.githubusercontent.com/melihbalcii/kripto-bot/main/state.json';

const App = {
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

  botRunning: false,
  ws: {},
  prices: {},
  candles: {},
  balanceChart: null,
  priceUpdateTimeout: {},

  init() {
    PaperTrading.load();
    this.loadConfig();
    this.buildMarketGrid();
    this.buildCoinCheckboxes();
    this.buildBotControls();
    this.initChart();
    this.bindEvents();
    this.connectPriceFeed();
    this.fetchKlines();
    this.syncRemoteState();
    this.updateUI();
    setInterval(() => this.tick(), 30000);
    setInterval(() => this.updateUI(), 3000);
    if (GITHUB_STATE_URL) setInterval(() => this.syncRemoteState(), 60000);
  },

  buildBotControls() {
    const el = document.getElementById('botControls');
    if (!el) return;
    if (GITHUB_STATE_URL) {
      // GitHub Actions modu — buton yok, her zaman çalışıyor
      el.innerHTML = `
        <div class="github-status">
          <span class="gh-dot"></span>
          <span>GitHub Actions: 7/24 ÇALIŞIYOR</span>
        </div>`;
    } else {
      // Tarayıcı modu
      el.innerHTML = `
        <button class="btn btn-danger" id="stopBtn" style="display:none">⏹ Durdur</button>
        <button class="btn btn-success" id="startBtn">▶ Botu Başlat</button>`;
    }
  },

  async syncRemoteState() {
    if (!GITHUB_STATE_URL) return;
    try {
      const res = await fetch(`${GITHUB_STATE_URL}?t=${Date.now()}`);
      if (!res.ok) return;
      const remote = await res.json();
      // Sadece bot tarafından yönetilen alanları güncelle
      PaperTrading.state.balance        = remote.balance;
      PaperTrading.state.initialBalance = remote.initialBalance;
      PaperTrading.state.positions      = remote.positions || [];
      PaperTrading.state.history        = remote.history || [];
      PaperTrading.state.balanceHistory = remote.balanceHistory || [];
      PaperTrading.state.totalTrades    = remote.totalTrades || 0;
      PaperTrading.state.wins           = remote.wins || 0;
      PaperTrading.state.dailyStart     = remote.dailyStart;
      PaperTrading.state.dailyStartTime = remote.dailyStartTime;
      // Config güncelle
      if (remote.config) {
        this.config = { ...this.config, ...remote.config };
        this.buildCoinCheckboxes();
        this.applyConfigToForm();
      }
      // Son çalışma zamanını göster
      if (remote.lastRun) {
        const ago = Math.round((Date.now() - new Date(remote.lastRun)) / 60000);
        document.getElementById('pageSubtitle') && (document.getElementById('pageSubtitle').textContent = `Son güncelleme: ${ago} dakika önce`);
      }
      PaperTrading.save();
      this.updateUI();
      console.log('GitHub state senkronize edildi');
    } catch (e) {
      console.log('GitHub state çekilemedi:', e.message);
    }
  },

  buildMarketGrid() {
    const grid = document.getElementById('marketGrid');
    grid.innerHTML = SYMBOLS.map(sym => `
      <div class="market-item skeleton" id="market-${sym}">
        <div class="market-symbol">${sym.replace('USDT', '/USDT')}</div>
        <div class="market-price">--</div>
        <div class="market-change">--</div>
        <div class="market-indicators">
          <span class="ind" id="rsi-${sym}">RSI: --</span>
          <span class="ind" id="ema-${sym}">EMA: --</span>
        </div>
      </div>
    `).join('');
  },

  buildCoinCheckboxes() {
    const group = document.querySelector('.checkbox-group');
    if (!group) return;
    group.innerHTML = SYMBOLS.map(sym => `
      <label>
        <input type="checkbox" value="${sym}" ${this.config.activeSymbols.includes(sym) ? 'checked' : ''} />
        ${sym.replace('USDT', '/USDT')}
      </label>
    `).join('');
  },

  loadConfig() {
    const saved = localStorage.getItem('kriptobot_config');
    if (saved) this.config = { ...this.config, ...JSON.parse(saved) };
    this.applyConfigToForm();
  },

  saveConfig() {
    this.config.leverage = parseInt(document.getElementById('leverage').value);
    this.config.stopLoss = parseFloat(document.getElementById('stopLoss').value);
    this.config.takeProfit = parseFloat(document.getElementById('takeProfit').value);
    this.config.positionSize = parseInt(document.getElementById('positionSize').value);
    this.config.maxPositions = parseInt(document.getElementById('maxPositions').value);
    this.config.emaShort = parseInt(document.getElementById('emaShort').value);
    this.config.emaLong = parseInt(document.getElementById('emaLong').value);
    this.config.rsiPeriod = parseInt(document.getElementById('rsiPeriod').value);
    this.config.rsiBuy = parseInt(document.getElementById('rsiBuy').value);
    this.config.rsiSell = parseInt(document.getElementById('rsiSell').value);

    const checkedCoins = [...document.querySelectorAll('.checkbox-group input:checked')];
    this.config.activeSymbols = checkedCoins.map(c => c.value);

    localStorage.setItem('kriptobot_config', JSON.stringify(this.config));
    this.toast('Ayarlar kaydedildi!', 'success');
  },

  applyConfigToForm() {
    const s = this.config;
    document.getElementById('leverage').value = s.leverage;
    document.getElementById('stopLoss').value = s.stopLoss;
    document.getElementById('takeProfit').value = s.takeProfit;
    document.getElementById('positionSize').value = s.positionSize;
    document.getElementById('maxPositions').value = s.maxPositions;
    document.getElementById('emaShort').value = s.emaShort;
    document.getElementById('emaLong').value = s.emaLong;
    document.getElementById('rsiPeriod').value = s.rsiPeriod;
    document.getElementById('rsiBuy').value = s.rsiBuy;
    document.getElementById('rsiSell').value = s.rsiSell;

    document.querySelectorAll('.checkbox-group input').forEach(cb => {
      cb.checked = s.activeSymbols.includes(cb.value);
    });

    const initBalInput = document.getElementById('initialBalance');
    if (initBalInput) initBalInput.value = PaperTrading.state.initialBalance;
  },

  // ── BINANCE WEBSOCKET ──────────────────────────────────────────

  connectPriceFeed() {
    const streams = SYMBOLS.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
    const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      this.setConnectionStatus(true);
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (!msg.data) return;
      const d = msg.data;
      const symbol = d.s;
      const price = parseFloat(d.c);
      const open24h = parseFloat(d.o);
      const change24h = ((price - open24h) / open24h) * 100;

      this.prices[symbol] = price;
      this.updateMarketCard(symbol, price, change24h);
    };

    ws.onclose = () => {
      this.setConnectionStatus(false);
      setTimeout(() => this.connectPriceFeed(), 5000);
    };

    ws.onerror = () => ws.close();
  },

  async fetchKlines() {
    for (const symbol of SYMBOLS) {
      try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${KLINE_INTERVAL}&limit=${KLINE_LIMIT}`;
        const res = await fetch(url);
        const data = await res.json();
        this.candles[symbol] = data.map(k => ({
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          time: k[0],
        }));
        this.updateIndicators(symbol);
      } catch (e) {
        console.error('Kline fetch error:', symbol, e);
      }
    }
  },

  updateMarketCard(symbol, price, change24h) {
    const card = document.getElementById(`market-${symbol}`);
    if (!card) return;
    card.classList.remove('skeleton');

    const priceEl = card.querySelector('.market-price');
    const changeEl = card.querySelector('.market-change');

    const formatted = price > 1000
      ? price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : price < 1
        ? price.toFixed(4)
        : price.toFixed(2);

    priceEl.textContent = `$${formatted}`;
    changeEl.textContent = `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`;
    changeEl.className = `market-change ${change24h >= 0 ? 'up' : 'down'}`;

    // Flash animation
    priceEl.style.transition = 'color 0.3s';
    priceEl.style.color = change24h >= 0 ? '#10b981' : '#ef4444';
    clearTimeout(this.priceUpdateTimeout[symbol]);
    this.priceUpdateTimeout[symbol] = setTimeout(() => {
      priceEl.style.color = '';
    }, 500);
  },

  updateIndicators(symbol) {
    const candles = this.candles[symbol];
    if (!candles || candles.length < this.config.emaLong + 5) return;

    const analysis = Strategy.analyze(candles, this.config);
    if (!analysis) return;

    const rsiEl = document.getElementById(`rsi-${symbol}`);
    const emaEl = document.getElementById(`ema-${symbol}`);

    if (rsiEl) {
      const rsiVal = parseFloat(analysis.rsi);
      rsiEl.textContent = `RSI: ${analysis.rsi}`;
      rsiEl.className = `ind ${rsiVal < 40 ? 'bullish' : rsiVal > 60 ? 'bearish' : ''}`;
    }

    if (emaEl && analysis.emaShort && analysis.emaLong) {
      const trend = analysis.emaShort > analysis.emaLong ? 'Boğa' : 'Ayı';
      emaEl.textContent = `EMA: ${trend}`;
      emaEl.className = `ind ${analysis.emaShort > analysis.emaLong ? 'bullish' : 'bearish'}`;
    }
  },

  // ── BOT TICK ──────────────────────────────────────────────────

  tick() {
    // Kapalı pozisyonları kontrol et
    const closed = PaperTrading.updatePositions(this.prices);
    closed.forEach(pos => {
      const pnlStr = pos.finalPnl >= 0 ? `+$${pos.finalPnl.toFixed(2)}` : `-$${Math.abs(pos.finalPnl).toFixed(2)}`;
      this.toast(
        `${pos.symbol} ${pos.closeReason} → ${pnlStr}`,
        pos.finalPnl >= 0 ? 'success' : 'danger'
      );
      this.addSignal(pos.symbol, 'closed', pos.closePrice, `Kapatıldı (${pos.closeReason})`);
    });

    if (!this.botRunning) return;

    // Sinyal kontrolü
    this.config.activeSymbols.forEach(symbol => {
      this.fetchLatestCandle(symbol);
    });
  },

  async fetchLatestCandle(symbol) {
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${KLINE_INTERVAL}&limit=${KLINE_LIMIT}`;
      const res = await fetch(url);
      const data = await res.json();
      this.candles[symbol] = data.map(k => ({
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        time: k[0],
      }));

      this.updateIndicators(symbol);
      this.checkSignal(symbol);
    } catch (e) {
      console.error('Candle error:', symbol, e);
    }
  },

  checkSignal(symbol) {
    const candles = this.candles[symbol];
    if (!candles) return;

    const analysis = Strategy.analyze(candles, this.config);
    if (!analysis || !analysis.signal) return;

    const price = this.prices[symbol] || analysis.price;
    if (!price) return;

    // Açık pozisyon var mı?
    const existing = PaperTrading.state.positions.find(p => p.symbol === symbol);
    if (existing) return;

    const pos = PaperTrading.openPosition(symbol, analysis.signal, price, this.config);
    if (pos) {
      const dir = analysis.signal === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
      this.toast(`${symbol} ${dir} açıldı @ $${price.toFixed(2)}`, 'info');
      this.addSignal(symbol, analysis.signal.toLowerCase(), price, `RSI: ${analysis.rsi}`);
    }
  },

  // ── UI ──────────────────────────────────────────────────────

  updateUI() {
    const stats = PaperTrading.stats();

    // Stats
    document.getElementById('totalBalance').textContent = `$${stats.balance.toFixed(2)}`;

    const pnlEl = document.getElementById('totalPnl');
    const pnlSign = stats.totalPnl >= 0 ? '+' : '';
    pnlEl.textContent = `${pnlSign}$${stats.totalPnl.toFixed(2)} (${pnlSign}${stats.totalPnlPct.toFixed(2)}%)`;
    pnlEl.className = `stat-change ${stats.totalPnl >= 0 ? 'positive' : 'negative'}`;

    document.getElementById('dailyPnl').textContent = `${stats.dailyPnl >= 0 ? '+' : ''}$${stats.dailyPnl.toFixed(2)}`;
    document.getElementById('dailyPnlPct').textContent = `${stats.dailyPnlPct >= 0 ? '+' : ''}${stats.dailyPnlPct.toFixed(2)}%`;
    document.getElementById('totalTrades').textContent = stats.totalTrades;
    document.getElementById('winRate').textContent = `Kazanma: ${stats.winRate.toFixed(0)}%`;
    document.getElementById('activePositions').textContent = stats.activePositions;
    document.getElementById('positionValue').textContent = `$${stats.activeValue.toFixed(2)} marjin`;

    this.updatePositionsPage();
    this.updateHistoryPage();
    this.updateChart(stats.balance);
  },

  updatePositionsPage() {
    const container = document.getElementById('positionsContainer');
    const positions = PaperTrading.state.positions;

    if (positions.length === 0) {
      container.innerHTML = '<div class="empty-state">Açık pozisyon yok</div>';
      return;
    }

    const rows = positions.map(pos => {
      const currentPrice = pos.currentPrice || this.prices[pos.symbol] || pos.entryPrice;
      const pnl = pos.unrealizedPnl || 0;
      const pnlPct = (pnl / pos.margin) * 100;
      const pnlClass = pnl >= 0 ? 'pnl-positive' : 'pnl-negative';

      return `
        <tr>
          <td>${pos.symbol.replace('USDT', '/USDT')}</td>
          <td><span class="badge badge-${pos.direction.toLowerCase()}">${pos.direction}</span></td>
          <td>$${pos.entryPrice.toFixed(pos.entryPrice > 100 ? 2 : 4)}</td>
          <td>$${currentPrice.toFixed(currentPrice > 100 ? 2 : 4)}</td>
          <td>${pos.leverage}x</td>
          <td>$${pos.margin.toFixed(2)}</td>
          <td class="${pnlClass}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)</td>
          <td>$${pos.stopLossPrice.toFixed(2)}</td>
          <td>$${pos.takeProfitPrice.toFixed(2)}</td>
          <td>
            <button class="btn btn-sm" onclick="App.closePosition(${pos.id})">Kapat</button>
          </td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <table class="positions-table">
        <thead>
          <tr>
            <th>Coin</th><th>Yön</th><th>Giriş</th><th>Şu An</th>
            <th>Kaldıraç</th><th>Marjin</th><th>P&L</th>
            <th>SL</th><th>TP</th><th>İşlem</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  },

  closePosition(id) {
    const pos = PaperTrading.state.positions.find(p => p.id === id);
    if (!pos) return;
    const price = this.prices[pos.symbol] || pos.currentPrice || pos.entryPrice;
    PaperTrading.manualClose(id, price);
    this.toast(`${pos.symbol} pozisyonu manuel kapatıldı`, 'warning');
    this.updateUI();
  },

  updateHistoryPage() {
    const tbody = document.getElementById('historyBody');
    const history = PaperTrading.state.history;

    if (history.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Henüz işlem yok</td></tr>';
      return;
    }

    tbody.innerHTML = history.slice(0, 50).map(t => {
      const pnlClass = t.pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
      const time = new Date(t.closeTime).toLocaleString('tr-TR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      return `
        <tr>
          <td>${time}</td>
          <td>${t.symbol.replace('USDT', '/USDT')}</td>
          <td><span class="badge badge-${t.direction.toLowerCase()}">${t.direction}</span></td>
          <td>$${t.entryPrice.toFixed(t.entryPrice > 100 ? 2 : 4)}</td>
          <td>$${t.closePrice.toFixed(t.closePrice > 100 ? 2 : 4)}</td>
          <td>${t.leverage}x</td>
          <td class="${pnlClass}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)} (${t.pnlPct.toFixed(1)}%)</td>
          <td>${t.reason}</td>
        </tr>
      `;
    }).join('');
  },

  // ── CHART ───────────────────────────────────────────────────

  initChart() {
    const ctx = document.getElementById('balanceChart').getContext('2d');
    this.balanceChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Bakiye',
            data: [],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            fill: true,
            tension: 0.4,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
          {
            label: 'Hedef ($300)',
            data: [],
            borderColor: '#3b82f6',
            borderDash: [6, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a2235',
            titleColor: '#94a3b8',
            bodyColor: '#f1f5f9',
            borderColor: '#1e293b',
            borderWidth: 1,
            callbacks: {
              label: ctx => ` $${ctx.parsed.y.toFixed(2)}`,
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'hour', displayFormats: { hour: 'HH:mm' } },
            ticks: { color: '#64748b', maxTicksLimit: 8 },
            grid: { color: 'rgba(30, 41, 59, 0.5)' },
          },
          y: {
            ticks: {
              color: '#64748b',
              callback: v => `$${v.toFixed(0)}`,
            },
            grid: { color: 'rgba(30, 41, 59, 0.5)' },
          },
        },
      },
    });

    this.updateChart(PaperTrading.state.balance);
  },

  updateChart(currentBalance) {
    const history = PaperTrading.state.balanceHistory;
    if (!history || history.length === 0) return;

    const balData = history.map(h => ({ x: h.time, y: h.value }));
    const now = Date.now();
    const initial = PaperTrading.state.initialBalance;

    const targetLine = [
      { x: history[0].time, y: initial },
      { x: now, y: 300 },
    ];

    this.balanceChart.data.datasets[0].data = balData;
    this.balanceChart.data.datasets[1].data = targetLine;
    this.balanceChart.update('none');
  },

  // ── SIGNALS ─────────────────────────────────────────────────

  addSignal(symbol, direction, price, note) {
    const list = document.getElementById('signalsList');
    const emptyEl = list.querySelector('.signal-empty');
    if (emptyEl) emptyEl.remove();

    const item = document.createElement('div');
    item.className = `signal-item ${direction}`;

    const dirText = direction === 'long' ? '▲ LONG' : direction === 'short' ? '▼ SHORT' : '● KAPANDI';
    const dirClass = direction === 'long' ? 'signal-dir-long' : direction === 'short' ? 'signal-dir-short' : '';
    const time = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    item.innerHTML = `
      <div class="signal-header">
        <span class="signal-coin">${symbol.replace('USDT', '')}</span>
        <span class="${dirClass}">${dirText}</span>
        <span class="signal-time">${time}</span>
      </div>
      <div class="signal-price">$${price.toFixed(price > 100 ? 2 : 4)} · ${note}</div>
    `;

    list.insertBefore(item, list.firstChild);

    // Max 10 sinyal göster
    while (list.children.length > 10) list.removeChild(list.lastChild);
  },

  // ── EVENTS ──────────────────────────────────────────────────

  bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', e => {
        e.preventDefault();
        const page = item.dataset.page;
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        item.classList.add('active');
        document.getElementById(`page-${page}`).classList.add('active');
        document.getElementById('pageTitle').textContent =
          { dashboard: 'Dashboard', positions: 'Pozisyonlar', history: 'İşlem Geçmişi', settings: 'Ayarlar' }[page];
      });
    });

    // Bot start/stop (sadece tarayıcı modunda)
    const startBtn = document.getElementById('startBtn');
    const stopBtn  = document.getElementById('stopBtn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        this.botRunning = true;
        startBtn.style.display = 'none';
        stopBtn.style.display  = '';
        this.toast('Bot başlatıldı! Sinyal bekleniyor...', 'success');
      });
    }
    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        this.botRunning = false;
        stopBtn.style.display  = 'none';
        startBtn.style.display = '';
        this.toast('Bot durduruldu.', 'warning');
      });
    }

    // Settings
    document.getElementById('saveSettingsBtn').addEventListener('click', () => this.saveConfig());

    document.getElementById('resetBotBtn').addEventListener('click', () => {
      const bal = parseFloat(document.getElementById('initialBalance').value) || 100;
      if (confirm(`Botu ${bal} USDT ile sıfırlamak istediğinizden emin misiniz?`)) {
        PaperTrading.reset(bal);
        this.updateUI();
        this.initChart();
        this.toast('Bot sıfırlandı!', 'warning');
      }
    });

    document.getElementById('clearAllBtn').addEventListener('click', () => {
      if (confirm('Tüm veriler silinecek! Emin misiniz?')) {
        localStorage.clear();
        location.reload();
      }
    });

    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
      PaperTrading.state.history = [];
      PaperTrading.save();
      this.updateHistoryPage();
      this.toast('Geçmiş temizlendi.', 'info');
    });
  },

  setConnectionStatus(connected) {
    const el = document.getElementById('connectionStatus');
    const dot = el.querySelector('.conn-dot');
    const text = el.querySelector('span:last-child');
    dot.className = `conn-dot ${connected ? 'connected' : 'disconnected'}`;
    text.textContent = connected ? 'Bağlı' : 'Bağlanıyor...';
  },

  // ── TOAST ───────────────────────────────────────────────────

  toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());

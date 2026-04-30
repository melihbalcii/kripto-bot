// Kripto Bot - Ana Uygulama

const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT',
  'NEARUSDT', 'TRXUSDT', 'OPUSDT', 'POLUSDT',
  'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'LTCUSDT', 'ATOMUSDT',
];
const KLINE_INTERVAL = '15m';
const KLINE_LIMIT = 100;

// GitHub repo bilgileri
const GITHUB_REPO  = 'melihbalcii/kripto-bot';
const GITHUB_BRANCH = 'main';
const GITHUB_STATE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/state.json`;
const GITHUB_API_URL   = `https://api.github.com/repos/${GITHUB_REPO}/contents/state.json`;

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
    this.updateTokenStatus();
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

  async saveConfig() {
    this.config.leverage     = parseInt(document.getElementById('leverage').value);
    this.config.stopLoss     = parseFloat(document.getElementById('stopLoss').value);
    this.config.takeProfit   = parseFloat(document.getElementById('takeProfit').value);
    this.config.positionSize = parseInt(document.getElementById('positionSize').value);
    this.config.maxPositions = parseInt(document.getElementById('maxPositions').value);
    this.config.emaShort     = parseInt(document.getElementById('emaShort').value);
    this.config.emaLong      = parseInt(document.getElementById('emaLong').value);
    this.config.rsiPeriod    = parseInt(document.getElementById('rsiPeriod').value);
    this.config.rsiBuy       = parseInt(document.getElementById('rsiBuy').value);
    this.config.rsiSell      = parseInt(document.getElementById('rsiSell').value);

    const checkedCoins = [...document.querySelectorAll('.checkbox-group input:checked')];
    this.config.activeSymbols = checkedCoins.map(c => c.value);

    localStorage.setItem('kriptobot_config', JSON.stringify(this.config));

    // Token varsa GitHub'a da yaz
    const tokenInput = document.getElementById('githubToken');
    const newToken   = tokenInput?.value?.trim();
    if (newToken) {
      localStorage.setItem('kriptobot_github_token', newToken);
      tokenInput.value = '';
    }
    const token = localStorage.getItem('kriptobot_github_token');

    if (!token) {
      this.toast('Ayarlar tarayıcıya kaydedildi. Bot için GitHub token ekle!', 'warning');
      this.updateTokenStatus();
      return;
    }

    // Yeni başlangıç bakiyesi (sadece reset edilirse uygulanır, ama yine push edelim)
    const initBal = parseFloat(document.getElementById('initialBalance').value);

    try {
      this.toast('GitHub\'a gönderiliyor…', 'info');
      await this.pushConfigToGitHub(this.config, token, initBal);
      this.toast('Ayarlar GitHub\'a yüklendi! Bot 15 dakikada güncel ayarla çalışacak.', 'success');
      this.updateTokenStatus(true);
    } catch (e) {
      console.error('Config push hatası:', e);
      this.toast(`GitHub hatası: ${e.message}`, 'danger');
      this.updateTokenStatus(false);
    }
  },

  async pushConfigToGitHub(newConfig, token, newInitialBalance) {
    // 1. Mevcut state.json'u çek (sha gerekli)
    const getRes = await fetch(GITHUB_API_URL, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/vnd.github+json',
      },
    });
    if (!getRes.ok) {
      const err = await getRes.json().catch(() => ({}));
      throw new Error(`GET ${getRes.status}: ${err.message || 'Token geçersiz olabilir'}`);
    }
    const file  = await getRes.json();
    const text  = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ''))));
    const state = JSON.parse(text);

    // 2. Config'i güncelle
    state.config = { ...state.config, ...newConfig };

    // Başlangıç bakiyesi değiştirildiyse (sadece bot sıfırlanmadıysa nakit etkilenmez,
    // sadece initialBalance ve hedef yeniden hesaplanır)
    if (newInitialBalance && newInitialBalance !== state.initialBalance && !state.positions?.length) {
      state.initialBalance = newInitialBalance;
      state.balance        = newInitialBalance;
      state.dailyStart     = newInitialBalance;
      state.balanceHistory = [{ time: Date.now(), value: newInitialBalance }];
    }

    // 3. Base64 encode + push
    const newContent  = btoa(unescape(encodeURIComponent(JSON.stringify(state, null, 2))));
    const putRes = await fetch(GITHUB_API_URL, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/vnd.github+json',
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        message: 'config: dashboard\'dan ayarlar güncellendi',
        content: newContent,
        sha:     file.sha,
        branch:  GITHUB_BRANCH,
      }),
    });
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(`PUT ${putRes.status}: ${err.message || 'Yazma yetkisi yok'}`);
    }
    return true;
  },

  async pushFreshStateToGitHub(token, initBal) {
    const getRes = await fetch(GITHUB_API_URL, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
    });
    if (!getRes.ok) throw new Error(`GET ${getRes.status}`);
    const file = await getRes.json();

    const fresh = {
      balance: initBal,
      initialBalance: initBal,
      positions: [],
      history: [],
      balanceHistory: [{ time: Date.now(), value: initBal }],
      dailyStart: initBal,
      dailyStartTime: new Date().setHours(0, 0, 0, 0),
      totalTrades: 0,
      wins: 0,
      config: this.config,
      lastRun: null,
    };

    const newContent = btoa(unescape(encodeURIComponent(JSON.stringify(fresh, null, 2))));
    const putRes = await fetch(GITHUB_API_URL, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/vnd.github+json',
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        message: `reset: bot $${initBal} ile sıfırlandı`,
        content: newContent,
        sha: file.sha,
        branch: GITHUB_BRANCH,
      }),
    });
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(`PUT ${putRes.status}: ${err.message || 'yazma hatası'}`);
    }
  },

  updateTokenStatus(success) {
    const el = document.getElementById('tokenStatus');
    if (!el) return;
    const has = !!localStorage.getItem('kriptobot_github_token');
    if (!has) {
      el.textContent = 'Kayıtlı değil';
      el.className   = 'token-status off';
    } else if (success === false) {
      el.textContent = 'Token geçersiz';
      el.className   = 'token-status err';
    } else {
      el.textContent = '✓ Bağlı';
      el.className   = 'token-status ok';
    }
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
    if (GITHUB_STATE_URL) {
      // GitHub modu: sadece canlı PnL'i tarayıcıda hesapla
      // (SL/TP kapatma + yeni pozisyon açma sunucu tarafında)
      PaperTrading.refreshUnrealizedPnL(this.prices);
      return;
    }

    // Tarayıcı modu: kapanan pozisyonları işle
    const closed = PaperTrading.updatePositions(this.prices);
    closed.forEach(pos => {
      const pnlStr = pos.finalPnl >= 0 ? `+$${pos.finalPnl.toFixed(2)}` : `-$${Math.abs(pos.finalPnl).toFixed(2)}`;
      this.toast(`${pos.symbol} ${pos.closeReason} → ${pnlStr}`, pos.finalPnl >= 0 ? 'success' : 'danger');
      this.addSignal(pos.symbol, 'closed', pos.closePrice, `Kapatıldı (${pos.closeReason})`);
    });

    if (!this.botRunning) return;
    this.config.activeSymbols.forEach(symbol => this.fetchLatestCandle(symbol));
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
    // Canlı PnL hesapla (her UI tick'inde)
    PaperTrading.refreshUnrealizedPnL(this.prices);
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
    this.rebuildSignalsFromState();
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

    const now     = Date.now();
    const initial = PaperTrading.state.initialBalance;

    // Geçmiş + canlı son nokta
    const balData = history.map(h => ({ x: h.time, y: h.value }));
    balData.push({ x: now, y: currentBalance });

    // Hedef çizgisi: 1 ay içinde ilk değerden $300'e
    const startTime  = history[0].time;
    const targetTime = startTime + 30 * 24 * 60 * 60 * 1000; // 30 gün
    const targetLine = [
      { x: startTime,  y: initial },
      { x: targetTime, y: 300 },
    ];

    // X ekseni penceresi: ilk değer ile şimdi arası
    this.balanceChart.options.scales.x.min = startTime;
    this.balanceChart.options.scales.x.max = Math.max(now + 60 * 60 * 1000, startTime + 24 * 60 * 60 * 1000);

    this.balanceChart.data.datasets[0].data = balData;
    this.balanceChart.data.datasets[1].data = targetLine;
    this.balanceChart.update('none');
  },

  // ── SIGNALS ─────────────────────────────────────────────────

  // Açık pozisyonları + son kapanan işlemleri sinyal listesine yaz
  rebuildSignalsFromState() {
    const list = document.getElementById('signalsList');
    if (!list) return;

    const items = [];

    // Açık pozisyonlar (en yeni önce)
    const openPositions = [...PaperTrading.state.positions]
      .sort((a, b) => b.openTime - a.openTime);
    for (const p of openPositions) {
      items.push({
        symbol: p.symbol,
        type: p.direction.toLowerCase(),
        price: p.entryPrice,
        time: p.openTime,
        note: `${p.direction} açık · ${p.leverage}x`,
        live: true,
      });
    }

    // Son kapanan 5 işlem
    const recent = (PaperTrading.state.history || []).slice(0, 5);
    for (const h of recent) {
      const sign = h.pnl >= 0 ? '+' : '';
      items.push({
        symbol: h.symbol,
        type: 'closed',
        price: h.closePrice,
        time: h.closeTime,
        note: `Kapandı (${h.reason}) · ${sign}$${h.pnl.toFixed(2)}`,
      });
    }

    if (items.length === 0) {
      list.innerHTML = '<div class="signal-empty">Henüz sinyal yok</div>';
      return;
    }

    list.innerHTML = items.slice(0, 10).map(s => {
      const dirText  = s.type === 'long'  ? '▲ LONG'
                     : s.type === 'short' ? '▼ SHORT'
                     : '● KAPANDI';
      const dirClass = s.type === 'long'  ? 'signal-dir-long'
                     : s.type === 'short' ? 'signal-dir-short'
                     : '';
      const time     = new Date(s.time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      const priceStr = s.price > 100 ? s.price.toFixed(2) : s.price.toFixed(4);
      const liveBadge = s.live ? ' <span class="live-mini">CANLI</span>' : '';
      return `
        <div class="signal-item ${s.type}">
          <div class="signal-header">
            <span class="signal-coin">${s.symbol.replace('USDT', '')}</span>
            <span class="${dirClass}">${dirText}${liveBadge}</span>
            <span class="signal-time">${time}</span>
          </div>
          <div class="signal-price">$${priceStr} · ${s.note}</div>
        </div>
      `;
    }).join('');
  },

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

    document.getElementById('resetBotBtn').addEventListener('click', async () => {
      const bal = parseFloat(document.getElementById('initialBalance').value) || 100;
      if (!confirm(`Botu ${bal} USDT ile sıfırlamak istediğinizden emin misiniz?\n\nTüm açık pozisyonlar ve geçmiş silinecek.`)) return;

      const token = localStorage.getItem('kriptobot_github_token');
      if (token) {
        try {
          this.toast('GitHub\'da bot sıfırlanıyor…', 'info');
          await this.pushFreshStateToGitHub(token, bal);
          this.toast(`Bot $${bal} ile sıfırlandı! GitHub'a yüklendi.`, 'success');
        } catch (e) {
          this.toast(`GitHub hatası: ${e.message}`, 'danger');
          return;
        }
      } else {
        this.toast('Token yok, sadece tarayıcıda sıfırlandı.', 'warning');
      }
      PaperTrading.reset(bal);
      this.updateUI();
      this.initChart();
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

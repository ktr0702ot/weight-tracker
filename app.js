(function () {
  'use strict';

  const STORAGE_KEY = 'weight-tracker-v1';
  const GAS_URL_KEY = 'weight-tracker-gas-url';
  let records = loadData();
  let currentRange = 30;
  let editingId = null;

  function loadData() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) { /* ignore */ }
    return [];
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function showToast(msg) {
    const toast = document.getElementById('save-toast');
    toast.textContent = msg || '✓ 保存しました';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1500);
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function formatDate(dateStr) {
    const parts = dateStr.split('-');
    return parseInt(parts[1]) + '/' + parseInt(parts[2]);
  }

  function formatDateWithYear(dateStr) {
    const parts = dateStr.split('-');
    return parts[0] + '/' + parseInt(parts[1]) + '/' + parseInt(parts[2]);
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // --- 記録の追加 ---
  function addRecord() {
    const dateEl = document.getElementById('input-date');
    const weightEl = document.getElementById('input-weight');
    const fatEl = document.getElementById('input-fat');
    const memoEl = document.getElementById('input-memo');

    const weight = parseFloat(weightEl.value);
    if (isNaN(weight) || weight <= 0) {
      weightEl.focus();
      weightEl.style.borderColor = '#e94560';
      setTimeout(() => weightEl.style.borderColor = '', 1500);
      return;
    }

    const record = {
      id: generateId(),
      date: dateEl.value || todayStr(),
      weight: weight,
      fat: fatEl.value ? parseFloat(fatEl.value) : null,
      memo: memoEl.value.trim()
    };

    const existingIndex = records.findIndex(r => r.date === record.date);
    if (existingIndex >= 0) {
      record.id = records[existingIndex].id;
      records[existingIndex] = record;
    } else {
      records.push(record);
    }

    records.sort((a, b) => b.date.localeCompare(a.date));
    saveData();
    showToast();

    syncToSpreadsheet(record);

    weightEl.value = '';
    fatEl.value = '';
    memoEl.value = '';

    renderChart();
    renderStats();
    renderHistory();
  }

  // --- スプレッドシート連携 ---
  function getGasUrl() {
    return localStorage.getItem(GAS_URL_KEY) || '';
  }

  function setGasUrl(url) {
    if (url) {
      localStorage.setItem(GAS_URL_KEY, url);
    } else {
      localStorage.removeItem(GAS_URL_KEY);
    }
    updateSyncToggleStyle();
  }

  function updateSyncToggleStyle() {
    const btn = document.getElementById('sync-toggle');
    if (!btn) return;
    const hasUrl = !!getGasUrl();
    btn.classList.toggle('connected', hasUrl);
    btn.textContent = hasUrl ? '✅ スプレッドシート連携中' : '⚙️ スプレッドシート連携';
  }

  function showSyncStatus(msg, type) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'sync-status ' + type;
    if (type !== 'syncing') {
      setTimeout(() => { el.textContent = ''; el.className = 'sync-status'; }, 3000);
    }
  }

  function syncToSpreadsheet(record) {
    const url = getGasUrl();
    if (!url) return;

    showSyncStatus('📡 スプレッドシートに送信中...', 'syncing');

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        date: record.date,
        weight: record.weight,
        fat: record.fat,
        memo: record.memo || ''
      })
    })
    .then(res => res.json())
    .then(result => {
      if (result.success) {
        showSyncStatus('✅ ' + result.message, 'success');
      } else {
        showSyncStatus('⚠️ ' + result.message, 'error');
      }
    })
    .catch(() => {
      showSyncStatus('⚠️ 送信失敗（ローカルには保存済み）', 'error');
    });
  }

  // --- 削除 ---
  function deleteRecord(id) {
    records = records.filter(r => r.id !== id);
    saveData();
    showToast('✓ 削除しました');
    renderChart();
    renderStats();
    renderHistory();
  }

  // --- 編集モーダル ---
  function openEditModal(id) {
    const record = records.find(r => r.id === id);
    if (!record) return;

    editingId = id;
    document.getElementById('edit-date').value = record.date;
    document.getElementById('edit-weight').value = record.weight;
    document.getElementById('edit-fat').value = record.fat || '';
    document.getElementById('edit-memo').value = record.memo || '';
    document.getElementById('edit-modal').classList.add('show');
  }

  function closeEditModal() {
    editingId = null;
    document.getElementById('edit-modal').classList.remove('show');
  }

  function saveEdit() {
    const weight = parseFloat(document.getElementById('edit-weight').value);
    if (isNaN(weight) || weight <= 0) return;

    const idx = records.findIndex(r => r.id === editingId);
    if (idx < 0) return;

    records[idx].date = document.getElementById('edit-date').value;
    records[idx].weight = weight;
    records[idx].fat = document.getElementById('edit-fat').value
      ? parseFloat(document.getElementById('edit-fat').value) : null;
    records[idx].memo = document.getElementById('edit-memo').value.trim();

    records.sort((a, b) => b.date.localeCompare(a.date));
    saveData();
    closeEditModal();
    showToast();
    renderChart();
    renderStats();
    renderHistory();
  }

  // --- グラフ描画 ---
  function renderChart() {
    const canvas = document.getElementById('weight-chart');
    const ctx = canvas.getContext('2d');

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    ctx.clearRect(0, 0, W, H);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - currentRange);
    const cutoffStr = cutoff.getFullYear() + '-' +
      String(cutoff.getMonth() + 1).padStart(2, '0') + '-' +
      String(cutoff.getDate()).padStart(2, '0');

    const filtered = records
      .filter(r => r.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (filtered.length < 1) {
      ctx.fillStyle = '#6b6b80';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('データがありません', W / 2, H / 2);
      return;
    }

    const weights = filtered.map(r => r.weight);
    const fats = filtered.map(r => r.fat).filter(f => f !== null);
    const hasFat = fats.length >= 2;

    const padding = { top: 20, right: hasFat ? 44 : 16, bottom: 32, left: 44 };
    const chartW = W - padding.left - padding.right;
    const chartH = H - padding.top - padding.bottom;

    let wMin = Math.min(...weights);
    let wMax = Math.max(...weights);
    const wMargin = Math.max((wMax - wMin) * 0.15, 0.5);
    wMin -= wMargin;
    wMax += wMargin;

    function xPos(i) {
      if (filtered.length === 1) return padding.left + chartW / 2;
      return padding.left + (i / (filtered.length - 1)) * chartW;
    }

    function yPos(val) {
      return padding.top + chartH - ((val - wMin) / (wMax - wMin)) * chartH;
    }

    // グリッド線
    ctx.strokeStyle = 'rgba(42, 42, 74, 0.6)';
    ctx.lineWidth = 1;
    const gridSteps = 4;
    for (let i = 0; i <= gridSteps; i++) {
      const val = wMin + ((wMax - wMin) / gridSteps) * i;
      const y = yPos(val);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(W - padding.right, y);
      ctx.stroke();

      ctx.fillStyle = '#4fc3f7';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(1), padding.left - 6, y + 4);
    }

    // X軸ラベル
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const labelCount = Math.min(filtered.length, 6);
    for (let i = 0; i < labelCount; i++) {
      const idx = Math.round(i * (filtered.length - 1) / Math.max(labelCount - 1, 1));
      ctx.fillText(formatDate(filtered[idx].date), xPos(idx), H - 6);
    }

    // 体脂肪率（破線グラフ、右軸）
    if (hasFat) {
      let fMin = Math.min(...fats);
      let fMax = Math.max(...fats);
      const fMargin = Math.max((fMax - fMin) * 0.15, 0.5);
      fMin -= fMargin;
      fMax += fMargin;

      function yFatPos(val) {
        return padding.top + chartH - ((val - fMin) / (fMax - fMin)) * chartH;
      }

      // 右軸ラベル
      for (let i = 0; i <= gridSteps; i++) {
        const val = fMin + ((fMax - fMin) / gridSteps) * i;
        const y = yFatPos(val);
        ctx.fillStyle = '#ff9800';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(val.toFixed(1) + '%', W - padding.right + 6, y + 4);
      }

      const fatPoints = [];
      filtered.forEach((r, i) => {
        if (r.fat !== null) fatPoints.push({ x: xPos(i), y: yFatPos(r.fat) });
      });

      if (fatPoints.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(fatPoints[0].x, fatPoints[0].y);
        for (let i = 1; i < fatPoints.length; i++) {
          ctx.lineTo(fatPoints[i].x, fatPoints[i].y);
        }
        ctx.strokeStyle = 'rgba(255, 152, 0, 0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 体重ライン
    ctx.beginPath();
    ctx.moveTo(xPos(0), yPos(filtered[0].weight));
    for (let i = 1; i < filtered.length; i++) {
      ctx.lineTo(xPos(i), yPos(filtered[i].weight));
    }
    ctx.strokeStyle = '#4fc3f7';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // グラデーション塗り
    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
    gradient.addColorStop(0, 'rgba(79, 195, 247, 0.25)');
    gradient.addColorStop(1, 'rgba(79, 195, 247, 0)');
    ctx.lineTo(xPos(filtered.length - 1), padding.top + chartH);
    ctx.lineTo(xPos(0), padding.top + chartH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // ドット
    filtered.forEach((r, i) => {
      ctx.beginPath();
      ctx.arc(xPos(i), yPos(r.weight), 4, 0, Math.PI * 2);
      ctx.fillStyle = '#4fc3f7';
      ctx.fill();
      ctx.strokeStyle = '#0f0f1a';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  // --- 統計 ---
  function renderStats() {
    const container = document.getElementById('stats-row');

    if (records.length === 0) {
      container.innerHTML = '';
      return;
    }

    const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date));
    const latest = sorted[0];
    const prev = sorted[1];

    let diffHtml = '-';
    let diffClass = '';
    if (prev) {
      const diff = latest.weight - prev.weight;
      diffClass = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
      diffHtml = (diff > 0 ? '+' : '') + diff.toFixed(1);
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - currentRange);
    const cutoffStr = cutoff.getFullYear() + '-' +
      String(cutoff.getMonth() + 1).padStart(2, '0') + '-' +
      String(cutoff.getDate()).padStart(2, '0');
    const rangeRecords = sorted.filter(r => r.date >= cutoffStr);

    let rangeChangeHtml = '-';
    let rangeClass = '';
    if (rangeRecords.length >= 2) {
      const oldest = rangeRecords[rangeRecords.length - 1];
      const newest = rangeRecords[0];
      const change = newest.weight - oldest.weight;
      rangeClass = change > 0 ? 'up' : change < 0 ? 'down' : '';
      rangeChangeHtml = (change > 0 ? '+' : '') + change.toFixed(1);
    }

    container.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">最新</div>
        <div class="stat-value">${latest.weight.toFixed(1)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">前回比</div>
        <div class="stat-value ${diffClass}">${diffHtml}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">期間変動</div>
        <div class="stat-value ${rangeClass}">${rangeChangeHtml}</div>
      </div>
    `;
  }

  // --- 履歴リスト ---
  function renderHistory() {
    const container = document.getElementById('history-list');

    if (records.length === 0) {
      container.innerHTML = '<div class="history-empty">まだ記録がありません</div>';
      return;
    }

    const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date));
    let html = '';

    sorted.forEach((record, i) => {
      const prev = sorted[i + 1];
      let diffHtml = '';
      let diffClass = 'same';
      if (prev) {
        const diff = record.weight - prev.weight;
        if (diff > 0) { diffHtml = '+' + diff.toFixed(1); diffClass = 'up'; }
        else if (diff < 0) { diffHtml = diff.toFixed(1); diffClass = 'down'; }
        else { diffHtml = '±0'; }
      }

      html += `
        <div class="history-item fade-in">
          <div class="history-date">${formatDate(record.date)}</div>
          <div class="history-values">
            <div class="history-weight">${record.weight.toFixed(1)} kg</div>
            ${record.fat !== null ? `<div class="history-fat">${record.fat.toFixed(1)}%</div>` : ''}
            ${record.memo ? `<div class="history-memo">${escapeHtml(record.memo)}</div>` : ''}
          </div>
          <div class="history-diff ${diffClass}">${diffHtml}</div>
          <div class="history-actions">
            <button class="history-btn edit" data-id="${record.id}" title="編集">✏️</button>
            <button class="history-btn delete" data-id="${record.id}" title="削除">✕</button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // --- イベント ---
  function bindEvents() {
    document.getElementById('save-btn').addEventListener('click', addRecord);

    document.getElementById('input-weight').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addRecord();
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'chart') {
          renderChart();
          renderStats();
        }
      });
    });

    document.querySelectorAll('.range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentRange = parseInt(btn.dataset.range);
        renderChart();
        renderStats();
      });
    });

    document.getElementById('history-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.history-btn');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.classList.contains('edit')) {
        openEditModal(id);
      } else if (btn.classList.contains('delete')) {
        if (confirm('この記録を削除しますか？')) {
          deleteRecord(id);
        }
      }
    });

    document.getElementById('edit-cancel').addEventListener('click', closeEditModal);
    document.getElementById('edit-save').addEventListener('click', saveEdit);
    document.getElementById('edit-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeEditModal();
    });

    // スプレッドシート連携
    document.getElementById('sync-toggle').addEventListener('click', () => {
      const panel = document.getElementById('sync-settings');
      panel.classList.toggle('open');
    });

    document.getElementById('gas-url-save').addEventListener('click', () => {
      const url = document.getElementById('gas-url').value.trim();
      if (!url) return;
      setGasUrl(url);
      document.getElementById('sync-settings').classList.remove('open');
      showToast('✅ URL保存しました');
    });

    document.getElementById('gas-url-clear').addEventListener('click', () => {
      setGasUrl('');
      document.getElementById('gas-url').value = '';
      document.getElementById('sync-settings').classList.remove('open');
      showToast('連携を解除しました');
    });

    window.addEventListener('resize', () => renderChart());
  }

  // --- 初期化 ---
  function init() {
    document.getElementById('input-date').value = todayStr();
    document.getElementById('gas-url').value = getGasUrl();
    updateSyncToggleStyle();
    bindEvents();
    renderChart();
    renderStats();
    renderHistory();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);
})();

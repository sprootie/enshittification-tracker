// ── History Chart (simple canvas-based) ──────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('history-chart');
  if (!canvas) return;

  let history;
  try {
    history = JSON.parse(canvas.dataset.history);
  } catch { return; }

  if (!history || history.length < 2) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const width = rect.width - 48;
  const height = 200;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.scale(dpr, dpr);

  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Draw axes
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();

  // Y-axis labels
  ctx.fillStyle = '#666';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 10; i += 2) {
    const y = padding.top + chartH - (i / 10) * chartH;
    ctx.fillText(i.toString(), padding.left - 8, y + 4);
    if (i > 0) {
      ctx.strokeStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }
  }

  // Plot line
  ctx.strokeStyle = '#f44336';
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((point, i) => {
    const x = padding.left + (i / (history.length - 1)) * chartW;
    const y = padding.top + chartH - (point.score / 10) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Dots
  ctx.fillStyle = '#f44336';
  history.forEach((point, i) => {
    const x = padding.left + (i / (history.length - 1)) * chartW;
    const y = padding.top + chartH - (point.score / 10) * chartH;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // X-axis labels (first and last date)
  ctx.fillStyle = '#666';
  ctx.textAlign = 'center';
  ctx.font = '10px sans-serif';
  if (history.length > 0) {
    ctx.fillText(history[0].date.split('T')[0] || history[0].date.substring(0, 10), padding.left, height - 5);
    ctx.fillText(
      history[history.length - 1].date.split('T')[0] || history[history.length - 1].date.substring(0, 10),
      width - padding.right, height - 5
    );
  }
});

(function () {
  'use strict';

  class SignaturePad {
    constructor(canvas, { color = '#0b1d5b', minWidth = 1.1, maxWidth = 3.4, onChange } = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.color = color;
      this.minWidth = minWidth;
      this.maxWidth = maxWidth;
      this.onChange = onChange || (() => {});
      this.strokes = [];
      this.current = null;

      this.handleDown = this.handleDown.bind(this);
      this.handleMove = this.handleMove.bind(this);
      this.handleUp = this.handleUp.bind(this);
      canvas.addEventListener('pointerdown', this.handleDown);
      canvas.addEventListener('pointermove', this.handleMove);
      canvas.addEventListener('pointerup', this.handleUp);
      canvas.addEventListener('pointercancel', this.handleUp);

      this.resize();
      if ('ResizeObserver' in window) new ResizeObserver(() => this.resize()).observe(canvas);
      else window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width) return;
      const dpr = Math.max(window.devicePixelRatio || 1, 1);
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.redraw();
    }

    point(e) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, t: performance.now() };
    }

    handleDown(e) {
      if (e.button !== undefined && e.button > 0) return;
      e.preventDefault();
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Capture is best-effort; drawing still works without it.
      }
      const p = this.point(e);
      p.w = (this.minWidth + this.maxWidth) / 2;
      this.current = [p];
      this.strokes.push(this.current);
      this.drawDot(this.ctx, p, 1);
    }

    handleMove(e) {
      if (!this.current) return;
      e.preventDefault();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const p = this.point(ev);
        const prev = this.current[this.current.length - 1];
        const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
        if (dist < 0.8) continue;
        const velocity = dist / Math.max(1, p.t - prev.t);
        const target = Math.max(this.minWidth, this.maxWidth - velocity * 1.6);
        p.w = prev.w * 0.6 + target * 0.4;
        this.current.push(p);
        this.drawSegment(this.ctx, this.current, this.current.length - 1, 1);
      }
    }

    handleUp() {
      if (!this.current) return;
      this.current = null;
      this.onChange(this);
    }

    drawDot(ctx, p, scale) {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(p.x * scale, p.y * scale, (p.w / 2) * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    drawSegment(ctx, pts, i, scale) {
      const p0 = pts[Math.max(0, i - 2)];
      const p1 = pts[i - 1];
      const p2 = pts[i];
      const m1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const m2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      ctx.strokeStyle = this.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = p2.w * scale;
      ctx.beginPath();
      ctx.moveTo(m1.x * scale, m1.y * scale);
      ctx.quadraticCurveTo(p1.x * scale, p1.y * scale, m2.x * scale, m2.y * scale);
      ctx.stroke();
    }

    paint(ctx, scale) {
      for (const stroke of this.strokes) {
        if (stroke.length === 1) this.drawDot(ctx, stroke[0], scale);
        for (let i = 1; i < stroke.length; i++) this.drawSegment(ctx, stroke, i, scale);
      }
    }

    redraw() {
      const { width, height } = this.canvas;
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, width, height);
      this.ctx.restore();
      this.paint(this.ctx, 1);
    }

    clear() {
      this.strokes = [];
      this.redraw();
      this.onChange(this);
    }

    isEmpty() {
      return this.strokes.length === 0;
    }

    /** Transparent PNG cropped to the ink, rendered at `scale` for crisp printing. */
    toDataURL({ scale = 3, padding = 6 } = {}) {
      if (this.isEmpty()) return '';
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const stroke of this.strokes) {
        for (const p of stroke) {
          minX = Math.min(minX, p.x - p.w);
          minY = Math.min(minY, p.y - p.w);
          maxX = Math.max(maxX, p.x + p.w);
          maxY = Math.max(maxY, p.y + p.w);
        }
      }
      minX -= padding;
      minY -= padding;
      const w = Math.ceil((maxX - minX + padding) * scale);
      const h = Math.ceil((maxY - minY + padding) * scale);
      const off = document.createElement('canvas');
      off.width = Math.max(1, w);
      off.height = Math.max(1, h);
      const ctx = off.getContext('2d');
      ctx.translate(-minX * scale, -minY * scale);
      this.paint(ctx, scale);
      return off.toDataURL('image/png');
    }
  }

  window.SignaturePad = SignaturePad;
})();

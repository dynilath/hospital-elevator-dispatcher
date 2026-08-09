import * as THREE from 'three';

// ─── Canvas → Three 纹理工具 ─────────────────────────────────────

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

export function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const FONT_CN = (size: number, bold = true): string =>
  `${bold ? 'bold ' : ''}${size}px "ZCOOL KuaiLe","Microsoft YaHei",sans-serif`;

export const FONT_PX = (size: number): string => `${size}px "Press Start 2P",monospace`;

// ─── 7 段数码管 ──────────────────────────────────────────────────
const SEG: Record<string, number[]> = {
  '0': [1, 1, 1, 1, 1, 1, 0],
  '1': [0, 1, 1, 0, 0, 0, 0],
  '2': [1, 1, 0, 1, 1, 0, 1],
  '3': [1, 1, 1, 1, 0, 0, 1],
  '4': [0, 1, 1, 0, 0, 1, 1],
  '5': [1, 0, 1, 1, 0, 1, 1],
  '6': [1, 0, 1, 1, 1, 1, 1],
  '7': [1, 1, 1, 0, 0, 0, 0],
  '8': [1, 1, 1, 1, 1, 1, 1],
  '9': [1, 1, 1, 1, 0, 1, 1],
};

/** 画数码管数字,返回总宽 */
export function draw7seg(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  s: number,
  color: string,
): number {
  const th = s;
  const hw = s * 4;
  const vh = s * 4;
  const gap = s;
  const dw = hw + 2 * th + 2 * gap;
  ctx.fillStyle = color;
  for (let i = 0; i < text.length; i++) {
    const segs = SEG[text[i]] ?? [0, 0, 0, 0, 0, 0, 0];
    const ox = i * (dw + gap * 2);
    if (segs[0]) ctx.fillRect(x + ox + th + gap, y, hw, th); // a
    if (segs[1]) ctx.fillRect(x + ox + th + gap + hw, y + th + gap, th, vh); // b
    if (segs[2]) ctx.fillRect(x + ox + th + gap + hw, y + th + gap + vh + th + gap, th, vh); // c
    if (segs[3]) ctx.fillRect(x + ox + th + gap, y + 2 * (th + gap) + 2 * vh, hw, th); // d
    if (segs[4]) ctx.fillRect(x + ox + th, y + th + gap + vh + th + gap, th, vh); // e
    if (segs[5]) ctx.fillRect(x + ox + th, y + th + gap, th, vh); // f
    if (segs[6]) ctx.fillRect(x + ox + th + gap, y + th + gap + vh + gap, hw, th); // g
  }
  return text.length * (dw + gap * 2) - gap * 2;
}

/** 箭头(数码管旁的方向指示) */
export function arrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  up: boolean,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (up) {
    ctx.moveTo(x, y + size);
    ctx.lineTo(x + size, y + size);
    ctx.lineTo(x + size / 2, y);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x + size / 2, y + size);
  }
  ctx.closePath();
  ctx.fill();
}

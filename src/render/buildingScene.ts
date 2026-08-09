import type { GameEngine } from '../engine/Engine';
import { BLD_FLOOR_H, FLOOR_DEPTS_OF } from '../config';

const FONT = (size: number): string =>
  `bold ${size}px "ZCOOL KuaiLe","Microsoft YaHei",sans-serif`;

/** 楼宇剖面图:楼层科室 + 井道内电梯轿厢实时位置 */
export function renderBuilding(ctx: CanvasRenderingContext2D, engine: GameEngine, w: number, h: number) {
  ctx.imageSmoothingEnabled = false;
  const floors = engine.diff.floors;
  const pad = 16;
  const fh = BLD_FLOOR_H;
  const ev = engine.elevator;
  const tasks = engine.getTasks();
  const flash = engine.flashPhase;
  const blink = Math.sin(flash * 5) > 0;

  // 背景与楼体
  ctx.fillStyle = '#141724';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#2b3040';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, w - 4, h - 4);

  // 井道
  const shaftX = 124;
  const shaftW = w - shaftX - 8;
  ctx.fillStyle = '#0e1119';
  ctx.fillRect(shaftX, pad, shaftW, h - pad * 2);
  // 井道导轨
  ctx.strokeStyle = '#23283a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(shaftX + 6, pad);
  ctx.lineTo(shaftX + 6, h - pad);
  ctx.moveTo(shaftX + shaftW - 6, pad);
  ctx.lineTo(shaftX + shaftW - 6, h - pad);
  ctx.stroke();

  const floorTop = (i: number): number => h - pad - i * fh;

  // 楼层
  for (let i = 1; i <= floors; i++) {
    const y = floorTop(i);
    // 楼板
    ctx.fillStyle = i === ev.floor ? '#454e68' : '#2b3040';
    ctx.fillRect(6, y + fh - 5, shaftX - 10, 5);
    ctx.fillRect(shaftX, y + fh - 5, shaftW, 5);
    // 层号
    ctx.fillStyle = i === ev.floor ? '#ffd34d' : '#9aa5b1';
    ctx.font = FONT(11);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${i}F`, shaftX - 58, y + 14);
    // 科室名(单行排版:1F 急诊大厅 门诊药房)
    const depts = FLOOR_DEPTS_OF(i);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#dfe6ee';
    ctx.font = depts.join(' ').length > 8 ? FONT(9) : FONT(11);
    ctx.fillText(`${depts.join(' ')}`, 12, y + 14);

    // 楼层指示灯
    const lampX = shaftX - 24;
    const lampY = y + 14;
    if (ev.lights.has(i)) {
      // 已登记
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.arc(lampX, lampY, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (tasks.some((t) => t.status === 'pending' && t.fromFloor === i && t.type === 'normal')) {
      // 有待接的普通任务
      if (blink) {
        ctx.fillStyle = '#6ec6ca';
        ctx.beginPath();
        ctx.arc(lampX, lampY, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (tasks.some((t) => t.status === 'pending' && t.fromFloor === i && t.type === 'emergency')) {
      // 紧急任务楼层
      if (blink) {
        ctx.fillStyle = '#e0453f';
        ctx.beginPath();
        ctx.arc(lampX, lampY, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = '#333a4d';
      ctx.beginPath();
      ctx.arc(lampX, lampY, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 电梯轿厢
  const carY = h - pad - ev.posY * fh;
  const carX = shaftX + 8;
  const carW = shaftW - 16;
  const carH = fh - 6;
  // 轿厢
  ctx.fillStyle = '#dfe6ee';
  ctx.fillRect(carX, carY - carH, carW, carH);
  ctx.strokeStyle = '#23263a';
  ctx.lineWidth = 2;
  ctx.strokeRect(carX, carY - carH, carW, carH);
  // 开门时内部亮灯
  if (ev.doorOpen > 0.05) {
    ctx.fillStyle = '#fff3b0';
    ctx.fillRect(carX + 4, carY - carH + 4, carW - 8, carH - 8);
  } else {
    ctx.fillStyle = '#b9c2cf';
    ctx.fillRect(carX + 4, carY - carH + 4, carW - 8, carH - 8);
  }
  // 运行方向箭头
  const dir = ev.directionArrow();
  if (dir !== 0) {
    ctx.fillStyle = dir > 0 ? '#3fae5a' : '#f08a3c';
    ctx.beginPath();
    const ax = shaftX - 30;
    const ay = carY - carH / 2;
    if (dir > 0) {
      ctx.moveTo(ax, ay + 6);
      ctx.lineTo(ax + 10, ay + 6);
      ctx.lineTo(ax + 5, ay - 4);
    } else {
      ctx.moveTo(ax, ay - 4);
      ctx.lineTo(ax + 10, ay - 4);
      ctx.lineTo(ax + 5, ay + 6);
    }
    ctx.closePath();
    ctx.fill();
  }

  // 顶部标题
  ctx.fillStyle = '#5c6470';
  ctx.font = FONT(10);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('— 楼层分布 —', w / 2, 5);

  ctx.textBaseline = 'alphabetic';
}

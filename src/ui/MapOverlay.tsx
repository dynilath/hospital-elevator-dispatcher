import { useEffect, useRef } from 'react';
import type { GameEngine } from '../engine/Engine';
import { BLD_CANVAS_H, BLD_CANVAS_W } from '../config';
import { renderBuilding } from '../render/buildingScene';

interface Props {
  engine: GameEngine | null;
  onClose: () => void;
}

/** 全屏「医院楼层分布」贴画 —— 占据视野,关闭后才能操作电梯 */
export default function MapOverlay({ engine, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !engine) return;
    canvas.width = BLD_CANVAS_W;
    canvas.height = BLD_CANVAS_H(engine.diff.floors);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 实时刷新(电梯位置 / 楼层灯)
    const iv = setInterval(() => renderBuilding(ctx, engine, canvas.width, canvas.height), 200);
    renderBuilding(ctx, engine, canvas.width, canvas.height);
    return () => clearInterval(iv);
  }, [engine]);

  return (
    <div className="overlay">
      <div className="map-card">
        <div className="map-title">
          <span>🏥 医院楼层分布贴画</span>
          <span className="map-sub">电梯实时位置与各楼层呼叫灯</span>
        </div>
        <div className="map-canvas-wrap">
          <canvas ref={canvasRef} className="pixel-canvas map-canvas" />
        </div>
        <div className="map-legend">
          <span>
            <i className="dot dot-lamp" /> 已按楼层
          </span>
          <span>
            <i className="dot dot-call" /> 待接任务
          </span>
          <span>
            <i className="dot dot-emg" /> 紧急呼叫
          </span>
          <button className="map-close" onClick={onClose}>
            ✕ 收起贴画
          </button>
        </div>
      </div>
    </div>
  );
}

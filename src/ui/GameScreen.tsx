import { useEffect, useRef, useState } from 'react';
import { GameEngine } from '../engine/Engine';
import { Scene3D } from '../render3d/Scene3D';
import type { Difficulty, Snapshot, TaskView } from '../types';
import NotebookOverlay from './NotebookOverlay';
import PosterOverlay from './PosterOverlay';
import ResultScreen from './ResultScreen';

/** 满意度算法说明(悬停满意度栏显示) */
const SAT_TIP = [
  '😊 满意度算法(满分 100)',
  '· 领导急召:上电梯前 每秒 −1',
  '· 普通任务:等待超过 20 秒后 每秒 −0.22',
  '· 紧急任务超时:−12',
  '· 取消家属呼叫被斥责:−3(随机)',
  '· 送达任务:普通 +1 / 紧急 +2',
  '· 微笑应急成功:+3',
].join('\n');

/** 调试信息:各楼层排队 / 3×4 格子占用 / 电梯内需求 */
function DebugBody({ snap, engine }: { snap: Snapshot; engine: GameEngine | null }) {
  const byFloor = new Map<number, number>();
  for (const t of snap.tasks) {
    if (t.status !== 'pending') continue;
    byFloor.set(t.fromFloor, (byFloor.get(t.fromFloor) ?? 0) + 1);
  }
  const aboard = snap.tasks.filter((t) => t.status === 'aboard');
  const floors = Array.from(byFloor.entries()).sort((a, b) => a[0] - b[0]);
  return (
    <div className="debug-body">
      <div className="debug-section">楼层排队(等待上梯)</div>
      {floors.length === 0 && <div className="debug-line dim">— 无排队 —</div>}
      {floors.map(([f, n]) => (
        <div key={f} className="debug-line">
          {f}F: {n} 人
        </div>
      ))}
      <div className="debug-section">电梯占用(3×4 格子,上行=门口)</div>
      <div className="debug-line">
        已用 {snap.elevator.used}/12 格(含调度员 1 格)
        {snap.elevator.lights.length > 0 && <span> · 亮灯:{snap.elevator.lights.join(',')}F</span>}
      </div>
      {engine && <Grid3x4 snap={snap} engine={engine} />}
      <div className="debug-section">电梯内需求(共 {aboard.length} 人)</div>
      {aboard.length === 0 && <div className="debug-line dim">— 电梯空 —</div>}
      {aboard.map((t) => (
        <div key={t.id} className="debug-line">
          {kindIcon(t)} {t.title} → {t.targetFloor}F 等待 {t.wait}s
          {t.companion ? ` (${t.companionKind === 'nurse' ? '护士陪护' : '家属陪护'})` : ''}
          {t.flavor ? ` [${t.flavor}]` : ''}
        </div>
      ))}
    </div>
  );
}

/** 3×4 格子占用图(调试) */
function Grid3x4({ snap, engine }: { snap: Snapshot; engine: GameEngine }) {
  const marks: string[][] = Array.from({ length: 4 }, () => Array<string>(3).fill('·'));
  // 调度员(后角 2,3)
  marks[3][2] = '调';
  const kindMark: Record<string, string> = { stand: '立', wheelchair: '轮', bed: '床', stretcher: '担' };
  for (const [tid, p] of engine.getPlacements()) {
    const t = snap.tasks.find((x) => x.id === tid);
    if (!t) continue;
    const mark = kindMark[t.kind] ?? '?';
    for (let r = p.row; r < p.row + p.h; r++) {
      for (let c = p.col; c < p.col + p.w; c++) marks[r][c] = mark;
    }
  }
  for (const [, cell] of engine.getCompanionPlacements()) {
    marks[cell.row][cell.col] = '家';
  }
  const rows = [0, 1, 2, 3].map((r) => marks[r].join(' '));
  return (
    <div className="debug-grid">
      <div className="debug-line">↑ 门</div>
      {rows.map((row, i) => (
        <div key={i} className="debug-grid-row">
          {row}
        </div>
      ))}
    </div>
  );
}

function kindIcon(t: TaskView): string {
  if (t.type === 'emergency') return '🚨';
  if (t.flavor === 'prank') return '👻';
  if (t.kind === 'bed') return '🛏️';
  if (t.kind === 'wheelchair') return '♿';
  if (t.kind === 'stretcher') return '🚑';
  return '🧍';
}

interface Props {
  difficulty: Difficulty;
  onExit: () => void;
  onRestart: () => void;
}

export default function GameScreen({ difficulty, onExit, onRestart }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [eventToast, setEventToast] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const lastEventRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new GameEngine(difficulty);
    engineRef.current = engine;
    const scene = new Scene3D(canvas, engine, {
      onPressFloor: (f) => engineRef.current?.pressFloor(f),
      onPressRemind: () => engineRef.current?.pressRemind(),
      onPressRight: () => engineRef.current?.pressRight(),
      onAnswer: () => answerCall(),
      onHangup: () => hangup(),
      onOpenMap: () => setMapOpen(true),
      onOpenNotebook: () => setNotebookOpen(true),
    });
    sceneRef.current = scene;
    engine.attachScene(scene);
    const unsub = engine.subscribe(() => setSnap(engine.getSnapshot()));
    setSnap(engine.getSnapshot()); // 同步首帧,避免空加载
    engine.start();
    return () => {
      unsub();
      engine.dispose();
      scene.dispose();
      engineRef.current = null;
      sceneRef.current = null;
      setNotebookOpen(false);
      setMapOpen(false);
    };
  }, [difficulty]); // eslint-disable-line react-hooks/exhaustive-deps

  const emgPending = snap !== null && snap.emgTotal > 0 && snap.emgSuccess < snap.emgTotal;

  // 家属事件消息(斥责/告知楼层等)
  useEffect(() => {
    if (!snap?.eventMsg) return;
    if (snap.eventMsg.id > lastEventRef.current) {
      lastEventRef.current = snap.eventMsg.id;
      setEventToast(snap.eventMsg.text);
      const timer = setTimeout(() => setEventToast(null), 3200);
      return () => clearTimeout(timer);
    }
  }, [snap?.eventMsg]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 手机「接听」:接听最早未接来电,字幕窗在手机上方播放 */
  const answerCall = () => {
    const snapNow = engineRef.current?.getSnapshot();
    if (!snapNow) return;
    const unread = snapNow.tasks
      .filter((t) => t.callSent && !t.answered && t.status === 'pending')
      .sort((a, b) => a.callSentAt - b.callSentAt);
    if (unread.length === 0) return;
    const t = unread[0];
    engineRef.current?.answerCall(t.id);
    // 接听后再取快照,拿到 answered=true 的任务视图传给字幕窗
    const fresh = engineRef.current?.getSnapshot().tasks.find((x) => x.id === t.id) ?? t;
    sceneRef.current?.setCurrentCall(fresh);
  };

  /** 手机「挂断」 */
  const hangup = () => {
    sceneRef.current?.setCurrentCall(null);
  };

  return (
    <div className="game3d">
      <header className="hud">
        <div className="hud-item">
          <span className="hud-label">{snap?.overtime ? '⏱' : '⏰'}</span>
          <span className={`hud-value px-num ${snap?.overtime ? 'emg-warn' : ''}`}>
            {snap ? (snap.overtime ? '加班中' : `剩 ${snap.dayText}`) : '--:--'}
          </span>
        </div>
        <div className="hud-item hud-sat" data-tip={SAT_TIP}>
          <span className="hud-label">😊 满意度</span>
          <div className="sat-bar">
            <div className="sat-fill" style={{ width: `${snap ? snap.satisfaction : 0}%` }} />
          </div>
          <span className="hud-value px-num">{snap ? snap.satisfaction : 0}</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">📋</span>
          <span className="hud-value px-num">
            {snap ? `${snap.done}/${snap.total}` : '0/0'}
          </span>
        </div>
        <div className="hud-item">
          <span className="hud-label">🚨</span>
          <span className={`hud-value px-num ${emgPending ? 'emg-warn' : ''}`}>
            {snap ? `${snap.emgSuccess}/${snap.emgTotal}` : '0/0'}
          </span>
        </div>
        <div className="hud-actions">
          {snap?.simulate && <span className="sim-chip">🎭 拟真</span>}
          <button
            className={`hud-btn ${snap?.muted ? 'off' : ''}`}
            onClick={() => engineRef.current?.toggleMute()}
            title="静音开关"
          >
            {snap?.muted ? '🔇' : '🔊'}
          </button>
          <button className="hud-btn" onClick={() => engineRef.current?.endDay()} title="提前收工(结束本局)">
            收工
          </button>
          <button className="hud-btn" onClick={() => setDebugOpen((v) => !v)} title="调试信息">
            调试
          </button>
        </div>
      </header>

      <div className="stage">
        <canvas ref={canvasRef} className="pixel-canvas stage-canvas" />

        {snap?.error && <div className="err-banner">⚠ 引擎异常:{snap.error}</div>}

        {eventToast && <div className="event-toast">{eventToast}</div>}
      </div>

      {/* 调试信息面板 */}
      {debugOpen && snap && (
        <div className="debug-panel">
          <div className="debug-head">
            <span>🛠 调试信息</span>
            <button className="debug-close" onClick={() => setDebugOpen(false)}>
              ✕
            </button>
          </div>
          <DebugBody snap={snap} engine={engineRef.current} />
        </div>
      )}

      {snap && notebookOpen && !mapOpen && (
        <NotebookOverlay snap={snap} onClose={() => setNotebookOpen(false)} />
      )}
      {snap && mapOpen && !notebookOpen && (
        <PosterOverlay floors={engineRef.current?.diff.floors ?? 8} onClose={() => setMapOpen(false)} />
      )}

      {snap?.smile.active && (
        <div className="smile-popup">
          <div className="smile-card">
            <div className="smile-angry">😡 家属正在骂你!</div>
            <div className="smile-tip">保持微笑,别被拍到黑脸…</div>
            <button className="smile-btn" onClick={() => engineRef.current?.pressSmile()}>
              😊 微笑
            </button>
            <div className="smile-cd">
              <div className="smile-cd-fill" style={{ width: `${(snap.smile.remaining / 5) * 100}%` }} />
            </div>
            <div className="px-num smile-sec">{snap.smile.remaining}s</div>
          </div>
        </div>
      )}

      {snap?.phase === 'result' && snap.result && (
        <ResultScreen result={snap.result} onRestart={onRestart} onExit={onExit} />
      )}
    </div>
  );
}

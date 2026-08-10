import { useState } from 'react';
import {
  EMERGENCY_GAP_OPTIONS,
  MAX_DAY_MINUTES,
  MAX_FLOORS,
  MIN_DAY_MINUTES,
  MIN_FLOORS,
  PRESETS,
} from '../config';
import type { Difficulty } from '../types';

interface Props {
  onStart: (diff: Difficulty) => void;
}

export default function MainMenu({ onStart }: Props) {
  const [mode, setMode] = useState<'easy' | 'normal' | 'hard' | 'sim' | 'custom'>('normal');
  const [floors, setFloors] = useState(10);
  const [emgIdx, setEmgIdx] = useState(1);
  const [dayMinutes, setDayMinutes] = useState(5);
  const [simulate, setSimulate] = useState(false);

  const difficulty: Difficulty =
    mode === 'custom'
      ? { floors, emergencyGap: EMERGENCY_GAP_OPTIONS[emgIdx].value, dayMinutes, simulate }
      : PRESETS.find((p) => p.key === mode)!.diff;

  return (
    <div className="menu-wrap">
      <div className="menu-card">
        <div className="menu-title">
          <div className="title-main">🏥 医院电梯调度员</div>
          <div className="title-sub px-num">HOSPITAL ELEVATOR DISPATCHER</div>
        </div>

        <div className="preset-row">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              className={`preset-btn ${mode === p.key ? 'selected' : ''}`}
              onClick={() => setMode(p.key as 'easy' | 'normal' | 'hard' | 'sim')}
            >
              <span className="preset-name">{p.name}</span>
              <span className="preset-desc">{p.desc}</span>
            </button>
          ))}
          <button
            className={`preset-btn ${mode === 'custom' ? 'selected' : ''}`}
            onClick={() => setMode('custom')}
          >
            <span className="preset-name">自定义</span>
            <span className="preset-desc">自由调节三个挑战维度</span>
          </button>
        </div>

        {mode === 'custom' && (
          <div className="custom-box">
            <label className="slider-row">
              <span>
                楼层数量 <b className="px-num">{floors}</b> 层(科室随之增减)
              </span>
              <input
                type="range"
                min={MIN_FLOORS}
                max={MAX_FLOORS}
                value={floors}
                onChange={(e) => setFloors(Number(e.target.value))}
              />
            </label>
            <div className="slider-row">
              <span>紧急调度频率</span>
              <div className="seg">
                {EMERGENCY_GAP_OPTIONS.map((o, i) => (
                  <button
                    key={o.label}
                    className={`seg-btn ${i === emgIdx ? 'selected' : ''}`}
                    onClick={() => setEmgIdx(i)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="slider-row">
              <span>
                一局时长 <b className="px-num">{dayMinutes}</b> 分钟(一天的工作)
              </span>
              <input
                type="range"
                min={MIN_DAY_MINUTES}
                max={MAX_DAY_MINUTES}
                value={dayMinutes}
                onChange={(e) => setDayMinutes(Number(e.target.value))}
              />
            </label>
            <label className="slider-row sim-check">
              <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} />
              <span>
                🎭 <b>拟真模式</b>:来电播报后不留消息记录,需自己记住需求;
                家属可能当场发难,记得随时保持微笑
              </span>
            </label>
          </div>
        )}

        <button className="start-btn" onClick={() => onStart(difficulty)}>
          ▶ 开始上班
        </button>

        <details className="howto">
          <summary>📖 玩法说明</summary>
          <ul>
            <li>你是电梯里的调度员,一天的工作从 <b>8:00</b> 到 <b>17:00</b> 结束。</li>
            <li>第一人称视角:<b>按住拖拽</b>环视轿厢,<b>点击</b>道具与乘客交互。</li>
            <li>📱 通知通过<b>手机</b>来电(右下角):点「接听」在悬浮窗打字播报,点「挂断」结束;任务记录在旁边的<b>📋 调度夹板</b>里。</li>
            <li>🚨 <b>紧急任务</b>带倒计时,急救床可直接上梯,优先处理!超时会重罚。</li>
            <li>🛏️ 卧床患者、♿ 轮椅乘客上下梯较慢;拥挤时用左下角<b>「📢 往里走走」/「➡ 靠右站站」</b>让人挪位——乘客不一定会听,病床与「阿巴阿巴」的患者永远不动。</li>
            <li>点击乘客可以<b>问目的地</b>;有的家属会堵门,点他头顶的<b>「🚫 别堵门!」</b>劝走。</li>
            <li>按钮旁的<b>「医院楼层分布」贴画</b>可点开查看各层科室。</li>
            <li>🎭 <b>拟真难度</b>:来电不留记录需自行记忆;遇到家属抱怨要限时「微笑」,否则被拍下发微博提前下班。</li>
          </ul>
        </details>
      </div>
    </div>
  );
}

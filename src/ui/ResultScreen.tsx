import type { ResultStats } from '../types';

interface Props {
  result: ResultStats;
  onRestart: () => void;
  onExit: () => void;
}

const gradeClass: Record<string, string> = { S: 'grade-s', A: 'grade-a', B: 'grade-b', C: 'grade-c' };

export default function ResultScreen({ result, onRestart, onExit }: Props) {
  return (
    <div className="result-overlay">
      <div className="result-card">
        <div className="result-sub px-num">下班打卡 {result.endTime}</div>
        {result.endReason && <div className="end-reason">📸 {result.endReason}</div>}
        <div className={`grade ${gradeClass[result.grade] ?? ''}`}>{result.grade}</div>
        <div className="grade-name">{result.gradeName}</div>

        <div className="result-grid">
          <div className="r-item">
            <div className="r-label">满意度</div>
            <div className="r-value px-num">{result.satisfaction}</div>
          </div>
          <div className="r-item">
            <div className="r-label">完成任务</div>
            <div className="r-value px-num">
              {result.done}/{result.total}
            </div>
          </div>
          <div className="r-item">
            <div className="r-label">紧急任务</div>
            <div className="r-value px-num">
              {result.emgSuccess}/{result.emgTotal}
            </div>
          </div>
          <div className="r-item">
            <div className="r-label">平均等待</div>
            <div className="r-value px-num">{result.avgWait.toFixed(1)}s</div>
          </div>
          <div className="r-item">
            <div className="r-label">失败</div>
            <div className="r-value px-num">{result.failed}</div>
          </div>
        </div>

        <div className="result-actions">
          <button className="start-btn" onClick={onRestart}>
            🔄 再来一天
          </button>
          <button className="exit-btn" onClick={onExit}>
            🏠 返回主菜单
          </button>
        </div>
      </div>
    </div>
  );
}

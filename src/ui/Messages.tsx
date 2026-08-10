import type { Snapshot, TaskView } from '../types';

function iconOf(t: TaskView): string {
  if (t.type === 'emergency') return '🚨';
  if (t.flavor === 'prank') return '👻';
  if (t.flavor === 'vip') return '🎩';
  if (t.flavor === 'bang') return '🔨';
  if (t.flavor === 'family') return '👨‍👩‍👧';
  switch (t.kind) {
    case 'bed':
      return '🛏️';
    case 'wheelchair':
      return '♿';
    case 'stretcher':
      return '🚑';
    default:
      return '🧍';
  }
}

function flavorBadge(t: TaskView): { text: string; cls: string } | null {
  switch (t.flavor) {
    case 'vip':
      return { text: '领导', cls: 'badge-vip' };
    case 'prank':
      return { text: '骚扰', cls: 'badge-prank' };
    case 'bang':
      return { text: '工勤', cls: 'badge-bang' };
    case 'family':
      return { text: '家属', cls: 'badge-family' };
    default:
      return null;
  }
}

function statusText(t: TaskView): string {
  switch (t.status) {
    case 'pending':
      return `等待中 ${t.wait}s`;
    case 'aboard':
      return '已上梯 · 运送中';
    case 'delivered':
      return '✓ 已送达';
    case 'failed':
      return '✗ 超时失败';
  }
}

/** 笔记本中的需求记录(仅已接听并看完完整内容的来电;骚扰电话是恶作剧,不记录) */
export default function Messages({ snap }: { snap: Snapshot }) {
  const tasks = snap.tasks.filter((t) => t.callSent && t.recorded && t.flavor !== 'prank');
  const unrecorded = snap.tasks.filter((t) => t.callSent && !t.recorded && t.flavor !== 'prank').length;

  if (tasks.length === 0) {
    return (
      <div className="msg-empty">
        <div>📒</div>
        <div>笔记本还是空白的</div>
        <div className="msg-empty-sub">
          {unrecorded > 0
            ? `还有 ${unrecorded} 通来电未接听/未听完,接听并听完后才会记录`
            : '接听电话并看完内容后,需求会记在这里'}
        </div>
      </div>
    );
  }

  return (
    <div className="msg-list">
      {unrecorded > 0 && (
        <div className="msg-unrecorded">📞 还有 {unrecorded} 通来电未接听/未听完,未记录</div>
      )}
      {tasks.map((t) => {
        const pct = t.deadline > 0 ? Math.max(0, Math.min(100, ((t.remaining ?? 0) / t.deadline) * 100)) : 100;
        const fb = flavorBadge(t);
        return (
          <div key={t.id} className={`msg ${t.type === 'emergency' ? 'msg-emg' : ''} msg-${t.status}`}>
            <div className="msg-head">
              <span className="msg-icon">{iconOf(t)}</span>
              <span className="msg-title">{t.title}</span>
              {t.type === 'emergency' && <span className="badge">紧急</span>}
              {fb && <span className={`badge ${fb.cls}`}>{fb.text}</span>}
              {t.remaining !== null && (
                <span className={`countdown ${t.remaining <= 20 ? 'urgent' : ''}`}>⏱ {t.remaining}s</span>
              )}
            </div>
            <div className="msg-text">{t.text}</div>
            <div className="msg-foot">
              <span className={`route ${t.status === 'failed' ? 'route-failed' : ''}`}>
                {t.flavor === 'prank' ? `目标:${t.fromFloor}F` : `${t.fromFloor}F → ${t.targetFloor}F`}
              </span>
              <span className={`status status-${t.status}`}>{statusText(t)}</span>
            </div>
            {t.type === 'emergency' && t.status === 'pending' && (
              <div className="cd-track">
                <div className="cd-fill" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

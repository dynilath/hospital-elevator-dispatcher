import { useEffect } from 'react';
import type { Snapshot } from '../types';
import Messages from './Messages';

interface Props {
  snap: Snapshot;
  onClose: () => void;
}

/** 调度笔记本:需求记录(拟真模式下为空白,需自行记忆) */
export default function NotebookOverlay({ snap, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay">
      <div className="notebook-card">
        <div className="notebook-topbar">
          <span>📓 调度笔记本 · {snap.dayText}</span>
          {snap.simulate && <span className="notebook-sim">🎭 拟真模式:不留记录,记住你听到的!</span>}
        </div>
        {snap.simulate ? (
          <div className="notebook-blank">
            <div>✏️</div>
            <div>笔记本是空白的</div>
            <div className="msg-empty-sub">拟真模式下,需求只会在电话里播报一次</div>
          </div>
        ) : (
          <div className="notebook-body">
            <Messages snap={snap} />
          </div>
        )}
        <button className="notebook-close" onClick={onClose}>
          ✕ 合上笔记本
        </button>
      </div>
    </div>
  );
}

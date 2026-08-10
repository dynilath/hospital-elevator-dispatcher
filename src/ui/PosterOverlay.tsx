import { useEffect } from 'react';
import { FLOOR_DEPTS_OF } from '../config';

interface Props {
  floors: number;
  onClose: () => void;
}

/** 点开「医院楼层分布」贴画:移动到屏幕正中间放大查看 */
export default function PosterOverlay({ floors, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="poster-view" onClick={(e) => e.stopPropagation()}>
        <div className="poster-title">医院楼层分布</div>
        <div className="poster-sub">— 各楼层科室一览 —</div>
        <div className="poster-list">
          {Array.from({ length: floors }, (_, i) => i + 1).map((f) => (
            <div key={f} className="poster-row">
              <span className="poster-floor px-num">{f}F</span>
              <span className="poster-depts">{FLOOR_DEPTS_OF(f).join('  ')}</span>
            </div>
          ))}
        </div>
        <button className="poster-close" onClick={onClose}>
          ✕ 收起贴画
        </button>
      </div>
    </div>
  );
}

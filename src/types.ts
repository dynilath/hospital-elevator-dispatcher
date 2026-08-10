// ─── 核心类型定义 ───────────────────────────────────────────────

/** 乘客类型 */
export type PassengerKind = 'stand' | 'wheelchair' | 'bed' | 'stretcher';

/** 任务类型 */
export type TaskType = 'normal' | 'emergency';

/** 任务状态 */
export type TaskStatus = 'pending' | 'aboard' | 'delivered' | 'failed';

/** 电梯门状态 */
export type DoorState = 'closed' | 'opening' | 'open' | 'closing';

/** 难度配置(三个挑战维度 + 拟真开关) */
export interface Difficulty {
  /** 楼层数量 6-15,楼层多则科室多 */
  floors: number;
  /** 紧急调度任务平均间隔(秒),越小越频繁 */
  emergencyGap: number;
  /** 一局现实时长(分钟) */
  dayMinutes: number;
  /** 拟真模式:需求列表不留记录需自行记录;家属可能当场发难(微笑应急) */
  simulate: boolean;
}

/** 剧情电话类型 */
export type TaskFlavor = 'vip' | 'prank' | 'bang' | 'family' | 'critic';

/** 陪护人身份:家属(普通病床) / 护士(急救床) */
export type CompanionKind = 'family' | 'nurse';

/** 游戏内任务(呼叫) */
export interface Task {
  id: number;
  type: TaskType;
  /** 呼叫来源科室名(如"骨科病房") */
  title: string;
  /** 消息正文 */
  text: string;
  /** 接人楼层 */
  fromFloor: number;
  /** 目的地楼层 */
  targetFloor: number;
  kind: PassengerKind;
  status: TaskStatus;
  /** 创建时间(现实秒) */
  createdAt: number;
  /** 紧急任务剩余时限(现实秒,创建时) */
  deadline: number;
  /** 已等待秒数 */
  wait: number;
  /** 剧情电话类型 */
  flavor?: TaskFlavor;
  /** 电话呼叫延迟(秒,如工勤拍门很久才打电话) */
  callDelay: number;
  /** 电话是否已送达玩家 */
  callSent: boolean;
  /** 电话送达时间(现实秒,打字机/语音播报进度用) */
  callSentAt: number;
  /** 是否已接听(接听并看完完整内容后才记入笔记本) */
  answered: boolean;
  /** 接听时刻(现实秒,打字机从此刻开始播放) */
  answeredAt: number;
  /** 是否带家属/护士陪护(陪护站旁边,占用 1 格,会自己按电梯按钮) */
  companion?: boolean;
  /** 陪护人身份:家属 / 护士(决定模型与文案) */
  companionKind?: CompanionKind;
  /** 不发手机来电(乘客/挑剔家属自己按电梯);延迟来电检查须跳过此类任务 */
  noCall?: boolean;
  /** 家属堵门:送达前需先劝离家属 */
  familyBlocked?: boolean;
  /** 角色固有性格(上车时确定):teller 正常告知 / babbling 阿巴阿巴 / grumpy 不耐烦 / mute 沉默 / ignore 卧床无回应 */
  personality?: 'teller' | 'babbling' | 'grumpy' | 'mute' | 'ignore';
}

/** 消息面板用的任务视图 */
export interface TaskView {
  id: number;
  type: TaskType;
  title: string;
  text: string;
  fromFloor: number;
  targetFloor: number;
  kind: PassengerKind;
  status: TaskStatus;
  wait: number;
  /** 紧急任务总时限(秒,0 表示非紧急) */
  deadline: number;
  /** 紧急任务剩余秒数 */
  remaining: number | null;
  /** 剧情电话类型 */
  flavor?: TaskFlavor;
  /** 电话是否已送达 */
  callSent: boolean;
  /** 电话送达时间(现实秒) */
  callSentAt: number;
  /** 是否已接听 */
  answered: boolean;
  /** 接听时刻(现实秒) */
  answeredAt: number;
  /** 家属/护士陪护(随病人上梯,占 1 格) */
  companion?: boolean;
  /** 陪护人身份:家属 / 护士 */
  companionKind?: CompanionKind;
  /** 已接听且看完完整内容(记入笔记本) */
  recorded: boolean;
}

/** 电梯视图快照 */
export interface ElevatorView {
  /** 停靠层(取整) */
  floor: number;
  /** 连续位置(层单位,1 = 1F) */
  posY: number;
  doorOpen: number;
  doorState: DoorState;
  moving: boolean;
  /** 调度方向模式 */
  direction: 'up' | 'down' | 'idle';
  /** 已登记的楼层需求(持续亮灯直到到达) */
  lights: number[];
  /** 已占用容量 */
  used: number;
  /** 家属堵门(ICU 转运) */
  familyBlocked: boolean;
}

/** 结算统计 */
export interface ResultStats {
  satisfaction: number;
  grade: string;
  gradeName: string;
  total: number;
  done: number;
  failed: number;
  emgTotal: number;
  emgSuccess: number;
  avgWait: number;
  endTime: string;
  /** 提前结束(提前收工/被开除):不计算评级 */
  endedEarly: boolean;
  /** 提前结束原因提示(提前收工 / 被开除) */
  endReason?: string;
}

/** 引擎推送给 React 的完整快照 */
export interface Snapshot {
  phase: 'playing' | 'result';
  /** 剩余时间倒计时文本 mm:ss */
  dayText: string;
  /** 加班阶段(倒计时结束,服务完所有角色才结束) */
  overtime: boolean;
  satisfaction: number;
  total: number;
  done: number;
  emgTotal: number;
  emgSuccess: number;
  /** 主循环异常信息(排查用) */
  error: string | null;
  /** 拟真模式 */
  simulate: boolean;
  /** 最新一次来电编号(用于来电提示) */
  latestCallId: number;
  /** 临时事件消息(家属斥责/告知等) */
  eventMsg: { id: number; text: string } | null;
  elevator: ElevatorView;
      tasks: TaskView[];
      /** 提醒按钮状态 */
      reminder: { ready: boolean; cooldown: number };
  muted: boolean;
  result: ResultStats | null;
}

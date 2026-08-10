import type { Difficulty, PassengerKind } from './types';

// ─── 楼层与科室映射(索引 0 = 1F,最多 12 层,科室随楼层数逐渐增加) ─
// 关键楼层:1F 急诊大厅 / 4F CT影像室 / 5F 手术室 / 6F ICU
export const FLOOR_DEPTS: string[][] = [
  ['急诊大厅', '门诊药房', '门诊挂号'], // 1F
  ['检验科', '超声科'], // 2F
  ['放射科', '门诊诊区'], // 3F
  ['CT 影像室'], // 4F
  ['手术室'], // 5F
  ['ICU 重症室'], // 6F
  ['心内科病房', '心外科病房'], // 7F
  ['骨科病房', '康复科病房'], // 8F
  ['产科病房', '儿科病房'], // 9F
  ['神经内科病房', '血液科病房'], // 10F
  ['消化内科病房', '呼吸科病房'], // 11F
  ['肿瘤科病房', '内分泌病房'], // 12F
];

/** 楼层主科室名(按钮/指示器用) */
export const FLOOR_NAME = (floor: number): string => FLOOR_DEPTS[floor - 1]?.[0] ?? `${floor}F`;

/** 楼层全部科室(贴画/地图用) */
export const FLOOR_DEPTS_OF = (floor: number): string[] => FLOOR_DEPTS[floor - 1] ?? [`${floor}F`];

// ─── 关键楼层 ──────────────────────────────────────────────────
export const RAD_FLOOR = 3;
export const CT_FLOOR = 4;
export const OR_FLOOR = 5;
export const ICU_FLOOR = 6;
/** 病房起始楼层(≥7F 才有病房类任务) */
export const WARD_FLOOR = 7;

// ─── 轿厢参数(格子容量制:宽 3 × 深 4 = 12 格) ─────────────────
// 站立 1×1、轮椅 2×2、病床/担架 2×4;调度员(玩家)占后中 1 格
/** 电梯总容量(格) */
export const CAPACITY = 12;
/** 轿厢网格:宽 3 × 深 4 */
export const GRID_COLS = 3;
export const GRID_ROWS = 4;
/** 调度员占位(后角,避免挡住 2×4 病床与后排 2×2 轮椅) */
export const DISPATCHER_COL = 2;
export const DISPATCHER_ROW = 3;
/** 各乘客占用容量(格) */
export const PASSENGER_SIZE: Record<PassengerKind, number> = {
  stand: 1,
  wheelchair: 4,
  bed: 8,
  stretcher: 8,
};
/** 各乘客上下梯耗时(秒) */
export const BOARD_TIME: Record<PassengerKind, number> = {
  stand: 1.0,
  wheelchair: 1.7,
  bed: 2.6,
  stretcher: 2.2,
};
/** 人多时的自然重排:占用≥此值时周期性重排(往深处走) */
export const NATURAL_REPACK_USED = 8;
/** 自然重排间隔(秒) */
export const NATURAL_REPACK_TIME = 12;
/** 电梯运动模拟:加速度/最大速度/减速度(层/秒²,层/秒) */
export const ELEVATOR_ACCEL = 1.7;
export const ELEVATOR_MAX_SPEED = 2.1;
export const ELEVATOR_DECEL = 2.2;
/** 门开关耗时(秒) */
export const DOOR_TIME = 0.65;
/** 门保持开启的基础时间(秒) */
export const DOOR_HOLD = 1.1;

// ─── 拥挤提醒机制 ──────────────────────────────────────────────
/** 指令按钮(往里走走/靠右站站)共用冷却(秒) */
export const REMIND_COOLDOWN = 10;
/** 指令重排时乘客配合的概率(病床/担架与阿巴阿巴患者永远不配合) */
export const REPACK_COMPLY = 0.7;
/** 不配合乘客的头顶气泡台词(随机一句) */
export const REFUSE_LINES = ['😤 烦不烦,我就站这里', '😤 就不挪,就站这', '😤 别指挥我'];
/** 被拥挤阻塞后乘客放弃等待的时限(秒) */
export const BLOCK_GIVE_UP = 15;

// ─── 游戏时钟 ──────────────────────────────────────────────────
export const DAY_START = 8 * 3600; // 8:00
export const DAY_END = 17 * 3600; // 17:00

// ─── 任务生成参数(现实秒) ───────────────────────────────────────
/** 普通任务基础间隔 */
export const NORMAL_INTERVAL = 15;
/** 高峰时段间隔倍率(8:00-10:00 / 14:30-16:30) */
export const PEAK_FACTOR = 0.55;
/** 待办普通任务上限(超出则暂缓生成) */
export const MAX_PENDING_NORMAL = 4;
/** 消息面板最多显示条数 */
export const MAX_MESSAGES = 12;

// ─── 满意度 ────────────────────────────────────────────────────
/** 普通任务等待宽限期(秒,之后开始掉满意度) */
export const WAIT_GRACE = 20;
/** 普通任务等待每秒满意度衰减 */
export const SAT_DECAY_NORMAL = 0.22;
/** 领导急召:上电梯前每秒满意度衰减 */
export const SAT_DECAY_VIP = 1;
/** 超时失败固定满意度损失 */
export const SAT_EXPIRED_PENALTY = 12;

// ─── 难度预设与自定义选项 ───────────────────────────────────────
export interface DifficultyPreset {
  key: string;
  name: string;
  desc: string;
  diff: Difficulty;
}

export const PRESETS: DifficultyPreset[] = [
  {
    key: 'easy',
    name: '简单',
    desc: '4 层楼 · 低频紧急 · 一天 5 分钟',
    diff: { floors: 4, emergencyGap: 85, dayMinutes: 5, simulate: false },
  },
  {
    key: 'normal',
    name: '中等',
    desc: '6 层楼 · 中频紧急 · 一天 5 分钟',
    diff: { floors: 6, emergencyGap: 60, dayMinutes: 5, simulate: false },
  },
  {
    key: 'hard',
    name: '困难',
    desc: '8 层楼 · 高频紧急 · 一天 5 分钟',
    diff: { floors: 8, emergencyGap: 42, dayMinutes: 5, simulate: false },
  },
  {
    key: 'sim',
    name: '拟真',
    desc: '困难难度，无笔记本，有恶意家属',
    diff: { floors: 8, emergencyGap: 38, dayMinutes: 5, simulate: true },
  },
];

export const EMERGENCY_GAP_OPTIONS: { label: string; value: number }[] = [
  { label: '低', value: 78 },
  { label: '中', value: 55 },
  { label: '高', value: 40 },
];

export const MIN_FLOORS = 4;
export const MAX_FLOORS = 12;
export const MIN_DAY_MINUTES = 5;
export const MAX_DAY_MINUTES = 10;

// ─── 患者姓名(挂号打码风格:郑** / 刘*明) ───────────────────────
export const SURNAMES = [
  '王', '李', '张', '刘', '陈', '杨', '黄', '赵', '吴', '周', '徐', '孙', '马', '朱', '胡', '郭',
  '何', '林', '罗', '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '邓', '曹', '彭', '曾', '肖',
  '田', '董', '潘', '袁', '蔡', '蒋', '余', '于', '杜', '叶', '程', '苏', '魏', '吕', '丁', '任',
  '沈', '姚', '卢', '姜', '崔', '钟', '谭', '陆', '汪', '范', '金', '石', '廖', '贾', '夏', '韦',
  '付', '方', '白', '邹', '孟', '秦', '江', '尹', '薛', '闫', '段', '雷', '侯', '龙', '史', '陶',
  '黎', '贺', '顾', '毛', '郝', '龚', '邵', '万', '钱', '严', '覃', '武', '戴', '莫', '孔', '向',
];

export const GIVEN_CHARS = [
  '伟', '芳', '娜', '敏', '静', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '秀英',
  '霞', '平', '刚', '桂英', '建华', '文', '辉', '力', '瑞', '婷', '浩', '雪', '鹏', '宇', '倩', '彬',
  '晨', '熙', '诚', '睿', '泽', '婉', '芯', '妍', '浩宇', '佳怡', '子涵', '一诺',
];

// ─── 像素场景内部分辨率 ─────────────────────────────────────────
export const ELEV_CANVAS_W = 480;
export const ELEV_CANVAS_H = 360;
export const BLD_CANVAS_W = 210;
export const BLD_FLOOR_H = 30;
export const BLD_PAD = 16;
/** 楼宇剖面画布高度(随楼层数变化) */
export const BLD_CANVAS_H = (floors: number): number => floors * BLD_FLOOR_H + BLD_PAD * 2;

/** 游戏内一天的秒数 */
export const DAY_SECONDS = DAY_END - DAY_START;
/** 现实 1 秒对应的游戏秒数 */
export const timeScaleOf = (d: Difficulty): number => DAY_SECONDS / (d.dayMinutes * 60);

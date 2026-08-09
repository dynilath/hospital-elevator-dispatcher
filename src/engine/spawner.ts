import {
  CT_FLOOR,
  OR_FLOOR,
  ICU_FLOOR,
  WARD_FLOOR,
  SURNAMES,
  GIVEN_CHARS,
  FLOOR_DEPTS_OF,
  PEAK_FACTOR,
  MAX_PENDING_NORMAL,
  NORMAL_INTERVAL,
} from '../config';
import type { PassengerKind, TaskFlavor, TaskType } from '../types';

/** 生成的任务规格(引擎据此创建 Task) */
export interface TaskSpec {
  type: TaskType;
  title: string;
  text: string;
  fromFloor: number;
  targetFloor: number;
  kind: PassengerKind;
  deadline: number;
  flavor?: TaskFlavor;
  callDelay: number;
  /** 家属陪护(随病人上梯,占 1 格) */
  companion?: boolean;
}

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const pickKind = (weights: [PassengerKind, number][]): PassengerKind => {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [kind, w] of weights) {
    r -= w;
    if (r <= 0) return kind;
  }
  return weights[0][0];
};

/** 挂号打码姓名:郑** / 刘*明 / 王* */
export function maskedName(): string {
  const s = pick(SURNAMES);
  const g1 = pick(GIVEN_CHARS);
  const r = Math.random();
  if (g1.length === 2) {
    // 双字名:"*明" → 刘*明 或 刘**
    return r < 0.5 ? `${s}*${g1[1]}` : `${s}**`;
  }
  // 单字名:"*" → 刘* 或 刘**
  return r < 0.5 ? `${s}*` : `${s}**`;
}

/** 楼层上的随机科室名 */
const deptOf = (floor: number): string => pick(FLOOR_DEPTS_OF(floor));

/** 一天中的客流高峰倍率(8:00-10:00 / 14:30-16:30) */
export function peakFactor(daySeconds: number): number {
  const s = daySeconds;
  const peak1 = s >= 8 * 3600 && s < 10 * 3600;
  const peak2 = s >= 14.5 * 3600 && s < 16.5 * 3600;
  return peak1 || peak2 ? PEAK_FACTOR : 1;
}

/** 病房楼层列表 */
function wards(floors: number): number[] {
  const out: number[] = [];
  for (let f = WARD_FLOOR; f <= floors; f++) out.push(f);
  return out;
}

/** 任务生成器 */
export class Spawner {
  // 初始值以「任务单位」计:1 单位 ≈ NORMAL_INTERVAL×峰值倍率 秒
  private nextNormal = 0.4;
  private nextEmergency = 0.8;

  /** 普通呼叫(含领导/骚扰/工勤剧情) */
  makeCall(floors: number): TaskSpec {
    const wardsList = wards(floors);
    const ward = wardsList.length > 0 ? pick(wardsList) : null;
    const name = maskedName();
    const roll = Math.random();

    // 剧情电话:小人同事骚扰(误导)
    if (roll < 0.16) {
      const target = pick(Array.from({ length: floors }, (_, i) => i + 1).filter((f) => f > 1));
      return {
        type: 'normal',
        title: '匿名来电',
        text: pick([
          `(压低声音)喂?听说 ${target}F 有人要下楼,你赶紧去!`,
          `有人在 ${target}F 拍门半天了,快去接!`,
          `${target}F 那层有人等着转科,别磨蹭!`,
        ]),
        fromFloor: target,
        targetFloor: target,
        kind: 'stand',
        deadline: 0,
        flavor: 'prank',
        callDelay: 0,
      };
    }

    // 剧情电话:工勤拍门(电话来得晚,态度差)
    if (roll < 0.3) {
      const f = pick(Array.from({ length: floors }, (_, i) => i + 1).filter((x) => x > 1));
      return {
        type: 'normal',
        title: deptOf(f),
        text: pick([
          `门都快拍烂了!病人等半天了!马上到 ${f}F 接!`,
          `(骂骂咧咧)拍门拍半天没人理!${f}F,人还来不来?!`,
          `再不来病人自己走下去算了!${f}F!快!`,
        ]),
        fromFloor: f,
        targetFloor: 1,
        kind: pickKind([['stand', 5], ['wheelchair', 4], ['bed', 1]]),
        deadline: 0,
        flavor: 'bang',
        callDelay: rnd(14, 22),
      };
    }

    // 剧情电话:领导急召
    if (roll < 0.42) {
      const tgt = ward ?? OR_FLOOR;
      return {
        type: 'normal',
        title: pick(['院办', '医务科', '护理部']),
        text: `我是${pick(['张', '刘', '陈'])}${pick(['院长', '主任', '科长'])}!立刻到 1F 接我,送到 ${tgt}F,耽误不起!`,
        fromFloor: 1,
        targetFloor: tgt,
        kind: pickKind([['stand', 8], ['wheelchair', 2]]),
        deadline: 0,
        flavor: 'vip',
        callDelay: 0,
      };
    }

    // 常规调度需求
    const templates: (() => TaskSpec)[] = [
      // 急诊 → CT
      () => ({
        type: 'normal',
        title: '急诊大厅',
        text: `${name} 需做 CT 检查,请接送到 5F CT 影像室`,
        fromFloor: 1,
        targetFloor: CT_FLOOR,
        kind: pickKind([['bed', 4], ['wheelchair', 3], ['stand', 3]]),
        deadline: 0,
        callDelay: 0,
      }),
      // 急诊 → 放射科
      () => ({
        type: 'normal',
        title: '急诊大厅',
        text: `${name} 需拍 X 光片,请送至 4F 门诊诊区旁放射科`,
        fromFloor: 1,
        targetFloor: 4,
        kind: pickKind([['wheelchair', 4], ['stand', 4], ['bed', 2]]),
        deadline: 0,
        callDelay: 0,
      }),
      // 急诊 → 检验科
      () => ({
        type: 'normal',
        title: '急诊大厅',
        text: `${name} 需抽血化验,请送至 2F 检验科`,
        fromFloor: 1,
        targetFloor: 2,
        kind: 'stand',
        deadline: 0,
        callDelay: 0,
      }),
      // 门诊诊区 → 急诊留观
      () => ({
        type: 'normal',
        title: '门诊诊区 A',
        text: `${name} 就诊完毕,请送至 1F 急诊留观`,
        fromFloor: 3,
        targetFloor: 1,
        kind: pickKind([['wheelchair', 4], ['stand', 6]]),
        deadline: 0,
        callDelay: 0,
      }),
      // CT → 急诊留观
      () => ({
        type: 'normal',
        title: 'CT 影像室',
        text: `${name} 已拍完 CT,请接回 1F 急诊留观`,
        fromFloor: CT_FLOOR,
        targetFloor: 1,
        kind: pickKind([['bed', 5], ['wheelchair', 4], ['stand', 1]]),
        deadline: 0,
        callDelay: 0,
      }),
      // 放射科 → 急诊
      () => ({
        type: 'normal',
        title: '放射科',
        text: `${name} 拍片完毕,请接回 1F 急诊大厅`,
        fromFloor: 4,
        targetFloor: 1,
        kind: pickKind([['wheelchair', 5], ['stand', 3], ['bed', 2]]),
        deadline: 0,
        callDelay: 0,
      }),
      // 检验科 → 急诊
      () => ({
        type: 'normal',
        title: '检验科',
        text: `${name} 化验完成,请接回 1F 急诊留观`,
        fromFloor: 2,
        targetFloor: 1,
        kind: 'stand',
        deadline: 0,
        callDelay: 0,
      }),
    ];

    // 有病房时的接送任务
    if (ward !== null) {
      templates.push(
        // 病房 → 门诊药房
        () => ({
          type: 'normal',
          title: deptOf(ward),
          text: `${name} 需去 1F 门诊药房取药,请到 ${ward}F 接人送至 1F`,
          fromFloor: ward,
          targetFloor: 1,
          kind: pickKind([['wheelchair', 4], ['stand', 6]]),
          deadline: 0,
          callDelay: 0,
        }),
        // 病房 → CT
        () => ({
          type: 'normal',
          title: deptOf(ward),
          text: `卧床患者 ${name} 需做 CT 复查,请到 ${ward}F 接人送至 5F`,
          fromFloor: ward,
          targetFloor: CT_FLOOR,
          kind: 'bed',
          deadline: 0,
          callDelay: 0,
        }),
        // 病房 → 放射科
        () => ({
          type: 'normal',
          title: deptOf(ward),
          text: `${name} 需拍片检查,请到 ${ward}F 接人送至 4F 放射科`,
          fromFloor: ward,
          targetFloor: 4,
          kind: pickKind([['wheelchair', 5], ['stand', 4], ['bed', 1]]),
          deadline: 0,
          callDelay: 0,
        }),
        // CT → 病房
        () => ({
          type: 'normal',
          title: 'CT 影像室',
          text: `${name} 已拍完片,请送至 ${ward}F ${deptOf(ward)}`,
          fromFloor: CT_FLOOR,
          targetFloor: ward,
          kind: pickKind([['bed', 5], ['wheelchair', 4], ['stand', 1]]),
          deadline: 0,
          callDelay: 0,
        }),
        // 放射科 → 病房
        () => ({
          type: 'normal',
          title: '放射科',
          text: `${name} 检查完毕,请送回 ${ward}F ${deptOf(ward)}`,
          fromFloor: 4,
          targetFloor: ward,
          kind: pickKind([['wheelchair', 5], ['stand', 4], ['bed', 1]]),
          deadline: 0,
          callDelay: 0,
        }),
      );
    }
    const spec = pick(templates)();
    // 轮椅/病床病人多数有家属陪护(不发电话,跟随上梯,占 1 格)
    if ((spec.kind === 'wheelchair' || spec.kind === 'bed') && Math.random() < 0.6) {
      spec.companion = true;
      spec.text += ' (家属陪同)';
    }
    return spec;
  }

  /** 生成一个紧急任务(楼层不足时跳过对应模板;ICU 转运带家属堵门剧情) */
  makeEmergency(floors: number): TaskSpec | null {
    const hasICU = floors >= ICU_FLOOR;
    const templates: (() => TaskSpec | null)[] = [
      // 急诊 → 手术室(最常见,无家属)
      () => ({
        type: 'emergency',
        title: '急诊大厅',
        text: '急诊!危重患者需立即手术,急救床已就位 1F,速送 6F 手术室!',
        fromFloor: 1,
        targetFloor: OR_FLOOR,
        kind: 'stretcher',
        deadline: 80,
        callDelay: 0,
      }),
    ];
    if (hasICU) {
      templates.push(
        // ICU → 手术室
        () => ({
          type: 'emergency',
          title: 'ICU 重症室',
          text: 'ICU 病人病情恶化!速到 7F 接人送 6F 手术室抢救!',
          fromFloor: ICU_FLOOR,
          targetFloor: OR_FLOOR,
          kind: 'stretcher',
          deadline: 85,
          callDelay: 0,
        }),
        // 手术室 → ICU(家属跟车堵门)
        () => ({
          type: 'emergency',
          title: '手术室',
          text: '手术完毕!患者需立即转 7F ICU 监护!家属非要跟车,帮劝一劝!',
          fromFloor: OR_FLOOR,
          targetFloor: ICU_FLOOR,
          kind: 'stretcher',
          deadline: 75,
          flavor: 'family',
          callDelay: 0,
        }),
        // 急诊 → ICU(家属跟车堵门)
        () => ({
          type: 'emergency',
          title: '急诊大厅',
          text: '危重患者已上急救床!速送 7F ICU!家属死活要跟着,来了就知道!',
          fromFloor: 1,
          targetFloor: ICU_FLOOR,
          kind: 'stretcher',
          deadline: 85,
          flavor: 'family',
          callDelay: 0,
        }),
      );
    }
    return pick(templates)();
  }

  /** 主生成入口:返回新任务规格列表 */
  update(dt: number, daySeconds: number, floors: number, emergencyGap: number, pendingNormal: number): TaskSpec[] {
    const out: TaskSpec[] = [];
    const pk = peakFactor(daySeconds);
    this.nextNormal -= dt / (NORMAL_INTERVAL * pk);
    this.nextEmergency -= dt / emergencyGap;

    if (this.nextNormal <= 0 && pendingNormal < MAX_PENDING_NORMAL) {
      this.nextNormal += 0.9 + Math.random() * 1.1;
      out.push(this.makeCall(floors));
    }
    if (this.nextEmergency <= 0) {
      this.nextEmergency += 0.6 + Math.random() * 1.0;
      const spec = this.makeEmergency(floors);
      if (spec) out.push(spec);
    }
    return out;
  }
}

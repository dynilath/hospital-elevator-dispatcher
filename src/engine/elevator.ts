import { DOOR_HOLD, DOOR_TIME, ELEVATOR_ACCEL, ELEVATOR_DECEL, ELEVATOR_MAX_SPEED } from '../config';
import type { DoorState } from '../types';

export type ElevatorDirection = 'up' | 'down' | 'idle';

/**
 * 电梯运动与调度状态机(模拟真实电梯):
 * - 运行:加速 → 巡航 → 减速 → 平层 → 开门
 * - 调度:上/下方向模式;按按钮登记需求(持续亮灯直到到达);
 *   顺向需求优先,反向需求延后到方向翻转;再按一次可取消需求。
 */
export class Elevator {
  readonly floors: number;
  /** 连续位置,1 = 1F(层单位) */
  posY = 1;
  floor = 1;
  moving = false;
  targetFloor: number | null = null;
  doorState: DoorState = 'closed';
  doorOpen = 0;
  doorTimer = 0;
  /** 保持开门的时间(秒),由引擎按上下客情况设置 */
  hold = 0;
  /** 已登记的楼层需求(亮灯直到到达) */
  lights = new Set<number>();
  /** 厅外呼叫(楼层 → 想要方向,电梯外按 ▲/▼) */
  hallCalls = new Map<number, 'up' | 'down'>();
  /** 当前调度方向 */
  direction: ElevatorDirection = 'idle';
  /** 已占用容量(格,初始 1 格为调度员自己) */
  used = 1;
  /** 当前运行速度(层/秒) */
  speed = 0;

  constructor(floors: number) {
    this.floors = floors;
  }

  /** 玩家按下楼层按钮:登记需求 / 再按取消 / 当前层开门 */
  press(floor: number): boolean {
    if (floor < 1 || floor > this.floors) return false;
    if (this.lights.has(floor)) {
      // 再按一次:取消需求
      this.lights.delete(floor);
      return true;
    }
    if (floor === this.floor) {
      // 当前层:开门(便于接送本层乘客)
      if (this.doorState === 'closed' && !this.moving) {
        this.hold = DOOR_HOLD;
        this.doorState = 'opening';
      }
      return true;
    }
    this.lights.add(floor);
    // 静止且无方向时,首个需求决定方向
    if (this.direction === 'idle' && !this.moving && this.doorState === 'closed') {
      this.direction = floor > this.floor ? 'up' : 'down';
    }
    return true;
  }

  /** 当前运行方向:1 上 / -1 下 / 0 静止(含待命方向指示) */
  directionArrow(): number {
    if (this.direction === 'up') return 1;
    if (this.direction === 'down') return -1;
    return 0;
  }

  /**
   * 计算下一目标:顺向优先,顺向清空后翻转方向。
   * 厅外呼叫带方向:上行中跳过上方"要下行"的呼叫,反转后再接;
   * 静止时首个厅外呼叫的方向决定出发方向。
   */
  private computeTarget(): number | null {
    if (this.lights.size === 0) {
      this.direction = 'idle';
      return null;
    }
    if (this.direction === 'idle') {
      // 首个需求决定方向(厅外呼叫按其想要的方向)
      const first = this.lights.values().next().value as number;
      const callDir = this.hallCalls.get(first);
      this.direction = callDir ?? (first > this.posY ? 'up' : first < this.posY ? 'down' : 'idle');
      if (this.direction === 'idle') return null;
    }
    // 顺向中跳过相反方向的厅外呼叫
    const ok = (f: number): boolean => {
      const d = this.hallCalls.get(f);
      return d === undefined || d === this.direction;
    };
    const below = [...this.lights].filter((f) => f < this.posY);
    const above = [...this.lights].filter((f) => f > this.posY);
    if (this.direction === 'down') {
      const belowOk = below.filter(ok);
      if (belowOk.length > 0) return Math.max(...belowOk);
      // 下行需求清空 → 翻转上行
      this.direction = 'up';
      const aboveOk = above.filter(ok);
      if (aboveOk.length > 0) return Math.min(...aboveOk);
      // 上方只剩相反方向呼叫:也服务(到达后自然反转)
      if (above.length > 0) return Math.min(...above);
      this.direction = 'idle';
      return null;
    }
    // 上行
    const aboveOk = above.filter(ok);
    if (aboveOk.length > 0) return Math.min(...aboveOk);
    this.direction = 'down';
    const belowOk = below.filter(ok);
    if (belowOk.length > 0) return Math.max(...belowOk);
    if (below.length > 0) return Math.max(...below);
    this.direction = 'idle';
    return null;
  }

  update(dt: number) {
    // 关门静止且已登记需求 → 出发(顺向优先);需求清空 → 方向复位
    if (this.doorState === 'closed' && !this.moving) {
      if (this.lights.size > 0) {
        this.moving = true;
        this.targetFloor = this.computeTarget();
        if (this.targetFloor === null) this.moving = false;
      } else {
        this.direction = 'idle';
      }
    }

    // 门动画
    if (this.doorState === 'opening') {
      this.doorOpen = Math.min(1, this.doorOpen + dt / DOOR_TIME);
      if (this.doorOpen >= 1) {
        this.doorState = 'open';
        this.doorTimer = this.hold;
      }
    } else if (this.doorState === 'open') {
      this.doorTimer -= dt;
      // 被拥挤阻塞/家属堵门时保持开门,由引擎控制 doorTimer 不归零
      if (this.doorTimer <= 0) {
        this.doorState = 'closing';
      }
    } else if (this.doorState === 'closing') {
      this.doorOpen = Math.max(0, this.doorOpen - dt / DOOR_TIME);
      if (this.doorOpen <= 0) {
        this.doorState = 'closed';
        this.doorOpen = 0;
      }
    }

    // 移动(速度曲线:加速 → 巡航 → 减速平层)
    if (this.moving && this.targetFloor !== null) {
      const dist = this.targetFloor - this.posY;
      const dir = Math.sign(dist);
      const d = Math.abs(dist);
      // 该速度下需要的减速距离:v²/(2a)
      const decelDist = (this.speed * this.speed) / (2 * ELEVATOR_DECEL);
      if (d <= decelDist) {
        // 减速段:速度随剩余距离收敛
        this.speed = Math.max(0, this.speed - ELEVATOR_DECEL * dt);
        const vNeeded = Math.sqrt(Math.max(0, 2 * ELEVATOR_DECEL * d));
        if (this.speed > vNeeded) this.speed = vNeeded;
      } else {
        // 加速/巡航段
        this.speed = Math.min(ELEVATOR_MAX_SPEED, this.speed + ELEVATOR_ACCEL * dt);
      }
      const step = this.speed * dt;
      if (step >= d) {
        this.posY = this.targetFloor;
        this.moving = false;
        this.speed = 0;
        this.floor = Math.round(this.posY);
        // 到达:清除本层需求与厅外呼叫并开门
        this.lights.delete(this.floor);
        this.hallCalls.delete(this.floor);
        this.doorState = 'opening';
      } else {
        this.posY += dir * step;
      }
    }
    this.floor = Math.round(this.posY);
  }
}

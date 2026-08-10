import { sfx } from './audio';
import { Elevator } from './elevator';
import { Spawner, type TaskSpec } from './spawner';
import {
  BOARD_TIME,
  CAPACITY,
  DAY_END,
  DAY_START,
  DISPATCHER_COL,
  DISPATCHER_ROW,
  DOOR_HOLD,
  FLOOR_NAME,
  GRID_COLS,
  GRID_ROWS,
  NATURAL_REPACK_TIME,
  NATURAL_REPACK_USED,
  PASSENGER_SIZE,
  REFUSE_LINES,
  REMIND_COOLDOWN,
  REPACK_COMPLY,
  SAT_DECAY_NORMAL,
  SAT_DECAY_VIP,
  SAT_EXPIRED_PENALTY,
  WAIT_GRACE,
  timeScaleOf,
} from '../config';
import type { Difficulty, ResultStats, Snapshot, Task, TaskView } from '../types';

/** 渲染目标接口(3D 场景实现) */
export interface SceneRenderable {
  renderFrame(): void;
  /** 角色头顶气泡(由场景定位角色显示);返回 false 表示未找到该角色(引擎退回顶部消息) */
  showBubbleForTask?(taskId: number, text: string, durationMs?: number): boolean;
}

/** 游戏主引擎:持有全部可变状态,驱动 rAF 循环,向 React 推送快照 */
export class GameEngine {
  readonly diff: Difficulty;
  private readonly timeScale: number;
  readonly elevator: Elevator;
  private readonly spawner: Spawner;

  private tasks: Task[] = [];
  private idSeq = 1;

  private daySeconds = DAY_START;
  /** 开局真实时间戳(倒计时按难度分钟计) */
  private startReal = Date.now() / 1000;
  /** 倒计时结束后的加班阶段:不再生成新任务,服务完所有角色才结束 */
  private overtime = false;
  phase: 'playing' | 'result' = 'playing';

  satisfaction = 100;

  // 统计
  private statTotal = 0;
  private statDone = 0;
  private statFailed = 0;
  private statEmgTotal = 0;
  private statEmgSuccess = 0;
  private waitSum = 0;

  // 轿厢网格占位(3 宽 × 4 深,调度员占后中 1 格)
  private placements = new Map<number, { col: number; row: number; w: number; h: number }>();
  /** 家属陪护占位(任务 id → 单元格) */
  private companions = new Map<number, { col: number; row: number }>();
  private repackTimer = NATURAL_REPACK_TIME;

  // 拥挤机制:提醒按钮(重排,不再硬阻断)
  private remindCooldown = 0;
  compAnim = 0;

  // 家属按键(自己按电梯按钮)与临时事件消息
  private familyLights = new Set<number>();
  /** 家属按键的来源任务(楼层 → 任务 id,取消时在被取消家属头顶弹气泡) */
  private familyLightOwner = new Map<number, number>();
  private eventSeq = 0;
  private eventMsg: { id: number; text: string } | null = null;

  // 家属堵门(ICU 转运):堵住电梯直到玩家按「别堵门!」劝离,无超时
  private familyTask: Task | null = null;

  /** 挑剔家属(拟真):在梯上指指点点的独立乘客,到站前未微笑服务即被开除 */
  private criticTask: Task | null = null;
  /** 挑剔家属未微笑到站:等离梯动画结束后的结算延迟(秒) */
  private criticFireDelay = 0;

  // 来电编号(驱动来电提示)
  private callSeq = 0;

  muted = false;
  result: ResultStats | null = null;

  // 渲染与循环
  private scene3d: SceneRenderable | null = null;
  private raf = 0;
  private lastT = 0;
  private emitTimer = 0;
  private flash = 0;
  /** 主循环异常(供 UI 展示排查) */
  lastError: string | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  private readonly listeners = new Set<() => void>();

  constructor(diff: Difficulty) {
    this.diff = diff;
    this.timeScale = timeScaleOf(diff);
    this.elevator = new Elevator(diff.floors);
    this.spawner = new Spawner(diff.simulate);
  }

  // ─── 生命周期 ────────────────────────────────────────────────
  attachScene(scene: SceneRenderable) {
    this.scene3d = scene;
  }

  start() {
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    // 看门狗:rAF 被节流/暂停时兜底推进
    this.watchdog = setInterval(() => {
      if (performance.now() - this.lastT > 600) this.tick(performance.now());
    }, 300);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    if (this.watchdog) clearInterval(this.watchdog);
    this.listeners.clear();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  private tick = (t: number) => {
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    try {
      this.update(dt);
      this.render();
      this.emitTimer += dt;
      if (this.emitTimer >= 0.1) {
        this.emitTimer = 0;
        this.notify();
      }
    } catch (e) {
      this.lastError = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
      this.notify();
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  // ─── 玩家输入 ────────────────────────────────────────────────
  pressFloor(floor: number) {
    if (this.phase !== 'playing') return;
    // 挑剔家属(未微笑)的目标楼层不可取消:它到站前需要微笑服务,取消会导致开除机制失效
    if (this.criticTask && this.criticTask.targetFloor === floor && this.elevator.lights.has(floor)) {
      this.bubble(this.criticTask.id, '😤 挑剔家属:我就要去这层!');
      return;
    }
    // 取消家属自己按的需求 → 随机反应(显示在被取消家属头顶)
    if (this.elevator.lights.has(floor) && this.familyLights.has(floor)) {
      const ownerId = this.familyLightOwner.get(floor);
      this.familyLights.delete(floor);
      this.familyLightOwner.delete(floor);
      if (this.elevator.press(floor)) {
        sfx.press();
        this.familyCancelReaction(floor, ownerId);
      }
      this.notify();
      return;
    }
    if (this.elevator.press(floor)) {
      sfx.press();
      this.notify();
    }
  }

  /** 家属被取消后的随机反应:斥责 / 告知楼层 / 重新按键(气泡挂在被取消家属头顶) */
  private familyCancelReaction(floor: number, taskId?: number) {
    const r = Math.random();
    if (r < 0.34) {
      // 斥责玩家(稍微降低评价)
      this.satisfaction = Math.max(0, this.satisfaction - 3);
      sfx.angry();
      this.bubble(taskId, '😠 家属:怎么给我取消了?!');
    } else if (r < 0.67) {
      // 与玩家沟通
      sfx.message();
      this.bubble(taskId, `🗣 家属:我要去 ${floor} 楼!`);
    } else {
      // 重新按自己要去的楼层
      if (this.elevator.press(floor)) {
        this.familyLights.add(floor);
        if (taskId !== undefined) this.familyLightOwner.set(floor, taskId);
        sfx.press();
        this.bubble(taskId, '👆 家属又按了一次按钮');
      }
    }
  }

  /** 家属自己按电梯按钮(陪护家属走到面板前按下;不取消已有需求) */
  familyPressButton(floor: number, taskId?: number) {
    if (this.phase !== 'playing') return;
    if (this.elevator.lights.has(floor)) return;
    if (this.elevator.press(floor)) {
      this.familyLights.add(floor);
      if (taskId !== undefined) this.familyLightOwner.set(floor, taskId);
      sfx.press();
      this.notify();
    }
  }

  /** 家属在电梯外按厅外呼叫按钮(▲/▼ 按需求方向,不取消已有需求) */
  familyHallPress(floor: number, dir: 'up' | 'down', taskId?: number) {
    if (this.phase !== 'playing') return;
    if (this.elevator.hallCalls.has(floor)) return; // 已有呼叫
    if (!this.elevator.lights.has(floor)) {
      this.elevator.press(floor);
    }
    this.elevator.hallCalls.set(floor, dir);
    this.familyLights.add(floor);
    if (taskId !== undefined) this.familyLightOwner.set(floor, taskId);
    sfx.press();
    this.notify();
  }

  private pushEvent(text: string) {
    this.eventSeq++;
    this.eventMsg = { id: this.eventSeq, text };
    this.notify();
  }

  /** 角色头顶气泡(由 3D 场景定位角色显示);无来源角色或场景缺失时退回顶部消息 */
  private bubble(taskId: number | undefined, text: string, durationMs = 2500) {
    if (taskId === undefined) {
      this.pushEvent(text);
      return;
    }
    const shown = this.scene3d?.showBubbleForTask?.(taskId, text, durationMs) ?? false;
    if (!shown) this.pushEvent(text);
  }

  /** 提醒乘客往里走 / 劝家属让开(指令重排:人往深处走,腾出门口) */
  pressRemind() {
    if (this.phase !== 'playing') return;
    // 家属堵门:按提醒按钮劝家属让开,立即送达
    if (this.familyTask) {
      const t = this.familyTask;
      this.familyTask = null;
      this.deliver(t);
      sfx.remind();
      this.notify();
      return;
    }
    if (this.remindCooldown > 0) return;
    this.remindCooldown = REMIND_COOLDOWN;
    this.repackByCommand('deep');
    this.compAnim = 1;
    sfx.remind();
    this.notify();
  }

  /** 指令「靠右站站」:让人尽量站到最右边(与往里走走共用冷却) */
  pressRight() {
    if (this.phase !== 'playing') return;
    if (this.remindCooldown > 0) return;
    this.remindCooldown = REMIND_COOLDOWN;
    this.repackByCommand('right');
    this.compAnim = 1;
    sfx.remind();
    this.notify();
  }

  /** 微笑服务:挑剔家属(到站前)立即微笑解除;成功不影响满意度 */
  pressSmile() {
    if (this.phase !== 'playing') return;
    if (this.criticTask) {
      const taskId = this.criticTask.id;
      this.criticTask = null;
      // 感谢语显示在被服务家属头顶
      this.bubble(taskId, '😊 家属:这还差不多!');
      sfx.success();
      this.notify();
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    sfx.muted = this.muted;
    this.notify();
  }

  /** 手机接听来电:标记为已接听(看完完整内容后才会记入笔记本) */
  answerCall(taskId: number) {
    const t = this.tasks.find((x) => x.id === taskId);
    if (t && !t.answered) {
      t.answered = true;
      t.answeredAt = Date.now() / 1000;
      this.notify();
    }
  }

  /** 来电是否已接听并看完完整内容(从接听时刻起打字机播报完毕) */
  isRecorded(t: Task): boolean {
    if (!t.answered) return false;
    const elapsedMs = (Date.now() / 1000 - t.answeredAt) * 1000;
    return elapsedMs >= t.text.length * 20;
  }

  /** 提前收工(不计算评级,结果页直接显示「提前下班」提示) */
  endDay() {
    if (this.phase !== 'playing') return;
    this.finishDay(true, '提前收工:你怎么能提前下班呢');
  }

  // ─── 更新 ────────────────────────────────────────────────────
  private update(dt: number) {
    if (this.phase !== 'playing') return;

    this.daySeconds += dt * this.timeScale;
    if (this.daySeconds >= DAY_END) {
      this.daySeconds = DAY_END;
      this.overtime = true; // 进入加班:不再生成新任务
    }

    // 加班阶段:所有角色完成(送达/失败)后才结束
    if (this.overtime) {
      const done = this.tasks.every(
        (t) => t.status === 'delivered' || t.status === 'failed',
      );
      if (done) {
        this.finishDay();
        return;
      }
    }

    // 生成任务(加班阶段停止)
    const pendingNormal = this.tasks.filter(
      (t) => t.type === 'normal' && (t.status === 'pending' || t.status === 'aboard'),
    ).length;
    const specs = this.overtime
      ? []
      : this.spawner.update(dt, this.daySeconds, this.diff.floors, this.diff.emergencyGap, pendingNormal);
    for (const spec of specs) this.addTask(spec);

    // 延迟来电送达(noCall 任务自己按电梯,不发来电,跳过)
    const now = Date.now() / 1000;
    for (const t of this.tasks) {
      if (!t.callSent && !t.noCall && now - t.createdAt >= t.callDelay) this.sendCall(t);
    }

    // 电梯到站上下客(门开启期间逐帧处理,幂等)
    this.processDoors();

    // 空闲停靠时,本层有待接乘客则自动开门
    const ev = this.elevator;
    if (ev.doorState === 'closed' && !ev.moving && ev.lights.size === 0) {
      const hasWaiting = this.tasks.some((t) => t.status === 'pending' && t.fromFloor === ev.floor);
      if (hasWaiting) {
        ev.hold = DOOR_HOLD;
        ev.doorState = 'opening';
      }
    }

    // 等待计时与紧急超时
    for (const t of this.tasks) {
      if (t.status === 'pending') {
        t.wait += dt;
        if (t.type === 'emergency' && t.wait >= t.deadline) {
          this.failTask(t);
        }
      }
    }

    // 满意度衰减:领导急召上梯前每秒 −1;普通任务超宽限期后按固定速率
    let decay = 0;
    for (const t of this.tasks) {
      if (t.status !== 'pending') continue;
      if (t.flavor === 'vip') decay += SAT_DECAY_VIP * dt;
      else if (t.wait > WAIT_GRACE) decay += SAT_DECAY_NORMAL * dt;
    }
    this.satisfaction = Math.max(0, Math.min(100, this.satisfaction - decay));

    // 家属堵门:不赶走电梯就无法运行(保持开门,无超时;玩家按「别堵门!」劝离)
    if (this.familyTask) {
      const t = this.familyTask;
      if (ev.floor !== t.targetFloor || ev.doorState !== 'open') {
        // 电梯离开/关门:家属骂骂咧咧让开,到站自然送达
        this.familyTask = null;
      } else {
        ev.doorTimer = Math.max(ev.doorTimer, 5); // 保持开门
      }
    }

    // 挑剔家属未微笑到站:等其完全离开电梯(离梯动画约 1.1s)后再结算开除
    if (this.criticFireDelay > 0) {
      this.criticFireDelay -= dt;
      if (this.criticFireDelay <= 0) {
        this.criticFireDelay = 0;
        this.finishDay(true, '被开除了:态度不好被发到网上去了');
        return;
      }
    }

    // 自然重排:人多时过一段时间自动往深处走,腾出更多空间
    if (this.elevator.used >= NATURAL_REPACK_USED) {
      this.repackTimer -= dt;
      if (this.repackTimer <= 0) {
        this.repackTimer = NATURAL_REPACK_TIME;
        this.repack();
        this.compAnim = 1;
      }
    } else {
      this.repackTimer = NATURAL_REPACK_TIME;
    }

    this.remindCooldown = Math.max(0, this.remindCooldown - dt);
    this.compAnim = Math.max(0, this.compAnim - dt * 2.2);
    this.flash += dt;

    // 清理已被服务(到达)的家属按键标记
    for (const f of [...this.familyLights]) {
      if (!this.elevator.lights.has(f)) {
        this.familyLights.delete(f);
        this.familyLightOwner.delete(f);
      }
    }

    this.elevator.update(dt);
  }

  private processDoors() {
    const ev = this.elevator;
    if (ev.doorState !== 'open' || ev.moving) return;
    const F = ev.floor;

    // 送达(家属堵门任务除外:先进入堵门流程;堵门期间不送达,直到按「别堵门!」)
    let deliveredAny = false;
    for (const t of this.tasks) {
      if (t.status === 'aboard' && t.targetFloor === F) {
        if (t.flavor === 'family' && !t.familyBlocked) {
          // 家属堵门开始(无限期,直到玩家按「别堵门!」)
          t.familyBlocked = true;
          this.familyTask = t;
          sfx.crowd();
          this.notify();
          continue;
        }
        if (this.familyTask === t) continue; // 堵门中:电梯无法运行,不送达
        this.deliver(t);
        deliveredAny = true;
      }
    }

    // 上客(按到达先后;恶作剧电话没有真乘客;放不下就尽可能进入,不阻断电梯)
    let boardTotal = 0;
    let boardedAny = false;
    const waiting = this.tasks
      .filter((t) => t.status === 'pending' && t.fromFloor === F && t.flavor !== 'prank')
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const t of waiting) {
      const size = PASSENGER_SIZE[t.kind] + (t.companion ? 1 : 0);
      const spot = this.findSpot(t.kind);
      const g = this.gridOf(t.kind);
      // 陪护家属还需要一个 1×1 空位:先临时占住患者的格子再找,避免家属站进病床/轮椅里
      let companionSpot: { col: number; row: number } | null = null;
      if (t.companion) {
        if (spot) this.placements.set(t.id, { ...spot, w: g.w, h: g.h });
        companionSpot = spot ? this.findSpot('stand') : null;
        if (spot) this.placements.delete(t.id);
      }
      const capacityOk = t.type === 'emergency' || this.elevator.used + size <= CAPACITY;
      if (capacityOk && spot && (!t.companion || companionSpot)) {
        t.status = 'aboard';
        t.personality = this.pickPersonality(t.kind);
        this.elevator.used += size;
        this.placements.set(t.id, { ...spot, w: g.w, h: g.h });
        if (t.companion && companionSpot) {
          this.companions.set(t.id, companionSpot);
        }
        boardTotal += BOARD_TIME[t.kind];
        boardedAny = true;
        if (t.flavor === 'bang') {
          t.text += ' —— 工勤骂骂咧咧地把病人推进了电梯';
        }
        // 挑剔家属上梯:开始指指点点(头顶循环抱怨气泡),到站前不微笑服务即被开除
        if (t.flavor === 'critic') {
          this.criticTask = t;
        }
        sfx.ding();
      }
      // 放不下:留在本层等待下次,不阻止电梯继续运行
    }

    // 恶作剧识破:到层后发现没有真乘客(或恰好有人上了,算你走运)
    const pranks = this.tasks.filter(
      (t) => t.flavor === 'prank' && t.status === 'pending' && t.fromFloor === F,
    );
    for (const t of pranks) {
      t.status = 'delivered';
      this.statDone++;
      if (!boardedAny) {
        t.text = `${t.text} —— 到层后空无一人,被耍了 😤`;
        sfx.fail();
      }
      this.notify();
    }

    // 有人上梯:本层厅外呼叫应答清除
    if (boardedAny) {
      this.elevator.hallCalls.delete(F);
    }

    // 保持开门:正在上下客 / 家属堵门
    if (this.familyTask) {
      ev.doorTimer = Math.max(ev.doorTimer, 5);
    } else {
      const extra = boardTotal > 0 ? boardTotal + 1.0 : 0;
      const need = Math.max(deliveredAny ? 1.2 : 0, extra);
      if (need > 0) ev.doorTimer = Math.max(ev.doorTimer, need);
      else ev.doorTimer = Math.min(ev.doorTimer, DOOR_HOLD + 0.3);
    }
  }

  // ─── 轿厢网格占位 ────────────────────────────────────────────
  /** 各乘客占用格子 */
  private gridOf(kind: Task['kind']): { w: number; h: number } {
    if (kind === 'bed' || kind === 'stretcher') return { w: 2, h: 4 };
    if (kind === 'wheelchair') return { w: 2, h: 2 };
    return { w: 1, h: 1 };
  }

  /** 指定区域是否全部空闲(避开调度员、乘客占位与家属陪护) */
  private cellsFree(col: number, row: number, w: number, h: number): boolean {
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) {
        if (r === DISPATCHER_ROW && c === DISPATCHER_COL) return false;
        for (const p of this.placements.values()) {
          if (c >= p.col && c < p.col + p.w && r >= p.row && r < p.row + p.h) return false;
        }
        for (const cp of this.companions.values()) {
          if (c === cp.col && r === cp.row) return false;
        }
      }
    }
    return true;
  }

  /** 找空位:优先门口(患者家属爱呆在门口) */
  private findSpot(kind: Task['kind']): { col: number; row: number } | null {
    const { w, h } = this.gridOf(kind);
    for (let row = 0; row + h <= GRID_ROWS; row++) {
      for (let col = 0; col + w <= GRID_COLS; col++) {
        if (this.cellsFree(col, row, w, h)) return { col, row };
      }
    }
    return null;
  }

  /** 上车时确定角色固有性格:决定问话回复与是否服从重排指令 */
  private pickPersonality(kind: Task['kind']): Task['personality'] {
    if (kind === 'bed' || kind === 'stretcher') return 'ignore';
    if (kind === 'wheelchair') return Math.random() < 0.5 ? 'teller' : 'babbling';
    const r = Math.random();
    return r < 0.7 ? 'teller' : r < 0.85 ? 'grumpy' : 'mute';
  }

  /** 自然重排:人尽可能往深处走,填满电梯(病床与阿巴阿巴患者保持原位) */
  private repack() {
    const aboard = this.tasks
      .filter((t) => t.status === 'aboard')
      .sort((a, b) => a.id - b.id);
    const next = new Map<number, { col: number; row: number; w: number; h: number }>();
    // 1) 病床/担架与阿巴阿巴患者保持原位
    for (const t of aboard) {
      if (t.kind === 'bed' || t.kind === 'stretcher' || t.personality === 'babbling') {
        const p = this.placements.get(t.id);
        if (p) next.set(t.id, p);
      }
    }
    this.placements = next;
    // 2) 轮椅后优先
    for (const t of aboard) {
      if (t.kind !== 'wheelchair') continue;
      outer: for (let row = GRID_ROWS - 2; row >= 0; row--) {
        for (let col = 0; col + 2 <= GRID_COLS; col++) {
          if (this.cellsFree(col, row, 2, 2)) {
            this.placements.set(t.id, { col, row, w: 2, h: 2 });
            break outer;
          }
        }
      }
    }
    // 3) 站立后优先(填满深处)
    for (const t of aboard) {
      if (t.kind !== 'stand') continue;
      outer: for (let row = GRID_ROWS - 1; row >= 0; row--) {
        for (let col = 0; col < GRID_COLS; col++) {
          if (this.cellsFree(col, row, 1, 1)) {
            this.placements.set(t.id, { col, row, w: 1, h: 1 });
            break outer;
          }
        }
      }
    }
    // 4) 家属陪护后优先
    const compNext = new Map<number, { col: number; row: number }>();
    for (const t of aboard) {
      if (!t.companion) continue;
      outer: for (let row = GRID_ROWS - 1; row >= 0; row--) {
        for (let col = 0; col < GRID_COLS; col++) {
          if (this.cellsFree(col, row, 1, 1)) {
            compNext.set(t.id, { col, row });
            break outer;
          }
        }
      }
    }
    this.companions = compNext;
  }

  /**
   * 指令重排(「往里走走」/「靠右站站」):不一定对所有人都生效——
   * 多数乘客配合挪动,少数不听;病床/担架与阿巴阿巴患者永远原地不动。
   * mode 'deep' 往深处走(腾出门口),'right' 尽量靠右站(腾出左列给病床)。
   */
  private repackByCommand(mode: 'deep' | 'right') {
    const aboard = this.tasks
      .filter((t) => t.status === 'aboard')
      .sort((a, b) => a.id - b.id);
    const next = new Map<number, { col: number; row: number; w: number; h: number }>();
    // 1) 固定位:病床/担架、阿巴阿巴患者与不配合的乘客保持原位
    const refusedIds = new Set<number>();
    for (const t of aboard) {
      const stays =
        t.kind === 'bed' ||
        t.kind === 'stretcher' ||
        t.personality === 'babbling' ||
        Math.random() >= REPACK_COMPLY;
      if (stays) {
        refusedIds.add(t.id);
        const p = this.placements.get(t.id);
        if (p) next.set(t.id, p);
      }
    }
    this.placements = next;
    // 2) 轮椅
    for (const t of aboard) {
      if (t.kind !== 'wheelchair' || next.has(t.id)) continue;
      const spot = this.repackSpot(mode, GRID_COLS - 2, GRID_ROWS - 2, 2, 2);
      if (spot) this.placements.set(t.id, { col: spot.col, row: spot.row, w: 2, h: 2 });
    }
    // 3) 站立
    for (const t of aboard) {
      if (t.kind !== 'stand' || next.has(t.id)) continue;
      const spot = this.repackSpot(mode, GRID_COLS - 1, GRID_ROWS - 1, 1, 1);
      if (spot) this.placements.set(t.id, { col: spot.col, row: spot.row, w: 1, h: 1 });
    }
    // 4) 家属陪护(同样配合概率;不配合的留在原位)
    const compNext = new Map<number, { col: number; row: number }>();
    for (const t of aboard) {
      if (!t.companion) continue;
      if (Math.random() >= REPACK_COMPLY) {
        const old = this.companions.get(t.id);
        if (old) compNext.set(t.id, old);
        continue;
      }
      const spot = this.repackSpot(mode, GRID_COLS - 1, GRID_ROWS - 1, 1, 1);
      if (spot) compNext.set(t.id, spot);
    }
    this.companions = compNext;
    // 3) 反馈:不配合的乘客各自头顶气泡解释(病床/担架原地不动是常态,不提示)
    for (const t of aboard) {
      if (!refusedIds.has(t.id) || t.kind === 'bed' || t.kind === 'stretcher') continue;
      const text =
        t.personality === 'babbling'
          ? '🤤 阿巴阿巴…'
          : REFUSE_LINES[Math.floor(Math.random() * REFUSE_LINES.length)];
      this.bubble(t.id, text);
    }
  }

  /** 指令重排的候选格顺序:deep 行主序(先深后浅);right 列主序(先右后左,列内先深后浅) */
  private repackSpot(
    mode: 'deep' | 'right',
    maxCol: number,
    maxRow: number,
    w: number,
    h: number,
  ): { col: number; row: number } | null {
    if (mode === 'right') {
      for (let col = maxCol; col >= 0; col--) {
        for (let row = maxRow; row >= 0; row--) {
          if (this.cellsFree(col, row, w, h)) return { col, row };
        }
      }
      return null;
    }
    for (let row = maxRow; row >= 0; row--) {
      for (let col = 0; col <= maxCol; col++) {
        if (this.cellsFree(col, row, w, h)) return { col, row };
      }
    }
    return null;
  }

  /** 供 3D 场景读取的网格占位 */
  getPlacements(): ReadonlyMap<number, { col: number; row: number; w: number; h: number }> {
    return this.placements;
  }

  /** 家属陪护占位(任务 id → 单元格) */
  getCompanionPlacements(): ReadonlyMap<number, { col: number; row: number }> {
    return this.companions;
  }

  /** 送达结算 */
  private deliver(t: Task) {
    // 挑剔家属未微笑服务就到站离开:被拍照发网上,当场开除
    // (先清理状态与占位,避免模型残留;结算延迟到其完全离开电梯的离梯动画之后)
    if (t.flavor === 'critic' && this.criticTask === t) {
      this.criticTask = null;
      t.status = 'delivered';
      this.elevator.used = Math.max(1, this.elevator.used - PASSENGER_SIZE[t.kind] - (t.companion ? 1 : 0));
      this.placements.delete(t.id);
      this.companions.delete(t.id);
      this.criticFireDelay = 1.5;
      return;
    }
    if (this.criticTask === t) this.criticTask = null;
    t.status = 'delivered';
    this.elevator.used = Math.max(1, this.elevator.used - PASSENGER_SIZE[t.kind] - (t.companion ? 1 : 0));
    this.placements.delete(t.id);
    this.companions.delete(t.id);
    this.statDone++;
    this.waitSum += t.wait;
    if (t.type === 'emergency') {
      this.statEmgSuccess++;
      this.satisfaction = Math.min(100, this.satisfaction + 2);
    } else {
      this.satisfaction = Math.min(100, this.satisfaction + 1);
    }
    sfx.success();
    this.notify();
  }

  private addTask(spec: TaskSpec) {
    const task: Task = {
      id: this.idSeq++,
      type: spec.type,
      title: spec.title,
      text: spec.text,
      fromFloor: spec.fromFloor,
      targetFloor: spec.targetFloor,
      kind: spec.kind,
      status: 'pending',
      createdAt: Date.now() / 1000,
      deadline: spec.deadline,
      wait: 0,
      flavor: spec.flavor,
      callDelay: spec.callDelay,
      callSent: false,
      callSentAt: 0,
      answered: false,
      answeredAt: 0,
      companion: spec.companion,
      companionKind: spec.companionKind,
      noCall: spec.noCall,
    };
    this.tasks.push(task);
    this.statTotal++;
    if (spec.type === 'emergency') this.statEmgTotal++;
    // 卧床病人必定电话通知:即使生成器误设 noCall 也忽略,强制走来电流程
    const noCall = spec.noCall && spec.kind !== 'bed' && spec.kind !== 'stretcher';
    if (noCall) {
      // 站立患者/家属不会打电话:自己按电梯(自动登记厅外呼叫 ▲/▼)
      const dir = spec.targetFloor > spec.fromFloor ? 'up' : 'down';
      if (!this.elevator.lights.has(spec.fromFloor)) {
        this.elevator.press(spec.fromFloor);
      }
      this.elevator.hallCalls.set(spec.fromFloor, dir);
      this.familyLights.add(spec.fromFloor);
      this.familyLightOwner.set(spec.fromFloor, task.id);
      this.notify();
    } else if (spec.callDelay > 0) {
      // 工勤来电来得晚(电话迟迟才到)
    } else {
      this.sendCall(task);
    }
  }

  /** 电话送达玩家 */
  private sendCall(t: Task) {
    t.callSent = true;
    t.callSentAt = Date.now() / 1000;
    this.callSeq++;
    if (t.type === 'emergency') sfx.alarm();
    else if (t.flavor === 'bang') sfx.angry();
    else sfx.ring();
    this.notify();
  }

  private failTask(t: Task) {
    if (this.criticTask === t) this.criticTask = null;
    t.status = 'failed';
    this.statFailed++;
    this.satisfaction = Math.max(0, this.satisfaction - SAT_EXPIRED_PENALTY);
    sfx.fail();
    this.notify();
  }

  private finishDay(endedEarly = false, reason?: string) {
    this.phase = 'result';
    sfx.dayEnd();
    this.result = this.computeResult(reason, endedEarly);
    this.notify();
  }

  private computeResult(endReason?: string, endedEarly = false): ResultStats {
    let grade = 'C';
    let gradeName = '需要加油';
    if (!endedEarly) {
      // 提前收工不计算评级
      const emgRate = this.statEmgTotal > 0 ? this.statEmgSuccess / this.statEmgTotal : 1;
      const compRate = this.statTotal > 0 ? this.statDone / this.statTotal : 1;
      const pct = 0.45 * (this.satisfaction / 100) + 0.35 * emgRate + 0.2 * compRate;
      if (pct >= 0.85) {
        grade = 'S';
        gradeName = '金牌调度员';
      } else if (pct >= 0.7) {
        grade = 'A';
        gradeName = '优秀调度员';
      } else if (pct >= 0.55) {
        grade = 'B';
        gradeName = '合格调度员';
      }
    } else {
      // 提前收工 / 被开除:不评级,大标题按提示文案区分
      grade = '-';
      gradeName = endReason?.startsWith('被开除') ? '被开除了' : '提前下班';
    }
    return {
      satisfaction: Math.round(this.satisfaction),
      grade,
      gradeName,
      total: this.statTotal,
      done: this.statDone,
      failed: this.statFailed,
      emgTotal: this.statEmgTotal,
      emgSuccess: this.statEmgSuccess,
      avgWait: this.statDone > 0 ? this.waitSum / this.statDone : 0,
      endTime: this.dayText(),
      endedEarly,
      endReason,
    };
  }

  /** 剩余时间倒计时(mm:ss,按难度实际分钟,准确到秒) */
  dayText(): string {
    if (this.overtime) return '00:00';
    const elapsed = Date.now() / 1000 - this.startReal;
    const remain = Math.max(0, Math.round(this.diff.dayMinutes * 60 - elapsed));
    const m = Math.floor(remain / 60);
    const sec = remain % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  // ─── 快照 ────────────────────────────────────────────────────
  getSnapshot(): Snapshot {
    const ev = this.elevator;
    const views: TaskView[] = this.tasks
      .slice(-30)
      .map((t) => ({
        id: t.id,
        type: t.type,
        title: t.title,
        text: t.text,
        fromFloor: t.fromFloor,
        targetFloor: t.targetFloor,
        kind: t.kind,
        status: t.status,
        wait: Math.round(t.wait),
        deadline: t.deadline,
        remaining: t.type === 'emergency' && t.status === 'pending' ? Math.max(0, Math.round(t.deadline - t.wait)) : null,
        flavor: t.flavor,
        callSent: t.callSent,
        callSentAt: t.callSentAt,
        answered: t.answered,
        answeredAt: t.answeredAt,
        companion: t.companion,
        companionKind: t.companionKind,
        recorded: this.isRecorded(t),
      }))
      .reverse()
      .slice(0, 12);

    return {
      phase: this.phase,
      dayText: this.dayText(),
      overtime: this.overtime,
      satisfaction: Math.round(this.satisfaction),
      total: this.statTotal,
      done: this.statDone,
      emgTotal: this.statEmgTotal,
      emgSuccess: this.statEmgSuccess,
      error: this.lastError,
      simulate: this.diff.simulate,
      latestCallId: this.callSeq,
      elevator: {
        floor: ev.floor,
        posY: ev.posY,
        doorOpen: ev.doorOpen,
        doorState: ev.doorState,
        moving: ev.moving,
        direction: ev.direction,
        lights: [...ev.lights],
        used: ev.used,
        familyBlocked: this.familyTask !== null,
      },
      tasks: views,
      reminder: {
        ready: this.remindCooldown <= 0,
        cooldown: Math.ceil(this.remindCooldown),
      },
      muted: this.muted,
      eventMsg: this.eventMsg,
      result: this.result,
    };
  }

  // 供渲染使用
  getTasks(): Task[] {
    return this.tasks;
  }

  hasEmergencyPending(): boolean {
    return this.tasks.some((t) => t.type === 'emergency' && t.status === 'pending');
  }

  /** 是否有未接听来电 */
  hasUnreadCall(): boolean {
    return this.tasks.some((t) => t.callSent && !t.answered && t.status === 'pending');
  }

  /** 提醒按钮冷却结束 */
  get remindReady(): boolean {
    return this.remindCooldown <= 0;
  }

  /** 指令按钮共用冷却剩余秒数(向上取整,供 3D 按钮显示) */
  get remindCooldownSec(): number {
    return Math.ceil(this.remindCooldown);
  }

  /** 家属堵门进行中 */
  get familyActive(): boolean {
    return this.familyTask !== null;
  }

  /** 挑剔家属在梯上(拟真模式,到站前需微笑服务) */
  get criticActive(): boolean {
    return this.criticTask !== null;
  }

  floorName(floor: number): string {
    return FLOOR_NAME(floor);
  }

  get flashPhase(): number {
    return this.flash;
  }

  private render() {
    this.scene3d?.renderFrame();
  }
}

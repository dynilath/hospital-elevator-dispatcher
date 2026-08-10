// ─── 引擎逻辑无头验证(tsx 运行) ─────────────────────────────────
import { GameEngine } from '../src/engine/Engine';
import { Spawner } from '../src/engine/spawner';

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) failed++;
}

// ── 1.5 提前按「收工」:不计算评级,标记提前下班 ─────────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  eng.endDay();
  const r = eng.getSnapshot().result;
  check('提前收工标记 endedEarly', r?.endedEarly === true, JSON.stringify(r));
  check('提前收工不计算评级', r?.grade === '-' && r?.gradeName === '提前下班', `grade=${r?.grade} name=${r?.gradeName}`);
  check('提前收工提示文案', r?.endReason === '提前收工:你怎么能提前下班呢', r?.endReason ?? '');
}

// ── 2. 家属堵门:无限期堵门,不赶走电梯无法运行 ───────────────────
{
  const eng = new GameEngine({ floors: 15, emergencyGap: 38, dayMinutes: 5, simulate: true });
  const e = eng as unknown as {
    tasks: unknown[];
    processDoors(): void;
    update(dt: number): void;
    familyTask: unknown;
  };
  const now = Date.now() / 1000;
  e.tasks.push({
    id: 9001, type: 'emergency', title: '手术室', text: '家属跟车', fromFloor: 6, targetFloor: 7,
    kind: 'stretcher', status: 'aboard', createdAt: now, deadline: 75, wait: 3,
    flavor: 'family', callDelay: 0, callSent: true, callSentAt: now,
  });
  // 电梯到 7F 开门
  eng.elevator.floor = 7;
  eng.elevator.posY = 7;
  eng.elevator.doorState = 'open';
  eng.elevator.doorTimer = 5;
  eng.elevator.moving = false;
  e.processDoors();
  check('家属堵门开始', e.familyTask !== null, String(e.familyTask !== null));
  // 推进 7 秒:不按「别堵门!」→ 不送达、不超时、门保持开启
  for (let i = 0; i < 140; i++) e.update(0.05);
  const task = e.tasks[0] as { status: string };
  check('堵门无超时:任务仍未送达', task.status === 'aboard', task.status);
  check('堵门持续中(familyTask 未清)', e.familyTask !== null);
  check(
    '电梯门保持开启',
    eng.elevator.doorState === 'open' || eng.elevator.doorState === 'opening',
    eng.elevator.doorState,
  );
  // 按「别堵门!」→ 立即送达
  eng.pressRemind();
  check('按别堵门后立即送达', (e.tasks[0] as { status: string }).status === 'delivered');
}

// ── 3. 家属堵门:按提醒按钮立即劝离 ─────────────────────────────
{
  const eng = new GameEngine({ floors: 15, emergencyGap: 38, dayMinutes: 5, simulate: true });
  const e = eng as unknown as {
    tasks: unknown[];
    processDoors(): void;
    update(dt: number): void;
    familyTask: unknown;
  };
  const now = Date.now() / 1000;
  e.tasks.push({
    id: 9002, type: 'emergency', title: '急诊大厅', text: '家属跟车', fromFloor: 1, targetFloor: 7,
    kind: 'stretcher', status: 'aboard', createdAt: now, deadline: 85, wait: 5,
    flavor: 'family', callDelay: 0, callSent: true, callSentAt: now,
  });
  eng.elevator.floor = 7;
  eng.elevator.posY = 7;
  eng.elevator.doorState = 'open';
  eng.elevator.doorTimer = 5;
  eng.elevator.moving = false;
  e.processDoors();
  check('堵门已开始(任务2)', e.familyTask !== null);
  eng.pressRemind();
  const task = e.tasks[0] as { status: string };
  check('提醒后立即送达', task.status === 'delivered');
}

// ── 3.5 取消家属灯 → 角色头顶气泡(引擎通知场景定位角色) ────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const calls: { taskId: number; text: string }[] = [];
  eng.attachScene({
    renderFrame() {},
    showBubbleForTask(taskId: number, text: string) {
      calls.push({ taskId, text });
      return true;
    },
  });
  const rnd = Math.random;
  // 家属(任务 77)按下 3F → 玩家取消 → 气泡挂在任务 77 头上
  eng.familyPressButton(3, 77);
  check('家属按键登记 3F', eng.elevator.lights.has(3));
  Math.random = () => 0.1; // 命中"斥责"分支(满意度 -3)
  eng.pressFloor(3);
  Math.random = rnd;
  check(
    '取消灯反馈走角色气泡',
    calls.length === 1 && calls[0].taskId === 77 && calls[0].text.includes('怎么给我取消了'),
    JSON.stringify(calls),
  );
  check('气泡成功时不弹顶部消息', eng.getSnapshot().eventMsg === null);
  // 无来源任务(旧调用/无头环境) → 退回顶部消息
  eng.familyPressButton(4);
  Math.random = () => 0.1;
  eng.pressFloor(4);
  Math.random = rnd;
  check('无来源任务退回顶部消息', eng.getSnapshot().eventMsg !== null);
}

// ── 6. 恶作剧电话:到层无人 → 识破扣分;有真乘客则无事 ───────────
{
  const eng = new GameEngine({ floors: 10, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as { tasks: unknown[]; processDoors(): void };
  const now = Date.now() / 1000;
  e.tasks.push({
    id: 1, type: 'normal', title: '匿名来电', text: '8F 有人要下楼', fromFloor: 8, targetFloor: 8,
    kind: 'stand', status: 'pending', createdAt: now, deadline: 0, wait: 0,
    flavor: 'prank', callDelay: 0, callSent: true, callSentAt: now,
  });
  eng.elevator.floor = 8;
  eng.elevator.doorState = 'open';
  eng.elevator.doorTimer = 5;
  eng.elevator.moving = false;
  e.processDoors();
  const task = e.tasks[0] as { status: string; text: string };
  check('恶作剧被识破', task.status === 'delivered' && task.text.includes('被耍了'));
  check('恶作剧不扣满意度', eng.getSnapshot().satisfaction === 100, `sat=${eng.getSnapshot().satisfaction}`);
}

// ── 6.5 领导急召:上梯前每秒 −1 满意度;上梯后不再衰减 ────────────
{
  const eng = new GameEngine({ floors: 10, emergencyGap: 55, dayMinutes: 5, simulate: false });
  const e = eng as unknown as {
    tasks: unknown[];
    overtime: boolean;
    update(dt: number): void;
    processDoors(): void;
  };
  e.overtime = true; // 停掉任务生成,保证衰减确定性
  const now = Date.now() / 1000;
  e.tasks.push({
    id: 5001, type: 'normal', title: '院办', text: '领导急召', fromFloor: 1, targetFloor: 8,
    kind: 'stand', status: 'pending', createdAt: now, deadline: 0, wait: 0,
    flavor: 'vip', callDelay: 0, callSent: true, callSentAt: now,
  });
  e.update(3); // 等待 3 秒
  check('领导急召上梯前每秒 −1', eng.getSnapshot().satisfaction === 97, `sat=${eng.getSnapshot().satisfaction}`);
  // 上梯后再等 3 秒 → 不再衰减
  eng.elevator.doorState = 'open';
  eng.elevator.doorTimer = 5;
  eng.elevator.moving = false;
  e.processDoors();
  check('领导已上梯', (e.tasks[0] as { status: string }).status === 'aboard');
  e.update(3);
  check('上梯后不再衰减', eng.getSnapshot().satisfaction === 97, `sat=${eng.getSnapshot().satisfaction}`);
}

// ── 7. 工勤拍门:呼叫延迟送达 ──────────────────────────────────
{
  const eng = new GameEngine({ floors: 10, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as { tasks: unknown[]; update(dt: number): void; sendCall(t: unknown): void };
  const now = Date.now() / 1000;
  e.tasks.push({
    id: 2, type: 'normal', title: '放射科', text: '拍门半天', fromFloor: 4, targetFloor: 1,
    kind: 'stand', status: 'pending', createdAt: now - 20, deadline: 0, wait: 0,
    flavor: 'bang', callDelay: 18, callSent: false, callSentAt: 0,
  });
  e.update(0.05); // 触发延迟来电检查(createdAt 已过 20s > callDelay 18)
  const task = e.tasks[0] as { callSent: boolean };
  check('延迟来电送达', task.callSent);
}

// ── 8. 拟真消息不留痕(引擎不删除,由 UI 隐藏) ──────────────────
{
  const eng = new GameEngine({ floors: 15, emergencyGap: 38, dayMinutes: 5, simulate: true });
  check('simulate 标记正确', eng.getSnapshot().simulate === true);
  const normal = new GameEngine({ floors: 6, emergencyGap: 78, dayMinutes: 5, simulate: false });
  check('非拟真标记正确', normal.getSnapshot().simulate === false);
}

// ── 9. 电梯速度曲线:启动慢、巡航快、减速平层 ────────────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const ev = eng.elevator;
  // 按 1F → 8F,采样速度
  ev.press(8);
  const speeds: number[] = [];
  let lastPos = ev.posY;
  for (let i = 0; i < 600; i++) {
    (eng as unknown as { update(dt: number): void }).update(0.05);
    if (ev.moving) {
      speeds.push(ev.speed);
      lastPos = ev.posY;
    } else if (ev.doorState === 'opening' || ev.doorState === 'open') {
      break;
    }
  }
  const maxSpeed = Math.max(...speeds);
  const avgEarly = speeds.slice(0, 20).reduce((s, v) => s + v, 0) / 20;
  const avgLate = speeds.slice(-20).reduce((s, v) => s + v, 0) / 20;
  check('有速度曲线(最大速度>1.5)', maxSpeed > 1.5, `max=${maxSpeed.toFixed(2)}`);
  check('加速段由慢到快', avgLate > avgEarly * 1.5, `early=${avgEarly.toFixed(2)} late=${avgLate.toFixed(2)}`);
  check('到站自动开门', eng.getSnapshot().elevator.doorState === 'open' || eng.getSnapshot().elevator.doorState === 'opening');
}

// ── 10. 3×4 格子容量:调度员占 1 格(总 12 格),门口不硬阻断 ─────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as { tasks: unknown[]; processDoors(): void };
  const now = Date.now() / 1000;
  const mk = (id: number, kind: 'stand' | 'wheelchair' | 'bed') => ({
    id, type: 'normal', title: 'x', text: 'x', fromFloor: 1, targetFloor: 2, kind,
    status: 'pending', createdAt: now, deadline: 0, wait: 0, callDelay: 0, callSent: true, callSentAt: now, answered: false, answeredAt: 0,
  });
  // 1 轮椅(4 格) + 7 站立(7 格) = 11 + 调度员 1 = 12,满载;门口被占也能继续上
  e.tasks.push(mk(1, 'wheelchair'));
  for (let i = 2; i <= 8; i++) e.tasks.push(mk(i, 'stand'));
  eng.elevator.doorState = 'open';
  eng.elevator.doorTimer = 5;
  eng.elevator.moving = false;
  e.processDoors();
  const st = e.tasks as { id: number; status: string }[];
  check('全部上梯(门口不阻断)', st.every((t) => t.status === 'aboard'), st.map((t) => t.status).join(','));
  check('容量占用 12 格(含调度员)', eng.elevator.used === 12, `used=${eng.elevator.used}`);
  // 再来一个站立 → 容量不足,留在原地但不阻止电梯运行
  e.tasks.push(mk(9, 'stand'));
  e.processDoors();
  check('超载乘客留在本层(不阻断)', (e.tasks[8] as { status: string }).status === 'pending');
  // 电梯门正常关闭(未因放不下而保持开门)
  check('电梯不被阻断', eng.elevator.doorState === 'open' || eng.elevator.doorState === 'closing' || eng.elevator.doorState === 'closed');
}

// ── 11. 家属陪护:占 1 格,需要额外空位 ──────────────────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as { tasks: unknown[]; processDoors(): void };
  const now = Date.now() / 1000;
  const mk = (id: number, kind: string, companion = false) => ({
    id, type: 'normal', title: 'x', text: 'x', fromFloor: 1, targetFloor: 2, kind, companion,
    status: 'pending', createdAt: now, deadline: 0, wait: 0, callDelay: 0, callSent: true, callSentAt: now, answered: false, answeredAt: 0,
  });
  // 陪护轮椅:4 + 家属 1 = 5 格
  e.tasks.push(mk(1, 'wheelchair', true));
  eng.elevator.doorState = 'open';
  eng.elevator.doorTimer = 5;
  eng.elevator.moving = false;
  e.processDoors();
  check('陪护轮椅上梯(占 5 格)', (e.tasks[0] as { status: string }).status === 'aboard');
  check('容量 6 格(含调度员)', eng.elevator.used === 6, `used=${eng.elevator.used}`);
  check('家属陪护有占位', eng.getCompanionPlacements().size === 1);
  // 填满后陪护病人放不下 → 留在原地(不阻断)
  for (let i = 2; i <= 7; i++) e.tasks.push(mk(i, 'stand')); // 6 个站立 = 11 格 + 调度员 = 12
  e.processDoors();
  check('剩余站立全部上梯', (e.tasks as { status: string }[]).slice(1).every((t) => t.status === 'aboard'));
  e.tasks.push(mk(8, 'wheelchair', true));
  e.processDoors();
  check('无空位陪护病人留在原地', (e.tasks[7] as { status: string }).status === 'pending');
}

// ── 12. 家属自己按按钮 + 被取消的随机反应 ───────────────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  // 家属按下 3F
  eng.familyPressButton(3);
  check('家属按键登记 3F', eng.elevator.lights.has(3));
  // 玩家取消 → 三种随机反应之一:斥责(满意度-3)/告知楼层/重新按键
  const before = eng.getSnapshot().satisfaction;
  eng.pressFloor(3);
  const after = eng.getSnapshot();
  const scolded = after.satisfaction === before - 3;
  const told = after.eventMsg !== null;
  const repressed = eng.elevator.lights.has(3);
  check('取消触发随机反应', scolded || told || repressed, `scolded=${scolded} told=${told} repressed=${repressed}`);
  // 家属按已存在的需求不会取消
  eng.elevator.lights.add(5);
  eng.familyPressButton(5);
  check('家属不取消已有需求', eng.elevator.lights.has(5));
}

// ── 11. 方向调度:下行中按上行需求,先清空下行再翻转 ─────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as { update(dt: number): void };
  const ev = eng.elevator;
  ev.posY = 5;
  ev.floor = 5;
  ev.press(3); // 下行需求
  ev.press(6); // 上行需求(应延后)
  // 运行期间游戏会持续生成任务,站立患者/家属会自己按电梯按钮(真实行为),
  // 电梯顺路服务这些灯——因此只统计本测试登记的 3F/6F 停靠
  const visited: number[] = [];
  let lastOpen = -1;
  for (let i = 0; i < 3000 && visited.length < 2; i++) {
    e.update(0.05);
    if (ev.doorState === 'open' && ev.floor !== lastOpen) {
      lastOpen = ev.floor;
      if (ev.floor === 3 || ev.floor === 6) visited.push(ev.floor);
    }
  }
  check('下行优先:先到 3F 再到 6F', visited[0] === 3 && visited[1] === 6, visited.join('->'));
  // 本测试登记的需求最终必然被服务(家属新按的灯可能还在服务中,不影响判定)
  for (let i = 0; i < 600 && (ev.lights.has(3) || ev.lights.has(6)); i++) {
    e.update(0.05);
  }
  check('3F/6F 需求已服务完毕', !ev.lights.has(3) && !ev.lights.has(6), `lights=[${[...ev.lights]}]`);
}

// ── 12. 再按一次按钮取消需求 ───────────────────────────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const ev = eng.elevator;
  check('登记 3F', ev.press(3) && ev.lights.has(3));
  check('再按取消 3F', ev.press(3) && !ev.lights.has(3) && ev.lights.size === 0);
}

// ── 13. 接听并看完完整内容才记录到笔记本 ───────────────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as { tasks: unknown[] };
  const now = Date.now() / 1000;
  const t = {
    id: 42, type: 'normal', title: '放射科', text: '这是一条长度超过六百毫秒打字时间的测试消息内容',
    fromFloor: 3, targetFloor: 1, kind: 'stand', status: 'pending', createdAt: now,
    deadline: 0, wait: 0, callDelay: 0, callSent: true, callSentAt: now - 0.1, answered: false,
  };
  e.tasks.push(t);
  check('未接听 → 不记录', eng.isRecorded(t as never) === false);
  eng.answerCall(42);
  check('刚接听打字未开始 → 不记录', eng.isRecorded(t as never) === false);
  const rpc = (t as { revealMsPerChar?: number }).revealMsPerChar ?? 0;
  check('普通来电打字速度随机 100~200ms/字', rpc >= 100 && rpc <= 200, `rpc=${rpc}`);
  (t as { answeredAt: number }).answeredAt = now - 15; // 接听后已过 15 秒(最慢 200ms/字 × 22 字≈4.4s),打字早已完成
  check('接听且看完 → 记录', eng.isRecorded(t as never) === true);
  const snap = eng.getSnapshot();
  check('快照 recorded 正确', snap.tasks.find((x) => x.id === 42)?.recorded === true);
}

// ── 13b. 领导急召(vip)打字速度固定 200ms/字 ─────────────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as { tasks: unknown[] };
  const now = Date.now() / 1000;
  const t = {
    id: 43, type: 'normal', title: '院办', text: '我是张院长!立刻到急诊大厅接我,耽误不起!',
    fromFloor: 1, targetFloor: 5, kind: 'stand', status: 'pending', createdAt: now,
    deadline: 0, wait: 0, callDelay: 0, callSent: true, callSentAt: now - 0.1, answered: false, flavor: 'vip',
  };
  e.tasks.push(t);
  eng.answerCall(43);
  check('领导来电打字速度固定 200ms/字', (t as { revealMsPerChar?: number }).revealMsPerChar === 200, `rpc=${(t as { revealMsPerChar?: number }).revealMsPerChar}`);
}

// ── 14. 厅外呼叫:▲/▼ 方向区别,顺向优先跳过反向呼叫 ─────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const ev = eng.elevator;
  ev.posY = 4;
  ev.floor = 4;
  // 家属在 6F 按"下行"(想去下面);玩家按 5F(上行)
  eng.familyHallPress(6, 'down');
  check('厅外呼叫登记(6F 下行)', ev.lights.has(6) && ev.hallCalls.get(6) === 'down');
  ev.press(5);
  const visited: number[] = [];
  let lastOpen = -1;
  for (let i = 0; i < 3000 && visited.length < 2; i++) {
    (eng as unknown as { update(dt: number): void }).update(0.05);
    if (ev.doorState === 'open' && ev.floor !== lastOpen) {
      lastOpen = ev.floor;
      visited.push(ev.floor);
    }
  }
  check('上行先到 5F,反向呼叫反转后服务', visited[0] === 5 && visited[1] === 6, visited.join('->'));
  check('厅外呼叫应答后清除', ev.hallCalls.get(6) === undefined);
  // 玩家取消厅外呼叫 → 家属随机反应
  ev.posY = 4;
  ev.floor = 4;
  eng.familyHallPress(3, 'up');
  const before = eng.getSnapshot().satisfaction;
  eng.pressFloor(3);
  const after = eng.getSnapshot();
  check('取消厅外呼叫触发反应', after.satisfaction === before - 3 || after.eventMsg !== null || ev.lights.has(3));
}

// ── 15. 倒计时结束进入加班:不再生成新任务,所有角色完成才结束 ────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as { tasks: unknown[]; daySeconds: number; update(dt: number): void };
  e.daySeconds = 17 * 3600 - 1;
  const before = e.tasks.length;
  e.update(0.05);
  check('倒计时结束进入加班', eng.getSnapshot().overtime === true);
  e.update(5);
  check('加班阶段不再生成新任务', e.tasks.length === before, `before=${before} after=${e.tasks.length}`);
  for (const t of e.tasks) (t as { status: string }).status = 'delivered';
  e.update(0.05);
  check('所有角色完成才结束', eng.getSnapshot().phase === 'result');
}

// ── 16. 站立患者不打来电话,自己按电梯(厅外呼叫,内部按钮也亮) ──
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as { addTask(spec: unknown): void; tasks: unknown[] };
  const spec = {
    type: 'normal', title: '检验科', text: 'x', fromFloor: 2, targetFloor: 1,
    kind: 'stand', deadline: 0, callDelay: 0, noCall: true,
  };
  e.addTask(spec);
  const task = e.tasks[0] as { callSent: boolean };
  check('站立患者不打电话', task.callSent === false);
  check('自动登记厅外呼叫(下行)', eng.elevator.hallCalls.get(2) === 'down');
  check('内部按钮同步亮起', eng.elevator.lights.has(2));
  // noCall 任务不得被「延迟来电」逻辑补发来电(既有 bug 回归)
  e.update(0.1);
  check('update 后仍无来电', task.callSent === false, `callSent=${task.callSent}`);
}

// ── 17. 指令重排(往里走走):病床与阿巴阿巴患者永远不动 ────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as {
    tasks: unknown[];
    placements: Map<number, { col: number; row: number; w: number; h: number }>;
    repackByCommand(mode: 'deep' | 'right'): void;
  };
  const mk = (id: number, kind: string, personality: string) => ({
    id, type: 'normal', title: 'x', text: 'x', fromFloor: 1, targetFloor: 2, kind,
    status: 'aboard', createdAt: 0, deadline: 0, wait: 0, callDelay: 0, callSent: true, callSentAt: 0,
    answered: false, answeredAt: 0, personality,
  });
  // 病床(2×4)占左列全部行;阿巴阿巴站(2,0);正常站立(2,1)
  const bed = mk(1, 'bed', 'ignore');
  const babbling = mk(2, 'stand', 'babbling');
  const teller = mk(3, 'stand', 'teller');
  e.tasks.push(bed, babbling, teller);
  e.placements.set(1, { col: 0, row: 0, w: 2, h: 4 });
  e.placements.set(2, { col: 2, row: 0, w: 1, h: 1 });
  e.placements.set(3, { col: 2, row: 1, w: 1, h: 1 });
  const rnd = Math.random;
  Math.random = () => 0; // 全员配合(低于 REPACK_COMPLY 0.7)
  e.repackByCommand('deep');
  const p = e.placements.get(3);
  check('往里走走:病床原地不动', e.placements.get(1)!.col === 0 && e.placements.get(1)!.row === 0);
  check('往里走走:阿巴阿巴患者原地不动', e.placements.get(2)!.col === 2 && e.placements.get(2)!.row === 0);
  check('往里走走:正常乘客往深处走', p?.col === 2 && p?.row === 2, `pos=${p?.col},${p?.row}`);
  Math.random = rnd;
}

// ── 18. 靠右站站:靠右优先 + 两按钮共用冷却 ───────────────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as {
    tasks: unknown[];
    placements: Map<number, { col: number; row: number; w: number; h: number }>;
    repackByCommand(mode: 'deep' | 'right'): void;
  };
  e.tasks.push({
    id: 10, type: 'normal', title: 'x', text: 'x', fromFloor: 1, targetFloor: 2, kind: 'stand',
    status: 'aboard', createdAt: 0, deadline: 0, wait: 0, callDelay: 0, callSent: true, callSentAt: 0,
    answered: false, answeredAt: 0, personality: 'teller',
  });
  e.placements.set(10, { col: 0, row: 0, w: 1, h: 1 });
  const rnd = Math.random;
  Math.random = () => 0; // 配合
  e.repackByCommand('right');
  const p = e.placements.get(10);
  check('靠右站站:优先右列(右列最深处被调度员占则右列顺移)', p?.col === 2 && p?.row === 2, `pos=${p?.col},${p?.row}`);
  // 冷却共用:按完「往里走走」后立刻按「靠右站站」不应再重排
  eng.pressRemind();
  const beforeRow = e.placements.get(10)!.row;
  eng.pressRight();
  check('两按钮共用冷却(冷却中按靠右无效)', e.placements.get(10)!.row === beforeRow);
  Math.random = rnd;
}

// ── 19. 指令重排:乘客不配合时留在原地并给出提示 ──────────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as {
    tasks: unknown[];
    placements: Map<number, { col: number; row: number; w: number; h: number }>;
    repackByCommand(mode: 'deep' | 'right'): void;
  };
  e.tasks.push({
    id: 20, type: 'normal', title: 'x', text: 'x', fromFloor: 1, targetFloor: 2, kind: 'stand',
    status: 'aboard', createdAt: 0, deadline: 0, wait: 0, callDelay: 0, callSent: true, callSentAt: 0,
    answered: false, answeredAt: 0, personality: 'teller',
  });
  e.placements.set(20, { col: 0, row: 0, w: 1, h: 1 });
  const rnd = Math.random;
  Math.random = () => 0.9; // 不配合(≥ REPACK_COMPLY 0.7)
  eng.pressRemind();
  const p = e.placements.get(20);
  check('乘客不配合 → 原地不动', p?.col === 0 && p?.row === 0, `pos=${p?.col},${p?.row}`);
  check('全部不听 → 有提示消息', eng.getSnapshot().eventMsg !== null);
  Math.random = rnd;
}

// ── 19.5 指令重排:不配合的乘客各自头顶气泡(阿巴阿巴带 🤤) ─────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as {
    tasks: unknown[];
    placements: Map<number, { col: number; row: number; w: number; h: number }>;
    companions: Map<number, { col: number; row: number }>;
    repackByCommand(mode: 'deep' | 'right'): void;
  };
  const calls: { taskId: number; text: string }[] = [];
  eng.attachScene({
    renderFrame() {},
    showBubbleForTask(taskId: number, text: string) {
      calls.push({ taskId, text });
      return true;
    },
  });
  const mk = (id: number, kind: string, personality: string) => ({
    id, type: 'normal', title: 'x', text: 'x', fromFloor: 1, targetFloor: 2, kind,
    status: 'aboard', createdAt: 0, deadline: 0, wait: 0, callDelay: 0, callSent: true, callSentAt: 0,
    answered: false, answeredAt: 0, personality,
  });
  // 普通站立(teller) + 阿巴阿巴轮椅(babbling) + 病床(ignore,不动是常态)
  e.tasks.push(mk(21, 'stand', 'teller'), mk(22, 'wheelchair', 'babbling'), mk(23, 'bed', 'ignore'));
  e.placements.set(21, { col: 0, row: 0, w: 1, h: 1 });
  e.placements.set(22, { col: 1, row: 0, w: 2, h: 2 });
  e.placements.set(23, { col: 0, row: 1, w: 2, h: 2 });
  const rnd = Math.random;
  Math.random = () => 0.9; // 都不配合
  e.repackByCommand('deep');
  Math.random = rnd;
  const babbling = calls.find((c) => c.taskId === 22);
  const teller = calls.find((c) => c.taskId === 21);
  const bed = calls.find((c) => c.taskId === 23);
  check('阿巴阿巴患者弹 🤤 气泡', babbling?.text === '🤤 阿巴阿巴…', babbling?.text ?? '无');
  check('普通不配合乘客弹台词气泡', !!teller && teller.text.startsWith('😤'), teller?.text ?? '无');
  check('病床不动是常态,不弹气泡', bed === undefined);
}

// ── 20. 指令重排:不配合的家属陪护留在原位(不消失) ───────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as {
    tasks: unknown[];
    placements: Map<number, { col: number; row: number; w: number; h: number }>;
    companions: Map<number, { col: number; row: number }>;
    repackByCommand(mode: 'deep' | 'right'): void;
  };
  e.tasks.push({
    id: 30, type: 'normal', title: 'x', text: 'x', fromFloor: 1, targetFloor: 2, kind: 'stand',
    status: 'aboard', createdAt: 0, deadline: 0, wait: 0, callDelay: 0, callSent: true, callSentAt: 0,
    answered: false, answeredAt: 0, personality: 'teller', companion: true,
  });
  e.placements.set(30, { col: 0, row: 0, w: 1, h: 1 });
  e.companions.set(30, { col: 1, row: 0 });
  const rnd = Math.random;
  Math.random = () => 0.9; // 乘客与家属都不配合
  e.repackByCommand('deep');
  const c = e.companions.get(30);
  check('不配合的陪护家属留在原位', c?.col === 1 && c?.row === 0, `pos=${c?.col},${c?.row}`);
  const p = e.placements.get(30);
  check('不配合的乘客也留在原位', p?.col === 0 && p?.row === 0, `pos=${p?.col},${p?.row}`);
  Math.random = rnd;
}

// ── 21. 病床带陪护:家属单独占一格,不在病床里 ────────────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as { tasks: unknown[]; processDoors(): void };
  const now = Date.now() / 1000;
  e.tasks.push({
    id: 41, type: 'normal', title: 'x', text: 'x', fromFloor: 1, targetFloor: 2, kind: 'bed',
    status: 'pending', createdAt: now, deadline: 0, wait: 0, callDelay: 0, callSent: true, callSentAt: now,
    companion: true,
  });
  eng.elevator.doorState = 'open';
  eng.elevator.doorTimer = 5;
  eng.elevator.moving = false;
  e.processDoors();
  const bedP = eng.getPlacements().get(41);
  const compP = eng.getCompanionPlacements().get(41);
  check('病床带陪护上梯', bedP !== undefined && compP !== undefined);
  const bedCells = new Set<string>();
  for (let r = bedP!.row; r < bedP!.row + bedP!.h; r++) {
    for (let c = bedP!.col; c < bedP!.col + bedP!.w; c++) bedCells.add(`${c},${r}`);
  }
  check(
    '家属单独占一格(不在病床内)',
    compP ? !bedCells.has(`${compP.col},${compP.row}`) : false,
    `bed=${bedP?.col},${bedP?.row} comp=${compP?.col},${compP?.row}`,
  );
}

// ── 22. 电梯内只有病床时按指令:无提示(病床不动是常态) ────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as {
    tasks: unknown[];
    placements: Map<number, { col: number; row: number; w: number; h: number }>;
  };
  e.tasks.push({
    id: 50, type: 'normal', title: 'x', text: 'x', fromFloor: 1, targetFloor: 2, kind: 'bed',
    status: 'aboard', createdAt: 0, deadline: 0, wait: 0, callDelay: 0, callSent: true, callSentAt: 0,
    answered: false, answeredAt: 0, personality: 'ignore',
  });
  e.placements.set(50, { col: 0, row: 0, w: 2, h: 4 });
  eng.pressRemind();
  check('只有病床时按指令无提示', eng.getSnapshot().eventMsg === null);
  check('病床保持原位', e.placements.get(50)!.row === 0 && e.placements.get(50)!.col === 0);
}

// ── 23. 放射科任务楼层与地图一致(3F,而非 CT 层 4F) ──────────────
{
  const spawner = new Spawner();
  // 用固定随机序列驱动 makeCall 命中指定模板:
  // [maskedName×3, roll≥0.42(跳过剧情电话), pick(templates), pickKind]
  const run = (seq: number[]) => {
    const orig = Math.random;
    let i = 0;
    Math.random = () => seq[i++ % seq.length];
    try {
      return spawner.makeCall(6);
    } finally {
      Math.random = orig;
    }
  };
  // 模板 1:急诊 → 放射科(pick 值 0.2 → 0.2*7=1)
  const toRad = run([0.5, 0.5, 0.5, 0.5, 0.2, 0.5]);
  check('急诊→放射科:目标楼层 3F(与地图一致)', toRad.targetFloor === 3, `t=${toRad.targetFloor}`);
  check('急诊→放射科:出发 1F', toRad.fromFloor === 1, `f=${toRad.fromFloor}`);
  check('急诊→放射科:命中放射科模板', toRad.text.includes('放射科'), toRad.text);
  // 模板 5:放射科 → 急诊(pick 值 0.75 → 0.75*7=5)
  const fromRad = run([0.5, 0.5, 0.5, 0.5, 0.75, 0.5]);
  check('放射科→急诊:出发楼层 3F(与地图一致)', fromRad.fromFloor === 3, `f=${fromRad.fromFloor}`);
  check('放射科→急诊:目标 1F', fromRad.targetFloor === 1, `t=${fromRad.targetFloor}`);
  check('放射科→急诊:命中放射科模板', fromRad.text.includes('拍片完毕'), fromRad.text);
}

// ── 24. 用户场景复现:3F 开门时只有 target=3 的乘客送达 ───────────
{
  const eng = new GameEngine({ floors: 6, emergencyGap: 78, dayMinutes: 5, simulate: false });
  const e = eng as unknown as { tasks: unknown[]; processDoors(): void };
  const now = Date.now() / 1000;
  const mk = (id: number, targetFloor: number) => ({
    id, type: 'normal', title: 'x', text: 'x', fromFloor: 1, targetFloor, kind: 'stand',
    status: 'aboard', createdAt: now, deadline: 0, wait: 0, callDelay: 0, callSent: true, callSentAt: now,
  });
  e.tasks.push(mk(61, 3), mk(62, 4), mk(63, 5)); // 放射科 3F / CT 4F / 手术室 5F
  eng.elevator.floor = 3;
  eng.elevator.posY = 3;
  eng.elevator.doorState = 'open';
  eng.elevator.doorTimer = 5;
  eng.elevator.moving = false;
  e.processDoors();
  const st = (id: number) => (e.tasks.find((x) => (x as { id: number }).id === id) as { status: string }).status;
  check('3F 开门:去 3F 的乘客送达', st(61) === 'delivered', st(61));
  check('3F 开门:去 4F(CT)的乘客不下', st(62) === 'aboard', st(62));
  check('3F 开门:去 5F(手术室)的乘客不下', st(63) === 'aboard', st(63));
}

// ── 25. 领导急召目标钳制:简单难度(4 层)不超出楼层上限 ───────────
{
  const spawner = new Spawner();
  const orig = Math.random;
  let i = 0;
  // [maskedName×3, roll=0.35(命中 VIP 分支), pick(姓), pick(头衔), pickKind]
  const seq = [0.5, 0.5, 0.5, 0.35, 0.5, 0.5, 0.5];
  Math.random = () => seq[i++ % seq.length];
  try {
    const spec = spawner.makeCall(4);
    check('VIP 任务目标不超过楼层数', spec.targetFloor === 4 && spec.targetFloor <= 4, `t=${spec.targetFloor}`);
    check('VIP 任务出发 1F 且带 vip 标记', spec.fromFloor === 1 && spec.flavor === 'vip', `${spec.fromFloor} ${spec.flavor}`);
  } finally {
    Math.random = orig;
  }
}

// ── 26. 卧床病人必有陪同:病床=家属,急救床=护士 ──────────────────
{
  const spawner = new Spawner();
  // 固定随机序列命中「CT → 急诊留观」模板(6 层无病房,不消耗 ward pick):
  // [maskedName×3, roll=0.5(常规模板), pick(templates)=0.6→0.6*7=4, pickKind=0.2→bed(权重 5/10)]
  const run = (seq: number[]) => {
    const orig = Math.random;
    let i = 0;
    Math.random = () => seq[i++ % seq.length];
    try {
      return spawner.makeCall(6);
    } finally {
      Math.random = orig;
    }
  };
  const bed = run([0.5, 0.5, 0.5, 0.5, 0.6, 0.2]);
  check('命中病床模板', bed.kind === 'bed', `kind=${bed.kind}`);
  check('病床必有家属陪同', bed.companion === true && bed.companionKind === 'family', `comp=${bed.companionKind}`);
  check('病床文案追加家属陪同', bed.text.includes('有家属陪同!'), bed.text);
  check('病床不设 noCall(必有电话通知)', bed.noCall !== true, `noCall=${bed.noCall}`);
  // 急救床(担架):所有紧急模板都带护士陪同
  const emg = spawner.makeEmergency(8);
  check('急救床必有护士陪同', emg !== null && emg.kind === 'stretcher' && emg.companion === true && emg.companionKind === 'nurse', `kind=${emg?.kind} comp=${emg?.companionKind}`);
  check('急救床文案追加护士陪同', emg?.text.includes('有护士陪同!') ?? false, emg?.text ?? '');
  const emgSmall = spawner.makeEmergency(4);
  check('小楼急救床同样护士陪同', emgSmall !== null && emgSmall.companion === true && emgSmall.companionKind === 'nurse', `comp=${emgSmall?.companionKind}`);
}

// ── 27. 卧床病人必来电:即使生成器误设 noCall 也强制电话流程 ──────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: false });
  const e = eng as unknown as { addTask(spec: unknown): void; tasks: unknown[] };
  e.addTask({
    type: 'normal', title: 'x', text: 'x', fromFloor: 1, targetFloor: 2, kind: 'bed',
    deadline: 0, callDelay: 0, noCall: true, companion: true, companionKind: 'family',
  });
  const task = e.tasks[0] as { callSent: boolean; companion: boolean; companionKind: string };
  check('卧床病人 noCall 被忽略(必有电话通知)', task.callSent === true, `callSent=${task.callSent}`);
  check('companionKind 透传到任务', task.companion === true && task.companionKind === 'family', `${task.companionKind}`);
}

// ── 28. 挑剔家属:到站前未微笑服务 → 被拍照开除 ─────────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: true });
  const e = eng as unknown as { tasks: unknown[]; processDoors(): void };
  const now = Date.now() / 1000;
  const mk = (id: number) => ({
    id, type: 'normal', title: 'x', text: 'x', fromFloor: 1, targetFloor: 4, kind: 'stand',
    status: 'pending', createdAt: now, deadline: 0, wait: 0, callDelay: 0, callSent: true,
    callSentAt: now, answered: true, answeredAt: now, flavor: 'critic', noCall: true,
  });
  e.tasks.push(mk(901));
  eng.elevator.floor = 1;
  eng.elevator.posY = 1;
  eng.elevator.doorState = 'open';
  eng.elevator.doorTimer = 5;
  eng.elevator.moving = false;
  e.processDoors();
  check('挑剔家属上梯并激活', eng.criticActive, '');
  // 电梯到目标层开门 → 未微笑 → 先送达,等离梯动画结束再开除
  eng.elevator.floor = 4;
  eng.elevator.posY = 4;
  e.processDoors();
  check('到站先送达(未立即结算)', eng.getSnapshot().phase === 'playing' && (e.tasks[0] as { status: string }).status === 'delivered', `phase=${eng.getSnapshot().phase}`);
  for (let i = 0; i < 40; i++) eng.update(0.05); // 2s > 1.5s 延迟
  const snap = eng.getSnapshot();
  check('未微笑到站 → 完全离开后开除', snap.phase === 'result' && (snap.result?.endReason?.includes('被开除') ?? false), snap.result?.endReason ?? snap.phase);
  check('开除后占位已清理', !eng.getPlacements().has(901) && !eng.getCompanionPlacements().has(901), `placements=${eng.getPlacements().size}`);
}

// ── 29. 挑剔家属:微笑服务解除 → 到站正常送达 ────────────────────
{
  const eng = new GameEngine({ floors: 8, emergencyGap: 55, dayMinutes: 8, simulate: true });
  const e = eng as unknown as { tasks: unknown[]; processDoors(): void };
  const calls: { taskId: number; text: string }[] = [];
  eng.attachScene({
    renderFrame() {},
    showBubbleForTask(taskId: number, text: string) {
      calls.push({ taskId, text });
      return true;
    },
  });
  const now = Date.now() / 1000;
  e.tasks.push({
    id: 902, type: 'normal', title: 'x', text: 'x', fromFloor: 1, targetFloor: 4, kind: 'stand',
    status: 'pending', createdAt: now, deadline: 0, wait: 0, callDelay: 0, callSent: true,
    callSentAt: now, answered: true, answeredAt: now, flavor: 'critic',
  });
  eng.elevator.floor = 1;
  eng.elevator.posY = 1;
  eng.elevator.doorState = 'open';
  eng.elevator.doorTimer = 5;
  eng.elevator.moving = false;
  e.processDoors();
  check('挑剔家属已激活', eng.criticActive);
  // 挑剔家属(未微笑)的目标楼层不可取消(否则开除机制失效)
  eng.elevator.lights.add(4);
  eng.familyLights.add(4);
  eng.pressFloor(4);
  check('挑剔家属目标灯不可取消', eng.elevator.lights.has(4), `lights=${Array.from(eng.elevator.lights)}`);
  eng.satisfaction = 90; // 便于断言"微笑服务不影响满意度"
  const before = eng.getSnapshot().satisfaction;
  eng.pressSmile();
  check('微笑服务解除挑剔家属', !eng.criticActive, '');
  check('微笑服务不影响满意度', eng.getSnapshot().satisfaction === before, `${before}->${eng.getSnapshot().satisfaction}`);
  check(
    '微笑感谢语走角色头顶气泡',
    calls.some((c) => c.taskId === 902 && c.text.includes('这还差不多')),
    JSON.stringify(calls),
  );
  eng.elevator.floor = 4;
  eng.elevator.posY = 4;
  e.processDoors();
  const snap = eng.getSnapshot();
  check('微笑后到站正常送达', snap.phase === 'playing' && (e.tasks[0] as { status: string }).status === 'delivered', `${snap.phase} ${(e.tasks[0] as { status: string }).status}`);
}

// ── 30. 挑剔家属生成:拟真专属,非拟真不出现 ─────────────────────
{
  const plain = new Spawner();
  let criticCount = 0;
  for (let i = 0; i < 200; i++) {
    if (plain.makeCall(8).flavor === 'critic') criticCount++;
  }
  check('非拟真不生成挑剔家属', criticCount === 0, `c=${criticCount}`);
  // 拟真:固定随机序列命中挑剔家属分支
  // [critic roll=0.0(<0.08), from pick, to pick, deptOf(from), deptOf(to)]
  const sim = new Spawner(true);
  const orig = Math.random;
  let i = 0;
  const seq = [0.0, 0.5, 0.5, 0.5, 0.5];
  Math.random = () => seq[i++ % seq.length];
  try {
    const spec = sim.makeCall(8);
    check('拟真生成挑剔家属任务', spec.flavor === 'critic' && spec.kind === 'stand', `flavor=${spec.flavor}`);
    check('挑剔家属目标楼层不同于出发层', spec.fromFloor !== spec.targetFloor, `${spec.fromFloor}->${spec.targetFloor}`);
    check('挑剔家属不发手机提示(noCall)', spec.noCall === true, `noCall=${spec.noCall}`);
    check('挑剔家属文本带抱怨台词', spec.text.includes('真闲') && spec.text.includes('按电梯'), spec.text);
  } finally {
    Math.random = orig;
  }
}

console.log(failed === 0 ? '\n== ALL PASS ==' : `\n== ${failed} FAILED ==`);
process.exit(failed === 0 ? 0 : 1);

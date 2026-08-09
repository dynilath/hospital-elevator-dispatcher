// ─── 引擎逻辑无头验证(tsx 运行) ─────────────────────────────────
import { GameEngine } from '../src/engine/Engine';

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) failed++;
}

// ── 1. 微笑应急:超时 → 提前下班(微博原因) ──────────────────────
{
  const eng = new GameEngine({ floors: 10, emergencyGap: 55, dayMinutes: 8, simulate: true });
  const e = eng as unknown as { smileDeadline: number; update(dt: number): void };
  e.smileDeadline = 5;
  for (let i = 0; i < 60; i++) e.update(0.05); // 3s
  check('微笑倒计时在推进', e.smileDeadline < 5 && e.smileDeadline > 0, `d=${e.smileDeadline}`);
  for (let i = 0; i < 60; i++) e.update(0.05); // 再 3s → 到期
  const snap = eng.getSnapshot();
  check('微笑超时 → 提前下班', snap.phase === 'result', snap.phase);
  check('提前下班原因含微博', snap.result?.endReason?.includes('微博') ?? false, snap.result?.endReason ?? '');
}

// ── 2. 微笑应急:及时点击微笑 → 解除且继续 ───────────────────────
{
  const eng = new GameEngine({ floors: 10, emergencyGap: 55, dayMinutes: 8, simulate: true });
  const e = eng as unknown as { smileDeadline: number; update(dt: number): void };
  e.smileDeadline = 5;
  eng.pressSmile();
  const snap = eng.getSnapshot();
  check('微笑后事件解除', !snap.smile.active && snap.phase === 'playing');
  e.update(6); // 即使时间流逝也不触发结束
  check('解除后不再触发结束', eng.getSnapshot().phase === 'playing');
}

// ── 3. 非拟真模式:不触发微笑 ───────────────────────────────────
{
  const eng = new GameEngine({ floors: 6, emergencyGap: 78, dayMinutes: 5, simulate: false });
  (eng as unknown as { smileDeadline: number }).smileDeadline = 0;
  // 模拟拥挤放弃事件来源:直接检查 triggerSmile 守卫
  const before = eng.getSnapshot();
  (eng as unknown as { triggerSmile(): void }).triggerSmile();
  check('非拟真不激活微笑', eng.getSnapshot().smile.active === false && before.phase === 'playing');
}

// ── 4. 家属堵门:到站自动妥协 + 拟真触发微笑 ────────────────────
{
  const eng = new GameEngine({ floors: 15, emergencyGap: 38, dayMinutes: 15, simulate: true });
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
  // 推进 7 秒 → 自动妥协
  for (let i = 0; i < 140; i++) e.update(0.05);
  const snap = eng.getSnapshot();
  const task = e.tasks[0] as { status: string };
  check('家属妥协后送达', task.status === 'delivered');
  check('拟真:家属发难激活微笑', snap.smile.active, `smile=${JSON.stringify(snap.smile)}`);
}

// ── 5. 家属堵门:按提醒按钮立即劝离,不触发微笑 ──────────────────
{
  const eng = new GameEngine({ floors: 15, emergencyGap: 38, dayMinutes: 15, simulate: true });
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
  check('无微笑事件', !eng.getSnapshot().smile.active);
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
  check('恶作剧扣分', eng.getSnapshot().score === -10, `score=${eng.getSnapshot().score}`);
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
  const eng = new GameEngine({ floors: 15, emergencyGap: 38, dayMinutes: 15, simulate: true });
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
  const ev = eng.elevator;
  ev.posY = 5;
  ev.floor = 5;
  ev.press(3); // 下行需求
  ev.press(6); // 上行需求(应延后)
  const visited: number[] = [];
  let lastOpen = -1;
  for (let i = 0; i < 3000 && visited.length < 2; i++) {
    (eng as unknown as { update(dt: number): void }).update(0.05);
    if (ev.doorState === 'open' && ev.floor !== lastOpen) {
      lastOpen = ev.floor;
      visited.push(ev.floor);
    }
  }
  check('下行优先:先到 3F 再到 6F', visited[0] === 3 && visited[1] === 6, visited.join('->'));
  // 再推进让门关闭、方向复位
  for (let i = 0; i < 60; i++) (eng as unknown as { update(dt: number): void }).update(0.05);
  check('全部需求清空熄灭', ev.lights.size === 0 && ev.direction === 'idle', `lights=${ev.lights.size} dir=${ev.direction}`);
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
  (t as { answeredAt: number }).answeredAt = now - 1.5; // 接听后已过 1.5 秒,打字早已完成
  check('接听且看完 → 记录', eng.isRecorded(t as never) === true);
  const snap = eng.getSnapshot();
  check('快照 recorded 正确', snap.tasks.find((x) => x.id === 42)?.recorded === true);
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
  check('厅外呼叫应答后清除', ev.hallCalls.size === 0);
  // 玩家取消厅外呼叫 → 家属随机反应
  ev.posY = 4;
  ev.floor = 4;
  eng.familyHallPress(3, 'up');
  const before = eng.getSnapshot().satisfaction;
  eng.pressFloor(3);
  const after = eng.getSnapshot();
  check('取消厅外呼叫触发反应', after.satisfaction === before - 3 || after.eventMsg !== null || ev.lights.has(3));
}

console.log(failed === 0 ? '\n== ALL PASS ==' : `\n== ${failed} FAILED ==`);
process.exit(failed === 0 ? 0 : 1);

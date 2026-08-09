import * as THREE from 'three';
import type { GameEngine } from '../engine/Engine';
import { FLOOR_DEPTS_OF, FLOOR_NAME } from '../config';
import { sfx } from '../engine/audio';
import { arrow, canvasTexture, draw7seg, FONT_CN, FONT_PX, makeCanvas } from './canvasUtils';
import { buildModelForKind, buildPerson, disposeGroup, M, PERSON_STYLES } from './models';
import type { Task, TaskView } from '../types';

export interface SceneCallbacks {
  onPressFloor: (floor: number) => void;
  onPressRemind: () => void;
  onAnswer: () => void;
  onHangup: () => void;
  onOpenMap: () => void;
  onOpenNotebook: () => void;
}

/** 可交互对象的类型标识 */
type HitType = 'floor' | 'answer' | 'hangup' | 'map' | 'notebook' | 'block' | 'ask';

/** 轿厢地面网格(引擎侧):3 列 × 4 行,轿厢宽 3.9 与网格完全贴合 */
const CELL_W = 1.3;
const CELL_D = 0.7;
const cellCenter = (col: number, row: number, w: number, h: number): { x: number; z: number } => ({
  x: -1.3 + col * CELL_W + ((w - 1) * CELL_W) / 2,
  z: 0.8 + row * CELL_D + ((h - 1) * CELL_D) / 2,
});
/** 家属按面板按钮时的站位(面板前) */
const PANEL_STAND = { x: 1.6, z: 2.5 };

const R = 960 / 720; // 画布内部分辨率比(保持宽画布,轿厢本身收窄)

/**
 * 第一人称 3D 电梯场景(Three.js,像素化渲染)。
 * 拖拽环视 + 点击交互:手机道具 / 医院介绍贴画 / 楼层按钮面板 / 提醒按钮。
 */
export class Scene3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private canvas: HTMLCanvasElement;

  // 视角控制
  private yaw = 0;
  private pitch = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private moved = 0;

  // 交互
  private interactives: THREE.Object3D[] = [];
  private hovered: THREE.Object3D | null = null;

  // 门(三层结构:厅门 + 轿厢门,同向滑动)
  private doorPanels: THREE.Mesh[] = [];

  // 楼层指示(门上大数码管 + 后墙小指示,均锚定场景)
  private indicatorMat!: THREE.MeshBasicMaterial;
  private backIndicatorMat!: THREE.MeshBasicMaterial;
  private lastFloor = -1;
  private lastDir = 0;

  // 门厅灯
  private lampMat!: THREE.MeshBasicMaterial;

  // 手机道具(接听/挂断按钮在模型上)
  private phoneGroup!: THREE.Group;
  /** 调度笔记本(手持道具,与手机并排位于视野右下角) */
  private notebookGroup!: THREE.Group;
  private answerMat!: THREE.MeshLambertMaterial;
  private hangupMat!: THREE.MeshLambertMaterial;
  private lastTaskCount = 0;
  private phonePulse = 0;

  // 通话字幕窗(手机模型上方,打字机 + 音效)
  private currentCall: TaskView | null = null;
  private callBillboard!: THREE.Mesh;
  private callTex!: THREE.CanvasTexture;
  private tickT = 0;
  /** 窄屏适配系数(0=宽屏,1=很窄,道具向中心靠拢) */
  private narrow = 0;

  // 楼层按钮
  private floorButtons: THREE.Mesh[] = [];
  private floorMats: THREE.MeshLambertMaterial[] = [];
  private litMats: THREE.MeshLambertMaterial[] = [];
  /** 楼层按钮 hover 蓝色边框 */
  private hoverOutlines: THREE.Mesh[] = [];

  // 乘客模型池(位置由引擎网格占位决定,平滑移动)
  private models = new Map<number, THREE.Group>();
  /** 家属陪护模型(任务 id) */
  private companionModels = new Map<number, THREE.Group>();
  /** 家属走到面板按按钮的动画 */
  private familyAnim: { taskId: number; floor: number; phase: 'toPanel' | 'press' | 'back'; t: number } | null = null;
  private familyWalkTimer = 10;
  /** 家属按按钮时的头顶气泡(动态文字) */
  private walkBubble!: THREE.Sprite;
  private walkBubbleTex!: THREE.CanvasTexture;
  /** 问乘客楼层后的回复气泡到期时间 */
  private askBubbleUntil = 0;
  /** 新上梯站立角色"先去按按钮再找位置"动画 */
  private pressFirstAnim: { taskId: number; target: number; phase: 'toPanel' | 'press' | 'toSpot'; t: number } | null = null;
  private seenAboard = new Set<number>();
  /** 家属堵门角色(位于电梯门口)与"别堵门!"按钮 */
  private blockBtn!: THREE.Sprite;
  /** 等待家属在电梯外按厅外按钮(▲/▼)的动画 */
  private hallAnim: { taskId: number; dir: 'up' | 'down'; phase: 'toBtn' | 'press' | 'back'; t: number } | null = null;
  private hallWalkTimer = 8;
  /** 电梯按钮面板上方的运行状态指示 */
  private panelDirMat!: THREE.MeshBasicMaterial;
  /** 厅外呼叫按钮(走廊侧,▲上行 / ▼下行) */
  private hallUpBtn!: THREE.Mesh;
  private hallDownBtn!: THREE.Mesh;
  private hallUpMat!: THREE.MeshBasicMaterial;
  private hallUpLitMat!: THREE.MeshBasicMaterial;
  private hallDownMat!: THREE.MeshBasicMaterial;
  private hallDownLitMat!: THREE.MeshBasicMaterial;

  // 家属人物(微笑服务警告)与叫骂声
  private angryGuy!: THREE.Group;
  private warnSprite!: THREE.Sprite;
  private scoldT = 0;
  private lastFrame = 0;

  private disposed = false;

  constructor(canvas: HTMLCanvasElement, private engine: GameEngine, private cbs: SceneCallbacks) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(960, 720, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color('#10131c');

    this.camera = new THREE.PerspectiveCamera(70, R, 0.1, 30);
    // 调度员站位:3×4 格子的后角(2,3)——即调试格子右下角
    this.camera.position.set(1.3, 1.55, 2.9);
    this.camera.rotation.set(0, 0.42, 0, 'YXZ'); // 初始面向电梯门

    // 灯光
    const ambient = new THREE.AmbientLight('#ffffff', 0.85);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight('#ffffff', 0.55);
    dir.position.set(1.5, 3, 0.5);
    this.scene.add(dir);

    this.buildCabin();
    this.buildPhone();
    this.buildCallBillboard();
    this.buildNotebook();
    this.setNoDepth(this.phoneGroup);
    this.setNoDepth(this.notebookGroup);
    this.setNoDepth(this.callBillboard);
    this.buildAngryGuy();
    this.buildWalkBubble();
    this.scene.add(this.camera); // 相机入场景,其子节点(手机/笔记本/字幕窗)才会渲染
    this.bindEvents();
    this.lastTaskCount = engine.getTasks().length;
    this.lastFrame = performance.now();
  }

  // ─── 场景搭建 ────────────────────────────────────────────────
  private buildCabin() {
    const cabin = new THREE.Group();

    // 墙体纹理(金属面板拼缝)
    const [wc, wctx] = makeCanvas(128, 256);
    wctx.fillStyle = '#d7dde7';
    wctx.fillRect(0, 0, 128, 256);
    wctx.strokeStyle = '#c4ccd8';
    wctx.lineWidth = 2;
    for (let x = 32; x < 128; x += 32) {
      wctx.beginPath();
      wctx.moveTo(x, 0);
      wctx.lineTo(x, 256);
      wctx.stroke();
    }
    wctx.fillStyle = '#c9d1dd';
    wctx.fillRect(0, 228, 128, 4);
    const wallTex = canvasTexture(wc);

    // 地板(瓷砖 + 伸缩缝)
    const [tileC, tileCtx] = makeCanvas(128, 128);
    tileCtx.fillStyle = '#b8c2d0';
    tileCtx.fillRect(0, 0, 128, 128);
    tileCtx.fillStyle = '#adb8c7';
    tileCtx.fillRect(0, 0, 64, 64);
    tileCtx.fillRect(64, 64, 64, 64);
    tileCtx.fillStyle = '#a4afbe';
    tileCtx.fillRect(0, 64, 64, 2);
    tileCtx.fillRect(64, 0, 2, 64);
    tileCtx.fillStyle = '#9aa5b4';
    tileCtx.fillRect(64, 64, 64, 2);
    tileCtx.fillRect(0, 0, 2, 64);
    // 近门一侧略深(磨损)
    tileCtx.fillStyle = 'rgba(90,100,115,0.15)';
    tileCtx.fillRect(0, 0, 128, 22);
    const tileTex = canvasTexture(tileC);
    tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
    tileTex.repeat.set(4, 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 4.4), new THREE.MeshLambertMaterial({ map: tileTex }));
    floor.rotation.x = -Math.PI / 2;
    cabin.add(floor);
    // 门口地垫
    const [mc, mctx] = makeCanvas(96, 56);
    mctx.fillStyle = '#2b3140';
    mctx.fillRect(0, 0, 96, 56);
    mctx.strokeStyle = '#4a5168';
    mctx.lineWidth = 3;
    mctx.strokeRect(2.5, 2.5, 91, 51);
    mctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = 8; y < 56; y += 10) mctx.fillRect(6, y, 84, 2);
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.85), new THREE.MeshLambertMaterial({ map: canvasTexture(mc) }));
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(0, 0.004, 0.75);
    cabin.add(mat);

    // 天花板
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 4.4), new THREE.MeshLambertMaterial({ color: '#ccd3de' }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 2.6;
    cabin.add(ceil);
    // 嵌入式灯槽
    const lightFrame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 0.62), new THREE.MeshLambertMaterial({ color: '#9aa5b1' }));
    lightFrame.position.set(0, 2.57, 1.7);
    cabin.add(lightFrame);
    const lightPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.66, 0.46), new THREE.MeshBasicMaterial({ color: '#fff7c9' }));
    lightPanel.position.set(0, 2.55, 1.7);
    cabin.add(lightPanel);

    // 后墙(面板纹理 + 镜子 + 扶手)
    const back = new THREE.Mesh(new THREE.BoxGeometry(3.9, 2.6, 0.08), new THREE.MeshLambertMaterial({ map: wallTex }));
    back.position.set(0, 1.3, 4.4);
    cabin.add(back);
    // 镜子(带渐变纹理与边框)
    const [mc2, mctx2] = makeCanvas(160, 100);
    const grad = mctx2.createLinearGradient(0, 0, 0, 100);
    grad.addColorStop(0, '#dfeaf4');
    grad.addColorStop(1, '#c2d2e2');
    mctx2.fillStyle = grad;
    mctx2.fillRect(0, 0, 160, 100);
    mctx2.strokeStyle = 'rgba(255,255,255,0.75)';
    mctx2.lineWidth = 4;
    mctx2.beginPath();
    mctx2.moveTo(20, 92);
    mctx2.lineTo(60, 8);
    mctx2.stroke();
    const mirrorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 0.05), new THREE.MeshLambertMaterial({ color: '#8b95a5' }));
    mirrorFrame.position.set(1.2, 1.8, 4.36);
    cabin.add(mirrorFrame);
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(1.32, 0.82), new THREE.MeshLambertMaterial({ map: canvasTexture(mc2) }));
    mirror.position.set(1.2, 1.8, 4.34);
    cabin.add(mirror);
    // 不锈钢扶手 + 支架
    const rail = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.055, 0.07), new THREE.MeshLambertMaterial({ color: '#8b95a5' }));
    rail.position.set(0, 1.05, 4.36);
    cabin.add(rail);
    for (const bx of [-1.15, 1.15]) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.05), new THREE.MeshLambertMaterial({ color: '#7d8794' }));
      bracket.position.set(bx, 1.02, 4.36);
      cabin.add(bracket);
    }

    // 左右墙(面板纹理)
    const sideWall = (x: number) => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.6, 4.4), new THREE.MeshLambertMaterial({ map: wallTex }));
      w.position.set(x, 1.3, 2.2);
      cabin.add(w);
    };
    sideWall(-1.95);
    sideWall(1.95);
    this.buildButtonPanel();

    // 踢脚线(后墙 + 侧墙)
    const baseMat = new THREE.MeshLambertMaterial({ color: '#5c6470' });
    const baseBack = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.14, 0.05), baseMat);
    baseBack.position.set(0, 0.07, 4.37);
    cabin.add(baseBack);
    for (const bx of [-1.93, 1.93]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 4.4), baseMat);
      b.position.set(bx, 0.07, 2.2);
      cabin.add(b);
    }

    // 前墙(门洞两侧,门洞宽 2.3)
    const frontWall = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.32, 0.1), new THREE.MeshLambertMaterial({ map: wallTex }));
    frontWall.position.set(-1.55, 1.16, 0.02);
    cabin.add(frontWall);
    const frontWall2 = frontWall.clone();
    frontWall2.position.x = 1.55;
    cabin.add(frontWall2);
    const frontTop = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.28, 0.1), new THREE.MeshLambertMaterial({ map: wallTex }));
    frontTop.position.set(0, 2.46, 0.02);
    cabin.add(frontTop);

    // 门套(门框:立柱 + 上梁 + 门槛)
    const frameMat = new THREE.MeshLambertMaterial({ color: '#8b95a5' });
    for (const bx of [-1.23, 1.23]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.42, 0.2), frameMat);
      jamb.position.set(bx, 1.21, 0.1);
      cabin.add(jamb);
    }
    const header = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.16, 0.2), frameMat);
    header.position.set(0, 2.37, 0.1);
    cabin.add(header);
    const threshold = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.06, 0.2), frameMat);
    threshold.position.set(0, 0.03, 0.1);
    cabin.add(threshold);

    // 三层门:厅门(后) + 轿厢门(前),同向滑动,关闭时完全覆盖门洞
    const hallMat = new THREE.MeshLambertMaterial({ color: '#aeb8c6' });
    const carMat = new THREE.MeshLambertMaterial({ color: '#c4cdd9' });
    for (const side of [-1, 1]) {
      const hallPanel = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.32, 0.05), hallMat);
      hallPanel.position.set(side * 0.575, 1.16, 0.0);
      cabin.add(hallPanel);
      // 厅门中缝装饰条
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.32, 0.06), new THREE.MeshLambertMaterial({ color: '#9aa5b1' }));
      seam.position.set(side * 0.56, 0, 0);
      hallPanel.add(seam);
      const carPanel = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.32, 0.05), carMat);
      carPanel.position.set(side * 0.575, 1.16, 0.08);
      cabin.add(carPanel);
      // 轿厢门安全边(黄黑)
      const safeEdge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.32, 0.06), new THREE.MeshLambertMaterial({ color: '#f2c94c' }));
      safeEdge.position.set(side * 0.555, 0, 0);
      carPanel.add(safeEdge);
      this.doorPanels.push(hallPanel, carPanel);
    }

    // 门厅灯
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.06), new THREE.MeshBasicMaterial({ color: '#4a4f63' }));
    lamp.position.set(0, 2.53, 0.16);
    this.lampMat = lamp.material as THREE.MeshBasicMaterial;
    cabin.add(lamp);

    // 门外走廊(透过门可见,带侧墙与端墙)
    const hallWallMat = new THREE.MeshLambertMaterial({ color: '#2a2f40' });
    const hallEnd = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.4, 0.1), hallWallMat);
    hallEnd.position.set(0, 1.2, -1.5);
    cabin.add(hallEnd);
    for (const bx of [-1.15, 1.15]) {
      const hw = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 1.5), hallWallMat);
      hw.position.set(bx, 1.2, -0.75);
      cabin.add(hw);
    }
    const hallFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 1.5),
      new THREE.MeshLambertMaterial({ color: '#39404f' }),
    );
    hallFloor.rotation.x = -Math.PI / 2;
    hallFloor.position.set(0, 0.01, -0.75);
    cabin.add(hallFloor);

    // 厅外呼叫按钮(走廊右墙,透过门可见):▲ 上行 / ▼ 下行
    const hallBtn = (arrowUp: boolean): [HTMLCanvasElement, THREE.CanvasTexture, THREE.CanvasTexture] => {
      const color = arrowUp ? '#3fae5a' : '#f08a3c';
      const [c1, c1x] = makeCanvas(64, 64);
      c1x.fillStyle = '#1e3346';
      c1x.fillRect(0, 0, 64, 64);
      c1x.strokeStyle = color;
      c1x.lineWidth = 4;
      c1x.strokeRect(2, 2, 60, 60);
      c1x.fillStyle = color;
      c1x.beginPath();
      if (arrowUp) {
        c1x.moveTo(32, 14);
        c1x.lineTo(50, 38);
        c1x.lineTo(14, 38);
      } else {
        c1x.moveTo(14, 26);
        c1x.lineTo(50, 26);
        c1x.lineTo(32, 50);
      }
      c1x.closePath();
      c1x.fill();
      const [c2, c2x] = makeCanvas(64, 64);
      c2x.fillStyle = arrowUp ? '#2b7a3e' : '#7a3f14';
      c2x.fillRect(0, 0, 64, 64);
      c2x.strokeStyle = arrowUp ? '#7dffa8' : '#ffc46b';
      c2x.lineWidth = 5;
      c2x.strokeRect(2, 2, 60, 60);
      c2x.fillStyle = arrowUp ? '#7dffa8' : '#ffc46b';
      c2x.beginPath();
      if (arrowUp) {
        c2x.moveTo(32, 14);
        c2x.lineTo(50, 38);
        c2x.lineTo(14, 38);
      } else {
        c2x.moveTo(14, 26);
        c2x.lineTo(50, 26);
        c2x.lineTo(32, 50);
      }
      c2x.closePath();
      c2x.fill();
      return [c1, canvasTexture(c1), canvasTexture(c2)];
    };
    const upTex = hallBtn(true);
    const downTex = hallBtn(false);
    this.hallUpMat = new THREE.MeshBasicMaterial({ map: upTex[1] });
    this.hallUpLitMat = new THREE.MeshBasicMaterial({ map: upTex[2] });
    this.hallDownMat = new THREE.MeshBasicMaterial({ map: downTex[1] });
    this.hallDownLitMat = new THREE.MeshBasicMaterial({ map: downTex[2] });
    this.hallUpBtn = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), this.hallUpMat);
    this.hallUpBtn.position.set(1.1, 1.42, -0.8);
    this.hallUpBtn.rotation.y = Math.PI / 2;
    this.hallDownBtn = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), this.hallDownMat);
    this.hallDownBtn.position.set(1.1, 1.12, -0.8);
    this.hallDownBtn.rotation.y = Math.PI / 2;
    cabin.add(this.hallUpBtn, this.hallDownBtn);

    // 楼层数码管(门上)
    this.buildIndicator();
    // 医院介绍贴画(按钮旁)
    this.buildPoster();

    this.scene.add(cabin);
  }

  private buildButtonPanel() {
    const N = this.engine.diff.floors;
    const cols = 2;
    const rows = Math.ceil(N / cols);
    const panelH = rows * 0.15 + 0.24;
    const panelY = 2.34 - panelH / 2;
    // 壁龛外壳:嵌入墙体(深色边框 + 底板),按钮位于壳体前方
    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.5, panelH + 0.1, 0.09), new THREE.MeshLambertMaterial({ color: '#39404f' }));
    housing.position.set(1.95, panelY, 2.35);
    housing.rotation.y = -Math.PI / 2;
    this.scene.add(housing);
    const backplate = new THREE.Mesh(new THREE.BoxGeometry(1.38, panelH - 0.04, 0.04), new THREE.MeshLambertMaterial({ color: '#1c2130' }));
    backplate.position.set(1.93, panelY, 2.35);
    backplate.rotation.y = -Math.PI / 2;
    this.scene.add(backplate);

    const bw = 0.42;
    const bh = 0.13;
    for (let f = 1; f <= N; f++) {
      const [c, ctx] = makeCanvas(176, 48);
      // 常规态
      ctx.fillStyle = '#232838';
      ctx.fillRect(0, 0, 176, 48);
      ctx.strokeStyle = '#4a5168';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, 173, 45);
      ctx.fillStyle = '#ffd34d';
      ctx.font = FONT_PX(16);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(f), 12, 16);
      ctx.fillStyle = '#c9d1e0';
      ctx.font = FONT_CN(13);
      ctx.fillText(shortName(FLOOR_NAME(f)), 50, 17);
      // 亮灯态
      const [c2, ctx2] = makeCanvas(176, 48);
      ctx2.fillStyle = '#3a3420';
      ctx2.fillRect(0, 0, 176, 48);
      ctx2.strokeStyle = '#ffd34d';
      ctx2.lineWidth = 3;
      ctx2.strokeRect(1.5, 1.5, 173, 45);
      ctx2.fillStyle = '#ffe27a';
      ctx2.font = FONT_PX(16);
      ctx2.textAlign = 'left';
      ctx2.textBaseline = 'middle';
      ctx2.fillText(String(f), 12, 16);
      ctx2.fillStyle = '#fff';
      ctx2.font = FONT_CN(13);
      ctx2.fillText(shortName(FLOOR_NAME(f)), 50, 17);

      const mat = new THREE.MeshLambertMaterial({ map: canvasTexture(c) });
      const litMat = new THREE.MeshLambertMaterial({ map: canvasTexture(c2) });
      this.floorMats.push(mat);
      this.litMats.push(litMat);

      const idx = f - 1;
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      // 两列沿墙面(Z 轴)错开
      const gx = col === 0 ? -0.29 : 0.29;
      const gy = 2.34 - 0.12 - row * 0.15 - 0.5 * bh;
      // 按钮底座(沉入壁龛,在按钮后方)
      const socket = new THREE.Mesh(new THREE.PlaneGeometry(bw + 0.06, bh + 0.06), new THREE.MeshBasicMaterial({ color: '#10131c' }));
      socket.position.set(1.89, gy, 2.35 + gx + 0.05);
      socket.rotation.y = -Math.PI / 2;
      this.scene.add(socket);
      // 按钮(位于壳体前方,可见可点)
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), mat);
      mesh.position.set(1.86, gy, 2.35 + gx);
      mesh.rotation.y = -Math.PI / 2;
      mesh.userData = { type: 'floor' as HitType, floor: f };
      this.interactives.push(mesh);
      this.floorButtons.push(mesh);
      this.scene.add(mesh);
      // hover 蓝色边框(悬停时显示)
      const [hc2, hctx2] = makeCanvas(200, 60);
      hctx2.clearRect(0, 0, 200, 60);
      hctx2.strokeStyle = '#4dd0e1';
      hctx2.lineWidth = 7;
      hctx2.strokeRect(4, 4, 192, 52);
      const hoverOutline = new THREE.Mesh(
        new THREE.PlaneGeometry(bw + 0.045, bh + 0.045),
        new THREE.MeshBasicMaterial({ map: canvasTexture(hc2), transparent: true, depthWrite: false }),
      );
      hoverOutline.position.set(1.86, gy, 2.35 + gx - 0.01);
      hoverOutline.rotation.y = -Math.PI / 2;
      hoverOutline.visible = false;
      this.hoverOutlines.push(hoverOutline);
      this.scene.add(hoverOutline);
    }

    // 电梯按钮面板上方的运行状态指示(与轿厢墙壁平面完全平行)
    const [pc] = makeCanvas(220, 48);
    const ptex = canvasTexture(pc);
    const dirMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.19), new THREE.MeshBasicMaterial({ map: ptex }));
    dirMesh.position.set(1.86, 2.52, 2.35);
    dirMesh.rotation.y = -Math.PI / 2;
    this.panelDirMat = dirMesh.material as THREE.MeshBasicMaterial;
    this.panelDirMat.map = ptex;
    this.scene.add(dirMesh);
  }

  private buildIndicator() {
    // 门上大指示(面向轿厢)
    const [c] = makeCanvas(460, 40);
    const tex = canvasTexture(c);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.2), new THREE.MeshBasicMaterial({ map: tex }));
    mesh.position.set(0, 2.5, 0.055);
    this.indicatorMat = mesh.material as THREE.MeshBasicMaterial;
    this.indicatorMat.map = tex;
    this.scene.add(mesh);
    // 后墙小指示(背对门时也能看到当前楼层/方向)
    const [bc] = makeCanvas(360, 34);
    const btex = canvasTexture(bc);
    const backMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.17), new THREE.MeshBasicMaterial({ map: btex }));
    backMesh.position.set(0, 2.34, 4.34);
    backMesh.rotation.y = Math.PI;
    this.backIndicatorMat = backMesh.material as THREE.MeshBasicMaterial;
    this.backIndicatorMat.map = btex;
    this.scene.add(backMesh);
  }

  private buildPoster() {
    // 医院楼层分布贴画:挂在楼层按钮面板旁边(右侧墙,面板后方)
    const floors = this.engine.diff.floors;
    // 高度 = 标题区 + 楼层行 + 底部提示区(预留 1~2 行,避免与最后一行重叠)
    const [c, ctx] = makeCanvas(300, floors * 20 + 104);
    ctx.fillStyle = '#f2ede0';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#8b6f47';
    ctx.lineWidth = 5;
    ctx.strokeRect(2.5, 2.5, c.width - 5, c.height - 5);
    ctx.fillStyle = '#3d3a33';
    ctx.font = FONT_CN(24);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('医院楼层分布', c.width / 2, 12);
    ctx.fillStyle = '#8b6f47';
    ctx.font = FONT_CN(14);
    ctx.fillText('— 点击查看详情 —', c.width / 2, 44);
    // 楼层-科室列表(单行排版:1F 急诊大厅 门诊药房 门诊挂号)
    ctx.fillStyle = '#5c5a52';
    ctx.font = FONT_CN(15);
    let y = 70;
    for (let i = 1; i <= floors; i++) {
      const depts = FLOOR_DEPTS_OF(i);
      ctx.textAlign = 'left';
      ctx.fillText(`${i}F ${depts.join(' ')}`, 14, y);
      y += 20;
    }
    ctx.fillStyle = '#b33a2e';
    ctx.textAlign = 'center';
    ctx.font = FONT_CN(16);
    ctx.fillText('👆 点我查看', c.width / 2, c.height - 26);

    const mat = new THREE.MeshLambertMaterial({ map: canvasTexture(c) });
    // 按钮面板后方(z≈3.8),与按钮同墙面向轿厢(避免穿入后墙)
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, (c.height / c.width) * 0.95), mat);
    mesh.position.set(1.87, 1.5, 3.8);
    mesh.rotation.y = -Math.PI / 2;
    mesh.userData = { type: 'map' as HitType };
    this.interactives.push(mesh);
    this.scene.add(mesh);
  }

  /** 调度笔记本(手持道具,与手机并排位于视野右下角) */
  private buildNotebook() {
    const g = new THREE.Group();
    // 封面
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.05), new THREE.MeshLambertMaterial({ color: '#7a5230' }));
    cover.position.set(0, 0, 0.03);
    g.add(cover);
    // 纸页
    const [pc, pctx] = makeCanvas(240, 320);
    pctx.fillStyle = '#f7f2e4';
    pctx.fillRect(0, 0, 240, 320);
    pctx.strokeStyle = '#b9b09a';
    pctx.lineWidth = 2;
    pctx.strokeRect(1, 1, 238, 318);
    pctx.fillStyle = '#7a5230';
    pctx.font = FONT_CN(20);
    pctx.textAlign = 'center';
    pctx.fillText('📓 调度记录', 120, 30);
    pctx.strokeStyle = '#d8d0ba';
    pctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      pctx.beginPath();
      pctx.moveTo(18, 52 + i * 26);
      pctx.lineTo(222, 52 + i * 26);
      pctx.stroke();
    }
    pctx.fillStyle = '#8b6f47';
    pctx.font = FONT_CN(14);
    pctx.fillText('— 点击翻看需求 —', 120, 288);
    const pages = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.74), new THREE.MeshLambertMaterial({ map: canvasTexture(pc) }));
    pages.position.set(0, 0.01, 0.065);
    g.add(pages);

    // 手持:位于手机左侧(避免遮挡手机接听/挂断按钮),略小、微侧
    g.scale.setScalar(0.7);
    g.position.set(0.05, -0.52, -1.1);
    g.rotation.y = -0.18;
    g.userData = { type: 'notebook' as HitType };
    this.notebookGroup = g;
    this.interactives.push(g);
    this.camera.add(g);
  }

  /** 家属走到面板按按钮时的头顶气泡 */
  private buildWalkBubble() {
    const [c, ctx] = makeCanvas(220, 52);
    ctx.fillStyle = 'rgba(30, 51, 70, 0.92)';
    ctx.fillRect(0, 0, 220, 52);
    ctx.strokeStyle = '#4dd0e1';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 216, 48);
    ctx.fillStyle = '#fff';
    ctx.font = FONT_CN(20);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('按楼层按钮…', 110, 27);
    const tex = canvasTexture(c);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(0.55, 0.13, 1);
    sprite.visible = false;
    this.walkBubbleTex = tex;
    this.walkBubble = sprite;
    this.scene.add(sprite);
  }

  /** 将道具设为独立绘制层:关闭深度测试,始终绘制在电梯之上,避免穿模 */
  private setNoDepth(obj: THREE.Object3D) {
    obj.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      const mats = Array.isArray(m) ? m : [m];
      for (const mm of mats) {
        if (mm) mm.depthTest = false;
      }
    });
  }

  /** 显示动态气泡(重绘文字) */
  private showBubble(text: string, x: number, y: number, z: number) {
    const ctx = this.walkBubbleTex.image.getContext('2d')!;
    const w = this.walkBubbleTex.image.width;
    const h = this.walkBubbleTex.image.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(30, 51, 70, 0.92)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#4dd0e1';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.fillStyle = '#fff';
    ctx.font = FONT_CN(20);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
    this.walkBubbleTex.needsUpdate = true;
    this.walkBubble.visible = true;
    this.walkBubble.position.set(x, y, z);
  }

  /** 家属人物 + 微笑服务警告(拟真模式抱怨时出现) */
  private buildAngryGuy() {
    this.angryGuy = buildPerson({ body: M.red, bodyD: M.redD, hair: M.hair });
    this.angryGuy.visible = false;
    this.scene.add(this.angryGuy);

    const [wc, wctx] = makeCanvas(220, 72);
    wctx.fillStyle = '#c92a2a';
    wctx.fillRect(0, 0, 220, 72);
    wctx.strokeStyle = '#fff';
    wctx.lineWidth = 5;
    wctx.strokeRect(2.5, 2.5, 215, 67);
    wctx.fillStyle = '#fff';
    wctx.font = FONT_CN(28);
    wctx.textAlign = 'center';
    wctx.textBaseline = 'middle';
    wctx.fillText('😡 微笑!微笑!', 110, 36);
    const warn = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(wc), transparent: true, depthWrite: false }));
    warn.scale.set(1.1, 0.36, 1);
    warn.visible = false;
    this.warnSprite = warn;
    this.scene.add(warn);
    // 「别堵门!」按钮(家属堵门时浮现在门口家属身上,点击取消堵门)
    const [bc, bctx] = makeCanvas(240, 72);
    bctx.fillStyle = '#c92a2a';
    bctx.fillRect(0, 0, 240, 72);
    bctx.strokeStyle = '#fff';
    bctx.lineWidth = 5;
    bctx.strokeRect(2.5, 2.5, 235, 67);
    bctx.fillStyle = '#fff';
    bctx.font = FONT_CN(26);
    bctx.textAlign = 'center';
    bctx.textBaseline = 'middle';
    bctx.fillText('🚫 别堵门!', 120, 37);
    const block = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(bc), transparent: true, depthWrite: false }));
    block.scale.set(0.85, 0.255, 1);
    block.visible = false;
    block.userData = { type: 'block' as HitType };
    this.blockBtn = block;
    this.interactives.push(block);
    this.scene.add(block);
  }

  private buildPhone() {
    const g = new THREE.Group();
    // 机身
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.68, 0.035), new THREE.MeshLambertMaterial({ color: '#232838' }));
    g.add(frame);
    // 屏幕(内容简化:接听/挂断在按钮上)
    const [sc, sctx] = makeCanvas(140, 190);
    sctx.fillStyle = '#0e1320';
    sctx.fillRect(0, 0, 140, 190);
    sctx.fillStyle = '#4dd0e1';
    sctx.font = FONT_CN(14);
    sctx.textAlign = 'center';
    sctx.textBaseline = 'top';
    sctx.fillText('📱 调度热线', 70, 10);
    sctx.font = '54px sans-serif';
    sctx.fillText('📞', 70, 62);
    sctx.fillStyle = '#9aa5b1';
    sctx.font = FONT_CN(12);
    sctx.fillText('来电按「接听」', 70, 142);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.46), new THREE.MeshLambertMaterial({ map: canvasTexture(sc) }));
    screen.position.set(0, 0.1, 0.021);
    g.add(screen);
    // 接听按钮(模型上,可直接点击)
    const [ac, actx] = makeCanvas(80, 44);
    actx.fillStyle = '#2b7a3e';
    actx.fillRect(0, 0, 80, 44);
    actx.strokeStyle = '#3fae5a';
    actx.lineWidth = 3;
    actx.strokeRect(1.5, 1.5, 77, 41);
    actx.fillStyle = '#fff';
    actx.font = FONT_CN(20);
    actx.textAlign = 'center';
    actx.textBaseline = 'middle';
    actx.fillText('接听', 40, 22);
    const answerBtn = new THREE.Mesh(new THREE.PlaneGeometry(0.185, 0.102), new THREE.MeshLambertMaterial({ map: canvasTexture(ac) }));
    answerBtn.position.set(-0.09, -0.245, 0.022);
    answerBtn.userData = { type: 'answer' as HitType };
    this.answerMat = answerBtn.material as THREE.MeshLambertMaterial;
    g.add(answerBtn);
    this.interactives.push(answerBtn);
    // 挂断按钮
    const [hc, hctx] = makeCanvas(80, 44);
    hctx.fillStyle = '#a22c28';
    hctx.fillRect(0, 0, 80, 44);
    hctx.strokeStyle = '#e0453f';
    hctx.lineWidth = 3;
    hctx.strokeRect(1.5, 1.5, 77, 41);
    hctx.fillStyle = '#fff';
    hctx.font = FONT_CN(20);
    hctx.textAlign = 'center';
    hctx.textBaseline = 'middle';
    hctx.fillText('挂断', 40, 22);
    const hangupBtn = new THREE.Mesh(new THREE.PlaneGeometry(0.185, 0.102), new THREE.MeshLambertMaterial({ map: canvasTexture(hc) }));
    hangupBtn.position.set(0.09, -0.245, 0.022);
    hangupBtn.userData = { type: 'hangup' as HitType };
    this.hangupMat = hangupBtn.material as THREE.MeshLambertMaterial;
    g.add(hangupBtn);
    this.interactives.push(hangupBtn);

    g.position.set(0.56, -0.4, -1.0);
    g.rotation.y = -0.12;
    this.phoneGroup = g;
    this.camera.add(g);
  }

  /** 通话字幕窗(手机模型上方,打字机 + 音效) */
  private buildCallBillboard() {
    const [c] = makeCanvas(340, 110);
    const tex = canvasTexture(c);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.32), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    mesh.position.set(0.56, 0.02, -1.18);
    mesh.rotation.y = -0.12;
    mesh.visible = false;
    this.callTex = tex;
    this.callBillboard = mesh;
    this.camera.add(mesh);
  }

  /** 设置当前通话(接听时传入任务,挂断时传 null) */
  setCurrentCall(task: TaskView | null) {
    this.currentCall = task;
    this.tickT = 0;
  }

  // ─── 交互事件 ────────────────────────────────────────────────
  private bindEvents() {
    const el = this.canvas;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointerleave', this.onLeave);
  }

  private ndc(e: PointerEvent): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.moved = 0;
  };

  private onMove = (e: PointerEvent) => {
    if (this.dragging) {
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.yaw -= dx * 0.0055;
      this.pitch = Math.max(-0.45, Math.min(0.4, this.pitch - dy * 0.0045));
      this.applyCamera();
    }
    this.hoverAt(e);
  };

  private onUp = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.moved < 8) this.clickAt(e);
  };

  private onLeave = () => {
    this.dragging = false;
    this.clearHover();
  };

  private applyCamera() {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private hoverAt(e: PointerEvent) {
    const p = this.ndc(e);
    this.raycaster.setFromCamera(p, this.camera);
    const hits = this.raycaster.intersectObjects(this.interactives, true);
    const hit = hits.find((h) => (h.object.userData.type as HitType) !== undefined);
    this.setHover(hit ? hit.object : null);
  }

  private clickAt(e: PointerEvent) {
    const p = this.ndc(e);
    this.raycaster.setFromCamera(p, this.camera);
    const hits = this.raycaster.intersectObjects(this.interactives, true);
    for (const h of hits) {
      // 交互标记可能在父级 Group 上(如笔记本)
      let obj: THREE.Object3D | null = h.object;
      let ud: { type?: HitType; floor?: number; taskId?: number } | null = null;
      while (obj && !ud?.type) {
        ud = obj.userData as { type?: HitType; floor?: number; taskId?: number };
        obj = obj.parent;
      }
      if (!ud?.type) continue;
      switch (ud.type) {
        case 'floor':
          this.cbs.onPressFloor(ud.floor!);
          return;
        case 'answer':
          this.cbs.onAnswer();
          return;
        case 'hangup':
          this.cbs.onHangup();
          return;
        case 'map':
          this.cbs.onOpenMap();
          return;
        case 'notebook':
          this.cbs.onOpenNotebook();
          return;
        case 'block':
          this.cbs.onPressRemind(); // 「别堵门!」:取消堵门
          return;
        case 'ask':
          this.askPassenger(ud.taskId!);
          return;
      }
    }
  }

  private setHover(obj: THREE.Object3D | null) {
    if (this.hovered === obj) return;
    if (this.hovered) {
      this.hovered.scale.set(1, 1, 1);
    }
    this.hovered = obj;
    if (obj) {
      obj.scale.set(1.05, 1.05, 1.05);
    }
    // 楼层按钮 hover 蓝色边框
    const hoverFloor = (obj as THREE.Mesh | null)?.userData?.floor as number | undefined;
    for (let i = 0; i < this.hoverOutlines.length; i++) {
      this.hoverOutlines[i].visible = hoverFloor === i + 1;
    }
  }

  private clearHover() {
    this.setHover(null);
  }

  // ─── 每帧更新 ────────────────────────────────────────────────
  renderFrame() {
    const ev = this.engine.elevator;
    const open = ev.doorOpen;
    const frameNow = performance.now();
    const frameDt = Math.min(0.1, (frameNow - this.lastFrame) / 1000);
    this.lastFrame = frameNow;

    // 窄屏适配:屏幕宽度不足时,手机/笔记本/字幕窗向中心靠拢
    const dispW = this.canvas.getBoundingClientRect().width;
    this.narrow = Math.max(0, Math.min(1, (640 - dispW) / 640));
    this.phoneGroup.position.x = 0.56 - this.narrow * 0.32;
    this.phoneGroup.position.y = -0.4 + this.narrow * 0.12;
    this.notebookGroup.position.x = 0.05 - this.narrow * 0.4;
    this.notebookGroup.position.y = -0.52 + this.narrow * 0.12;

    // 三层门同向滑动(厅门 + 轿厢门,关闭时完全覆盖门洞)
    const dx = 0.575 + 1.15 * open;
    this.doorPanels[0].position.x = -dx;
    this.doorPanels[1].position.x = dx;
    this.doorPanels[2].position.x = -dx;
    this.doorPanels[3].position.x = dx;

    // 门厅灯
    this.lampMat.color.set(open > 0.05 ? '#ffd34d' : '#4a4f63');

    // 厅外呼叫按钮亮灯(当前层 ▲/▼)
    const hallDir = ev.hallCalls.get(ev.floor);
    this.hallUpBtn.material = hallDir === 'up' ? this.hallUpLitMat : this.hallUpMat;
    this.hallDownBtn.material = hallDir === 'down' ? this.hallDownLitMat : this.hallDownMat;

    // 楼层指示(变化时重绘纹理)
    const dir = ev.directionArrow();
    if (ev.floor !== this.lastFloor || dir !== this.lastDir) {
      this.lastFloor = ev.floor;
      this.lastDir = dir;
      this.redrawIndicator();
    }

    // 楼层按钮亮灯(需求持续亮起直到到达)
    const lights = ev.lights;
    for (let i = 0; i < this.floorButtons.length; i++) {
      const mat = lights.has(i + 1) ? this.litMats[i] : this.floorMats[i];
      if (this.floorButtons[i].material !== mat) this.floorButtons[i].material = mat;
    }

    // 手机:新来电脉冲 + 接听按钮提示
    const count = this.engine.getTasks().length;
    if (count !== this.lastTaskCount) {
      this.lastTaskCount = count;
      this.phonePulse = 1;
    }
    this.phonePulse = Math.max(0, this.phonePulse - 0.02);
    const hasUnread = this.engine.hasUnreadCall();
    const pulse = hasUnread ? 0.3 + 0.4 * Math.abs(Math.sin(performance.now() / 140)) : 0.15 + 0.3 * this.phonePulse * Math.abs(Math.sin(performance.now() / 120));
    this.answerMat.emissive.setRGB(pulse * 0.4, pulse, pulse * 0.25);
    this.hangupMat.emissive.setRGB(this.currentCall ? 0.3 + 0.2 * Math.sin(performance.now() / 200) : 0, 0, 0);

    // 通话字幕窗(打字机 + 打字音效)
    this.updateCallBillboard(frameDt);

    this.updatePassengers(frameDt);

    // 家属叫骂声(微笑应急期间持续模拟)
    if (this.engine.smileActive) {
      this.scoldT -= frameDt;
      if (this.scoldT <= 0) {
        this.scoldT = 0.85;
        sfx.scold();
      }
    } else {
      this.scoldT = 0.4;
    }

    this.renderer.render(this.scene, this.camera);
  }

  /** 通话字幕窗:从接听时刻起按打字机进度重绘文字,播放打字音效 */
  private updateCallBillboard(frameDt: number) {
    const t = this.currentCall;
    if (!t || !t.answered) {
      this.callBillboard.visible = false;
      return;
    }
    this.callBillboard.visible = true;
    this.callBillboard.position.set(0.56 - this.narrow * 0.32, 0.02 + this.narrow * 0.12, -1.18);
    const ctx = this.callTex.image.getContext('2d')!;
    const w = this.callTex.image.width;
    const h = this.callTex.image.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(16, 22, 36, 0.88)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#4dd0e1';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    // 标题行
    ctx.fillStyle = '#4dd0e1';
    ctx.font = FONT_CN(15);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const route = t.flavor === 'prank' ? `目标:${t.fromFloor}F` : `${t.fromFloor}F → ${t.targetFloor}F`;
    ctx.fillText(`📞 ${t.title} · ${route}`, 10, 8);
    // 正文(打字机:从接听时刻开始)
    const elapsedMs = (Date.now() / 1000 - t.answeredAt) * 1000;
    const reveal = Math.min(t.text.length, Math.max(0, Math.floor(elapsedMs / 20)));
    const typing = reveal < t.text.length;
    ctx.fillStyle = '#e8ecf4';
    ctx.font = FONT_CN(16);
    const maxW = w - 20;
    let line = '';
    let y = 34;
    for (const ch of t.text.slice(0, reveal)) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, 10, y);
        y += 20;
        line = ch;
      } else {
        line = test;
      }
    }
    ctx.fillText(line, 10, y);
    if (typing) {
      const curX = 10 + ctx.measureText(line).width;
      ctx.fillStyle = '#4dd0e1';
      ctx.fillRect(curX, y, 4, 16);
      // 打字音效(伴随打字模拟语音)
      this.tickT -= frameDt;
      if (this.tickT <= 0) {
        this.tickT = 0.09;
        sfx.tick();
      }
    }
    this.callTex.needsUpdate = true;
  }

  private redrawIndicator() {
    const tex = this.indicatorMat.map as THREE.CanvasTexture;
    const ctx = tex.image.getContext('2d')!;
    const w = tex.image.width;
    const h = tex.image.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(16,19,28,0.88)';
    ctx.fillRect(0, 0, w, h);
    // 方向箭头 + 当前楼层数码管 + 运行状态文字(场景内可见提示)
    const dirText = this.lastDir > 0 ? '上行' : this.lastDir < 0 ? '下行' : '待命';
    const dirColor = this.lastDir > 0 ? '#3fae5a' : this.lastDir < 0 ? '#f08a3c' : '#9aa5b1';
    if (this.lastDir > 0) arrow(ctx, 10, 12, 17, true, dirColor);
    else if (this.lastDir < 0) arrow(ctx, 10, 12, 17, false, dirColor);
    else {
      ctx.fillStyle = dirColor;
      ctx.fillRect(12, 16, 13, 5);
      ctx.fillRect(16, 12, 5, 13);
    }
    draw7seg(ctx, 38, 3, String(this.lastFloor), 2.6, '#ffd34d');
    ctx.fillStyle = dirColor;
    ctx.font = FONT_CN(19);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(dirText, 104, 21);
    tex.needsUpdate = true;
    // 按钮面板上方运行状态(普通电梯样式:"1F ▲")
    const ptex = this.panelDirMat.map as THREE.CanvasTexture;
    const pctx2 = ptex.image.getContext('2d')!;
    const pw = ptex.image.width;
    const ph = ptex.image.height;
    pctx2.clearRect(0, 0, pw, ph);
    pctx2.fillStyle = 'rgba(14, 19, 30, 0.9)';
    pctx2.fillRect(0, 0, pw, ph);
    // 楼层
    pctx2.fillStyle = '#ffd34d';
    pctx2.font = FONT_PX(24);
    pctx2.textAlign = 'right';
    pctx2.textBaseline = 'middle';
    pctx2.fillText(`${this.lastFloor}F`, pw / 2 - 4, ph / 2);
    // 上下方向箭头
    const arrowText = this.lastDir > 0 ? '▲' : this.lastDir < 0 ? '▼' : '—';
    pctx2.fillStyle = dirColor;
    pctx2.font = FONT_CN(24);
    pctx2.textAlign = 'left';
    pctx2.fillText(arrowText, pw / 2 + 6, ph / 2);
    ptex.needsUpdate = true;
    // 后墙小指示
    const btex = this.backIndicatorMat.map as THREE.CanvasTexture;
    const bctx = btex.image.getContext('2d')!;
    const bw = btex.image.width;
    const bh = btex.image.height;
    bctx.clearRect(0, 0, bw, bh);
    bctx.fillStyle = 'rgba(14, 19, 30, 0.85)';
    bctx.fillRect(0, 0, bw, bh);
    draw7seg(bctx, 12, 3, String(this.lastFloor), 1.9, '#ffd34d');
    const bdirText = this.lastDir > 0 ? '上行 ▲' : this.lastDir < 0 ? '下行 ▼' : '待命';
    bctx.fillStyle = dirColor;
    bctx.font = FONT_CN(18);
    bctx.textAlign = 'left';
    bctx.textBaseline = 'middle';
    bctx.fillText(bdirText, 86, 17);
    btex.needsUpdate = true;
  }

  private updatePassengers(frameDt: number) {
    const ev = this.engine.elevator;
    const tasks = this.engine.getTasks();
    const alive = new Set<number>();
    const floor = ev.floor;
    const now = performance.now() / 1000;
    const lerpK = Math.min(1, frameDt * 4);

    // 等待上梯的乘客(门外,门开时可见;恶作剧电话没有真乘客)
    const waiting = tasks
      .filter((t) => t.status === 'pending' && t.fromFloor === floor && t.flavor !== 'prank')
      .slice(0, 2);
    waiting.forEach((t, i) => {
      const m = this.modelFor(t);
      alive.add(t.id);
      m.rotation.y = Math.PI; // 面向轿厢
      m.visible = ev.doorOpen > 0.35;
      let tx = -0.6 + i * 0.9;
      let tz = -0.55;
      // 厅外按键动画:走到 ▲/▼ 按钮旁按下再回来
      if (this.hallAnim && this.hallAnim.taskId === t.id && this.hallAnim.phase !== 'back') {
        tx = 0.95;
        tz = -0.5;
      }
      m.position.x += (tx - m.position.x) * lerpK;
      m.position.z += (tz - m.position.z) * lerpK;
      if (this.hallAnim && this.hallAnim.taskId === t.id && this.hallAnim.phase !== 'back') {
        this.showBubble(this.hallAnim.dir === 'up' ? '按上行 ▲' : '按下行 ▼', m.position.x, m.position.y + 1.85, m.position.z);
      }
    });

    // 等待家属在电梯外按厅外按钮(▲/▼,按需求方向)
    this.hallWalkTimer -= frameDt;
    if (!this.hallAnim) {
      if (this.hallWalkTimer <= 0) {
        this.hallWalkTimer = 6 + Math.random() * 6;
        if (ev.doorOpen > 0.3) {
          const waitingHere = tasks.filter(
            (t) => t.status === 'pending' && t.fromFloor === floor && t.flavor !== 'prank',
          );
          if (waitingHere.length > 0) {
            const t = waitingHere[0];
            this.hallAnim = {
              taskId: t.id,
              dir: t.targetFloor > floor ? 'up' : 'down',
              phase: 'toBtn',
              t: 0,
            };
          }
        }
      }
    } else {
      const a = this.hallAnim;
      a.t += frameDt;
      const dur = { toBtn: 0.9, press: 0.4, back: 0.9 };
      if (a.t >= dur[a.phase]) {
        if (a.phase === 'toBtn') {
          this.engine.familyHallPress(floor, a.dir); // 走到按钮:按下 ▲/▼
          a.phase = 'press';
          a.t = 0;
        } else if (a.phase === 'press') {
          a.phase = 'back';
          a.t = 0;
        } else {
          this.hallAnim = null;
          this.walkBubble.visible = false;
        }
      }
    }

    // 轿厢内乘客:位置由引擎网格占位决定(3×4),平滑移动到目标(含走入/重排动画)
    const aboard = tasks.filter((t) => t.status === 'aboard');
    const placements = this.engine.getPlacements();
    // 新上梯站立角色(家属):多数先去按电梯按钮,再回自己位置;少数忘记直接站
    for (const t of aboard) {
      if (!this.seenAboard.has(t.id) && t.kind === 'stand' && !this.pressFirstAnim) {
        if (Math.random() < 0.65) {
          let target = t.targetFloor;
          if (target === floor || ev.lights.has(target)) {
            const candidates = Array.from({ length: ev.floors }, (_, i) => i + 1).filter(
              (f) => f !== floor && !ev.lights.has(f),
            );
            target = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : t.targetFloor;
          }
          this.pressFirstAnim = { taskId: t.id, target, phase: 'toPanel', t: 0 };
        }
      }
    }
    for (const t of aboard) {
      const m = this.modelFor(t);
      alive.add(t.id);
      m.visible = true;
      const p = placements.get(t.id);
      let tx = 0;
      let tz = 1.5;
      let rotY = 0;
      if (p) {
        const c = cellCenter(p.col, p.row, p.w, p.h);
        tx = c.x;
        tz = c.z;
        if (t.kind === 'bed' || t.kind === 'stretcher') rotY = Math.PI / 2; // 担架纵置
      }
      m.rotation.y = rotY;
      // 先按按钮再找位置:途中目标为面板
      if (this.pressFirstAnim && this.pressFirstAnim.taskId === t.id && this.pressFirstAnim.phase !== 'toSpot') {
        tx = PANEL_STAND.x;
        tz = PANEL_STAND.z;
      }
      m.position.x += (tx - m.position.x) * lerpK;
      m.position.z += (tz - m.position.z) * lerpK;
      // 站立乘客轻微晃动
      if (t.kind === 'stand') {
        m.position.y = Math.sin(now * 2.4 + t.id) * 0.015;
      } else {
        m.position.y = 0;
      }
    }
    this.seenAboard = new Set(aboard.map((t) => t.id));
    // 推进"先按按钮"动画
    if (this.pressFirstAnim) {
      const a = this.pressFirstAnim;
      a.t += frameDt;
      const dur = { toPanel: 0.9, press: 0.4, toSpot: 0.9 };
      if (a.t >= dur[a.phase]) {
        if (a.phase === 'toPanel') {
          this.engine.familyPressButton(a.target); // 走到面板:按下
          a.phase = 'press';
          a.t = 0;
        } else if (a.phase === 'press') {
          a.phase = 'toSpot';
          a.t = 0;
        } else {
          this.pressFirstAnim = null;
        }
      }
    }

    // 回收消失的模型
    for (const [id, m] of this.models) {
      if (!alive.has(id)) {
        this.models.delete(id);
        this.scene.remove(m);
        disposeGroup(m);
      }
    }

    // 家属自动按键:有陪护在梯上时,过一会儿走到面板按按钮再回来
    this.familyWalkTimer -= frameDt;
    if (!this.familyAnim) {
      if (this.familyWalkTimer <= 0) {
        this.familyWalkTimer = 6 + Math.random() * 6;
        const compTasks = tasks.filter((t) => t.status === 'aboard' && t.companion);
        if (compTasks.length > 0) {
          const t = compTasks[Math.floor(Math.random() * compTasks.length)];
          // 先按自己要去的目的楼层;已登记则随机挑一层
          let target = t.targetFloor;
          if (target === floor || ev.lights.has(target)) {
            const candidates = Array.from({ length: ev.floors }, (_, i) => i + 1).filter(
              (f) => f !== floor && !ev.lights.has(f),
            );
            target = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : t.targetFloor;
          }
          this.familyAnim = { taskId: t.id, floor: target, phase: 'toPanel', t: 0 };
        }
      }
    } else {
      const a = this.familyAnim;
      a.t += frameDt;
      const dur = { toPanel: 1.1, press: 0.45, back: 1.1 };
      // 头顶气泡:走到面板与按下阶段显示
      const cm = this.companionModels.get(a.taskId);
      if (cm && a.phase !== 'back') {
        this.showBubble('按楼层按钮…', cm.position.x, cm.position.y + 1.85, cm.position.z);
      } else {
        this.walkBubble.visible = false;
      }
      if (a.t >= dur[a.phase]) {
        if (a.phase === 'toPanel') {
          this.engine.familyPressButton(a.floor); // 走到面板:按下按钮
          a.phase = 'press';
          a.t = 0;
        } else if (a.phase === 'press') {
          a.phase = 'back';
          a.t = 0;
        } else {
          this.familyAnim = null;
          this.walkBubble.visible = false;
        }
      }
    }

    // 家属陪护模型(占 1 格,平时守在病人旁)
    const comps = this.engine.getCompanionPlacements();
    const compAlive = new Set<number>();
    for (const [tid, cell] of comps) {
      const t = tasks.find((x) => x.id === tid);
      if (!t || t.status !== 'aboard') continue;
      compAlive.add(tid);
      let cm = this.companionModels.get(tid);
      if (!cm) {
        cm = buildPerson(PERSON_STYLES[tid % PERSON_STYLES.length]);
        this.companionModels.set(tid, cm);
        this.scene.add(cm);
      }
      cm.visible = true;
      const c = cellCenter(cell.col, cell.row, 1, 1);
      let tx = c.x;
      let tz = c.z;
      // 按键动画:走到面板前,再回到原位
      if (this.familyAnim && this.familyAnim.taskId === tid && this.familyAnim.phase !== 'back') {
        tx = PANEL_STAND.x;
        tz = PANEL_STAND.z;
      }
      cm.rotation.y = 0;
      cm.position.x += (tx - cm.position.x) * lerpK;
      cm.position.z += (tz - cm.position.z) * lerpK;
      cm.position.y = Math.sin(now * 2.4 + tid) * 0.015;
    }
    for (const [tid, cm] of this.companionModels) {
      if (!compAlive.has(tid)) {
        this.companionModels.delete(tid);
        this.scene.remove(cm);
        disposeGroup(cm);
      }
    }

    // 家属堵门:角色站在电梯门口(特殊位置,不在电梯内),头顶出现「别堵门!」按钮
    const famBlock = this.engine.familyActive;
    const smile = this.engine.smileActive;
    this.angryGuy.visible = famBlock || smile;
    if (famBlock) {
      this.angryGuy.position.set(0, 0, 0.35); // 门口(门洞内,堵住进出)
      this.angryGuy.rotation.y = 0;
      this.blockBtn.visible = true;
      this.blockBtn.position.set(0, 2.0, 0.35);
    } else {
      this.blockBtn.visible = false;
      if (smile) {
        this.angryGuy.position.set(1.15, 0, 0.95);
        this.angryGuy.rotation.y = Math.PI;
      }
    }
    this.warnSprite.visible = smile;
    if (smile) {
      const bob = Math.sin(now * 6) * 0.04;
      this.warnSprite.position.set(this.angryGuy.position.x, 2.05 + bob, this.angryGuy.position.z);
      this.warnSprite.scale.set(1.1 + Math.abs(Math.sin(now * 5)) * 0.15, 0.36, 1);
    }
    // 问话气泡到期隐藏(且没有其他动画占用)
    if (this.askBubbleUntil > 0 && performance.now() > this.askBubbleUntil) {
      this.askBubbleUntil = 0;
      if (!this.familyAnim && !this.hallAnim && !this.pressFirstAnim) {
        this.walkBubble.visible = false;
      }
    }
  }

  /** 玩家点击乘客询问"你要去哪层" */
  private askPassenger(taskId: number) {
    const t = this.engine.getTasks().find((x) => x.id === taskId);
    if (!t || t.status !== 'aboard') return;
    const m = this.models.get(taskId);
    if (!m) return;
    let text = '…';
    if (t.kind === 'stand') {
      text = `我要去 ${t.targetFloor} 楼!`;
      sfx.message();
    } else if (t.kind === 'wheelchair') {
      text = Math.random() < 0.5 ? `我要去 ${t.targetFloor} 楼!` : '阿巴阿巴阿巴…';
      sfx.message();
    }
    // 卧床/担架:不会回应(只显示…)
    this.showBubble(text, m.position.x, m.position.y + 1.9, m.position.z);
    this.askBubbleUntil = performance.now() + 2400;
  }

  private modelFor(t: Task): THREE.Group {
    let m = this.models.get(t.id);
    if (!m) {
      m = buildModelForKind(t.kind, PERSON_STYLES[t.id % PERSON_STYLES.length]);
      m.userData = { type: 'ask' as HitType, taskId: t.id };
      this.models.set(t.id, m);
      this.interactives.push(m);
      this.scene.add(m);
    }
    return m;
  }

  // ─── 清理 ────────────────────────────────────────────────────
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const el = this.canvas;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointerleave', this.onLeave);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mm of mats) {
        if (mm) {
          const map = (mm as THREE.MeshLambertMaterial).map;
          if (map) map.dispose();
          mm.dispose();
        }
      }
    });
    this.renderer.dispose();
  }
}

function shortName(name: string): string {
  return name.length > 6 ? `${name.slice(0, 6)}…` : name;
}

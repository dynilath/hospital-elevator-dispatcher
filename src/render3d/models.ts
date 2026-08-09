import * as THREE from 'three';
import type { PassengerKind } from '../types';

// ─── 像素配色(延续复古风) ───────────────────────────────────────
export const M = {
  skin: '#f2c9a0',
  hair: '#5b3a1e',
  hairGray: '#aeb6c4',
  outline: '#23263a',
  green: '#3fae5a',
  greenD: '#2b7a3e',
  blue: '#4a9be8',
  blueD: '#2f6fb3',
  purple: '#b381d6',
  purpleD: '#8a5fc0',
  orange: '#f08a3c',
  orangeD: '#c96a24',
  white: '#eef1f6',
  gray: '#9aa5b1',
  grayD: '#5c6470',
  red: '#e0453f',
  redD: '#a22c28',
};

export interface PersonStyle {
  body: string;
  bodyD: string;
  hair: string;
}

export const PERSON_STYLES: PersonStyle[] = [
  { body: M.green, bodyD: M.greenD, hair: M.hair },
  { body: M.blue, bodyD: M.blueD, hair: M.hairGray },
  { body: M.purple, bodyD: M.purpleD, hair: M.hair },
  { body: M.orange, bodyD: M.orangeD, hair: M.hairGray },
];

function box(w: number, h: number, d: number, color: string): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
}

function cyl(r: number, h: number, color: string): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), new THREE.MeshLambertMaterial({ color }));
}

/** 站立乘客(面向 -Z,高约 1.73) */
export function buildPerson(s: PersonStyle): THREE.Group {
  const g = new THREE.Group();
  // 腿
  const legL = box(0.12, 0.85, 0.14, s.bodyD);
  legL.position.set(-0.085, 0.425, 0);
  const legR = legL.clone();
  legR.position.x = 0.085;
  g.add(legL, legR);
  // 身体
  const torso = box(0.34, 0.5, 0.2, s.body);
  torso.position.set(0, 1.1, 0);
  g.add(torso);
  // 手臂
  const armL = box(0.09, 0.5, 0.13, s.body);
  armL.position.set(-0.225, 1.08, 0);
  const armR = armL.clone();
  armR.position.x = 0.225;
  g.add(armL, armR);
  // 头
  const head = box(0.24, 0.24, 0.24, M.skin);
  head.position.set(0, 1.56, 0);
  g.add(head);
  // 头发
  const hair = box(0.26, 0.1, 0.26, s.hair);
  hair.position.set(0, 1.69, 0);
  g.add(hair);
  // 鼻子(朝向 -Z)
  const nose = box(0.05, 0.05, 0.05, M.skin);
  nose.position.set(0, 1.55, -0.14);
  g.add(nose);
  return g;
}

/** 轮椅乘客(宽约 0.5) */
export function buildWheelchair(s: PersonStyle): THREE.Group {
  const g = new THREE.Group();
  // 大轮
  const wheelL = cyl(0.21, 0.07, M.grayD);
  wheelL.rotation.z = Math.PI / 2;
  wheelL.position.set(-0.17, 0.23, 0.08);
  const wheelR = wheelL.clone();
  wheelR.position.x = 0.17;
  g.add(wheelL, wheelR);
  // 前小轮
  const castL = cyl(0.09, 0.06, M.grayD);
  castL.rotation.z = Math.PI / 2;
  castL.position.set(-0.15, 0.09, -0.3);
  const castR = castL.clone();
  castR.position.x = 0.15;
  g.add(castL, castR);
  // 座垫与靠背
  const seat = box(0.44, 0.05, 0.4, M.grayD);
  seat.position.set(0, 0.46, -0.05);
  const back = box(0.44, 0.5, 0.06, M.grayD);
  back.position.set(0, 0.72, 0.17);
  g.add(seat, back);
  // 踏板
  const foot = box(0.4, 0.05, 0.1, M.grayD);
  foot.position.set(0, 0.28, -0.38);
  g.add(foot);
  // 乘客(坐姿)
  const head = box(0.22, 0.22, 0.22, M.skin);
  head.position.set(0, 1.02, 0.02);
  const hair = box(0.24, 0.09, 0.24, s.hair);
  hair.position.set(0, 1.14, 0.02);
  const torso = box(0.32, 0.4, 0.18, s.body);
  torso.position.set(0, 0.72, 0.0);
  const legL = box(0.12, 0.12, 0.34, s.bodyD);
  legL.position.set(-0.08, 0.5, -0.18);
  const legR = legL.clone();
  legR.position.x = 0.08;
  g.add(head, hair, torso, legL, legR);
  return g;
}

/** 卧床病床(长轴沿 X,长 1.75,高约 1.3 含输液架) */
export function buildBed(): THREE.Group {
  const g = new THREE.Group();
  // 床架
  const frame = box(1.75, 0.2, 0.72, M.grayD);
  frame.position.set(0, 0.32, 0);
  g.add(frame);
  // 床垫
  const mattress = box(1.6, 0.1, 0.66, M.white);
  mattress.position.set(0, 0.47, 0);
  g.add(mattress);
  // 枕头
  const pillow = box(0.32, 0.08, 0.55, M.white);
  pillow.position.set(-0.65, 0.55, 0);
  g.add(pillow);
  // 患者头
  const head = box(0.2, 0.15, 0.2, M.skin);
  head.position.set(-0.58, 0.66, 0);
  const hair = box(0.22, 0.06, 0.22, M.hairGray);
  hair.position.set(-0.58, 0.75, 0);
  g.add(head, hair);
  // 被子
  const blanket = box(1.15, 0.14, 0.68, M.blue);
  blanket.position.set(0.15, 0.59, 0);
  g.add(blanket);
  // 输液架
  const pole = cyl(0.02, 1.1, M.grayD);
  pole.position.set(0.75, 0.75, 0.3);
  const bag = box(0.14, 0.2, 0.06, M.white);
  bag.position.set(0.75, 1.28, 0.3);
  g.add(pole, bag);
  return g;
}

/** 急救床(长轴沿 X,红色 + 白十字) */
export function buildStretcher(): THREE.Group {
  const g = new THREE.Group();
  // 床架
  const frame = box(1.75, 0.16, 0.68, M.redD);
  frame.position.set(0, 0.36, 0);
  g.add(frame);
  // 轮子
  for (const sx of [-0.72, 0.72]) {
    for (const sz of [-0.28, 0.28]) {
      const w = cyl(0.09, 0.06, M.grayD);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx, 0.12, sz);
      g.add(w);
    }
  }
  // 床垫
  const mattress = box(1.6, 0.1, 0.62, M.white);
  mattress.position.set(0, 0.49, 0);
  g.add(mattress);
  // 患者头
  const head = box(0.2, 0.14, 0.2, M.skin);
  head.position.set(-0.62, 0.62, 0);
  const hair = box(0.22, 0.06, 0.22, M.hairGray);
  hair.position.set(-0.62, 0.7, 0);
  g.add(head, hair);
  // 红色盖布
  const blanket = box(1.15, 0.12, 0.64, M.red);
  blanket.position.set(0.15, 0.6, 0);
  g.add(blanket);
  // 白十字
  const crossV = box(0.1, 0.16, 0.02, M.white);
  crossV.position.set(0.35, 0.66, 0.33);
  const crossH = box(0.16, 0.1, 0.02, M.white);
  crossH.position.set(0.35, 0.66, 0.33);
  g.add(crossV, crossH);
  // 输液架
  const pole = cyl(0.02, 1.1, M.grayD);
  pole.position.set(0.78, 0.8, 0.3);
  const bag = box(0.14, 0.2, 0.06, M.white);
  bag.position.set(0.78, 1.33, 0.3);
  g.add(pole, bag);
  return g;
}

/** 按乘客类型构建模型 */
export function buildModelForKind(kind: PassengerKind, style: PersonStyle): THREE.Group {
  switch (kind) {
    case 'wheelchair':
      return buildWheelchair(style);
    case 'bed':
      return buildBed();
    case 'stretcher':
      return buildStretcher();
    default:
      return buildPerson(style);
  }
}

/** 模型占位宽度(沿 X) */
export function widthOfKind(kind: PassengerKind): number {
  switch (kind) {
    case 'wheelchair':
      return 0.5;
    case 'bed':
    case 'stretcher':
      return 1.78;
    default:
      return 0.36;
  }
}

/** 递归释放几何与材质 */
export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m.dispose();
    }
  });
}

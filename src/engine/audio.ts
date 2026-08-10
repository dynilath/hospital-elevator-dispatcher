// ─── Web Audio 合成音效(零资源) ────────────────────────────────

type Wave = OscillatorType;

// 元音 formant 表 (F1/F2/F3, Hz)——a 啊 / e 欸 / i 咦 / o 哦 / u 呜
const VOWEL_FORMANTS: readonly (readonly [number, number, number])[] = [
  [730, 1090, 2440],
  [530, 1840, 2480],
  [270, 2290, 3010],
  [570, 840, 2410],
  [440, 1020, 2240],
];

/** 嗓音方案:基频范围(高/低音) + formant 缩放(音色) + 音节时长范围(语速) */
interface VoiceProfile {
  f0Min: number;
  f0Max: number;
  formantScale: number;
  sylMin: number;
  sylMax: number;
}

/** 随机说话人方案:高音女声 / 中音 / 低音男声 / 低沉老者 */
const VOICE_PROFILES: readonly VoiceProfile[] = [
  { f0Min: 200, f0Max: 250, formantScale: 1.15, sylMin: 0.09, sylMax: 0.14 }, // 高音(女声)
  { f0Min: 140, f0Max: 185, formantScale: 1.0, sylMin: 0.11, sylMax: 0.17 }, // 中音
  { f0Min: 95, f0Max: 130, formantScale: 0.85, sylMin: 0.12, sylMax: 0.19 }, // 低音(男声)
  { f0Min: 80, f0Max: 105, formantScale: 0.78, sylMin: 0.14, sylMax: 0.22 }, // 低沉老者
];

/** 电话语音方案:偏高客服感音色 */
export const CALL_PROFILE: VoiceProfile = { f0Min: 210, f0Max: 250, formantScale: 1.1, sylMin: 0.1, sylMax: 0.15 };

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;
  /** 当前活动人声节点(新说话打断旧说话,防多角色同时发声混乱) */
  private vocalNodes: OscillatorNode[] = [];
  /** 缓存白噪声缓冲(用于辅音爆破音) */
  private noiseBuf: AudioBuffer | null = null;

  /** 需在用户手势中调用以解锁 AudioContext */
  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** 单个音调 */
  private tone(freq: number, dur: number, type: Wave = 'square', vol = 0.07, delay = 0, slideTo?: number) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 按楼层按钮 */
  press() {
    this.tone(880, 0.07, 'square', 0.06);
  }

  /** 收到消息 */
  message() {
    this.tone(620, 0.09, 'sine', 0.09);
    this.tone(930, 0.1, 'sine', 0.07, 0.09);
  }

  /** 紧急警报 */
  alarm() {
    this.tone(660, 0.16, 'square', 0.09);
    this.tone(990, 0.16, 'square', 0.09, 0.18);
    this.tone(660, 0.16, 'square', 0.09, 0.36);
  }

  /** 电梯启动 */
  liftStart() {
    this.tone(90, 0.5, 'sawtooth', 0.04, 0, 140);
  }

  /** 到站叮咚 */
  ding() {
    this.tone(1245, 0.18, 'sine', 0.1);
    this.tone(830, 0.28, 'sine', 0.1, 0.16);
  }

  /** 提醒乘客往里走 */
  remind() {
    this.tone(440, 0.12, 'square', 0.08);
    this.tone(440, 0.12, 'square', 0.08, 0.16);
  }

  /** 拥挤警告 */
  crowd() {
    this.tone(240, 0.25, 'sawtooth', 0.06, 0, 180);
  }

  /** 送达成功 */
  success() {
    this.tone(523, 0.1, 'square', 0.07);
    this.tone(659, 0.1, 'square', 0.07, 0.1);
    this.tone(784, 0.18, 'square', 0.07, 0.2);
  }

  /** 超时失败 */
  fail() {
    this.tone(330, 0.2, 'sawtooth', 0.08, 0, 220);
    this.tone(220, 0.35, 'sawtooth', 0.08, 0.2, 140);
  }

  /** 工勤拍门声 */
  knock() {
    this.tone(150, 0.08, 'square', 0.09);
    this.tone(120, 0.08, 'square', 0.09, 0.18);
    this.tone(150, 0.08, 'square', 0.09, 0.36);
  }

  /** 怒吼电话(工勤来电) */
  angry() {
    this.tone(180, 0.3, 'sawtooth', 0.09, 0, 260);
    this.tone(260, 0.3, 'sawtooth', 0.07, 0.32, 180);
  }

  /** 电话铃声(来电) */
  ring() {
    this.tone(880, 0.12, 'sine', 0.08);
    this.tone(880, 0.12, 'sine', 0.08, 0.18);
    this.tone(660, 0.16, 'sine', 0.07, 0.36);
  }

  /** 打字音(模拟语音播报) */
  tick() {
    this.tone(1400 + Math.random() * 400, 0.02, 'square', 0.028);
  }

  /** 模拟人声(Simlish 风格呜咽呢喃):formant 合成元音音节序列;新说话打断旧说话 */
  vocalize(durationMs = 1200, profile?: VoiceProfile) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    this.stopVocal();
    const p = profile ?? VOICE_PROFILES[(Math.random() * VOICE_PROFILES.length) | 0];
    const base = p.f0Min + Math.random() * (p.f0Max - p.f0Min);
    const t0 = ctx.currentTime + 0.02;
    let t = t0;
    const end = t0 + durationMs / 1000;
    while (t < end) {
      const dur = Math.min(p.sylMin + Math.random() * (p.sylMax - p.sylMin), end - t);
      if (dur >= 0.05) {
        const formants = VOWEL_FORMANTS[(Math.random() * VOWEL_FORMANTS.length) | 0];
        this.syllable(t, dur, base * (0.85 + Math.random() * 0.3), formants, p.formantScale);
      }
      t += dur;
    }
  }

  /** 阿巴阿巴专用人声:低沉含糊,「阿-巴」双音节重复(低通噪声模拟双唇爆破音) */
  vocalizeBabble(durationMs = 1200) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    this.stopVocal();
    const f0 = 85 + Math.random() * 25; // 低沉含糊
    const aFormants: readonly [number, number, number] = [620, 900, 2300]; // 「阿」
    const t0 = ctx.currentTime + 0.02;
    let t = t0;
    const end = t0 + durationMs / 1000;
    while (t < end) {
      // 阿(长元音)
      const aDur = Math.min(0.2 + Math.random() * 0.08, end - t);
      this.syllable(t, aDur, f0 * (0.9 + Math.random() * 0.2), aFormants, 0.8, 5);
      t += aDur;
      if (t >= end) break;
      // 巴(双唇爆破 + 短元音)
      const bDur = Math.min(0.13 + Math.random() * 0.05, end - t);
      const burst = Math.min(0.05, bDur * 0.4);
      this.burstNoise(t, burst, f0);
      this.syllable(t + burst, Math.max(0.03, bDur - burst), f0 * (0.9 + Math.random() * 0.2), aFormants, 0.8, 5);
      t += bDur;
    }
  }

  /** 打断当前人声(新说话顶掉旧说话) */
  private stopVocal() {
    for (const o of this.vocalNodes) {
      try {
        o.stop();
      } catch {
        // 已停止
      }
    }
    this.vocalNodes = [];
  }

  /** 单个音节:sawtooth 声源 + 轻微颤音,经元音 formant 带通滤波与音量包络 */
  private syllable(
    t: number,
    dur: number,
    f0: number,
    formants: readonly [number, number, number],
    formantScale = 1,
    q = 7,
  ) {
    const ctx = this.ctx!;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    // 轻微颤音(≈5.5Hz,±4% 基频),音高更自然
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibGain = ctx.createGain();
    vibGain.gain.value = f0 * 0.04;
    vib.connect(vibGain);
    vibGain.connect(osc.frequency);
    // 包络(快 attack,慢 release,避免爆音)
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.9, t + 0.025);
    env.gain.setValueAtTime(0.9, t + Math.max(0.005, dur - 0.06));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env);
    // formant 带通滤波(并联),合入主音量
    for (const f of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * formantScale;
      bp.Q.value = q;
      env.connect(bp);
      bp.connect(this.master);
    }
    this.vocalNodes.push(osc, vib);
    osc.start(t);
    vib.start(t);
    osc.stop(t + dur + 0.02);
    vib.stop(t + dur + 0.02);
  }

  /** 短促低通噪声(双唇爆破音,如「巴」的 b) */
  private burstNoise(t: number, dur: number, f0: number) {
    const ctx = this.ctx!;
    if (!ctx || !this.master) return;
    if (!this.noiseBuf) {
      this.noiseBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.2), ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = f0 * 4; // 低频爆破
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** 家属叫骂声(模拟) */
  scold() {
    this.tone(220, 0.14, 'sawtooth', 0.1, 0, 300);
    this.tone(300, 0.1, 'sawtooth', 0.08, 0.16, 240);
    this.tone(190, 0.16, 'sawtooth', 0.09, 0.28, 260);
  }

  /** 下班结算 */
  dayEnd() {
    this.tone(523, 0.12, 'square', 0.08);
    this.tone(659, 0.12, 'square', 0.08, 0.12);
    this.tone(784, 0.12, 'square', 0.08, 0.24);
    this.tone(1046, 0.4, 'square', 0.08, 0.36);
  }
}

export const sfx = new Sfx();

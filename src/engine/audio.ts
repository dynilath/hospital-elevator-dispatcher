// ─── Web Audio 合成音效(零资源) ────────────────────────────────

type Wave = OscillatorType;

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

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

// Wiedergabe von Gesprächsaufnahmen mit Web Audio:
//  • beide Spuren (wir / Kunde) getrennt lauter oder leiser
//  • beide Spuren auf beiden Ohren (Twilio legt sie sonst links/rechts)
//  • „Sprache verbessern“: Brummen und Rauschen weg, Sprachbereich betont, leise Stellen lauter
//  • Tempo ohne Mickymaus-Effekt (Tonhöhe bleibt)
// Fällt ohne Web Audio auf die normale Wiedergabe zurück.

type Listener = () => void;

export interface EngineState {
  ready: boolean;
  playing: boolean;
  loading: boolean;
  time: number;
  duration: number;
  rate: number;
  agentGain: number;
  customerGain: number;
  enhance: boolean;
  error: string | null;
}

export class AudioEngine {
  readonly el: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private graphBuilt = false;
  private gainA: GainNode | null = null;
  private gainC: GainNode | null = null;
  private mix: GainNode | null = null;
  private enhanceIn: AudioNode | null = null;
  private enhanceOut: AudioNode | null = null;
  private listeners = new Set<Listener>();
  private raf = 0;
  state: EngineState = {
    ready: false,
    playing: false,
    loading: false,
    time: 0,
    duration: 0,
    rate: 1,
    agentGain: 1,
    customerGain: 1,
    enhance: false,
    error: null,
  };

  constructor(private channels: number, private agentChannel: number | null, duration = 0) {
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.crossOrigin = 'anonymous';
    (this.el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    this.state.duration = duration;
    this.el.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(this.el.duration)) this.set({ duration: this.el.duration });
    });
    this.el.addEventListener('canplay', () => this.set({ ready: true, loading: false }));
    this.el.addEventListener('play', () => {
      this.set({ playing: true });
      this.tick();
    });
    this.el.addEventListener('pause', () => this.set({ playing: false, time: this.el.currentTime }));
    this.el.addEventListener('ended', () => this.set({ playing: false, time: this.el.duration || this.state.time }));
    this.el.addEventListener('seeked', () => this.set({ time: this.el.currentTime }));
    this.el.addEventListener('error', () => this.set({ loading: false, error: 'Die Aufnahme konnte nicht geladen werden.' }));
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  private tick = () => {
    cancelAnimationFrame(this.raf);
    if (this.el.paused) return;
    this.set({ time: this.el.currentTime });
    this.raf = requestAnimationFrame(this.tick);
  };

  get loaded() {
    return !!this.el.src;
  }

  load(url: string) {
    this.set({ loading: true, error: null });
    this.el.src = url;
    this.el.load();
  }

  // Erst beim ersten Abspielen (Nutzeraktion) – Browser erlauben Audio sonst nicht
  private buildGraph() {
    if (this.graphBuilt) return;
    this.graphBuilt = true;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const src = ctx.createMediaElementSource(this.el);
      const mix = ctx.createGain();
      if (this.channels >= 2) {
        const split = ctx.createChannelSplitter(2);
        src.connect(split);
        const agentIdx = (this.agentChannel ?? 1) - 1;
        const gA = ctx.createGain();
        const gC = ctx.createGain();
        split.connect(gA, agentIdx === 1 ? 1 : 0);
        split.connect(gC, agentIdx === 1 ? 0 : 1);
        // beide Spuren in die Mitte (beide Ohren)
        const merge = ctx.createChannelMerger(2);
        for (const g of [gA, gC]) {
          g.connect(merge, 0, 0);
          g.connect(merge, 0, 1);
        }
        // zwei Spuren addiert → etwas leiser, damit nichts übersteuert
        mix.gain.value = 0.85;
        merge.connect(mix);
        this.gainA = gA;
        this.gainC = gC;
        gA.gain.value = this.state.agentGain;
        gC.gain.value = this.state.customerGain;
      } else {
        src.connect(mix);
      }
      // Sprachverbesserung
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 110;
      hp.Q.value = 0.7;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3600;
      lp.Q.value = 0.7;
      const presence = ctx.createBiquadFilter();
      presence.type = 'peaking';
      presence.frequency.value = 2200;
      presence.Q.value = 0.9;
      presence.gain.value = 4;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -30;
      comp.knee.value = 18;
      comp.ratio.value = 3.5;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;
      const makeup = ctx.createGain();
      makeup.gain.value = 1.7;
      hp.connect(lp).connect(presence).connect(comp).connect(makeup);
      this.enhanceIn = hp;
      this.enhanceOut = makeup;
      this.mix = mix;
      this.ctx = ctx;
      this.route();
    } catch {
      // Web Audio nicht verfügbar → normale Wiedergabe
      this.ctx = null;
    }
  }

  private route() {
    if (!this.ctx || !this.mix || !this.enhanceIn || !this.enhanceOut) return;
    this.mix.disconnect();
    this.enhanceOut.disconnect();
    if (this.state.enhance) {
      this.mix.connect(this.enhanceIn);
      this.enhanceOut.connect(this.ctx.destination);
    } else {
      this.mix.connect(this.ctx.destination);
    }
  }

  async play() {
    this.buildGraph();
    try {
      await this.ctx?.resume();
      await this.el.play();
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  pause() {
    this.el.pause();
  }

  toggle() {
    return this.el.paused ? this.play() : (this.pause(), Promise.resolve());
  }

  seek(t: number) {
    const max = this.state.duration || this.el.duration || 0;
    const v = Math.max(0, Math.min(max || t, t));
    this.el.currentTime = v;
    this.set({ time: v });
  }

  skip(sec: number) {
    this.seek(this.el.currentTime + sec);
  }

  setRate(rate: number) {
    this.el.playbackRate = rate;
    this.set({ rate });
  }

  setGains(agent: number, customer: number) {
    if (this.gainA) this.gainA.gain.value = agent;
    if (this.gainC) this.gainC.gain.value = customer;
    this.set({ agentGain: agent, customerGain: customer });
  }

  setEnhance(on: boolean) {
    this.set({ enhance: on });
    this.route();
  }

  get canMix() {
    return this.channels >= 2;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    this.ctx?.close().catch(() => undefined);
    this.listeners.clear();
  }
}

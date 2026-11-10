// 효과음: WebAudio로 그 자리에서 만든다 (소리 파일 없음).
// 브라우저는 사용자 입력(클릭) 안에서만 소리를 허락한다 → primeAudio를 클릭 처리 안에서 불러 AudioContext를
// 만들고 깨워 둔다. 실제 소리(playTie)는 그 뒤 연출 중(클릭 밖)에 난다.

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** 노이즈 버스트 길이 s */
const NOISE_S = 0.03;
/** 낮은 클릭 길이 s */
const CLICK_S = 0.09;
/** 전체 크기 (작게) */
const VOLUME = 0.12;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
  } catch {
    return null; // WebAudio가 없는 환경이면 조용히
  }
  const n = Math.ceil(ctx.sampleRate * NOISE_S);
  noise = ctx.createBuffer(1, n, ctx.sampleRate);
  const ch = noise.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  return ctx;
}

/** 클릭(사용자 입력) 처리 안에서 부름: AudioContext를 만들거나 멈춰 있으면 다시 깨움 */
export function primeAudio(): void {
  const ac = audio();
  if (ac?.state === 'suspended') void ac.resume();
}

/** 벨크로 묶는 "탁": 짧은 노이즈 버스트 + 낮은 클릭 (전체 150ms 안쪽) */
export function playTie(): void {
  const ac = audio();
  if (!ac || !noise) return;
  if (ac.state === 'suspended') void ac.resume();
  const t = ac.currentTime;
  const out = ac.createGain();
  out.gain.value = VOLUME;
  out.connect(ac.destination);

  // 찍찍 붙는 소리: 높은 쪽만 남긴 노이즈
  const src = ac.createBufferSource();
  src.buffer = noise;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  src.connect(hp).connect(out);
  src.start(t);

  // 탁: 빠르게 내려가는 낮은 사인
  const osc = ac.createOscillator();
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + CLICK_S);
  const env = ac.createGain();
  env.gain.setValueAtTime(1, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + CLICK_S);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + CLICK_S);
  osc.onended = () => out.disconnect();
}

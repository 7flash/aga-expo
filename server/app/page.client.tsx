import { render } from 'tradjs/client';
import * as THREE from 'three';

type Role = 'user' | 'assistant';

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
};

type ChatState = {
  conversationId: number | null;
  messages: ChatMessage[];
  transcript: string;
  loading: boolean;
  listening: boolean;
  speaking: boolean;
  speechSupported: boolean;
  error: string | null;
};

declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

const state: ChatState = {
  conversationId: null,
  messages: [
    {
      id: 'welcome',
      role: 'assistant',
      createdAt: new Date().toISOString(),
      content:
        'I’m Geeksy. Tap the mic, speak naturally, and I’ll answer with the avatar front and center.',
    },
  ],
  transcript: '',
  loading: false,
  listening: false,
  speaking: false,
  speechSupported: false,
  error: null,
};

let root: HTMLElement | null = null;
let recognition: any = null;

let stageHost: HTMLElement | null = null;
let stageRenderer: THREE.WebGLRenderer | null = null;
let stageScene: THREE.Scene | null = null;
let stageCamera: THREE.PerspectiveCamera | null = null;
let avatarGroup: THREE.Group | null = null;
let orbGroup: THREE.Group | null = null;
let faceGroup: THREE.Group | null = null;
let eyeLeft: THREE.Mesh | null = null;
let eyeRight: THREE.Mesh | null = null;
let mouthMesh: THREE.Mesh | null = null;
let antennaTipMesh: THREE.Mesh | null = null;
let blushLeft: THREE.Mesh | null = null;
let blushRight: THREE.Mesh | null = null;
let hoverRing: THREE.Mesh | null = null;
let resizeObserver: ResizeObserver | null = null;
let animationFrame = 0;
let clock: THREE.Clock | null = null;

const spokenHints = [
  '“Geeksy, plan my day”',
  '“Summarize this idea”',
  '“Help me debug my app”',
];

function createMessage(role: Role, content: string): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value)
  );
}

function getRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function ensureRecognition() {
  if (recognition) return recognition;

  const RecognitionCtor = getRecognitionCtor();
  if (!RecognitionCtor) return null;

  recognition = new RecognitionCtor();
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    state.listening = true;
    state.error = null;
    state.transcript = '';
    update();
  };

  recognition.onresult = (event: any) => {
    let transcript = '';

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      transcript += event.results[index][0]?.transcript ?? '';
    }

    state.transcript = transcript.trim();
    update();
  };

  recognition.onerror = (event: any) => {
    state.listening = false;
    state.error =
      event?.error === 'not-allowed'
        ? 'Microphone permission was blocked.'
        : 'Voice capture failed. Please try again.';
    update();
  };

  recognition.onend = () => {
    const transcript = state.transcript.trim();
    state.listening = false;
    update();

    if (transcript && !state.loading) {
      void sendVoiceMessage(transcript);
    }
  };

  return recognition;
}

function speakReply(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1.06;
  utterance.onstart = () => {
    state.speaking = true;
    update();
  };
  utterance.onend = () => {
    state.speaking = false;
    update();
  };
  utterance.onerror = () => {
    state.speaking = false;
    update();
  };

  window.speechSynthesis.speak(utterance);
}

async function sendVoiceMessage(text: string) {
  const cleanText = text.trim();
  if (!cleanText || state.loading) return;

  state.messages.push(createMessage('user', cleanText));
  state.transcript = '';
  state.loading = true;
  state.error = null;
  update();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: state.conversationId,
        message: cleanText,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error ?? 'Geeksy could not reply.');
    }

    state.conversationId = data.conversationId;
    state.messages.push(createMessage('assistant', data.reply));
    speakReply(data.reply);
  } catch (error) {
    state.error = error instanceof Error ? error.message : 'Something went wrong.';
    state.messages.push(createMessage('assistant', `Sorry, I hit a glitch: ${state.error}`));
  } finally {
    state.loading = false;
    update();
  }
}

function toggleVoiceInput() {
  if (state.loading) return;

  const activeRecognition = ensureRecognition();
  if (!activeRecognition) {
    state.error = 'This browser does not support voice input. Try Chrome or Safari.';
    update();
    return;
  }

  if (state.listening) {
    activeRecognition.stop();
    return;
  }

  state.error = null;
  state.transcript = '';
  update();
  activeRecognition.start();
}

function clearTranscript() {
  state.transcript = '';
  state.error = null;
  update();
}

function scrollMessagesToBottom() {
  requestAnimationFrame(() => {
    const list = document.querySelector('.message-strip');
    if (list) list.scrollTop = list.scrollHeight;
  });
}

function update() {
  if (!root) return;
  render(<AssistantOverlay />, root);
  scrollMessagesToBottom();
}

function MiniAvatar({ role }: { role: Role }) {
  return (
    <div class={`mini-avatar ${role === 'assistant' ? 'assistant-avatar' : 'user-avatar'}`} aria-hidden="true">
      <span>{role === 'assistant' ? 'G' : 'You'}</span>
    </div>
  );
}

function TypingBubble() {
  return (
    <div class="message-row assistant typing-row">
      <MiniAvatar role="assistant" />
      <div class="message-stack">
        <div class="bubble typing-bubble" aria-label="Geeksy is thinking">
          <span class="typing-dot" />
          <span class="typing-dot" />
          <span class="typing-dot" />
        </div>
        <span class="message-meta">Geeksy is thinking…</span>
      </div>
    </div>
  );
}

function AssistantOverlay() {
  const visibleMessages = state.messages.slice(-4);
  const statusLabel = state.listening
    ? 'Listening'
    : state.loading
      ? 'Thinking'
      : state.speaking
        ? 'Talking'
        : 'Ready';

  return (
    <section class="dock" aria-label="Geeksy voice chat dock">
      <div class="dock-header">
        <div>
          <p class="dock-kicker">Voice-first assistant</p>
          <h2>Speak to Geeksy</h2>
          <p class="dock-copy">A glassmorphic interface with just a few recent messages and a live 3D avatar.</p>
        </div>
        <div class={`status-badge ${state.listening ? 'is-live' : ''}`}>
          <span class="status-badge-dot" />
          <span>{statusLabel}</span>
        </div>
      </div>

      <div class="message-strip" aria-live="polite">
        {visibleMessages.map((message) => (
          <div class={`message-row ${message.role}`} key={message.id}>
            <MiniAvatar role={message.role} />
            <div class="message-stack">
              <div class="bubble">{message.content}</div>
              <span class="message-meta">
                {message.role === 'assistant' ? 'Geeksy' : 'You'} · {formatTime(message.createdAt)}
              </span>
            </div>
          </div>
        ))}
        {state.loading && <TypingBubble />}
      </div>

      {state.error && <p class="error-note">{state.error}</p>}

      <div class="voice-bar">
        <button
          type="button"
          class={`mic-button ${state.listening ? 'listening' : ''}`}
          aria-label={state.listening ? 'Stop listening' : 'Start voice input'}
          onClick={toggleVoiceInput}
          disabled={state.loading}
        >
          <span class="mic-ripple ripple-one" aria-hidden="true" />
          <span class="mic-ripple ripple-two" aria-hidden="true" />
          <span class="mic-icon" aria-hidden="true">🎙</span>
        </button>

        <div class="transcript-card">
          <span class="transcript-label">
            {state.listening
              ? 'Listening now…'
              : state.transcript
                ? 'Voice captured'
                : state.speechSupported
                  ? 'Voice input only'
                  : 'Microphone unsupported'}
          </span>
          <strong>
            {state.transcript ||
              (state.speechSupported
                ? 'Tap the mic and speak naturally.'
                : 'Open Geeksy in a browser with Speech Recognition support.')}
          </strong>
          <div class="hint-row" aria-hidden="true">
            {spokenHints.map((hint) => (
              <span key={hint}>{hint}</span>
            ))}
          </div>
        </div>

        <button type="button" class="ghost-button" onClick={clearTranscript} disabled={!state.transcript && !state.error}>
          Clear
        </button>
      </div>
    </section>
  );
}

function destroyStage() {
  cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  resizeObserver = null;

  if (stageRenderer) {
    stageRenderer.dispose();
    const canvas = stageRenderer.domElement;
    canvas.remove();
  }

  stageRenderer = null;
  stageScene = null;
  stageCamera = null;
  avatarGroup = null;
  orbGroup = null;
  faceGroup = null;
  eyeLeft = null;
  eyeRight = null;
  mouthMesh = null;
  antennaTipMesh = null;
  blushLeft = null;
  blushRight = null;
  hoverRing = null;
  clock = null;
}

function fitStage() {
  if (!stageHost || !stageRenderer || !stageCamera) return;

  const width = stageHost.clientWidth || 1;
  const height = stageHost.clientHeight || 1;

  stageCamera.aspect = width / height;
  stageCamera.updateProjectionMatrix();
  stageRenderer.setSize(width, height, false);
  stageRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
}

function animateStage() {
  if (!stageRenderer || !stageScene || !stageCamera || !avatarGroup || !clock) return;

  const t = clock.getElapsedTime();
  const isActive = state.listening || state.loading || state.speaking;
  const talkWave = state.speaking || state.loading ? Math.abs(Math.sin(t * 10.5)) : 0;

  avatarGroup.rotation.y = Math.sin(t * 0.55) * 0.42;
  avatarGroup.rotation.z = Math.sin(t * 0.75) * 0.035;
  avatarGroup.position.y = Math.sin(t * 1.05) * 0.18;
  avatarGroup.scale.setScalar(isActive ? 1 + Math.sin(t * 4.5) * 0.012 : 1);

  if (faceGroup) {
    faceGroup.rotation.y = Math.sin(t * 0.9) * 0.055;
    faceGroup.position.y = 0.26 + Math.sin(t * 1.4) * 0.025;
  }

  if (orbGroup) {
    orbGroup.rotation.y = -t * (state.listening ? 1.18 : 0.58);
    orbGroup.rotation.x = Math.sin(t * 0.65) * 0.24;
    orbGroup.scale.setScalar(state.listening ? 1.08 + Math.sin(t * 5) * 0.03 : 1);
  }

  const blink = Math.sin(t * 1.3) > 0.985 ? 0.12 : 1;
  const eyeScale = state.listening ? 1.13 : state.speaking ? 1.05 : 1;
  if (eyeLeft) eyeLeft.scale.set(eyeScale, blink * eyeScale, eyeScale);
  if (eyeRight) eyeRight.scale.set(eyeScale, blink * eyeScale, eyeScale);

  if (mouthMesh) {
    mouthMesh.scale.x = state.speaking || state.loading ? 1 + talkWave * 0.9 : 1;
    mouthMesh.scale.y = state.speaking || state.loading ? 0.55 + talkWave * 1.7 : state.listening ? 0.42 : 0.22;
  }

  if (antennaTipMesh) {
    const material = antennaTipMesh.material as THREE.MeshStandardMaterial;
    material.emissiveIntensity = state.listening ? 2.1 + Math.sin(t * 9) * 0.4 : state.speaking ? 1.8 + talkWave * 0.8 : 1.15;
    antennaTipMesh.scale.setScalar(state.listening ? 1.15 + Math.sin(t * 8) * 0.08 : 1);
  }

  if (blushLeft && blushRight) {
    const opacity = state.speaking ? 0.45 + talkWave * 0.28 : state.listening ? 0.54 : 0.28;
    (blushLeft.material as THREE.MeshBasicMaterial).opacity = opacity;
    (blushRight.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  if (hoverRing) {
    hoverRing.rotation.z = t * 0.35;
    hoverRing.scale.setScalar(state.listening ? 1.08 + Math.sin(t * 6) * 0.04 : 1 + Math.sin(t * 1.8) * 0.015);
  }

  stageRenderer.render(stageScene, stageCamera);
  animationFrame = requestAnimationFrame(animateStage);
}

function initThreeStage() {
  const nextHost = document.getElementById('three-stage');
  if (!nextHost) return;

  if (stageHost === nextHost && stageRenderer) {
    fitStage();
    return;
  }

  destroyStage();
  stageHost = nextHost;
  stageHost.innerHTML = '';

  stageScene = new THREE.Scene();
  stageCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  stageCamera.position.set(0, 0.42, 7.4);

  stageRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  stageRenderer.setClearAlpha(0);
  stageRenderer.outputColorSpace = THREE.SRGBColorSpace;
  stageHost.appendChild(stageRenderer.domElement);

  clock = new THREE.Clock();

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.45);
  const keyLight = new THREE.DirectionalLight(0xc7d2fe, 2.35);
  keyLight.position.set(4, 5, 5);
  const faceLight = new THREE.PointLight(0x67e8f9, 28, 18, 1.7);
  faceLight.position.set(0, 0.4, 4.2);
  const pinkRim = new THREE.PointLight(0xf9a8d4, 24, 18, 1.8);
  pinkRim.position.set(-3.8, 0.8, 3.8);
  const blueRim = new THREE.PointLight(0x60a5fa, 28, 20, 1.7);
  blueRim.position.set(3.8, -0.8, 3.6);
  stageScene.add(ambientLight, keyLight, faceLight, pinkRim, blueRim);

  avatarGroup = new THREE.Group();
  stageScene.add(avatarGroup);

  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xbff8ff,
    transmission: 0.92,
    transparent: true,
    opacity: 0.42,
    thickness: 0.9,
    roughness: 0.04,
    metalness: 0.02,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });

  const shell = new THREE.Mesh(new THREE.SphereGeometry(2.08, 72, 72), glassMaterial);
  shell.scale.set(0.96, 1.08, 0.96);
  avatarGroup.add(shell);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x1e3a8a,
    emissive: 0x2563eb,
    emissiveIntensity: 0.52,
    roughness: 0.28,
    metalness: 0.18,
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.78, 0.86, 18, 36), bodyMaterial);
  body.position.set(0, -0.78, 0.02);
  body.scale.set(1.1, 1, 0.72);
  avatarGroup.add(body);

  const chestPanel = new THREE.Mesh(
    new THREE.CircleGeometry(0.31, 42),
    new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.62 })
  );
  chestPanel.position.set(0, -0.67, 0.66);
  avatarGroup.add(chestPanel);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(1.18, 64, 64),
    new THREE.MeshStandardMaterial({
      color: 0x93c5fd,
      emissive: 0x312e81,
      emissiveIntensity: 0.24,
      roughness: 0.18,
      metalness: 0.08,
    })
  );
  head.position.set(0, 0.44, 0.02);
  head.scale.set(1.12, 1.0, 0.86);
  avatarGroup.add(head);

  const visorMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xe0f2fe,
    transmission: 0.72,
    transparent: true,
    opacity: 0.84,
    thickness: 0.18,
    roughness: 0.04,
    metalness: 0,
  });

  faceGroup = new THREE.Group();
  faceGroup.position.set(0, 0.26, 0.92);
  avatarGroup.add(faceGroup);

  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.9, 48, 48), visorMaterial);
  visor.scale.set(1.08, 0.66, 0.24);
  faceGroup.add(visor);

  const glassesMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x60a5fa,
    emissiveIntensity: 0.34,
    metalness: 0.45,
    roughness: 0.18,
  });

  const leftFrame = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.032, 18, 54), glassesMaterial);
  leftFrame.position.set(-0.34, 0.1, 0.17);
  leftFrame.scale.set(1.04, 0.86, 1);
  const rightFrame = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.032, 18, 54), glassesMaterial);
  rightFrame.position.set(0.34, 0.1, 0.17);
  rightFrame.scale.set(1.04, 0.86, 1);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.035, 0.045), glassesMaterial);
  bridge.position.set(0, 0.1, 0.19);
  faceGroup.add(leftFrame, rightFrame, bridge);

  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x0f172a });
  const eyeGlowMaterial = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.52 });

  const leftEyeGlow = new THREE.Mesh(new THREE.CircleGeometry(0.105, 32), eyeGlowMaterial);
  leftEyeGlow.position.set(-0.34, 0.1, 0.215);
  const rightEyeGlow = new THREE.Mesh(new THREE.CircleGeometry(0.105, 32), eyeGlowMaterial.clone());
  rightEyeGlow.position.set(0.34, 0.1, 0.215);
  faceGroup.add(leftEyeGlow, rightEyeGlow);

  eyeLeft = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 20), eyeMaterial);
  eyeLeft.position.set(-0.34, 0.1, 0.235);
  eyeRight = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 20), eyeMaterial.clone());
  eyeRight.position.set(0.34, 0.1, 0.235);
  faceGroup.add(eyeLeft, eyeRight);

  const mouthMaterial = new THREE.MeshBasicMaterial({ color: 0x1d4ed8 });
  mouthMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.23, 10, 18), mouthMaterial);
  mouthMesh.rotation.z = Math.PI / 2;
  mouthMesh.position.set(0, -0.2, 0.24);
  mouthMesh.scale.set(1, 0.22, 1);
  faceGroup.add(mouthMesh);

  const blushMaterial = new THREE.MeshBasicMaterial({ color: 0xf9a8d4, transparent: true, opacity: 0.28 });
  blushLeft = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), blushMaterial);
  blushLeft.position.set(-0.62, -0.11, 0.2);
  blushRight = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), blushMaterial.clone());
  blushRight.position.set(0.62, -0.11, 0.2);
  faceGroup.add(blushLeft, blushRight);

  const earMaterial = new THREE.MeshStandardMaterial({
    color: 0x67e8f9,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.35,
    roughness: 0.2,
    metalness: 0.12,
  });

  const leftEar = new THREE.Mesh(new THREE.SphereGeometry(0.24, 32, 32), earMaterial);
  leftEar.position.set(-1.18, 0.5, 0.02);
  leftEar.scale.set(0.62, 1, 0.5);
  const rightEar = new THREE.Mesh(new THREE.SphereGeometry(0.24, 32, 32), earMaterial.clone());
  rightEar.position.set(1.18, 0.5, 0.02);
  rightEar.scale.set(0.62, 1, 0.5);
  avatarGroup.add(leftEar, rightEar);

  const antenna = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.045, 0.58, 8, 18),
    new THREE.MeshStandardMaterial({ color: 0xdbeafe, emissive: 0x60a5fa, emissiveIntensity: 0.35 })
  );
  antenna.position.set(0, 1.62, 0.02);
  avatarGroup.add(antenna);

  antennaTipMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 28, 28),
    new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xfef08a, emissiveIntensity: 1.15 })
  );
  antennaTipMesh.position.set(0, 2.04, 0.02);
  avatarGroup.add(antennaTipMesh);

  const armMaterial = new THREE.MeshStandardMaterial({
    color: 0xa5f3fc,
    emissive: 0x60a5fa,
    emissiveIntensity: 0.25,
    roughness: 0.22,
    metalness: 0.1,
  });

  const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.74, 12, 24), armMaterial);
  leftArm.position.set(-1.05, -0.72, 0.08);
  leftArm.rotation.z = 0.58;
  const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.74, 12, 24), armMaterial.clone());
  rightArm.position.set(1.05, -0.72, 0.08);
  rightArm.rotation.z = -0.58;
  avatarGroup.add(leftArm, rightArm);

  hoverRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.45, 0.045, 20, 96),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x67e8f9,
      emissiveIntensity: 0.95,
      transparent: true,
      opacity: 0.72,
    })
  );
  hoverRing.rotation.x = Math.PI / 2;
  hoverRing.position.y = -1.76;
  avatarGroup.add(hoverRing);

  orbGroup = new THREE.Group();
  avatarGroup.add(orbGroup);

  const orbMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x67e8f9, emissiveIntensity: 1.2 }),
    new THREE.MeshStandardMaterial({ color: 0xf9a8d4, emissive: 0xf9a8d4, emissiveIntensity: 1.15 }),
    new THREE.MeshStandardMaterial({ color: 0xa78bfa, emissive: 0xa78bfa, emissiveIntensity: 1.1 }),
  ];

  for (let index = 0; index < 8; index += 1) {
    const orb = new THREE.Mesh(new THREE.SphereGeometry(index % 2 ? 0.055 : 0.075, 16, 16), orbMaterials[index % orbMaterials.length]);
    const angle = (Math.PI * 2 * index) / 8;
    orb.position.set(Math.cos(angle) * 2.62, Math.sin(angle * 1.45) * 0.88, Math.sin(angle) * 1.18);
    orbGroup.add(orb);
  }

  const floorGlow = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 72),
    new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.12 })
  );
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.set(0, -2.16, 0);
  stageScene.add(floorGlow);

  fitStage();
  resizeObserver = new ResizeObserver(() => fitStage());
  resizeObserver.observe(stageHost);
  animateStage();
}

export default function mount() {
  root = document.getElementById('assistant-root');
  state.speechSupported = typeof window !== 'undefined' && !!getRecognitionCtor();
  initThreeStage();
  update();
}

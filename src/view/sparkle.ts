import * as THREE from 'three';

// 반짝임: 그 자리에서 잠깐 커지며 흐려지는 빛 스프라이트 (묶기·보너스 연출 공용)

/** 반짝 시간 */
const SPARKLE_MS = 200;

export interface Sparkles {
  /** 그 월드 위치에 반짝 하나 */
  at(p: THREE.Vector3): void;
  /** 매 프레임: 커지며 흐려지고, 끝나면 걷어냄 */
  sync(dtMs: number): void;
}

/** 반짝 텍스처: 가운데가 밝은 둥근 빛 (한 번만 만듦) */
function sparkleTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,240,180,0.9)');
  grad.addColorStop(1, 'rgba(255,220,120,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

export function createSparkles(scene: THREE.Scene): Sparkles {
  let tex: THREE.Texture | null = null;
  let live: { sprite: THREE.Sprite; t: number }[] = [];
  return {
    at(p) {
      tex ??= sparkleTexture();
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, blending: THREE.AdditiveBlending }),
      );
      sprite.position.copy(p);
      sprite.renderOrder = 30;
      scene.add(sprite);
      live.push({ sprite, t: 0 });
    },
    sync(dtMs) {
      if (live.length === 0) return;
      live = live.filter((s) => {
        s.t += dtMs;
        const k = s.t / SPARKLE_MS;
        if (k >= 1) {
          s.sprite.removeFromParent();
          s.sprite.material.dispose();
          return false;
        }
        const size = 0.04 + 0.05 * k;
        s.sprite.scale.set(size, size, 1);
        s.sprite.material.opacity = 1 - k;
        return true;
      });
    },
  };
}

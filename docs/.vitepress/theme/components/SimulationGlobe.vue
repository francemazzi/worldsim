<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import * as THREE from "three";

const container = ref<HTMLElement | null>(null);

let animationId = 0;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let globeGroup: THREE.Group | null = null;
let connectionMaterial: THREE.LineBasicMaterial | null = null;
let resizeObserver: ResizeObserver | null = null;
let pulsePhase = 0;
let pulseNode = 0;
let lastPulseTime = 0;

const mouse = { x: 0, y: 0 };
const cameraTarget = { x: 0, y: 0 };
let reducedMotion = false;

function readThemeColors() {
  const style = getComputedStyle(document.documentElement);
  const brand = style.getPropertyValue("--vp-c-brand-1").trim() || "#3451b2";
  const accent = style.getPropertyValue("--vp-c-brand-2").trim() || "#3a97f0";
  const muted = style.getPropertyValue("--vp-c-text-3").trim() || "#94a3b8";
  return { brand, accent, muted };
}

function fibonacciSphere(count: number, radius: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    points.push(
      new THREE.Vector3(
        Math.cos(theta) * r * radius,
        y * radius,
        Math.sin(theta) * r * radius,
      ),
    );
  }

  return points;
}

function buildConnections(nodes: THREE.Vector3[], maxDistance: number): number[] {
  const pairs: number[] = [];

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].distanceTo(nodes[j]) <= maxDistance) {
        pairs.push(i, j);
      }
    }
  }

  return pairs;
}

function onMouseMove(event: MouseEvent) {
  const width = window.innerWidth || 1;
  const height = window.innerHeight || 1;
  mouse.x = (event.clientX / width - 0.5) * 2;
  mouse.y = (event.clientY / height - 0.5) * 2;
}

function animate(time: number) {
  if (!renderer || !scene || !camera || !globeGroup || !connectionMaterial) return;

  animationId = requestAnimationFrame(animate);

  if (!reducedMotion) {
    globeGroup.rotation.y += 0.0025;
    globeGroup.rotation.x = Math.sin(time * 0.0002) * 0.08;
  }

  cameraTarget.x += (mouse.x * 0.35 - cameraTarget.x) * 0.04;
  cameraTarget.y += (-mouse.y * 0.25 - cameraTarget.y) * 0.04;
  camera.position.x = cameraTarget.x;
  camera.position.y = cameraTarget.y;
  camera.lookAt(0, 0, 0);

  if (!reducedMotion && time - lastPulseTime > 2000) {
    lastPulseTime = time;
    pulseNode = (pulseNode + 1) % 32;
    pulsePhase = 1;
  }

  if (pulsePhase > 0) {
    pulsePhase -= 0.02;
    connectionMaterial.opacity = 0.25 + (1 - pulsePhase) * 0.55;
  } else {
    connectionMaterial.opacity = 0.35;
  }

  renderer.render(scene, camera);
}

function initScene() {
  if (!container.value) return;

  reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const colors = readThemeColors();

  const width = container.value.clientWidth;
  const height = container.value.clientHeight;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
  camera.position.z = 3.2;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  container.value.appendChild(renderer.domElement);

  globeGroup = new THREE.Group();
  scene.add(globeGroup);

  const wireGeometry = new THREE.IcosahedronGeometry(1, 3);
  const wireMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colors.brand),
    wireframe: true,
    transparent: true,
    opacity: 0.22,
  });
  const wireGlobe = new THREE.Mesh(wireGeometry, wireMaterial);
  globeGroup.add(wireGlobe);

  const shellGeometry = new THREE.SphereGeometry(0.99, 32, 32);
  const shellMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colors.accent),
    transparent: true,
    opacity: 0.04,
  });
  globeGroup.add(new THREE.Mesh(shellGeometry, shellMaterial));

  const agentNodes = fibonacciSphere(32, 1.03);
  const agentPositions = new Float32Array(agentNodes.length * 3);
  agentNodes.forEach((node, index) => {
    agentPositions[index * 3] = node.x;
    agentPositions[index * 3 + 1] = node.y;
    agentPositions[index * 3 + 2] = node.z;
  });

  const agentGeometry = new THREE.BufferGeometry();
  agentGeometry.setAttribute("position", new THREE.BufferAttribute(agentPositions, 3));
  const agentMaterial = new THREE.PointsMaterial({
    color: new THREE.Color(colors.accent),
    size: 0.055,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  globeGroup.add(new THREE.Points(agentGeometry, agentMaterial));

  const pairs = buildConnections(agentNodes, 0.55);
  const linePositions = new Float32Array(pairs.length * 3);
  pairs.forEach((nodeIndex, pairIndex) => {
    const node = agentNodes[nodeIndex];
    linePositions[pairIndex * 3] = node.x;
    linePositions[pairIndex * 3 + 1] = node.y;
    linePositions[pairIndex * 3 + 2] = node.z;
  });

  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
  connectionMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(colors.muted),
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  globeGroup.add(new THREE.LineSegments(lineGeometry, connectionMaterial));

  const tickRing = new THREE.RingGeometry(1.08, 1.12, 64);
  const tickMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colors.accent),
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
  });
  const tickRingMesh = new THREE.Mesh(tickRing, tickMaterial);
  tickRingMesh.rotation.x = Math.PI / 2;
  globeGroup.add(tickRingMesh);

  resizeObserver = new ResizeObserver(() => {
    if (!container.value || !renderer || !camera) return;
    const nextWidth = container.value.clientWidth;
    const nextHeight = container.value.clientHeight;
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight);
  });
  resizeObserver.observe(container.value);

  window.addEventListener("mousemove", onMouseMove);
  animate(0);
}

function disposeScene() {
  cancelAnimationFrame(animationId);
  window.removeEventListener("mousemove", onMouseMove);
  resizeObserver?.disconnect();

  if (renderer) {
    renderer.dispose();
    renderer.domElement.remove();
  }

  scene?.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
      object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else {
        material.dispose();
      }
    }
  });

  renderer = null;
  scene = null;
  camera = null;
  globeGroup = null;
  connectionMaterial = null;
}

onMounted(initScene);
onUnmounted(disposeScene);
</script>

<template>
  <div ref="container" class="simulation-globe" aria-hidden="true" />
</template>

<style scoped>
.simulation-globe {
  width: 100%;
  height: 100%;
  min-height: 280px;
  pointer-events: none;
}

.simulation-globe :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
</style>

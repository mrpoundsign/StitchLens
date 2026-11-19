import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  AttachmentSite,
  CompiledPattern,
  SolvedGeometry,
  StitchKind,
  StitchNode,
} from '../core/model/types';

export type RenderViewMode = 'yarn' | 'diagram';
export type ColorSchemeMode = 'yarn' | 'rows' | 'stitch_type' | 'tension';

export interface ViewportSettings {
  viewMode: RenderViewMode;
  colorMode: ColorSchemeMode;
  currentStep: number; // Global stitch index (0..N-1)
  showGhostFuture: boolean;
  leftHanded: boolean;
  soloPieceId: string | null;
  autoFollowHook: boolean;
  isDarkTheme: boolean;
}

export const STITCH_TYPE_COLORS: Record<StitchKind, string> = {
  magic_ring: '#F8FAFC',
  ch: '#FBBF24',
  sl_st: '#94A3B8',
  sc: '#38BDF8',
  hdc: '#34D399',
  dc: '#A78BFA',
  tr: '#FB7185',
  cluster: '#F97316',
  bobble: '#EC4899',
  puff: '#22D3EE',
  popcorn: '#EAB308',
};

const ROW_CYCLE_PALETTE = [
  '#38BDF8',
  '#34D399',
  '#FBBF24',
  '#F472B6',
  '#A78BFA',
  '#FB923C',
  '#2DD4BF',
  '#E879F9',
];

function createTwistedYarnBumpTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 128, 128);
    // Diagonal 3-ply yarn twist ridges + subtle fiber noise
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const ply = Math.sin(((x * 2 + y * 3.5) / 128) * Math.PI * 6);
        const micro = Math.sin(x * 0.9 - y * 0.7) * 0.25;
        const val = Math.max(0, Math.min(255, Math.round(128 + ply * 68 + micro * 35)));
        ctx.fillStyle = `rgb(${val},${val},${val})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 2);
  return tex;
}

export class CrochetViewport {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private resizeObserver: ResizeObserver;
  private animFrameId = 0;
  private clock = new THREE.Clock();

  private rootGroup = new THREE.Group();
  private solidGroup = new THREE.Group();
  private ghostGroup = new THREE.Group();
  private highlightGroup = new THREE.Group();
  private stemGroup = new THREE.Group();
  private labelGroup = new THREE.Group();
  private gridHelper: THREE.GridHelper;

  private yarnBumpMap: THREE.CanvasTexture;
  private pickableStitchMap = new Map<THREE.Object3D, number>();
  private pickablePieceMap = new Map<THREE.Object3D, string>();
  private raycaster = new THREE.Raycaster();
  private pointerDownPos = new THREE.Vector2();

  private currentPattern: CompiledPattern | null = null;
  private currentGeometry: SolvedGeometry | null = null;
  private settings: ViewportSettings;
  private onSelectStitch?: (stitchId: number) => void;
  private onSelectPiece?: (pieceId: string) => void;

  private targetRingMeshes: THREE.Mesh[] = [];
  private hookIndicatorGroup: THREE.Group | null = null;
  private desiredCameraTarget: THREE.Vector3 | null = null;

  constructor(
    container: HTMLElement,
    initialSettings: ViewportSettings,
    onSelectStitch?: (stitchId: number) => void,
    onSelectPiece?: (pieceId: string) => void
  ) {
    this.container = container;
    this.settings = { ...initialSettings };
    this.onSelectStitch = onSelectStitch;
    this.onSelectPiece = onSelectPiece;

    this.scene = new THREE.Scene();
    this.updateThemeColors(initialSettings.isDarkTheme);

    const w = Math.max(200, container.clientWidth);
    const h = Math.max(200, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 400);
    this.camera.position.set(0, 7, 22);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 120;

    // Warm studio 3-point + hemisphere lighting so yarn strands have crisp readable depth
    const hemi = new THREE.HemisphereLight(0xf8fafc, 0x334155, 1.15);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
    keyLight.position.set(14, 22, 18);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.65);
    rimLight.position.set(-16, 10, -14);
    this.scene.add(rimLight);

    const bottomFill = new THREE.DirectionalLight(0xfde68a, 0.35);
    bottomFill.position.set(0, -15, 8);
    this.scene.add(bottomFill);

    this.gridHelper = new THREE.GridHelper(36, 36, 0x334155, 0x1e293b);
    this.gridHelper.position.y = -1.2;
    (this.gridHelper.material as THREE.Material).transparent = true;
    (this.gridHelper.material as THREE.Material).opacity = 0.35;
    this.scene.add(this.gridHelper);

    this.rootGroup.add(this.stemGroup);
    this.rootGroup.add(this.solidGroup);
    this.rootGroup.add(this.ghostGroup);
    this.rootGroup.add(this.highlightGroup);
    this.rootGroup.add(this.labelGroup);
    this.scene.add(this.rootGroup);

    this.yarnBumpMap = createTwistedYarnBumpTexture();

    // Pointer click picking
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.animate();
  }

  public dispose(): void {
    cancelAnimationFrame(this.animFrameId);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.clearGroup(this.solidGroup);
    this.clearGroup(this.ghostGroup);
    this.clearGroup(this.highlightGroup);
    this.clearGroup(this.stemGroup);
    this.clearGroup(this.labelGroup);
    this.yarnBumpMap.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  public setData(
    pattern: CompiledPattern,
    geometry: SolvedGeometry,
    settings: ViewportSettings,
    autoFit = false
  ): void {
    this.currentPattern = pattern;
    this.currentGeometry = geometry;
    this.settings = { ...settings };
    this.updateThemeColors(settings.isDarkTheme);
    this.rebuildScene();
    if (autoFit) {
      this.fitCameraToVisible();
    }
  }

  public updateSettings(next: ViewportSettings): void {
    const prev = this.settings;
    this.settings = { ...next };

    if (prev.isDarkTheme !== next.isDarkTheme) {
      this.updateThemeColors(next.isDarkTheme);
    }

    const needsFullRebuild =
      prev.viewMode !== next.viewMode ||
      prev.colorMode !== next.colorMode ||
      prev.leftHanded !== next.leftHanded ||
      prev.soloPieceId !== next.soloPieceId ||
      prev.showGhostFuture !== next.showGhostFuture ||
      prev.currentStep !== next.currentStep;

    if (needsFullRebuild && this.currentPattern && this.currentGeometry) {
      this.rebuildScene();
    }

    if (prev.soloPieceId !== next.soloPieceId) {
      this.fitCameraToVisible();
    }
  }

  public fitCameraToVisible(): void {
    if (!this.currentPattern || !this.currentGeometry || this.currentPattern.stitches.length === 0) {
      return;
    }
    const box = new THREE.Box3();
    let count = 0;
    for (const st of this.currentPattern.stitches) {
      if (this.settings.soloPieceId && st.pieceId !== this.settings.soloPieceId) continue;
      const p = this.getVec3(this.currentGeometry.positions, st.id);
      box.expandByPoint(p);
      count++;
    }
    if (count === 0) return;

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(4, size.x, size.y, size.z);
    const dist = maxDim * 1.75;

    this.controls.target.copy(center);
    this.desiredCameraTarget = null;
    this.camera.position.set(center.x + dist * 0.28, center.y + dist * 0.35, center.z + dist);
    this.controls.update();

    this.gridHelper.position.y = box.min.y - 0.8;
  }

  private updateThemeColors(isDark: boolean): void {
    this.scene.background = new THREE.Color(isDark ? 0x0b1120 : 0xf1f5f9);
    if (this.gridHelper) {
      const mat = this.gridHelper.material as THREE.LineBasicMaterial;
      mat.color.setHex(isDark ? 0x334155 : 0xcbd5e1);
    }
  }

  private handleResize(): void {
    const w = Math.max(100, this.container.clientWidth);
    const h = Math.max(100, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private handlePointerDown = (e: PointerEvent): void => {
    this.pointerDownPos.set(e.clientX, e.clientY);
  };

  private handlePointerUp = (e: PointerEvent): void => {
    const moveDist = Math.hypot(
      e.clientX - this.pointerDownPos.x,
      e.clientY - this.pointerDownPos.y
    );
    if (moveDist > 5) return; // Ignore orbit drags

    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    // 1. Check floating 3D piece markers first when viewing All Pieces
    if (this.onSelectPiece && this.pickablePieceMap.size > 0) {
      const labelHits = this.raycaster.intersectObjects(this.labelGroup.children, true);
      for (const hit of labelHits) {
        const pieceId = this.pickablePieceMap.get(hit.object);
        if (pieceId) {
          this.onSelectPiece(pieceId);
          return;
        }
      }
    }

    // 2. Check individual stitch meshes (or nearest stitch on a merged color-batch mesh!)
    if (!this.onSelectStitch) return;
    const hits = this.raycaster.intersectObjects(this.solidGroup.children, true);
    if (hits.length > 0) {
      const firstHit = hits[0];
      const directStId = this.pickableStitchMap.get(firstHit.object);
      if (directStId !== undefined) {
        this.onSelectStitch(directStId);
        return;
      }
      if (this.currentPattern && this.currentGeometry) {
        const pt = firstHit.point;
        const maxStep = Math.max(
          0,
          Math.min(this.currentPattern.stitches.length - 1, this.settings.currentStep)
        );
        let bestId = -1;
        let bestDistSq = Infinity;
        for (let i = 0; i <= maxStep; i++) {
          const st = this.currentPattern.stitches[i];
          if (this.settings.soloPieceId && st.pieceId !== this.settings.soloPieceId) continue;
          const sp = this.getVec3(this.currentGeometry.positions, i);
          const dSq = sp.distanceToSquared(pt);
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestId = st.id;
          }
        }
        if (bestId >= 0) {
          this.onSelectStitch(bestId);
        }
      }
    }
  };

  private animate = (): void => {
    this.animFrameId = requestAnimationFrame(this.animate);
    const t = this.clock.getElapsedTime();

    // Gentle pulse on target insertion ring(s) & bob on hook indicator
    for (let i = 0; i < this.targetRingMeshes.length; i++) {
      const pulse = 1 + Math.sin(t * 5.5 + i) * 0.14;
      this.targetRingMeshes[i].scale.setScalar(pulse);
    }
    if (this.hookIndicatorGroup) {
      this.hookIndicatorGroup.position.y += Math.sin(t * 4.5) * 0.0025;
    }

    if (this.desiredCameraTarget) {
      this.controls.target.lerp(this.desiredCameraTarget, 0.12);
      if (this.controls.target.distanceTo(this.desiredCameraTarget) < 0.02) {
        this.desiredCameraTarget = null;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const obj = group.children.pop()!;
      obj.traverse((child) => {
        if ((child as THREE.Mesh).geometry) {
          (child as THREE.Mesh).geometry.dispose();
        }
        const mat = (child as THREE.Mesh | THREE.Sprite).material;
        const disposeMat = (m: THREE.Material) => {
          const spriteMat = m as THREE.SpriteMaterial;
          if (spriteMat.map && spriteMat.map !== this.yarnBumpMap) {
            spriteMat.map.dispose();
          }
          m.dispose();
        };
        if (Array.isArray(mat)) {
          mat.forEach(disposeMat);
        } else if (mat) {
          disposeMat(mat);
        }
      });
    }
  }

  private getVec3(arr: Float32Array, id: number): THREE.Vector3 {
    const mirrorSign = this.settings.leftHanded ? -1 : 1;
    return new THREE.Vector3(arr[id * 3] * mirrorSign, arr[id * 3 + 1], arr[id * 3 + 2]);
  }

  private resolveStitchColor(st: StitchNode, stressVal: number): THREE.Color {
    switch (this.settings.colorMode) {
      case 'yarn':
        return new THREE.Color(st.colorHex);
      case 'rows':
        return new THREE.Color(
          ROW_CYCLE_PALETTE[Math.abs(st.rowNumber) % ROW_CYCLE_PALETTE.length]
        );
      case 'stitch_type':
        return new THREE.Color(STITCH_TYPE_COLORS[st.kind] ?? '#38BDF8');
      case 'tension': {
        // 0.7 = blue, 1.0 = emerald, 1.4+ = red-amber
        if (stressVal < 0.9) {
          return new THREE.Color('#38BDF8').lerp(new THREE.Color('#34D399'), stressVal / 0.9);
        }
        const t = Math.min(1, (stressVal - 1.0) / 0.45);
        return new THREE.Color('#34D399').lerp(new THREE.Color('#EF4444'), Math.max(0, t));
      }
    }
  }

  /**
   * Computes the exact 3D coordinate of a specific loop / post site on parent stitch `targetId`!
   */
  private getAttachmentSiteWorldPos(targetId: number, site: AttachmentSite): THREE.Vector3 {
    if (!this.currentGeometry) return new THREE.Vector3();
    const base = this.getVec3(this.currentGeometry.positions, targetId);
    const normal = this.getVec3(this.currentGeometry.normals, targetId).normalize();

    if (site === 'flo') {
      return base.clone().addScaledVector(normal, 0.22);
    }
    if (site === 'blo') {
      return base.clone().addScaledVector(normal, -0.22);
    }
    if (site === 'front_post' || site === 'back_post') {
      const parentSt = this.currentPattern?.stitches[targetId];
      const grandAnchor = parentSt?.anchors[0];
      const postMid = grandAnchor
        ? base
            .clone()
            .lerp(this.getVec3(this.currentGeometry.positions, grandAnchor.targetStitchId), 0.45)
        : base.clone();
      return postMid.addScaledVector(normal, site === 'front_post' ? 0.26 : -0.26);
    }
    if (site === 'chain_underside') {
      return base.clone().add(new THREE.Vector3(0, -0.16, 0));
    }
    return base;
  }

  private rebuildScene(): void {
    this.clearGroup(this.solidGroup);
    this.clearGroup(this.ghostGroup);
    this.clearGroup(this.highlightGroup);
    this.clearGroup(this.stemGroup);
    this.clearGroup(this.labelGroup);
    this.pickableStitchMap.clear();
    this.pickablePieceMap.clear();
    this.targetRingMeshes = [];
    this.hookIndicatorGroup = null;

    const pattern = this.currentPattern;
    const geom = this.currentGeometry;
    if (!pattern || !geom || pattern.stitches.length === 0) return;

    // 1. Render any floral wire stems (unless soloing an unrelated piece)
    if (!this.settings.soloPieceId) {
      for (const stem of pattern.stems) {
        if (stem.points.length < 2) continue;
        const mirrorSign = this.settings.leftHanded ? -1 : 1;
        const curvePts = stem.points.map(
          (p) => new THREE.Vector3(p[0] * mirrorSign, p[1], p[2])
        );
        const curve = new THREE.CatmullRomCurve3(curvePts);
        const tubeGeo = new THREE.TubeGeometry(curve, 32, stem.radius, 10, false);
        const mat = new THREE.MeshStandardMaterial({
          color: stem.colorHex,
          roughness: 0.75,
          bumpMap: this.yarnBumpMap,
          bumpScale: 0.03,
        });
        this.stemGroup.add(new THREE.Mesh(tubeGeo, mat));
      }
    }

    const maxStep = Math.max(0, Math.min(pattern.stitches.length - 1, this.settings.currentStep));

    const soloPiece = this.settings.soloPieceId
      ? pattern.pieces.find((p) => p.id === this.settings.soloPieceId) ?? null
      : null;
    const scopeEndId =
      soloPiece && soloPiece.stitchIds.length > 0
        ? soloPiece.stitchIds[soloPiece.stitchIds.length - 1]
        : pattern.stitches.length - 1;
    const isScrubbingMidPattern = maxStep < scopeEndId;

    if (this.settings.viewMode === 'yarn') {
      this.buildPlushYarnScene(pattern, geom, maxStep, isScrubbingMidPattern);
    } else {
      this.buildDiagramScene(pattern, geom, maxStep);
    }

    // 2. When viewing All Pieces on a multi-piece pattern, render floating 3D piece markers with stitch counts!
    if (!this.settings.soloPieceId && pattern.pieces.length > 1) {
      this.buildPieceMarkers(pattern, geom);
    }

    // 3. Build Active Stitch Halo + Target Parent Loop Ring(s) + 3D Hook Vector when scrubbing mid-pattern!
    const activeStitch = pattern.stitches[maxStep];
    if (
      isScrubbingMidPattern &&
      activeStitch &&
      (!this.settings.soloPieceId || activeStitch.pieceId === this.settings.soloPieceId)
    ) {
      this.buildActiveStitchSpotlight(activeStitch, geom);
      if (this.settings.autoFollowHook) {
        this.desiredCameraTarget = this.getVec3(geom.positions, activeStitch.id);
      }
    }
  }

  private buildPlushYarnScene(
    pattern: CompiledPattern,
    geom: SolvedGeometry,
    maxStep: number,
    isScrubbingMidPattern: boolean
  ): void {
    const yarnRadius = 0.16;
    const ghostPoints: THREE.Vector3[] = [];
    const ghostLineVertices: number[] = [];

    // Group tube geometries by material key (`hex` or `hex:current`) so 6,000+ tubes merge into ~8 WebGL draw calls!
    const batches = new Map<
      string,
      {
        color: THREE.Color;
        isCurrent: boolean;
        geos: THREE.BufferGeometry[];
      }
    >();

    const addGeoToBatch = (
      color: THREE.Color,
      isCurrent: boolean,
      tubeGeo: THREE.BufferGeometry
    ) => {
      const key = isCurrent ? `${color.getHexString()}:cur` : color.getHexString();
      let batch = batches.get(key);
      if (!batch) {
        batch = { color: color.clone(), isCurrent, geos: [] };
        batches.set(key, batch);
      }
      batch.geos.push(tubeGeo);
    };

    for (let i = 0; i < pattern.stitches.length; i++) {
      const st = pattern.stitches[i];
      if (this.settings.soloPieceId && st.pieceId !== this.settings.soloPieceId) continue;

      const pos = this.getVec3(geom.positions, i);
      if (i > maxStep) {
        if (this.settings.showGhostFuture) {
          ghostPoints.push(pos);
          if (st.prevStitchId !== null && pattern.stitches[st.prevStitchId]?.pieceId === st.pieceId) {
            const pPrev = this.getVec3(geom.positions, st.prevStitchId);
            ghostLineVertices.push(pPrev.x, pPrev.y, pPrev.z, pos.x, pos.y, pos.z);
          }
        }
        continue;
      }

      if (st.kind === 'magic_ring') {
        const ringGeo = new THREE.TorusGeometry(0.36, 0.11, 8, 18);
        ringGeo.rotateX(Math.PI / 2);
        ringGeo.translate(pos.x, pos.y, pos.z);
        addGeoToBatch(this.resolveStitchColor(st, 1.0), false, ringGeo);
        continue;
      }

      const tangent = this.getVec3(geom.tangents, i).normalize();
      const normal = this.getVec3(geom.normals, i).normalize();
      const isCurrent = isScrubbingMidPattern && i === maxStep;
      const baseColor = this.resolveStitchColor(st, geom.stress[i]);

      // 1. Watertight Closed Top V-Loop Ring (`closed = true` -> zero open hollow ends, interlocks with neighbors!)
      const halfW = st.isTurningChain ? 0.36 : 0.54;
      const loopSpread = st.kind === 'ch' ? 0.16 : 0.21;
      const chainTwist = st.kind === 'ch' ? ((i % 2 === 0 ? 1 : -1) * 0.06) : 0;
      const pBack = pos
        .clone()
        .addScaledVector(tangent, -halfW)
        .addScaledVector(normal, chainTwist);
      const pBackSide = pos.clone().addScaledVector(normal, -loopSpread);
      const pFront = pos
        .clone()
        .addScaledVector(tangent, halfW)
        .addScaledVector(normal, -chainTwist);
      const pFrontSide = pos.clone().addScaledVector(normal, loopSpread);

      const capCurve = new THREE.CatmullRomCurve3(
        [pBack, pBackSide, pFront, pFrontSide],
        true
      );
      const capGeo = new THREE.TubeGeometry(
        capCurve,
        12,
        st.kind === 'bobble' || st.kind === 'puff' || st.kind === 'popcorn'
          ? yarnRadius * 1.4
          : yarnRadius,
        6,
        true
      );
      addGeoToBatch(baseColor, isCurrent, capGeo);

      // 2. Watertight Closed Post Loop reaching down through the exact parent attachment site(s)!
      if (st.anchors.length > 0) {
        for (let aIdx = 0; aIdx < st.anchors.length; aIdx++) {
          const anc = st.anchors[aIdx];
          const anchorWorld = this.getAttachmentSiteWorldPos(anc.targetStitchId, anc.site);
          if (pos.distanceTo(anchorWorld) < 0.08) continue;

          const legOffset = st.anchors.length > 1 ? (aIdx - 0.5) * 0.18 : 0;
          const legLeftTop = pos.clone().addScaledVector(tangent, -0.17 + legOffset);
          const legRightTop = pos.clone().addScaledVector(tangent, 0.17 + legOffset);
          const midBulge = pos
            .clone()
            .lerp(anchorWorld, 0.5)
            .addScaledVector(
              normal,
              st.kind === 'bobble' || st.kind === 'popcorn' || st.kind === 'puff' ? 0.42 : 0.07
            );

          const postCurve = new THREE.CatmullRomCurve3(
            [
              legLeftTop,
              midBulge.clone().addScaledVector(tangent, -0.13),
              anchorWorld,
              midBulge.clone().addScaledVector(tangent, 0.13),
              legRightTop,
            ],
            true
          );
          const postGeo = new THREE.TubeGeometry(postCurve, 12, yarnRadius * 0.88, 6, true);
          addGeoToBatch(baseColor, isCurrent, postGeo);
        }
      }

      // 3. Continuous Working-Yarn Connector from `prevStitchId` -> `id` so no two consecutive stitches ever look disconnected!
      if (
        st.prevStitchId !== null &&
        pattern.stitches[st.prevStitchId]?.pieceId === st.pieceId
      ) {
        const prevPos = this.getVec3(geom.positions, st.prevStitchId);
        const stepDist = prevPos.distanceTo(pos);
        if (stepDist > 0.12 && stepDist < 4.5) {
          const midBridge = prevPos
            .clone()
            .lerp(pos, 0.5)
            .addScaledVector(normal, -0.05);
          const linkCurve = new THREE.CatmullRomCurve3(
            [prevPos, midBridge, pos, midBridge.clone().addScaledVector(normal, 0.04)],
            true
          );
          const linkGeo = new THREE.TubeGeometry(linkCurve, 8, yarnRadius * 0.72, 5, true);
          addGeoToBatch(baseColor, isCurrent, linkGeo);
        }
      }
    }

    // Merge each color batch into a single BufferGeometry + Mesh!
    for (const batch of batches.values()) {
      if (batch.geos.length === 0) continue;
      const merged = mergeGeometries(batch.geos, false);
      for (const g of batch.geos) {
        g.dispose();
      }
      if (!merged) continue;
      const mat = new THREE.MeshStandardMaterial({
        color: batch.color,
        emissive: batch.isCurrent
          ? batch.color.clone().multiplyScalar(0.38)
          : new THREE.Color(0x000000),
        roughness: 0.84,
        metalness: 0.02,
        bumpMap: this.yarnBumpMap,
        bumpScale: 0.055,
      });
      this.solidGroup.add(new THREE.Mesh(merged, mat));
    }

    if (ghostLineVertices.length > 0) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(ghostLineVertices, 3));
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x94a3b8,
        transparent: true,
        opacity: 0.18,
      });
      this.ghostGroup.add(new THREE.LineSegments(lineGeo, lineMat));
    }

    if (ghostPoints.length > 0) {
      const dotGeo = new THREE.BufferGeometry().setFromPoints(ghostPoints);
      const dotMat = new THREE.PointsMaterial({
        color: 0x94a3b8,
        size: 0.18,
        transparent: true,
        opacity: 0.25,
      });
      this.ghostGroup.add(new THREE.Points(dotGeo, dotMat));
    }
  }

  private buildDiagramScene(
    pattern: CompiledPattern,
    geom: SolvedGeometry,
    maxStep: number
  ): void {
    // Topological X-Ray View: split Front Loop (bright) & Back Loop (tinted) V-arcs + post rods + working-yarn path
    const workingPathPoints: THREE.Vector3[] = [];
    const ghostLineVertices: number[] = [];
    let lastPieceId = '';

    const batches = new Map<
      string,
      {
        color: THREE.Color;
        geos: THREE.BufferGeometry[];
      }
    >();

    const addDiagGeo = (color: THREE.Color, g: THREE.BufferGeometry) => {
      const key = color.getHexString();
      let batch = batches.get(key);
      if (!batch) {
        batch = { color: color.clone(), geos: [] };
        batches.set(key, batch);
      }
      batch.geos.push(g);
    };

    const flushWorkingPath = () => {
      if (workingPathPoints.length >= 2) {
        const pathGeo = new THREE.BufferGeometry().setFromPoints(workingPathPoints);
        const pathMat = new THREE.LineBasicMaterial({
          color: this.settings.isDarkTheme ? 0x64748b : 0x475569,
          transparent: true,
          opacity: 0.65,
        });
        this.solidGroup.add(new THREE.Line(pathGeo, pathMat));
      }
      workingPathPoints.length = 0;
    };

    for (let i = 0; i < pattern.stitches.length; i++) {
      const st = pattern.stitches[i];
      if (this.settings.soloPieceId && st.pieceId !== this.settings.soloPieceId) continue;

      const pos = this.getVec3(geom.positions, i);
      if (i > maxStep) {
        if (this.settings.showGhostFuture && st.prevStitchId !== null) {
          const prevSt = pattern.stitches[st.prevStitchId];
          if (prevSt && prevSt.pieceId === st.pieceId) {
            const pPrev = this.getVec3(geom.positions, st.prevStitchId);
            ghostLineVertices.push(pPrev.x, pPrev.y, pPrev.z, pos.x, pos.y, pos.z);
          }
        }
        continue;
      }

      if (st.pieceId !== lastPieceId) {
        flushWorkingPath();
        lastPieceId = st.pieceId;
      }
      workingPathPoints.push(pos);

      const tangent = this.getVec3(geom.tangents, i).normalize();
      const normal = this.getVec3(geom.normals, i).normalize();
      const color = this.resolveStitchColor(st, geom.stress[i]);
      const backColor = color.clone().multiplyScalar(0.68);

      // Node sphere + split Front-Loop / Back-Loop bars so user can clearly distinguish FLO vs BLO!
      const nodeGeo = new THREE.SphereGeometry(st.kind === 'magic_ring' ? 0.24 : 0.14, 8, 6);
      nodeGeo.translate(pos.x, pos.y, pos.z);
      addDiagGeo(color, nodeGeo);

      if (st.kind !== 'magic_ring') {
        const flStart = pos.clone().addScaledVector(tangent, -0.32).addScaledVector(normal, 0.18);
        const flEnd = pos.clone().addScaledVector(tangent, 0.32).addScaledVector(normal, 0.08);
        const blStart = pos.clone().addScaledVector(tangent, -0.32).addScaledVector(normal, -0.18);
        const blEnd = pos.clone().addScaledVector(tangent, 0.32).addScaledVector(normal, -0.08);

        const flGeo = new THREE.TubeGeometry(new THREE.LineCurve3(flStart, flEnd), 2, 0.048, 5, false);
        const blGeo = new THREE.TubeGeometry(new THREE.LineCurve3(blStart, blEnd), 2, 0.048, 5, false);
        addDiagGeo(color, flGeo);
        addDiagGeo(backColor, blGeo);
      }

      // Anchor post rods down to exact target loop site
      for (const anc of st.anchors) {
        const targetPos = this.getAttachmentSiteWorldPos(anc.targetStitchId, anc.site);
        const dist = pos.distanceTo(targetPos);
        if (dist > 0.05) {
          const rodCurve = new THREE.LineCurve3(targetPos, pos);
          const rodGeo = new THREE.TubeGeometry(rodCurve, 2, 0.055, 5, false);
          addDiagGeo(color, rodGeo);
        }
      }
    }

    flushWorkingPath();

    for (const batch of batches.values()) {
      if (batch.geos.length === 0) continue;
      const merged = mergeGeometries(batch.geos, false);
      for (const g of batch.geos) {
        g.dispose();
      }
      if (!merged) continue;
      const mat = new THREE.MeshStandardMaterial({
        color: batch.color,
        roughness: 0.48,
      });
      this.solidGroup.add(new THREE.Mesh(merged, mat));
    }

    if (ghostLineVertices.length > 0) {
      const gGeo = new THREE.BufferGeometry();
      gGeo.setAttribute('position', new THREE.Float32BufferAttribute(ghostLineVertices, 3));
      const gMat = new THREE.LineBasicMaterial({
        color: 0x94a3b8,
        transparent: true,
        opacity: 0.15,
      });
      this.ghostGroup.add(new THREE.LineSegments(gGeo, gMat));
    }
  }

  private buildPieceMarkers(pattern: CompiledPattern, geom: SolvedGeometry): void {
    const isDark = this.settings.isDarkTheme;
    for (const piece of pattern.pieces) {
      if (piece.stitchIds.length === 0) continue;

      const box = new THREE.Box3();
      for (const stId of piece.stitchIds) {
        box.expandByPoint(this.getVec3(geom.positions, stId));
      }
      const center = new THREE.Vector3();
      box.getCenter(center);

      const firstSt = pattern.stitches[piece.stitchIds[0]];
      const dotColor = firstSt?.colorHex ?? '#38bdf8';
      const titleText = piece.name;
      const countText = `${piece.stitchIds.length} sts`;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const fontTitle = '700 26px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      const fontCount = '600 22px "JetBrains Mono", Consolas, monospace';

      let wTitle = titleText.length * 15;
      let wCount = countText.length * 13;
      if (ctx) {
        ctx.font = fontTitle;
        wTitle = ctx.measureText(titleText).width;
        ctx.font = fontCount;
        wCount = ctx.measureText(countText).width;
      }

      const padX = 24;
      const dotSpace = 28;
      const gap = 16;
      const pillW = Math.ceil(padX * 2 + dotSpace + wTitle + gap + wCount + 22);
      const pillH = 60;
      canvas.width = pillW;
      canvas.height = pillH;

      if (ctx) {
        // Outer rounded pill background
        const r = 28;
        ctx.beginPath();
        ctx.roundRect(2, 2, pillW - 4, pillH - 4, r);
        ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.94)';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = isDark ? '#334155' : '#cbd5e1';
        ctx.stroke();

        // Yarn color dot
        ctx.beginPath();
        ctx.arc(padX + 8, pillH / 2, 9, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(15,23,42,0.35)';
        ctx.stroke();

        // Piece title
        ctx.font = fontTitle;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
        ctx.fillText(titleText, padX + dotSpace, pillH / 2 + 1);

        // Stitch count chip
        const chipX = padX + dotSpace + wTitle + gap - 6;
        const chipW = wCount + 20;
        const chipH = 36;
        ctx.beginPath();
        ctx.roundRect(chipX, (pillH - chipH) / 2, chipW, chipH, 18);
        ctx.fillStyle = isDark ? 'rgba(52, 211, 153, 0.16)' : 'rgba(5, 150, 105, 0.12)';
        ctx.fill();

        ctx.font = fontCount;
        ctx.fillStyle = isDark ? '#34d399' : '#059669';
        ctx.fillText(countText, chipX + 10, pillH / 2 + 1);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const spriteMat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      const markerY = box.max.y + 1.35;
      sprite.position.set(center.x, markerY, center.z);
      const scaleH = 1.05;
      sprite.scale.set((pillW / pillH) * scaleH, scaleH, 1);
      sprite.renderOrder = 10;

      this.pickablePieceMap.set(sprite, piece.id);
      this.labelGroup.add(sprite);

      // Subtle vertical stem line connecting the floating marker down to the top of the piece
      const stemTop = new THREE.Vector3(center.x, markerY - scaleH * 0.48, center.z);
      const stemBottom = new THREE.Vector3(center.x, box.max.y + 0.18, center.z);
      const stemGeo = new THREE.BufferGeometry().setFromPoints([stemBottom, stemTop]);
      const stemMat = new THREE.LineBasicMaterial({
        color: isDark ? 0x64748b : 0x94a3b8,
        transparent: true,
        opacity: 0.55,
      });
      this.labelGroup.add(new THREE.Line(stemGeo, stemMat));
    }
  }

  private buildActiveStitchSpotlight(activeStitch: StitchNode, geom: SolvedGeometry): void {
    const pos = this.getVec3(geom.positions, activeStitch.id);
    const normal = this.getVec3(geom.normals, activeStitch.id).normalize();

    // 1. Active stitch 3D torus collar (never a flat 2D RingGeometry that slices into yarn!)
    const activeHaloGeo = new THREE.TorusGeometry(0.42, 0.048, 10, 24);
    const activeHaloMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
    });
    const activeHalo = new THREE.Mesh(activeHaloGeo, activeHaloMat);
    activeHalo.position.copy(pos);
    activeHalo.lookAt(pos.clone().add(normal));
    this.highlightGroup.add(activeHalo);

    // 2. Highlight every target parent loop this stitch enters + stylized 3D Crochet Hook Tip!
    for (let k = 0; k < activeStitch.anchors.length; k++) {
      const anc = activeStitch.anchors[k];
      const targetPos = this.getAttachmentSiteWorldPos(anc.targetStitchId, anc.site);
      const targetNormal = this.getVec3(geom.normals, anc.targetStitchId).normalize();

      const torusGeo = new THREE.TorusGeometry(0.28, 0.055, 10, 24);
      const torusMat = new THREE.MeshBasicMaterial({
        color: 0x34d399, // Emerald Mint "Insert Hook Here" target ring!
      });
      const torus = new THREE.Mesh(torusGeo, torusMat);
      torus.position.copy(targetPos);
      torus.lookAt(targetPos.clone().add(targetNormal));
      this.highlightGroup.add(torus);
      this.targetRingMeshes.push(torus);

      // Stylized 3D Crochet Hook entering the first target loop along the surface normal!
      if (k === 0) {
        const hookGroup = new THREE.Group();
        const shaftMat = new THREE.MeshStandardMaterial({
          color: 0xf8fafc,
          metalness: 0.55,
          roughness: 0.25,
          emissive: new THREE.Color(0x0ea5e9),
          emissiveIntensity: 0.25,
        });
        const shaftGeo = new THREE.CylinderGeometry(0.055, 0.075, 1.55, 12);
        shaftGeo.translate(0, 0.85, 0);
        const shaft = new THREE.Mesh(shaftGeo, shaftMat);

        const tipGeo = new THREE.ConeGeometry(0.095, 0.28, 12);
        tipGeo.rotateX(Math.PI); // Point downward toward origin (target loop!)
        const tip = new THREE.Mesh(tipGeo, shaftMat);

        hookGroup.add(shaft);
        hookGroup.add(tip);
        hookGroup.position.copy(targetPos);

        // Align hook shaft +Y axis along outward targetNormal so tip points straight into the loop!
        const up = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(up, targetNormal);
        hookGroup.quaternion.copy(quat);

        this.highlightGroup.add(hookGroup);
        this.hookIndicatorGroup = hookGroup;
      }
    }
  }
}

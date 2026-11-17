import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
// One scene and renderer, including comparisons. No model survives disposal or a superseded load.
export function disposeObject(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse(object => {
    if (object.geometry)
      geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value?.isTexture)
          textures.add(value);
    }
  });
  geometries.forEach(value => value.dispose());
  materials.forEach(value => value.dispose());
  textures.forEach(value => { value.source?.data?.close?.(); value.dispose(); });
}
export function createViewer(host, options) { return new GalleryViewer(host, options); }
class GalleryViewer {
  constructor(host, { onStatus, onError }) {
    this.host = host;
    this.onStatus = onStatus;
    this.onError = onError;
    this.render = this.render.bind(this);
    this.resize = this.resize.bind(this);
    this.preset = this.preset.bind(this);
    this.fit = this.fit.bind(this);
    this.load = this.load.bind(this);
    this.tick = this.tick.bind(this);
    this.toggleRotation = this.toggleRotation.bind(this);
    this.visibility = this.visibility.bind(this);
    this.motionPreference = this.motionPreference.bind(this);
    this.keydown = this.keydown.bind(this);
    this.contextLost = this.contextLost.bind(this);
    this.focus = this.focus.bind(this);
    this.dispose = this.dispose.bind(this);
    this.renderer = undefined;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    }
    catch {
      throw new Error('WebGL is unavailable.');
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.setClearColor(0xe8e9df);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.canvas = this.renderer.domElement;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', 'Interactive authored machine models');
    this.canvas.setAttribute('aria-describedby', 'keyboard-help');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.005, 100);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI * .94;
    this.controls.minDistance = .05;
    this.controls.maxDistance = 15;
    this.controls.enablePan = true;
    this.controls.zoomToCursor = true;
    this.room = new RoomEnvironment();
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = this.pmrem.fromScene(this.room, .06);
    this.scene.environment = this.environment.texture;
    this.room.dispose();
    this.pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xfffaf0, 0x5b625b, 2));
    this.key = new THREE.DirectionalLight(0xfff3d8, 3.2);
    this.key.position.set(-2, 4, 3);
    this.scene.add(this.key);
    this.fill = new THREE.DirectionalLight(0xdce8ff, 2);
    this.fill.position.set(2, 2, -3);
    this.scene.add(this.fill);
    this.models = new THREE.Group();
    this.scene.add(this.models);
    this.disposed = false;
    this.rotation = false;
    this.frame = 0;
    this.lastTime = 0;
    this.fitDistance = 2;
    this.center = new THREE.Vector3();
    this.radius = 1;
    this.requests = new AbortController();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.controls.addEventListener('change', this.render);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(this.host);
    this.presets = { perspective: new THREE.Vector3(1.1, .85, 1.25), front: new THREE.Vector3(0, .04, 1), rear: new THREE.Vector3(0, .04, -1), top: new THREE.Vector3(0, 1, .0001) };
    this.canvas.addEventListener('keydown', this.keydown);
    this.canvas.addEventListener('webglcontextlost', this.contextLost);
    document.addEventListener('visibilitychange', this.visibility);
    this.reducedMotion.addEventListener('change', this.motionPreference);
  }
  render() {
    if (!this.disposed && !document.hidden && this.host.clientWidth && this.host.clientHeight)
      this.renderer.render(this.scene, this.camera);
  }
  resize() {
    if (this.disposed)
      return;
    const width = this.host.clientWidth || 1;
    const height = this.host.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }
  preset(name) {
    const direction = this.presets[name] ?? this.presets.perspective;
    this.rotation = false;
    cancelAnimationFrame(this.frame);
    this.controls.autoRotate = false;
    this.camera.position.copy(this.center).addScaledVector(direction.clone().normalize(), this.fitDistance);
    this.camera.up.set(0, 1, 0);
    this.controls.target.copy(this.center);
    this.controls.update();
    this.render();
  }
  fit() {
    const bounds = new THREE.Box3().setFromObject(this.models);
    if (bounds.isEmpty())
      throw new Error('This model contains no visible geometry.');
    this.center = bounds.getCenter(new THREE.Vector3());
    this.radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
    const aspect = this.host.clientWidth / Math.max(1, this.host.clientHeight);
    const vertical = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
    this.fitDistance = this.radius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.1;
    this.controls.minDistance = this.radius * .13;
    this.controls.maxDistance = this.fitDistance * 4;
    this.camera.near = Math.max(.001, this.radius / 200);
    this.camera.far = Math.max(30, this.fitDistance * 10);
    this.camera.updateProjectionMatrix();
    this.preset('perspective');
  }
  async load(selected) {
    let x = 0;
    for (let index = 0; index < selected.length; index++) {
      if (this.disposed)
        return;
      const { product, variant } = selected[index];
      this.onStatus(`Loading ${product.name} · ${index + 1} of ${selected.length}`);
      const response = await fetch(variant.ui, { signal: this.requests.signal });
      if (!response.ok)
        throw new Error(`Model HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (this.disposed)
        return;
      this.onStatus(`Preparing ${product.name} materials…`);
      const gltf = await new GLTFLoader().parseAsync(bytes, new URL('.', window.location.href).href);
      if (this.disposed) {
        disposeObject(gltf.scene);
        return;
      }
      const object = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(object);
      const size = bounds.getSize(new THREE.Vector3());
      const middle = bounds.getCenter(new THREE.Vector3());
      // Preserve glTF meters exactly. Translate to the shared ground; never normalize each machine.
      object.position.x += x + size.x / 2 - middle.x;
      object.position.y -= bounds.min.y;
      object.position.z -= middle.z;
      object.name = `${product.brand} ${product.name} / ${variant.name}`;
      this.models.add(object);
      x += size.x + .12;
    }
    if (this.disposed)
      return;
    this.fit();
    this.host.append(this.canvas);
    this.resize();
  }
  tick(time) {
    if (!this.rotation || this.disposed || document.hidden)
      return;
    this.controls.update(Math.min((time - this.lastTime) / 1000 || 0, .05));
    this.lastTime = time;
    this.render();
    this.frame = requestAnimationFrame(this.tick);
  }
  toggleRotation() {
    this.rotation = !this.rotation;
    this.controls.autoRotate = this.rotation;
    this.controls.autoRotateSpeed = this.reducedMotion.matches ? .3 : .65;
    if (this.rotation && !document.hidden) {
      this.lastTime = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    }
    else
      cancelAnimationFrame(this.frame);
    return this.rotation;
  }
  visibility() {
    cancelAnimationFrame(this.frame);
    if (!document.hidden) {
      this.render();
      if (this.rotation) {
        this.lastTime = performance.now();
        this.frame = requestAnimationFrame(this.tick);
      }
    }
  }
  motionPreference() {
    if (this.reducedMotion.matches && this.rotation) {
      this.rotation = false;
      this.controls.autoRotate = false;
      cancelAnimationFrame(this.frame);
    }
  }
  keydown(event) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    if (event.key === 'Home')
      this.preset('perspective');
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(event.key)) {
      if (event.key === 'ArrowLeft')
        spherical.theta -= .14;
      if (event.key === 'ArrowRight')
        spherical.theta += .14;
      if (event.key === 'ArrowUp')
        spherical.phi = Math.max(.01, spherical.phi - .12);
      if (event.key === 'ArrowDown')
        spherical.phi = Math.min(Math.PI * .94, spherical.phi + .12);
      if (['+', '='].includes(event.key))
        spherical.radius = Math.max(this.controls.minDistance, spherical.radius * .88);
      if (['-', '_'].includes(event.key))
        spherical.radius = Math.min(this.controls.maxDistance, spherical.radius * 1.12);
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      this.controls.update();
      this.render();
    }
    else
      return;
    event.preventDefault();
  }
  contextLost(event) {
    event.preventDefault();
    if (!this.disposed)
      this.onError(new Error('WebGL context was lost.'));
  }
  focus() {
    this.canvas.focus({ preventScroll: true });
  }
  dispose() {
    if (this.disposed)
      return;
    this.disposed = true;
    this.requests.abort();
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.removeEventListener('change', this.render);
    this.controls.dispose();
    this.canvas.removeEventListener('keydown', this.keydown);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    document.removeEventListener('visibilitychange', this.visibility);
    this.reducedMotion.removeEventListener('change', this.motionPreference);
    disposeObject(this.models);
    this.models.clear();
    this.scene.environment = null;
    this.environment.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}

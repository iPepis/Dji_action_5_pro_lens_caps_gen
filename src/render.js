// Studio-render page used by scripts/render.mjs to make the README images. Not part of the tool itself.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// spec: { w, h, bg:[inner,outer], cam:{pos,target,fov}, light:[x,y,z], caps:[{pos,col,x,y,flip,label,sub}] }
//   pos/col: non-indexed triangle arrays in cap coordinates (z=0 = top face). flip=false: top face up (resting on its rim). flip=true: printed orientation (open end up).
window.renderScene = (spec) => {
  document.body.style.margin = '0';
  const wrap = document.getElementById('wrap');
  wrap.style.cssText = `position:relative;width:${spec.w}px;height:${spec.h}px;overflow:hidden;background:radial-gradient(ellipse at 50% 38%, ${spec.bg[0]} 0%, ${spec.bg[1]} 78%);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`;
  const canvas = document.getElementById('c'); canvas.width = spec.w; canvas.height = spec.h;
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(spec.w, spec.h, false);
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = spec.exposure || 1.0;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(r);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = spec.env ?? 0.55;

  const sun = new THREE.DirectionalLight(0xffffff, spec.sun ?? 2.4);
  sun.position.set(...(spec.light || [-60, -40, 90])); sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096); sun.shadow.radius = 6; sun.shadow.bias = -0.0004;
  const S = spec.shadowSize || 90; Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 400 });
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.ShadowMaterial({ opacity: spec.shadowOpacity ?? 0.45 }));
  floor.receiveShadow = true; scene.add(floor);

  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.46, metalness: 0.0, clearcoat: 0.18, clearcoatRoughness: 0.5 });
  const H = 10.4;
  for (const c of spec.caps) {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(c.pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(c.col), 3));
    g = toCreasedNormals(g, Math.PI / 5);
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true;
    // flip=false: rotate 180 deg about Y so the top face points up and the cap rests on its open rim
    if (!c.flip) { m.rotation.y = Math.PI; m.position.set(c.x, c.y, H); } else m.position.set(c.x, c.y, 0);
    if (c.tilt) { m.rotation.x = c.tilt; m.position.z += c.lift || 0; }
    scene.add(m);
  }
  const cam = new THREE.PerspectiveCamera(spec.cam.fov, spec.w / spec.h, 1, 1000);
  cam.up.set(0, 0, 1); cam.position.set(...spec.cam.pos); cam.lookAt(...spec.cam.target);
  cam.updateMatrixWorld();
  r.render(scene, cam);

  // HTML labels under each cap (projected from the cap's floor position)
  for (const c of spec.caps) {
    if (!c.label) continue;
    const mid = new THREE.Vector3(c.x, c.y, 0).project(cam), front = new THREE.Vector3(c.x, c.y + (c.labelDy ?? -25), 0).project(cam);
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:${(mid.x * 0.5 + 0.5) * spec.w}px;top:${(-front.y * 0.5 + 0.5) * spec.h}px;transform:translate(-50%,0);text-align:center;color:${spec.labelColor || '#e8ebf2'};white-space:nowrap`;
    d.innerHTML = `<div style="font-weight:650;font-size:${spec.labelSize || 26}px;letter-spacing:.2px">${c.label}</div>` + (c.sub ? `<div style="font-size:${(spec.labelSize || 26) * 0.62}px;opacity:.6;margin-top:2px">${c.sub}</div>` : '');
    wrap.appendChild(d);
  }
  if (spec.title) {
    const t = document.createElement('div');
    t.style.cssText = `position:absolute;left:${spec.title.x ?? 64}px;top:${spec.title.y ?? 56}px;color:#fff;max-width:${spec.title.w ?? 520}px`;
    t.innerHTML = spec.title.html; wrap.appendChild(t);
  }
  window.__done = true;
};

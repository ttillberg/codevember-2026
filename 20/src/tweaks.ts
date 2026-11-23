import * as THREE from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

/**
 * ?debug: a panel for the colours and the render settings, to find the look by hand. What is set is kept in this
 * browser (localStorage) until reset; "copy" puts it on the clipboard as JSON, to be written back into the code.
 */
export function tweaks(t: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  hemi: THREE.HemisphereLight;
  ao: { blendIntensity: number; updateGtaoMaterial: (p: Record<string, number>) => void };
  rays: { intensity: number; fade: number; smoke: number; top: number; topFade: number; fan: number; fanFade: number };
  hall: { sun: THREE.DirectionalLight; roof: THREE.SpotLight; left: THREE.SpotLight; right: THREE.SpotLight; shaftGain: number; moveSun: () => void };
}) {
  const KEY = 'cocoon20.tweaks';
  const fog = t.scene.fog as THREE.Fog;
  const { sun, roof, left, right } = t.hall;
  const hex = (c: THREE.Color) => ({
    get v() { return '#' + c.getHexString(); },
    set v(s: string) { c.set(s); },
  });
  const gui = new GUI({ title: 'look' });
  gui.domElement.style.zIndex = '20';

  const r = gui.addFolder('render');
  const tm = { get mode() { return t.renderer.toneMapping; }, set mode(m: THREE.ToneMapping) { t.renderer.toneMapping = m; } };
  r.add(tm, 'mode', { ACES: THREE.ACESFilmicToneMapping, AgX: THREE.AgXToneMapping, Neutral: THREE.NeutralToneMapping, Reinhard: THREE.ReinhardToneMapping, None: THREE.NoToneMapping }).name('tone mapping');
  r.add(t.renderer, 'toneMappingExposure', 0.1, 4, 0.01).name('exposure');
  r.add(t.scene, 'environmentIntensity', 0, 2, 0.01).name('environment');
  r.add(t.hemi, 'intensity', 0, 3, 0.01).name('fill');
  r.addColor(hex(t.hemi.color), 'v').name('fill sky');
  r.addColor(hex(t.hemi.groundColor), 'v').name('fill ground');

  const f = gui.addFolder('haze');
  f.addColor(hex(fog.color), 'v').name('colour low');
  f.add(fog, 'near', 0, 0.16, 0.001).name('density');
  f.add(fog, 'far', 1, 40, 0.1).name('brighter up high');
  const bg = t.scene.background as THREE.Color;
  f.addColor(hex(bg), 'v').name('background');

  const s = gui.addFolder('sun');
  s.add(sun, 'intensity', 0, 10, 0.01);
  s.addColor(hex(sun.color), 'v').name('colour');
  const dir = (() => {
    const d = sun.position.clone().sub(sun.target.position);
    const dist = d.length();
    let az = Math.atan2(d.z, d.x), el = Math.asin(d.y / dist);
    const put = () => {
      sun.position.copy(sun.target.position).add(new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).multiplyScalar(dist));
      t.hall.moveSun();
    };
    return {
      get azimuth() { return THREE.MathUtils.radToDeg(az); }, set azimuth(v: number) { az = THREE.MathUtils.degToRad(v); put(); },
      get elevation() { return THREE.MathUtils.radToDeg(el); }, set elevation(v: number) { el = THREE.MathUtils.degToRad(v); put(); },
    };
  })();
  s.add(dir, 'azimuth', -180, 180, 0.5);
  s.add(dir, 'elevation', 10, 89, 0.5);
  s.add(t.rays, 'intensity', 0, 4, 0.01).name('in the haze');
  s.add(t.rays, 'fade', 0, 0.06, 0.001).name('used up going down');
  s.add(t.rays, 'smoke', 0, 1, 0.01).name('smoke');
  s.add(t.rays, 'top', 0, 40, 0.1).name('glare under the roof');
  s.add(t.rays, 'topFade', 0.02, 0.6, 0.005).name('glare gone in');
  s.add(t.rays, 'fan', 0, 20, 0.1).name('through the fans');
  s.add(t.rays, 'fanFade', 0, 0.1, 0.001).name('fans used up');

  const l = gui.addFolder('lights');
  l.add(roof, 'intensity', 0, 30, 0.1).name('skylight');
  l.addColor(hex(roof.color), 'v').name('skylight colour');
  l.add(left, 'intensity', 0, 10, 0.05).name('left');
  l.addColor(hex(left.color), 'v').name('left colour');
  l.add(right, 'intensity', 0, 10, 0.05).name('right');
  l.addColor(hex(right.color), 'v').name('right colour');
  const sh = { gain: 1 };
  l.add(sh, 'gain', 0, 4, 0.01).name('faked shafts').onChange((g: number) => (t.hall.shaftGain = g));

  const a = gui.addFolder('ao');
  a.add(t.ao, 'blendIntensity', 0, 1.5, 0.01).name('amount');
  const ap = { radius: 0.45, scale: 1.7 };
  a.add(ap, 'radius', 0.05, 2, 0.01).onChange(() => t.ao.updateGtaoMaterial(ap));
  a.add(ap, 'scale', 0.1, 4, 0.01).onChange(() => t.ao.updateGtaoMaterial(ap));

  for (const folder of gui.folders.slice(1)) folder.close();

  const store = (() => { try { return window.localStorage; } catch { return null; } })();
  try { const saved = store?.getItem(KEY); if (saved) gui.load(JSON.parse(saved)); } catch { /* a stale shape: ignore it */ }
  gui.onFinishChange(() => { try { store?.setItem(KEY, JSON.stringify(gui.save())); } catch { /* no storage */ } });
  gui.add({ copy: () => navigator.clipboard?.writeText(JSON.stringify(gui.save(), null, 2)) }, 'copy').name('copy as json');
  gui.add({ reset: () => { gui.reset(); try { store?.removeItem(KEY); } catch { /* no storage */ } } }, 'reset').name('reset to the code');
  return gui;
}

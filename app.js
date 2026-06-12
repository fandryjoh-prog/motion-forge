// ============================================================
// MOTIONFORGE - Core data model, rendering engine, interpolation
// ============================================================

const STAGE_W = 1920, STAGE_H = 1080;
const PREVIEW_SCALE = 0.5; // 960x540 preview canvas

// --- Easing functions ---
const EASINGS = {
  linear: t => t,
  easeIn: t => t * t,
  easeOut: t => 1 - (1 - t) * (1 - t),
  easeInOut: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  bounce: t => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  back: t => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
};

// --- App State ---
const state = {
  scenes: [
    { id: 'scene1', name: 'Scène 1', duration: 5, transition: 'fade', layers: [] }
  ],
  activeSceneId: 'scene1',
  selectedLayerId: null,
  currentTime: 0,
  isPlaying: false,
  selectedProp: null, // {layerId, propPath}
};

let layerIdCounter = 1;
let sceneIdCounter = 2;

function getActiveScene() {
  return state.scenes.find(s => s.id === state.activeSceneId);
}

function getSelectedLayer() {
  const scene = getActiveScene();
  if (!scene) return null;
  return scene.layers.find(l => l.id === state.selectedLayerId);
}

// --- Layer factory ---
function createLayer(type) {
  const id = 'layer' + (layerIdCounter++);
  const base = {
    id, type,
    name: type === 'text' ? 'Texte' : type === 'shape' ? 'Forme' : 'Image',
    visible: true,
    // Base transform properties (default values)
    props: {
      x: STAGE_W / 2,
      y: STAGE_H / 2,
      scale: 1,
      rotation: 0,
      opacity: 1,
    },
    // Keyframes: { propName: [ {time, value, easing}, ... ] }
    keyframes: {}
  };

  if (type === 'text') {
    base.props.text = 'Votre titre';
    base.props.fontSize = 80;
    base.props.color = '#ffffff';
    base.props.fontWeight = 700;
    base.props.fontFamily = 'Arial';
  } else if (type === 'shape') {
    base.props.shapeType = 'rect'; // rect, circle, line
    base.props.width = 300;
    base.props.height = 150;
    base.props.fill = '#ff5e3a';
    base.props.stroke = 'none';
    base.props.strokeWidth = 0;
    base.props.radius = 0; // border radius for rect
  } else if (type === 'image') {
    base.props.src = '';
    base.props.width = 400;
    base.props.height = 300;
  }

  return base;
}

// --- Keyframe management ---
function hasKeyframes(layer, propName) {
  return layer.keyframes[propName] && layer.keyframes[propName].length > 0;
}

function toggleKeyframe(layer, propName) {
  if (!layer.keyframes[propName]) layer.keyframes[propName] = [];
  const kfs = layer.keyframes[propName];
  const time = state.currentTime;
  const existingIdx = kfs.findIndex(k => Math.abs(k.time - time) < 0.01);

  if (existingIdx >= 0) {
    // Remove existing keyframe at this time
    kfs.splice(existingIdx, 1);
    if (kfs.length === 0) delete layer.keyframes[propName];
  } else {
    // Add new keyframe with current value
    const currentValue = getPropValue(layer, propName, time);
    kfs.push({ time, value: currentValue, easing: 'easeInOut' });
    kfs.sort((a, b) => a.time - b.time);
  }
}

function addKeyframeAtCurrentTime(layer, propName, value) {
  if (!layer.keyframes[propName]) layer.keyframes[propName] = [];
  const kfs = layer.keyframes[propName];
  const time = state.currentTime;
  const existingIdx = kfs.findIndex(k => Math.abs(k.time - time) < 0.01);
  if (existingIdx >= 0) {
    kfs[existingIdx].value = value;
  } else {
    kfs.push({ time, value, easing: 'easeInOut' });
    kfs.sort((a, b) => a.time - b.time);
  }
}

// Get interpolated property value at a given time
function getPropValue(layer, propName, time) {
  const kfs = layer.keyframes[propName];
  const baseValue = layer.props[propName];

  if (!kfs || kfs.length === 0) {
    return baseValue;
  }

  if (kfs.length === 1) {
    return kfs[0].value;
  }

  // Find surrounding keyframes
  if (time <= kfs[0].time) return kfs[0].value;
  if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

  for (let i = 0; i < kfs.length - 1; i++) {
    const k1 = kfs[i], k2 = kfs[i + 1];
    if (time >= k1.time && time <= k2.time) {
      const span = k2.time - k1.time;
      const t = span === 0 ? 0 : (time - k1.time) / span;
      const eased = EASINGS[k1.easing] ? EASINGS[k1.easing](t) : t;

      // Numeric interpolation
      if (typeof k1.value === 'number' && typeof k2.value === 'number') {
        return k1.value + (k2.value - k1.value) * eased;
      }
      // Color interpolation
      if (typeof k1.value === 'string' && k1.value.startsWith('#') && typeof k2.value === 'string' && k2.value.startsWith('#')) {
        return interpolateColor(k1.value, k2.value, eased);
      }
      // Non-interpolable: step at 50%
      return eased < 0.5 ? k1.value : k2.value;
    }
  }
  return baseValue;
}

function interpolateColor(c1, c2, t) {
  const a = hexToRgb(c1), b = hexToRgb(c2);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return rgbToHex(r, g, bl);
}
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const num = parseInt(hex, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Get all current (effective) values for a layer at current time
function getEffectiveProps(layer, time) {
  const result = {};
  for (const key in layer.props) {
    result[key] = getPropValue(layer, key, time);
  }
  return result;
}

// ============================================================
// RENDERING
// ============================================================

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

function renderFrame(time, customCtx, customW, customH) {
  const c = customCtx || ctx;
  const w = customW || canvas.width;
  const h = customH || canvas.height;
  const scale = w / STAGE_W;

  const scene = getActiveScene();
  if (!scene) return;

  c.clearRect(0, 0, w, h);
  // Background
  c.fillStyle = '#0a0a0c';
  c.fillRect(0, 0, w, h);

  // Transition handling
  let globalOpacity = 1;
  let globalTransform = null;
  const transType = scene.transition;
  const transDuration = 0.6; // seconds
  const sceneDur = scene.duration;

  if (transType !== 'none') {
    // Outgoing transition near end of scene
    if (time > sceneDur - transDuration) {
      const tProgress = (time - (sceneDur - transDuration)) / transDuration; // 0..1
      const e = EASINGS.easeInOut(Math.min(1, Math.max(0, tProgress)));
      if (transType === 'fade') {
        globalOpacity = 1 - e;
      } else if (transType === 'slide-left') {
        globalTransform = { tx: -e * w, ty: 0 };
      } else if (transType === 'slide-right') {
        globalTransform = { tx: e * w, ty: 0 };
      } else if (transType === 'zoom') {
        globalOpacity = 1 - e;
        globalTransform = { scaleAdd: e * 0.5 };
      } else if (transType === 'wipe') {
        globalTransform = { wipe: e };
      }
    }
  }

  for (const layer of scene.layers) {
    if (!layer.visible) continue;
    const p = getEffectiveProps(layer, time);

    c.save();
    c.globalAlpha = (p.opacity ?? 1) * globalOpacity;

    let tx = 0, ty = 0, extraScale = 0;
    if (globalTransform) {
      tx = globalTransform.tx || 0;
      ty = globalTransform.ty || 0;
      extraScale = globalTransform.scaleAdd || 0;
    }

    const px = p.x * scale + tx;
    const py = p.y * scale + ty;

    c.translate(px, py);
    c.rotate((p.rotation || 0) * Math.PI / 180);
    c.scale((p.scale || 1) * scale + extraScale * scale, (p.scale || 1) * scale + extraScale * scale);

    if (globalTransform && globalTransform.wipe !== undefined) {
      // Wipe clip in stage coordinates centered at px,py - approximate via clip rect
      c.restore();
      c.save();
      c.globalAlpha = (p.opacity ?? 1);
      const wipeX = (1 - globalTransform.wipe) * w;
      c.beginPath();
      c.rect(0, 0, wipeX, h);
      c.clip();
      c.translate(p.x * scale, p.y * scale);
      c.rotate((p.rotation || 0) * Math.PI / 180);
      c.scale((p.scale || 1) * scale, (p.scale || 1) * scale);
    }

    drawLayer(c, layer, p, scale);
    c.restore();
  }
}

function drawLayer(c, layer, p, scale) {
  if (layer.type === 'text') {
    c.font = `${p.fontWeight || 700} ${p.fontSize}px ${p.fontFamily || 'Arial'}`;
    c.fillStyle = p.color || '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(p.text || '', 0, 0);
  } else if (layer.type === 'shape') {
    c.fillStyle = p.fill || '#ff5e3a';
    if (p.stroke && p.stroke !== 'none') {
      c.strokeStyle = p.stroke;
      c.lineWidth = p.strokeWidth || 2;
    }
    if (p.shapeType === 'rect') {
      const w = p.width, h = p.height;
      const r = p.radius || 0;
      c.beginPath();
      roundRect(c, -w/2, -h/2, w, h, r);
      c.fill();
      if (p.stroke && p.stroke !== 'none') c.stroke();
    } else if (p.shapeType === 'circle') {
      c.beginPath();
      c.arc(0, 0, p.width / 2, 0, Math.PI * 2);
      c.fill();
      if (p.stroke && p.stroke !== 'none') c.stroke();
    } else if (p.shapeType === 'line') {
      c.beginPath();
      c.moveTo(-p.width/2, 0);
      c.lineTo(p.width/2, 0);
      c.lineWidth = p.strokeWidth || 4;
      c.strokeStyle = p.fill || '#ff5e3a';
      c.stroke();
    }
  } else if (layer.type === 'image') {
    if (layer._imgEl && layer._imgEl.complete) {
      c.drawImage(layer._imgEl, -p.width/2, -p.height/2, p.width, p.height);
    } else {
      // placeholder
      c.strokeStyle = '#444';
      c.lineWidth = 2;
      c.setLineDash([8, 8]);
      c.strokeRect(-p.width/2, -p.height/2, p.width, p.height);
      c.fillStyle = '#666';
      c.font = '24px Arial';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('Image', 0, 0);
      c.setLineDash([]);
    }
  }
}

function roundRect(c, x, y, w, h, r) {
  if (r === 0) { c.rect(x, y, w, h); return; }
  const rr = Math.min(r, Math.abs(w)/2, Math.abs(h)/2);
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

function render() {
  renderFrame(state.currentTime);
}
// ============================================================
// MOTIONFORGE - UI Layer (scenes, layers, properties, timeline)
// ============================================================

const PROP_DEFS = {
  text: [
    { key: 'text', label: 'Texte', type: 'textarea', animatable: false },
    { key: 'fontSize', label: 'Taille', type: 'number', animatable: true, min: 8, max: 400, step: 1 },
    { key: 'color', label: 'Couleur', type: 'color', animatable: true },
    { key: 'fontFamily', label: 'Police', type: 'select', animatable: false, options: ['Arial', 'Georgia', 'Helvetica', 'Courier New', 'Impact', 'Verdana'] },
    { key: 'fontWeight', label: 'Épaisseur', type: 'select', animatable: false, options: ['400', '600', '700', '900'] },
  ],
  shape: [
    { key: 'shapeType', label: 'Type', type: 'select', animatable: false, options: ['rect', 'circle', 'line'] },
    { key: 'width', label: 'Largeur', type: 'number', animatable: true, min: 1, max: 1920, step: 1 },
    { key: 'height', label: 'Hauteur', type: 'number', animatable: true, min: 1, max: 1080, step: 1 },
    { key: 'fill', label: 'Couleur', type: 'color', animatable: true },
    { key: 'stroke', label: 'Contour', type: 'text', animatable: false },
    { key: 'strokeWidth', label: 'Épais. trait', type: 'number', animatable: true, min: 0, max: 50, step: 1 },
    { key: 'radius', label: 'Arrondi', type: 'number', animatable: true, min: 0, max: 200, step: 1 },
  ],
  image: [
    { key: 'src', label: 'URL image', type: 'text', animatable: false },
    { key: 'width', label: 'Largeur', type: 'number', animatable: true, min: 1, max: 1920, step: 1 },
    { key: 'height', label: 'Hauteur', type: 'number', animatable: true, min: 1, max: 1080, step: 1 },
  ]
};

const TRANSFORM_PROPS = [
  { key: 'x', label: 'X', type: 'number', animatable: true, min: -2000, max: 4000, step: 1 },
  { key: 'y', label: 'Y', type: 'number', animatable: true, min: -2000, max: 4000, step: 1 },
  { key: 'scale', label: 'Échelle', type: 'number', animatable: true, min: 0, max: 10, step: 0.01 },
  { key: 'rotation', label: 'Rotation', type: 'number', animatable: true, min: -360, max: 360, step: 1 },
  { key: 'opacity', label: 'Opacité', type: 'number', animatable: true, min: 0, max: 1, step: 0.01 },
];

// Pixels per second on the timeline ruler/tracks
const PX_PER_SEC = 120;

// ============================================================
// SCENES
// ============================================================

function renderScenesBar() {
  const bar = document.getElementById('scenes-bar');
  bar.innerHTML = '';
  state.scenes.forEach(scene => {
    const tab = document.createElement('div');
    tab.className = 'scene-tab' + (scene.id === state.activeSceneId ? ' active' : '');
    tab.innerHTML = `<span>${escapeHtml(scene.name)}</span>` + (state.scenes.length > 1 ? `<span class="x" data-remove-scene="${scene.id}">✕</span>` : '');
    tab.addEventListener('click', (e) => {
      if (e.target.dataset.removeScene) return;
      state.activeSceneId = scene.id;
      state.selectedLayerId = null;
      state.currentTime = 0;
      fullRefresh();
    });
    const xBtn = tab.querySelector('[data-remove-scene]');
    if (xBtn) {
      xBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeScene(scene.id);
      });
    }
    bar.appendChild(tab);
  });
  const addBtn = document.createElement('div');
  addBtn.className = 'scene-tab';
  addBtn.textContent = '+ Scène';
  addBtn.addEventListener('click', addScene);
  bar.appendChild(addBtn);
}

function addScene() {
  const id = 'scene' + (sceneIdCounter++);
  state.scenes.push({ id, name: `Scène ${state.scenes.length + 1}`, duration: 5, transition: 'none', layers: [] });
  state.activeSceneId = id;
  state.selectedLayerId = null;
  state.currentTime = 0;
  fullRefresh();
}

function removeScene(id) {
  if (state.scenes.length <= 1) return;
  const idx = state.scenes.findIndex(s => s.id === id);
  state.scenes.splice(idx, 1);
  if (state.activeSceneId === id) {
    state.activeSceneId = state.scenes[Math.max(0, idx - 1)].id;
    state.selectedLayerId = null;
    state.currentTime = 0;
  }
  fullRefresh();
}

// ============================================================
// LAYERS
// ============================================================

function renderLayerList() {
  const list = document.getElementById('layer-list');
  const scene = getActiveScene();
  list.innerHTML = '';

  if (!scene.layers.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Aucun calque. Ajoute du texte, une forme ou une image ci-dessous.';
    list.appendChild(empty);
    return;
  }

  // Render top layer first (last in array = on top, so reverse for display)
  [...scene.layers].reverse().forEach(layer => {
    const item = document.createElement('div');
    item.className = 'layer-item' + (layer.id === state.selectedLayerId ? ' selected' : '') + (!layer.visible ? ' hidden-layer' : '');
    item.innerHTML = `
      <span class="icon">${layerIcon(layer.type)}</span>
      <span class="name">${escapeHtml(layer.name)}</span>
      <span class="vis-toggle" data-toggle-vis="${layer.id}">${layer.visible ? '◉' : '○'}</span>
      <span class="vis-toggle" data-remove-layer="${layer.id}" title="Supprimer">✕</span>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.dataset.toggleVis || e.target.dataset.removeLayer) return;
      state.selectedLayerId = layer.id;
      renderLayerList();
      renderProps();
      renderTimelineTracks();
    });
    item.querySelector('[data-toggle-vis]').addEventListener('click', (e) => {
      e.stopPropagation();
      layer.visible = !layer.visible;
      renderLayerList();
      render();
    });
    item.querySelector('[data-remove-layer]').addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = scene.layers.findIndex(l => l.id === layer.id);
      scene.layers.splice(idx, 1);
      if (state.selectedLayerId === layer.id) state.selectedLayerId = null;
      fullRefresh();
    });
    list.appendChild(item);
  });
}

function layerIcon(type) {
  if (type === 'text') return 'T';
  if (type === 'shape') return '◆';
  if (type === 'image') return '▢';
  return '?';
}

function addLayer(type) {
  const scene = getActiveScene();
  const layer = createLayer(type);
  layer.name = layer.name + ' ' + (scene.layers.filter(l => l.type === type).length + 1);
  scene.layers.push(layer);
  state.selectedLayerId = layer.id;
  fullRefresh();
}

// ============================================================
// PROPERTIES PANEL
// ============================================================

function renderProps() {
  const container = document.getElementById('props-content');
  const layer = getSelectedLayer();
  container.innerHTML = '';

  if (!layer) {
    container.innerHTML = '<div class="empty-state">Sélectionne un calque pour modifier ses propriétés et placer des images-clés.</div>';
    return;
  }

  // Name field
  const nameGroup = document.createElement('div');
  nameGroup.className = 'prop-group';
  nameGroup.innerHTML = `<div class="prop-group-title">Calque</div>`;
  const nameRow = document.createElement('div');
  nameRow.className = 'prop-row';
  nameRow.innerHTML = `<span class="prop-label">Nom</span><input class="prop-input" type="text" value="${escapeHtml(layer.name)}">`;
  nameRow.querySelector('input').addEventListener('input', (e) => {
    layer.name = e.target.value;
    renderLayerList();
  });
  nameGroup.appendChild(nameRow);
  container.appendChild(nameGroup);

  // Transform group
  container.appendChild(buildPropGroup('Transformation', TRANSFORM_PROPS, layer));

  // Type-specific group
  const defs = PROP_DEFS[layer.type] || [];
  container.appendChild(buildPropGroup(layer.type === 'text' ? 'Texte' : layer.type === 'shape' ? 'Forme' : 'Image', defs, layer));

  // Image upload helper
  if (layer.type === 'image') {
    const helpDiv = document.createElement('div');
    helpDiv.className = 'hint';
    helpDiv.style.marginTop = '4px';
    helpDiv.textContent = 'Colle une URL d\'image (https://...) ou un data URI. Les fichiers locaux ne sont pas chargés automatiquement pour des raisons de sécurité du navigateur.';
    container.appendChild(helpDiv);
  }
}

function buildPropGroup(title, defs, layer) {
  const group = document.createElement('div');
  group.className = 'prop-group';
  const titleEl = document.createElement('div');
  titleEl.className = 'prop-group-title';
  titleEl.textContent = title;
  group.appendChild(titleEl);

  defs.forEach(def => {
    const row = document.createElement('div');
    row.className = 'prop-row';

    const label = document.createElement('span');
    label.className = 'prop-label';
    label.textContent = def.label;
    row.appendChild(label);

    let input;
    const currentVal = getPropValue(layer, def.key, state.currentTime);

    if (def.type === 'select') {
      input = document.createElement('select');
      input.className = 'prop-input';
      def.options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        if (String(currentVal) === String(opt)) o.selected = true;
        input.appendChild(o);
      });
    } else if (def.type === 'textarea') {
      input = document.createElement('textarea');
      input.className = 'prop-input';
      input.value = currentVal ?? '';
    } else if (def.type === 'color') {
      input = document.createElement('input');
      input.className = 'prop-input';
      input.type = 'color';
      input.value = currentVal || '#ffffff';
    } else {
      input = document.createElement('input');
      input.className = 'prop-input';
      input.type = def.type;
      if (def.min !== undefined) input.min = def.min;
      if (def.max !== undefined) input.max = def.max;
      if (def.step !== undefined) input.step = def.step;
      input.value = currentVal ?? '';
    }

    input.addEventListener('input', () => {
      let val = input.value;
      if (def.type === 'number') val = parseFloat(val);

      if (def.animatable && hasKeyframes(layer, def.key)) {
        addKeyframeAtCurrentTime(layer, def.key, val);
      } else {
        layer.props[def.key] = val;
      }

      if (layer.type === 'image' && def.key === 'src') {
        loadLayerImage(layer);
      }

      render();
      if (def.animatable) renderTimelineTracks();
    });

    row.appendChild(input);

    // Keyframe toggle button for animatable props
    if (def.animatable) {
      const kfBtn = document.createElement('div');
      kfBtn.className = 'kf-btn';
      const onCurrentKf = layer.keyframes[def.key] && layer.keyframes[def.key].some(k => Math.abs(k.time - state.currentTime) < 0.01);
      const hasAnyKf = hasKeyframes(layer, def.key);
      if (onCurrentKf) kfBtn.classList.add('active');
      else if (hasAnyKf) kfBtn.style.borderColor = 'var(--kf-color)';
      kfBtn.title = 'Activer/désactiver une image-clé à la position actuelle';
      kfBtn.addEventListener('click', () => {
        toggleKeyframe(layer, def.key);
        renderProps();
        renderTimelineTracks();
        render();
      });
      row.appendChild(kfBtn);
    }

    group.appendChild(row);
  });

  return group;
}

function loadLayerImage(layer) {
  if (!layer.props.src) { layer._imgEl = null; return; }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => render();
  img.onerror = () => { layer._imgEl = null; render(); };
  img.src = layer.props.src;
  layer._imgEl = img;
}

// ============================================================
// TIMELINE
// ============================================================

function renderTimelineTracks() {
  const scene = getActiveScene();
  const labelsEl = document.getElementById('track-labels');
  const tracksEl = document.getElementById('tracks-container');
  const rulerEl = document.getElementById('ruler');

  const totalWidth = Math.max(scene.duration * PX_PER_SEC, 400);

  // Ruler
  rulerEl.innerHTML = '';
  rulerEl.style.width = totalWidth + 'px';
  const step = scene.duration > 10 ? 1 : 0.5;
  for (let t = 0; t <= scene.duration + 0.001; t += step) {
    const tick = document.createElement('div');
    tick.className = 'ruler-tick';
    tick.style.left = (t * PX_PER_SEC) + 'px';
    tick.style.width = (step * PX_PER_SEC) + 'px';
    tick.textContent = t.toFixed(1) + 's';
    rulerEl.appendChild(tick);
  }

  // Labels + tracks
  labelsEl.innerHTML = '';
  tracksEl.innerHTML = '<div id="playhead"></div>';
  tracksEl.style.width = totalWidth + 'px';

  [...scene.layers].reverse().forEach(layer => {
    const labelEl = document.createElement('div');
    labelEl.className = 'track-label' + (layer.id === state.selectedLayerId ? ' selected' : '');
    labelEl.textContent = layer.name;
    labelEl.addEventListener('click', () => {
      state.selectedLayerId = layer.id;
      renderLayerList();
      renderProps();
      renderTimelineTracks();
    });
    labelsEl.appendChild(labelEl);

    const trackEl = document.createElement('div');
    trackEl.className = 'track-row';
    trackEl.style.width = totalWidth + 'px';

    // Draw a clip bar spanning the whole scene
    const clip = document.createElement('div');
    clip.className = 'track-clip' + (layer.id === state.selectedLayerId ? ' selected' : '');
    clip.style.left = '0px';
    clip.style.width = totalWidth + 'px';
    trackEl.appendChild(clip);

    // Draw keyframe dots for all animatable props
    const allKfTimes = new Set();
    Object.values(layer.keyframes).forEach(kfs => kfs.forEach(k => allKfTimes.add(Math.round(k.time * 100) / 100)));
    allKfTimes.forEach(time => {
      const dot = document.createElement('div');
      dot.className = 'keyframe-dot';
      dot.style.left = (time * PX_PER_SEC) + 'px';
      dot.title = `t=${time.toFixed(2)}s`;
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedLayerId = layer.id;
        state.currentTime = time;
        fullRefreshLight();
      });
      trackEl.appendChild(dot);
    });

    trackEl.appendChild(document.createElement('div')); // spacer for layering
    tracksEl.appendChild(trackEl);
  });

  updatePlayheadPosition();
  updateTimeDisplay();
}

function updatePlayheadPosition() {
  const playhead = document.getElementById('playhead');
  if (playhead) playhead.style.left = (state.currentTime * PX_PER_SEC) + 'px';
}

function updateTimeDisplay() {
  const scene = getActiveScene();
  const cur = document.querySelector('#time-display .current');
  const tot = document.querySelector('#time-display .total');
  cur.textContent = formatTime(state.currentTime);
  tot.textContent = formatTime(scene.duration);
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

// ============================================================
// PLAYBACK
// ============================================================

let playbackRAF = null;
let playbackStartWall = null;
let playbackStartTime = 0;

function togglePlay() {
  state.isPlaying = !state.isPlaying;
  document.getElementById('btn-play').textContent = state.isPlaying ? '⏸' : '▶';
  if (state.isPlaying) {
    playbackStartWall = performance.now();
    playbackStartTime = state.currentTime;
    playbackTick();
  } else {
    if (playbackRAF) cancelAnimationFrame(playbackRAF);
  }
}

function playbackTick() {
  const scene = getActiveScene();
  const elapsed = (performance.now() - playbackStartWall) / 1000;
  state.currentTime = playbackStartTime + elapsed;
  if (state.currentTime >= scene.duration) {
    state.currentTime = 0;
    playbackStartWall = performance.now();
    playbackStartTime = 0;
  }
  render();
  updatePlayheadPosition();
  updateTimeDisplay();
  if (state.isPlaying) {
    playbackRAF = requestAnimationFrame(playbackTick);
  }
}

function stopPlayback() {
  state.isPlaying = false;
  document.getElementById('btn-play').textContent = '▶';
  if (playbackRAF) cancelAnimationFrame(playbackRAF);
  state.currentTime = 0;
  render();
  updatePlayheadPosition();
  updateTimeDisplay();
}

// ============================================================
// REFRESH HELPERS
// ============================================================

function fullRefresh() {
  renderScenesBar();
  renderLayerList();
  renderProps();
  renderTimelineTracks();
  render();
  syncSceneControls();
}

function fullRefreshLight() {
  renderProps();
  renderTimelineTracks();
  render();
}

function syncSceneControls() {
  const scene = getActiveScene();
  document.getElementById('scene-duration').value = scene.duration;
  document.getElementById('transition-select').value = scene.transition;
  updateTransitionHint();
}

function updateTransitionHint() {
  const scene = getActiveScene();
  const hint = document.getElementById('transition-hint');
  if (scene.transition === 'none') {
    hint.textContent = '';
  } else {
    hint.textContent = `(0.6s en fin de scène)`;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ============================================================
// EVENT BINDINGS
// ============================================================

document.getElementById('btn-play').addEventListener('click', togglePlay);
document.getElementById('btn-stop').addEventListener('click', stopPlayback);

document.querySelectorAll('[data-add]').forEach(btn => {
  btn.addEventListener('click', () => addLayer(btn.dataset.add));
});

document.getElementById('scene-duration').addEventListener('input', (e) => {
  const scene = getActiveScene();
  scene.duration = Math.max(0.5, parseFloat(e.target.value) || 5);
  if (state.currentTime > scene.duration) state.currentTime = scene.duration;
  renderTimelineTracks();
  render();
});

document.getElementById('transition-select').addEventListener('change', (e) => {
  const scene = getActiveScene();
  scene.transition = e.target.value;
  updateTransitionHint();
  render();
});

// Ruler click → seek
document.getElementById('ruler').addEventListener('click', (e) => {
  const rect = e.target.closest('#ruler').getBoundingClientRect();
  const x = e.clientX - rect.left;
  const scene = getActiveScene();
  state.currentTime = Math.max(0, Math.min(scene.duration, x / PX_PER_SEC));
  state.isPlaying = false;
  document.getElementById('btn-play').textContent = '▶';
  fullRefreshLight();
});

// Track scroll click → seek too
document.getElementById('tracks-container').addEventListener('click', (e) => {
  if (e.target.id !== 'tracks-container' && !e.target.classList.contains('track-row')) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const scene = getActiveScene();
  state.currentTime = Math.max(0, Math.min(scene.duration, x / PX_PER_SEC));
  fullRefreshLight();
});

// Keyboard: space to play/pause
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    togglePlay();
  }
});


// ============================================================
// MOTIONFORGE - Export (video via MediaRecorder, CSS/SVG code)
// ============================================================

// ---------- VIDEO EXPORT ----------

document.getElementById('btn-export-video').addEventListener('click', () => {
  document.getElementById('export-modal').classList.add('show');
  document.getElementById('export-status').textContent = 'Prêt.';
  document.getElementById('export-progress-bar').style.width = '0%';
});

document.getElementById('export-cancel').addEventListener('click', () => {
  document.getElementById('export-modal').classList.remove('show');
});

document.getElementById('export-start').addEventListener('click', async () => {
  const format = document.getElementById('export-format').value;
  const res = parseInt(document.getElementById('export-res').value, 10);
  const bitrate = parseInt(document.getElementById('export-bitrate').value, 10);
  const startBtn = document.getElementById('export-start');
  const statusEl = document.getElementById('export-status');
  const progBar = document.getElementById('export-progress-bar');

  startBtn.disabled = true;

  try {
    await exportVideo(format, res, bitrate, (msg, pct) => {
      statusEl.textContent = msg;
      progBar.style.width = pct + '%';
    });
  } catch (err) {
    statusEl.textContent = 'Erreur: ' + err.message;
  }

  startBtn.disabled = false;
});

function pickMimeType(format) {
  const candidates = format === 'mp4'
    ? ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'video/webm';
}

async function exportVideo(format, resolution, bitrate, onProgress) {
  const w = resolution;
  const h = Math.round(resolution * (STAGE_H / STAGE_W));

  // Offscreen canvas for export rendering
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = w;
  exportCanvas.height = h;
  const exportCtx = exportCanvas.getContext('2d');

  const mimeType = pickMimeType(format);
  const actualExt = mimeType.includes('mp4') ? 'mp4' : 'webm';

  if (actualExt !== format) {
    onProgress(`Note: ${format.toUpperCase()} non supporté par ce navigateur, export en ${actualExt.toUpperCase()}...`, 1);
  }

  const stream = exportCanvas.captureStream(30); // 30fps
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bitrate
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const recordingDone = new Promise((resolve) => {
    recorder.onstop = resolve;
  });

  // Total duration = sum of all scenes
  const totalDuration = state.scenes.reduce((sum, s) => sum + s.duration, 0);
  const fps = 30;
  const frameDuration = 1 / fps;

  onProgress('Préparation du rendu...', 2);

  recorder.start();

  const originalActiveScene = state.activeSceneId;
  const originalTime = state.currentTime;

  let elapsedGlobal = 0;
  const totalFrames = Math.ceil(totalDuration * fps);
  let frameCount = 0;

  for (const scene of state.scenes) {
    state.activeSceneId = scene.id;
    const sceneFrames = Math.ceil(scene.duration * fps);
    for (let f = 0; f < sceneFrames; f++) {
      const t = f * frameDuration;
      state.currentTime = Math.min(t, scene.duration);
      renderFrame(state.currentTime, exportCtx, w, h);
      // Wait for the frame to be captured
      await new Promise(r => setTimeout(r, frameDuration * 1000));
      frameCount++;
      const pct = Math.round((frameCount / totalFrames) * 90) + 2;
      onProgress(`Rendu image ${frameCount}/${totalFrames}...`, pct);
    }
  }

  recorder.stop();
  await recordingDone;

  // Restore state
  state.activeSceneId = originalActiveScene;
  state.currentTime = originalTime;
  fullRefresh();

  onProgress('Finalisation...', 95);

  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `motionforge-export.${actualExt}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  onProgress(`Terminé ! Fichier .${actualExt} téléchargé.`, 100);
}

// ---------- CSS/SVG CODE EXPORT ----------

document.getElementById('btn-export-code').addEventListener('click', () => {
  const code = generateCodeExport();
  document.getElementById('code-output').value = code;
  document.getElementById('code-modal').style.display = 'flex';
});

document.getElementById('code-close').addEventListener('click', () => {
  document.getElementById('code-modal').style.display = 'none';
});

document.getElementById('code-copy').addEventListener('click', () => {
  const ta = document.getElementById('code-output');
  ta.select();
  document.execCommand('copy');
  const btn = document.getElementById('code-copy');
  const orig = btn.textContent;
  btn.textContent = 'Copié !';
  setTimeout(() => btn.textContent = orig, 1200);
});

function generateCodeExport() {
  const scene = getActiveScene();
  let css = '';
  let html = '';

  scene.layers.forEach((layer, idx) => {
    const elClass = `mf-layer-${idx}`;
    const baseProps = layer.props;

    // Build SVG/HTML element
    if (layer.type === 'text') {
      html += `  <div class="${elClass}">${escapeHtml(baseProps.text)}</div>\n`;
      css += `.${elClass} {\n`;
      css += `  position: absolute;\n`;
      css += `  left: ${pct(baseProps.x, STAGE_W)}%;\n`;
      css += `  top: ${pct(baseProps.y, STAGE_H)}%;\n`;
      css += `  transform: translate(-50%, -50%) scale(${baseProps.scale}) rotate(${baseProps.rotation}deg);\n`;
      css += `  font-size: ${pctSize(baseProps.fontSize)}vw;\n`;
      css += `  font-weight: ${baseProps.fontWeight};\n`;
      css += `  font-family: ${baseProps.fontFamily}, sans-serif;\n`;
      css += `  color: ${baseProps.color};\n`;
      css += `  opacity: ${baseProps.opacity};\n`;
      css += `  white-space: nowrap;\n`;
      css += `}\n`;
    } else if (layer.type === 'shape') {
      if (baseProps.shapeType === 'circle') {
        html += `  <div class="${elClass}"></div>\n`;
        css += `.${elClass} {\n`;
        css += `  position: absolute;\n`;
        css += `  left: ${pct(baseProps.x, STAGE_W)}%;\n`;
        css += `  top: ${pct(baseProps.y, STAGE_H)}%;\n`;
        css += `  width: ${pct(baseProps.width, STAGE_W)}vw;\n`;
        css += `  height: ${pct(baseProps.width, STAGE_W)}vw;\n`;
        css += `  border-radius: 50%;\n`;
        css += `  background: ${baseProps.fill};\n`;
        css += `  transform: translate(-50%, -50%) scale(${baseProps.scale}) rotate(${baseProps.rotation}deg);\n`;
        css += `  opacity: ${baseProps.opacity};\n`;
        css += `}\n`;
      } else {
        html += `  <div class="${elClass}"></div>\n`;
        css += `.${elClass} {\n`;
        css += `  position: absolute;\n`;
        css += `  left: ${pct(baseProps.x, STAGE_W)}%;\n`;
        css += `  top: ${pct(baseProps.y, STAGE_H)}%;\n`;
        css += `  width: ${pct(baseProps.width, STAGE_W)}vw;\n`;
        css += `  height: ${pct(baseProps.height, STAGE_H)}vh;\n`;
        css += `  background: ${baseProps.fill};\n`;
        css += `  border-radius: ${baseProps.radius}px;\n`;
        if (baseProps.stroke !== 'none') {
          css += `  border: ${baseProps.strokeWidth}px solid ${baseProps.stroke};\n`;
        }
        css += `  transform: translate(-50%, -50%) scale(${baseProps.scale}) rotate(${baseProps.rotation}deg);\n`;
        css += `  opacity: ${baseProps.opacity};\n`;
        css += `}\n`;
      }
    } else if (layer.type === 'image') {
      html += `  <img class="${elClass}" src="${escapeHtml(baseProps.src)}" alt="${escapeHtml(layer.name)}">\n`;
      css += `.${elClass} {\n`;
      css += `  position: absolute;\n`;
      css += `  left: ${pct(baseProps.x, STAGE_W)}%;\n`;
      css += `  top: ${pct(baseProps.y, STAGE_H)}%;\n`;
      css += `  width: ${pct(baseProps.width, STAGE_W)}vw;\n`;
      css += `  height: ${pct(baseProps.height, STAGE_H)}vh;\n`;
      css += `  transform: translate(-50%, -50%) scale(${baseProps.scale}) rotate(${baseProps.rotation}deg);\n`;
      css += `  opacity: ${baseProps.opacity};\n`;
      css += `}\n`;
    }

    // Generate keyframe animation if any props have keyframes
    const animatedProps = Object.keys(layer.keyframes).filter(k => layer.keyframes[k].length > 1);
    if (animatedProps.length > 0) {
      const animName = `anim-${elClass}`;
      css += `\n@keyframes ${animName} {\n`;

      // Collect all unique time points
      const timePoints = new Set([0, scene.duration]);
      animatedProps.forEach(prop => {
        layer.keyframes[prop].forEach(k => timePoints.add(k.time));
      });
      const sortedTimes = [...timePoints].sort((a, b) => a - b);

      sortedTimes.forEach(t => {
        const pctTime = ((t / scene.duration) * 100).toFixed(2);
        css += `  ${pctTime}% {\n`;
        css += `    transform: translate(-50%, -50%)`;

        const scaleVal = getPropValue(layer, 'scale', t);
        const rotVal = getPropValue(layer, 'rotation', t);
        css += ` scale(${scaleVal.toFixed(3)}) rotate(${rotVal.toFixed(1)}deg)`;
        css += `;\n`;

        if (animatedProps.includes('opacity')) {
          css += `    opacity: ${getPropValue(layer, 'opacity', t).toFixed(2)};\n`;
        }
        if (animatedProps.includes('x') || animatedProps.includes('y')) {
          const xVal = getPropValue(layer, 'x', t);
          const yVal = getPropValue(layer, 'y', t);
          css += `    left: ${pct(xVal, STAGE_W)}%;\n`;
          css += `    top: ${pct(yVal, STAGE_H)}%;\n`;
        }
        css += `  }\n`;
      });

      css += `}\n`;
      css += `\n.${elClass} {\n  animation: ${animName} ${scene.duration}s linear forwards;\n}\n`;
    }

    css += '\n';
  });

  const fullDoc = `<!-- ===== MotionForge Export — ${escapeHtml(scene.name)} ===== -->
<!-- Conteneur requis : position relative, ratio 16:9 -->
<div class="mf-stage">
${html}</div>

<style>
.mf-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #0a0a0c;
}
${css}</style>`;

  return fullDoc;
}

function pct(val, total) {
  return ((val / total) * 100).toFixed(3);
}

function pctSize(fontSizePx) {
  // Convert px (at 1920 width) to vw units
  return ((fontSizePx / STAGE_W) * 100).toFixed(3);
}

// ============================================================
// INIT
// ============================================================
fullRefresh();

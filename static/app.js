import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/controls/OrbitControls.js';

const $ = id => document.getElementById(id);
const state = {
  asteroids: [], selectedId: null, stream: null, captures: 0,
  labels: true, jpl: null, positions: {}, positionLoadingId: null
};
const fmt = (n, digits=0) => {
  if (n === null || n === undefined || n === '') return '\u2014';
  const v = Number(n); if (!Number.isFinite(v)) return '\u2014';
  return v.toLocaleString('en-US', {maximumFractionDigits:digits, minimumFractionDigits:digits});
};
const shortDist = n => { const v=Number(n); if(!Number.isFinite(v)) return '\u2014'; if(v>=1e9)return (v/1e9).toFixed(2)+'B'; if(v>=1e6)return (v/1e6).toFixed(2)+'M'; if(v>=1e3)return (v/1e3).toFixed(1)+'K'; return fmt(v); };
function log(message, kind='') {
  const el=document.createElement('div'); el.className='log-entry';
  const d=new Date(); const t=d.toISOString().slice(11,19);
  const time=document.createElement('span');time.className='log-time';time.textContent=t;
  const msg=document.createElement('span');msg.className='log-message '+kind;msg.textContent=message;
  el.append(time,msg);$('eventLog').prepend(el);
  while($('eventLog').children.length>18)$('eventLog').lastChild.remove();
}

function canonicalKey(obj) {
  return obj.canonical_jpl_id
    ? 'jpl:' + obj.canonical_jpl_id
    : 'nasa:' + obj.id;
}

function uniqueAsteroids() {
  const groups = new Map();

  for (const obj of state.asteroids) {
    const key = canonicalKey(obj);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(obj);
  }

  return [...groups.values()].map(group =>
    group.find(obj => /^\s*\d+\s/.test(obj.name)) || group[0]
  );
}
function updateJplCoverage() {
  const uniqueObjects = uniqueAsteroids();
  const total = uniqueObjects.length;

  const loaded = uniqueObjects.filter(
    obj => Boolean(state.positions[obj.id])
  ).length;

  const counter = document.getElementById('jplCoverage');
  const note = document.getElementById('jplCoverageNote');

  if (counter) {
    counter.textContent = loaded + ' / ' + total;
  }

  if (note) {
    note.textContent =
      total === 0 ? 'Waiting for catalogue' :
      loaded === total ? 'All positions loaded' :
      loaded + ' positions loaded';
  }
}

function clock(){
 const d=new Date(); $('utcClock').textContent='UTC '+d.toISOString().slice(11,19);
 $('cameraTime').textContent=d.toTimeString().slice(0,8); $('footerTime').textContent=d.toLocaleDateString()+' / LOCAL';
}
setInterval(clock,1000);clock();

// Three.js spatial environment: deliberately schematic, because NeoWs feed is not a full ephemeris.
const host=$('spaceCanvas');
const scene=new THREE.Scene(); scene.fog=new THREE.FogExp2(0x07101b,0.018);
const camera=new THREE.PerspectiveCamera(46,host.clientWidth/host.clientHeight,0.1,1000); camera.position.set(0,12,28);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setSize(host.clientWidth,host.clientHeight); renderer.outputColorSpace=THREE.SRGBColorSpace; host.prepend(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.06;controls.minDistance=8;controls.maxDistance=65;
scene.add(new THREE.AmbientLight(0x8baac8,1.45));
const keyLight=new THREE.PointLight(0x72d9ff,110);keyLight.position.set(-8,12,10);scene.add(keyLight);
const fillLight=new THREE.PointLight(0x2456aa,80);fillLight.position.set(12,-6,-8);scene.add(fillLight);
const starGeo=new THREE.BufferGeometry(), starCount=1400, starPos=new Float32Array(starCount*3);
for(let i=0;i<starCount;i++){const r=80+Math.random()*160, a=Math.random()*Math.PI*2, z=Math.random()*2-1, q=Math.sqrt(1-z*z);starPos[i*3]=r*q*Math.cos(a);starPos[i*3+1]=r*z;starPos[i*3+2]=r*q*Math.sin(a)}
starGeo.setAttribute('position',new THREE.BufferAttribute(starPos,3));
scene.add(new THREE.Points(starGeo,new THREE.PointsMaterial({color:0x7698b8,size:.23,transparent:true,opacity:.72,sizeAttenuation:true})));
const earthGroup=new THREE.Group();scene.add(earthGroup);
const earth=new THREE.Mesh(new THREE.SphereGeometry(2.1,64,48),new THREE.MeshStandardMaterial({color:0x1761a0,roughness:.78,metalness:.08,emissive:0x041b32,emissiveIntensity:.6}));
earthGroup.add(earth);
const cloud=new THREE.Mesh(new THREE.SphereGeometry(2.15,48,36),new THREE.MeshBasicMaterial({color:0x5ac8e9,wireframe:true,transparent:true,opacity:.07}));earthGroup.add(cloud);
const atm=new THREE.Mesh(new THREE.SphereGeometry(2.24,48,36),new THREE.MeshBasicMaterial({color:0x2aa6f0,transparent:true,opacity:.09,side:THREE.BackSide}));earthGroup.add(atm);
const grid=new THREE.Mesh(new THREE.SphereGeometry(2.18,24,16),new THREE.MeshBasicMaterial({color:0x62d5ff,wireframe:true,transparent:true,opacity:.10}));earthGroup.add(grid);
function makeOrbit(radius,color=0x254e67,opacity=.6,tilt=0){
 const pts=[];for(let i=0;i<=240;i++){const a=i/240*Math.PI*2;pts.push(new THREE.Vector3(Math.cos(a)*radius,Math.sin(a)*radius*.72,0))}
 const geo=new THREE.BufferGeometry().setFromPoints(pts);const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color,transparent:true,opacity}));
 line.rotation.x=tilt;scene.add(line);return line;
}
[5.5,8.2,11,14.5,18].forEach((r,i)=>makeOrbit(r,[0x2b7184,0x234f70,0x2b536a,0x1b405a,0x19364e][i],.48,i*.12));
const objectsGroup=new THREE.Group();scene.add(objectsGroup);
const targetGroup=new THREE.Group();scene.add(targetGroup);
const trailGroup=new THREE.Group();scene.add(trailGroup);
const externalTargetGroup=new THREE.Group();externalTargetGroup.visible=false;scene.add(externalTargetGroup);
let externalTargetMarker = null;
let externalTargetInfoNameElement = null;
let externalTargetMarkerStatusElement = null;
let externalTargetDisplayName = '';
const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2();let selectable=[];
function clearGroup(g){while(g.children.length){const o=g.children.pop();o.geometry?.dispose();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose()}}}

function showExternalTarget(position, name) {
  clearGroup(externalTargetGroup);
  externalTargetMarker = null;

  const x = Number(position.x_km);
  const y = Number(position.y_km);
  const z = Number(position.z_km);
  const distance = Number(position.distance_km);

  if (![x, y, z, distance].every(Number.isFinite) || distance <= 0) {
    throw new Error('Cannot plot incomplete external-target coordinates.');
  }

  // Preserve the Horizons vector direction, but compress its displayed radius.
  // This is a schematic marker, not a true-distance-scale position.
  const direction = new THREE.Vector3(x, z, -y).normalize();
  const displayRadius = Math.max(
    9,
    Math.min(14, 8 + 2 * Math.log10(Math.max(distance, 1) / 1000000))
  );
  const point = direction.multiplyScalar(displayRadius);

  const stem = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      point.clone(),
      point.clone().add(new THREE.Vector3(0, 1.1, 0))
    ]),
    new THREE.LineBasicMaterial({
      color: 0xff63d8,
      transparent: true,
      opacity: 0.9
    })
  );
  externalTargetGroup.add(stem);

  const marker = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.38, 2),
    new THREE.MeshBasicMaterial({ color: 0xff63d8 })
  );
  marker.name = 'external-target-marker';
  marker.position.copy(point);
  externalTargetMarker = marker;
  externalTargetGroup.add(marker);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xff63d8,
      wireframe: true,
      transparent: true,
      opacity: 0.65
    })
  );
  halo.position.copy(point);
  externalTargetGroup.add(halo);

  const label = createLabel(
    'EXTERNAL · ' + String(name || 'JPL target').slice(0, 32)
  );
  label.position.copy(point).add(new THREE.Vector3(0, 1.35, 0));
  externalTargetGroup.add(label);

  externalTargetGroup.visible = true;
  return displayRadius;
}

async function loadExternalHorizonsTrail(designation, name) {
  const targetName = String(name || 'JPL target');

  try {
    const response = await fetch(
      '/api/horizons-trail?designation=' + encodeURIComponent(designation)
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || 'JPL trail request failed');
    }

    if (!Array.isArray(data.samples) || data.samples.length < 2) {
      throw new Error('Not enough JPL trajectory samples');
    }

    // Ignore a delayed response if another external target was selected or hidden.
    if (
      externalTargetDisplayName !== targetName ||
      !externalTargetGroup.visible
    ) return;

    const points = data.samples.map(sample => {
      const x = Number(sample.x_km);
      const y = Number(sample.y_km);
      const z = Number(sample.z_km);
      const distance = Number(sample.distance_km);

      if (![x, y, z, distance].every(Number.isFinite) || distance <= 0) {
        throw new Error('Invalid coordinates in JPL trajectory');
      }

      // Match the external marker's schematic, compressed distance scale.
      const direction = new THREE.Vector3(x, z, -y);
      if (direction.lengthSq() === 0) {
        throw new Error('Invalid zero-length trajectory vector');
      }

      const radius = Math.max(
        9,
        Math.min(14, 8 + 2 * Math.log10(distance / 1000000))
      );

      return direction.normalize().multiplyScalar(radius);
    });

    // Schematic visibility enhancement; not a physical-scale orbit.
    const trailAnchor = points[0].clone();
    const trailVisualScale = 25;
    for (let j = 1; j < points.length; j++) {
      points[j].sub(trailAnchor).multiplyScalar(trailVisualScale).add(trailAnchor);
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xff63d8,
      transparent: true,
      opacity: 1.0,
      depthTest: false,
      depthWrite: false
    });

    const line = new THREE.Line(geometry, material);
    line.name = 'External JPL 24-hour schematic trajectory';
    line.visible = trailGroup.visible;
    line.renderOrder = 1000;
    line.frustumCulled = false;
    externalTargetGroup.add(line);

    log(
      'External JPL trajectory loaded: ' + targetName +
      ' | Samples: ' + data.samples.length
    );
  } catch (error) {
    log(
      'External JPL trajectory unavailable for ' + targetName +
      ': ' + String(error.message || error),
      'warn'
    );
  }
}

function pseudoPosition(obj,index){
 // Schematic deterministic placement. It is not a physical orbital solution.
 const seed=Number(obj.id)||index+7;const a=(seed*0.61803398875%1)*Math.PI*2;
 const r=5.1+((seed*0.137)%1)*12;
 const y=Math.sin(seed*.713)*r*.24;
 return new THREE.Vector3(Math.cos(a)*r,y,Math.sin(a)*r*.72);
}
function designationFor(obj) {
  const name = String(obj.name || '').trim();

  // Example: 2000 SZ162 or 679786 (2020 QG3)
  const provisional = name.match(/\b(?:19|20)\d{2}\s+[A-Za-z]{1,2}\d{0,4}\b/);
  if (provisional) return provisional[0];

  // For numbered asteroids, try their catalogue number.
  const numbered = name.match(/^\s*(\d+)\b/);
  if (numbered) return numbered[1];

  return name;
}

function createLabel(text) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = 512;
  canvas.height = 96;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = 'bold 30px Arial';
  context.fillStyle = '#9fe8ff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(text), canvas.width / 2, canvas.height / 2, 500);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.2, 0.6, 1);

  return sprite;
}


function positionFor(obj, index) {
  const result = state.positions[obj.id];

obj.userData = obj.userData || {};
obj.userData.positionSource = result
  ? 'JPL Horizons'
  : 'Schematic fallback';

if (!result) return pseudoPosition(obj, index);

  // Scale: 1 Three.js unit = 1,500,000 km.
  // Map the JPL vector into the scene's Y-up coordinate system.
  const scale = 1500000;

  return new THREE.Vector3(
  result.x_km / scale,
  result.z_km / scale,
  -result.y_km / scale
);
}




async function loadHorizonsPosition(obj) {
  if (state.positions[obj.id]) return;

  if (!state.positionRequests) {
    state.positionRequests = {};
  }

  if (state.positionRequests[obj.id]) {
    return state.positionRequests[obj.id];
  }

  const request = (async () => {
    const designation = designationFor(obj);
    state.positionLoadingId = obj.id;

    try {
      const url =
        '/api/horizons-position?designation=' +
        encodeURIComponent(designation);

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'JPL Horizons request failed');
      }

      state.positions[obj.id] = data;
      updateJplCoverage();

      if (state.selectedId === obj.id) {
        $('positionSourceStatus').textContent =
          'Position source: JPL Horizons \u00B7 Earth-centered vector \u00B7 ' +
          data.epoch;

        $('jplEarthDistance').textContent =
          'JPL Earth distance: ' +
          fmt(data.distance_km / 1000000, 3) + ' million km';
      }

      log(
        'JPL Horizons position loaded: ' +
        obj.name + ' \u00B7 ' + fmt(data.distance_km, 0) +
        ' km from Earth'
      );

      drawObjects();
    } catch (error) {
      log(
        'JPL position unavailable for ' + obj.name +
        ': ' + error.message,
        'warn'
      );
    } finally {
      delete state.positionRequests[obj.id];
      state.positionLoadingId = null;
    }
  })();

  state.positionRequests[obj.id] = request;
  return request;
}


  
async function loadAllHorizonsPositions() {
  log('Starting JPL Horizons position loading for unique catalogue objects');

  const uniqueObjects = uniqueAsteroids();
  updateJplCoverage();

  for (const obj of uniqueObjects) {
    if (state.positions[obj.id]) continue;

    await loadHorizonsPosition(obj);

    // Pause between requests to avoid overwhelming the API.
    await new Promise(resolve => setTimeout(resolve, 1200));
  }

  log(
    'JPL position loading finished: ' +
    Object.keys(state.positions).length +
    ' objects have calculated positions'
  );
}



 
function drawObjects(){
 clearGroup(objectsGroup);clearGroup(targetGroup);selectable=[];
  const uniqueObjects = uniqueAsteroids();

uniqueObjects.forEach((obj,i)=>{
  const p=positionFor(obj,i);const hazard=obj.potentially_hazardous;
  const radius=.13+Math.min(.18,Math.log10(1+Number(obj.diameter_max_m||10))*.035);
 const hasJplPosition = Boolean(state.positions[obj.id]);
const markerColor = hasJplPosition ? 0x57dce8 : 0xffb75e;
const markerEmissive = hasJplPosition ? 0x064454 : 0x6a2d06;

const mesh = new THREE.Mesh(
  new THREE.IcosahedronGeometry(radius, 2),
  new THREE.MeshStandardMaterial({
    color: markerColor,
    emissive: markerEmissive,
    emissiveIntensity: 0.65,
    roughness: 0.75,
    metalness: 0.18
  })
);
  mesh.position.copy(p);mesh.userData.objectId=obj.id;mesh.userData.index=i;objectsGroup.add(mesh);selectable.push(mesh);
  const glow=new THREE.Mesh(new THREE.SphereGeometry(radius*1.9,12,8),new THREE.MeshBasicMaterial({color:hazard?0xffa74c:0x36d9ed,transparent:true,opacity:.09}));glow.position.copy(p);objectsGroup.add(glow);
  if(state.labels){const label=createLabel(obj.name);label.position.copy(p).add(new THREE.Vector3(0,.65,0));objectsGroup.add(label)}
 });
 const selected=state.asteroids.find(o=>o.id===state.selectedId); if(selected) highlightSelected(selected);
}


async function loadHorizonsTrail(obj) {
  clearGroup(trailGroup);

  const designation = designationFor(obj);
  if (!designation) return;

  try {
    const response = await fetch(
      '/api/horizons-trail?designation=' + encodeURIComponent(designation)
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || 'JPL trail request failed');
    }

    // Ignore a late response if the user has selected another asteroid.
    if (state.selectedId !== obj.id) return;

    if (!Array.isArray(data.samples) || data.samples.length < 2) {
      throw new Error('Not enough position samples to draw a trail');
    }

    const scale = 1500000;
    const points = data.samples.map(sample =>
      new THREE.Vector3(
        Number(sample.x_km) / scale,
        Number(sample.z_km) / scale,
        -Number(sample.y_km) / scale
      )
    );

    if (points.some(p =>
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      !Number.isFinite(p.z)
    )) {
      throw new Error('JPL trail contains invalid coordinates');
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0x47f5c5,
      transparent: true,
      opacity: 0.95
    });

    const line = new THREE.Line(geometry, material);
    line.name = 'JPL 24-hour sampled position trail';
    trailGroup.add(line);

    log(
      'JPL sampled trail loaded: ' + obj.name +
      ' · ' + data.count + ' time samples'
    );
  } catch (error) {
    if (state.selectedId === obj.id) {
      log('JPL trail unavailable for ' + obj.name + ': ' + error.message, 'warn');
    }
  }
}

function highlightSelected(obj) {
  clearGroup(targetGroup);

  const uniqueObjects = uniqueAsteroids();
  const i = uniqueObjects.findIndex(o => o.id === obj.id);
  if (i < 0) return;

  const p = positionFor(uniqueObjects[i], i);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.035, 8, 64),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1
    })
  );
  ring.position.copy(p);
  ring.rotation.x = Math.PI / 2.4;
  targetGroup.add(ring);

  const ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(0.78, 0.018, 8, 64),
    new THREE.MeshBasicMaterial({
      color: 0x42cde4,
      transparent: true,
      opacity: 0.85
    })
  );
  ring2.position.copy(p);
  ring2.rotation.x = Math.PI / 2.4;
  targetGroup.add(ring2);

  const linePts = [
    p.clone(),
    p.clone().add(new THREE.Vector3(0, 1.2, 0))
  ];
  targetGroup.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(linePts),
      new THREE.LineBasicMaterial({ color: 0x65f2f6 })
    )
  );
}


function animate(){requestAnimationFrame(animate);earth.rotation.y+=.0012;cloud.rotation.y-=.0004;grid.rotation.y+=.0003;targetGroup.rotation.y+=.003;controls.update();renderer.render(scene,camera)}
animate();
new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h)}).observe(host);
$('sceneLoading').style.display='none';
$('resetView').onclick=()=>{camera.position.set(0,12,28);controls.target.set(0,0,0);controls.update()};
$('toggleLabels').onclick=()=>{state.labels=!state.labels;drawObjects();log('Object labels '+(state.labels?'enabled':'hidden'))};
$('trailToggle').onclick = () => {
  trailGroup.visible = !trailGroup.visible;

  const externalTrail = externalTargetGroup.children.find(
    child => child.name === 'External JPL 24-hour schematic trajectory'
  );

  if (externalTrail) {
    externalTrail.visible = trailGroup.visible;
  }

  $('trailToggle').textContent = trailGroup.visible ? 'TRAIL ON' : 'TRAIL OFF';

  log(
    'NASA trail ' + (trailGroup.visible ? 'shown' : 'hidden') +
    (externalTrail ? ' | External JPL trail ' +
      (externalTrail.visible ? 'shown' : 'hidden') : ' | No external JPL trail loaded')
  );
};
renderer.domElement.addEventListener('click', e => {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  // Test the external JPL marker first; do not change NASA selection.
  if (externalTargetGroup.visible && externalTargetMarker) {
    const externalHits = raycaster.intersectObject(externalTargetMarker, false);
    if (externalHits.length) {
      if (externalTargetInfoNameElement) {
        externalTargetInfoNameElement.textContent =
          'Target: ' + externalTargetDisplayName;
      }
      if (externalTargetMarkerStatusElement) {
        externalTargetMarkerStatusElement.textContent =
          '3D marker: CLICKED IN 3D - external JPL target; NASA selection unchanged';
      }
      log('External JPL marker clicked: ' + externalTargetDisplayName);
      return;
    }
  }

  const hits = raycaster.intersectObjects(selectable, false);
  if (hits.length) {
    const o = state.asteroids.find(a => a.id === hits[0].object.userData.objectId);
    if (o) selectObject(o.id);
  }
});
renderer.domElement.style.cursor='grab';


 
let onlineSearchTimer = null;
let onlineSearchSequence = 0;

function renderList(){
 const q = $('searchInput').value.toLowerCase();

 // Group records by canonical JPL ID when one is available.
 // Records without a canonical ID remain separate.
 const groups = new Map();

 for (const obj of state.asteroids) {
   const key = obj.canonical_jpl_id
     ? 'jpl:' + obj.canonical_jpl_id
     : 'nasa:' + obj.id;

   if (!groups.has(key)) groups.set(key, []);
   groups.get(key).push(obj);
 }

 
  const items = uniqueAsteroids()
    .filter(o => (o.name + ' ' + o.id).toLowerCase().includes(q));


 $('targetCount').textContent = String(uniqueAsteroids().length).padStart(2, '0');

 const list = $('targetList');
 list.replaceChildren();

 if (!items.length) {
   list.innerHTML = '<div class="empty-state">No matching objects in the current NASA feed. External JPL results appear separately below.</div>';
   return;
 }

 items.forEach(o => {
   const b = document.createElement('button');
   b.className = 'target-item' + (o.id === state.selectedId ? ' selected' : '');
   b.onclick = () => selectObject(o.id);

   const title = document.createElement('strong');
   title.textContent = o.name;

   const details = document.createElement('span');
   details.textContent =
     'ID ' + o.id + ' \u00B7 ' + (o.close_approach_date || 'Date unavailable');

   const distance = document.createElement('span');
   const km = Number(o.miss_distance_km);
   distance.textContent = Number.isFinite(km)
     ? (km / 1_000_000).toFixed(2) + 'M KM MISS DIST.'
     : 'MISS DIST. \u2014';

   b.append(title, details, distance);
   list.appendChild(b);
 });
}



async function searchJplAsteroid() {
  const box = $('onlineSearchResults');
  const input = $('searchInput');
  const button = $('jplSearchBtn');
  const query = input.value.trim();
  const sequence = ++onlineSearchSequence;

  box.replaceChildren();

  if (query.length > 100 || /[\r\n]/.test(query)) {
    box.textContent = query.length > 100
      ? 'Search is too long. Enter an asteroid name or ID (maximum 100 characters).'
      : 'Enter one asteroid name or ID on a single line.';
    button.disabled = false;
    button.textContent = 'SEARCH JPL';
    return;
  }

  button.disabled = true;
  button.textContent = 'SEARCHING...';

  try {
    if (query.length < 2) return;

    const localMatch = uniqueAsteroids().some(o =>
      (String(o.name) + ' ' + String(o.id)).toLowerCase().includes(query.toLowerCase())
    );
    if (localMatch) return;

    box.textContent = 'Searching JPL Small-Body Database...';

    const response = await fetch('/api/search-asteroid?q=' + encodeURIComponent(query));
    const data = await response.json();

    if (sequence !== onlineSearchSequence) return;
    box.replaceChildren();

    if (!response.ok) {
      throw new Error(data.detail || 'JPL search failed.');
    }

    if (!data.found) {
      box.textContent = 'No matching object found in JPL SBDB.';
      return;
    }

    const card = document.createElement('div');
    card.style.cssText = 'padding:10px;border:1px solid #31505b;border-radius:6px;line-height:1.7;overflow-wrap:anywhere;background:rgba(20,45,55,.28)';

    const badge = document.createElement('div');
    badge.textContent = 'ONLINE JPL LOOKUP - NOT LOADED IN 3D';
    badge.style.cssText = 'font-size:10px;letter-spacing:.08em;color:#76d8cb;margin-bottom:6px;font-weight:700';
    card.appendChild(badge);

    const heading = document.createElement('strong');
    heading.textContent = data.name || 'JPL object';
    card.appendChild(heading);

    const details = document.createElement('div');
    const facts = [];
    if (data.designation) facts.push('Designation: ' + data.designation);
    if (data.spkid) facts.push('JPL SPK ID: ' + data.spkid);
    if (data.orbit_class) facts.push('Object class: ' + data.orbit_class);
    if (data.moid_au != null) facts.push('MOID: ' + data.moid_au + ' AU');
    if (data.absolute_magnitude?.value != null) {
      facts.push('Absolute magnitude H: ' + data.absolute_magnitude.value);
    }
    if (data.diameter?.value != null) {
      facts.push('Diameter: ' + data.diameter.value + ' ' + (data.diameter.units || ''));
    }
    details.textContent = facts.length ? facts.join(' | ') : 'Additional physical/orbital details may be available in the JPL record.';
    card.appendChild(details);

    const status = document.createElement('div');
    const flagLabel = value =>
      value === true ? 'Yes' :
      value === false ? 'No' :
      'not provided';

    status.textContent =
      'JPL NEO flag: ' + flagLabel(data.neo) +
      ' | Potentially hazardous flag: ' + flagLabel(data.pha);
    card.appendChild(status);

    const positionButton = document.createElement('button');
    positionButton.type = 'button';
    positionButton.textContent = 'GET POSITION';
    positionButton.style.cssText = 'display:inline-block;margin-top:10px;margin-right:8px;padding:7px 10px;background:#10323d;color:#a4f6fa;border:1px solid #2e9dac;border-radius:4px;font:10px var(--mono);cursor:pointer';

    const positionResult = document.createElement('div');
    positionResult.setAttribute('aria-live', 'polite');
    positionResult.style.cssText = 'margin-top:8px;overflow-wrap:anywhere;line-height:1.7';

    positionButton.addEventListener('click', async () => {
      const horizonsDesignation = data.designation || query;

      positionButton.disabled = true;
      positionButton.textContent = 'LOADING POSITION...';
      positionResult.textContent = 'Requesting an Earth-centered vector from JPL Horizons...';

      try {
        const response = await fetch(
          '/api/horizons-position?designation=' +
          encodeURIComponent(horizonsDesignation)
        );
        const position = await response.json();

        if (!response.ok) {
          throw new Error(position.detail || 'JPL Horizons position request failed.');
        }

        if (
          !Number.isFinite(position.x_km) ||
          !Number.isFinite(position.y_km) ||
          !Number.isFinite(position.z_km) ||
          !Number.isFinite(position.distance_km)
        ) {
          throw new Error('JPL Horizons returned incomplete position data.');
        }

        const fmt = value =>
          Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });

        const facts = [
          'Epoch: ' + (position.epoch || 'not provided'),
          'Center: ' + (position.center || 'not provided'),
          'Reference frame: ' + (position.frame || 'not provided'),
          'X coordinate: ' + fmt(position.x_km) + ' km',
          'Y coordinate: ' + fmt(position.y_km) + ' km',
          'Z coordinate: ' + fmt(position.z_km) + ' km',
          'Earth distance: ' + fmt(position.distance_km) + ' km (' +
            fmt(position.distance_km / 1000000) + ' million km)'
        ];

        positionResult.replaceChildren();
        const resultTitle = document.createElement('strong');
        resultTitle.textContent = 'JPL HORIZONS POSITION';
        positionResult.appendChild(resultTitle);

        const resultDetails = document.createElement('div');
        resultDetails.style.cssText =
          'display:grid;grid-template-columns:minmax(0,1fr);gap:3px;margin-top:5px';
        for (const fact of facts) {
          const line = document.createElement('div');
          line.textContent = fact;
          resultDetails.appendChild(line);
        }
        positionResult.appendChild(resultDetails);

        const disclaimer = document.createElement('div');
        disclaimer.textContent = 'Position lookup only. The 3D scene and selected NASA target have not changed.';
        disclaimer.style.cssText = 'margin-top:5px;color:#a8bbc2;font-size:11px';
        positionResult.appendChild(disclaimer);

        // Separate details panel for the external JPL target.
        const externalInfoPanel = document.createElement('div');
        externalInfoPanel.style.cssText =
          'margin-top:10px;padding:10px;border:1px solid #63375d;border-left:3px solid #ff63d8;border-radius:4px;background:rgba(50,27,53,.28)';

        const externalInfoTitle = document.createElement('div');
        externalInfoTitle.textContent = 'EXTERNAL JPL TARGET';
        externalInfoTitle.style.cssText =
          'font:10px var(--mono);letter-spacing:1px;color:#ffc4f0;margin-bottom:7px';
        externalInfoPanel.appendChild(externalInfoTitle);

        const externalInfoName = document.createElement('div');
        externalTargetDisplayName = String(data.name || query);
        externalTargetInfoNameElement = externalInfoName;
        externalInfoName.textContent = 'Target: ' + externalTargetDisplayName;
        externalInfoName.style.cssText = 'overflow-wrap:anywhere;font-weight:600';
        externalInfoPanel.appendChild(externalInfoName);

        const externalInfoEpoch = document.createElement('div');
        externalInfoEpoch.textContent = 'Position epoch: ' + String(position.epoch || 'not provided');
        externalInfoEpoch.style.cssText = 'margin-top:4px;overflow-wrap:anywhere';
        externalInfoPanel.appendChild(externalInfoEpoch);

        const externalInfoDistance = document.createElement('div');
        externalInfoDistance.textContent =
          'Earth distance: ' + fmt(position.distance_km / 1000000) + ' million km';
        externalInfoDistance.style.cssText = 'margin-top:4px';
        externalInfoPanel.appendChild(externalInfoDistance);

        const externalMarkerStatus = document.createElement('div');
        externalTargetMarkerStatusElement = externalMarkerStatus;
        externalMarkerStatus.textContent =
          '3D marker: Hidden · plotted distance will be compressed';
        externalMarkerStatus.style.cssText =
          'margin-top:6px;color:#ffc4f0;font-size:11px;overflow-wrap:anywhere';
        externalInfoPanel.appendChild(externalMarkerStatus);

        positionResult.appendChild(externalInfoPanel);

        const markerButton = document.createElement('button');
        markerButton.type = 'button';
        markerButton.textContent = 'SHOW IN 3D';
        markerButton.style.cssText =
          'margin-top:8px;padding:7px 10px;background:#321b35;color:#ffc4f0;border:1px solid #a64b91;border-radius:4px;font:10px var(--mono);cursor:pointer';

        markerButton.addEventListener('click', () => {
          if (externalTargetGroup.visible) {
            externalTargetGroup.visible = false;
            markerButton.textContent = 'SHOW IN 3D';
            externalMarkerStatus.textContent =
              '3D marker: Hidden · plotted distance will be compressed';
            return;
          }

          try {
            showExternalTarget(position, data.name || query);
            loadExternalHorizonsTrail(horizonsDesignation, data.name || query);
            markerButton.textContent = 'HIDE FROM 3D';
            externalMarkerStatus.textContent =
              '3D marker: Visible · plotted distance compressed (schematic only)';
          } catch (error) {
            positionResult.appendChild(document.createTextNode(
              ' Marker unavailable: ' + String(error.message || error)
            ));
          }
        });

        positionResult.appendChild(markerButton);
      } catch (error) {
        positionResult.textContent =
          'Position lookup unavailable: ' + String(error.message || error);
      } finally {
        positionButton.disabled = false;
        positionButton.textContent = 'GET POSITION';
      }
    });

    card.appendChild(positionButton);
    card.appendChild(positionResult);

    const note = document.createElement('div');
    note.textContent = 'This is an external database result. It does not change the selected NASA target or the current 3D scene.';
    note.style.cssText = 'margin-top:6px;color:#a8bbc2;font-size:11px';
    card.appendChild(note);

    const link = document.createElement('a');
    link.href = 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=' + encodeURIComponent(query);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open object in JPL SBDB';
    link.style.cssText = 'display:inline-block;margin-top:5px';
    card.appendChild(link);

    box.appendChild(card);
  } catch (error) {
    if (sequence !== onlineSearchSequence) return;
    box.textContent = 'Online JPL search unavailable: ' + String(error.message || error);
  } finally {
    if (sequence === onlineSearchSequence) {
      button.disabled = false;
      button.textContent = 'SEARCH JPL';
    }
  }
}

function selectObject(id){
 state.selectedId=id;const o=state.asteroids.find(x=>x.id===id);if(!o)return;
 $('selectedName').textContent=o.name;
 $('selectedId').textContent='NASA NEO ID '+o.id+' \u00B7 '+(o.data_source||'NASA NeoWs');
const positionData = state.positions[o.id];

$('positionSourceStatus').textContent = positionData
  ? 'Position source: JPL Horizons \u00B7 Earth-centered vector \u00B7 ' + positionData.epoch
  : 'Position source: Schematic fallback \u00B7 JPL position not loaded';
$('jplEarthDistance').textContent = positionData
  ? 'JPL Earth distance: ' +
    fmt(positionData.distance_km / 1000000, 3) + ' million km'
  : 'JPL Earth distance: waiting for position...';

 $('selectedFlag').textContent=o.potentially_hazardous?'POTENTIALLY HAZARDOUS':'NO HAZARD FLAG';
 $('selectedFlag').className='flag '+(o.potentially_hazardous?'warn':'neutral');
 $('missDistance').textContent=shortDist(o.miss_distance_km);$('velocity').textContent=o.relative_velocity_km_s?Number(o.relative_velocity_km_s).toFixed(2):'\u2014';
 $('diameter').textContent=o.diameter_min_m&&o.diameter_max_m?fmt(o.diameter_min_m,1)+'\u2013'+fmt(o.diameter_max_m,1):'\u2014';
 $('approachDate').textContent='APPROACH DATE: '+(o.close_approach_date_full||o.close_approach_date||'\u2014').toUpperCase();
 $('jplLink').href=o.nasa_jpl_url||'https://cneos.jpl.nasa.gov/';
 renderList();
highlightSelected(o);
loadHorizonsTrail(o);
log('Target selected: ' + o.name);
loadHorizonsPosition(o);
}


 
async function loadAsteroids() {
  $('systemStatus').textContent = 'FETCHING ORBITAL DATA';
  $('dataLink').textContent = 'SYNC';
  $('nasaSourceState').textContent = 'QUERYING';
  $('refreshBtn').disabled = true;

  try {
    const r = await fetch('/api/asteroids?days=3');
    const data = await r.json();

    if (!r.ok) {
      throw new Error(data.detail || 'API request failed');
    }

    state.asteroids = data.asteroids || [];
    state.positions = {};
    updateJplCoverage();
    $('objectCount').textContent = state.asteroids.length;
    $('hazardCount').textContent =
      state.asteroids.filter(x => x.potentially_hazardous).length;

    $('dataLink').textContent = 'ONLINE';
    $('dataLink').style.color = 'var(--green)';
    $('dataUpdated').textContent =
      'updated ' + new Date().toLocaleTimeString();

    $('nasaSourceState').textContent = 'CONNECTED';
    $('systemStatus').textContent = 'SYSTEM NOMINAL';
    $('telemetrySource').textContent = 'NASA NeoWs live';

    renderList();
    drawObjects();

    if (state.asteroids.length) {
      const selectedId =
        state.selectedId &&
        state.asteroids.some(x => x.id === state.selectedId)
          ? state.selectedId
          : state.asteroids[0].id;

      selectObject(selectedId);
      loadAllHorizonsPositions();
    }

    log('NASA NeoWs feed received \u00B7 ' +
        state.asteroids.length + ' objects');

  } catch (e) {
    $('dataLink').textContent = 'OFFLINE';
    $('dataLink').style.color = 'var(--amber)';
    $('nasaSourceState').textContent = 'UNAVAILABLE';
    $('systemStatus').textContent = 'DATA LINK DEGRADED';

    const errorBanner = document.createElement('div');
    errorBanner.className = 'error-banner';
    errorBanner.textContent =
      'Live NASA feed unavailable. ' +
      String(e.message).slice(0, 160) +
      ' Check network/API key and retry.';

    $('targetList').replaceChildren(errorBanner);

    $('telemetrySource').textContent = 'API unavailable';
    log('NASA feed unavailable: ' + e.message, 'warn');

  } finally {
    $('refreshBtn').disabled = false;
  }
}

$('refreshBtn').onclick=loadAsteroids;
$('searchInput').addEventListener('input', () => {
  renderList();
  clearTimeout(onlineSearchTimer);
  onlineSearchTimer = setTimeout(searchJplAsteroid, 500);
});

$('jplSearchBtn').addEventListener('click', () => {
  clearTimeout(onlineSearchTimer);
  searchJplAsteroid();
});

$('searchInput').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    clearTimeout(onlineSearchTimer);
    searchJplAsteroid();
  }
});

$('clearSearchBtn').addEventListener('click', () => {
  clearTimeout(onlineSearchTimer);
  onlineSearchSequence++;
  $('searchInput').value = '';
  $('onlineSearchResults').replaceChildren();
  $('jplSearchBtn').disabled = false;
  $('jplSearchBtn').textContent = 'SEARCH JPL';
  renderList();
  $('searchInput').focus();
});
$('jplBtn').onclick=async()=>{
 $('jplBtn').textContent='WAIT\u2026';
 try{const r=await fetch('/api/cad?limit=20');const data=await r.json();if(!r.ok)throw new Error(data.detail||'JPL query failed');state.jpl=data;const n=(data.data||[]).length;log('JPL CAD returned '+n+' close-approach records');$('jplBtn').textContent='OK';}
 catch(e){log('JPL CAD unavailable: '+e.message,'warn');$('jplBtn').textContent='RETRY'}
};

// Browser-local camera: video is not uploaded to the Python backend.
async function listCameras(){
 try{
  const devices=await navigator.mediaDevices.enumerateDevices();const cams=devices.filter(d=>d.kind==='videoinput');const sel=$('cameraSelect');const old=sel.value;
  sel.replaceChildren();const first=document.createElement('option');first.value='';first.textContent=cams.length?'Select camera\u2026':'No camera detected';sel.append(first);
  cams.forEach((d,i)=>{const op=document.createElement('option');op.value=d.deviceId;op.textContent=d.label||'Camera '+(i+1);sel.append(op)});
  if(old&&cams.some(c=>c.deviceId===old))sel.value=old;
 }catch(e){log('Could not enumerate cameras: '+e.message,'warn')}
}
async function connectCamera(){
 if(!navigator.mediaDevices?.getUserMedia){log('Camera API unavailable; open on localhost or HTTPS','warn');return}
 try{
  if(state.stream)state.stream.getTracks().forEach(t=>t.stop());
  const deviceId=$('cameraSelect').value;
  const constraints={video:deviceId?{deviceId:{exact:deviceId},width:{ideal:1920},height:{ideal:1080}}:{width:{ideal:1920},height:{ideal:1080}},audio:false};
  state.stream=await navigator.mediaDevices.getUserMedia(constraints);$('cameraVideo').srcObject=state.stream;
  $('cameraVideo').classList.add('active');$('cameraPlaceholder').style.display='none';$('captureBtn').disabled=false;$('disconnectCamera').disabled=false;
  $('cameraBadge').textContent='SIGNAL LOCKED';$('cameraBadge').style.color='var(--green)';$('cameraState').textContent='ONLINE';$('cameraState').style.color='var(--green)';
  $('telemetryCamera').textContent='Live browser stream';$('telemetryCapture').textContent='Ready';$('connectCamera').textContent='RECONNECT CAMERA';
  await listCameras();log('Camera connected locally; frames remain in browser'); 
 }catch(e){log('Camera connection failed: '+e.message,'warn');$('cameraBadge').textContent='NO SIGNAL';$('cameraState').textContent='OFFLINE'}
}
function disconnectCamera(){
 if(state.stream)state.stream.getTracks().forEach(t=>t.stop());state.stream=null;
 $('cameraVideo').srcObject=null;$('cameraVideo').classList.remove('active');$('cameraPlaceholder').style.display='flex';
 $('captureBtn').disabled=true;$('disconnectCamera').disabled=true;$('cameraBadge').textContent='NO SIGNAL';$('cameraBadge').style.color='';
 $('cameraState').textContent='OFFLINE';$('cameraState').style.color='';$('telemetryCamera').textContent='Not connected';$('telemetryCapture').textContent='Standby';log('Camera disconnected');
}
$('connectCamera').onclick=connectCamera;$('disconnectCamera').onclick=disconnectCamera;


const CAPTURE_DB_NAME='astraEyeCaptureArchive';
const CAPTURE_STORE='captures';

function openCaptureDB(){
 return new Promise((resolve,reject)=>{
   if(!window.indexedDB){
     reject(new Error('IndexedDB is not available in this browser'));
     return;
   }
   const request=indexedDB.open(CAPTURE_DB_NAME,1);
   request.onupgradeneeded=()=>{
     const db=request.result;
     if(!db.objectStoreNames.contains(CAPTURE_STORE)){
       db.createObjectStore(CAPTURE_STORE,{keyPath:'id'});
     }
   };
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error||new Error('Database open failed'));
 });
}

async function captureDBRequest(mode,operation){
 const db=await openCaptureDB();
 return new Promise((resolve,reject)=>{
   let result;
   const tx=db.transaction(CAPTURE_STORE,mode);
   const store=tx.objectStore(CAPTURE_STORE);
   try{
     const request=operation(store);
     request.onsuccess=()=>{result=request.result};
     request.onerror=()=>reject(request.error||new Error('Database request failed'));
   }catch(error){
     db.close();
     reject(error);
     return;
   }
   tx.oncomplete=()=>{db.close();resolve(result)};
   tx.onerror=()=>{db.close();reject(tx.error||new Error('Database transaction failed'))};
   tx.onabort=()=>{db.close();reject(tx.error||new Error('Database transaction aborted'))};
 });
}

function saveCapture(record){
 return captureDBRequest('readwrite',store=>store.put(record));
}
function readCaptures(){
 return captureDBRequest('readonly',store=>store.getAll());
}
function removeSavedCapture(id){
 return captureDBRequest('readwrite',store=>store.delete(id));
}
function removeAllSavedCaptures(){
 return captureDBRequest('readwrite',store=>store.clear());
}

function downloadCapture(data,filename){
 const a=document.createElement('a');
 a.href=data;
 a.download=filename;
 document.body.appendChild(a);
 a.click();
 a.remove();
}

function updateCaptureCount(){
 $('captureCount').textContent=String(state.captures).padStart(2,'0');
}

function showCaptureEmptyState(){
 const archive=$('captureArchive');
 if(!archive.querySelector('.capture-card')){
   const empty=document.createElement('div');
   empty.className='archive-empty';
   empty.textContent='No local captures yet. Connect a camera to begin.';
   archive.appendChild(empty);
 }
}

function renderCaptureCard(record){
 const archive=$('captureArchive');
 const empty=archive.querySelector('.archive-empty');
 if(empty)empty.remove();

 const card=document.createElement('div');
 card.className='capture-card';
 card.dataset.captureId=record.id;

 const img=document.createElement('img');
 img.className='capture-thumb';
 img.src=record.jpeg;
 img.alt='Captured camera frame. Click to preview.';
 img.title='Click to open full preview';
 img.tabIndex=0;
 img.setAttribute('role','button');

 const preview=()=>{
   const w=window.open();
   if(!w){
     log('Preview blocked by browser. Use Download instead.','warn');
     return;
   }
   w.document.title='ASTRA EYE 3D — Capture Preview';
   w.document.body.style.cssText='margin:0;background:#070b12;display:grid;place-items:center;min-height:100vh';
   const full=w.document.createElement('img');
   full.src=record.jpeg;
   full.alt='Local camera capture';
   full.style.cssText='max-width:96vw;max-height:94vh;object-fit:contain';
   w.document.body.appendChild(full);
 };
 img.addEventListener('click',preview);
 img.addEventListener('keydown',e=>{
   if(e.key==='Enter'||e.key===' '){
     e.preventDefault();
     preview();
   }
 });

 const time=document.createElement('small');
 time.className='capture-time';
 time.textContent=new Date(record.createdAt).toLocaleString();

 const actions=document.createElement('div');
 actions.className='capture-actions';

 const downloadBtn=document.createElement('button');
 downloadBtn.type='button';
 downloadBtn.className='capture-action';
 downloadBtn.textContent='DOWNLOAD';
 downloadBtn.addEventListener('click',()=>downloadCapture(record.png,record.filename));

 const deleteBtn=document.createElement('button');
 deleteBtn.type='button';
 deleteBtn.className='capture-action capture-delete';
 deleteBtn.textContent='DELETE';
 deleteBtn.addEventListener('click',async()=>{
   deleteBtn.disabled=true;
   try{
     await removeSavedCapture(record.id);
     card.remove();
     state.captures=Math.max(0,state.captures-1);
     updateCaptureCount();
     showCaptureEmptyState();
     log('Capture deleted from browser archive');
   }catch(error){
     deleteBtn.disabled=false;
     log('Could not delete saved capture: '+error.message,'warn');
   }
 });

 actions.append(downloadBtn,deleteBtn);
 card.append(img,time,actions);
 archive.prepend(card);
}

async function restoreCaptureArchive(){
 try{
   const records=await readCaptures();
   records.sort((a,b)=>b.createdAt-a.createdAt);
   $('captureArchive').replaceChildren();
   records.forEach(renderCaptureCard);
   state.captures=records.length;
   updateCaptureCount();
   showCaptureEmptyState();
   log('Capture archive restored: '+records.length+' saved frame(s)');
 }catch(error){
   log('Persistent archive unavailable: '+error.message,'warn');
   showCaptureEmptyState();
 }
}

$('clearCaptureArchive').onclick=async()=>{
 if(!state.captures)return;
 if(!window.confirm('Delete all saved captures from the browser archive? Downloaded PNG files on your computer will not be deleted.'))return;
 const button=$('clearCaptureArchive');
 button.disabled=true;
 try{
   await removeAllSavedCaptures();
   $('captureArchive').replaceChildren();
   state.captures=0;
   updateCaptureCount();
   showCaptureEmptyState();
   log('All saved browser captures deleted');
 }catch(error){
   log('Could not clear archive: '+error.message,'warn');
 }finally{
   button.disabled=false;
 }
};

$('captureBtn').onclick=async()=>{
 const v=$('cameraVideo');
 if(!state.stream||!v.videoWidth){
   log('Camera has no frame available yet','warn');
   return;
 }

 const canvas=document.createElement('canvas');
 canvas.width=v.videoWidth;
 canvas.height=v.videoHeight;
 canvas.getContext('2d').drawImage(v,0,0);

 const now=new Date();
 const stamp=now.toISOString().replace(/[:.]/g,'-');
 const record={
   id:stamp+'-'+Math.random().toString(36).slice(2,10),
   createdAt:now.getTime(),
   filename:'astra-eye-capture-'+stamp+'.png',
   png:canvas.toDataURL('image/png'),
   jpeg:canvas.toDataURL('image/jpeg',0.82)
 };

 downloadCapture(record.png,record.filename);
 $('telemetryCapture').textContent='Saving local archive…';

 try{
   await saveCapture(record);
   await restoreCaptureArchive();
   $('telemetryCapture').textContent='Frame saved locally';
   log('Capture saved to browser archive and downloaded as PNG');
 }catch(error){
   renderCaptureCard(record);
   state.captures++;
   updateCaptureCount();
   $('telemetryCapture').textContent='Downloaded; archive save failed';
   log('Capture downloaded, but persistent save failed: '+error.message,'warn');
 }
};

restoreCaptureArchive();
navigator.mediaDevices?.addEventListener?.('devicechange',listCameras);
listCameras();loadAsteroids();


async function loadDetectionStatus() {
  const statusEl = $('esaDetectionStatus');
  const detailsEl = $('esaDetectionDetails');
  if (!statusEl || !detailsEl) return;

  try {
    const response = await fetch('/api/detection-status');
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Detection status request failed');

    if (data.status !== 'PROCESSED_UNVALIDATED') {
      statusEl.textContent = 'REPORT UNAVAILABLE';
      detailsEl.textContent = data.message || 'The ESA experiment report is unavailable.';
      return;
    }

    const counts = Array.isArray(data.source_counts_after_filter)
      ? data.source_counts_after_filter.join(' / ')
      : 'Unavailable';

    statusEl.textContent = 'PROCESSED · NOT VALIDATED';
    detailsEl.textContent =
      `${data.image_count} ESA FITS frames · filtered source counts ${counts} · ` +
      `${data.candidate_track_count} exploratory track(s). ` +
      'No asteroid detection is confirmed. ' + (data.warning || '');
  } catch (error) {
    statusEl.textContent = 'STATUS UNAVAILABLE';
    detailsEl.textContent = 'Could not load ESA report: ' + error.message;
  }
}

loadDetectionStatus();


// Experimental three-frame image upload and tracking interface.
async function analyzeThreeFrames() {
  const button = $('analyzeFramesBtn');
  const status = $('detectorStatus');
  const results = $('detectorResults');
  const badge = $('detectorBadge');
  const engine = $('detectorEngineStatus');
  if (!button || !status || !results || !badge) return;

  const selected = [
    $('detectorFrame1')?.files?.[0],
    $('detectorFrame2')?.files?.[0],
    $('detectorFrame3')?.files?.[0]
  ];

  if (selected.some(file => !file)) {
    status.textContent = 'Select one image for each of the three frames.';
    badge.textContent = 'NEEDS FILES';
    return;
  }

  const allowed = /\.(png|jpe?g|tiff?)$/i;
  for (let i = 0; i < selected.length; i++) {
    if (!allowed.test(selected[i].name)) {
      status.textContent = `Frame ${i + 1}: choose PNG, JPG, JPEG, TIF or TIFF.`;
      badge.textContent = 'INVALID FILE';
      return;
    }
    if (selected[i].size > 15 * 1024 * 1024) {
      status.textContent = `Frame ${i + 1} exceeds the 15 MiB limit.`;
      badge.textContent = 'FILE TOO LARGE';
      return;
    }
  }

  const form = new FormData();
  selected.forEach(file => form.append('frames', file, file.name));

  button.disabled = true;
  button.textContent = 'PROCESSING FRAMES?';
  status.textContent = 'Uploading selected frames to the local analysis API?';
  results.replaceChildren();
  badge.textContent = 'PROCESSING';
  if (engine) engine.textContent = 'Experimental API';

  try {
    const response = await fetch('/api/detection/analyze-three-frames', {
      method: 'POST',
      body: form
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Server returned HTTP ${response.status} without valid JSON.`);
    }

    if (!response.ok) {
      throw new Error(data.detail || `Analysis request failed: HTTP ${response.status}`);
    }

    status.textContent = `Analysis completed: ${data.status || 'UNKNOWN STATUS'}`;
    badge.textContent = data.validated_detection === false
      ? 'NOT VALIDATED'
      : 'CHECK RESULT';

    const heading = document.createElement('div');
    heading.className = 'detector-result-title';
    heading.textContent = 'PROCESSING SUMMARY';
    results.appendChild(heading);

    const addLine = (label, value) => {
      const line = document.createElement('div');
      line.className = 'detector-result-line';
      line.textContent = `${label}: ${value}`;
      results.appendChild(line);
    };

    addLine('Images', String(data.input_files?.length ?? selected.length));
    addLine('Image dimensions', `${data.image_width_px ?? '?'} ? ${data.image_height_px ?? '?'} px`);
    addLine('Persistent tracks', String(data.persistent_track_count ?? 0));
    addLine('Validation', data.validated_detection === false
      ? 'Unconfirmed candidates only'
      : 'Check server result');

    if (Array.isArray(data.alignment)) {
      const alignmentHeading = document.createElement('div');
      alignmentHeading.className = 'detector-result-title';
      alignmentHeading.style.marginTop = '13px';
      alignmentHeading.textContent = 'FRAME ALIGNMENT';
      results.appendChild(alignmentHeading);

      data.alignment.forEach(item => {
        addLine(
          `Frame ${item.frame ?? '?'}`,
          `${item.status || 'Alignment'} ? dx ${Number(item.dx_px ?? 0).toFixed(3)} px ? ` +
          `dy ${Number(item.dy_px ?? 0).toFixed(3)} px`
        );
      });
    }

    if (Array.isArray(data.tracks) && data.tracks.length) {
      const trackHeading = document.createElement('div');
      trackHeading.className = 'detector-result-title';
      trackHeading.style.marginTop = '13px';
      trackHeading.textContent = 'CANDIDATE TRACKS';
      results.appendChild(trackHeading);

      data.tracks.forEach((track, index) => {
        const card = document.createElement('div');
        card.className = 'detector-track';

        const title = document.createElement('strong');
        title.textContent = `TRACK ${index + 1} ? UNCONFIRMED`;
        card.appendChild(title);

        const positions = Array.isArray(track.frame_positions_px)
          ? track.frame_positions_px
          : [];

        const detail = document.createElement('div');
        detail.className = 'detector-muted';
        detail.textContent = positions.map((point, i) =>
          `F${i + 1} (${Number(point.x).toFixed(2)}, ${Number(point.y).toFixed(2)})`
        ).join(' ? ') || 'No pixel positions returned.';
        card.appendChild(detail);

        const steps = document.createElement('div');
        steps.className = 'detector-muted';
        steps.textContent =
          `Step movement: ${Number(track.step_1_displacement_px ?? 0).toFixed(2)} px / ` +
          `${Number(track.step_2_displacement_px ?? 0).toFixed(2)} px`;
        card.appendChild(steps);
        results.appendChild(card);
      });
    } else {
      const empty = document.createElement('div');
      empty.className = 'detector-muted';
      empty.textContent = 'No persistent three-frame tracks were returned for these images.';
      results.appendChild(empty);
    }

    const warning = document.createElement('p');
    warning.className = 'detector-warning';
    warning.textContent = data.warning ||
      'Tracks are experimental candidates only, not confirmed asteroid detections.';
    results.appendChild(warning);

    if (typeof log === 'function') {
      log(`Three-frame experiment processed ? ${data.persistent_track_count ?? 0} persistent candidate track(s)`);
    }
  } catch (error) {
    status.textContent = `Analysis failed: ${error.message}`;
    badge.textContent = 'ERROR';
    const message = document.createElement('div');
    message.className = 'detector-muted';
    message.textContent = 'Check that the local server is running and inspect Terminal 1 for server errors.';
    results.replaceChildren(message);
    if (typeof log === 'function') log(`Three-frame analysis failed: ${error.message}`, 'warn');
  } finally {
    button.disabled = false;
    button.textContent = 'ANALYZE THREE FRAMES';
  }
}

$('analyzeFramesBtn')?.addEventListener('click', analyzeThreeFrames);


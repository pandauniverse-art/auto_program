const $ = (id) => document.getElementById(id);

const dropZone = $("dropZone");
const fileInput = $("fileInput");
const folderInput = $("folderInput");
const bgSelect = $("bgSelect");
const contentSelect = $("contentSelect");
const scanAreaButton = $("scanAreaButton");
const scanButton = $("scanButton");
const nextCandidateButton = $("nextCandidateButton");
const clearScanAreasButton = $("clearScanAreasButton");
const addPointButton = $("addPointButton");
const deletePointButton = $("deletePointButton");
const resetButton = $("resetButton");
const guideToggle = $("guideToggle");
const zoomSlider = $("zoomSlider");
const opacitySlider = $("opacitySlider");
const brightnessSlider = $("brightnessSlider");
const blendModeSelect = $("blendModeSelect");

const stage = $("stage");
const bgImg = $("bgImg");
const mapped = $("mapped");
const mapImg = $("mapImg");
const mapVideo = $("mapVideo");
const overlay = $("overlay");
const poly = $("poly");
const clipPathData = $("clipPathData");
const scanRect = $("scanRect");
const scanCanvas = $("scanCanvas");

const fileList = $("fileList");
const bgInfo = $("bgInfo");
const contentInfo = $("contentInfo");
const modeInfo = $("modeInfo");

const files = [];
let bgUrl = "";
let contentUrl = "";
let zoom = 1;
let mode = "move";
let selectedPoint = -1;
let dragPoint = -1;
let scanStart = null;
let currentScanBox = null;
let scanBoxes = [];
let scanCandidates = [];
let candidateIndex = 0;

// [2D 전환] 순수 2D 눈속임 워프 엔진용 전역 변수
let canvas2d, ctx2d, currentFacadeSource;

// 📌 WebGL GPU 가속용 변수 추가
let scene, camera, renderer;
let layerMeshes = []; 
let bgMesh;             // ✅ WebGL 내부 전용 배경 레이어 mesh
let layerMaskMeshes = []; // ✅ WebGL 내부 전용 마스크 mesh 배열

// ✅ 4채널 이머시브 독립 미디어 레이어 구조 정의
let mappingLayers = [
  { id: "Wall A", source: null, warpPoints: [], maskPoints: [], warpOrigPoints: [], opacity: 100, brightness: 100, blendMode: "normal", offset: 0, visible: true },
  { id: "Wall B", source: null, warpPoints: [], maskPoints: [], warpOrigPoints: [], opacity: 100, brightness: 100, blendMode: "normal", offset: 0, visible: true },
  { id: "Wall C", source: null, warpPoints: [], maskPoints: [], warpOrigPoints: [], opacity: 100, brightness: 100, blendMode: "normal", offset: 0, visible: true },
  { id: "Wall D", source: null, warpPoints: [], maskPoints: [], warpOrigPoints: [], opacity: 100, brightness: 100, blendMode: "normal", offset: 0, visible: true }
];
let activeLayerIndex = 0;

// ── 마스터 싱크 클락 ──────────────────────────────────────
let audioCtx = null;
let masterStartTime = 0;   // AudioContext 기준 재생 시작 시각
let masterOffset = 0;      // 일시정지 시 누적 재생 위치 (초)
let isPlaying = false;
let driftTimer = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function syncPlay() {
  const ctx = getAudioCtx();
  if (ctx.state === "suspended") ctx.resume();

  // 모든 채널 Promise.all 로드 대기 후 동시 시작
  const readyChecks = mappingLayers.map(layer => {
    if (!layer.source || layer.source.tagName !== "VIDEO") return Promise.resolve();
    if (layer.source.readyState >= 3) return Promise.resolve();
    return new Promise(res => { layer.source.oncanplay = res; });
  });

  Promise.all(readyChecks).then(() => {
    masterStartTime = ctx.currentTime;
    mappingLayers.forEach(layer => {
      if (!layer.source || layer.source.tagName !== "VIDEO") return;
      layer.source.loop = false; // 전체 재생 시 개별 루프 끔
      layer.source.currentTime = layer.offset;
      layer.source.play().catch(() => {});
    });
    // 루프 버튼 UI 갱신
    const loopBtn = document.getElementById("loopToggleBtn");
    if (loopBtn) loopBtn.textContent = "🔁 루프: OFF";
    isPlaying = true;
    updatePlayUI(true);

    // 드리프트 보정 루프 (50ms)
    clearInterval(driftTimer);
    driftTimer = setInterval(() => {
      if (!isPlaying) return;
      const elapsed = ctx.currentTime - masterStartTime + masterOffset;
      mappingLayers.forEach(layer => {
        if (!layer.source || layer.source.tagName !== "VIDEO" || layer.source.paused) return;
        const expected = (elapsed + layer.offset) % (layer.source.duration || 1);
        const diff = Math.abs(layer.source.currentTime - expected);
        if (diff > 0.05) layer.source.currentTime = expected; // 50ms 이상 오차 보정
      });
    }, 50);
  });
}

function syncPause() {
  const ctx = getAudioCtx();
  masterOffset += ctx.currentTime - masterStartTime;
  mappingLayers.forEach(layer => {
    if (layer.source && layer.source.tagName === "VIDEO") {
      layer.source.loop = false;
      layer.source.pause();
    }
  });
  isPlaying = false;
  clearInterval(driftTimer);
  updatePlayUI(false);
  // 루프 버튼 UI 갱신
  const loopBtn = document.getElementById("loopToggleBtn");
  if (loopBtn) loopBtn.textContent = "🔁 루프: OFF";
}

function syncSeek(seconds) {
  masterOffset = seconds;
  masterStartTime = getAudioCtx().currentTime;
  mappingLayers.forEach(layer => {
    if (!layer.source || layer.source.tagName !== "VIDEO") return;
    layer.source.currentTime = (seconds + layer.offset) % (layer.source.duration || 1);
  });
}
window.applyRenderScale = function(scaleValue) {
  const scale = +scaleValue;
  const origW = bgImg.naturalWidth || 1920;
  const origH = bgImg.naturalHeight || 1080;
  const w = Math.round(origW * scale);
  const h = Math.round(origH * scale);
  const wInput = document.getElementById("renderWidth");
  const hInput = document.getElementById("renderHeight");
  if (wInput) wInput.value = w;
  if (hInput) hInput.value = h;
  const info = document.getElementById("renderResInfo");
  if (info) info.textContent = `${w} × ${h} px (원본 ${origW}×${origH})`;
};
window.toggleLayerVisible = function(index) {
  mappingLayers[index].visible = !mappingLayers[index].visible;
  const btns = document.querySelectorAll('.layer-btn');
  if (btns[index]) {
    btns[index].style.opacity = mappingLayers[index].visible ? "1" : "0.3";
    btns[index].style.textDecoration = mappingLayers[index].visible ? "none" : "line-through";
  }
  updateMappedArea();
};
window.toggleCurveMode = function() {
  curveMode = !curveMode;
  const btn = document.getElementById("curveToggleBtn");
  if (btn) btn.textContent = curveMode ? "〰️ 곡선: ON" : "〰️ 곡선: OFF";
};

function autoSmoothHandles(pts) {
  const len = pts.length;
  for (let i = 0; i < len; i++) {
    const prev = pts[(i - 1 + len) % len];
    const curr = pts[i];
    const next = pts[(i + 1) % len];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const distPrev = Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2);
    const distNext = Math.sqrt((next.x - curr.x) ** 2 + (next.y - curr.y) ** 2);
    const tangentLen = Math.min(distPrev, distNext) * 0.25;
    const mag = Math.sqrt(dx * dx + dy * dy) || 1;
    curr.hox = (dx / mag) * tangentLen;
    curr.hoy = (dy / mag) * tangentLen;
    curr.hix = -(dx / mag) * tangentLen;
    curr.hiy = -(dy / mag) * tangentLen;
  }
}

function smoothSinglePoint(pts, index) {
  const len = pts.length;
  const prev = pts[(index - 1 + len) % len];
  const curr = pts[index];
  const next = pts[(index + 1) % len];
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const distPrev = Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2);
  const distNext = Math.sqrt((next.x - curr.x) ** 2 + (next.y - curr.y) ** 2);
  const tangentLen = Math.min(distPrev, distNext) * 0.25;
  const mag = Math.sqrt(dx * dx + dy * dy) || 1;
  curr.hox = (dx / mag) * tangentLen;
  curr.hoy = (dy / mag) * tangentLen;
  curr.hix = -(dx / mag) * tangentLen;
  curr.hiy = -(dy / mag) * tangentLen;
}

function straightenPoint(pt) {
  pt.hox = 0; pt.hoy = 0;
  pt.hix = 0; pt.hiy = 0;
}
window.toggleLoop = function() {
  const layer = mappingLayers[activeLayerIndex];
  if (!layer.source || layer.source.tagName !== "VIDEO") return;
  
  const newLoop = !layer.source.loop;
  layer.source.loop = newLoop;
  
  const btn = document.getElementById("loopToggleBtn");
  if (btn) btn.textContent = newLoop ? "🔁 루프: ON" : "🔁 루프: OFF";
  
  // 루프 ON이면 즉시 재생 시작
  if (newLoop) {
    layer.source.play().catch(() => {});
  }
};
window.setLayerOffset = function(layerIndex, seconds) {
  mappingLayers[layerIndex].offset = seconds;
  if (isPlaying) {
    const elapsed = getAudioCtx().currentTime - masterStartTime + masterOffset;
    const src = mappingLayers[layerIndex].source;
    if (src && src.tagName === "VIDEO") {
      src.currentTime = (elapsed + seconds) % (src.duration || 1);
    }
  }
};

function updatePlayUI(playing) {
  const btn = document.getElementById("masterPlayBtn");
  if (btn) btn.textContent = playing ? "⏸ 일시정지" : "▶ 전체 재생";
}

// 타임코드 표시 업데이트 (requestAnimationFrame 루프에서 호출)
function updateTimeDisplay() {
  if (!isPlaying) return;
  const ctx = getAudioCtx();
  const elapsed = ctx.currentTime - masterStartTime + masterOffset;
  const display = document.getElementById("timeDisplay");
  if (display) {
    const m = Math.floor(elapsed / 60).toString().padStart(2, "0");
    const s = Math.floor(elapsed % 60).toString().padStart(2, "0");
    const f = Math.floor((elapsed % 1) * 30).toString().padStart(2, "0");
    display.textContent = `${m}:${s}:${f}`;
  }
}
// ────────────────────────────────────────────────────────

// 마스크 전용 데이터와 워프 전용 데이터 격리 연동 핸들러 변수
let maskPoints = [];
let dragHandle = null; // { pointIndex, type: 'in'|'out' }
let curveMode = false;
let warpPoints = [];
let warpOrigPoints = [];
let points = warpPoints;

window.addEventListener('DOMContentLoaded', () => {
  init();
});

function init() {
  fitDefaultPoints();
  bindFileEvents();
  bindUiEvents();
  bindStageEvents();
  refreshLists();

  initThree(); // 2D 도화지 레이어 초기화

  setTimeout(() => {
    if (typeof cv !== 'undefined') {
      modeInfo.textContent = "대기 (AI 엔진 로드 완료)";
    }
  }, 2000);
  
  render();
}

function bindFileEvents() {
  fileInput.onchange = (e) => {
    addFiles([...e.target.files]);
    fileInput.value = "";
  };
  folderInput.onchange = (e) => {
    addFiles([...e.target.files]);
    folderInput.value = "";
  };
  ["dragenter", "dragover"].forEach((name) => {
    window.addEventListener(name, (e) => {
      e.preventDefault();
      dropZone.classList.add("over");
    });
  });
  ["dragleave", "drop"].forEach((name) => {
    window.addEventListener(name, (e) => {
      e.preventDefault();
      if (name === "drop") handleDrop(e);
      dropZone.classList.remove("over");
    });
  });
}

async function handleDrop(e) {
  const dropped = [];
  const items = [...(e.dataTransfer.items || [])];
  if (items.length && items[0].webkitGetAsEntry) {
    for (const item of items) {
      const entry = item.webkitGetAsEntry();
      if (entry) dropped.push(...await readEntry(entry));
    }
  } else {
    dropped.push(...(e.dataTransfer.files || []));
  }
  addFiles(dropped);
}

function bindUiEvents() {
  bgSelect.onchange = () => files[+bgSelect.value] && setBackground(files[+bgSelect.value]);
  // onchange + onclick 이중 처리 (같은 항목 재선택 시에도 적용)
  const applyContent = () => {
    const idx = +contentSelect.value;
    if (files[idx]) setContent(files[idx]);
  };
  contentSelect.onchange = applyContent;
  contentSelect.onclick = () => {
    // 클릭 후 값이 이미 선택되어 있으면 한 번 리셋해서 재선택 가능하게
    contentSelect._lastValue = contentSelect.value;
  };
  contentSelect.onblur = () => {
    if (contentSelect.value === contentSelect._lastValue && contentSelect.value !== "") {
      applyContent();
    }
  };

  // 라디오 버튼 모드 체인지 연동
  const modeWarp = document.getElementById("modeWarp");
  const modeMask = document.getElementById("modeMask");
  const switchEditMode = () => {
    if (modeMask && modeMask.checked) {
      points = maskPoints;
      modeInfo.textContent = "영역 마스크 편집 모드 (자르기)";
    } else {
      points = warpPoints;
      modeInfo.textContent = "파사드 워프 편집 모드 (에펙 매쉬)";
    }
    selectedPoint = -1;
    render();
  };
  if (modeWarp) modeWarp.onchange = switchEditMode;
  if (modeMask) modeMask.onchange = switchEditMode;

  scanAreaButton.onclick = () => {
    mode = mode === "scanArea" ? "move" : "scanArea";
    modeInfo.textContent = mode === "scanArea" ? "스캔 영역 드래그" : "이동";
  };

  scanButton.onclick = () => { scanCurrentArea(); };

  nextCandidateButton.onclick = () => {
    if (!scanCandidates.length) return;
    candidateIndex = (candidateIndex + 1) % scanCandidates.length;
    applyCandidate(candidateIndex);
  };

  clearScanAreasButton.onclick = () => {
    scanBoxes = []; currentScanBox = null; scanCandidates = []; candidateIndex = 0;
    modeInfo.textContent = "스캔 영역 초기화";
    render();
  };

  addPointButton.onclick = () => {
    mode = mode === "add" ? "move" : "add";
    modeInfo.textContent = mode === "add" ? "포인트 추가" : "이동";
    render();
  };

  deletePointButton.onclick = () => {
    if (selectedPoint >= 0 && points.length > 4) {
      points.splice(selectedPoint, 1);
      selectedPoint = -1;
      if (points.length <= 4) points = sortClockwise(points);
      render();
      updateMappedArea();
    }
  };

  resetButton.onclick = () => {
    fitDefaultPoints();
    selectedPoint = -1; currentScanBox = null; scanBoxes = []; scanCandidates = []; candidateIndex = 0;
    modeInfo.textContent = "초기화";
    render();
    updateMappedArea();
  };

  guideToggle.onchange = () => { stage.classList.toggle("hide-guides", !guideToggle.checked); };
  zoomSlider.oninput = () => { zoom = +zoomSlider.value / 100; stage.style.transform = `scale(${zoom})`; };

  // 🌟 실시간 색감/블렌딩 스타일 연동
  const updateMediaStyle = () => {
    const layer = mappingLayers[activeLayerIndex];
    if (!layer) return;
    
    // ✅ 글로벌 슬라이더 값을 현재 선택된 채널의 고유 메모리에 격리 저장합니다.
    layer.opacity = +opacitySlider.value;
    layer.brightness = +brightnessSlider.value;
    layer.blendMode = blendModeSelect.value;
    
    updateMappedArea();
  };

  opacitySlider.oninput = updateMediaStyle;
  brightnessSlider.oninput = updateMediaStyle;
  blendModeSelect.onchange = updateMediaStyle;

  window.updateMediaStyle = updateMediaStyle;
  window.addEventListener("keydown", handleKeyMove);
}

function bindStageEvents() {
  stage.addEventListener("pointerdown", (e) => {
    const pos = getStagePos(e);
    if (mode === "scanArea") {
      scanStart = pos;
      currentScanBox = { x: pos.x, y: pos.y, w: 1, h: 1 };
      render();
      return;
    }

        if (mode === "add") {
      points.push(pos);
      const modeMask = $("modeMask");
      const isMaskMode = modeMask && modeMask.checked;

      if (isMaskMode) {
        // 새 포인트에 기본 핸들 추가
        const lastPt = points[points.length - 1];
        if (lastPt.hix === undefined) {
          lastPt.hix = 0; lastPt.hiy = 0;
          lastPt.hox = 0; lastPt.hoy = 0;
        }
        points = sortClockwise(points);
        maskPoints = points;
        // 곡선 ON: 전체 재계산, OFF: 새 포인트 직선 유지
        if (curveMode && maskPoints.length >= 3) {
          autoSmoothHandles(maskPoints);
        } else {
          // OFF면 새로 추가된 포인트 직선 확인
          const newPt = maskPoints[maskPoints.length - 1];
          if (newPt) straightenPoint(newPt);
        }
      } else {
        if (points.length <= 4) {
  points = sortClockwise(points);
} else {
  // 현재 워프 상태에서의 보간 위치를 원점으로 저장
  // (핀을 추가한 위치가 이미 워프된 좌표이므로 그대로 원점)
  warpOrigPoints[points.length - 1] = { x: pos.x, y: pos.y };
}
warpPoints = points;
      }

      selectedPoint = points.length - 1;
      render();
      updateMappedArea();
    }
  });

  stage.addEventListener("pointermove", (e) => {
    if (scanStart) {
      const pos = getStagePos(e);
      currentScanBox = normalizeBox(scanStart, pos);
      render();
    }

    // 베지어 핸들 드래그
    if (dragHandle) {
      const currentPos = getStagePos(e);
      const pt = points[dragHandle.pointIndex];
      if (dragHandle.type === 'out') {
        pt.hox = currentPos.x - pt.x;
        pt.hoy = currentPos.y - pt.y;
        // 반대쪽 핸들 대칭 (Shift 안 누르면)
        if (!e.shiftKey) {
          pt.hix = -pt.hox;
          pt.hiy = -pt.hoy;
        }
      } else {
        pt.hix = currentPos.x - pt.x;
        pt.hiy = currentPos.y - pt.y;
        if (!e.shiftKey) {
          pt.hox = -pt.hix;
          pt.hoy = -pt.hiy;
        }
      }
      render();
      updateMappedArea();
      return;
    }

    if (dragPoint >= 0) {
      const currentPos = getStagePos(e);
      // 베지어 핸들 데이터 보존하면서 좌표만 갱신
      points[dragPoint].x = currentPos.x;
      points[dragPoint].y = currentPos.y;
      selectedPoint = dragPoint;

      const modeMaskEl = $("modeMask");
      const isMask = modeMaskEl && modeMaskEl.checked;
      if (!isMask && points.length >= 4) {
        const quad = orderQuad(points.slice(0, 4));
        poly.setAttribute("d", "M " + quad.map(p => `${p.x},${p.y}`).join(" L ") + " Z");
      } else {
      // 마스크 모드: 베지어 곡선 경로 생성
      if (points.length >= 2 && points[0].hox !== undefined) {
        let d = `M ${points[0].x},${points[0].y}`;
        for (let i = 0; i < points.length; i++) {
          const curr = points[i];
          const next = points[(i + 1) % points.length];
          const cp1x = curr.x + (curr.hox || 0);
          const cp1y = curr.y + (curr.hoy || 0);
          const cp2x = next.x + (next.hix || 0);
          const cp2y = next.y + (next.hiy || 0);
          d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${next.x},${next.y}`;
        }
        poly.setAttribute("d", d);
      } else {
        poly.setAttribute("d", "M " + points.map(p => `${p.x},${p.y}`).join(" L ") + " Z");
      }
    }

      const visualHandles = stage.querySelectorAll(".pt");
      if (visualHandles[dragPoint]) {
  visualHandles[dragPoint].style.left = `${currentPos.x}px`;
  visualHandles[dragPoint].style.top = `${currentPos.y}px`;
  // ✅ 드래그하며 좌표가 바뀔 때도 에펙 UI 크기를 고정 유지합니다.
  visualHandles[dragPoint].style.transform = `translate(-50%, -50%) scale(${1 / zoom})`;
}

      updateMappedArea();
    }
  });

  stage.addEventListener("pointerup", () => {
    if (scanStart) {
      if (currentScanBox && currentScanBox.w > 12 && currentScanBox.h > 12) {
        scanBoxes.push(currentScanBox);
      }
      modeInfo.textContent = `스캔 영역 ${scanBoxes.length}개 지정됨`;
      scanStart = null;
      currentScanBox = null;
    }
   if (dragHandle) {
      dragHandle = null;
      render();
    }
    if (dragPoint >= 0) {
      render();
    }
    dragPoint = -1;
  });
}

function addFiles(newFiles) {
  const valid = newFiles.filter((file) => file && (file.type.startsWith("image/") || file.type.startsWith("video/")));
  valid.forEach((file) => {
    const exists = files.some((item) => item.name === file.name && item.size === file.size);
    if (!exists) files.push(file);
  });
  refreshLists();
  autoApplyFiles();
}

function refreshLists() {
  bgSelect.innerHTML = '<option value="">배경 선택</option>';
  contentSelect.innerHTML = '<option value="">콘텐츠 선택</option>';
  fileList.innerHTML = "";
  files.forEach((file, index) => {
    const type = file.type.startsWith("video/") ? "VIDEO" : "IMAGE";
    const name = file.webkitRelativePath || file.name;
    const label = `${type} - ${name}`;
    if (file.type.startsWith("image/")) bgSelect.add(new Option(label, index));
    contentSelect.add(new Option(label, index));
    const row = document.createElement("div");
    row.textContent = label;
    fileList.appendChild(row);
  });
}

function autoApplyFiles() {
  const firstImage = files.findIndex((f) => f.type.startsWith("image/"));
  const firstContent = files.findIndex((f, i) => i !== firstImage);
  if (!bgImg.getAttribute("src") && firstImage >= 0) {
    bgSelect.value = firstImage;
    setBackground(files[firstImage]);
  }
  if (!contentUrl) {
    const index = firstContent >= 0 ? firstContent : firstImage;
    if (index >= 0) {
      contentSelect.value = index;
      setContent(files[index]);
    }
  }
}

function setBackground(file) {
  if (bgUrl) URL.revokeObjectURL(bgUrl);
  bgUrl = URL.createObjectURL(file);
  
  bgImg.onload = () => {
    const w = bgImg.naturalWidth; 
    const h = bgImg.naturalHeight;

    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    
    requestAnimationFrame(() => {
      const parentContainer = stage.parentElement; 
      const padding = 80; 
      const availableWidth = parentContainer.clientWidth - padding;
      const scale = Math.min(availableWidth / w, 1);
      
      // ✅ 수정 코드: 처음 로드 시 에펙처럼 무조건 100% 원본 크기로 띄우거나, 한계가 없는 슬라이더 배율로 매칭합니다.
zoom = scale;
zoomSlider.value = scale * 100;
      
      stage.style.transform = `scale(${zoom})`;
      stage.style.transformOrigin = "0 0"; 

      overlay.setAttribute("width", w);
      overlay.setAttribute("height", h);
      overlay.setAttribute("viewBox", `0 0 ${w} ${h}`);
      
      bgInfo.textContent = file.name;
      // 렌더 해상도 정보 갱신
      const resInfo = document.getElementById("renderResInfo");
      if (resInfo) resInfo.textContent = `${w} × ${h} px (원본)`;
      const rw = document.getElementById("renderWidth");
      const rh = document.getElementById("renderHeight");
      if (rw) rw.value = w;
      if (rh) rh.value = h;
      // ✅ WebGL 바닥 레이어에 배경 이미지 픽셀 맵 동적 로드
      // ✅ WebGL 바닥 레이어에 배경 이미지 픽셀 맵 동적 로드
      if (bgMesh) {
        bgMesh.geometry.dispose();
        bgMesh.geometry = new THREE.PlaneGeometry(w, h);
        bgMesh.position.set(w / 2, h / 2, -1);
        
        // ❌ 기존 이미지 텍스처 교체 코드
        if (bgMesh.material.map) bgMesh.material.map.dispose();
        bgMesh.material.map = new THREE.Texture(bgImg);
        
        bgMesh.material.map.wrapS = THREE.ClampToEdgeWrapping;
        bgMesh.material.map.wrapT = THREE.ClampToEdgeWrapping;
        bgMesh.material.map.flipY = false; // ✅ 이 줄을 추가하여 배경 이미지의 상하 반전 왜곡을 바로잡습니다.
        bgMesh.material.map.needsUpdate = true;
        
        // ✅ [건물 노출 보정] 배경 재질 자체에도 최초 1회 갱신 신호를 주어 백색 비행을 건물 이미지로 깨웁니다.
        bgMesh.material.needsUpdate = true;
      }

      fitDefaultPoints();
      enableButtons();
      render();
      updateMappedArea();

      const webglBox = $("webgl-container");
      if (webglBox) {
        webglBox.style.width = `${w}px`;
        webglBox.style.height = `${h}px`;
      }
      if (canvas2d) {
        canvas2d.width = w;
        canvas2d.height = h;
      }
    });
  };
  
  bgImg.src = bgUrl;
}

function setContent(file) {
  let url = URL.createObjectURL(file);
  let mediaEl;

  if (file.type.startsWith("video/")) {
    mediaEl = document.createElement("video");
    mediaEl.src = url;
    mediaEl.muted = true;
    mediaEl.loop = false; // 싱크 엔진이 ended 이벤트로 재루프 처리
mediaEl.addEventListener("ended", () => {
  if (isPlaying) {
    mediaEl.currentTime = mappingLayers.find(l => l.source === mediaEl)?.offset || 0;
    mediaEl.play().catch(() => {});
  }
});
    mediaEl.playsInline = true;
    mediaEl.style.visibility = "hidden";
    mediaEl.style.position = "absolute";
    mediaEl.onloadedmetadata = () => {
      initOrUpdateFacadeMesh(mediaEl, true);
    };
    mediaEl.loop = true;
    mediaEl.play().catch(() => {});
    const loopBtn = document.getElementById("loopToggleBtn");
    if (loopBtn) loopBtn.textContent = "🔁 루프: ON";
  } else {
    mediaEl = document.createElement("img");
    mediaEl.src = url;
    mediaEl.onload = () => {
      initOrUpdateFacadeMesh(mediaEl, false);
    };
  }
  
  // 이전 소스가 DOM에 있으면 제거
  const prevSource = mappingLayers[activeLayerIndex].source;
  if (prevSource && prevSource.parentNode) prevSource.parentNode.removeChild(prevSource);
  
  // 새 미디어를 DOM에 추가 (비디오 로드/재생에 필요)
  if (mediaEl.tagName === "VIDEO") document.body.appendChild(mediaEl);
  
  mappingLayers[activeLayerIndex].source = mediaEl;
  contentInfo.textContent = `${mappingLayers[activeLayerIndex].id}: ${file.name}`;
}

function enableButtons() {
  [
    scanAreaButton,
    scanButton,
    nextCandidateButton,
    clearScanAreasButton,
    addPointButton,
    deletePointButton,
    resetButton
  ].forEach((b) => b.disabled = false);
}



function fitDefaultPoints() {
  const w = bgImg.naturalWidth || 800;
  const h = bgImg.naturalHeight || 600;
  
  mappingLayers.forEach((layer) => {
    // 마스크 포인트: x,y + 베지어 핸들 (hix,hiy=들어오는 핸들, hox,hoy=나가는 핸들)
    layer.warpPoints = [{ x: w * 0.2, y: h * 0.22 }, { x: w * 0.8, y: h * 0.22 }, { x: w * 0.8, y: h * 0.78 }, { x: w * 0.2, y: h * 0.78 }];
    // 마스크 초기값 = 워프 영역과 동일
    layer.maskPoints = layer.warpPoints.map(p => ({ x: p.x, y: p.y, hix: 0, hiy: 0, hox: 0, hoy: 0 }));
    layer.warpOrigPoints = [];
    // 기본 수치 리셋 세팅
    layer.opacity = 100;
    layer.brightness = 100;
    layer.blendMode = "normal";
  });

  syncActiveLayerData();
}

function syncActiveLayerData() {
  const layer = mappingLayers[activeLayerIndex];
  warpPoints = layer.warpPoints;
  maskPoints = layer.maskPoints;
  warpOrigPoints = layer.warpOrigPoints;
  
  // ✅ 채널 변환 시 우측 패널 슬라이더 눈금 수치들을 개별 레이어 값으로 강제 복구 연동합니다.
  opacitySlider.value = layer.opacity !== undefined ? layer.opacity : 100;
  brightnessSlider.value = layer.brightness !== undefined ? layer.brightness : 100;
  blendModeSelect.value = layer.blendMode || "normal";

  const modeMask = document.getElementById("modeMask");
  points = (modeMask && modeMask.checked) ? maskPoints : warpPoints;
}

window.switchLayer = function(index) {
  // 현재 편집 중인 레이어 데이터 백업
  mappingLayers[activeLayerIndex].opacity = +opacitySlider.value;
  mappingLayers[activeLayerIndex].brightness = +brightnessSlider.value;
  mappingLayers[activeLayerIndex].blendMode = blendModeSelect.value;
  mappingLayers[activeLayerIndex].warpPoints = warpPoints;
  mappingLayers[activeLayerIndex].maskPoints = maskPoints;
  mappingLayers[activeLayerIndex].warpOrigPoints = warpOrigPoints;

  // 같은 레이어 다시 클릭 → visible 토글
  if (index === activeLayerIndex) {
    mappingLayers[index].visible = !mappingLayers[index].visible;
  } else {
    // 다른 레이어 클릭 → 편집 대상 전환
    activeLayerIndex = index;
    syncActiveLayerData();
  }
  
  // 버튼 UI 갱신
  document.querySelectorAll('.layer-btn').forEach((btn, i) => {
    const isActive = (i === activeLayerIndex);
    const isVisible = mappingLayers[i].visible;
    btn.style.background = isActive ? "#3b82f6" : "#1e293b";
    btn.style.opacity = isVisible ? "1" : "0.3";
    btn.style.textDecoration = isVisible ? "none" : "line-through";
  });
  
  selectedPoint = -1;
  
  // 루프 버튼 상태 갱신
  const loopBtn = document.getElementById("loopToggleBtn");
  const layerSrc = mappingLayers[activeLayerIndex].source;
  if (loopBtn) loopBtn.textContent = (layerSrc && layerSrc.loop) ? "🔁 루프: ON" : "🔁 루프: OFF";
  
  render();
  updateMappedArea();
  
  // 소스 없으면 자동 적용
  if (!mappingLayers[activeLayerIndex].source && contentSelect.value !== "") {
    const fileIdx = +contentSelect.value;
    if (files[fileIdx]) setContent(files[fileIdx]);
  }
};

function render() {
  stage.querySelectorAll(".pt").forEach((el) => el.remove());

  if (points.length > 0) {
    // 워프 모드일 때: 4꼭짓점만 폴리곤으로 연결
    const modeMask = $("modeMask");
    const isMaskMode = modeMask && modeMask.checked;
    if (!isMaskMode && points.length >= 4) {
      const quad = orderQuad(points.slice(0, 4));
      poly.setAttribute("d", "M " + quad.map(p => `${p.x},${p.y}`).join(" L ") + " Z");
    } else {
      // 마스크 모드: 베지어 곡선 경로
      if (points.length >= 2 && points[0].hox !== undefined) {
        let d = `M ${points[0].x},${points[0].y}`;
        for (let i = 0; i < points.length; i++) {
          const curr = points[i];
          const next = points[(i + 1) % points.length];
          const cp1x = curr.x + (curr.hox || 0);
          const cp1y = curr.y + (curr.hoy || 0);
          const cp2x = next.x + (next.hix || 0);
          const cp2y = next.y + (next.hiy || 0);
          d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${next.x},${next.y}`;
        }
        poly.setAttribute("d", d);
      } else {
        poly.setAttribute("d", "M " + points.map(p => `${p.x},${p.y}`).join(" L ") + " Z");
      }
    }
  }

  overlay.querySelectorAll(".scan-hint").forEach(el => el.remove());
  overlay.querySelectorAll(".handle-line").forEach(el => el.remove());

  scanBoxes.forEach((box) => {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("class", "scan-hint");
    r.setAttribute("x", box.x); r.setAttribute("y", box.y);
    r.setAttribute("width", box.w); r.setAttribute("height", box.h);
    overlay.appendChild(r);
  });

  if (currentScanBox) {
    scanRect.style.display = "block";
    scanRect.setAttribute("x", currentScanBox.x); scanRect.setAttribute("y", currentScanBox.y);
    scanRect.setAttribute("width", currentScanBox.w); scanRect.setAttribute("height", currentScanBox.h);
  } else {
    scanRect.style.display = "none";
  }

  points.forEach((point, index) => {
    const handle = document.createElement("button");
    handle.className = "pt";
    if (index === selectedPoint) handle.classList.add("selected");
   handle.style.left = `${point.x}px`;
handle.style.top = `${point.y}px`;
// ✅ [에펙 스타일] 현재 줌 배율의 역수를 실시간으로 곱해 모니터상 24px 크기를 강제 고정합니다.
handle.style.transform = `translate(-50%, -50%) scale(${1 / zoom})`;

handle.onpointerdown = (e) => {
      e.stopPropagation();
      selectedPoint = index;
      dragPoint = index;
      
      // 마스크 모드: 곡선 ON→자동곡선, OFF→직선화
      const isMaskClick = $("modeMask") && $("modeMask").checked;
      if (isMaskClick && point.hox !== undefined && points.length >= 3) {
        if (curveMode) {
          smoothSinglePoint(points, index);
        } else {
          straightenPoint(point);
        }
        updateMappedArea();
      }
      
      render();
    };
    stage.appendChild(handle);

    // 마스크 모드 + 선택된 포인트: 베지어 핸들 표시
    const isMaskNow = $("modeMask") && $("modeMask").checked;
    const hasHandle = point.hox !== undefined && (point.hox !== 0 || point.hoy !== 0 || point.hix !== 0 || point.hiy !== 0);
    if (isMaskNow && hasHandle) {
      // Out 핸들
      const hOut = document.createElement("button");
      hOut.className = "pt handle-out";
      hOut.style.left = `${point.x + (point.hox || 0)}px`;
      hOut.style.top = `${point.y + (point.hoy || 0)}px`;
      hOut.style.transform = `translate(-50%, -50%) scale(${1 / zoom})`;
      hOut.style.background = "#f97316";
      hOut.style.width = "14px";
      hOut.style.height = "14px";
      hOut.onpointerdown = (e) => {
        e.stopPropagation();
        dragHandle = { pointIndex: index, type: 'out' };
      };
      stage.appendChild(hOut);

      // In 핸들
      const hIn = document.createElement("button");
      hIn.className = "pt handle-in";
      hIn.style.left = `${point.x + (point.hix || 0)}px`;
      hIn.style.top = `${point.y + (point.hiy || 0)}px`;
      hIn.style.transform = `translate(-50%, -50%) scale(${1 / zoom})`;
      hIn.style.background = "#a855f7";
      hIn.style.width = "14px";
      hIn.style.height = "14px";
      hIn.onpointerdown = (e) => {
        e.stopPropagation();
        dragHandle = { pointIndex: index, type: 'in' };
      };
      stage.appendChild(hIn);

      // 핸들 연결선 (SVG)
      const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line1.setAttribute("class", "handle-line");
      line1.setAttribute("x1", point.x);
      line1.setAttribute("y1", point.y);
      line1.setAttribute("x2", point.x + (point.hox || 0));
      line1.setAttribute("y2", point.y + (point.hoy || 0));
      line1.setAttribute("stroke", "#f97316");
      line1.setAttribute("stroke-width", "1");
      line1.setAttribute("stroke-dasharray", "4 3");
      overlay.appendChild(line1);

      const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line2.setAttribute("class", "handle-line");
      line2.setAttribute("x1", point.x);
      line2.setAttribute("y1", point.y);
      line2.setAttribute("x2", point.x + (point.hix || 0));
      line2.setAttribute("y2", point.y + (point.hiy || 0));
      line2.setAttribute("stroke", "#a855f7");
      line2.setAttribute("stroke-width", "1");
      line2.setAttribute("stroke-dasharray", "4 3");
      overlay.appendChild(line2);
    }
  });
}

function updateMappedArea() {
  if (!bgImg.src || !scene) return;

  if (renderer) {
    const w = bgImg.naturalWidth || 800;
    const h = bgImg.naturalHeight || 600;
    if (renderer.domElement.width !== w || renderer.domElement.height !== h) {
      renderer.setSize(w, h);
      camera.right = w; camera.bottom = h;
      camera.updateProjectionMatrix();
    }
  }

  if (mappingLayers[activeLayerIndex]) {
    mappingLayers[activeLayerIndex].warpPoints = warpPoints;
    mappingLayers[activeLayerIndex].maskPoints = maskPoints;
    mappingLayers[activeLayerIndex].warpOrigPoints = warpOrigPoints;
  }

  mappingLayers.forEach((layer, idx) => {
    const mesh = layerMeshes[idx];
    const maskMesh = layerMaskMeshes[idx];
    if (!mesh) return;
    
    // 소스 없거나 visible OFF인 레이어는 숨김
    // 소스 없으면 숨김, visible로 개별 ON/OFF
    if (!layer.source) {
      mesh.visible = false;
      return;
    }
   mesh.visible = layer.visible;
    if (maskMesh) maskMesh.visible = layer.visible;
    if (!layer.visible) return;
    
    if (layer.source.tagName === "VIDEO" && layer.source.readyState < 2) return;

    // 1. 투명도 및 밝기 개별 제어
    mesh.material.opacity = (layer.opacity !== undefined ? layer.opacity : 100) / 100;
    const b = (layer.brightness !== undefined ? layer.brightness : 100) / 100;
    mesh.material.color.setRGB(b, b, b);

    // 2. 에펙 프로덕션 합성 모드 (WebGL 하드웨어 블렌딩 맵핑)
    if (layer.blendMode === "screen") {
      mesh.material.blending = THREE.AdditiveBlending; 
    } else if (layer.blendMode === "multiply") {
      mesh.material.blending = THREE.MultiplyBlending; // 배경 레이어가 내부에 잡혀 정상 작동합니다.
    } else if (layer.blendMode === "overlay") {
      mesh.material.blending = THREE.SubtractiveBlending; // 하드웨어 반전 오버레이 대용
    } else {
      mesh.material.blending = THREE.NormalBlending;   
    }
    // ✅ mesh.material.needsUpdate = true;  <- 이 줄을 깔끔하게 지워줍니다.

    // 3. 🟢 [실시간 마스크 절삭] 영역 마스크 정점을 이용해 3D 공간에서 비디오 커팅 연산
    // 3. 🟢 [실시간 마스크 절삭] SVG clip-path로 WebGL 캔버스 자르기
if (maskMesh && layer.maskPoints && layer.maskPoints.length >= 3) {
  const mp = layer.maskPoints;
  const sampledPts = [];
  for (let i = 0; i < mp.length; i++) {
    const curr = mp[i];
    const next = mp[(i + 1) % mp.length];
    const cp1x = curr.x + (curr.hox || 0);
    const cp1y = curr.y + (curr.hoy || 0);
    const cp2x = next.x + (next.hix || 0);
    const cp2y = next.y + (next.hiy || 0);
    for (let t = 0; t < 16; t++) {
      const tt = t / 16, mt = 1 - tt;
      sampledPts.push({
        x: mt*mt*mt*curr.x + 3*mt*mt*tt*cp1x + 3*mt*tt*tt*cp2x + tt*tt*tt*next.x,
        y: mt*mt*mt*curr.y + 3*mt*mt*tt*cp1y + 3*mt*tt*tt*cp2y + tt*tt*tt*next.y
      });
    }
  }
  const cx = sampledPts.reduce((s, p) => s + p.x, 0) / sampledPts.length;
  const cy = sampledPts.reduce((s, p) => s + p.y, 0) / sampledPts.length;
  const verts = [];
  for (let i = 0; i < sampledPts.length; i++) {
    const a = sampledPts[i];
    const b = sampledPts[(i + 1) % sampledPts.length];
    verts.push(cx, cy, 0, a.x, a.y, 0, b.x, b.y, 0);
  }
  if (maskMesh.geometry) maskMesh.geometry.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  maskMesh.geometry = geo;
  maskMesh.visible = layer.visible;
}

    // 4. 파사드 매쉬 워프 정점 연산
// 4. 파사드 매쉬 워프 정점 연산 (가우시안 보간)
    const isRecording = typeof mediaRecorder !== 'undefined' && mediaRecorder && mediaRecorder.state === "recording";
    const COLS = 32;
    const ROWS = 32;
    const ordered = orderQuad(layer.warpPoints.slice(0, 4));
    const tl = ordered[0]; const tr = ordered[1];
    const br = ordered[2]; const bl = ordered[3];

    // 영향 반경: 이미지 대각선의 25%
    const imgW = bgImg.naturalWidth || 800;
    const imgH = bgImg.naturalHeight || 600;
    const sigma = Math.sqrt(imgW * imgW + imgH * imgH) * 0.06;
    const sigma2x2 = 2 * sigma * sigma;

    // 추가 핀 델타 미리 계산
    const pinDeltas = [];
    if (layer.warpPoints.length > 4) {
      for (let j = 4; j < layer.warpPoints.length; j++) {
        const origPin = layer.warpOrigPoints[j];
        const curPin = layer.warpPoints[j];
        if (!origPin || !curPin) continue;
        pinDeltas.push({
          ox: origPin.x, oy: origPin.y,
          dx: curPin.x - origPin.x,
          dy: curPin.y - origPin.y
        });
      }
    }

    const posAttr = mesh.geometry.attributes.position;
    let vIdx = 0;

    for (let r = 0; r <= ROWS; r++) {
      const v = r / ROWS;
      for (let c = 0; c <= COLS; c++) {
        const u = c / COLS;

        const topX = tl.x * (1 - u) + tr.x * u;
        const topY = tl.y * (1 - u) + tr.y * u;
        const botX = bl.x * (1 - u) + br.x * u;
        const botY = bl.y * (1 - u) + br.y * u;
        let sx = topX * (1 - v) + botX * v;
        let sy = topY * (1 - v) + botY * v;

        // 핀 영향 누적 (나누지 않음 — 거리 감쇠가 자연스럽게 처리)
        // 핀 영향 누적 — sigma 반경 밖은 완전 차단
        for (let j = 0; j < pinDeltas.length; j++) {
          const pin = pinDeltas[j];
          const pdx = sx - pin.ox;
          const pdy = sy - pin.oy;
          const distSq = pdx * pdx + pdy * pdy;
          if (distSq > sigma2x2 * 4) continue; // 2σ 밖은 완전 무시
          const w = Math.exp(-distSq / sigma2x2);
          sx += pin.dx * w;
          sy += pin.dy * w;
        }

        posAttr.setXY(vIdx, sx, sy);
        vIdx++;
      }
    }
    posAttr.needsUpdate = true;
  });
}

function drawTriangle(ctx, img, x0, y0, x1, y1, x2, y2, u0, v0, u1, v1, u2, v2) {
  const cx = (x0 + x1 + x2) / 3;
  const cy = (y0 + y1 + y2) / 3;
  
  const scale = 1.006; 
  const nx0 = cx + (x0 - cx) * scale;
  const ny0 = cy + (y0 - cy) * scale;
  const nx1 = cx + (x1 - cx) * scale;
  const ny1 = cy + (y1 - cy) * scale;
  const nx2 = cx + (x2 - cx) * scale;
  const ny2 = cy + (y2 - cy) * scale;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(nx0, ny0); ctx.lineTo(nx1, ny1); ctx.lineTo(nx2, ny2);
  ctx.closePath();
  ctx.clip();

  const denom = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
  if (Math.abs(denom) < 0.0001) { ctx.restore(); return; }

  const a = (x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) / denom;
  const b = (y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) / denom;
  const c = (u0 * (x1 - x2) + u1 * (x2 - x0) + u2 * (x0 - x1)) / denom;
  const d = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / denom;
  
  // ✅ 정석 아핀 텍스처 평행이동 변환 행렬 공식 적용
  const e = (u0 * (v1 * x2 - v2 * x1) + v0 * (u2 * x1 - u1 * x2) + x0 * (u1 * v2 - u2 * v1)) / denom;
  const f = (u0 * (v1 * y2 - v2 * y1) + v0 * (u2 * y1 - u1 * y2) + y0 * (u1 * v2 - u2 * v1)) / denom;

  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function getHomography(src, dst) {
  if (typeof numeric === 'undefined') return null;
  let A = [], b = [];
  for (let i = 0; i < 4; i++) {
    A.push([src[i].x, src[i].y, 1, 0, 0, 0, -src[i].x * dst[i].x, -src[i].y * dst[i].x]);
    A.push([0, 0, 0, src[i].x, src[i].y, 1, -src[i].x * dst[i].y, -src[i].y * dst[i].y]);
    b.push(dst[i].x); b.push(dst[i].y);
  }
  let h = numeric.solve(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]];
}

async function scanCurrentArea() {
  if (!bgImg.src) return;

  modeInfo.textContent = "AI 분석 중 (건물 면 감지)...";
  scanButton.disabled = true;

  const canvas = scanCanvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = bgImg.naturalWidth;
  canvas.height = bgImg.naturalHeight;
  ctx.drawImage(bgImg, 0, 0);

  const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, mimeType: 'image/jpeg' })
    });

    if (!res.ok) throw new Error('서버 오류: ' + res.status);
    const data = await res.json();

    if (!data.surfaces || data.surfaces.length === 0) {
      modeInfo.textContent = "감지된 면이 없습니다. 다시 시도해주세요.";
      return;
    }

    scanCandidates = data.surfaces.map(surface => ({
      points: sortClockwise(surface.points),
      score: surface.confidence,
      label: surface.label
    }));

    candidateIndex = 0;
    applyCandidate(0);
    modeInfo.textContent = `${data.count}개 면 감지 완료. "다음 →" 버튼으로 전환`;

  } catch(e) {
    modeInfo.textContent = "감지 실패: " + e.message;
    console.error(e);
  } finally {
    scanButton.disabled = false;
  }
}

  

function contourToPoints(cnt, offsetX = 0, offsetY = 0) {
  const pts = [];
  for (let i = 0; i < cnt.rows; i++) {
    pts.push({
      x: cnt.data32S[i * 2] + offsetX,
      y: cnt.data32S[i * 2 + 1] + offsetY
    });
  }
  return pts;
}

function getIntersectionArea(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

function scoreCandidate(pts, box) {
  const b = getBounds(pts);
  const or = getIntersectionArea(b,box) / Math.max(1, box.w * box.h);
  const fr = (b.w*b.h) / Math.max(1, box.w * box.h);
  const sides = [
    dist(pts[0],pts[1]),
    dist(pts[1],pts[2]),
    dist(pts[2],pts[3]),
    dist(pts[3],pts[0])];
  const avg = sides.reduce((a,v)=> a+v,0)/4;
  const vr = sides.reduce((s,v)=> s+Math.abs(v-avg),0)/avg;
  const shape = Math.max(0,1-vr*.5)*200;
  return or*1000 + fr*100 + shape;
}

function dist(a,b){
  return Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2);
}

function applyCandidate(index) {
  if (!scanCandidates.length) return;
  candidateIndex = index;
  const candidate = scanCandidates[index];
  points = sortClockwise(candidate.points);
  warpPoints = points;
  mappingLayers[activeLayerIndex].warpPoints = points;
  mappingLayers[activeLayerIndex].maskPoints = points.map(p => ({
    x: p.x, y: p.y, hix: 0, hiy: 0, hox: 0, hoy: 0
  }));
  maskPoints = mappingLayers[activeLayerIndex].maskPoints;
  selectedPoint = -1;
  render();
  updateMappedArea();
  const label = candidate.label || '';
  modeInfo.textContent = `후보 ${index + 1}/${scanCandidates.length}: ${label}`;
}

function handleKeyMove(e) {
  if (selectedPoint < 0) return;
  const step = e.shiftKey ? 10 : 1;
  const p = points[selectedPoint];
  if (e.key === "ArrowLeft") p.x -= step;
  else if (e.key === "ArrowRight") p.x += step;
  else if (e.key === "ArrowUp") p.y -= step;
  else if (e.key === "ArrowDown") p.y += step;
  else if (e.key === "Delete" && points.length > 4) {
    points.splice(selectedPoint, 1);
    selectedPoint = -1;
  } else return;
  e.preventDefault();
  render();
  updateMappedArea();
}

function getStagePos(e) {
  const rect = stage.getBoundingClientRect();
  return {
    x: clamp((e.clientX - rect.left) / zoom, 0, bgImg.naturalWidth || 99999),
    y: clamp((e.clientY - rect.top) / zoom, 0, bgImg.naturalHeight || 99999),
  };
}

function normalizeBox(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function getBounds(arr) {
  const xs = arr.map((p) => p.x);
  const ys = arr.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function sortClockwise(arr) {
  const c = arr.reduce((a, p) => ({ x: a.x + p.x / arr.length, y: a.y + p.y / arr.length }), { x: 0, y: 0 });
  return arr.slice().sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
}

function orderQuad(pts) {
  const byY = pts.slice().sort((a, b) => a.y - b.y);
  const top = byY.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = byY.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

function nearestPoint(arr, target, used) {
  let best = null;
  let bestIdx = -1;
  let bestDist = Infinity;

  arr.forEach((p, i) => {
    if (used.has(i)) return;
    const d = (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
      bestIdx = i;
    }
  });

  used.add(bestIdx);
  return best;
}

function getWarpQuadFromPoints(pts) {
  if (pts.length === 4) return orderQuad(pts);

  const box = getBounds(pts);
  const targets = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h }
  ];

  const used = new Set();
  return targets.map(t => nearestPoint(pts, t, used));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function readEntry(entry) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => resolve([file]), () => resolve([]));
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      function readBatch() {
        reader.readEntries(async (entries) => {
          if (!entries.length) { resolve(all); return; }
          for (const child of entries) { all.push(...await readEntry(child)); }
          readBatch();
        }, () => resolve(all));
      }
      readBatch();
      return;
    }
    resolve([]);
  });
}
// 📌 [살려내기] 지워졌던 비디오 텍스처 업로드 엔진 함수를 다시 주입합니다.
function initOrUpdateFacadeMesh(targetElement, isVideo) {
  const mesh = layerMeshes[activeLayerIndex];
  if (!mesh) return;

  if (mesh.material.map) mesh.material.map.dispose();

  let texture;
  if (isVideo) {
    texture = new THREE.VideoTexture(targetElement);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
  } else {
    texture = new THREE.Texture(targetElement);
    texture.needsUpdate = true;
  }

  texture.flipY = false; // ✅ 이 줄을 추가하여 얹어질 비디오/이미지 소스의 상하 반전 왜곡을 바로잡습니다.
  mesh.material.map = texture;
  mesh.material.opacity = opacitySlider.value / 100;
  mesh.material.map.needsUpdate = true;
  
  // ✅ [비디오 소스 실종 해결 핵심] 비디오가 탑재될 때 최초 1회 재질 업데이트 신호를 그래픽카드에 신속 전송하여 화면에 띄웁니다.
  mesh.material.needsUpdate = true; 
  // 새 소스 로드 시 clip-path 초기화
renderer.domElement.style.clipPath = '';
  console.log(`[GPU 텍스처 변환] ${mappingLayers[activeLayerIndex].id} 비디오 탑재 완료`);
}
function initThree() {
  const container = $("webgl-container");
  if (!container) return;
  
  container.innerHTML = ""; 
  
  // 1. WebGL 렌더러 생성 (스텐실 버퍼 활성화)
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, stencil: true, preserveDrawingBuffer: true });
  renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.top = "0"; renderer.domElement.style.left = "0";
  renderer.domElement.style.zIndex = "2"; // ✅ 배경(1)과 UI오버레이(3) 사이인 '2'층으로 정상 복구
  renderer.domElement.style.pointerEvents = "none";
  container.appendChild(renderer.domElement);
  
  container.style.position = "absolute";
  container.style.zIndex = "2"; // ✅ 배경(1)과 UI오버레이(3) 사이인 '2'층으로 정상 복구
  container.style.pointerEvents = "none";
  
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(0, container.clientWidth || 800, 0, container.clientHeight || 600, -100, 100);
  
  // 2. 에펙 컴포지션처럼 맨 바닥에 깔릴 빽그라운드 가상 Mesh 생성
  const bgGeom = new THREE.PlaneGeometry(1, 1);
  const bgMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  bgMesh = new THREE.Mesh(bgGeom, bgMat);
  bgMesh.renderOrder = 0; // 최하단 레이어 고정
  scene.add(bgMesh);
  
  // 3. 4개 채널 독립 워프 매쉬 및 스텐실 마스크 뼈대 생성
  // 3. 4개 채널 독립 워프 매쉬 및 스텐실 마스크 뼈대 생성
  mappingLayers.forEach((layer, idx) => {
    // 3-1. 보이지 않는 마스크 절삭 평면 매쉬 (스텐실 마스크 레이어)
    const maskGeom = new THREE.BufferGeometry();
    // ✅ 마스크 절삭 평면이 앞뒷면 구분 없이 무조건 절삭하도록 DoubleSide로 열어줍니다.
    const maskMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    
    // 3-1 구역 내부 상수 변경
    maskMat.stencilWrite = true;
maskMat.stencilFunc = THREE.AlwaysStencilFunc;
maskMat.stencilRef = idx + 1;
maskMat.stencilFail = THREE.KeepStencilOp;
maskMat.stencilZFail = THREE.KeepStencilOp;
maskMat.stencilZPass = THREE.ReplaceStencilOp;
    
    const maskMesh = new THREE.Mesh(maskGeom, maskMat);
   maskMesh.renderOrder = idx * 2 + 1; 
    scene.add(maskMesh);
    layerMaskMeshes.push(maskMesh);

    // 3-2. 실제 비디오가 뿌려질 파사드 워프 매쉬
    const geometry = new THREE.PlaneGeometry(1, 1, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide
    });
    
    // 마스크 연동을 위한 스텐실 필터 장착
material.stencilWrite = true;
material.stencilFunc = THREE.EqualStencilFunc;
material.stencilRef = idx + 1;
material.stencilFail = THREE.KeepStencilOp;
material.stencilZFail = THREE.KeepStencilOp;
material.stencilZPass = THREE.KeepStencilOp;
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = idx * 2 + 2;
    scene.add(mesh);
    layerMeshes.push(mesh);
  });

  stage.insertBefore(container, overlay);

 // ← initThree() 함수 상단, mappingLayers 선언 아래 전역에 추가
let _dirty = true;
function markDirty() { _dirty = true; }

function animate() {
  requestAnimationFrame(animate);

  // 비디오 재생 중이면 매 프레임 갱신, 아니면 dirty 시에만 갱신
  const hasVideo = mappingLayers.some(l => l.source && l.source.tagName === "VIDEO" && !l.source.paused);
  if (hasVideo || _dirty) {
  updateMappedArea();
  _dirty = false;
}
updateTimeDisplay(); // ← 타임코드 디스플레이 갱신
 if (renderer && scene && camera) {
    renderer.autoClear = false;
    
    // 1단계: 전체 클리어 + 배경만 렌더
    renderer.clear(true, true, true);
    layerMeshes.forEach(m => { m.visible = false; });
    layerMaskMeshes.forEach(m => { m.visible = false; });
    if (bgMesh) bgMesh.visible = true;
    renderer.render(scene, camera);
    
    // 2단계: 레이어별 순차 렌더 (스텐실 격리)
    mappingLayers.forEach((layer, idx) => {
      if (!layer.source || !layer.visible) return;
      const mesh = layerMeshes[idx];
      const maskMesh = layerMaskMeshes[idx];
      if (!mesh || !mesh.material.map) return;
      
     // 스텐실 테스트 활성화 + 클리어
      renderer.state.buffers.stencil.setTest(true);
      renderer.clear(false, false, true);
      
      // 이 레이어만 ON
      if (bgMesh) bgMesh.visible = false;
      layerMeshes.forEach(m => { m.visible = false; });
      layerMaskMeshes.forEach(m => { m.visible = false; });
      if (maskMesh) maskMesh.visible = true;
      mesh.visible = true;
      
      renderer.render(scene, camera);
    });
  }
}
requestAnimationFrame(animate);

  console.log("🚀 GPU 가속 WebGL 씬 컴포지션 엔진 구성 완료");
  // ── 익스포트 엔진 ─────────────────────────────────────────

// ── 오프라인 렌더링 엔진 (프레임 단위) ──
let isRendering = false;
let renderCancelled = false;

window.startExport = async function() {
  if (isRendering) { alert("렌더링 진행 중입니다."); return; }

  // 소스 비디오 중 가장 긴 것 기준
  let maxDuration = 0;
  mappingLayers.forEach(layer => {
    if (layer.source && layer.source.tagName === "VIDEO" && layer.source.duration) {
      maxDuration = Math.max(maxDuration, layer.source.duration);
    }
  });
  if (maxDuration <= 0) { alert("렌더링할 비디오가 없습니다."); return; }

// 렌더 설정 UI에서 값 읽기
  const fps = +(document.getElementById("renderFps")?.value || 30);
  const bitrate = +(document.getElementById("renderBitrate")?.value || 16000000);
  const renderStartTime = +(document.getElementById("renderStart")?.value || 0);
  const renderEndTime = +(document.getElementById("renderEnd")?.value || 0);
  

  // 렌더 구간 계산
  const startSec = Math.max(0, renderStartTime);
  const endSec = (renderEndTime > startSec) ? renderEndTime : maxDuration;
  const renderDuration = endSec - startSec;
  const totalFrames = Math.ceil(renderDuration * fps);
  const frameDuration = 1 / fps;

  isRendering = true;
  renderCancelled = false;
  updateExportUI(true);
  modeInfo.textContent = `렌더링 시작 (0/${totalFrames} 프레임)`;
// 해상도 스케일 적용
  // 해상도: 직접 입력값 우선, 없으면 원본
  const origW = bgImg.naturalWidth || 1920;
  const origH = bgImg.naturalHeight || 1080;
  const inputW = +(document.getElementById("renderWidth")?.value || 0);
  const inputH = +(document.getElementById("renderHeight")?.value || 0);
  const renderW = (inputW > 0) ? inputW : origW;
  const renderH = (inputH > 0) ? inputH : origH;
  renderer.setSize(renderW, renderH);
  camera.right = renderW; camera.bottom = renderH;
  camera.updateProjectionMatrix();
  // 모든 비디오 일시정지
  mappingLayers.forEach(layer => {
    if (layer.source && layer.source.tagName === "VIDEO") {
      layer.source.pause();
    }
  });

  // MediaRecorder를 캔버스 스트림에 연결 (수동 프레임 푸시)
  const canvas = renderer.domElement;
  const stream = canvas.captureStream(0); // fps=0: 수동 requestFrame
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
    .find(m => MediaRecorder.isTypeSupported(m)) || "video/webm";
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bitrate
  });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.start();

  // 프레임별 seek → render → capture
  for (let frame = 0; frame < totalFrames; frame++) {
    if (renderCancelled) break;

    const time = startSec + frame * frameDuration;

    // 모든 비디오를 해당 타임으로 seek
    const seekPromises = mappingLayers.map(layer => {
      if (!layer.source || layer.source.tagName !== "VIDEO") return Promise.resolve();
      const targetTime = (time + (layer.offset || 0)) % (layer.source.duration || 1);
      layer.source.currentTime = targetTime;
      return new Promise(resolve => {
        layer.source.onseeked = resolve;
        // 타임아웃 안전장치 (500ms)
        setTimeout(resolve, 500);
      });
    });

    await Promise.all(seekPromises);

    // WebGL 렌더
    updateMappedArea();
    renderer.render(scene, camera);

    // 수동으로 프레임 캡처 신호
    if (stream.getVideoTracks()[0].requestFrame) {
      stream.getVideoTracks()[0].requestFrame();
    }

    // 인코더에 시간 주기 (프레임 간격만큼 대기)
    await new Promise(r => setTimeout(r, 10));

    // 진행률 표시 (10프레임마다)
    if (frame % 10 === 0) {
      const pct = Math.round((frame / totalFrames) * 100);
      modeInfo.textContent = `렌더링 ${pct}% (${frame}/${totalFrames})`;
    }
  }

  // 렌더링 완료 → 파일 저장
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `facade_render_${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
    isRendering = false;
    updateExportUI(false);
    modeInfo.textContent = renderCancelled ? "렌더링 취소됨" : `렌더링 완료 (${totalFrames}프레임, ${maxDuration.toFixed(1)}초)`;
  };
  // 원본 해상도 복원
  // 원본 해상도 복원
  renderer.setSize(origW, origH);
  camera.right = origW; camera.bottom = origH;
  camera.updateProjectionMatrix();
  recorder.stop();
};

window.stopExport = function() {
  if (isRendering) {
    renderCancelled = true;
    modeInfo.textContent = "렌더링 취소 중...";
  }
};

window.exportImage = function() {
  // preserveDrawingBuffer 없이도 toBlob 직전 한 프레임 강제 렌더
  renderer.render(scene, camera);
  renderer.domElement.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `facade_snapshot_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
    modeInfo.textContent = "스냅샷 저장 완료 (.png)";
  }, "image/png");
};

function updateExportUI(recording) {
  const startBtn = document.getElementById("exportStartBtn");
  const stopBtn = document.getElementById("exportStopBtn");
  if (startBtn) startBtn.disabled = recording;
  if (stopBtn) stopBtn.disabled = !recording;
}
// ─────────────────────────────────────────────────────────
}

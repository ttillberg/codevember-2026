import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  ALL_DOOR_STYLES,
  ALL_GABLE_PROFILES,
  ALL_WINDOW_DETAILS,
  ALL_WINDOW_OPEN_MODES,
  ALL_WINDOW_OPENINGS,
  ALL_WINDOW_STYLES,
  ARCHITECTURAL_PAPER_PALETTE,
  MM,
  MODEL_PRESETS,
  buildHouseNet,
  generateHouseSpec,
  type BuiltHouseNet,
  type DoorStyle,
  type FoldablePanelId,
  type GableProfile,
  type HouseMixOptions,
  type HouseNetSpec,
  type NetTopology,
  type RoofType,
  type WindowDetail,
  type WindowOpenMode,
  type WindowOpeningMode,
  type WindowStyle,
} from './origamiHouseNet';
import {
  buildOrigamiHouseRig,
  createOrigamiMaterials,
  type OrigamiHouseRig,
} from './origamiPaperMesh';
import { CatalogThumbRenderer, THUMB_SIZE, type CatalogViewMode } from './catalogThumbRenderer';
import {
  ALL_CITY_STREET_STYLES,
  type CityBuildingPlot,
  type CityLayout,
  type CityStreetStyle,
} from './cityGenerator';
import { CityView } from './cityView';

// URL query parameters
const params = new URLSearchParams(window.location.search);
if (params.has('clean')) {
  document.documentElement.classList.add('clean');
}

// DOM references
const canvas = document.getElementById('c') as HTMLCanvasElement;
const btnNext = document.getElementById('btn-next') as HTMLButtonElement;
const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;
const btnCatalog = document.getElementById('btn-catalog') as HTMLButtonElement;
const btnCity = document.getElementById('btn-city') as HTMLButtonElement;
const btnHelp = document.getElementById('btn-help') as HTMLButtonElement;
const helpModal = document.getElementById('help-modal') as HTMLDivElement;
const helpClose = document.getElementById('help-close') as HTMLButtonElement;
const btnAction = document.getElementById('btn-action') as HTMLButtonElement;
const progressRange = document.getElementById('progress-range') as HTMLInputElement;
const statusEl = document.getElementById('status-label') as HTMLSpanElement;
const btnDebug = document.getElementById('btn-debug') as HTMLButtonElement;
const debugPanel = document.getElementById('debug-panel') as HTMLElement;
const debugClose = document.getElementById('debug-close') as HTMLButtonElement;
const dbgModel = document.getElementById('dbg-model') as HTMLSelectElement;
const dbgHousesGroup = document.getElementById('dbg-houses') as HTMLDivElement;
const dbgHouseBtns = Array.from(dbgHousesGroup.querySelectorAll<HTMLButtonElement>('.debug-seg-btn'));
const dbgTopology = document.getElementById('dbg-topology') as HTMLSelectElement;
const dbgRoof = document.getElementById('dbg-roof') as HTMLSelectElement;
const dbgWindow = document.getElementById('dbg-window') as HTMLSelectElement;
const dbgBays = document.getElementById('dbg-bays') as HTMLSelectElement;
const dbgWinOpening = document.getElementById('dbg-win-opening') as HTMLSelectElement;
const dbgWinDetail = document.getElementById('dbg-win-detail') as HTMLSelectElement;
const dbgWinOpenModeGroup = document.getElementById('dbg-win-open-mode') as HTMLDivElement;
const dbgWinOpenModeBtns = Array.from(dbgWinOpenModeGroup.querySelectorAll<HTMLButtonElement>('.debug-seg-btn'));
const dbgWinOpenRow = document.getElementById('dbg-win-open-row') as HTMLLabelElement;
const dbgWinOpen = document.getElementById('dbg-win-open') as HTMLInputElement;
const dbgWinOpenVal = document.getElementById('dbg-win-open-val') as HTMLElement;
const dbgDoor = document.getElementById('dbg-door') as HTMLSelectElement;
const dbgLevels = document.getElementById('dbg-levels') as HTMLSelectElement;
const dbgConsistency = document.getElementById('dbg-consistency') as HTMLInputElement;
const dbgConsistencyVal = document.getElementById('dbg-consistency-val') as HTMLElement;
const dbgHeight = document.getElementById('dbg-height') as HTMLInputElement;
const dbgHeightVal = document.getElementById('dbg-height-val') as HTMLElement;
const dbgSeed = document.getElementById('dbg-seed') as HTMLInputElement;
const dbgColor = document.getElementById('dbg-color') as HTMLInputElement;
const dbgSpin = document.getElementById('dbg-spin') as HTMLInputElement;
const dbgPerspCut = document.getElementById('dbg-persp-cut') as HTMLInputElement;
const dbgGlideFold = document.getElementById('dbg-glide-fold') as HTMLInputElement;
const dbgFadeProj = document.getElementById('dbg-fade-proj') as HTMLInputElement;
const dbgShuffle = document.getElementById('dbg-shuffle') as HTMLButtonElement;
const dbgOpenCatalog = document.getElementById('dbg-open-catalog') as HTMLButtonElement;
const dbgOpenCity = document.getElementById('dbg-open-city') as HTMLButtonElement;
const dbgResetFactory = document.getElementById('dbg-reset-factory') as HTMLButtonElement;

// Architectural Paper City View DOM references
const cityBar = document.getElementById('city-bar') as HTMLElement;
const citySubtitle = document.getElementById('city-subtitle') as HTMLSpanElement;
const citySeedPrev = document.getElementById('city-seed-prev') as HTMLButtonElement;
const citySeedInput = document.getElementById('city-seed-input') as HTMLInputElement;
const citySeedNext = document.getElementById('city-seed-next') as HTMLButtonElement;
const citySeedRoll = document.getElementById('city-seed-roll') as HTMLButtonElement;
const cityStyleSeg = document.getElementById('city-style-seg') as HTMLDivElement;
const cityStyleBtns = Array.from(cityStyleSeg.querySelectorAll<HTMLButtonElement>('.cat-seg-btn'));
const cityHillsInput = document.getElementById('city-hills') as HTMLInputElement;
const cityHillsVal = document.getElementById('city-hills-val') as HTMLSpanElement;
const cityFoldBtn = document.getElementById('city-fold-btn') as HTMLButtonElement;
const cityColorBtn = document.getElementById('city-color-btn') as HTMLButtonElement;
const cityClose = document.getElementById('city-close') as HTMLButtonElement;
const cityStatus = document.getElementById('city-status') as HTMLDivElement;

// Generations Catalog Grid DOM references
const catalogModal = document.getElementById('catalog-modal') as HTMLDivElement;
const catalogClose = document.getElementById('catalog-close') as HTMLButtonElement;
const catalogBody = document.getElementById('catalog-body') as HTMLDivElement;
const catalogGrid = document.getElementById('catalog-grid') as HTMLDivElement;
const catSentinel = document.getElementById('cat-sentinel') as HTMLDivElement;
const catSubtitle = document.getElementById('cat-subtitle') as HTMLSpanElement;
const catSeedPrev = document.getElementById('cat-seed-prev') as HTMLButtonElement;
const catSeedInput = document.getElementById('cat-seed-input') as HTMLInputElement;
const catSeedNext = document.getElementById('cat-seed-next') as HTMLButtonElement;
const catSeedRoll = document.getElementById('cat-seed-roll') as HTMLButtonElement;
const catSeedCurated = document.getElementById('cat-seed-curated') as HTMLButtonElement;
const catConsistency = document.getElementById('cat-consistency') as HTMLInputElement;
const catConsistencyVal = document.getElementById('cat-consistency-val') as HTMLSpanElement;
const catView3d = document.getElementById('cat-view-3d') as HTMLButtonElement;
const catViewFlat = document.getElementById('cat-view-flat') as HTMLButtonElement;
const catColorBtn = document.getElementById('cat-color-btn') as HTMLButtonElement;

// Populate model presets in debug selector
for (const preset of MODEL_PRESETS) {
  const opt = document.createElement('option');
  opt.value = String(preset.slot);
  opt.textContent = `${preset.slot}. ${preset.label}`;
  dbgModel.appendChild(opt);
}

// Minimal line icons (top-right buttons & bottom-right dev workbench gear)
const ICON_PLAY = `<svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>`;
const ICON_RESET = `<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`;
const ICON_GRID = `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/></svg>`;
const ICON_CITY = `<svg viewBox="0 0 24 24"><path d="M3 20h18"/><path d="M5 20V10l4-3 4 3v10"/><path d="M13 20V8l3-2.5L19 8v12"/><path d="M8.5 14h1"/><path d="M15.5 12h1"/></svg>`;
const ICON_GEAR = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
btnNext.innerHTML = ICON_PLAY;
btnReset.innerHTML = ICON_RESET;
btnCatalog.innerHTML = ICON_GRID;
btnCity.innerHTML = ICON_CITY;
btnDebug.innerHTML = ICON_GEAR;

const SETTINGS_STORAGE_KEY = 'codevember-2026:01:settings:v1';

const VALID_TOPOLOGIES: readonly NetTopology[] = ['cross', 'ribbon', 'hex', 'oct', 'lwing', 'setback', 'village'];
const VALID_ROOFS: readonly RoofType[] = ['gable', 'mansard', 'spire', 'hip', 'shed', 'flat', 'butterfly', 'sawtooth'];

interface DebugSettings {
  model: number | null;
  houses: 1 | 2 | 3 | 4 | null;
  topology: NetTopology | null;
  roof: RoofType | null;
  gableProfile: GableProfile | null;
  windowStyle: WindowStyle | null;
  windowOpening: WindowOpeningMode | null;
  windowDetail: WindowDetail | null;
  windowOpenMode: WindowOpenMode;
  windowOpen: number;
  windowCount: number | null;
  doorStyle: DoorStyle | null;
  levels: 1 | 2 | 3 | null;
  heightScale: number | null;
  consistency: number | null;
  seed: number;
  color: boolean;
  spin: boolean;
  perspectiveCut: boolean;
  glideOnFold: boolean;
  fadeProjOnFold: boolean;
}

const FACTORY_SETTINGS: DebugSettings = {
  model: null,
  houses: null,
  topology: null,
  roof: null,
  gableProfile: null,
  windowStyle: null,
  windowOpening: null,
  windowDetail: null,
  windowOpenMode: 'random',
  windowOpen: 0.35,
  windowCount: null,
  doorStyle: null,
  levels: null,
  heightScale: null,
  consistency: null,
  seed: 0,
  color: false,
  spin: true,
  perspectiveCut: false,
  glideOnFold: false,
  fadeProjOnFold: true,
};

function loadSavedSettings(): DebugSettings {
  const s: DebugSettings = { ...FACTORY_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DebugSettings>;
      if (parsed.model === null) {
        s.model = null;
      } else if (typeof parsed.model === 'number' && Number.isFinite(parsed.model)) {
        s.model = Math.max(1, Math.min(MODEL_PRESETS.length, Math.round(parsed.model)));
      }
      if (parsed.houses === null || parsed.houses === 1 || parsed.houses === 2 || parsed.houses === 3 || parsed.houses === 4) {
        s.houses = parsed.houses;
      }
      if (parsed.topology === null || (typeof parsed.topology === 'string' && VALID_TOPOLOGIES.includes(parsed.topology as NetTopology))) {
        s.topology = parsed.topology as NetTopology | null;
      }
      if (parsed.roof === null || (typeof parsed.roof === 'string' && VALID_ROOFS.includes(parsed.roof as RoofType))) {
        s.roof = parsed.roof as RoofType | null;
      }
      if (parsed.gableProfile === null || (typeof parsed.gableProfile === 'string' && ALL_GABLE_PROFILES.includes(parsed.gableProfile as GableProfile))) {
        s.gableProfile = parsed.gableProfile as GableProfile | null;
      }
      if (parsed.windowStyle === null || (typeof parsed.windowStyle === 'string' && ALL_WINDOW_STYLES.includes(parsed.windowStyle as WindowStyle))) {
        s.windowStyle = parsed.windowStyle as WindowStyle | null;
      }
      if (parsed.windowOpening === null || (typeof parsed.windowOpening === 'string' && ALL_WINDOW_OPENINGS.includes(parsed.windowOpening as WindowOpeningMode))) {
        s.windowOpening = parsed.windowOpening as WindowOpeningMode | null;
      }
      if (parsed.windowDetail === null || (typeof parsed.windowDetail === 'string' && ALL_WINDOW_DETAILS.includes(parsed.windowDetail as WindowDetail))) {
        s.windowDetail = parsed.windowDetail as WindowDetail | null;
      }
      if (typeof parsed.windowOpenMode === 'string' && ALL_WINDOW_OPEN_MODES.includes(parsed.windowOpenMode as WindowOpenMode)) {
        s.windowOpenMode = parsed.windowOpenMode as WindowOpenMode;
      }
      if (typeof parsed.windowOpen === 'number' && Number.isFinite(parsed.windowOpen)) {
        s.windowOpen = Math.max(0, Math.min(1, parsed.windowOpen));
      }
      if (parsed.windowCount === null) {
        s.windowCount = null;
      } else if (typeof parsed.windowCount === 'number' && Number.isFinite(parsed.windowCount)) {
        s.windowCount = Math.max(1, Math.min(5, Math.round(parsed.windowCount)));
      }
      if (parsed.doorStyle === null || (typeof parsed.doorStyle === 'string' && ALL_DOOR_STYLES.includes(parsed.doorStyle as DoorStyle))) {
        s.doorStyle = parsed.doorStyle as DoorStyle | null;
      }
      if (parsed.levels === null || parsed.levels === 1 || parsed.levels === 2 || parsed.levels === 3) {
        s.levels = parsed.levels;
      }
      if (parsed.heightScale === null) {
        s.heightScale = null;
      } else if (typeof parsed.heightScale === 'number' && Number.isFinite(parsed.heightScale)) {
        s.heightScale = Math.max(0.75, Math.min(1.30, parsed.heightScale));
      }
      if (parsed.consistency === null) {
        s.consistency = null;
      } else if (typeof parsed.consistency === 'number' && Number.isFinite(parsed.consistency)) {
        s.consistency = Math.max(0, Math.min(1, parsed.consistency));
      }
      if (typeof parsed.seed === 'number' && Number.isFinite(parsed.seed) && parsed.seed >= 0) {
        s.seed = Math.min(99999, Math.round(parsed.seed));
      }
      if (typeof parsed.color === 'boolean') s.color = parsed.color;
      if (typeof parsed.spin === 'boolean') s.spin = parsed.spin;
      if (typeof parsed.perspectiveCut === 'boolean') s.perspectiveCut = parsed.perspectiveCut;
      if (typeof parsed.glideOnFold === 'boolean') s.glideOnFold = parsed.glideOnFold;
      if (typeof parsed.fadeProjOnFold === 'boolean') s.fadeProjOnFold = parsed.fadeProjOnFold;
    }
  } catch {
    // Ignore storage access errors (private mode, restricted iframe, etc.)
  }
  return s;
}

const initialSettings = loadSavedSettings();
const showDebugTrigger = import.meta.env.DEV || params.has('settings') || params.has('debug');
btnDebug.hidden = !showDebugTrigger;

// URL query parameters override stored settings for clean captures / links without mutating storage
let forcedModelSlot: number | null =
  params.get('model') !== null
    ? Math.max(1, Math.min(MODEL_PRESETS.length, Number(params.get('model')) || 1))
    : initialSettings.model;
const pHouses = params.get('houses');
let mixHouses: 1 | 2 | 3 | 4 | null =
  pHouses !== null && ['1', '2', '3', '4'].includes(pHouses)
    ? (Number(pHouses) as 1 | 2 | 3 | 4)
    : initialSettings.houses;
const pTopo = params.get('topology');
let mixTopology: NetTopology | null =
  pTopo !== null && VALID_TOPOLOGIES.includes(pTopo as NetTopology)
    ? (pTopo as NetTopology)
    : initialSettings.topology;
const pRoof = params.get('roof');
let mixRoof: RoofType | null =
  pRoof !== null && VALID_ROOFS.includes(pRoof as RoofType) ? (pRoof as RoofType) : initialSettings.roof;
const pGable = params.get('gable');
let mixGableProfile: GableProfile | null =
  pGable !== null && ALL_GABLE_PROFILES.includes(pGable as GableProfile)
    ? (pGable as GableProfile)
    : initialSettings.gableProfile;
if (mixGableProfile && !mixRoof) mixRoof = 'gable';
const pWin = params.get('window');
let mixWindow: WindowStyle | null =
  pWin !== null && ALL_WINDOW_STYLES.includes(pWin as WindowStyle) ? (pWin as WindowStyle) : initialSettings.windowStyle;
const pWinOpening = params.get('winHinge');
let mixWinOpening: WindowOpeningMode | null =
  pWinOpening !== null && ALL_WINDOW_OPENINGS.includes(pWinOpening as WindowOpeningMode)
    ? (pWinOpening as WindowOpeningMode)
    : initialSettings.windowOpening;
const pWinDetail = params.get('winDetail');
let mixWinDetail: WindowDetail | null =
  pWinDetail !== null && ALL_WINDOW_DETAILS.includes(pWinDetail as WindowDetail)
    ? (pWinDetail as WindowDetail)
    : initialSettings.windowDetail;
const pWinOpenMode = params.get('winOpenMode');
let mixWinOpenMode: WindowOpenMode =
  pWinOpenMode !== null && ALL_WINDOW_OPEN_MODES.includes(pWinOpenMode as WindowOpenMode)
    ? (pWinOpenMode as WindowOpenMode)
    : initialSettings.windowOpenMode;
const pWinOpen = params.get('winOpen');
let mixWinOpen =
  pWinOpen !== null && Number.isFinite(Number(pWinOpen))
    ? Math.max(0, Math.min(1, Number(pWinOpen)))
    : initialSettings.windowOpen;
const pBays = params.get('bays');
let mixBays: number | null =
  pBays !== null && Number.isFinite(Number(pBays))
    ? Math.max(1, Math.min(5, Math.round(Number(pBays))))
    : initialSettings.windowCount;
const pDoor = params.get('door');
let mixDoor: DoorStyle | null =
  pDoor !== null && ALL_DOOR_STYLES.includes(pDoor as DoorStyle) ? (pDoor as DoorStyle) : initialSettings.doorStyle;
const pLevels = params.get('levels');
let mixLevels: 1 | 2 | 3 | null =
  pLevels !== null && ['1', '2', '3'].includes(pLevels)
    ? (Number(pLevels) as 1 | 2 | 3)
    : initialSettings.levels;
const pHeight = params.get('height');
let mixHeightScale: number | null =
  pHeight !== null && Number.isFinite(Number(pHeight))
    ? Math.max(0.75, Math.min(1.30, Number(pHeight)))
    : initialSettings.heightScale;
const pConsistency = params.get('consistency');
let mixConsistency: number | null =
  pConsistency !== null && Number.isFinite(Number(pConsistency))
    ? Math.max(0, Math.min(1, Number(pConsistency)))
    : initialSettings.consistency;
let mixSeed = params.get('seed') !== null ? Math.max(0, Math.min(99999, Math.round(Number(params.get('seed')) || 0))) : initialSettings.seed;
let debugColorEnabled =
  params.get('color') !== null ? params.get('color') !== '0' : initialSettings.color;
let debugSpinEnabled =
  params.get('spin') !== null ? params.get('spin') !== '0' : initialSettings.spin;
let debugPerspCutEnabled =
  params.get('perspCut') !== null ? params.get('perspCut') !== '0' : initialSettings.perspectiveCut;
let debugGlideOnFoldEnabled =
  params.get('glide') !== null
    ? params.get('glide') !== '0'
    : params.get('shiftView') !== null
      ? params.get('shiftView') === '1'
      : initialSettings.glideOnFold;
let debugFadeProjEnabled =
  params.get('fadePrint') !== null
    ? params.get('fadePrint') !== '0'
    : initialSettings.fadeProjOnFold;

function computeProjectionFade(fold01: number): number {
  if (!debugFadeProjEnabled) return 1;
  if (fold01 <= 0.5) return 1;
  const u = Math.max(0, Math.min(1, (fold01 - 0.5) / 0.5));
  return 1 - u * u * (3 - 2 * u);
}

function getCurrentMixOptions(): HouseMixOptions {
  return {
    slot: forcedModelSlot,
    houses: mixHouses,
    topology: mixTopology,
    roofType: mixRoof,
    gableProfile: mixGableProfile,
    windowStyle: mixWindow,
    windowOpening: mixWinOpening,
    windowDetail: mixWinDetail,
    windowCount: mixBays,
    doorStyle: mixDoor,
    levels: mixLevels,
    heightScale: mixHeightScale,
    consistency: mixConsistency,
    seed: mixSeed,
  };
}

function getMixCacheKey(): string {
  const cKey = mixConsistency === null ? 'd' : Math.round(mixConsistency * 100);
  const hKey = mixHeightScale === null ? 'd' : Math.round(mixHeightScale * 100);
  return `${forcedModelSlot ?? 'a'}|${mixHouses ?? 'a'}|${mixTopology ?? 'a'}|${mixRoof ?? 'a'}|${mixGableProfile ?? 'a'}|${mixWindow ?? 'a'}|${mixWinOpening ?? 'a'}|${mixWinDetail ?? 'a'}|${mixBays ?? 'a'}|${mixDoor ?? 'a'}|${mixLevels ?? 'a'}|${hKey}|${cKey}|${mixSeed}`;
}

function syncDebugControls(): void {
  dbgModel.value = forcedModelSlot ? String(forcedModelSlot) : 'auto';
  const activeHouses = mixHouses ? String(mixHouses) : 'auto';
  for (const btn of dbgHouseBtns) {
    btn.classList.toggle('active', btn.dataset.houses === activeHouses);
  }
  dbgTopology.value = mixTopology ?? 'auto';
  dbgRoof.value =
    mixRoof === 'gable' && mixGableProfile ? `gable:${mixGableProfile}` : (mixRoof ?? 'auto');
  dbgWindow.value = mixWindow ?? 'auto';
  dbgWinOpening.value = mixWinOpening ?? 'auto';
  dbgWinDetail.value = mixWinDetail ?? 'auto';
  for (const btn of dbgWinOpenModeBtns) {
    btn.classList.toggle('active', btn.dataset.openMode === mixWinOpenMode);
  }
  const woPct = Math.round(mixWinOpen * 100);
  dbgWinOpen.value = String(woPct);
  dbgWinOpenVal.textContent =
    mixWinOpenMode === 'closed' ? '0%' : mixWinOpenMode === 'open' ? '100%' : `${woPct}%`;
  dbgWinOpenRow.classList.toggle('is-muted', mixWinOpenMode !== 'random');
  dbgBays.value = mixBays ? String(mixBays) : 'auto';
  dbgDoor.value = mixDoor ?? 'auto';
  dbgLevels.value = mixLevels ? String(mixLevels) : 'auto';
  const cPct = Math.round((mixConsistency ?? 0.72) * 100);
  dbgConsistency.value = String(cPct);
  dbgConsistencyVal.textContent = `${cPct}%`;
  catConsistency.value = String(cPct);
  catConsistencyVal.textContent = `${cPct}%`;
  const hPct = Math.round((mixHeightScale ?? 1.0) * 100);
  dbgHeight.value = String(hPct);
  dbgHeightVal.textContent = `${hPct}%`;
  dbgSeed.value = String(mixSeed);
  catSeedInput.value = String(mixSeed);
  catSeedCurated.hidden = mixSeed === 0;
  dbgColor.checked = debugColorEnabled;
  catColorBtn.setAttribute('aria-pressed', debugColorEnabled ? 'true' : 'false');
  dbgSpin.checked = debugSpinEnabled;
  dbgPerspCut.checked = debugPerspCutEnabled;
  dbgGlideFold.checked = debugGlideOnFoldEnabled;
  dbgFadeProj.checked = debugFadeProjEnabled;
}

function saveDebugSettings(): void {
  try {
    const payload: DebugSettings = {
      model: forcedModelSlot,
      houses: mixHouses,
      topology: mixTopology,
      roof: mixRoof,
      gableProfile: mixGableProfile,
      windowStyle: mixWindow,
      windowOpening: mixWinOpening,
      windowDetail: mixWinDetail,
      windowOpenMode: mixWinOpenMode,
      windowOpen: mixWinOpen,
      windowCount: mixBays,
      doorStyle: mixDoor,
      levels: mixLevels,
      heightScale: mixHeightScale,
      consistency: mixConsistency,
      seed: mixSeed,
      color: debugColorEnabled,
      spin: debugSpinEnabled,
      perspectiveCut: debugPerspCutEnabled,
      glideOnFold: debugGlideOnFoldEnabled,
      fadeProjOnFold: debugFadeProjEnabled,
    };
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage write errors
  }
}

syncDebugControls();

// Renderer (pure white-on-white gallery daylight: paper & ground melt seamlessly, only minimal ridge shadows!)
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Seamless white-on-white studio backdrop & fog matched to lit horizontal white paper luminance!
const BACKDROP = '#f5f4f0';
const scene = new THREE.Scene();
scene.background = new THREE.Color(BACKDROP);
const studioFog = new THREE.Fog(BACKDROP, 52, 134);
scene.fog = studioFog;

const pmrem = new THREE.PMREMGenerator(renderer);
const sharedEnvTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = sharedEnvTexture;
scene.environmentIntensity = 0.08;

// Telephoto architectural model camera (FOV 28°, generous far plane for zoomed-out large houses!)
const camera = new THREE.PerspectiveCamera(28, 1, 0.3, 650);

// Pure luminous white-on-white gallery lighting: high-noon sun (~72° elevation) avoids long cast shadows
// while matching horizontal white paper warmth 1:1 with the #f5f4f0 studio backdrop!
const hemi = new THREE.HemisphereLight('#fffdf8', '#e0ddd6', 1.50);
scene.add(hemi);

const SUN_DIR_COLOR = new THREE.Vector3(5.8, 21.0, 3.6).normalize();
const SUN_DIR_WHITE = new THREE.Vector3(10.5, 19.0, 8.2).normalize();
const sunDirActive = SUN_DIR_COLOR.clone();
const sun = new THREE.DirectionalLight('#fffdf9', 1.18);
sun.position.copy(sunDirActive).multiplyScalar(28);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 2;
sun.shadow.camera.far = 72;
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 14;
sun.shadow.camera.bottom = -14;
sun.shadow.bias = -0.00018;
sun.shadow.normalBias = 0.016;
sun.shadow.radius = 2.8;
scene.add(sun);

const fill = new THREE.DirectionalLight('#f8f7f2', 0.24);
fill.position.set(-14, 9, -10);
scene.add(fill);

// Build duplex pastel/white paper materials for the floating pre-cut nets & falling cutout sheets!
// No static ground floor — the open #f5f4f0 studio void lets each cutout sheet fall freely downward!
const materials = createOrigamiMaterials(renderer.capabilities.getMaxAnisotropy());

let curShadowExtent = 14;
let swapShadowExtent = 14;
let finalShadowExtent = 14;

function applyShadowFrustum(extent: number): void {
  const e = Math.max(14, extent);
  const sunDist = Math.max(28, e * 1.75);
  sun.position.copy(sunDirActive).multiplyScalar(sunDist);
  sun.shadow.camera.left = -e;
  sun.shadow.camera.right = e;
  sun.shadow.camera.top = e;
  sun.shadow.camera.bottom = -e;
  sun.shadow.camera.near = Math.max(2, sunDist - e * 2.2);
  sun.shadow.camera.far = sunDist + e * 2.6;
  sun.shadow.normalBias = 0.016 * (e / 14);
  sun.shadow.camera.updateProjectionMatrix();
}
applyShadowFrustum(curShadowExtent);

// ----------------------------------------------------------------------------
// Camera Orbit & Dynamic Final-Stage Zoom-Out Framing
// ----------------------------------------------------------------------------
const BASE_LOOK_Y = 1.2;
const defaultYaw = params.get('yaw') !== null ? Number(params.get('yaw')) : 0.44;
const defaultPitch = params.get('pitch') !== null ? Number(params.get('pitch')) : 0.60;
const defaultDist = params.get('dist') !== null ? Number(params.get('dist')) : 42.0;

let targetYaw = defaultYaw;
let targetPitch = defaultPitch;
let targetDist = defaultDist;
let targetLookY = BASE_LOOK_Y;

let curYaw = targetYaw;
let curPitch = targetPitch;
let curDist = targetDist;
let curLookY = targetLookY;

// Locked at the exact swap frame so 1:1 projection NEVER shifts; zooms smoothly as we approach final stage!
let swapDist = defaultDist;
let swapLookY = BASE_LOOK_Y;
let finalDist = defaultDist;
let finalLookY = BASE_LOOK_Y;
let userZoomDelta = 0;

// Optional per-slide camera shift & instant perspective jump-cut on projection
let slideYawDelta = 0;
let slidePitchDelta = 0;
let prevSlideEase = 0;
const AUTO_SPIN_RAD_PER_SEC = 0.11;

function computeHeroElevation(net: BuiltHouseNet): { yawOffsetFromCut: number; targetPitch: number } {
  const { generation: g, topology, roofType } = net.spec;
  // Layer 1 folds straight into an iconic architectural Front View; subsequent houses alternate
  // contrasting low front / oblique / tower hero elevations so every aerial jump-cut feels bold!
  if (g <= 1) {
    return { yawOffsetFromCut: 0.12 - curYaw, targetPitch: 0.22 };
  }
  const sign = g % 2 === 0 ? -1 : 1;
  const isTall = topology === 'setback' || topology === 'oct' || roofType === 'spire';
  const isRoofShowcase =
    topology === 'village' || roofType === 'sawtooth' || roofType === 'butterfly' || topology === 'lwing';
  const targetPitch = isTall
    ? 0.20 + ((g * 7) % 3) * 0.04
    : topology === 'village'
      ? 0.42
      : isRoofShowcase
        ? 0.34 + ((g * 11) % 3) * 0.04
        : 0.22 + ((g * 13) % 3) * 0.04;
  const yawOffsetFromCut = sign * (0.58 + ((g * 17) % 4) * 0.12);
  return { yawOffsetFromCut, targetPitch };
}

function computeProjectionAerialView(net: BuiltHouseNet): { toYaw: number; toPitch: number; toDist: number } {
  // Snap directly to a high Above-3/4 aerial vantage (`~48°`) & jump yaw across the diagonal
  // at the exact moment of projection!
  const g = net.spec.generation;
  const yawDir = g % 2 === 1 ? 1 : -1;
  const toYaw = curYaw + yawDir * (0.76 + ((g * 19) % 3) * 0.10);
  const toPitch = 0.84;
  const ideal = computeIdealFraming(net);
  const toDist = Math.max(curDist, ideal.dist * 1.04);
  return { toYaw, toPitch, toDist };
}

function computeSlideViewShift(net: BuiltHouseNet): { yawDelta: number; targetPitch: number } {
  const { generation: g, topology, roofType } = net.spec;
  // Alternate dramatic left/right orbital sweeps across consecutive slides
  const yawSign = g % 2 === 0 ? 1 : -1;
  const yawMag = 0.68 + ((g * 37) % 5) * 0.11;
  // Lower heroic pitch for soaring spires & stepped towers; higher axonometric pitch for roofs & L-wings
  const isTall = topology === 'setback' || topology === 'oct' || roofType === 'spire';
  const isRoofShowcase = roofType === 'sawtooth' || roofType === 'butterfly' || topology === 'lwing';
  const targetPitch = isTall
    ? 0.44 + ((g * 19) % 3) * 0.04
    : isRoofShowcase
      ? 0.68 + ((g * 13) % 3) * 0.05
      : 0.54 + ((g * 23) % 4) * 0.05;
  return { yawDelta: yawSign * yawMag, targetPitch };
}

function computeIdealFraming(net: BuiltHouseNet): { dist: number; lookY: number; shadowExtent: number } {
  const sheetHalfW = net.sheetHalfMm * MM;
  const hWorld = net.foldedHeightMm * MM;
  const rWorld = net.foldedRadiusMm * MM;
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  const aspect = Math.max(0.65, Math.min(camera.aspect || 1.6, 1.38));
  const tanH = tanV * aspect;

  // Keep the same calm zoomed-out gallery margin (~24% screen height of the FOLDED 3D house) at ANY scale!
  // Multi-house villages get slightly closer framing (`0.33`) so all 3–4 miniature buildings read crisply!
  const widthFill = net.spec.topology === 'village' ? 0.33 : 0.25;
  const distForHeight = hWorld / (0.24 * 2 * tanV);
  const distForWidth = rWorld / (widthFill * tanH);
  const dist = Math.max(defaultDist, distForHeight, distForWidth);
  const lookY = Math.max(BASE_LOOK_Y, (hWorld - 0.6) * 0.30);
  // Noon sun casts tight, short shadows (~0.32x height), allowing an even crisper shadow frustum!
  const shadowExtent = Math.max(14, sheetHalfW * 1.35, rWorld + hWorld * 0.90);

  return { dist, lookY, shadowExtent };
}

function syncCameraFromOrbit(): void {
  camera.position.set(
    curDist * Math.cos(curPitch) * Math.sin(curYaw),
    curLookY + curDist * Math.sin(curPitch),
    curDist * Math.cos(curPitch) * Math.cos(curYaw),
  );
  camera.lookAt(0, curLookY, 0);

  // Keep white-on-white studio fog scaled strictly from `curDist` so big zoomed-out houses stay crisp
  // and fog NEVER shifts on the exact swap frame!
  studioFog.near = Math.max(44, curDist * 1.25);
  studioFog.far = Math.max(120, curDist * 3.15);
}

// ----------------------------------------------------------------------------
// Dynamic House Rig + Per-Panel Fold State
// ----------------------------------------------------------------------------
interface PanelState {
  fold: number;
  target: number;
  startFold: number;
  animElapsed: number;
  animDuration: number;
  animating: boolean;
  peek: number;
  delay: number;
}

let generation = 1;
let rig: OrigamiHouseRig;
let preparedNext: { generation: number; mixKey: string; rig: OrigamiHouseRig } | null = null;
let prepareTimerId: number | null = null;
const panelState = new Map<FoldablePanelId, PanelState>();
let hoveredPanel: FoldablePanelId | null = null;
let isScrubbing = false;
let justProjected = false;
let curPaperRelief = 1;
let targetPaperRelief = 1;
let cutoutDropState: 'none' | 'waiting' | 'falling' | 'done' = 'none';
let cutoutDropElapsed = 0;

function clearPreparedNext(): void {
  if (prepareTimerId !== null) {
    window.clearTimeout(prepareTimerId);
    prepareTimerId = null;
  }
  if (preparedNext) {
    preparedNext.rig.dispose();
    preparedNext = null;
  }
}

/**
 * Pre-build the next generation's complete flat-net + cutout + punched window chad rig ahead of time!
 * Because `aFlatPos` depends only on the house's own flat geometry (not the live camera angle),
 * pre-building removes ALL synchronous `ExtrudeGeometry` / earcut CPU work from the JIT cut frame!
 */
function prepareNextGenerationNow(gen: number): OrigamiHouseRig {
  const mixKey = getMixCacheKey();
  if (preparedNext && preparedNext.generation === gen && preparedNext.mixKey === mixKey) {
    return preparedNext.rig;
  }
  clearPreparedNext();
  const spec = generateHouseSpec(gen, getCurrentMixOptions());
  const net = buildHouseNet(spec);
  const nextRig = buildOrigamiHouseRig(net, materials, true);
  preparedNext = { generation: gen, mixKey, rig: nextRig };
  return nextRig;
}

function schedulePrepareNext(gen: number, delayMs = 90): void {
  const mixKey = getMixCacheKey();
  if (preparedNext && preparedNext.generation === gen && preparedNext.mixKey === mixKey) return;
  if (prepareTimerId !== null) window.clearTimeout(prepareTimerId);
  prepareTimerId = window.setTimeout(() => {
    prepareTimerId = null;
    if (cutoutDropState === 'falling') {
      schedulePrepareNext(gen, 220);
      return;
    }
    prepareNextGenerationNow(gen);
  }, delayMs);
}

function applyActiveOutsideColor(): void {
  if (!rig) return;
  if (debugColorEnabled) {
    if (rig.net.spec.topology === 'village') {
      const baseIdx = Math.max(0, ARCHITECTURAL_PAPER_PALETTE.indexOf(rig.net.spec.outsideColor));
      const len = ARCHITECTURAL_PAPER_PALETTE.length;
      materials.setOutsideColors([
        ARCHITECTURAL_PAPER_PALETTE[baseIdx % len],
        ARCHITECTURAL_PAPER_PALETTE[(baseIdx + 2) % len],
        ARCHITECTURAL_PAPER_PALETTE[(baseIdx + 5) % len],
        ARCHITECTURAL_PAPER_PALETTE[(baseIdx + 3) % len],
      ]);
    } else {
      materials.setOutsideColor(rig.net.spec.outsideColor);
    }
    materials.edge.color.set('#fbfaf7');
    materials.projUniforms.uProjGain.value = 1.0;
    sunDirActive.copy(SUN_DIR_COLOR);
    hemi.color.set('#fffdf8');
    hemi.groundColor.set('#e0ddd6');
    hemi.intensity = 1.50;
    sun.color.set('#fffdf9');
    sun.intensity = 1.18;
    fill.color.set('#f8f7f2');
    fill.intensity = 0.24;
    renderer.toneMappingExposure = 1.02;
  } else {
    // Same warm ivory "white" as the #f5f4f0 studio paper backdrop: sunlit roofs match #f5f4f0
    // seamlessly while raking 56° gallery sun carves warm ivory sculptural planes & shadows!
    materials.setOutsideColor('#f5f4f0');
    materials.edge.color.set('#f8f7f3');
    materials.projUniforms.uProjGain.value = 0.86;
    sunDirActive.copy(SUN_DIR_WHITE);
    hemi.color.set('#fffef9');
    hemi.groundColor.set('#dfd9ce');
    hemi.intensity = 1.78;
    sun.color.set('#fffdf6');
    sun.intensity = 2.05;
    fill.color.set('#f5f4f0');
    fill.intensity = 0.28;
    renderer.toneMappingExposure = 1.08;
  }
  applyShadowFrustum(curShadowExtent);
}

function mountHouseGeneration(gen: number, fromSwap = false): void {
  if (rig) {
    scene.remove(rig.root);
    rig.dispose();
  }
  const mixKey = getMixCacheKey();
  if (fromSwap && preparedNext && preparedNext.generation === gen && preparedNext.mixKey === mixKey) {
    rig = preparedNext.rig;
    preparedNext = null;
  } else {
    const spec = generateHouseSpec(gen, getCurrentMixOptions());
    const net = buildHouseNet(spec);
    rig = buildOrigamiHouseRig(net, materials, fromSwap);
  }
  applyActiveOutsideColor();
  rig.setWindowOpen(mixWinOpenMode, mixWinOpen);
  const net = rig.net;
  scene.add(rig.root);

  panelState.clear();
  for (const id of rig.panelIds) {
    panelState.set(id, {
      fold: 0,
      target: 0,
      startFold: 0,
      animElapsed: 0,
      animDuration: 0,
      animating: false,
      peek: 0,
      delay: 0,
    });
    rig.updatePanelVisual(id, 0, 0, false);
  }
  hoveredPanel = null;

  const ideal = computeIdealFraming(net);
  if (fromSwap) {
    // Freeze exact camera, shadow anchor, and flat relief on JIT swap so the 1:1 projection has ZERO transition!
    // The complementary outer sheet & punched chads sit flush until triggered to cut out & fall!
    rig.setFoldLinesVisible(false);
    curPaperRelief = 0;
    targetPaperRelief = 0;
    rig.setPaperRelief(0);
    cutoutDropState = rig.hasCutout ? 'waiting' : 'none';
    cutoutDropElapsed = 0;
    if (rig.hasCutout) rig.updateCutoutDrop(0);

    swapDist = curDist;
    swapLookY = curLookY;
    finalDist = ideal.dist;
    finalLookY = ideal.lookY;
    userZoomDelta = 0;
    targetDist = curDist;
    targetLookY = curLookY;

    swapShadowExtent = curShadowExtent;
    finalShadowExtent = ideal.shadowExtent;

    if (debugPerspCutEnabled) {
      const hero = computeHeroElevation(net);
      slideYawDelta = hero.yawOffsetFromCut;
      slidePitchDelta = hero.targetPitch - targetPitch;
    } else {
      const shift = computeSlideViewShift(net);
      slideYawDelta = shift.yawDelta;
      slidePitchDelta = shift.targetPitch - targetPitch;
    }
    prevSlideEase = 0;
  } else {
    curPaperRelief = 1;
    targetPaperRelief = 1;
    rig.setPaperRelief(1);
    cutoutDropState = 'none';
    cutoutDropElapsed = 0;

    swapDist = defaultDist;
    swapLookY = BASE_LOOK_Y;
    finalDist = ideal.dist;
    finalLookY = ideal.lookY;
    userZoomDelta = 0;
    targetDist = curDist = defaultDist;
    targetLookY = curLookY = BASE_LOOK_Y;

    curShadowExtent = swapShadowExtent = finalShadowExtent = ideal.shadowExtent;
    applyShadowFrustum(curShadowExtent);

    if (gen <= 1) {
      // On Layer 1 initial fold (when `Glide on fold` is enabled), glide smoothly from 3/4 into crisp Front View!
      const hero = computeHeroElevation(net);
      slideYawDelta = hero.yawOffsetFromCut;
      slidePitchDelta = hero.targetPitch - defaultPitch;
    } else {
      slideYawDelta = 0;
      slidePitchDelta = 0;
    }
    prevSlideEase = 0;
  }
}

mountHouseGeneration(1, false);

// ----------------------------------------------------------------------------
// Zero-Transition Live-Camera GPU Projection (Ping-Pong HalfFloat RenderTargets!)
// ----------------------------------------------------------------------------
function makeProjTarget(w: number, h: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: true,
    samples: 4,
  });
  rt.texture.wrapS = THREE.ClampToEdgeWrapping;
  rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  return rt;
}

let rtA = makeProjTarget(2, 2);
let rtB = makeProjTarget(2, 2);
let activeRTIndex: 0 | 1 = 0;
const snapVP = new THREE.Matrix4();

function ensureProjTargetsSized(): { tw: number; th: number } {
  const drawSize = new THREE.Vector2();
  renderer.getDrawingBufferSize(drawSize);
  const tw = Math.max(2, Math.round(drawSize.x));
  const th = Math.max(2, Math.round(drawSize.y));
  if (rtA.width !== tw || rtA.height !== th) {
    rtA.dispose();
    rtA = makeProjTarget(tw, th);
  }
  if (rtB.width !== tw || rtB.height !== th) {
    rtB.dispose();
    rtB = makeProjTarget(tw, th);
  }
  return { tw, th };
}

/**
 * Upfront GPU & geometry warmup run once at startup (before first composite):
 * 1. Allocates & warms BOTH 4x-MSAA HalfFloat ping-pong FBOs at exact drawing-buffer resolution.
 * 2. Pre-builds Gen 2 (with full silhouette-clipped cutout + punched window chads) and renders
 *    one microscopic hidden frame to BOTH the HalfFloat FBO and the main canvas swapchain so
 *    WebGL/Metal compiles all 9 material pipelines & uploads Gen 2 VBOs upfront — zero first-cut hitch!
 */
function warmupCutoutPipeline(): void {
  ensureProjTargetsSized();
  syncCameraFromOrbit();
  camera.updateMatrixWorld(true);
  rig.root.updateMatrixWorld(true);

  const nextRig = prepareNextGenerationNow(generation + 1);
  snapVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

  const prevToneMapping = renderer.toneMapping;
  const prevTarget = renderer.getRenderTarget();

  // 1. Warm BOTH 4x-MSAA HalfFloat FBOs + resolve blit pipelines
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rtA);
  renderer.render(scene, camera);
  renderer.setRenderTarget(rtB);
  renderer.render(scene, camera);
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevToneMapping;

  // 2. Warm ALL 9 material pipelines (cutout clip-tint, clip-mask, chads, paper reveal) on the main canvas
  //    in both full-opacity (`depthWrite = true`) and fading (`depthWrite = false`) states using a microscopic
  //    temporary pass (immediately overwritten by the clean Gen 1 frame before paint!)
  nextRig.root.scale.set(0.0005, 0.0005, 0.0005);
  nextRig.setFoldLinesVisible(false);
  nextRig.updateCutoutDrop(0);
  scene.add(nextRig.root);
  materials.setProjection(rtA.texture, snapVP);
  materials.projUniforms.uPaperReveal.value = 0;

  renderer.render(scene, camera);
  materials.setCutoutOpacity(0.5);
  renderer.render(scene, camera);

  // 3. Cleanly restore Gen 1 state while keeping `nextRig` hot & ready in `preparedNext`!
  scene.remove(nextRig.root);
  nextRig.root.scale.set(1, 1, 1);
  nextRig.setPaperRelief(1);
  materials.setProjection(null);
  materials.setCutoutOpacity(1);
  rig.setPaperRelief(curPaperRelief);
  renderer.render(scene, camera);
}

/**
 * Just-In-Time (JIT) 1:1 camera projection:
 * Captures the EXACT current 3D view (`Camera A`) into the inactive ping-pong HalfFloat render target.
 * When `jumpToAerial` (`Jump view`) is active, immediately teleports the camera to `Camera B` (high
 * Above 3/4) and computes `snapVP` from `Camera B` while keeping `Camera A`'s texture — so at `t = 0`
 * NOTHING changes to the user's eyes (exact Front View pixel-for-pixel!), yet the 3D perspective has
 * secretly jumped to Above 3/4, causing the "Front View" house to crack open and fold in aerial 3D!
 */
function projectAndSpawnUnderneath(jumpToAerial = false): void {
  const drawSize = new THREE.Vector2();
  renderer.getDrawingBufferSize(drawSize);
  const tw = Math.max(2, Math.round(drawSize.x));
  const th = Math.max(2, Math.round(drawSize.y));
  const nextIdx: 0 | 1 = activeRTIndex === 0 ? 1 : 0;
  let targetRT = nextIdx === 0 ? rtA : rtB;
  if (targetRT.width !== tw || targetRT.height !== th) {
    targetRT.dispose();
    targetRT = makeProjTarget(tw, th);
    if (nextIdx === 0) rtA = targetRT;
    else rtB = targetRT;
  }

  // 1. Capture the EXACT current pixels on screen from Camera A!
  syncCameraFromOrbit();
  camera.updateMatrixWorld(true);
  rig.root.updateMatrixWorld(true);

  rig.setFoldLinesVisible(false);

  const prevTarget = renderer.getRenderTarget();
  const prevToneMapping = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(targetRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevToneMapping;

  // 2. If `Jump view` is ON, secretly move camera to Camera B (Above 3/4) BEFORE building `snapVP`,
  //    reprojecting Camera A's exact screen image onto the flat net from Camera B's perspective!
  if (jumpToAerial) {
    const aerial = computeProjectionAerialView(rig.net);
    curYaw = targetYaw = aerial.toYaw;
    curPitch = targetPitch = aerial.toPitch;
    curDist = targetDist = aerial.toDist;
    curLookY = targetLookY = BASE_LOOK_Y;
    syncCameraFromOrbit();
    camera.updateMatrixWorld(true);
  }

  snapVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  activeRTIndex = nextIdx;

  // 3. INSTANT JIT SWAP: spawn the next DIFFERENT house flat + complementary cutout sheet with 1:1 projection!
  generation += 1;
  justProjected = true;

  mountHouseGeneration(generation, true);
  materials.setProjection(targetRT.texture, snapVP);
  syncUI();
}

function triggerCutoutDrop(): void {
  revealCreasesAfterSwap();
  if (cutoutDropState === 'waiting') {
    cutoutDropState = 'falling';
    cutoutDropElapsed = 0;
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function getZoomBounds(): { minDist: number; maxDist: number } {
  return { minDist: 14, maxDist: Math.max(135, finalDist * 1.9) };
}

function computeAutoZoom(foldProg: number): { autoDist: number; autoLookY: number; shadowExtent: number } {
  // Smoothly zoom out as we approach the final folded stage (stays 100% locked at fold=0 for zero-transition swap!)
  const zRaw = clamp01((foldProg - 0.16) / 0.78);
  const zoomEase = zRaw * zRaw * (3 - 2 * zRaw);
  const autoDist = swapDist + (finalDist - swapDist) * zoomEase;
  const autoLookY = swapLookY + (finalLookY - swapLookY) * zoomEase;

  // Expand shadow box ahead of tall walls rising so cast shadows never clip mid-fold!
  const sRaw = clamp01(foldProg / 0.42);
  const sEase = sRaw * sRaw * (3 - 2 * sRaw);
  const shadowExtent = swapShadowExtent + (finalShadowExtent - swapShadowExtent) * sEase;
  return { autoDist, autoLookY, shadowExtent };
}

function revealCreasesAfterSwap(): void {
  if (justProjected) {
    justProjected = false;
    targetPaperRelief = 1;
    rig.setFoldLinesVisible(true);
  }
}

function allPanelsFoldedTarget(): boolean {
  return rig.panelIds.every((id) => (panelState.get(id)?.target ?? 0) >= 0.99);
}

function allPanelsSettledFolded(): boolean {
  return rig.panelIds.every((id) => {
    const ps = panelState.get(id);
    return ps && !ps.animating && ps.delay <= 0 && ps.fold >= 0.999 && ps.target >= 0.99;
  });
}

function computeFoldProgress(): number {
  if (rig.panelIds.length === 0) return 0;
  let sum = 0;
  for (const id of rig.panelIds) {
    sum += panelState.get(id)?.fold ?? 0;
  }
  return sum / rig.panelIds.length;
}

/**
 * Silky architectural cubic-bezier easing `(0.45, 0.0, 0.16, 1.0)`:
 * unhurried lift off the flat paper, fluid arc, long cushioned settle with zero harsh bounce.
 */
function easePaperFold(x: number): number {
  const u = clamp01(x);
  if (u <= 0 || u >= 1) return u;
  const x1 = 0.45;
  const x2 = 0.16;
  let t = u;
  for (let i = 0; i < 6; i++) {
    const inv = 1 - t;
    const bx = 3 * inv * inv * t * x1 + 3 * inv * t * t * x2 + t * t * t;
    const dx = 3 * inv * inv * x1 + 6 * inv * t * (x2 - x1) + 3 * t * t * (1 - x2);
    if (Math.abs(dx) < 1e-6) break;
    t = clamp01(t - (bx - u) / dx);
  }
  const inv = 1 - t;
  // y1 = 0.0, y2 = 1.0 -> 3*(1-t)*t^2 + t^3
  return 3 * inv * t * t + t * t * t;
}

function startPanelCurve(ps: PanelState, target: number, durationSec: number, delaySec = 0): void {
  ps.startFold = ps.fold;
  ps.target = clamp01(target);
  ps.delay = Math.max(0, delaySec);
  ps.animElapsed = 0;
  ps.animDuration = Math.max(0.05, durationSec);
  ps.animating = Math.abs(ps.target - ps.fold) > 0.0005 || ps.delay > 0;
}

/**
 * Slower, curved stagger timing table sorted dynamically from the walls FURTHEST AWAY
 * from the current camera angle to the walls CLOSEST to the camera!
 * That way the far walls rise first (keeping the white interior & projected graphic visible),
 * roofs trail smoothly behind their parent walls, and the nearest facade closes last.
 */
function getStaggerOrder(referenceYaw = curYaw): Array<{
  id: FoldablePanelId;
  delaySec: number;
  durationSec: number;
  scrubStart: number;
  scrubSpan: number;
}> {
  const camX = Math.sin(referenceYaw);
  const camZ = Math.cos(referenceYaw);
  const houseYaw = rig.net.spec.yawOffset;
  const cy = Math.cos(houseYaw);
  const sy = Math.sin(houseYaw);

  // Outward XZ normal for ANY wall (cross, ribbon, hex, or oct!)
  const wallOutwardDot = (id: FoldablePanelId): number => {
    const def = rig.net.panelMap.get(id);
    let nx = 0;
    let nz = 0;
    if (rig.net.spec.topology === 'ribbon') {
      const localN: Record<string, [number, number]> = {
        front: [0, 1],
        back: [0, -1],
        left: [-1, 0],
        right: [1, 0],
      };
      [nx, nz] = localN[id] ?? [0, 0];
    } else if (def?.wallFrame) {
      // Sheet vAxis (vx, vy) maps directly to flat 3D outward normal (vx, -vy)!
      nx = def.wallFrame.vAxis[0];
      nz = -def.wallFrame.vAxis[1];
    }
    const wx = nx * cy + nz * sy;
    const wz = -nx * sy + nz * cy;
    return wx * camX + wz * camZ;
  };

  const wallIds = rig.panelIds.filter((id) => rig.net.panelMap.get(id)?.stage === 'wall');
  // Sort ascending by outward dot product: most negative = furthest away from camera -> folds FIRST!
  const sortedWalls = [...wallIds].sort((a, b) => wallOutwardDot(a) - wallOutwardDot(b));

  const wallRank = new Map<FoldablePanelId, number>();
  sortedWalls.forEach((id, i) => wallRank.set(id, i));

  // Curved progressive spacing across walls (0.00 -> ... -> 1.00)
  const wallCount = Math.max(1, sortedWalls.length - 1);
  const wallCurve = (rank: number) => Math.pow(rank / wallCount, 1.28);

  const hasCap = rig.panels.has('roofCap') || rig.panelIds.some((id) => rig.net.panelMap.get(id)?.stage === 'cap');
  const isSingleSpanRoof = rig.net.spec.roofType === 'shed' || rig.net.spec.roofType === 'flat';
  const isSawtooth = rig.net.spec.roofType === 'sawtooth';
  const isRibbon = rig.net.spec.topology === 'ribbon';
  const isPolygon = rig.net.spec.topology === 'hex' || rig.net.spec.topology === 'oct';
  const isSetback = rig.net.spec.topology === 'setback';
  const isLWing = rig.net.spec.topology === 'lwing';
  const isVillage = rig.net.spec.topology === 'village';

  const panelDelay = new Map<FoldablePanelId, number>();
  const panelScrub = new Map<FoldablePanelId, number>();
  const items: Array<{
    id: FoldablePanelId;
    delaySec: number;
    durationSec: number;
    scrubStart: number;
    scrubSpan: number;
  }> = [];

  const pushItem = (
    id: FoldablePanelId,
    delaySec: number,
    durationSec: number,
    scrubStart: number,
    scrubSpan: number,
  ) => {
    const sClamped = Math.min(scrubStart, Math.max(0.05, 1 - scrubSpan));
    panelDelay.set(id, delaySec);
    panelScrub.set(id, sClamped);
    items.push({ id, delaySec, durationSec, scrubStart: sClamped, scrubSpan });
  };

  if (isVillage) {
    // Village bloom wave: main house rises first, followed by annexes & harbor tower rippling around the plaza!
    const localOffsets: Record<string, { d: number; s: number }> = {
      back: { d: 0.0, s: 0.0 },
      left: { d: 0.18, s: 0.07 },
      right: { d: 0.26, s: 0.10 },
      front: { d: 0.42, s: 0.17 },
    };
    for (const id of wallIds) {
      const def = rig.net.panelMap.get(id)!;
      const idx = def.islandIndex ?? 0;
      const lo = localOffsets[def.localId ?? 'back'] ?? { d: 0.2, s: 0.08 };
      pushItem(id, idx * 0.26 + lo.d, 1.18, idx * 0.09 + lo.s, 0.36);
    }
  } else if (isRibbon) {
    // Wrap-around ribbon dance: `back` lifts the entire strip off the paper first, then `left` & `right`
    // curl inward like embracing arms (farther wing slightly ahead), and `front` wraps smoothly around the front!
    const leftFurther = wallOutwardDot('left') <= wallOutwardDot('right');
    const ribbonTiming: Record<string, { d: number; s: number; dur: number }> = {
      back: { d: 0.0, s: 0.0, dur: 1.32 },
      left: { d: leftFurther ? 0.22 : 0.40, s: leftFurther ? 0.10 : 0.18, dur: 1.28 },
      right: { d: leftFurther ? 0.40 : 0.22, s: leftFurther ? 0.18 : 0.10, dur: 1.28 },
      front: { d: (leftFurther ? 0.40 : 0.22) + 0.30, s: (leftFurther ? 0.18 : 0.10) + 0.16, dur: 1.28 },
    };

    for (const id of wallIds) {
      const t = ribbonTiming[id] ?? { d: 0.3, s: 0.14, dur: 1.28 };
      pushItem(id, t.d, t.dur, t.s, isSawtooth ? 0.36 : hasCap ? 0.42 : 0.46);
    }
  } else if (isSetback) {
    // Tiered setback Z-pleat rise: ground podium walls rise far-to-near, then the mountain crease (`upperWall`)
    // leads the valley crease (`terrace`) in a real Z-pleat (`fold(upper) >= fold(terrace)` at every instant!)
    // so the 4 upper tower walls stay strictly upright/flared in their own quadrants and NEVER intersect!
    for (const id of sortedWalls) {
      const rank = wallRank.get(id) ?? 0;
      const c = wallCurve(rank);
      pushItem(id, c * 0.44, 1.18, c * 0.16, 0.34);
    }
    for (const id of rig.panelIds) {
      const def = rig.net.panelMap.get(id)!;
      if (def.stage !== 'terrace') continue;
      const wallId = def.parent as FoldablePanelId;
      const wd = panelDelay.get(wallId) ?? 0.2;
      const ws = panelScrub.get(wallId) ?? 0.1;
      // Terrace valley fold slightly trails its mountain `upperWall` partner so `theta_U >= theta_T` always!
      pushItem(id, wd + 0.36, 1.14, ws + 0.20, 0.36);
    }
    for (const id of rig.panelIds) {
      const def = rig.net.panelMap.get(id)!;
      if (def.stage !== 'upperWall') continue;
      const terraceId = def.parent as FoldablePanelId;
      const wallId = rig.net.panelMap.get(terraceId)?.parent as FoldablePanelId;
      const wd = panelDelay.get(wallId) ?? 0.2;
      const ws = panelScrub.get(wallId) ?? 0.1;
      // Mountain upper wall starts 0.10s earlier and finishes faster than terrace -> zero self-intersection!
      pushItem(id, wd + 0.24, 1.04, ws + 0.12, 0.34);
    }
  } else if (isLWing) {
    // Asymmetric L-wing choreography: base-hinged walls rise far-to-near, then the mountain courtyard crease
    // (`rightLower`) pre-bends slightly ahead of `wingBack` in a true Z-pleat so it glides cleanly into
    // the re-entrant L-corner without sweeping through the main house!
    const rootWalls = sortedWalls.filter((id) => rig.net.panelMap.get(id)?.parent === 'base');
    const rootCount = Math.max(1, rootWalls.length - 1);
    rootWalls.forEach((id, i) => {
      const c = Math.pow(i / rootCount, 1.25);
      pushItem(id, c * 0.48, 1.24, c * 0.20, 0.38);
    });
    const wingEndD = panelDelay.get('wingEnd') ?? 0.32;
    const wingEndS = panelScrub.get('wingEnd') ?? 0.16;
    if (rig.panels.has('wingBack')) {
      pushItem('wingBack', wingEndD + 0.36, 1.18, wingEndS + 0.18, 0.36);
    }
    if (rig.panels.has('rightLower')) {
      pushItem('rightLower', wingEndD + 0.24, 1.06, wingEndS + 0.12, 0.34);
    }
  } else if (isPolygon) {
    // Radial lotus-bloom choreography: furthest petals rise first around both flanks with a gentle shimmer,
    // blooming upward around the projected interior before the front entrance petal closes last!
    for (const id of sortedWalls) {
      const rank = wallRank.get(id) ?? 0;
      const c = wallCurve(rank);
      pushItem(id, c * 0.78, 1.26, c * 0.30, hasCap ? 0.42 : 0.46);
    }
  } else {
    for (const id of sortedWalls) {
      const rank = wallRank.get(id) ?? 0;
      const c = wallCurve(rank);
      pushItem(id, c * 0.62, 1.28, c * 0.26, isSawtooth ? 0.38 : hasCap ? 0.44 : 0.48);
    }
  }

  let maxRoofDelay = 0;
  for (const id of rig.panelIds) {
    const def = rig.net.panelMap.get(id)!;
    if (def.stage !== 'roof') continue;
    const pId = (def.parent as FoldablePanelId) ?? 'left';
    const parentIsRoof = rig.net.panelMap.get(pId)?.stage === 'roof';
    let d: number;
    let s: number;
    if (isVillage) {
      if (parentIsRoof) {
        // Z-pleat lockstep: mountain risers match their valley parent (`0` offset) so stepped/sawtooth roofs never collide!
        const stepD = def.isMountain ? 0 : 0.14;
        const stepS = def.isMountain ? 0 : 0.05;
        d = (panelDelay.get(pId) ?? 0.6) + stepD;
        s = Math.min(0.66, (panelScrub.get(pId) ?? 0.30) + stepS);
      } else {
        d = (panelDelay.get(pId) ?? 0.45) + 0.34;
        s = (panelScrub.get(pId) ?? 0.22) + 0.16;
        const localId = def.localId ?? id;
        const bSpec = def.panelSpec ?? rig.net.spec;
        if (
          ((bSpec.roofType === 'shed' || bSpec.roofType === 'flat') && localId === 'roofL') ||
          (bSpec.roofType === 'sawtooth' && localId === 'roofS0')
        ) {
          const prefix = id.slice(0, id.length - localId.length);
          const oppD = panelDelay.get(`${prefix}right`) ?? 0;
          const oppS = panelScrub.get(`${prefix}right`) ?? 0;
          d = Math.max(d, oppD + 0.22);
          s = Math.max(s, oppS + 0.12);
        }
      }
    } else if (parentIsRoof) {
      // Multi-segment chained roofs (`sawtooth`, `gambrel` 2×, `barrel` 3×, `stepped` 3× ladder):
      // Mountain creases fold in exact Z-pleat lockstep (`stepD = 0, stepS = 0`) with their parent valley crease
      // so vertical risers stay upright with zero interior sweep!
      const stepD = def.isMountain ? 0 : isSawtooth ? 0.20 : 0.14;
      const stepS = def.isMountain ? 0 : isSawtooth ? 0.08 : 0.06;
      d = (panelDelay.get(pId) ?? 0.72) + stepD;
      s = Math.min(0.68, (panelScrub.get(pId) ?? 0.36) + stepS);
    } else if (isSetback) {
      // Wait for the `terrace` + `upperWall` Z-pleat to converge before closing upper spire/crown petals!
      const terraceId = rig.net.panelMap.get(pId)?.parent as FoldablePanelId;
      const td = panelDelay.get(terraceId) ?? panelDelay.get(pId) ?? 0.9;
      const ts = panelScrub.get(terraceId) ?? panelScrub.get(pId) ?? 0.42;
      d = td + 0.46;
      s = ts + 0.24;
    } else {
      d = (panelDelay.get(pId) ?? 0.35) + 0.42;
      s = (panelScrub.get(pId) ?? 0.14) + 0.20;
    }
    if ((isSingleSpanRoof && id === 'roofL') || (isSawtooth && id === 'roofS0')) {
      const oppD = panelDelay.get('right') ?? 0;
      const oppS = panelScrub.get('right') ?? 0;
      d = Math.max(d, oppD + 0.24);
      s = Math.max(s, oppS + 0.16);
    }
    if (d > maxRoofDelay) maxRoofDelay = d;
    const isChainedGable =
      rig.net.spec.roofType === 'gable' &&
      (rig.net.spec.gableProfile === 'stepped' ||
        rig.net.spec.gableProfile === 'gambrel' ||
        rig.net.spec.gableProfile === 'barrel');
    const dur = isSawtooth || isChainedGable ? 1.06 : isSetback ? 1.10 : 1.24;
    const span = isSawtooth || isChainedGable ? 0.30 : isSetback ? (hasCap ? 0.26 : 0.32) : hasCap ? 0.38 : 0.44;
    pushItem(id, d, dur, s, span);
  }

  for (const id of rig.panelIds) {
    const def = rig.net.panelMap.get(id)!;
    if (def.stage !== 'cap') continue;
    const pId = def.parent as FoldablePanelId;
    const pDelay = panelDelay.get(pId) ?? maxRoofDelay;
    const pScrub = panelScrub.get(pId) ?? 0.56;
    pushItem(
      id,
      Math.max(pDelay + (isSetback ? 0.34 : 0.42), maxRoofDelay + 0.16),
      isSetback ? 1.05 : 1.18,
      Math.max(pScrub + 0.16, isSetback ? 0.68 : 0.58),
      isSetback ? 0.32 : 0.42,
    );
  }

  return items;
}

let latchedScrubYaw = defaultYaw;

function launchStaggeredFold(toFold: 0 | 1, leadDelaySec = 0): void {
  revealCreasesAfterSwap();
  latchedScrubYaw = curYaw;
  const schedule = getStaggerOrder(curYaw);
  const maxDelay = schedule.reduce((m, s) => Math.max(m, s.delaySec), 0);

  for (const s of schedule) {
    const ps = panelState.get(s.id);
    if (!ps) continue;
    // When unfolding, reverse the curved stagger wave so roof cap & slopes bloom open ahead of the walls!
    const delay =
      toFold === 1 ? leadDelaySec + s.delaySec : Math.max(0, maxDelay - s.delaySec);
    startPanelCurve(ps, toFold, s.durationSec, delay);
  }
  syncUI();
}

function applyFoldScrub(t: number, snap = false): void {
  revealCreasesAfterSwap();
  const v = clamp01(t);
  if (v > 0.01) {
    triggerCutoutDrop();
  }
  const schedule = getStaggerOrder(latchedScrubYaw);

  for (const s of schedule) {
    const ps = panelState.get(s.id);
    if (!ps) continue;
    const raw = clamp01((v - s.scrubStart) / s.scrubSpan);
    const f = easePaperFold(raw);
    ps.delay = 0;
    ps.animating = false;
    ps.target = f;
    if (snap) {
      ps.fold = f;
      ps.startFold = f;
    }
  }
}

function resetAll(): void {
  generation = 1;
  justProjected = false;
  clearPreparedNext();
  materials.setProjection(null);
  targetYaw = curYaw = defaultYaw;
  targetPitch = curPitch = defaultPitch;
  mountHouseGeneration(1, false);
  schedulePrepareNext(2, 120);
  syncUI();
}

function resetToFactory(): void {
  try {
    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    // Ignore storage removal errors
  }
  forcedModelSlot = FACTORY_SETTINGS.model;
  mixHouses = FACTORY_SETTINGS.houses;
  mixTopology = FACTORY_SETTINGS.topology;
  mixRoof = FACTORY_SETTINGS.roof;
  mixGableProfile = FACTORY_SETTINGS.gableProfile;
  mixWindow = FACTORY_SETTINGS.windowStyle;
  mixWinOpening = FACTORY_SETTINGS.windowOpening;
  mixWinDetail = FACTORY_SETTINGS.windowDetail;
  mixWinOpenMode = FACTORY_SETTINGS.windowOpenMode;
  mixWinOpen = FACTORY_SETTINGS.windowOpen;
  mixBays = FACTORY_SETTINGS.windowCount;
  mixDoor = FACTORY_SETTINGS.doorStyle;
  mixLevels = FACTORY_SETTINGS.levels;
  mixHeightScale = FACTORY_SETTINGS.heightScale;
  mixConsistency = FACTORY_SETTINGS.consistency;
  mixSeed = FACTORY_SETTINGS.seed;
  debugColorEnabled = FACTORY_SETTINGS.color;
  debugSpinEnabled = FACTORY_SETTINGS.spin;
  debugPerspCutEnabled = FACTORY_SETTINGS.perspectiveCut;
  debugGlideOnFoldEnabled = FACTORY_SETTINGS.glideOnFold;
  debugFadeProjEnabled = FACTORY_SETTINGS.fadeProjOnFold;
  syncDebugControls();
  resetAll();
  applyActiveOutsideColor();
  if (!catalogModal.hidden) rebuildCatalogGrid(true);
}

function triggerStepAction(): void {
  // If the current 3D house is already folded & settled:
  // - Captures the exact live pixels from Camera A, and if `Jump view` is ON, secretly reprojects
  //   that exact image from Camera B (Above 3/4) so nothing changes at t=0 — then drops the cutout
  //   and folds the new house in the new aerial perspective!
  if (allPanelsSettledFolded()) {
    projectAndSpawnUnderneath(debugPerspCutEnabled);
    triggerCutoutDrop();
    launchStaggeredFold(1, 0.44);
    return;
  }
  if (!allPanelsFoldedTarget()) {
    const lead = cutoutDropState === 'waiting' ? 0.44 : 0;
    if (cutoutDropState === 'waiting') triggerCutoutDrop();
    launchStaggeredFold(1, lead);
  }
}

function toggleFoldAll(): void {
  if (!allPanelsFoldedTarget() && cutoutDropState === 'waiting') {
    triggerCutoutDrop();
    launchStaggeredFold(1, 0.44);
    return;
  }
  launchStaggeredFold(allPanelsFoldedTarget() ? 0 : 1);
}

function syncUI(): void {
  const allTargetFolded = allPanelsFoldedTarget();
  const settledFolded = allPanelsSettledFolded();
  const houseName = rig.net.spec.label;
  const hasCustomMix = Boolean(
    forcedModelSlot ||
      mixHouses ||
      mixTopology ||
      mixRoof ||
      mixGableProfile ||
      mixWindow ||
      mixWinOpening ||
      mixWinDetail ||
      mixBays ||
      mixDoor ||
      mixLevels ||
      mixHeightScale !== null ||
      mixConsistency !== null ||
      mixSeed > 0,
  );
  const seedTag = mixSeed > 0 ? `#${mixSeed} · ` : '';
  const prefix =
    generation > 1
      ? `${seedTag}Layer ${generation} · ${houseName} · `
      : hasCustomMix
        ? `${seedTag}${houseName} · `
        : '';

  btnAction.textContent = 'Fold';
  if (!allTargetFolded) {
    const hoveredDef = hoveredPanel ? rig.net.panelMap.get(hoveredPanel) : null;
    statusEl.textContent = hoveredDef
      ? `${prefix}Fold ${hoveredDef.label.toLowerCase()}`
      : `${prefix}Click Fold or drag any flap`;
  } else if (!settledFolded) {
    statusEl.textContent = `${prefix}Folding`;
  } else {
    statusEl.textContent = `${prefix}Folded`;
  }

  if (!isScrubbing) {
    progressRange.value = computeFoldProgress().toFixed(3);
  }
}

// ----------------------------------------------------------------------------
// Raycasting & Direct Hand-Folding Pointer Interaction
// ----------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pickPanel3D(clientX: number, clientY: number): FoldablePanelId | null {
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  const targets: THREE.Object3D[] = [];
  for (const id of rig.panelIds) {
    const pv = rig.panels.get(id);
    if (pv) targets.push(pv.mesh);
  }
  const hits = raycaster.intersectObjects(targets, false);
  if (hits.length === 0) return null;
  const ud = hits[0].object.userData as { kind?: string; id?: FoldablePanelId };
  return ud.kind === 'panel' && ud.id ? ud.id : null;
}

function updateHover(clientX: number, clientY: number): void {
  const next = pickPanel3D(clientX, clientY);
  if (next !== hoveredPanel) {
    hoveredPanel = next;
    if (next) revealCreasesAfterSwap();
    canvas.classList.toggle('can-fold', hoveredPanel !== null);
    syncUI();
  }
}

type DragMode =
  | { kind: 'none' }
  | { kind: 'orbit'; lastX: number; lastY: number }
  | { kind: 'fold'; panel: FoldablePanelId; startX: number; startY: number; startFold: number; moved: boolean };

let drag: DragMode = { kind: 'none' };
const activePointers = new Map<number, { x: number; y: number }>();
let lastPinchDist = 0;

function panelFoldDragSensitivity(pid: FoldablePanelId, dx: number, dy: number): number {
  const pv = rig.panels.get(pid);
  if (!pv) return -dy / 120;
  const worldPos = new THREE.Vector3();
  pv.pivot.getWorldPosition(worldPos);
  const inward = new THREE.Vector3(-worldPos.x, 3.2, -worldPos.z).normalize();

  const p0 = worldPos.clone().project(camera);
  const p1 = worldPos.clone().addScaledVector(inward, 1.5).project(camera);
  const sx = (p1.x - p0.x) * canvas.clientWidth * 0.5;
  const sy = -(p1.y - p0.y) * canvas.clientHeight * 0.5;
  const sLen = Math.hypot(sx, sy);
  if (sLen < 1e-3) return -dy / 120;
  return (dx * (sx / sLen) + dy * (sy / sLen)) / 115;
}

canvas.addEventListener('pointerdown', (e) => {
  if (cityActive && cityView) {
    cityView.onPointerDown(e, canvas);
    return;
  }
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  canvas.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size === 2) {
    const pts = Array.from(activePointers.values());
    lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    drag = { kind: 'none' };
    return;
  }

  const pHit = pickPanel3D(e.clientX, e.clientY);
  if (pHit) {
    triggerCutoutDrop();
    hoveredPanel = pHit;
    drag = {
      kind: 'fold',
      panel: pHit,
      startX: e.clientX,
      startY: e.clientY,
      startFold: panelState.get(pHit)?.fold ?? 0,
      moved: false,
    };
    return;
  }

  drag = { kind: 'orbit', lastX: e.clientX, lastY: e.clientY };
  canvas.classList.add('orbiting');
});

canvas.addEventListener('pointermove', (e) => {
  if (cityActive && cityView) {
    cityView.onPointerMove(e, canvas);
    return;
  }
  const prevPtr = activePointers.get(e.pointerId);
  if (!prevPtr) {
    if (e.pointerType === 'mouse') updateHover(e.clientX, e.clientY);
    return;
  }
  prevPtr.x = e.clientX;
  prevPtr.y = e.clientY;

  if (activePointers.size === 2) {
    const pts = Array.from(activePointers.values());
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    if (lastPinchDist > 0) {
      const { minDist, maxDist } = getZoomBounds();
      const { autoDist } = computeAutoZoom(computeFoldProgress());
      const desired = Math.max(minDist, Math.min(maxDist, (autoDist + userZoomDelta) * (lastPinchDist / Math.max(dist, 1))));
      userZoomDelta = desired - autoDist;
    }
    lastPinchDist = dist;
    return;
  }

  if (drag.kind === 'orbit') {
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (Math.hypot(dx, dy) > 1.5) revealCreasesAfterSwap();
    targetYaw -= dx * 0.0072;
    targetPitch = Math.max(0.16, Math.min(1.42, targetPitch + dy * 0.0068));
    return;
  }

  if (drag.kind === 'fold') {
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    if (drag.moved) {
      const ps = panelState.get(drag.panel);
      if (ps) {
        const delta = panelFoldDragSensitivity(drag.panel, dx, dy);
        const next = clamp01(drag.startFold + delta);
        ps.delay = 0;
        ps.animating = false;
        ps.fold = next;
        ps.startFold = next;
        ps.target = next;
        syncUI();
      }
    }
  }
});

function endPointer(e: PointerEvent, isCancel: boolean): void {
  activePointers.delete(e.pointerId);
  if (activePointers.size === 0) {
    canvas.classList.remove('orbiting');
    lastPinchDist = 0;
  }

  if (!isCancel && drag.kind === 'fold') {
    const ps = panelState.get(drag.panel);
    if (ps) {
      if (!drag.moved) {
        startPanelCurve(ps, ps.target > 0.5 ? 0 : 1, 0.95, 0);
      } else {
        startPanelCurve(ps, ps.fold >= 0.45 ? 1 : 0, 0.65, 0);
      }
      syncUI();
    }
  }

  drag = { kind: 'none' };
  if (e.pointerType === 'mouse') updateHover(e.clientX, e.clientY);
}

canvas.addEventListener('pointerup', (e) => {
  if (cityActive && cityView) {
    cityView.onPointerUp(e, canvas);
    return;
  }
  endPointer(e, false);
});
canvas.addEventListener('pointercancel', (e) => {
  if (cityActive && cityView) {
    cityView.onPointerUp(e, canvas);
    return;
  }
  endPointer(e, true);
});
canvas.addEventListener('contextmenu', (e) => {
  if (cityActive) e.preventDefault();
});
canvas.addEventListener('pointerleave', () => {
  if (drag.kind === 'none') {
    hoveredPanel = null;
    canvas.classList.remove('can-fold');
    syncUI();
  }
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (cityActive && cityView) {
      cityView.onWheel(e);
      return;
    }
    const { minDist, maxDist } = getZoomBounds();
    const { autoDist } = computeAutoZoom(computeFoldProgress());
    const desired = Math.max(minDist, Math.min(maxDist, (autoDist + userZoomDelta) * Math.exp(e.deltaY * 0.0011)));
    userZoomDelta = desired - autoDist;
  },
  { passive: false },
);

// UI Controls
btnAction.addEventListener('click', (e) => {
  e.stopPropagation();
  triggerStepAction();
});
btnNext.addEventListener('click', (e) => {
  e.stopPropagation();
  triggerStepAction();
});
btnReset.addEventListener('click', (e) => {
  e.stopPropagation();
  resetAll();
});

progressRange.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  isScrubbing = true;
  latchedScrubYaw = curYaw;
});
progressRange.addEventListener('pointerup', () => {
  isScrubbing = false;
  syncUI();
});
progressRange.addEventListener('input', () => {
  applyFoldScrub(Number(progressRange.value) || 0, false);
  syncUI();
});

function remountWithCurrentMix(persist = true): void {
  syncDebugControls();
  if (persist) saveDebugSettings();
  const wasFolded = computeFoldProgress() > 0.5;
  clearPreparedNext();
  justProjected = false;
  materials.setProjection(null);
  mountHouseGeneration(generation, false);
  if (wasFolded) {
    applyFoldScrub(1, true);
    const z = computeAutoZoom(1);
    const { minDist, maxDist } = getZoomBounds();
    targetDist = curDist = Math.max(minDist, Math.min(maxDist, z.autoDist + userZoomDelta));
    targetLookY = curLookY = z.autoLookY;
    curShadowExtent = z.shadowExtent;
    applyShadowFrustum(curShadowExtent);
  }
  syncCameraFromOrbit();
  schedulePrepareNext(generation + 1, 80);
  syncUI();
  if (!catalogModal.hidden) rebuildCatalogGrid(false);
}

function selectModelSlot(slot: number | null, persist = true): void {
  forcedModelSlot = slot;
  if (slot !== null) {
    mixHouses = null;
    mixTopology = null;
    mixRoof = null;
    mixGableProfile = null;
    mixWindow = null;
    mixWinOpening = null;
    mixWinDetail = null;
    mixBays = null;
    mixDoor = null;
    mixLevels = null;
    mixHeightScale = null;
    mixConsistency = null;
    mixSeed = 0;
  }
  remountWithCurrentMix(persist);
}

function setSeedValue(nextSeed: number, persist = true): void {
  const clamped = Math.max(0, Math.min(99999, Math.round(Number.isFinite(nextSeed) ? nextSeed : 0)));
  if (clamped === mixSeed && forcedModelSlot === null) return;
  forcedModelSlot = null;
  mixSeed = clamped;
  remountWithCurrentMix(persist);
}

function rollRandomSeed(): number {
  let next = Math.floor(1 + Math.random() * 9998);
  if (next === mixSeed) next = (next % 9998) + 1;
  return next;
}

// ----------------------------------------------------------------------------
// Pure Flat 10-Per-Row Seeded Typology Wall (True Lazy Scroll + Click-to-Fold!)
// ----------------------------------------------------------------------------
interface CatalogFamily {
  title: string;
  slot?: number;
  houses?: 1 | 2 | 3 | 4;
  topology?: NetTopology;
  roofType?: RoofType;
  gableProfile?: GableProfile;
}

const CATALOG_FAMILIES: readonly CatalogFamily[] = [
  { title: '01 · Gable · All ceilings', slot: 1 },
  { title: '02 · Gambrel · Cut twice (2×)', slot: 1, roofType: 'gable', gableProfile: 'gambrel' },
  { title: '03 · Stepped gable · 3× ladder', slot: 1, roofType: 'gable', gableProfile: 'stepped' },
  { title: '04 · Barrel gable · 3× vault', slot: 1, roofType: 'gable', gableProfile: 'barrel' },
  { title: '05 · Mansard', slot: 2 },
  { title: '06 · Octagonal', slot: 3 },
  { title: '07 · Stepped tower', slot: 4 },
  { title: '08 · L-wing villa', slot: 5 },
  { title: '09 · Sawtooth', slot: 6 },
  { title: '10 · Hexagonal', slot: 7 },
  { title: '11 · Butterfly', slot: 8 },
  { title: '12 · Stepped pagoda', slot: 9 },
  { title: '13 · Composite · 3 houses', slot: 10, houses: 3 },
  { title: '14 · Hip hall', slot: 11 },
  { title: '15 · Modernist flat', slot: 12 },
  { title: '16 · Studio loft', slot: 13 },
  { title: '17 · Composite · 4 houses', slot: 14, houses: 4 },
  { title: '18 · Composite · 2 houses', topology: 'village', houses: 2 },
];

const VARIATIONS_PER_ROW = 10;
const INITIAL_CATALOG_ROWS = 8;
const LAZY_ROWS_BATCH = 4;

interface CatalogRenderJob {
  spec: HouseNetSpec;
  cacheKey: string;
  thumbCanvas: HTMLCanvasElement;
}

const catalogThumbs = new CatalogThumbRenderer();
let catalogViewMode: CatalogViewMode = '3d';
let catalogRowsLoaded = 0;
let catalogRenderToken = 0;
let catalogRafId: number | null = null;
let catalogDebounceId: number | null = null;
let catalogPendingQueue: CatalogRenderJob[] = [];
let catalogRowObserver: IntersectionObserver | null = null;
let catalogSentinelObserver: IntersectionObserver | null = null;
const catalogRowJobs = new WeakMap<Element, CatalogRenderJob[]>();
let activeCatalogTileId: string | null = null;

function cancelCatalogRender(): void {
  catalogRenderToken++;
  catalogPendingQueue = [];
  if (catalogRafId !== null) {
    window.cancelAnimationFrame(catalogRafId);
    catalogRafId = null;
  }
  if (catalogDebounceId !== null) {
    window.clearTimeout(catalogDebounceId);
    catalogDebounceId = null;
  }
  if (catalogRowObserver) {
    catalogRowObserver.disconnect();
    catalogRowObserver = null;
  }
  if (catalogSentinelObserver) {
    catalogSentinelObserver.disconnect();
    catalogSentinelObserver = null;
  }
}

function pumpCatalogQueue(token: number): void {
  if (token !== catalogRenderToken || catalogModal.hidden) {
    catalogRafId = null;
    return;
  }
  const perFrame = 4;
  for (let i = 0; i < perFrame && catalogPendingQueue.length > 0; i++) {
    const job = catalogPendingQueue.shift()!;
    catalogThumbs.renderToCanvas(job.cacheKey, job.spec, job.thumbCanvas, debugColorEnabled, catalogViewMode, mixWinOpenMode, mixWinOpen);
    job.thumbCanvas.classList.add('is-ready');
  }
  if (catalogPendingQueue.length > 0) {
    catalogRafId = window.requestAnimationFrame(() => pumpCatalogQueue(token));
  } else {
    catalogRafId = null;
  }
}

function enqueueCatalogJobs(jobs: CatalogRenderJob[], token: number): void {
  if (token !== catalogRenderToken || catalogModal.hidden || jobs.length === 0) return;
  for (const job of jobs) {
    if (catalogThumbs.getCached(job.cacheKey)) {
      catalogThumbs.renderToCanvas(job.cacheKey, job.spec, job.thumbCanvas, debugColorEnabled, catalogViewMode, mixWinOpenMode, mixWinOpen);
      job.thumbCanvas.classList.add('is-ready');
    } else {
      catalogPendingQueue.push(job);
    }
  }
  if (catalogPendingQueue.length > 0 && catalogRafId === null) {
    catalogRafId = window.requestAnimationFrame(() => pumpCatalogQueue(token));
  }
}

function formatCatalogTooltip(spec: HouseNetSpec, seedTag: number): string {
  const details =
    spec.topology === 'village' && spec.village
      ? `${spec.village.count} houses · ${spec.roofType}`
      : `${spec.topology} · ${spec.roofType} · ${spec.levels}F · ${spec.architecture?.facades.front.levels[0]?.windowRow.baseWindow.shape ?? spec.windowGround}`;
  return `${spec.label} · #${seedTag} · ${details}`;
}

function updateCatalogHeader(): void {
  const parts: string[] = [mixSeed === 0 ? 'Seed 0 · Curated' : `Seed ${mixSeed}`];
  if (mixHouses) parts.push(`${mixHouses} ${mixHouses === 1 ? 'house' : 'houses'}`);
  if (mixTopology && !(mixHouses && mixHouses >= 2 && mixTopology === 'village')) parts.push(mixTopology);
  if (mixRoof) parts.push(mixRoof);
  if (mixWindow) parts.push(mixWindow);
  if (mixBays) parts.push(`${mixBays} bays`);
  if (mixDoor) parts.push(`${mixDoor} door`);
  if (mixLevels) parts.push(`${mixLevels}F`);
  if (mixConsistency !== null) parts.push(`${Math.round(mixConsistency * 100)}% consistent`);
  catSubtitle.textContent = parts.join(' · ');

  catalogModal.classList.toggle('is-flat-white', catalogViewMode === 'flat' && !debugColorEnabled);
  catView3d.classList.toggle('active', catalogViewMode === '3d');
  catViewFlat.classList.toggle('active', catalogViewMode === 'flat');
  catColorBtn.setAttribute('aria-pressed', debugColorEnabled ? 'true' : 'false');
  catSeedInput.value = String(mixSeed);
  catSeedCurated.hidden = mixSeed === 0;
}

function selectCatalogSpecimen(tileId: string, gen: number, opts: HouseMixOptions): void {
  activeCatalogTileId = tileId;
  forcedModelSlot = opts.slot ?? null;
  mixHouses = opts.houses ?? null;
  mixTopology = opts.topology ?? null;
  mixRoof = opts.roofType ?? null;
  mixGableProfile = opts.gableProfile ?? null;
  mixSeed = opts.seed ?? mixSeed;
  generation = Math.max(1, Math.floor(gen));

  setCatalogOpen(false);
  syncDebugControls();
  saveDebugSettings();

  clearPreparedNext();
  justProjected = false;
  materials.setProjection(null);
  targetYaw = curYaw = defaultYaw;
  targetPitch = curPitch = defaultPitch;
  mountHouseGeneration(generation, false);
  syncCameraFromOrbit();
  syncUI();
  launchStaggeredFold(1);
}

function buildCatalogRowElement(rowIndex: number, token: number): HTMLElement {
  const baseGrammar: HouseMixOptions = {
    windowStyle: mixWindow,
    windowOpening: mixWinOpening,
    windowDetail: mixWinDetail,
    windowCount: mixBays,
    doorStyle: mixDoor,
    levels: mixLevels,
    heightScale: mixHeightScale,
    consistency: mixConsistency,
  };
  const hasExplicitShapeFilter = Boolean(mixHouses || mixTopology || mixRoof || mixGableProfile);
  const family = !hasExplicitShapeFilter && rowIndex < CATALOG_FAMILIES.length ? CATALOG_FAMILIES[rowIndex] : null;

  const rowEl = document.createElement('section');
  rowEl.className = 'cat-row';
  rowEl.dataset.row = String(rowIndex);

  const titleEl = document.createElement('div');
  titleEl.className = 'cat-row-title';
  if (family) {
    titleEl.textContent = family.title;
  } else if (hasExplicitShapeFilter) {
    const startIdx = rowIndex * VARIATIONS_PER_ROW + 1;
    const endIdx = startIdx + VARIATIONS_PER_ROW - 1;
    titleEl.textContent = `${String(startIdx).padStart(2, '0')}–${String(endIdx).padStart(2, '0')}`;
  } else {
    const batchNum = rowIndex - CATALOG_FAMILIES.length + 1;
    titleEl.textContent = `${String(rowIndex + 1).padStart(2, '0')} · Seeded variations · Batch ${batchNum}`;
  }
  rowEl.appendChild(titleEl);

  const gridEl = document.createElement('div');
  gridEl.className = 'cat-row-grid';
  rowEl.appendChild(gridEl);

  const grammarKey = `${mixWindow ?? 'a'}|${mixWinOpening ?? 'a'}|${mixWinDetail ?? 'a'}|${mixWinOpenMode}|${Math.round(mixWinOpen * 100)}|${mixBays ?? 'a'}|${mixDoor ?? 'a'}|${mixLevels ?? 'a'}|${mixHeightScale === null ? 'd' : Math.round(mixHeightScale * 100)}|${mixConsistency === null ? 'd' : Math.round(mixConsistency * 100)}|${catalogViewMode}|${debugColorEnabled ? 'c' : 'w'}`;
  const jobs: CatalogRenderJob[] = [];

  for (let col = 0; col < VARIATIONS_PER_ROW; col++) {
    let tileGen = 1;
    let tileOpts: HouseMixOptions;
    let tileSeed: number;

    if (family) {
      // Column 0 on Seed 0 is the exact curated archetype (when no gableProfile override); all other columns are deterministic variations!
      const isCuratedFirst = mixSeed === 0 && col === 0 && Boolean(family.slot) && !family.gableProfile;
      tileSeed = isCuratedFirst
        ? 0
        : mixSeed === 0
          ? (rowIndex + 1) * 100 + col
          : ((mixSeed * 97 + (rowIndex + 1) * 31 + col * 13) % 99990) + 1;
      tileGen = isCuratedFirst && family.slot ? family.slot : 1;
      tileOpts = {
        ...baseGrammar,
        slot: family.slot ?? null,
        houses: isCuratedFirst ? null : (family.houses ?? null),
        topology: family.topology ?? null,
        roofType: family.roofType ?? null,
        gableProfile: family.gableProfile ?? null,
        seed: tileSeed,
      };
    } else if (hasExplicitShapeFilter) {
      tileGen = rowIndex * VARIATIONS_PER_ROW + col + 1;
      tileSeed = mixSeed === 0 ? tileGen : ((mixSeed * 97 + tileGen * 17) % 99990) + 1;
      tileOpts = {
        ...baseGrammar,
        slot: null,
        houses: mixHouses,
        topology: mixTopology,
        roofType: mixRoof,
        gableProfile: mixGableProfile,
        seed: tileSeed,
      };
    } else {
      const batchRow = rowIndex - CATALOG_FAMILIES.length;
      tileGen = batchRow * VARIATIONS_PER_ROW + col + 1;
      tileSeed = mixSeed === 0 ? 1000 + batchRow * 37 + col + 1 : ((mixSeed * 131 + tileGen * 29) % 99990) + 1;
      tileOpts = {
        ...baseGrammar,
        slot: null,
        houses: null,
        topology: null,
        roofType: null,
        gableProfile: null,
        seed: tileSeed,
      };
    }

    const spec = generateHouseSpec(tileGen, tileOpts);
    const tileId = `r${rowIndex}c${col}s${tileSeed}`;
    const cacheKey = `${tileId}|${tileGen}|${tileOpts.slot ?? 'a'}|${tileOpts.houses ?? 'a'}|${tileOpts.topology ?? 'a'}|${tileOpts.roofType ?? 'a'}|${tileOpts.gableProfile ?? 'a'}|${grammarKey}`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = activeCatalogTileId === tileId ? 'cat-tile is-active' : 'cat-tile';
    btn.dataset.row = String(rowIndex);
    btn.dataset.col = String(col);
    btn.dataset.gen = String(tileGen);
    btn.title = formatCatalogTooltip(spec, tileSeed);
    btn.setAttribute('aria-label', btn.title);

    const thumb = document.createElement('canvas');
    thumb.className = 'cat-thumb';
    thumb.width = THUMB_SIZE;
    thumb.height = THUMB_SIZE;
    btn.appendChild(thumb);

    btn.addEventListener('click', () => selectCatalogSpecimen(tileId, tileGen, tileOpts));
    gridEl.appendChild(btn);

    if (catalogThumbs.getCached(cacheKey)) {
      catalogThumbs.renderToCanvas(cacheKey, spec, thumb, debugColorEnabled, catalogViewMode, mixWinOpenMode, mixWinOpen);
      thumb.classList.add('is-ready');
    } else {
      jobs.push({ spec, cacheKey, thumbCanvas: thumb });
    }
  }

  catalogRowJobs.set(rowEl, jobs);
  if (catalogRowObserver && token === catalogRenderToken) {
    catalogRowObserver.observe(rowEl);
  }
  return rowEl;
}

function appendCatalogRows(count: number, token: number): void {
  if (token !== catalogRenderToken || catalogModal.hidden) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    frag.appendChild(buildCatalogRowElement(catalogRowsLoaded, token));
    catalogRowsLoaded++;
  }
  catalogGrid.appendChild(frag);
}

function rebuildCatalogGrid(resetScroll = false): void {
  cancelCatalogRender();
  updateCatalogHeader();
  catalogRowsLoaded = 0;
  catalogGrid.replaceChildren();
  if (resetScroll) {
    catalogBody.scrollTop = 0;
  }

  const token = catalogRenderToken;

  // Lazy-render each row of 10 ONLY as it nears or enters the scroll viewport!
  catalogRowObserver = new IntersectionObserver(
    (entries) => {
      if (token !== catalogRenderToken || catalogModal.hidden) return;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const jobs = catalogRowJobs.get(entry.target);
        if (jobs && jobs.length > 0) {
          catalogRowJobs.delete(entry.target);
          enqueueCatalogJobs(jobs, token);
        }
        catalogRowObserver?.unobserve(entry.target);
      }
    },
    { root: catalogBody, rootMargin: '280px 0px', threshold: 0.01 },
  );

  appendCatalogRows(INITIAL_CATALOG_ROWS, token);

  // Infinite lazy scroll sentinel appends +4 rows whenever you scroll near the bottom!
  catalogSentinelObserver = new IntersectionObserver(
    (entries) => {
      if (token !== catalogRenderToken || catalogModal.hidden) return;
      if (entries.some((e) => e.isIntersecting) && catalogRowsLoaded < 60) {
        appendCatalogRows(LAZY_ROWS_BATCH, token);
      }
    },
    { root: catalogBody, rootMargin: '420px 0px' },
  );
  catalogSentinelObserver.observe(catSentinel);
}

function scheduleCatalogRebuild(delayMs = 70): void {
  if (catalogDebounceId !== null) window.clearTimeout(catalogDebounceId);
  catalogDebounceId = window.setTimeout(() => {
    catalogDebounceId = null;
    if (!catalogModal.hidden) rebuildCatalogGrid(false);
  }, delayMs);
}

const setCatalogOpen = (open: boolean) => {
  catalogModal.hidden = !open;
  btnCatalog.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    setCityOpen(false);
    setHelpOpen(false);
    setDebugOpen(false);
    rebuildCatalogGrid(true);
  } else {
    cancelCatalogRender();
  }
};

// ----------------------------------------------------------------------------
// Architectural Paper City View (Hills, Contours, Randomized Streets & Foldable Buildings)
// ----------------------------------------------------------------------------
let cityView: CityView | null = null;
let cityActive = false;
let citySeed = mixSeed;
const pCityStyle = params.get('cityStyle');
let cityStreetStyle: CityStreetStyle =
  pCityStyle !== null && ALL_CITY_STREET_STYLES.includes(pCityStyle as CityStreetStyle)
    ? (pCityStyle as CityStreetStyle)
    : 'organic';
const pHills = params.get('hills');
let cityHills =
  pHills !== null && Number.isFinite(Number(pHills))
    ? Math.max(0, Math.min(1, Number(pHills) > 1 ? Number(pHills) / 100 : Number(pHills)))
    : 0.55;
let cityBuiltKey = '';
let cityRebuildDebounce: number | null = null;
const CITY_DEFAULT_STATUS = 'Drag to orbit · Shift-drag to pan · Click any house to fold';

function getCityBuildKey(): string {
  return `${citySeed}|${cityStreetStyle}|${Math.round(cityHills * 100)}|${mixConsistency === null ? 'd' : Math.round(mixConsistency * 100)}|${mixWindow ?? 'a'}|${mixWinOpening ?? 'a'}|${mixWinDetail ?? 'a'}`;
}

function updateCityHud(layout?: CityLayout | null): void {
  const lay = layout ?? cityView?.layout ?? null;
  citySeedInput.value = String(citySeed);
  for (const btn of cityStyleBtns) {
    btn.classList.toggle('active', btn.dataset.cityStyle === cityStreetStyle);
  }
  const hPct = Math.round(cityHills * 100);
  cityHillsInput.value = String(hPct);
  cityHillsVal.textContent = `${hPct}%`;
  cityColorBtn.setAttribute('aria-pressed', debugColorEnabled ? 'true' : 'false');
  const folded = (cityView?.getFoldTarget() ?? 1) === 1;
  cityFoldBtn.textContent = folded ? 'Unfold' : 'Fold';
  const styleLabel = cityStreetStyle === 'organic' ? 'Organic' : cityStreetStyle === 'grid' ? 'Grid' : 'Radial';
  if (lay) {
    citySubtitle.textContent = `Seed ${citySeed} · ${lay.plots.length} plots · ${lay.rooftopCount} roofs · ${styleLabel}`;
  } else {
    citySubtitle.textContent = `Seed ${citySeed} · ${styleLabel}`;
  }
}

function ensureCityView(): CityView {
  if (cityView) return cityView;
  cityView = new CityView(renderer.capabilities.getMaxAnisotropy(), sharedEnvTexture, {
    onLayoutBuilt: (layout) => {
      updateCityHud(layout);
    },
    onHoverPlot: (plot: CityBuildingPlot | null) => {
      if (!plot) {
        cityStatus.textContent = CITY_DEFAULT_STATUS;
        return;
      }
      const s = plot.spec;
      const wingSuffix =
        s.topology === 'village' && s.village ? ` · ${s.village.count} houses` : ` · ${s.roofType}`;
      cityStatus.textContent = `${s.label}${wingSuffix} · Click to fold`;
    },
    onSelectPlot: (plot: CityBuildingPlot) => {
      setCityOpen(false);
      selectCatalogSpecimen(`city_${plot.id}`, plot.generation, plot.mixOpts);
    },
  });
  const rect = canvas.getBoundingClientRect();
  cityView.resize(Math.max(1, rect.width), Math.max(1, rect.height));
  cityView.setColorEnabled(debugColorEnabled);
  cityView.setSpinEnabled(debugSpinEnabled);
  cityView.setWindowOpen(mixWinOpenMode, mixWinOpen);
  return cityView;
}

function rebuildCity(animateWave = true): void {
  const cv = ensureCityView();
  cv.setColorEnabled(debugColorEnabled);
  cv.setSpinEnabled(debugSpinEnabled);
  cv.setWindowOpen(mixWinOpenMode, mixWinOpen);
  const layout = cv.rebuild(
    {
      seed: citySeed,
      style: cityStreetStyle,
      hills: cityHills,
      consistency: mixConsistency,
      windowStyle: mixWindow,
      windowOpening: mixWinOpening,
      windowDetail: mixWinDetail,
    },
    animateWave,
  );
  cityBuiltKey = getCityBuildKey();
  cityStatus.textContent = CITY_DEFAULT_STATUS;
  updateCityHud(layout);
}

function scheduleCityRebuild(delayMs = 90): void {
  if (cityRebuildDebounce !== null) window.clearTimeout(cityRebuildDebounce);
  cityRebuildDebounce = window.setTimeout(() => {
    cityRebuildDebounce = null;
    if (cityActive) rebuildCity(false);
  }, delayMs);
}

function setCityOpen(open: boolean, animateWave = true): void {
  if (open === cityActive) return;
  cityActive = open;
  document.documentElement.classList.toggle('city-mode', open);
  cityBar.hidden = !open;
  cityStatus.hidden = !open;
  btnCity.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    if (!catalogModal.hidden) setCatalogOpen(false);
    setHelpOpen(false);
    setDebugOpen(false);
    const cv = ensureCityView();
    cv.setColorEnabled(debugColorEnabled);
    cv.setSpinEnabled(debugSpinEnabled);
    cv.setWindowOpen(mixWinOpenMode, mixWinOpen);
    const nextKey = getCityBuildKey();
    if (!cv.layout || cityBuiltKey !== nextKey) {
      rebuildCity(animateWave);
    } else if (animateWave) {
      cv.replayFoldWave();
      updateCityHud(cv.layout);
    } else {
      updateCityHud(cv.layout);
    }
  } else {
    canvas.style.cursor = 'grab';
  }
}

btnCity.addEventListener('click', (e) => {
  e.stopPropagation();
  setCityOpen(!cityActive);
});
dbgOpenCity.addEventListener('click', () => {
  setCityOpen(true);
});
cityClose.addEventListener('click', () => setCityOpen(false));
citySeedPrev.addEventListener('click', () => {
  citySeed = Math.max(0, citySeed - 1);
  rebuildCity(true);
});
citySeedNext.addEventListener('click', () => {
  citySeed = Math.min(99999, citySeed + 1);
  rebuildCity(true);
});
citySeedInput.addEventListener('change', () => {
  const next = Math.max(0, Math.min(99999, Math.round(Number(citySeedInput.value) || 0)));
  if (next === citySeed) {
    citySeedInput.value = String(citySeed);
    return;
  }
  citySeed = next;
  rebuildCity(true);
});
citySeedRoll.addEventListener('click', () => {
  citySeed = rollRandomSeed();
  rebuildCity(true);
});
for (const btn of cityStyleBtns) {
  btn.addEventListener('click', () => {
    const raw = btn.dataset.cityStyle;
    if (!raw || !ALL_CITY_STREET_STYLES.includes(raw as CityStreetStyle) || raw === cityStreetStyle) return;
    cityStreetStyle = raw as CityStreetStyle;
    rebuildCity(true);
  });
}
cityHillsInput.addEventListener('input', () => {
  const pct = Math.max(0, Math.min(100, Number(cityHillsInput.value) || 0));
  cityHills = pct / 100;
  cityHillsVal.textContent = `${pct}%`;
  scheduleCityRebuild(80);
});
cityFoldBtn.addEventListener('click', () => {
  if (!cityView) return;
  const next: 0 | 1 = cityView.getFoldTarget() === 1 ? 0 : 1;
  cityView.setCityFold(next, false);
  updateCityHud();
});
cityColorBtn.addEventListener('click', () => {
  debugColorEnabled = !debugColorEnabled;
  syncDebugControls();
  saveDebugSettings();
  applyActiveOutsideColor();
  cityView?.setColorEnabled(debugColorEnabled);
  updateCityHud();
});

btnCatalog.addEventListener('click', (e) => {
  e.stopPropagation();
  setCatalogOpen(catalogModal.hidden);
});
catalogClose.addEventListener('click', () => setCatalogOpen(false));
catSeedPrev.addEventListener('click', () => {
  setSeedValue(Math.max(0, mixSeed - 1));
});
catSeedNext.addEventListener('click', () => {
  setSeedValue(Math.min(99999, mixSeed + 1));
});
catSeedInput.addEventListener('change', () => {
  setSeedValue(Number(catSeedInput.value) || 0);
});
catSeedRoll.addEventListener('click', () => {
  setSeedValue(rollRandomSeed());
});
catSeedCurated.addEventListener('click', () => {
  setSeedValue(0);
});
catConsistency.addEventListener('input', () => {
  const pct = Math.max(0, Math.min(100, Number(catConsistency.value) || 0));
  forcedModelSlot = null;
  mixConsistency = pct / 100;
  dbgConsistency.value = String(pct);
  dbgConsistencyVal.textContent = `${pct}%`;
  catConsistencyVal.textContent = `${pct}%`;
  updateCatalogHeader();
  saveDebugSettings();
  scheduleCatalogRebuild(65);
});
catConsistency.addEventListener('change', () => {
  const pct = Math.max(0, Math.min(100, Number(catConsistency.value) || 0));
  const nextC = pct / 100;
  if (mixConsistency === nextC && forcedModelSlot === null && catalogDebounceId === null) return;
  forcedModelSlot = null;
  mixConsistency = nextC;
  remountWithCurrentMix(true);
});
catView3d.addEventListener('click', () => {
  if (catalogViewMode === '3d') return;
  catalogViewMode = '3d';
  rebuildCatalogGrid(false);
});
catViewFlat.addEventListener('click', () => {
  if (catalogViewMode === 'flat') return;
  catalogViewMode = 'flat';
  rebuildCatalogGrid(false);
});
catColorBtn.addEventListener('click', () => {
  debugColorEnabled = !debugColorEnabled;
  syncDebugControls();
  saveDebugSettings();
  applyActiveOutsideColor();
  rebuildCatalogGrid(false);
});

const setDebugOpen = (open: boolean) => {
  debugPanel.hidden = !open;
  btnDebug.setAttribute('aria-expanded', open ? 'true' : 'false');
};
btnDebug.addEventListener('click', (e) => {
  e.stopPropagation();
  setDebugOpen(debugPanel.hidden);
});
debugClose.addEventListener('click', () => setDebugOpen(false));
dbgModel.addEventListener('change', () => {
  const val = dbgModel.value;
  selectModelSlot(val === 'auto' ? null : Math.max(1, Math.min(MODEL_PRESETS.length, Number(val) || 1)));
});
for (const btn of dbgHouseBtns) {
  btn.addEventListener('click', () => {
    const raw = btn.dataset.houses;
    forcedModelSlot = null;
    mixHouses = raw && ['1', '2', '3', '4'].includes(raw) ? (Number(raw) as 1 | 2 | 3 | 4) : null;
    if (mixHouses !== null && mixHouses >= 2) {
      mixTopology = 'village';
      if (mixSeed === 0) mixSeed = 1;
    } else if (mixHouses === 1 && mixTopology === 'village') {
      mixTopology = null;
    }
    remountWithCurrentMix(true);
  });
}
dbgTopology.addEventListener('change', () => {
  const raw = dbgTopology.value;
  forcedModelSlot = null;
  mixTopology = raw === 'auto' ? null : (raw as NetTopology);
  if (mixTopology === 'village') {
    if (!mixHouses || mixHouses === 1) mixHouses = 3;
    if (mixSeed === 0) mixSeed = 1;
  } else if (mixTopology !== null && mixHouses && mixHouses >= 2) {
    mixHouses = 1;
  }
  remountWithCurrentMix(true);
});
dbgRoof.addEventListener('change', () => {
  const raw = dbgRoof.value;
  forcedModelSlot = null;
  if (raw === 'auto') {
    mixRoof = null;
    mixGableProfile = null;
  } else if (raw.startsWith('gable:')) {
    mixRoof = 'gable';
    mixGableProfile = raw.slice(6) as GableProfile;
  } else {
    mixRoof = raw as RoofType;
    mixGableProfile = null;
  }
  if (mixHouses && mixHouses >= 2 && mixSeed === 0) mixSeed = 1;
  remountWithCurrentMix(true);
});
dbgWindow.addEventListener('change', () => {
  const raw = dbgWindow.value;
  forcedModelSlot = null;
  mixWindow = raw === 'auto' ? null : (raw as WindowStyle);
  remountWithCurrentMix(true);
});
dbgWinOpening.addEventListener('change', () => {
  const raw = dbgWinOpening.value;
  forcedModelSlot = null;
  mixWinOpening = raw === 'auto' ? null : (raw as WindowOpeningMode);
  remountWithCurrentMix(true);
});
dbgWinDetail.addEventListener('change', () => {
  const raw = dbgWinDetail.value;
  forcedModelSlot = null;
  mixWinDetail = raw === 'auto' ? null : (raw as WindowDetail);
  remountWithCurrentMix(true);
});
for (const btn of dbgWinOpenModeBtns) {
  btn.addEventListener('click', () => {
    const raw = btn.dataset.openMode;
    if (!raw || !ALL_WINDOW_OPEN_MODES.includes(raw as WindowOpenMode)) return;
    mixWinOpenMode = raw as WindowOpenMode;
    syncDebugControls();
    if (rig) rig.setWindowOpen(mixWinOpenMode, mixWinOpen);
    saveDebugSettings();
    if (!catalogModal.hidden) scheduleCatalogRebuild(75);
  });
}
dbgWinOpen.addEventListener('input', () => {
  const pct = Math.max(0, Math.min(100, Number(dbgWinOpen.value) || 0));
  mixWinOpenMode = 'random';
  mixWinOpen = pct / 100;
  syncDebugControls();
  if (rig) rig.setWindowOpen(mixWinOpenMode, mixWinOpen);
  saveDebugSettings();
  if (!catalogModal.hidden) scheduleCatalogRebuild(75);
});
dbgBays.addEventListener('change', () => {
  const raw = dbgBays.value;
  forcedModelSlot = null;
  mixBays = raw === 'auto' ? null : Math.max(1, Math.min(5, Number(raw) || 2));
  remountWithCurrentMix(true);
});
dbgDoor.addEventListener('change', () => {
  const raw = dbgDoor.value;
  forcedModelSlot = null;
  mixDoor = raw === 'auto' ? null : (raw as DoorStyle);
  remountWithCurrentMix(true);
});
dbgLevels.addEventListener('change', () => {
  const raw = dbgLevels.value;
  forcedModelSlot = null;
  mixLevels = raw === 'auto' ? null : (Math.max(1, Math.min(3, Number(raw) || 1)) as 1 | 2 | 3);
  remountWithCurrentMix(true);
});
dbgConsistency.addEventListener('input', () => {
  const pct = Math.max(0, Math.min(100, Number(dbgConsistency.value) || 0));
  forcedModelSlot = null;
  mixConsistency = pct / 100;
  remountWithCurrentMix(true);
});
dbgHeight.addEventListener('input', () => {
  const pct = Math.max(75, Math.min(130, Number(dbgHeight.value) || 100));
  forcedModelSlot = null;
  mixHeightScale = pct === 100 ? null : pct / 100;
  remountWithCurrentMix(true);
});
dbgSeed.addEventListener('change', () => {
  setSeedValue(Number(dbgSeed.value) || 0);
});
dbgShuffle.addEventListener('click', () => {
  setSeedValue(rollRandomSeed());
});
dbgOpenCatalog.addEventListener('click', () => {
  setCatalogOpen(true);
});
dbgColor.addEventListener('change', () => {
  debugColorEnabled = dbgColor.checked;
  syncDebugControls();
  saveDebugSettings();
  applyActiveOutsideColor();
  if (!catalogModal.hidden) rebuildCatalogGrid(false);
});
dbgSpin.addEventListener('change', () => {
  debugSpinEnabled = dbgSpin.checked;
  saveDebugSettings();
});
dbgPerspCut.addEventListener('change', () => {
  debugPerspCutEnabled = dbgPerspCut.checked;
  saveDebugSettings();
});
dbgGlideFold.addEventListener('change', () => {
  debugGlideOnFoldEnabled = dbgGlideFold.checked;
  saveDebugSettings();
});
dbgFadeProj.addEventListener('change', () => {
  debugFadeProjEnabled = dbgFadeProj.checked;
  materials.setProjectionFade(computeProjectionFade(computeFoldProgress()));
  saveDebugSettings();
});
dbgResetFactory.addEventListener('click', () => {
  resetToFactory();
});

const setHelpOpen = (open: boolean) => {
  helpModal.hidden = !open;
};
btnHelp.addEventListener('click', (e) => {
  e.stopPropagation();
  setHelpOpen(helpModal.hidden);
});
helpClose.addEventListener('click', () => setHelpOpen(false));
helpModal.addEventListener('click', (e) => {
  if (e.target === helpModal) setHelpOpen(false);
});

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
  const isTyping = activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA';

  if (e.key === 'Escape' && cityActive) {
    setCityOpen(false);
    return;
  }
  if (e.key === 'Escape' && !catalogModal.hidden) {
    setCatalogOpen(false);
    return;
  }
  if (e.key === 'Escape' && !helpModal.hidden) {
    setHelpOpen(false);
    return;
  }
  if (e.key === 'Escape' && !debugPanel.hidden) {
    setDebugOpen(false);
    return;
  }
  if (isTyping) return;

  if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
    e.preventDefault();
    setHelpOpen(helpModal.hidden);
    return;
  }
  if (e.key === 'g' || e.key === 'G') {
    e.preventDefault();
    setCatalogOpen(catalogModal.hidden);
    return;
  }
  if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    setCityOpen(!cityActive);
    return;
  }
  if (cityActive || !helpModal.hidden || !catalogModal.hidden) return;

  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    triggerStepAction();
  } else if (e.key === 'f' || e.key === 'F') {
    toggleFoldAll();
  } else if (e.key === 'r' || e.key === 'R') {
    resetAll();
  } else if ((e.key === 'd' || e.key === 'D') && showDebugTrigger) {
    setDebugOpen(debugPanel.hidden);
  }
});

// Resize
let resizeTargetTimer: number | null = null;
function resize(): void {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  cityView?.resize(w, h);
  if (rig) {
    const ideal = computeIdealFraming(rig.net);
    finalDist = ideal.dist;
    finalLookY = ideal.lookY;
    finalShadowExtent = ideal.shadowExtent;
  }
  if (resizeTargetTimer !== null) window.clearTimeout(resizeTargetTimer);
  resizeTargetTimer = window.setTimeout(() => {
    resizeTargetTimer = null;
    ensureProjTargetsSized();
  }, 240);
}
window.addEventListener('resize', resize);
resize();

// Apply optional ?fold=0..1 preset
if (params.has('fold')) {
  applyFoldScrub(Number(params.get('fold')) || 0, true);
  const z = computeAutoZoom(computeFoldProgress());
  targetDist = curDist = z.autoDist;
  targetLookY = curLookY = z.autoLookY;
  curShadowExtent = z.shadowExtent;
  applyShadowFrustum(curShadowExtent);
}
syncCameraFromOrbit();
warmupCutoutPipeline();
syncUI();
if (params.has('city')) {
  setCityOpen(true, !params.has('instant'));
  if (params.has('instant')) {
    ensureCityView().setCityFold(1, true);
  }
} else if (params.has('grid') && !params.has('clean')) {
  setCatalogOpen(true);
}

// Debug hook
(
  window as unknown as {
    __origami?: {
      progress: (v: number) => void;
      fold: (pid: FoldablePanelId, v: number) => void;
      projectNow: (jumpToAerial?: boolean) => void;
      dropCutout: (atSec?: number) => void;
      setColor: (enabled: boolean) => void;
      setModel: (slot: number | null) => void;
      setMix: (opts: HouseMixOptions) => void;
      setSeed: (seed: number) => void;
      setConsistency: (consistency: number | null) => void;
      setWindowOpen: (mode: WindowOpenMode, ratio?: number) => void;
      openCatalog: (open?: boolean) => void;
      openCity: (open?: boolean, opts?: { seed?: number; style?: CityStreetStyle; hills?: number; instant?: boolean }) => void;
      cityView: (yaw: number, pitch: number, dist: number, tx?: number, ty?: number, tz?: number) => void;
      cityFold: (target: 0 | 1, instant?: boolean) => void;
      setSpin: (enabled: boolean) => void;
      setPerspectiveCut: (enabled: boolean) => void;
      setGlideOnFold: (enabled: boolean) => void;
      setFadePrint: (enabled: boolean) => void;
      view: (yaw: number, pitch: number, dist: number) => void;
      info: () => {
        generation: number;
        seed: number;
        consistency: number;
        label: string;
        topology: string;
        roofType: string;
        W: number;
        D: number;
        H: number;
        sheetMm: number;
        foldedHeightMm: number;
        curDist: number;
        finalDist: number;
        yaw: number;
        pitch: number;
      };
    };
  }
).__origami = {
  progress(v: number) {
    applyFoldScrub(v, true);
    if (v > 0.001) {
      curPaperRelief = targetPaperRelief = 1;
      rig.setPaperRelief(1);
      if (rig.hasCutout) {
        cutoutDropState = 'done';
        rig.updateCutoutDrop(99);
      }
    }
    const fp = computeFoldProgress();
    materials.setProjectionFade(computeProjectionFade(fp));
    const z = computeAutoZoom(fp);
    const { minDist, maxDist } = getZoomBounds();
    targetDist = curDist = Math.max(minDist, Math.min(maxDist, z.autoDist + userZoomDelta));
    targetLookY = curLookY = z.autoLookY;
    curShadowExtent = z.shadowExtent;
    applyShadowFrustum(curShadowExtent);
    syncCameraFromOrbit();
    if (fp >= 0.999) {
      schedulePrepareNext(generation + 1, 80);
    }
    syncUI();
  },
  fold(pid: FoldablePanelId, v: number) {
    triggerCutoutDrop();
    const ps = panelState.get(pid);
    if (ps) {
      ps.delay = 0;
      ps.animating = false;
      ps.fold = v;
      ps.startFold = v;
      ps.target = v;
      syncUI();
    }
  },
  projectNow(jumpToAerial = false) {
    projectAndSpawnUnderneath(jumpToAerial);
  },
  dropCutout(atSec?: number) {
    if (atSec !== undefined) {
      revealCreasesAfterSwap();
      curPaperRelief = targetPaperRelief = 1;
      rig.setPaperRelief(1);
      cutoutDropState = 'falling';
      cutoutDropElapsed = atSec;
      const alive = rig.updateCutoutDrop(atSec);
      if (!alive) cutoutDropState = 'done';
    } else {
      triggerCutoutDrop();
    }
  },
  setColor(enabled: boolean) {
    debugColorEnabled = Boolean(enabled);
    syncDebugControls();
    saveDebugSettings();
    applyActiveOutsideColor();
  },
  setModel(slot: number | null) {
    selectModelSlot(slot);
  },
  setMix(opts: HouseMixOptions) {
    forcedModelSlot = opts.slot ?? null;
    mixHouses = opts.houses ?? null;
    mixTopology = opts.topology ?? null;
    mixRoof = opts.roofType ?? null;
    mixGableProfile = opts.gableProfile ?? null;
    mixWindow = opts.windowStyle ?? null;
    mixWinOpening = opts.windowOpening ?? null;
    mixWinDetail = opts.windowDetail ?? null;
    mixBays = opts.windowCount ?? null;
    mixDoor = opts.doorStyle ?? null;
    mixLevels = opts.levels ?? null;
    mixHeightScale = opts.heightScale ?? null;
    mixConsistency = opts.consistency ?? null;
    mixSeed = opts.seed ?? 0;
    remountWithCurrentMix(true);
  },
  setSeed(seed: number) {
    setSeedValue(seed, true);
  },
  setConsistency(consistency: number | null) {
    forcedModelSlot = null;
    mixConsistency = consistency === null ? null : Math.max(0, Math.min(1, consistency));
    remountWithCurrentMix(true);
  },
  setWindowOpen(mode: WindowOpenMode, ratio = mixWinOpen) {
    mixWinOpenMode = mode;
    mixWinOpen = Math.max(0, Math.min(1, ratio));
    syncDebugControls();
    saveDebugSettings();
    if (rig) rig.setWindowOpen(mixWinOpenMode, mixWinOpen);
  },
  openCatalog(open = true) {
    setCatalogOpen(open);
  },
  openCity(open = true, opts?: { seed?: number; style?: CityStreetStyle; hills?: number; instant?: boolean }) {
    if (opts?.seed !== undefined) citySeed = Math.max(0, Math.min(99999, Math.round(opts.seed)));
    if (opts?.style !== undefined && ALL_CITY_STREET_STYLES.includes(opts.style)) cityStreetStyle = opts.style;
    if (opts?.hills !== undefined) cityHills = Math.max(0, Math.min(1, opts.hills));
    setCityOpen(open, !opts?.instant);
    if (open && opts?.instant) {
      rebuildCity(false);
      ensureCityView().setCityFold(1, true);
    }
  },
  cityView(yaw: number, pitch: number, dist: number, tx = 0, ty = 2.2, tz = 0) {
    cityView?.setCameraView(yaw, pitch, dist, tx, ty, tz);
  },
  cityFold(target: 0 | 1, instant = false) {
    cityView?.setCityFold(target, instant);
    updateCityHud();
  },
  setSpin(enabled: boolean) {
    debugSpinEnabled = enabled;
    syncDebugControls();
    saveDebugSettings();
  },
  setPerspectiveCut(enabled: boolean) {
    debugPerspCutEnabled = Boolean(enabled);
    syncDebugControls();
    saveDebugSettings();
  },
  setGlideOnFold(enabled: boolean) {
    debugGlideOnFoldEnabled = Boolean(enabled);
    syncDebugControls();
    saveDebugSettings();
  },
  setFadePrint(enabled: boolean) {
    debugFadeProjEnabled = Boolean(enabled);
    materials.setProjectionFade(computeProjectionFade(computeFoldProgress()));
    syncDebugControls();
    saveDebugSettings();
  },
  view(yaw: number, pitch: number, dist: number) {
    targetYaw = curYaw = yaw;
    targetPitch = curPitch = pitch;
    swapDist = finalDist = targetDist = curDist = dist;
    userZoomDelta = 0;
    syncCameraFromOrbit();
  },
  info() {
    const s = rig.net.spec;
    return {
      generation,
      seed: mixSeed,
      consistency: Math.round((s.consistency ?? 0.72) * 100) / 100,
      label: s.label,
      topology: s.topology,
      roofType: s.roofType,
      W: Math.round(s.W * 10) / 10,
      D: Math.round(s.D * 10) / 10,
      H: Math.round(s.H * 10) / 10,
      sheetMm: rig.net.sheetHalfMm * 2,
      foldedHeightMm: Math.round(rig.net.foldedHeightMm * 10) / 10,
      curDist: Math.round(curDist * 10) / 10,
      finalDist: Math.round(finalDist * 10) / 10,
      yaw: Math.round(curYaw * 1000) / 1000,
      pitch: Math.round(curPitch * 1000) / 1000,
    };
  },
};

// Main animation loop (crisp paper-crease spring physics + smooth final-stage zoom-out + zero-transition projection!)
let lastTime = performance.now();

function animate(now: number): void {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) * 0.001);
  lastTime = now;

  if (cityActive && cityView) {
    cityView.update(dt);
    renderer.render(cityView.scene, cityView.camera);
    return;
  }

  // 1. Update panel folds (slower cubic-bezier curved stagger wave + gentle scrub follow!)
  let foldChanged = false;
  for (const pid of rig.panelIds) {
    const ps = panelState.get(pid)!;

    if (drag.kind !== 'fold' || drag.panel !== pid) {
      if (ps.animating) {
        if (ps.delay > 0) {
          ps.delay = Math.max(0, ps.delay - dt);
        } else {
          ps.animElapsed += dt;
          const u = clamp01(ps.animElapsed / ps.animDuration);
          const eased = easePaperFold(u);
          ps.fold = ps.startFold + (ps.target - ps.startFold) * eased;
          if (u >= 1) {
            ps.fold = ps.target;
            ps.animating = false;
          }
        }
        foldChanged = true;
      } else {
        const diff = ps.target - ps.fold;
        if (Math.abs(diff) > 0.0004) {
          ps.fold += diff * (1 - Math.exp(-dt * 7.5));
          if (Math.abs(ps.target - ps.fold) <= 0.0008) ps.fold = ps.target;
          foldChanged = true;
        }
      }
    }

    const wantPeek = hoveredPanel === pid && drag.kind === 'none' ? 1 : 0;
    ps.peek += (wantPeek - ps.peek) * (1 - Math.exp(-dt * 14));
    const peekRad = ps.peek * (ps.fold > 0.5 ? -0.055 : 0.085);

    rig.updatePanelVisual(pid, ps.fold, peekRad, hoveredPanel === pid);
  }

  const foldProg = computeFoldProgress();
  materials.setProjectionFade(computeProjectionFade(foldProg));
  if (foldChanged && !isScrubbing) {
    progressRange.value = foldProg.toFixed(3);
  }

  // 2. Animate falling outer cutout sheet + punched window chads (drops cleanly just before folding!)
  if (cutoutDropState === 'falling') {
    cutoutDropElapsed += dt;
    const stillFalling = rig.updateCutoutDrop(cutoutDropElapsed);
    if (!stillFalling) {
      cutoutDropState = 'done';
    }
  }

  // 3. Gentle continuous turntable spin + smooth per-slide view shift + final-stage zoom-out!
  if (debugSpinEnabled && drag.kind === 'none' && !justProjected && helpModal.hidden && catalogModal.hidden) {
    targetYaw += dt * AUTO_SPIN_RAD_PER_SEC;
  }

  const sRaw = clamp01((foldProg - 0.12) / 0.80);
  const slideEase = sRaw * sRaw * (3 - 2 * sRaw);
  const dSlide = slideEase - prevSlideEase;
  if (debugGlideOnFoldEnabled && Math.abs(dSlide) > 1e-6) {
    targetYaw += dSlide * slideYawDelta;
    targetPitch = Math.max(0.18, Math.min(1.42, targetPitch + dSlide * slidePitchDelta));
  }
  prevSlideEase = slideEase;

  const { autoDist, autoLookY, shadowExtent } = computeAutoZoom(foldProg);
  const { minDist, maxDist } = getZoomBounds();
  targetDist = Math.max(minDist, Math.min(maxDist, autoDist + userZoomDelta));
  targetLookY = autoLookY;

  const camAlpha = 1 - Math.exp(-dt * 4.2);
  curYaw += (targetYaw - curYaw) * camAlpha;
  curPitch += (targetPitch - curPitch) * camAlpha;
  curDist += (targetDist - curDist) * camAlpha;
  curLookY += (targetLookY - curLookY) * camAlpha;
  syncCameraFromOrbit();

  if (Math.abs(targetPaperRelief - curPaperRelief) > 0.002) {
    curPaperRelief += (targetPaperRelief - curPaperRelief) * (1 - Math.exp(-dt * 16));
    if (Math.abs(targetPaperRelief - curPaperRelief) <= 0.004) curPaperRelief = targetPaperRelief;
    rig.setPaperRelief(curPaperRelief);
  }

  if (Math.abs(shadowExtent - curShadowExtent) > 0.04) {
    curShadowExtent += (shadowExtent - curShadowExtent) * camAlpha;
    applyShadowFrustum(curShadowExtent);
  }

  // Keep status caption updated & quietly pre-build the next house once settled into 3D!
  if (foldChanged && allPanelsSettledFolded()) {
    schedulePrepareNext(generation + 1, 80);
    syncUI();
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);

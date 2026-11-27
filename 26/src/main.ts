import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  ALL_DOOR_STYLES,
  ALL_GABLE_PROFILES,
  ALL_WINDOW_DETAILS,
  ALL_WINDOW_OPEN_MODES,
  ALL_WINDOW_OPENINGS,
  ALL_WINDOW_STYLES,
  MM,
  MODEL_PRESETS,
  buildHouseNet,
  computeVillageFoldSchedule,
  evaluateFoldedPoint,
  generateHouseSpec,
  getColorSchemesForHouse,
  type BuildingLevels,
  type BuiltHouseNet,
  type DoorStyle,
  type FoldablePanelId,
  type GableProfile,
  type HouseMixOptions,
  type HouseNetSpec,
  type NetTopology,
  type PanelId,
  type PanelNetDef,
  type RoofType,
  type WindowDetail,
  type WindowOpenMode,
  type WindowOpeningMode,
  type WindowStyle,
} from './origamiHouseNet';
import {
  buildOrigamiHouseRig,
  chooseFoldAnchorPanel,
  createOrigamiMaterials,
  createWashiFiberTextures,
  type FoldAnchorKind,
  type FoldAnchorMode,
  type OrigamiHouseRig,
  type OrigamiMaterials,
} from './origamiPaperMesh';
import type { CatalogThumbRenderer, CatalogViewMode } from './catalogThumbRenderer';
import type { CityBuildingPlot } from './cityGenerator';
import type { CityView, CityViewStats } from './cityView';
import {
  DEFAULT_AUTO_FOLD_CURVE,
  DEFAULT_NEXT_FOLD_CURVE,
  DUAL_CURVE_MAX_T,
  buildDualFoldCurveSvg,
  evaluateFoldCurve,
  type FoldCurveShape,
} from './foldCurve';
import {
  fitFlatNetToSilhouetteNDC,
  sampleFoldedHouseSilhouetteNDC,
} from './silhouetteMatch';
import {
  createFoldAmbientSynth,
  type SoundtrackState,
} from './soundtrack';

const THUMB_SIZE = 240;

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
const modeGroup = document.getElementById('mode-group') as HTMLDivElement;
const modeBtns = Array.from(modeGroup.querySelectorAll<HTMLButtonElement>('.mode-btn'));
const btnSound = document.getElementById('btn-sound') as HTMLButtonElement;
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
const dbgCameraTrick = document.getElementById('dbg-camera-trick') as HTMLSelectElement;
const dbgGlideFold = document.getElementById('dbg-glide-fold') as HTMLInputElement;
const dbgAnchorModeGroup = document.getElementById('dbg-anchor-mode') as HTMLDivElement;
const dbgAnchorModeBtns = Array.from(dbgAnchorModeGroup.querySelectorAll<HTMLButtonElement>('.debug-seg-btn'));
const dbgFadeProj = document.getElementById('dbg-fade-proj') as HTMLInputElement;
const dbgAutoBpm = document.getElementById('dbg-auto-bpm') as HTMLElement;
const dbgCurveBox = document.getElementById('dbg-curve-box') as HTMLDivElement;
const dbgCurveTabs = document.getElementById('dbg-curve-tabs') as HTMLDivElement;
const dbgCurveTabBtns = Array.from(dbgCurveTabs.querySelectorAll<HTMLButtonElement>('.debug-seg-btn'));
const dbgCurvePath = document.getElementById('dbg-curve-path') as unknown as SVGPathElement;
const dbgCurvePath2 = document.getElementById('dbg-curve-path2') as unknown as SVGPathElement;
const dbgCurveOverlap = document.getElementById('dbg-curve-overlap') as unknown as SVGRectElement;
const dbgCurveEnd1 = document.getElementById('dbg-curve-end1') as unknown as SVGLineElement;
const dbgCurveCutoutLine = document.getElementById('dbg-curve-cutout-line') as unknown as SVGLineElement;
const dbgCurveHandoffLine = document.getElementById('dbg-curve-handoff-line') as unknown as SVGLineElement;
const dbgCurveDot = document.getElementById('dbg-curve-dot') as unknown as SVGCircleElement;
const dbgCurveDot2 = document.getElementById('dbg-curve-dot2') as unknown as SVGCircleElement;
const dbgAutoSpeed = document.getElementById('dbg-auto-speed') as HTMLInputElement;
const dbgAutoSpeedVal = document.getElementById('dbg-auto-speed-val') as HTMLElement;
const dbgAutoHandoff = document.getElementById('dbg-auto-handoff') as HTMLInputElement;
const dbgAutoHandoffVal = document.getElementById('dbg-auto-handoff-val') as HTMLElement;
const dbgAutoIn = document.getElementById('dbg-auto-in') as HTMLInputElement;
const dbgAutoInVal = document.getElementById('dbg-auto-in-val') as HTMLElement;
const dbgAutoOut = document.getElementById('dbg-auto-out') as HTMLInputElement;
const dbgAutoOutVal = document.getElementById('dbg-auto-out-val') as HTMLElement;
const dbgAutoCurve = document.getElementById('dbg-auto-curve') as HTMLInputElement;
const dbgAutoCurveVal = document.getElementById('dbg-auto-curve-val') as HTMLElement;
const dbgCutoutDelay = document.getElementById('dbg-cutout-delay') as HTMLInputElement;
const dbgCutoutDelayVal = document.getElementById('dbg-cutout-delay-val') as HTMLElement;
const dbgShadowStrength = document.getElementById('dbg-shadow-strength') as HTMLInputElement;
const dbgShadowStrengthVal = document.getElementById('dbg-shadow-strength-val') as HTMLElement;
const dbgShadowBlur = document.getElementById('dbg-shadow-blur') as HTMLInputElement;
const dbgShadowBlurVal = document.getElementById('dbg-shadow-blur-val') as HTMLElement;
const dbgSunAzimuth = document.getElementById('dbg-sun-azimuth') as HTMLInputElement;
const dbgSunAzimuthVal = document.getElementById('dbg-sun-azimuth-val') as HTMLElement;
const dbgSunElevation = document.getElementById('dbg-sun-elevation') as HTMLInputElement;
const dbgSunElevationVal = document.getElementById('dbg-sun-elevation-val') as HTMLElement;
const dbgShuffle = document.getElementById('dbg-shuffle') as HTMLButtonElement;
const dbgOpenCatalog = document.getElementById('dbg-open-catalog') as HTMLButtonElement;
const dbgOpenCity = document.getElementById('dbg-open-city') as HTMLButtonElement;
const dbgResetFactory = document.getElementById('dbg-reset-factory') as HTMLButtonElement;

// Interactive Mountain Island Diorama DOM references
const cityBar = document.getElementById('city-bar') as HTMLElement;
const citySubtitle = document.getElementById('city-subtitle') as HTMLSpanElement;
const citySeedPrev = document.getElementById('city-seed-prev') as HTMLButtonElement;
const citySeedInput = document.getElementById('city-seed-input') as HTMLInputElement;
const citySeedNext = document.getElementById('city-seed-next') as HTMLButtonElement;
const citySeedRoll = document.getElementById('city-seed-roll') as HTMLButtonElement;
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

const SETTINGS_STORAGE_KEY = 'codevember-2026:01:settings:v7';

const VALID_TOPOLOGIES: readonly NetTopology[] = ['cross', 'ribbon', 'hex', 'oct', 'lwing', 'setback', 'village'];
const VALID_ROOFS: readonly RoofType[] = ['gable', 'mansard', 'spire', 'hip', 'shed', 'flat', 'butterfly', 'sawtooth'];
type CameraTrickMode = 'off' | 'balanced' | 'drastic' | 'overhead' | 'rolled' | 'low' | 'subtle';
const VALID_CAMERA_TRICKS: readonly CameraTrickMode[] = [
  'off',
  'balanced',
  'drastic',
  'overhead',
  'rolled',
  'low',
  'subtle',
];

type PlayMode = 'manual' | 'slow' | 'fast' | 'reverse';
const VALID_PLAY_MODES: readonly PlayMode[] = ['manual', 'slow', 'fast', 'reverse'];
const SLOW_HOLD_SEC = 3.0;

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
  levels: BuildingLevels | null;
  heightScale: number | null;
  consistency: number | null;
  seed: number;
  color: boolean;
  spin: boolean;
  playMode: PlayMode;
  reverseFold: boolean;
  cameraTrick: CameraTrickMode;
  glideOnFold: boolean;
  anchorMode: FoldAnchorMode;
  fadeProjOnFold: boolean;
  autoFold: boolean;
  autoSpeed: number;
  autoEaseIn: number;
  autoEaseOut: number;
  autoCurve: number;
  autoEaseIn2: number;
  autoEaseOut2: number;
  autoCurve2: number;
  autoHandoff: number;
  cutoutDropDelay: number;
  shadowStrength: number;
  shadowBlur: number;
  sunAzimuth: number;
  sunElevation: number;
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
  color: true,
  spin: true,
  playMode: 'slow',
  reverseFold: false,
  cameraTrick: 'balanced',
  glideOnFold: false,
  anchorMode: 'subtle',
  fadeProjOnFold: false,
  autoFold: true,
  autoSpeed: DEFAULT_AUTO_FOLD_CURVE.speed,
  autoEaseIn: DEFAULT_AUTO_FOLD_CURVE.inPct,
  autoEaseOut: DEFAULT_AUTO_FOLD_CURVE.outPct,
  autoCurve: DEFAULT_AUTO_FOLD_CURVE.curvePct,
  autoEaseIn2: DEFAULT_NEXT_FOLD_CURVE.inPct,
  autoEaseOut2: DEFAULT_NEXT_FOLD_CURVE.outPct,
  autoCurve2: DEFAULT_NEXT_FOLD_CURVE.curvePct,
  autoHandoff: DEFAULT_AUTO_FOLD_CURVE.handoffPct,
  cutoutDropDelay: 0.55,
  shadowStrength: 165,
  shadowBlur: 0.0,
  sunAzimuth: 62,
  sunElevation: 49,
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
      if (
        parsed.levels === null ||
        parsed.levels === 1 ||
        parsed.levels === 2 ||
        parsed.levels === 3 ||
        parsed.levels === 4 ||
        parsed.levels === 5 ||
        parsed.levels === 6
      ) {
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
      if (typeof parsed.reverseFold === 'boolean') s.reverseFold = parsed.reverseFold;
      if (typeof parsed.cameraTrick === 'string' && VALID_CAMERA_TRICKS.includes(parsed.cameraTrick as CameraTrickMode)) {
        s.cameraTrick = parsed.cameraTrick as CameraTrickMode;
      }
      if (typeof parsed.glideOnFold === 'boolean') s.glideOnFold = parsed.glideOnFold;
      if (parsed.anchorMode === 'rest' || parsed.anchorMode === 'subtle' || parsed.anchorMode === 'floor') {
        s.anchorMode = parsed.anchorMode;
      }
      if (typeof parsed.fadeProjOnFold === 'boolean') s.fadeProjOnFold = parsed.fadeProjOnFold;
      if (typeof parsed.autoFold === 'boolean') s.autoFold = parsed.autoFold;
      if (typeof parsed.playMode === 'string' && VALID_PLAY_MODES.includes(parsed.playMode as PlayMode)) {
        s.playMode = parsed.playMode as PlayMode;
      } else if (typeof parsed.reverseFold === 'boolean' || typeof parsed.autoFold === 'boolean') {
        s.playMode = s.reverseFold ? 'reverse' : s.autoFold ? 'fast' : 'manual';
      }
      s.autoFold = s.playMode !== 'manual';
      s.reverseFold = s.playMode === 'reverse';
      if (typeof parsed.autoSpeed === 'number' && Number.isFinite(parsed.autoSpeed)) {
        s.autoSpeed = Math.max(0.25, Math.min(3.0, parsed.autoSpeed));
      }
      if (typeof parsed.autoEaseIn === 'number' && Number.isFinite(parsed.autoEaseIn)) {
        s.autoEaseIn = Math.max(0, Math.min(100, parsed.autoEaseIn));
      }
      if (typeof parsed.autoEaseOut === 'number' && Number.isFinite(parsed.autoEaseOut)) {
        s.autoEaseOut = Math.max(0, Math.min(100, parsed.autoEaseOut));
      }
      if (typeof parsed.autoCurve === 'number' && Number.isFinite(parsed.autoCurve)) {
        s.autoCurve = Math.max(0, Math.min(100, parsed.autoCurve));
      }
      if (typeof parsed.autoEaseIn2 === 'number' && Number.isFinite(parsed.autoEaseIn2)) {
        s.autoEaseIn2 = Math.max(0, Math.min(100, parsed.autoEaseIn2));
      }
      if (typeof parsed.autoEaseOut2 === 'number' && Number.isFinite(parsed.autoEaseOut2)) {
        s.autoEaseOut2 = Math.max(0, Math.min(100, parsed.autoEaseOut2));
      }
      if (typeof parsed.autoCurve2 === 'number' && Number.isFinite(parsed.autoCurve2)) {
        s.autoCurve2 = Math.max(0, Math.min(100, parsed.autoCurve2));
      }
      if (typeof parsed.autoHandoff === 'number' && Number.isFinite(parsed.autoHandoff)) {
        s.autoHandoff = Math.max(35, Math.min(140, parsed.autoHandoff));
      }
      if (typeof parsed.cutoutDropDelay === 'number' && Number.isFinite(parsed.cutoutDropDelay)) {
        s.cutoutDropDelay = Math.max(0, Math.min(2.5, parsed.cutoutDropDelay));
      }
      if (typeof parsed.shadowStrength === 'number' && Number.isFinite(parsed.shadowStrength)) {
        s.shadowStrength = Math.max(0, Math.min(200, parsed.shadowStrength));
      }
      if (typeof parsed.shadowBlur === 'number' && Number.isFinite(parsed.shadowBlur)) {
        s.shadowBlur = Math.max(0, Math.min(8, parsed.shadowBlur));
      }
      if (typeof parsed.sunAzimuth === 'number' && Number.isFinite(parsed.sunAzimuth)) {
        s.sunAzimuth = ((parsed.sunAzimuth % 360) + 360) % 360;
      }
      if (typeof parsed.sunElevation === 'number' && Number.isFinite(parsed.sunElevation)) {
        s.sunElevation = Math.max(12, Math.min(85, parsed.sunElevation));
      }
    }
  } catch {
    // Ignore storage access errors (private mode, restricted iframe, etc.)
  }
  return s;
}

const isDebugMode = params.has('debug');
const initialSettings = isDebugMode ? loadSavedSettings() : { ...FACTORY_SETTINGS };
const topActionsEl = document.querySelector<HTMLDivElement>('.top-actions');
const bottomRightEl = document.querySelector<HTMLDivElement>('.bottom-right');
if (topActionsEl) topActionsEl.hidden = !isDebugMode;
if (bottomRightEl) bottomRightEl.hidden = !isDebugMode;
btnDebug.hidden = !isDebugMode;

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
let mixLevels: BuildingLevels | null =
  pLevels !== null && ['1', '2', '3', '4', '5', '6'].includes(pLevels)
    ? (Number(pLevels) as BuildingLevels)
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
function pickRandomStartupSeed(): number {
  return Math.floor(1 + Math.random() * 9998);
}

const hasSavedDebugSeed =
  isDebugMode &&
  (() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as Partial<DebugSettings>;
      return typeof parsed.seed === 'number' && Number.isFinite(parsed.seed);
    } catch {
      return false;
    }
  })();

let mixSeed =
  params.get('seed') !== null
    ? Math.max(0, Math.min(99999, Math.round(Number(params.get('seed')) || 0)))
    : hasSavedDebugSeed
      ? initialSettings.seed
      : pickRandomStartupSeed();
let debugColorEnabled =
  params.get('color') !== null ? params.get('color') !== '0' : initialSettings.color;
let debugSpinEnabled =
  params.get('spin') !== null ? params.get('spin') !== '0' : initialSettings.spin;
const pModeRaw = params.get('mode')?.toLowerCase() ?? null;
function resolveInitialPlayMode(): PlayMode {
  if (pModeRaw === 'manual' || pModeRaw === 'fold') return 'manual';
  if (pModeRaw === 'slow') return 'slow';
  if (pModeRaw === 'fast' || pModeRaw === 'mesmerize') return 'fast';
  if (pModeRaw === 'reverse') return 'reverse';
  if (params.get('reverse') !== null) {
    return params.get('reverse') !== '0' ? 'reverse' : params.get('auto') === '0' ? 'manual' : 'fast';
  }
  if (params.get('auto') !== null) {
    return params.get('auto') === '0' ? 'manual' : 'fast';
  }
  return initialSettings.playMode;
}
let playMode: PlayMode = resolveInitialPlayMode();
let debugReverseFoldEnabled = playMode === 'reverse';
const skipIntro =
  params.has('clean') ||
  params.has('fold') ||
  params.has('mode') ||
  params.has('auto') ||
  params.has('reverse') ||
  params.has('city') ||
  params.has('grid');
let introAwaiting = !skipIntro;
let introMenuPending = introAwaiting;
if (introMenuPending) {
  document.documentElement.classList.add('intro-awaiting');
} else {
  document.documentElement.classList.remove('intro-awaiting');
}
function revealIntroMenu(): void {
  if (!introMenuPending) return;
  introMenuPending = false;
  document.documentElement.classList.remove('intro-awaiting');
}
const introHintBaseFold = new Map<FoldablePanelId, number>();
const pCamTrick = params.get('cameraTrick');
let debugCameraTrick: CameraTrickMode =
  pCamTrick !== null && VALID_CAMERA_TRICKS.includes(pCamTrick as CameraTrickMode)
    ? (pCamTrick as CameraTrickMode)
    : params.get('perspCut') !== null
      ? params.get('perspCut') !== '0'
        ? 'drastic'
        : 'off'
      : initialSettings.cameraTrick;
let debugGlideOnFoldEnabled =
  params.get('glide') !== null
    ? params.get('glide') !== '0'
    : params.get('shiftView') !== null
      ? params.get('shiftView') === '1'
      : initialSettings.glideOnFold;
const pAnchorMode = params.get('anchorMode');
let debugAnchorMode: FoldAnchorMode =
  pAnchorMode === 'rest' || pAnchorMode === 'subtle' || pAnchorMode === 'floor'
    ? pAnchorMode
    : initialSettings.anchorMode;
let debugFadeProjEnabled =
  params.get('fadePrint') !== null
    ? params.get('fadePrint') !== '0'
    : initialSettings.fadeProjOnFold;
let autoFoldEnabled = playMode !== 'manual';
const pAutoSpeed = params.get('autoSpeed');
let autoSpeed =
  pAutoSpeed !== null && Number.isFinite(Number(pAutoSpeed))
    ? Math.max(0.25, Math.min(3.0, Number(pAutoSpeed)))
    : initialSettings.autoSpeed;
const pAutoIn = params.get('autoIn');
let autoEaseIn =
  pAutoIn !== null && Number.isFinite(Number(pAutoIn))
    ? Math.max(0, Math.min(100, Number(pAutoIn)))
    : initialSettings.autoEaseIn;
const pAutoOut = params.get('autoOut');
let autoEaseOut =
  pAutoOut !== null && Number.isFinite(Number(pAutoOut))
    ? Math.max(0, Math.min(100, Number(pAutoOut)))
    : initialSettings.autoEaseOut;
const pAutoCurve = params.get('autoCurve');
let autoCurve =
  pAutoCurve !== null && Number.isFinite(Number(pAutoCurve))
    ? Math.max(0, Math.min(100, Number(pAutoCurve)))
    : initialSettings.autoCurve;
const pAutoIn2 = params.get('autoIn2');
let autoEaseIn2 =
  pAutoIn2 !== null && Number.isFinite(Number(pAutoIn2))
    ? Math.max(0, Math.min(100, Number(pAutoIn2)))
    : initialSettings.autoEaseIn2;
const pAutoOut2 = params.get('autoOut2');
let autoEaseOut2 =
  pAutoOut2 !== null && Number.isFinite(Number(pAutoOut2))
    ? Math.max(0, Math.min(100, Number(pAutoOut2)))
    : initialSettings.autoEaseOut2;
const pAutoCurve2 = params.get('autoCurve2');
let autoCurve2 =
  pAutoCurve2 !== null && Number.isFinite(Number(pAutoCurve2))
    ? Math.max(0, Math.min(100, Number(pAutoCurve2)))
    : initialSettings.autoCurve2;
let editingCurveTab: 1 | 2 = 1;
const pAutoHandoff = params.get('autoHandoff');
let autoHandoff =
  pAutoHandoff !== null && Number.isFinite(Number(pAutoHandoff))
    ? Math.max(35, Math.min(140, Number(pAutoHandoff)))
    : initialSettings.autoHandoff;
const pCutoutDelay = params.get('cutoutDelay');
let cutoutDropDelay =
  pCutoutDelay !== null && Number.isFinite(Number(pCutoutDelay))
    ? Math.max(0, Math.min(2.5, Number(pCutoutDelay)))
    : initialSettings.cutoutDropDelay;
const pShadow = params.get('shadow');
let shadowStrength =
  pShadow !== null && Number.isFinite(Number(pShadow))
    ? Math.max(0, Math.min(200, Number(pShadow)))
    : initialSettings.shadowStrength;
const pShadowBlur = params.get('shadowBlur');
let shadowBlur =
  pShadowBlur !== null && Number.isFinite(Number(pShadowBlur))
    ? Math.max(0, Math.min(8, Number(pShadowBlur)))
    : initialSettings.shadowBlur;
const pAzimuth = params.get('azimuth');
let sunAzimuth =
  pAzimuth !== null && Number.isFinite(Number(pAzimuth))
    ? ((Number(pAzimuth) % 360) + 360) % 360
    : initialSettings.sunAzimuth;
const pElevation = params.get('elevation');
let sunElevation =
  pElevation !== null && Number.isFinite(Number(pElevation))
    ? Math.max(12, Math.min(85, Number(pElevation)))
    : initialSettings.sunElevation;
const FOLD_BPM = 115;
const FOLD_BEAT_SEC = 60 / FOLD_BPM; // ~0.52174s per quarter-note beat
const FOLD_BAR_SEC = FOLD_BEAT_SEC * 4; // ~2.08696s bar cadence @ 115 BPM (launches next house around ~74–78%!)
const FOLD_HOUSE_SEC = FOLD_BEAT_SEC * 6.4; // ~3.33913s smooth full fold curve (2.4-beat live texture overlap!)
const SLOW_FOLD_HOUSE_SEC = 2.0; // Crisp 2s fold transition in Slow mode (with 3s pause between slides)
const MANUAL_FOLD_HOUSE_SEC = 1.85; // Snappy reactive fold duration on manual tap (without Auto)
const MANUAL_LEAD_DELAY_SEC = 0; // Immediate zero-lag start when tapping the house manually
// Single smooth cubic-bezier (curvePct <= 50 avoids double-composition velocity cliffs!):
// ultra-short 8% feather prevents staggered panels from slamming from 0 -> max speed while staying instant on tap!
const MANUAL_TAP_FOLD_CURVE: FoldCurveShape = { inPct: 8, outPct: 68, curvePct: 48 };
let activeFoldIsManual = false;
let autoBeatElapsed = 0;
let autoBeatRunning = false;

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

function getAutoHandoffSec(): number {
  return FOLD_HOUSE_SEC * (autoHandoff / 100);
}

const soundtrack = createFoldAmbientSynth();
let soundWanted = params.get('sound') !== '0' && !params.has('mute');
let soundPausedByBlur = false;

function setSoundEnabled(next: boolean, fromBlurPause = false, fadeInSec?: number): Promise<boolean> {
  if (!fromBlurPause) {
    soundWanted = Boolean(next);
    soundPausedByBlur = false;
  }
  btnSound.setAttribute('aria-pressed', next ? 'true' : 'false');
  return soundtrack.setEnabled(next, fadeInSec).then((active) => {
    btnSound.setAttribute('aria-pressed', active ? 'true' : 'false');
    return active;
  });
}

function handleWindowBlurMute(): void {
  if (!soundtrack.getState().enabled) return;
  soundPausedByBlur = true;
  void setSoundEnabled(false, true);
}

function handleWindowFocusResume(): void {
  if (document.hidden) return;
  if (soundWanted && soundPausedByBlur) {
    soundPausedByBlur = false;
    void setSoundEnabled(true, true);
  }
}

window.addEventListener('blur', handleWindowBlurMute);
window.addEventListener('focus', handleWindowFocusResume);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) handleWindowBlurMute();
  else handleWindowFocusResume();
});

// Unlock Web Audio smoothly on the very first user gesture if autoplay was deferred by browser policy
const unlockAudioOnGesture = (e: Event) => {
  if (introAwaiting) return;
  const target = e.target as Node | null;
  if (target && btnSound.contains(target)) return;
  if (soundWanted && !soundPausedByBlur && !document.hidden) {
    soundtrack.resumeIfNeeded();
  }
};
window.addEventListener('pointerdown', unlockAudioOnGesture, { capture: true, passive: true });
window.addEventListener('keydown', unlockAudioOnGesture, { capture: true });

if (!introAwaiting && soundWanted && !document.hidden) {
  void setSoundEnabled(true);
} else {
  btnSound.setAttribute('aria-pressed', soundWanted ? 'true' : 'false');
}

function formatHandoffTag(pct: number): string {
  const rounded = Math.round(pct);
  if (rounded < 100) return `${100 - rounded}% overlap`;
  if (rounded === 100) return 'back-to-back';
  return `+${rounded - 100}% pause`;
}

function getFoldCurve1(): FoldCurveShape {
  return { inPct: autoEaseIn, outPct: autoEaseOut, curvePct: autoCurve };
}

function getFoldCurve2(): FoldCurveShape {
  return { inPct: autoEaseIn2, outPct: autoEaseOut2, curvePct: autoCurve2 };
}

function getCurveForGeneration(gen: number): FoldCurveShape {
  return gen % 2 === 1 ? getFoldCurve1() : getFoldCurve2();
}

function getActiveFoldCurve(): FoldCurveShape {
  return activeFoldIsManual ? MANUAL_TAP_FOLD_CURVE : getCurveForGeneration(generation);
}

function updateCurvePreview(): void {
  const g = buildDualFoldCurveSvg(getFoldCurve1(), getFoldCurve2(), autoHandoff, 220, 58, 8, 7);
  dbgCurvePath.setAttribute('d', g.path1);
  dbgCurvePath2.setAttribute('d', g.path2);
  dbgCurveOverlap.setAttribute('x', g.overlapX.toFixed(1));
  dbgCurveOverlap.setAttribute('width', g.overlapW.toFixed(1));
  dbgCurveEnd1.setAttribute('x1', g.end1X.toFixed(1));
  dbgCurveEnd1.setAttribute('x2', g.end1X.toFixed(1));
  dbgCurveHandoffLine.setAttribute('x1', g.handoffX.toFixed(1));
  dbgCurveHandoffLine.setAttribute('x2', g.handoffX.toFixed(1));
  const cutoutT = Math.min(1, cutoutDropDelay / FOLD_HOUSE_SEC);
  const cutoutX = 8 + (cutoutT / DUAL_CURVE_MAX_T) * 204;
  dbgCurveCutoutLine.setAttribute('x1', cutoutX.toFixed(1));
  dbgCurveCutoutLine.setAttribute('x2', cutoutX.toFixed(1));
  dbgCurveCutoutLine.style.opacity = cutoutDropDelay > 0.005 ? '1' : '0.35';
  dbgCurveBox.classList.toggle('editing-next', editingCurveTab === 2);
  dbgAutoBpm.textContent = formatHandoffTag(autoHandoff);
}

function syncCurveTabSliders(): void {
  const active = editingCurveTab === 1 ? getFoldCurve1() : getFoldCurve2();
  for (const btn of dbgCurveTabBtns) {
    const isSel = btn.dataset.curveTab === String(editingCurveTab);
    btn.classList.toggle('active', isSel);
    btn.setAttribute('aria-selected', isSel ? 'true' : 'false');
  }
  dbgAutoIn.value = String(Math.round(active.inPct));
  dbgAutoInVal.textContent = `${Math.round(active.inPct)}%`;
  dbgAutoOut.value = String(Math.round(active.outPct));
  dbgAutoOutVal.textContent = `${Math.round(active.outPct)}%`;
  dbgAutoCurve.value = String(Math.round(active.curvePct));
  dbgAutoCurveVal.textContent = `${Math.round(active.curvePct)}%`;
  updateCurvePreview();
}

function updateCurvePlayhead(
  activeU: number,
  active: boolean,
  activeGen: number,
  outgoingU: number | null,
  outgoingGen: number | null,
): void {
  if (debugPanel.hidden) return;
  const handoffT = autoHandoff / 100;
  const tToX = (t: number) => 8 + (t / DUAL_CURVE_MAX_T) * 204;
  const yToSvg = (y: number) => 7 + (1 - y) * 44;
  const c1 = getFoldCurve1();
  const c2 = getFoldCurve2();

  const placeOnSlot = (dot: SVGCircleElement, slot: 1 | 2, uRaw: number) => {
    const u = clamp01(uRaw);
    const c = slot === 1 ? c1 : c2;
    const t = slot === 1 ? u : handoffT + u;
    dot.classList.add('active');
    dot.setAttribute('cx', tToX(t).toFixed(1));
    dot.setAttribute('cy', yToSvg(evaluateFoldCurve(u, c.inPct, c.outPct, c.curvePct)).toFixed(1));
  };

  if (!active && outgoingU === null) {
    dbgCurveDot.classList.remove('active');
    dbgCurveDot2.classList.remove('active');
    return;
  }

  const activeSlot: 1 | 2 = activeGen % 2 === 1 ? 1 : 2;
  if (active) {
    placeOnSlot(activeSlot === 1 ? dbgCurveDot : dbgCurveDot2, activeSlot, activeU);
  } else {
    (activeSlot === 1 ? dbgCurveDot : dbgCurveDot2).classList.remove('active');
  }

  if (outgoingU !== null && outgoingGen !== null) {
    const outSlot: 1 | 2 = outgoingGen % 2 === 1 ? 1 : 2;
    if (outSlot !== activeSlot) {
      placeOnSlot(outSlot === 1 ? dbgCurveDot : dbgCurveDot2, outSlot, outgoingU);
      return;
    }
  }
  (activeSlot === 1 ? dbgCurveDot2 : dbgCurveDot).classList.remove('active');
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
  btnAction.classList.toggle('active', playMode === 'manual');
  btnAction.setAttribute('aria-pressed', playMode === 'manual' ? 'true' : 'false');
  for (const btn of modeBtns) {
    const active = btn.dataset.mode === playMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  dbgCameraTrick.value = debugCameraTrick;
  dbgGlideFold.checked = debugGlideOnFoldEnabled;
  for (const btn of dbgAnchorModeBtns) {
    btn.classList.toggle('active', btn.dataset.anchorMode === debugAnchorMode);
  }
  dbgFadeProj.checked = debugFadeProjEnabled;

  // Auto-fold curve, speed & next-fold handoff controls
  const speedPct = Math.round(autoSpeed * 100);
  dbgAutoSpeed.value = String(speedPct);
  dbgAutoSpeedVal.textContent = `${autoSpeed.toFixed(2)}×`;
  dbgAutoHandoff.value = String(Math.round(autoHandoff));
  dbgAutoHandoffVal.textContent = `${Math.round(autoHandoff)}%`;
  dbgCutoutDelay.value = String(Math.round(cutoutDropDelay * 100));
  dbgCutoutDelayVal.textContent = `${cutoutDropDelay.toFixed(2)}s`;
  syncCurveTabSliders();

  // Light & shadow controls
  dbgShadowStrength.value = String(Math.round(shadowStrength));
  dbgShadowStrengthVal.textContent = `${Math.round(shadowStrength)}%`;
  dbgShadowBlur.value = String(shadowBlur);
  dbgShadowBlurVal.textContent = shadowBlur.toFixed(1);
  dbgSunAzimuth.value = String(Math.round(sunAzimuth));
  dbgSunAzimuthVal.textContent = `${Math.round(sunAzimuth)}°`;
  dbgSunElevation.value = String(Math.round(sunElevation));
  dbgSunElevationVal.textContent = `${Math.round(sunElevation)}°`;
}

function saveDebugSettings(): void {
  if (!isDebugMode) return;
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
      playMode,
      reverseFold: debugReverseFoldEnabled,
      cameraTrick: debugCameraTrick,
      glideOnFold: debugGlideOnFoldEnabled,
      anchorMode: debugAnchorMode,
      fadeProjOnFold: debugFadeProjEnabled,
      autoFold: autoFoldEnabled,
      autoSpeed,
      autoEaseIn,
      autoEaseOut,
      autoCurve,
      autoEaseIn2,
      autoEaseOut2,
      autoCurve2,
      autoHandoff,
      cutoutDropDelay,
      shadowStrength,
      shadowBlur,
      sunAzimuth,
      sunElevation,
    };
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage write errors
  }
}

syncDebugControls();

const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
const COLOR_BLACK = new THREE.Color('#000000');
const introBox = new THREE.Box3();
const introCenter = new THREE.Vector3();
const introSize = new THREE.Vector3();

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
renderer.shadowMap.type = THREE.PCFShadowMap;

// Seamless white-on-white studio backdrop & fog matched to lit horizontal white paper luminance!
const BACKDROP = '#f5f4f0';
const scene = new THREE.Scene();
scene.background = new THREE.Color(BACKDROP);
const studioFog = new THREE.Fog(BACKDROP, 52, 134);
scene.fog = studioFog;

const pmrem = new THREE.PMREMGenerator(renderer);
const sharedEnvTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();
scene.environment = sharedEnvTexture;
scene.environmentIntensity = 0.08;

// Telephoto architectural model camera (FOV 28°, generous far plane for zoomed-out large houses!)
const camera = new THREE.PerspectiveCamera(28, 1, 0.3, 650);

// Pure luminous white-on-white gallery lighting: high-noon sun (~72° elevation) avoids long cast shadows
// while matching horizontal white paper warmth 1:1 with the #f5f4f0 studio backdrop!
const hemi = new THREE.HemisphereLight('#fffdf8', '#e0ddd6', 1.50);
scene.add(hemi);

const sunDirActive = new THREE.Vector3(10.5, 19.0, 8.2).normalize();
const sun = new THREE.DirectionalLight('#fffdf9', 1.18);
sun.position.copy(sunDirActive).multiplyScalar(28);
sun.castShadow = true;
const shadowMapRes = isCoarsePointer ? 1024 : 2048;
sun.shadow.mapSize.set(shadowMapRes, shadowMapRes);
sun.shadow.camera.near = 2;
sun.shadow.camera.far = 72;
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 14;
sun.shadow.camera.bottom = -14;
sun.shadow.bias = -0.00018;
sun.shadow.normalBias = 0.012;
sun.shadow.radius = 2.8;
scene.add(sun);

const FILL_BASE_POS = new THREE.Vector3(-14, 9, -10);
const fill = new THREE.DirectionalLight('#f8f7f2', 0.24);
fill.position.copy(FILL_BASE_POS);
scene.add(fill);

// Soft warm studio under-bounce light so underside worm's-eye camera views sculpt eaves & paper facades crisply!
const UNDER_FILL_BASE_POS = new THREE.Vector3(12, -22, 14);
const underFill = new THREE.DirectionalLight('#fbfaf6', 0.44);
underFill.position.copy(UNDER_FILL_BASE_POS);
scene.add(underFill);

// Build THREE ring-buffer duplex paper material sets sharing ONE single procedural washi fiber texture pair!
// Allows active house + pre-calculated Reverse next house + 1-step Reverse lookahead (zero pop through windows!)
type MatSlotIdx = 0 | 1 | 2;
const nextMatSlot = (idx: MatSlotIdx): MatSlotIdx => ((idx + 1) % 3) as MatSlotIdx;
const sharedWashiTextures = createWashiFiberTextures(renderer.capabilities.getMaxAnisotropy());
const materialsPool: [OrigamiMaterials, OrigamiMaterials, OrigamiMaterials] = [
  createOrigamiMaterials(renderer.capabilities.getMaxAnisotropy(), { sharedTextures: sharedWashiTextures }),
  createOrigamiMaterials(renderer.capabilities.getMaxAnisotropy(), { sharedTextures: sharedWashiTextures }),
  createOrigamiMaterials(renderer.capabilities.getMaxAnisotropy(), { sharedTextures: sharedWashiTextures }),
];
let activeMatIdx: MatSlotIdx = 0;
let materials: OrigamiMaterials = materialsPool[0];
const tmpDrawSize = new THREE.Vector2();

let curShadowExtent = 14;
let swapShadowExtent = 14;
let finalShadowExtent = 14;
let lastShadowFrustumE = -1;
let lastShadowFrustumDist = -1;

function applyShadowFrustum(extent: number): void {
  const lowSunSpread = sunDirActive.y < 0.72 ? Math.min(1.65, 0.76 / Math.max(0.28, sunDirActive.y)) : 1;
  const e = Math.max(14, extent * lowSunSpread);
  const sunDist = Math.max(28, e * 1.75);
  sun.position.copy(sunDirActive).multiplyScalar(sunDist);
  if (Math.abs(e - lastShadowFrustumE) > 1e-4 || Math.abs(sunDist - lastShadowFrustumDist) > 1e-4) {
    lastShadowFrustumE = e;
    lastShadowFrustumDist = sunDist;
    sun.shadow.camera.left = -e;
    sun.shadow.camera.right = e;
    sun.shadow.camera.top = e;
    sun.shadow.camera.bottom = -e;
    sun.shadow.camera.near = Math.max(2, sunDist - e * 2.2);
    sun.shadow.camera.far = sunDist + e * 2.6;
    sun.shadow.normalBias = 0.012 * (e / 14);
    sun.shadow.camera.updateProjectionMatrix();
  }
}
applyShadowFrustum(curShadowExtent);

// ----------------------------------------------------------------------------
// Camera Orbit & Dynamic Final-Stage Zoom-Out Framing
// ----------------------------------------------------------------------------
const BASE_LOOK_Y = 1.2;
const defaultYaw = params.get('yaw') !== null ? Number(params.get('yaw')) : 0.44;
const defaultPitch = params.get('pitch') !== null ? Number(params.get('pitch')) : 0.60;
const defaultDist = params.get('dist') !== null ? Number(params.get('dist')) : 31.0;

let targetYaw = defaultYaw;
let targetPitch = defaultPitch;
let targetRoll = 0;
let targetDist = defaultDist;
let targetLookX = 0;
let targetLookY = BASE_LOOK_Y;
let targetLookZ = 0;

let curYaw = targetYaw;
let curPitch = targetPitch;
let curRoll = targetRoll;
let curDist = targetDist;
let curLookX = targetLookX;
let curLookY = targetLookY;
let curLookZ = targetLookZ;

// Locked at the exact swap frame so 1:1 projection NEVER shifts; zooms & centers smoothly as we fold!
let swapDist = defaultDist;
let swapLookX = 0;
let swapLookY = BASE_LOOK_Y;
let swapLookZ = 0;
let finalDist = defaultDist;
let finalLookY = BASE_LOOK_Y;
let userZoomDelta = 0;
let lastSilhouetteCoverage = 1;
let lastSilhouetteBaseline = 1;

// Optional per-slide camera shift & drastic top/bottom/rolled perspective jump-cut on projection
let slideYawDelta = 0;
let slidePitchDelta = 0;
let slideRollDelta = 0;
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

function computeProjectionJumpView(
  net: BuiltHouseNet,
  mode: CameraTrickMode,
): { toYaw: number; toPitch: number; toRoll: number; toDist: number } {
  const g = net.spec.generation;
  const ideal = computeIdealFraming(net);
  const baseDist = ideal.dist;

  if (mode === 'overhead') {
    // Straight bird's-eye plan view directly ON TOP of the paper (`+85°`)!
    const yawDir = g % 2 === 1 ? 1 : -1;
    return {
      toYaw: curYaw + yawDir * (1.15 + ((g * 17) % 3) * 0.16),
      toPitch: 1.48,
      toRoll: 0,
      toDist: baseDist * 1.02,
    };
  }

  if (mode === 'rolled') {
    // Dramatic 180° upside-down & 90° sideways rolled perspectives (strictly above ground!)
    const rollSeq = [Math.PI, Math.PI * 0.5, -Math.PI * 0.5, Math.PI];
    const pitchSeq = [1.42, 1.18, 0.52, 0.34];
    const k = ((g - 1) % rollSeq.length + rollSeq.length) % rollSeq.length;
    return {
      toYaw: curYaw + (k % 2 === 0 ? 1.25 : -1.35),
      toPitch: pitchSeq[k],
      toRoll: rollSeq[k],
      toDist: baseDist * 1.02,
    };
  }

  if (mode === 'low') {
    // Dramatic ground-level architectural horizon jump (`+6°` to `+11°`) swinging to opposite face!
    const yawDir = g % 2 === 1 ? -1 : 1;
    return {
      toYaw: curYaw + yawDir * (2.25 + ((g * 13) % 3) * 0.22),
      toPitch: 0.11 + ((g * 7) % 3) * 0.03,
      toRoll: 0,
      toDist: baseDist,
    };
  }

  if (mode === 'balanced') {
    // Balanced sculptural jump-cuts (default): bold yaw swings + quite tilted Dutch rolls (±15°..±24°),
    // strictly staying between comfortable low 3/4 (~22°) and high 3/4 (~55°) — never flat ground, never straight top-down!
    const step = ((g - 1) % 5 + 5) % 5;
    if (step === 0) {
      return { toYaw: curYaw + 1.32, toPitch: 0.96, toRoll: 0.28, toDist: baseDist };
    }
    if (step === 1) {
      return { toYaw: curYaw - 1.95, toPitch: 0.38, toRoll: -0.34, toDist: baseDist };
    }
    if (step === 2) {
      return { toYaw: curYaw + 1.58, toPitch: 0.84, toRoll: -0.40, toDist: baseDist };
    }
    if (step === 3) {
      return { toYaw: curYaw - 1.45, toPitch: 0.48, toRoll: 0.42, toDist: baseDist };
    }
    return { toYaw: curYaw + 2.08, toPitch: 0.72, toRoll: -0.26, toDist: baseDist };
  }

  if (mode === 'drastic') {
    // Extreme above-ground Escher cycle (NEVER under the house!):
    //   0. Straight Overhead Plan (`+85°`) — front view shatters & folds straight up toward the lens!
    //   1. Low Ground-Level Horizon (`+7°`, `165°` opposite yaw) — overhead plan erects across the horizon!
    //   2. Inverted Overhead Flip (`+83°` + `180°` roll!) — upright house folds completely UPSIDE-DOWN!
    //   3. Sideways 90° Rolled Axonometric (`+58°` + `-90°` roll!) — cracks open & folds SIDEWAYS!
    //   4. Banked Heroic Low Street (`+14°` + `+34°` Dutch roll + `145°` yaw) — dramatic cinema sweep!
    const step = ((g - 1) % 5 + 5) % 5;
    if (step === 0) {
      return { toYaw: curYaw + 1.25, toPitch: 1.48, toRoll: 0, toDist: baseDist * 1.02 };
    }
    if (step === 1) {
      return { toYaw: curYaw - 2.65, toPitch: 0.12, toRoll: 0, toDist: baseDist };
    }
    if (step === 2) {
      return { toYaw: curYaw + 1.05, toPitch: 1.44, toRoll: Math.PI, toDist: baseDist * 1.02 };
    }
    if (step === 3) {
      return { toYaw: curYaw - 1.55, toPitch: 1.02, toRoll: -Math.PI * 0.5, toDist: baseDist };
    }
    return { toYaw: curYaw + 2.35, toPitch: 0.24, toRoll: 0.58, toDist: baseDist };
  }

  // Original milder `'subtle'` Above-3/4 diagonal jump (`+48°`)
  const yawDir = g % 2 === 1 ? 1 : -1;
  return {
    toYaw: curYaw + yawDir * (0.76 + ((g * 19) % 3) * 0.10),
    toPitch: 0.84,
    toRoll: 0,
    toDist: baseDist,
  };
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

function computeIdealFraming(net: BuiltHouseNet): {
  dist: number;
  flatDist: number;
  lookY: number;
  shadowExtent: number;
} {
  const sheetHalfW = net.sheetHalfMm * MM;
  const hWorld = net.foldedHeightMm * MM;
  const rWorld = net.foldedRadiusMm * MM;
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  const rawAspect = camera.aspect > 0.1 ? camera.aspect : 1.6;

  // Smoothly transition from desktop gallery framing (`aspect >= 1.05`) to full width-matched portrait
  // framing (`aspect <= 0.72`) so vertical/mobile screens zoom in ~2x to match viewport width minus padding!
  const portraitT = clamp01((1.05 - rawAspect) / 0.33);
  const portraitEase = portraitT * portraitT * (3 - 2 * portraitT);

  const effAspect =
    rawAspect < 1
      ? Math.max(0.36, rawAspect)
      : Math.min(rawAspect, 1.38);
  const tanH = tanV * effAspect;

  const baseWidthFill = net.spec.topology === 'village' ? 0.42 : 0.33;
  const portraitWidthFill = net.spec.topology === 'village' ? 0.80 : 0.74;
  const widthFill = baseWidthFill + (portraitWidthFill - baseWidthFill) * portraitEase;
  const heightFill = 0.34 + (0.54 - 0.34) * portraitEase;
  const minFloorDist = defaultDist + (16 - defaultDist) * portraitEase;

  const distForHeight = hWorld / (heightFill * 2 * tanV);
  const distForWidth = rWorld / (widthFill * tanH);
  const dist = Math.max(minFloorDist, distForHeight, distForWidth);

  // Initial flat-sheet distance: keep `defaultDist` on desktop, match flat net width minus ~12% padding on portrait!
  const portraitFlatDist = Math.max(dist, (sheetHalfW * 0.90) / (0.86 * tanH));
  const flatDist = defaultDist + (portraitFlatDist - defaultDist) * portraitEase;

  const lookY = Math.max(BASE_LOOK_Y, (hWorld - 0.6) * 0.30);
  // Noon sun casts tight, short shadows (~0.32x height), allowing an even crisper shadow frustum!
  const shadowExtent = Math.max(14, sheetHalfW * 1.35, rWorld + hWorld * 0.90);

  return { dist, flatDist, lookY, shadowExtent };
}

function syncTurntableLights(viewYaw = curYaw, shadowExtent = curShadowExtent): void {
  // Lock studio key sun, fill lights & environment to viewer azimuth (`viewYaw - defaultYaw`) so turning
  // acts like a real physical studio turntable: the house spins while the cast shadow stays in the same spot!
  const relYaw = viewYaw - defaultYaw;
  const azRad = THREE.MathUtils.degToRad(sunAzimuth) + relYaw;
  const elRad = THREE.MathUtils.degToRad(sunElevation);
  sunDirActive
    .set(
      Math.cos(elRad) * Math.sin(azRad),
      Math.sin(elRad),
      Math.cos(elRad) * Math.cos(azRad),
    )
    .normalize();
  const c = Math.cos(relYaw);
  const s = Math.sin(relYaw);
  fill.position.set(
    FILL_BASE_POS.x * c + FILL_BASE_POS.z * s,
    FILL_BASE_POS.y,
    -FILL_BASE_POS.x * s + FILL_BASE_POS.z * c,
  );
  underFill.position.set(
    UNDER_FILL_BASE_POS.x * c + UNDER_FILL_BASE_POS.z * s,
    UNDER_FILL_BASE_POS.y,
    -UNDER_FILL_BASE_POS.x * s + UNDER_FILL_BASE_POS.z * c,
  );
  scene.environmentRotation.y = relYaw;
  applyShadowFrustum(shadowExtent);
}

function syncCameraFromOrbit(): void {
  camera.up.set(0, 1, 0);
  camera.position.set(
    curLookX + curDist * Math.cos(curPitch) * Math.sin(curYaw),
    curLookY + curDist * Math.sin(curPitch),
    curLookZ + curDist * Math.cos(curPitch) * Math.cos(curYaw),
  );
  camera.lookAt(curLookX, curLookY, curLookZ);
  if (Math.abs(curRoll) > 1e-5) {
    camera.rotateZ(curRoll);
  }

  syncTurntableLights(curYaw, curShadowExtent);

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

interface OutgoingLiveHouse {
  generation: number;
  curve: FoldCurveShape;
  rig: OrigamiHouseRig;
  mats: OrigamiMaterials;
  panelState: Map<FoldablePanelId, PanelState>;
  targetRT: THREE.WebGLRenderTarget;
  camera: THREE.PerspectiveCamera;
  yaw: number;
  pitch: number;
  roll: number;
  dist: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  swapDist: number;
  finalDist: number;
  swapLookX: number;
  swapLookY: number;
  swapLookZ: number;
  finalLookY: number;
  userZoomDelta: number;
  shadowExtent: number;
  spinEnabled: boolean;
  liveFramesRendered: number;
}

interface ReverseUnfoldState {
  nextGen: number;
  nextRig: OrigamiHouseRig;
  nextMats: OrigamiMaterials;
  nextMatIdx: MatSlotIdx;
  targetRT: THREE.WebGLRenderTarget;
  startYaw: number;
  startPitch: number;
  startRoll: number;
  startDist: number;
  startLookX: number;
  startLookY: number;
  startLookZ: number;
  startShadowExtent: number;
  landYaw: number;
  landPitch: number;
  landRoll: number;
  landDist: number;
  landLookX: number;
  landLookY: number;
  landLookZ: number;
  landShadowExtent: number;
  landCoverage: number;
  landBaseline: number;
  destYaw: number;
  destPitch: number;
  destRoll: number;
  destDist: number;
  destLookY: number;
  destShadowExtent: number;
  elapsedSec: number;
  totalSec: number;
  swapReady: boolean;
  holdBeforeSwap: boolean;
}

let generation = 1;
let rig!: OrigamiHouseRig;
let outgoing: OutgoingLiveHouse | null = null;
let reverseUnfold: ReverseUnfoldState | null = null;
/** Pre-calculated Reverse target (House B) ALREADY projected onto active House A's interior before unfolding! */
let pendingReverse: ReverseUnfoldState | null = null;
/** 1-step Reverse lookahead (House C) ALREADY projected onto House B so House A -> House B swap has 0 window pop! */
let queuedReverse: ReverseUnfoldState | null = null;
let reverseLookaheadDirty = false;
let preparedNext: { generation: number; mixKey: string; matIdx: MatSlotIdx; rig: OrigamiHouseRig } | null = null;
let prepareTimerId: number | null = null;
const panelState = new Map<FoldablePanelId, PanelState>();
let hoveredPanel: FoldablePanelId | null = null;
let justProjected = false;
let curPaperRelief = 1;
let targetPaperRelief = 1;
let cutoutDropState: 'none' | 'waiting' | 'falling' | 'done' = 'none';
let cutoutDropElapsed = 0;
let windClockSec = 0;
let rigWindStrength = 1;

function clearOutgoing(): void {
  if (!outgoing) return;
  scene.remove(outgoing.rig.root);
  outgoing.rig.dispose();
  outgoing = null;
}

function disposeReverseEntry(entry: ReverseUnfoldState | null): void {
  if (!entry) return;
  scene.remove(entry.nextRig.root);
  entry.nextRig.dispose();
  entry.nextMats.setProjection(null);
}

function clearReverseUnfold(): void {
  disposeReverseEntry(reverseUnfold);
  reverseUnfold = null;
  disposeReverseEntry(pendingReverse);
  pendingReverse = null;
  disposeReverseEntry(queuedReverse);
  queuedReverse = null;
  reverseLookaheadDirty = false;
}

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
 * Pre-build the next generation's complete flat-net + cutout + punched window chad rig ahead of time
 * using the INACTIVE ring-buffer material slot so live overlap handoffs stay 100% hitch-free!
 */
function prepareNextGenerationNow(gen: number): OrigamiHouseRig {
  const mixKey = getMixCacheKey();
  const nextMatIdx: MatSlotIdx = nextMatSlot(activeMatIdx);
  if (
    preparedNext &&
    preparedNext.generation === gen &&
    preparedNext.mixKey === mixKey &&
    preparedNext.matIdx === nextMatIdx
  ) {
    return preparedNext.rig;
  }
  clearPreparedNext();
  const spec = generateHouseSpec(gen, getCurrentMixOptions());
  const net = buildHouseNet(spec);
  const nextRig = buildOrigamiHouseRig(net, materialsPool[nextMatIdx], true);
  preparedNext = { generation: gen, mixKey, matIdx: nextMatIdx, rig: nextRig };
  return nextRig;
}

function schedulePrepareNext(gen: number, delayMs = 90): void {
  if (debugReverseFoldEnabled) return;
  const mixKey = getMixCacheKey();
  const nextMatIdx: MatSlotIdx = nextMatSlot(activeMatIdx);
  if (
    preparedNext &&
    preparedNext.generation === gen &&
    preparedNext.mixKey === mixKey &&
    preparedNext.matIdx === nextMatIdx
  ) {
    return;
  }
  if (prepareTimerId !== null) window.clearTimeout(prepareTimerId);
  prepareTimerId = window.setTimeout(() => {
    prepareTimerId = null;
    const activelyDropping = cutoutDropState === 'falling' && cutoutDropElapsed >= cutoutDropDelay;
    if (activelyDropping && (!autoFoldEnabled || playMode === 'slow' || autoBeatElapsed < getAutoHandoffSec() * 0.65)) {
      schedulePrepareNext(gen, 220);
      return;
    }
    prepareNextGenerationNow(gen);
  }, delayMs);
}

function applyPaperColorsTo(mats: OrigamiMaterials, targetRig: OrigamiHouseRig): void {
  if (debugColorEnabled) {
    const schemes = getColorSchemesForHouse(
      targetRig.net.spec.outsideColor,
      targetRig.net.spec.topology === 'village',
    );
    mats.setColorSchemes(schemes, targetRig.net.foldedHeightMm * MM);
    mats.edge.color.set('#fbfaf7');
    mats.projUniforms.uProjGain.value = 1.0;
  } else {
    mats.setOutsideColor('#f5f4f0');
    mats.edge.color.set('#f8f7f3');
    mats.projUniforms.uProjGain.value = 0.86;
  }
}

function applyActiveOutsideColor(includeOutgoing = true, refreshReverse = true): void {
  if (!rig) return;
  applyPaperColorsTo(materials, rig);
  if (includeOutgoing && outgoing) {
    applyPaperColorsTo(outgoing.mats, outgoing.rig);
  }

  // Align studio directional sun & fill lights with current turntable angle so shadow direction stays fixed on screen!
  syncTurntableLights(curYaw, curShadowExtent);

  const baseHemi = debugColorEnabled ? 1.50 : 1.78;
  const baseSun = debugColorEnabled ? 1.18 : 2.05;
  const baseFill = debugColorEnabled ? 0.24 : 0.28;
  const baseUnderFill = 0.44;
  const baseEnv = 0.08;
  const sNorm = Math.max(0, Math.min(2, shadowStrength / 100));

  if (debugColorEnabled) {
    hemi.color.set('#fffdf8');
    hemi.groundColor.set('#e0ddd6');
    sun.color.set('#fffdf9');
    fill.color.set('#f8f7f2');
    renderer.toneMappingExposure = 1.02;
  } else {
    hemi.color.set('#fffef9');
    hemi.groundColor.set('#dfd9ce');
    sun.color.set('#fffdf6');
    fill.color.set('#f5f4f0');
    renderer.toneMappingExposure = 1.08;
  }

  // Shadow strength (`0..200%`):
  //   0..100%: smoothly scales Three.js `shadow.intensity` while preserving classic white-on-white gallery lighting.
  // 100..200%: drains ambient, fill, under-bounce & IBL all the way to pitch-black ink shadows at 200%
  //            while rebalancing directional sun so lit horizontal paper stays crisp `#f5f4f0` white!
  sun.castShadow = sNorm > 0.005;
  sun.shadow.intensity = Math.min(1, sNorm);
  sun.shadow.radius = shadowBlur;

  if (sNorm > 1) {
    const boost = sNorm - 1;
    hemi.intensity = baseHemi * (1 - boost * 0.996);
    fill.intensity = baseFill * (1 - boost);
    underFill.intensity = baseUnderFill * (1 - boost);
    scene.environmentIntensity = baseEnv * (1 - boost);
    if (boost > 0.001) {
      hemi.groundColor.lerp(COLOR_BLACK, boost);
    }
    const removedHemi = baseHemi - hemi.intensity;
    const removedFill = (baseFill - fill.intensity) * 0.46;
    const removedEnv = (baseEnv - scene.environmentIntensity) * Math.PI;
    sun.intensity = baseSun + (removedHemi + removedFill + removedEnv) / Math.max(0.35, sunDirActive.y);
  } else {
    hemi.intensity = baseHemi;
    fill.intensity = baseFill;
    underFill.intensity = baseUnderFill;
    scene.environmentIntensity = baseEnv;
    sun.intensity = baseSun;
  }

  // Dynamically calibrate 3D projection albedo gain to current live lighting (+ env map) so as walls
  // lift out of exact flat-lock (`sheetLift = 0 -> 0.48`), brightness & tone stay 100% seamless!
  const horizIrr =
    (hemi.intensity + sun.intensity * Math.max(0.1, sunDirActive.y) + fill.intensity * 0.46) / Math.PI +
    scene.environmentIntensity;
  const calibratedGain = Math.max(0.55, Math.min(1.45, 0.90 / Math.max(0.35, horizIrr)));
  materials.projUniforms.uProjGain.value = calibratedGain;
  if (includeOutgoing && outgoing) {
    outgoing.mats.projUniforms.uProjGain.value = calibratedGain;
  }
  if (refreshReverse && (reverseUnfold || pendingReverse || queuedReverse)) {
    const syncEntry = (entry: ReverseUnfoldState | null) => {
      if (!entry) return;
      applyPaperColorsTo(entry.nextMats, entry.nextRig);
      entry.nextMats.projUniforms.uProjGain.value = calibratedGain;
    };
    syncEntry(queuedReverse);
    syncEntry(pendingReverse);
    syncEntry(reverseUnfold);
    refreshReverseCaptures();
  }
}

function mountHouseGeneration(
  gen: number,
  fromSwap = false,
  preservePrevRig = false,
  startFolded = !fromSwap,
): void {
  if (!preservePrevRig) {
    clearOutgoing();
    clearReverseUnfold();
    if (rig) {
      scene.remove(rig.root);
      rig.dispose();
    }
  }
  const mixKey = getMixCacheKey();
  const needsCutout = fromSwap || debugReverseFoldEnabled;
  if (
    needsCutout &&
    preparedNext &&
    preparedNext.generation === gen &&
    preparedNext.mixKey === mixKey &&
    preparedNext.matIdx === activeMatIdx
  ) {
    rig = preparedNext.rig;
    preparedNext = null;
  } else {
    const baseOpts = getCurrentMixOptions();
    const forceIntroCompound =
      !fromSwap &&
      gen === 1 &&
      !params.has('clean') &&
      forcedModelSlot === null &&
      mixTopology === null &&
      mixHouses === null;
    const spec = generateHouseSpec(
      gen,
      forceIntroCompound ? { ...baseOpts, topology: 'village' } : baseOpts,
    );
    const net = buildHouseNet(spec);
    rig = buildOrigamiHouseRig(net, materials, needsCutout);
  }
  applyActiveOutsideColor(!preservePrevRig);
  rig.setWindowOpen(mixWinOpenMode, mixWinOpen);
  const net = rig.net;
  // Keep Layer 1 startup upright on its floor (`base`); from Layer 2 onward (or live swaps),
  // apply the active anchor mode (`rest` = Option 1, `subtle` = Option 3, `floor` = base-only).
  const useBaseOnly = debugAnchorMode === 'floor' || (!fromSwap && gen <= 1);
  const anchorPanelId: PanelId = useBaseOnly
    ? (net.panels.find((p) => p.parent === null)?.id ?? 'base')
    : chooseFoldAnchorPanel(net, gen, mixSeed).panelId;
  rig.setFoldAnchor(anchorPanelId, debugAnchorMode);
  scene.add(rig.root);

  const initFold = !fromSwap && startFolded ? 1 : 0;
  panelState.clear();
  for (const id of rig.panelIds) {
    panelState.set(id, {
      fold: initFold,
      target: initFold,
      startFold: initFold,
      animElapsed: 0,
      animDuration: 0,
      animating: false,
      peek: 0,
      delay: 0,
    });
    rig.updatePanelVisual(id, initFold, 0, false);
  }
  rig.syncAnchorPose(initFold);
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
    swapLookX = curLookX;
    swapLookY = curLookY;
    swapLookZ = curLookZ;
    finalDist = ideal.dist;
    finalLookY = ideal.lookY;
    userZoomDelta = 0;
    targetDist = curDist;
    targetLookX = curLookX;
    targetLookY = curLookY;
    targetLookZ = curLookZ;

    swapShadowExtent = curShadowExtent;
    finalShadowExtent = ideal.shadowExtent;

    if (debugCameraTrick !== 'off') {
      const hero = computeHeroElevation(net);
      slideYawDelta = hero.yawOffsetFromCut;
      slidePitchDelta = hero.targetPitch - targetPitch;
      slideRollDelta = -targetRoll;
    } else {
      const shift = computeSlideViewShift(net);
      slideYawDelta = shift.yawDelta;
      slidePitchDelta = shift.targetPitch - targetPitch;
      slideRollDelta = -targetRoll;
    }
    prevSlideEase = 0;
  } else if (startFolded) {
    curPaperRelief = 1;
    targetPaperRelief = 1;
    rig.setPaperRelief(1);
    rig.setFoldLinesVisible(false);
    cutoutDropState = rig.hasCutout ? 'done' : 'none';
    cutoutDropElapsed = 0;
    if (rig.hasCutout) rig.updateCutoutDrop(99);

    swapDist = ideal.flatDist;
    swapLookX = 0;
    swapLookY = BASE_LOOK_Y;
    swapLookZ = 0;
    finalDist = ideal.dist;
    finalLookY = ideal.lookY;
    userZoomDelta = 0;
    targetDist = curDist = ideal.dist;
    targetLookX = curLookX = 0;
    targetLookY = curLookY = ideal.lookY;
    targetLookZ = curLookZ = 0;

    curShadowExtent = swapShadowExtent = finalShadowExtent = ideal.shadowExtent;
    applyShadowFrustum(curShadowExtent);
    slideYawDelta = 0;
    slidePitchDelta = 0;
    slideRollDelta = 0;
    prevSlideEase = 0;
  } else {
    curPaperRelief = 1;
    targetPaperRelief = 1;
    rig.setPaperRelief(1);
    cutoutDropState = 'none';
    cutoutDropElapsed = 0;

    swapDist = ideal.flatDist;
    swapLookX = 0;
    swapLookY = BASE_LOOK_Y;
    swapLookZ = 0;
    finalDist = ideal.dist;
    finalLookY = ideal.lookY;
    userZoomDelta = 0;
    targetDist = curDist = ideal.flatDist;
    targetLookX = curLookX = 0;
    targetLookY = curLookY = BASE_LOOK_Y;
    targetLookZ = curLookZ = 0;

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

function computeIntroHintFold(panel: PanelNetDef, idx: number, wallCount: number): number {
  if (panel.parent === null || panel.isMountain) return 0;
  const hash = Math.abs(Math.sin((idx + 1) * 12.9898 + (mixSeed + 7) * 78.233) * 43758.5453) % 1;
  if (panel.stage === 'wall') {
    // Almost flat sheet with a delicate whisper of lift on some sides (~7–15°), others nearly flush (~0–3°)
    const lifted = idx % 2 === 0 || wallCount <= 3;
    return lifted ? 0.08 + hash * 0.09 : hash * 0.03;
  }
  if (panel.stage === 'roof' || panel.stage === 'cap') {
    // Barely perceptible upward curl on roof creases (~2–8°)
    return 0.03 + hash * 0.07;
  }
  return 0.02 + hash * 0.04;
}

function frameIntroHintPose(): void {
  const fp = computeFoldProgress();
  rig.syncAnchorPose(fp);

  // Frame and center the actual unfolded 3D bounding box with calm gallery margins
  rig.root.updateMatrixWorld(true);
  introBox.setFromObject(rig.root);
  introBox.getCenter(introCenter);
  introBox.getSize(introSize);
  const sphereR = Math.max(2, introSize.length() * 0.5);
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  const aspect = camera.aspect > 0.1 ? camera.aspect : 1.6;
  const tanH = tanV * aspect;
  const fitDist = Math.max(
    computeIdealFraming(rig.net).flatDist * 0.85,
    sphereR / (0.68 * tanV),
    sphereR / (0.72 * tanH),
  );
  // Solve swapDist so `computeAutoZoom(fp)` lands right on `fitDist` at the intro pose,
  // and glides smoothly into `(0, finalLookY, 0, finalDist)` as the paper folds to 1.0!
  const zRaw = clamp01((fp - 0.03) / 0.94);
  const zoomEase = 0.5 - 0.5 * Math.cos(Math.PI * zRaw);
  const denom = Math.max(0.25, 1 - zoomEase);
  swapDist = Math.max(finalDist, (fitDist - finalDist * zoomEase) / denom);
  swapLookX = introCenter.x / denom;
  swapLookY = Math.max(BASE_LOOK_Y, (introCenter.y - finalLookY * zoomEase) / denom);
  swapLookZ = introCenter.z / denom;
  swapShadowExtent = Math.max(finalShadowExtent, sphereR * 1.45);

  const z = computeAutoZoom(fp);
  targetDist = curDist = z.autoDist;
  targetLookX = curLookX = z.autoLookX;
  targetLookY = curLookY = z.autoLookY;
  targetLookZ = curLookZ = z.autoLookZ;
  curShadowExtent = z.shadowExtent;
  applyShadowFrustum(curShadowExtent);
  syncCameraFromOrbit();
}

function applyIntroHintPose(): void {
  introHintBaseFold.clear();
  const panelById = new Map(rig.net.panels.map((p) => [p.id, p]));
  const wallCount = rig.net.panels.filter((p) => p.stage === 'wall').length;
  rig.setFoldLinesVisible(true);
  rig.panelIds.forEach((id, idx) => {
    const def = panelById.get(id);
    const hintFold = def ? computeIntroHintFold(def, idx, wallCount) : 0.15;
    introHintBaseFold.set(id, hintFold);
    const ps = panelState.get(id);
    if (ps) {
      ps.fold = hintFold;
      ps.target = hintFold;
      ps.startFold = hintFold;
      ps.animating = false;
      ps.delay = 0;
    }
    rig.updatePanelVisual(id, hintFold, 0, false);
  });
  frameIntroHintPose();
}

mountHouseGeneration(1, false, false, !introAwaiting);
if (introAwaiting) {
  applyIntroHintPose();
}

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
    samples: isCoarsePointer ? 2 : 4,
  });
  rt.texture.wrapS = THREE.ClampToEdgeWrapping;
  rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  return rt;
}

// 3-slot HalfFloat FBO ring buffer guarantees ZERO WebGL feedback loop even during live overlap:
// `rt[k-1]` (frozen older house) -> `outgoing` renders into `rt[k]` -> active house samples `rt[k]`!
const rtPool: THREE.WebGLRenderTarget[] = [makeProjTarget(2, 2), makeProjTarget(2, 2), makeProjTarget(2, 2)];
let activeRTIndex = 0;
const snapVP = new THREE.Matrix4();

function ensureProjTargetsSized(): { tw: number; th: number } {
  renderer.getDrawingBufferSize(tmpDrawSize);
  const tw = Math.max(2, Math.round(tmpDrawSize.x));
  const th = Math.max(2, Math.round(tmpDrawSize.y));
  let resized = false;
  for (let i = 0; i < rtPool.length; i++) {
    if (rtPool[i].width !== tw || rtPool[i].height !== th) {
      rtPool[i].dispose();
      rtPool[i] = makeProjTarget(tw, th);
      resized = true;
    }
  }
  if (resized) {
    clearOutgoing();
    if (reverseUnfold || pendingReverse || queuedReverse) {
      refreshReverseCaptures();
    }
  }
  return { tw, th };
}

/**
 * Upfront GPU & geometry warmup run once at startup (before first composite):
 * 1. Allocates & warms ALL 3 4x-MSAA HalfFloat ring-buffer FBOs at exact drawing-buffer resolution.
 * 2. Pre-builds Gen 2 on the inactive ping-pong material slot and renders one microscopic hidden frame
 *    so WebGL/Metal compiles all material pipelines & uploads Gen 2 VBOs upfront — zero first-cut hitch!
 */
let warmupDone = false;

function warmupCutoutPipeline(): void {
  if (warmupDone || document.hidden || cityActive || !catalogModal.hidden || reverseUnfold || outgoing) return;
  warmupDone = true;
  ensureProjTargetsSized();
  syncCameraFromOrbit();
  camera.updateMatrixWorld(true);
  rig.root.updateMatrixWorld(true);

  const nextRig = prepareNextGenerationNow(generation + 1);
  const nextMats = materialsPool[nextMatSlot(activeMatIdx)];
  snapVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

  const prevToneMapping = renderer.toneMapping;
  const prevTarget = renderer.getRenderTarget();

  // 1. Warm all 3 4x-MSAA HalfFloat FBOs + resolve blit pipelines
  renderer.toneMapping = THREE.NoToneMapping;
  for (const rt of rtPool) {
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
  }
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevToneMapping;

  // 2. Warm ALL material pipelines (both ping-pong material slots!) on the main canvas using a microscopic pass
  nextRig.root.scale.set(0.0005, 0.0005, 0.0005);
  nextRig.setFoldLinesVisible(false);
  nextRig.updateCutoutDrop(0);
  scene.add(nextRig.root);
  nextMats.setProjection(rtPool[0].texture, snapVP);
  nextMats.projUniforms.uPaperReveal.value = 0;

  renderer.render(scene, camera);
  nextMats.setCutoutOpacity(0.5);
  renderer.render(scene, camera);

  // 3. Cleanly restore Gen 1 state while keeping `nextRig` hot & ready in `preparedNext`!
  scene.remove(nextRig.root);
  nextRig.root.scale.set(1, 1, 1);
  nextRig.setPaperRelief(1);
  nextMats.setProjection(null);
  nextMats.setCutoutOpacity(1);
  rig.setPaperRelief(curPaperRelief);
  renderer.render(scene, camera);
}

/**
 * Just-In-Time (JIT) 1:1 live camera projection with optional DUAL-HOUSE OVERLAP:
 * - Captures the exact live pixels of House A (`Camera A`) into the next ring-buffer HalfFloat FBO.
 * - When `keepOutgoingLive` is true and House A is still finishing its fold (~75–80% -> 100%),
 *   House A stays ALIVE as `outgoing` and keeps re-rendering into `targetRT` every frame until 100%
 *   settled — so House B starts folding underneath a LIVE-MOVING projection of House A finishing its roof!
 */
function projectAndSpawnUnderneath(trickMode: CameraTrickMode = 'off', keepOutgoingLive = false): void {
  // Dispose any older outgoing house before starting a new overlap handoff
  clearOutgoing();

  renderer.getDrawingBufferSize(tmpDrawSize);
  const tw = Math.max(2, Math.round(tmpDrawSize.x));
  const th = Math.max(2, Math.round(tmpDrawSize.y));
  const nextIdx = (activeRTIndex + 1) % rtPool.length;
  if (rtPool[nextIdx].width !== tw || rtPool[nextIdx].height !== th) {
    rtPool[nextIdx].dispose();
    rtPool[nextIdx] = makeProjTarget(tw, th);
  }
  const targetRT = rtPool[nextIdx];

  // 1. Capture the EXACT current pixels on screen from Camera A + sample its exact 2D silhouette!
  syncCameraFromOrbit();
  camera.updateMatrixWorld(true);
  rig.root.updateMatrixWorld(true);
  const silA = sampleFoldedHouseSilhouetteNDC(rig, camera);

  rig.setFoldLinesVisible(false);

  const prevTarget = renderer.getRenderTarget();
  const prevToneMapping = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(targetRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevToneMapping;

  // 2. If House A isn't finished folding yet (~75-80%), promote it to live `outgoing` so it finishes
  //    folding into `targetRT` every frame while House B already begins folding up underneath it!
  const prevStillFolding = keepOutgoingLive && !allPanelsSettledFolded();
  if (prevStillFolding) {
    const clonedPanels = new Map<FoldablePanelId, PanelState>();
    panelState.forEach((ps, id) => {
      clonedPanels.set(id, { ...ps });
    });
    const outCam = camera.clone();
    outCam.updateProjectionMatrix();
    outCam.updateMatrixWorld(true);
    rig.root.visible = false;
    outgoing = {
      generation,
      curve: getActiveFoldCurve(),
      rig,
      mats: materials,
      panelState: clonedPanels,
      targetRT,
      camera: outCam,
      yaw: curYaw,
      pitch: curPitch,
      roll: curRoll,
      dist: curDist,
      lookX: curLookX,
      lookY: curLookY,
      lookZ: curLookZ,
      swapDist,
      finalDist,
      swapLookX,
      swapLookY,
      swapLookZ,
      finalLookY,
      userZoomDelta,
      shadowExtent: curShadowExtent,
      spinEnabled: debugSpinEnabled,
      liveFramesRendered: 1,
    };
  }

  // 3. Pre-fetch House B's net on the alternate slot, then fit Camera B's flat-sheet alignment
  //    (yaw, scale, lookX/Z) directly to House A's 2D silhouette to minimize outer paper cutouts!
  const nextRigForFit = prepareNextGenerationNow(generation + 1);
  const baseJump = trickMode !== 'off' ? computeProjectionJumpView(nextRigForFit.net, trickMode) : null;
  const basePose = baseJump
    ? {
        yaw: baseJump.toYaw,
        pitch: baseJump.toPitch,
        roll: baseJump.toRoll,
        dist: baseJump.toDist,
        lookX: 0,
        lookY: BASE_LOOK_Y,
        lookZ: 0,
      }
    : {
        yaw: curYaw,
        pitch: curPitch,
        roll: curRoll,
        dist: curDist,
        lookX: 0,
        lookY: curLookY,
        lookZ: 0,
      };

  // Forward (non-reverse) accepted coverage ratio = 75%:
  // leave natural framing untouched whenever >= 75%, only nudging orientation/scale when really off!
  const FORWARD_ACCEPTED_RATIO = 0.75;
  let fitted = fitFlatNetToSilhouetteNDC(silA, nextRigForFit.net, basePose, {
    fovDeg: camera.fov,
    aspect: camera.aspect,
    allowYawSearch: trickMode !== 'off',
    minScale: 0.62,
    maxScale: 1.08,
    maxLookShiftRatio: 0,
    targetCoverage: FORWARD_ACCEPTED_RATIO,
  });
  // In Balanced mode, only try a steeper 3/4 pitch if coverage is STILL below the 75% threshold
  if (trickMode === 'balanced' && fitted.coverage < FORWARD_ACCEPTED_RATIO && basePose.pitch < 0.68) {
    const steeper = fitFlatNetToSilhouetteNDC(
      silA,
      nextRigForFit.net,
      { ...basePose, pitch: 0.78 },
      {
        fovDeg: camera.fov,
        aspect: camera.aspect,
        allowYawSearch: true,
        minScale: 0.62,
        maxScale: 1.08,
        maxLookShiftRatio: 0,
        targetCoverage: FORWARD_ACCEPTED_RATIO,
      },
    );
    if (steeper.coverage > fitted.coverage + 0.04) {
      fitted = steeper;
    }
  }

  lastSilhouetteCoverage = fitted.coverage;
  lastSilhouetteBaseline = fitted.baselineCoverage;

  curYaw = targetYaw = fitted.yaw;
  curPitch = targetPitch = fitted.pitch;
  curRoll = targetRoll = fitted.roll;
  curDist = targetDist = fitted.dist;
  curLookX = targetLookX = fitted.lookX;
  curLookY = targetLookY = fitted.lookY;
  curLookZ = targetLookZ = fitted.lookZ;
  syncCameraFromOrbit();
  camera.updateMatrixWorld(true);

  const projSide: 1 | -1 = camera.position.y < 0 ? -1 : 1;
  snapVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  activeRTIndex = nextIdx;

  // Swap to the next ring-buffer material slot (zero uniform or texture collision with `outgoing`!)
  activeMatIdx = nextMatSlot(activeMatIdx);
  materials = materialsPool[activeMatIdx];

  // 4. INSTANT JIT SWAP: spawn House B flat + complementary cutout sheet reading `targetRT.texture`!
  generation += 1;
  justProjected = true;

  mountHouseGeneration(generation, true, prevStillFolding);
  materials.setProjection(targetRT.texture, snapVP, projSide);
  materials.setProjectionFade(1);
  if (rig.hasCutout) rig.updateCutoutDrop(0, 0);
  syncUI();
}

function wrapAnglePi(delta: number): number {
  return ((((delta + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}

function captureReverseTarget(rev: ReverseUnfoldState, receiverMats: OrigamiMaterials): void {
  renderer.getDrawingBufferSize(tmpDrawSize);
  const tw = Math.max(2, Math.round(tmpDrawSize.x));
  const th = Math.max(2, Math.round(tmpDrawSize.y));
  let rt = rtPool[rev.nextMatIdx];
  if (rt.width !== tw || rt.height !== th) {
    rt.dispose();
    rt = makeProjTarget(tw, th);
    rtPool[rev.nextMatIdx] = rt;
  }
  rev.targetRT = rt;

  // Render next folded 3D house offscreen from `destCam` into `rev.targetRT` (NoToneMapping HalfFloat!)
  const destCam = camera.clone();
  destCam.up.set(0, 1, 0);
  destCam.position.set(
    rev.destDist * Math.cos(rev.destPitch) * Math.sin(rev.destYaw),
    rev.destLookY + rev.destDist * Math.sin(rev.destPitch),
    rev.destDist * Math.cos(rev.destPitch) * Math.cos(rev.destYaw),
  );
  destCam.lookAt(0, rev.destLookY, 0);
  if (Math.abs(rev.destRoll) > 1e-5) destCam.rotateZ(rev.destRoll);
  destCam.updateProjectionMatrix();
  destCam.updateMatrixWorld(true);

  const savedRigVis = rig.root.visible;
  const savedUnfoldVis = reverseUnfold?.nextRig.root.visible ?? false;
  const savedPendingVis = pendingReverse?.nextRig.root.visible ?? false;
  const savedQueuedVis = queuedReverse?.nextRig.root.visible ?? false;
  const savedFogNear = studioFog.near;
  const savedFogFar = studioFog.far;

  rig.root.visible = false;
  if (reverseUnfold) reverseUnfold.nextRig.root.visible = false;
  if (pendingReverse) pendingReverse.nextRig.root.visible = false;
  if (queuedReverse) queuedReverse.nextRig.root.visible = false;
  rev.nextRig.root.visible = true;
  rev.nextRig.root.updateMatrixWorld(true);

  studioFog.near = Math.max(44, rev.destDist * 1.25);
  studioFog.far = Math.max(120, rev.destDist * 3.15);
  syncTurntableLights(rev.destYaw, rev.destShadowExtent);

  const prevTarget = renderer.getRenderTarget();
  const prevToneMapping = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rev.targetRT);
  renderer.render(scene, destCam);
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevToneMapping;

  rev.nextRig.root.visible = false;
  rig.root.visible = savedRigVis;
  if (reverseUnfold) reverseUnfold.nextRig.root.visible = savedUnfoldVis;
  if (pendingReverse) pendingReverse.nextRig.root.visible = savedPendingVis;
  if (queuedReverse) queuedReverse.nextRig.root.visible = savedQueuedVis;
  studioFog.near = savedFogNear;
  studioFog.far = savedFogFar;
  syncTurntableLights(curYaw, curShadowExtent);

  // Compute exact landing VP matrix (`landCam`) onto the unfolding house's flat sheet (`aFlatPos`)!
  const landCam = camera.clone();
  landCam.up.set(0, 1, 0);
  landCam.position.set(
    rev.landLookX + rev.landDist * Math.cos(rev.landPitch) * Math.sin(rev.landYaw),
    rev.landLookY + rev.landDist * Math.sin(rev.landPitch),
    rev.landLookZ + rev.landDist * Math.cos(rev.landPitch) * Math.cos(rev.landYaw),
  );
  landCam.lookAt(rev.landLookX, rev.landLookY, rev.landLookZ);
  if (Math.abs(rev.landRoll) > 1e-5) landCam.rotateZ(rev.landRoll);
  landCam.updateProjectionMatrix();
  landCam.updateMatrixWorld(true);

  const projSide: 1 | -1 = landCam.position.y < 0 ? -1 : 1;
  snapVP.multiplyMatrices(landCam.projectionMatrix, landCam.matrixWorldInverse);
  receiverMats.setProjection(rev.targetRT.texture, snapVP, projSide);
  receiverMats.setProjectionFade(1);
}

/**
 * Re-captures active Reverse projection textures bottom-up (`House C -> House B`, then `House B -> House A`)
 * so every window & interior wall stays 100% in sync with live lighting, shadow strength, color, and resize!
 */
function refreshReverseCaptures(): void {
  const activeTarget = reverseUnfold ?? pendingReverse;
  if (!activeTarget) return;
  if (queuedReverse) {
    captureReverseTarget(queuedReverse, activeTarget.nextMats);
  } else {
    activeTarget.nextMats.setProjection(null);
  }
  captureReverseTarget(activeTarget, materials);
}

interface ReverseStartPose {
  yaw: number;
  pitch: number;
  roll: number;
  dist: number;
  shadowExtent: number;
}

function buildReversePlan(
  fromRig: OrigamiHouseRig,
  fromGen: number,
  fromPose: ReverseStartPose,
  nextMatIdx: MatSlotIdx,
): ReverseUnfoldState {
  const nextGen = fromGen + 1;
  const nextMats = materialsPool[nextMatIdx];
  const mixKey = getMixCacheKey();
  let nextRig: OrigamiHouseRig;
  if (
    preparedNext &&
    preparedNext.generation === nextGen &&
    preparedNext.mixKey === mixKey &&
    preparedNext.matIdx === nextMatIdx
  ) {
    nextRig = preparedNext.rig;
    preparedNext = null;
  } else {
    const spec = generateHouseSpec(nextGen, getCurrentMixOptions());
    const net = buildHouseNet(spec);
    nextRig = buildOrigamiHouseRig(net, nextMats, true);
  }

  // Put next house into crisp folded 3D pose on its dedicated ring-buffer material slot (hidden until swap!)
  nextMats.setProjection(null);
  applyPaperColorsTo(nextMats, nextRig);
  nextMats.projUniforms.uProjGain.value = materials.projUniforms.uProjGain.value;
  nextRig.setWindowOpen(mixWinOpenMode, mixWinOpen);
  const nextAnchorId =
    debugAnchorMode === 'floor'
      ? (nextRig.net.panels.find((p) => p.parent === null)?.id ?? 'base')
      : chooseFoldAnchorPanel(nextRig.net, nextGen, mixSeed).panelId;
  nextRig.setFoldAnchor(nextAnchorId, debugAnchorMode);
  for (const id of nextRig.panelIds) {
    nextRig.updatePanelVisual(id, 1, 0, false);
  }
  nextRig.syncAnchorPose(1);
  nextRig.setFoldLinesVisible(false);
  nextRig.setPaperRelief(1);
  if (nextRig.hasCutout) nextRig.updateCutoutDrop(99);
  nextRig.root.visible = false;
  scene.add(nextRig.root);

  const totalSec = FOLD_HOUSE_SEC;
  const realSec = totalSec / Math.max(0.25, autoSpeed);
  const spinSpan = debugSpinEnabled ? AUTO_SPIN_RAD_PER_SEC * realSec : 0;
  const idealA = computeIdealFraming(fromRig.net);
  const idealB = computeIdealFraming(nextRig.net);

  // Smooth landing camera for flat House A (`landPitch >= 0.34` guarantees 100% flat-sheet coverage of House B!)
  const baseLandYaw = debugGlideOnFoldEnabled
    ? fromPose.yaw + spinSpan + (fromGen % 2 === 0 ? 0.58 : -0.58)
    : fromPose.yaw + spinSpan;
  const baseLandPitch = debugGlideOnFoldEnabled
    ? Math.max(0.42, Math.min(1.08, 0.62 + ((fromGen * 7) % 3) * 0.14))
    : Math.max(0.34, Math.min(1.42, fromPose.pitch));
  const baseLandRoll = debugGlideOnFoldEnabled ? 0 : fromPose.roll;
  const baseLandDist = Math.max(idealA.flatDist, fromPose.dist, idealA.dist * 0.96);
  const landShadowExtent = Math.max(fromPose.shadowExtent, idealA.shadowExtent);

  // Target 3D viewing camera for House B (`destCam`)
  let destYaw = baseLandYaw;
  let destPitch = Math.max(0.26, Math.min(1.15, baseLandPitch));
  let destRoll = baseLandRoll;
  if (debugCameraTrick !== 'off') {
    const savedYaw = curYaw;
    curYaw = baseLandYaw;
    const jump = computeProjectionJumpView(nextRig.net, debugCameraTrick);
    curYaw = savedYaw;
    destYaw = jump.toYaw;
    destPitch = debugCameraTrick === 'drastic' ? jump.toPitch : Math.max(0.14, Math.min(1.48, jump.toPitch));
    destRoll = jump.toRoll;
  }

  // Fit flat House A's landing camera (`landDist`, `landYaw`) directly to 3D House B's silhouette!
  const sampleDestCam = camera.clone();
  sampleDestCam.up.set(0, 1, 0);
  sampleDestCam.position.set(
    idealB.dist * Math.cos(destPitch) * Math.sin(destYaw),
    idealB.lookY + idealB.dist * Math.sin(destPitch),
    idealB.dist * Math.cos(destPitch) * Math.cos(destYaw),
  );
  sampleDestCam.lookAt(0, idealB.lookY, 0);
  if (Math.abs(destRoll) > 1e-5) sampleDestCam.rotateZ(destRoll);
  sampleDestCam.updateProjectionMatrix();
  sampleDestCam.updateMatrixWorld(true);
  const silB = sampleFoldedHouseSilhouetteNDC(nextRig, sampleDestCam);

  // Reverse mode targets 100% paper-to-silhouette match so unfolding walls absorb the next 3D house cleanly!
  const baseLandPose = {
    yaw: baseLandYaw,
    pitch: baseLandPitch,
    roll: baseLandRoll,
    dist: baseLandDist,
    lookX: 0,
    lookY: BASE_LOOK_Y,
    lookZ: 0,
  };
  let landFit = fitFlatNetToSilhouetteNDC(silB, fromRig.net, baseLandPose, {
    fovDeg: camera.fov,
    aspect: camera.aspect,
    allowYawSearch: debugGlideOnFoldEnabled,
    maxYawDeltaRad: debugGlideOnFoldEnabled ? undefined : 0.45,
    minScale: 0.48,
    maxScale: 1.08,
    maxLookShiftRatio: 0,
    targetCoverage: 1.0,
  });
  if (landFit.coverage < 0.98 && baseLandPitch < 0.82) {
    const steeperLand = fitFlatNetToSilhouetteNDC(
      silB,
      fromRig.net,
      { ...baseLandPose, pitch: Math.min(1.08, Math.max(0.84, baseLandPitch + 0.24)) },
      {
        fovDeg: camera.fov,
        aspect: camera.aspect,
        allowYawSearch: true,
        minScale: 0.48,
        maxScale: 1.08,
        maxLookShiftRatio: 0,
        targetCoverage: 1.0,
      },
    );
    if (steeperLand.coverage > landFit.coverage + 0.03) {
      landFit = steeperLand;
    }
  }

  return {
    nextGen,
    nextRig,
    nextMats,
    nextMatIdx,
    targetRT: rtPool[nextMatIdx],
    startYaw: fromPose.yaw,
    startPitch: fromPose.pitch,
    startRoll: fromPose.roll,
    startDist: fromPose.dist,
    startLookX: 0,
    startLookY: idealA.lookY,
    startLookZ: 0,
    startShadowExtent: fromPose.shadowExtent,
    landYaw: landFit.yaw,
    landPitch: landFit.pitch,
    landRoll: landFit.roll,
    landDist: landFit.dist,
    landLookX: landFit.lookX,
    landLookY: landFit.lookY,
    landLookZ: landFit.lookZ,
    landShadowExtent,
    landCoverage: landFit.coverage,
    landBaseline: landFit.baselineCoverage,
    destYaw,
    destPitch,
    destRoll,
    destDist: idealB.dist,
    destLookY: idealB.lookY,
    destShadowExtent: idealB.shadowExtent,
    elapsedSec: 0,
    totalSec,
    swapReady: false,
    holdBeforeSwap: false,
  };
}

/**
 * Pre-calculates the Reverse projection chain BEFORE the current house starts unfolding:
 *  1. House C (`queuedReverse`) -> projected onto House B (`pendingReverse`)
 *  2. House B (`pendingReverse`, WITH House C already printed inside!) -> projected onto active House A (`rig`)
 * That way peeking through House A's windows already shows House B (zero pop on unfold start!),
 * AND swapping House A -> House B has 0/255 pixel delta even inside House B's own windows!
 */
function prepareReverseChain(): void {
  if (!debugReverseFoldEnabled || reverseUnfold || !rig) return;
  ensureProjTargetsSized();

  // Ensure active House A has its cutout & window chads built so it can reassemble cleanly on landing!
  if (!rig.hasCutout) {
    const curSpec = rig.net.spec;
    const prevAnchor = rig.anchorPanelId;
    const curNet = buildHouseNet(curSpec);
    scene.remove(rig.root);
    rig.dispose();
    rig = buildOrigamiHouseRig(curNet, materials, true);
    applyActiveOutsideColor(false, false);
    rig.setWindowOpen(mixWinOpenMode, mixWinOpen);
    rig.setFoldAnchor(prevAnchor, debugAnchorMode);
    scene.add(rig.root);
    for (const id of rig.panelIds) {
      const f = panelState.get(id)?.fold ?? 1;
      rig.updatePanelVisual(id, f, 0, false);
    }
    rig.syncAnchorPose(computeFoldProgress());
    rig.setFoldLinesVisible(false);
    rig.setPaperRelief(curPaperRelief);
    rig.updateCutoutDrop(99);
  }

  let builtAny = false;
  if (!pendingReverse) {
    const matB = nextMatSlot(activeMatIdx);
    pendingReverse = buildReversePlan(
      rig,
      generation,
      {
        yaw: curYaw,
        pitch: curPitch,
        roll: curRoll,
        dist: curDist,
        shadowExtent: curShadowExtent,
      },
      matB,
    );
    builtAny = true;
  }

  if (!queuedReverse) {
    const matC = nextMatSlot(pendingReverse.nextMatIdx);
    queuedReverse = buildReversePlan(
      pendingReverse.nextRig,
      pendingReverse.nextGen,
      {
        yaw: pendingReverse.destYaw,
        pitch: pendingReverse.destPitch,
        roll: pendingReverse.destRoll,
        dist: pendingReverse.destDist,
        shadowExtent: pendingReverse.destShadowExtent,
      },
      matC,
    );
    builtAny = true;
  }

  if (builtAny || reverseLookaheadDirty) {
    refreshReverseCaptures();
    reverseLookaheadDirty = false;
  }
}

/**
 * Reverse (Unfold) optical illusion:
 * Activates the ALREADY pre-calculated `pendingReverse` (whose projection is already sitting on
 * House A's interior walls with zero pop!), smoothly unfolds House A (`1 -> 0`) onto `landCam`,
 * and swaps seamlessly at `fold = 0` with 0/255 pixel delta directly into real 3D House B!
 */
function startReverseUnfold(continuousAuto = false, holdBeforeSwap = false): void {
  if (reverseUnfold) return;
  clearOutgoing();

  if (!pendingReverse || !queuedReverse || reverseLookaheadDirty) {
    prepareReverseChain();
  }
  const rev = pendingReverse;
  if (!rev) return;
  pendingReverse = null;

  const isManual = !continuousAuto && !autoFoldEnabled;
  activeFoldIsManual = isManual;
  const revTotalSec = isManual ? MANUAL_FOLD_HOUSE_SEC : FOLD_HOUSE_SEC;
  const revPadSec = isManual ? Math.min(0.16, cutoutDropDelay * 0.35) : Math.min(0.32, cutoutDropDelay * 0.5);

  // Snapshot live camera pose (in case the user orbited or turntable spun before clicking Unfold)
  // and wrap `landYaw` by 2π to the nearest equivalent angle to `curYaw` (exact same `snapVP`!).
  rev.startYaw = curYaw;
  rev.startPitch = curPitch;
  rev.startRoll = curRoll;
  rev.startDist = curDist;
  rev.startLookX = curLookX;
  rev.startLookY = curLookY;
  rev.startLookZ = curLookZ;
  rev.startShadowExtent = curShadowExtent;
  rev.landYaw = curYaw + wrapAnglePi(rev.landYaw - curYaw);
  rev.elapsedSec = 0;
  rev.totalSec = revTotalSec;
  rev.swapReady = false;
  rev.holdBeforeSwap = holdBeforeSwap;

  lastSilhouetteCoverage = rev.landCoverage;
  lastSilhouetteBaseline = rev.landBaseline;
  reverseUnfold = rev;

  materials.setProjectionFade(1);
  rig.setFoldLinesVisible(true);
  rig.updateCutoutReassemble(rev.totalSec, revPadSec);
  launchStaggeredFold(0, 0, rev.totalSec);
  soundtrack.triggerFoldLayer(rev.nextGen, true, rev.totalSec / Math.max(0.25, autoSpeed));

  if (continuousAuto) {
    autoBeatElapsed = 0;
    autoBeatRunning = true;
  }
  syncUI();
}

function completeReverseUnfoldSwap(): void {
  const rev = reverseUnfold;
  if (!rev) return;
  reverseUnfold = null;

  // Dispose old flat House A and seamlessly promote real 3D House B (0/255 pixel delta, even through windows!)
  scene.remove(rig.root);
  rig.dispose();
  materials.setProjection(null);

  activeMatIdx = rev.nextMatIdx;
  materials = rev.nextMats;
  // KEEP `materials` pre-calculated projection (House C) already baked on House B's interior — zero window pop!
  rig = rev.nextRig;
  rig.root.visible = true;
  generation = rev.nextGen;
  justProjected = false;

  // Advance 1-step lookahead (`queuedReverse` House C -> becomes `pendingReverse` for the next unfold!)
  pendingReverse = queuedReverse;
  queuedReverse = null;
  reverseLookaheadDirty = true;

  panelState.clear();
  for (const id of rig.panelIds) {
    panelState.set(id, {
      fold: 1,
      target: 1,
      startFold: 1,
      animElapsed: 0,
      animDuration: 0,
      animating: false,
      peek: 0,
      delay: 0,
    });
    rig.updatePanelVisual(id, 1, 0, false);
  }
  rig.setFoldLinesVisible(false);
  curPaperRelief = targetPaperRelief = 1;
  rig.setPaperRelief(1);
  // Start promoted Reverse house calm (`0`) on the exact 0/255 swap frame, then gently breathe into the breeze!
  rigWindStrength = 0;
  rig.setWind(windClockSec, 0);
  cutoutDropState = rig.hasCutout ? 'done' : 'none';
  cutoutDropElapsed = 0;
  if (rig.hasCutout) rig.updateCutoutDrop(99);

  curYaw = targetYaw = rev.destYaw;
  curPitch = targetPitch = rev.destPitch;
  curRoll = targetRoll = rev.destRoll;
  swapDist = computeIdealFraming(rig.net).flatDist;
  swapLookX = 0;
  swapLookY = BASE_LOOK_Y;
  swapLookZ = 0;
  finalDist = curDist = targetDist = rev.destDist;
  curLookX = targetLookX = 0;
  finalLookY = curLookY = targetLookY = rev.destLookY;
  curLookZ = targetLookZ = 0;
  curShadowExtent = swapShadowExtent = finalShadowExtent = rev.destShadowExtent;
  userZoomDelta = 0;
  applyActiveOutsideColor(false, false);
  syncCameraFromOrbit();

  syncUI();
  revealIntroMenu();

  if (autoFoldEnabled && !cityActive && catalogModal.hidden && helpModal.hidden) {
    autoBeatElapsed = 0;
    autoBeatRunning = true;
  }
}

function allPanelsSettledUnfolded(): boolean {
  return rig.panelIds.every((id) => {
    const ps = panelState.get(id);
    return ps && !ps.animating && ps.delay <= 0 && ps.fold <= 0.001 && ps.target <= 0.01;
  });
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
  return { minDist: 11, maxDist: Math.max(135, finalDist * 1.9) };
}

function computeAutoZoom(foldProg: number): {
  autoDist: number;
  autoLookX: number;
  autoLookY: number;
  autoLookZ: number;
  shadowExtent: number;
} {
  // Smooth cosine breath synced across the full 115 BPM folding bar (100% locked at fold=0 for zero-transition swap!)
  const zRaw = clamp01((foldProg - 0.03) / 0.94);
  const zoomEase = 0.5 - 0.5 * Math.cos(Math.PI * zRaw);
  const autoDist = swapDist + (finalDist - swapDist) * zoomEase;
  const autoLookX = swapLookX * (1 - zoomEase);
  const autoLookY = swapLookY + (finalLookY - swapLookY) * zoomEase;
  const autoLookZ = swapLookZ * (1 - zoomEase);

  // Expand shadow box ahead of tall walls rising so cast shadows never clip mid-fold!
  const sRaw = clamp01(foldProg / 0.42);
  const sEase = sRaw * sRaw * (3 - 2 * sRaw);
  const shadowExtent = swapShadowExtent + (finalShadowExtent - swapShadowExtent) * sEase;
  return { autoDist, autoLookX, autoLookY, autoLookZ, shadowExtent };
}

function revealCreasesAfterSwap(interactiveHover = false): void {
  if (justProjected) {
    justProjected = false;
    rig.setFoldLinesVisible(true);
    // Keep flat projected sheet melted seamlessly into #f5f4f0 until panels genuinely begin raising!
    // (Only reveal softly on manual hover/drag when the user wants to grab a waiting flat flap.)
    if (interactiveHover) {
      targetPaperRelief = Math.max(targetPaperRelief, 0.65);
    }
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
 * Velvet-smooth continuous harmonic folding curve (`115 BPM` musical glide):
 * lifts promptly on Beat 1 (so the incoming house starts raising early during the overlap!)
 * then decelerates gracefully through 75% -> 100% into a soft seamless finish.
 */
function easePaperFold(x: number, curve: FoldCurveShape = getActiveFoldCurve()): number {
  return evaluateFoldCurve(x, curve.inPct, curve.outPct, curve.curvePct);
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
  const anchorDef = rig.net.panelMap.get(rig.anchorPanelId);
  const useAdjacentAnchorOrder = Boolean(rig.anchorMode !== 'floor' && anchorDef && anchorDef.parent !== null);

  // Compute each panel's folded 3D centroid so anchor-rooted folds radiate smoothly outward from the
  // chosen wall/roof into its immediately ADJACENT faces (parent walls always leading their attached roofs!)
  const panel3DCentroid = (pid: PanelId): [number, number, number] => {
    const def = rig.net.panelMap.get(pid);
    if (!def || def.poly.length === 0) return [0, 0, 0];
    let sx = 0;
    let sy = 0;
    for (const [px, py] of def.poly) {
      sx += px;
      sy += py;
    }
    return evaluateFoldedPoint(rig.net, pid, [sx / def.poly.length, sy / def.poly.length], 1);
  };

  let sortedWalls: FoldablePanelId[];
  let wallNormPos: Map<FoldablePanelId, number> | null = null;
  if (useAdjacentAnchorOrder) {
    const [ax, ay, az] = panel3DCentroid(rig.anchorPanelId);
    const distByWall = new Map<FoldablePanelId, number>();
    let minD = Infinity;
    let maxD = -Infinity;
    for (const id of wallIds) {
      const [wx, wy, wz] = panel3DCentroid(id);
      // Horizontal + vertical 3D distance puts the anchor face (or supporting wall of an anchor roof) at 0,
      // immediately adjacent flank faces next, and opposite faces last!
      const d = Math.hypot(wx - ax, (wy - ay) * 0.45, wz - az);
      distByWall.set(id, d);
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
    }
    const spanD = Math.max(1e-3, maxD - minD);
    wallNormPos = new Map<FoldablePanelId, number>();
    for (const id of wallIds) {
      wallNormPos.set(id, ((distByWall.get(id) ?? minD) - minD) / spanD);
    }
    sortedWalls = [...wallIds].sort((a, b) => {
      const da = distByWall.get(a) ?? 0;
      const db = distByWall.get(b) ?? 0;
      if (Math.abs(da - db) > 1.5) return da - db;
      return wallOutwardDot(a) - wallOutwardDot(b);
    });
  } else {
    // Sort ascending by outward dot product: most negative = furthest away from camera -> folds FIRST!
    sortedWalls = [...wallIds].sort((a, b) => wallOutwardDot(a) - wallOutwardDot(b));
  }

  const wallRank = new Map<FoldablePanelId, number>();
  sortedWalls.forEach((id, i) => wallRank.set(id, i));

  // Curved progressive spacing across walls (0.00 -> ... -> 1.00)
  const wallCount = Math.max(1, sortedWalls.length - 1);
  const wallCurve = (rank: number, id?: FoldablePanelId) => {
    if (wallNormPos && id !== undefined) {
      // Blend true 3D adjacency distance with subtle tie-break rank so adjacent faces start smoothly together!
      const nd = wallNormPos.get(id) ?? rank / wallCount;
      return Math.pow(nd * 0.85 + (rank / wallCount) * 0.15, 1.15);
    }
    return Math.pow(rank / wallCount, 1.28);
  };

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

  // Multi-house compound villages always use their collision-free sequential curl-in-then-stand schedule
  // (`front -> right -> left` curl tightly into each building's own slab BEFORE `back` stands upright!)
  if (isVillage) {
    return computeVillageFoldSchedule(rig.net);
  }

  if (isRibbon) {
    // Wrap-around ribbon dance: `back` lifts the entire strip off the paper first, then `left` & `right`
    // curl inward like embracing arms (closer wing to anchor / farther from camera slightly ahead), and `front` closes!
    const leftLeads = wallNormPos
      ? (wallNormPos.get('left') ?? 0.5) <= (wallNormPos.get('right') ?? 0.5)
      : wallOutwardDot('left') <= wallOutwardDot('right');
    const ribbonTiming: Record<string, { d: number; s: number; dur: number }> = {
      back: { d: 0.0, s: 0.0, dur: 1.32 },
      left: { d: leftLeads ? 0.18 : 0.34, s: leftLeads ? 0.08 : 0.16, dur: 1.28 },
      right: { d: leftLeads ? 0.34 : 0.18, s: leftLeads ? 0.16 : 0.08, dur: 1.28 },
      front: { d: (leftLeads ? 0.34 : 0.18) + 0.24, s: (leftLeads ? 0.16 : 0.08) + 0.14, dur: 1.28 },
    };

    for (const id of wallIds) {
      const t = ribbonTiming[id] ?? { d: 0.3, s: 0.14, dur: 1.28 };
      pushItem(id, t.d, t.dur, t.s, isSawtooth ? 0.36 : hasCap ? 0.42 : 0.46);
    }
  } else if (isSetback) {
    // Tiered setback Z-pleat rise: ground podium walls rise from anchor/adjacent faces outward, then mountain
    // `upperWall` leads valley `terrace` in a real Z-pleat (`fold(upper) >= fold(terrace)` at every instant!)
    for (const id of sortedWalls) {
      const rank = wallRank.get(id) ?? 0;
      const c = wallCurve(rank, id);
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
    // Asymmetric L-wing choreography: base-hinged walls rise from anchor/adjacent faces outward, then the mountain
    // courtyard crease (`rightLower`) pre-bends slightly ahead of `wingBack` in a true Z-pleat!
    const rootWalls = sortedWalls.filter((id) => rig.net.panelMap.get(id)?.parent === 'base');
    const rootCount = Math.max(1, rootWalls.length - 1);
    rootWalls.forEach((id, i) => {
      const c = Math.pow(i / rootCount, 1.2);
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
    // Radial lotus-bloom choreography: starts from anchor + immediately adjacent flank petals, blooming smoothly around!
    for (const id of sortedWalls) {
      const rank = wallRank.get(id) ?? 0;
      const c = wallCurve(rank, id);
      pushItem(id, c * 0.68, 1.26, c * 0.28, hasCap ? 0.42 : 0.46);
    }
  } else {
    for (const id of sortedWalls) {
      const rank = wallRank.get(id) ?? 0;
      const c = wallCurve(rank, id);
      pushItem(id, c * 0.56, 1.28, c * 0.24, isSawtooth ? 0.38 : hasCap ? 0.44 : 0.48);
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
    if (parentIsRoof) {
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
      const isAnchorRoof = useAdjacentAnchorOrder && id === rig.anchorPanelId;
      d = (panelDelay.get(pId) ?? 0.35) + (isAnchorRoof ? 0.24 : 0.42);
      s = (panelScrub.get(pId) ?? 0.14) + (isAnchorRoof ? 0.12 : 0.20);
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

function launchStaggeredFold(toFold: 0 | 1, leadDelaySec = 0, targetTotalSec = FOLD_HOUSE_SEC): void {
  revealCreasesAfterSwap();
  latchedScrubYaw = curYaw;
  const schedule = getStaggerOrder(curYaw);
  const maxDelay = schedule.reduce((m, s) => Math.max(m, s.delaySec), 0);

  // Normalize the entire stagger wave uniformly to fit EXACTLY inside `targetTotalSec` (1 bar @ 115 BPM = 2.087s)!
  // Uniform scaling preserves every Z-pleat & mountain/valley zero-collision ordering guarantee while locking rhythm!
  const effectiveLead = toFold === 1 ? Math.max(0, leadDelaySec) : 0;
  const rawSpan = schedule.reduce((m, s) => {
    const rawD = toFold === 1 ? s.delaySec : Math.max(0, maxDelay - s.delaySec);
    return Math.max(m, rawD + s.durationSec);
  }, 0.1);
  const availableSec = Math.max(0.25, targetTotalSec - effectiveLead);
  const norm = availableSec / rawSpan;

  for (const s of schedule) {
    const ps = panelState.get(s.id);
    if (!ps) continue;
    // When unfolding, reverse the curved stagger wave so roof cap & slopes bloom open ahead of the walls!
    const rawDelay = toFold === 1 ? s.delaySec : Math.max(0, maxDelay - s.delaySec);
    const delay = effectiveLead + rawDelay * norm;
    startPanelCurve(ps, toFold, s.durationSec * norm, delay);
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
  autoBeatElapsed = 0;
  autoBeatRunning = false;
  fastSoundStep = 0;
  clearPreparedNext();
  clearReverseUnfold();
  materials.setProjection(null);
  targetYaw = curYaw = defaultYaw;
  targetPitch = curPitch = defaultPitch;
  targetRoll = curRoll = 0;
  mountHouseGeneration(1, false, false, !introAwaiting);
  if (introAwaiting) {
    applyIntroHintPose();
  }
  syncCameraFromOrbit();
  if (debugReverseFoldEnabled) {
    prepareReverseChain();
  } else {
    schedulePrepareNext(2, 120);
  }
  syncUI();
}

function setReverseMode(enabled: boolean, persist = true): void {
  const next = Boolean(enabled);
  if (debugReverseFoldEnabled === next) return;
  debugReverseFoldEnabled = next;
  clearOutgoing();
  clearReverseUnfold();
  clearPreparedNext();
  justProjected = false;
  autoBeatElapsed = 0;
  autoBeatRunning = false;
  materials.setProjection(null);
  mountHouseGeneration(generation, false);
  syncCameraFromOrbit();
  if (debugReverseFoldEnabled) {
    prepareReverseChain();
  } else {
    schedulePrepareNext(generation + 1, 80);
  }
  syncDebugControls();
  if (persist) saveDebugSettings();
  syncUI();
}

function setPlayMode(
  nextMode: PlayMode,
  opts: { persist?: boolean; startImmediately?: boolean } = {},
): void {
  revealIntroMenu();
  const { persist = true, startImmediately = true } = opts;
  const changed = playMode !== nextMode;
  playMode = nextMode;
  autoFoldEnabled = nextMode !== 'manual';
  if (autoFoldEnabled) activeFoldIsManual = false;

  const wantReverse = nextMode === 'reverse';
  if (debugReverseFoldEnabled !== wantReverse) {
    setReverseMode(wantReverse, false);
  } else if (changed) {
    autoBeatElapsed = 0;
    autoBeatRunning = false;
  }

  syncDebugControls();
  if (persist) saveDebugSettings();
  syncUI();

  if (startImmediately && autoFoldEnabled && !cityActive && catalogModal.hidden && helpModal.hidden) {
    if (debugReverseFoldEnabled) {
      if (!reverseUnfold) triggerStepAction(true);
    } else if (!allPanelsFoldedTarget() || allPanelsSettledFolded()) {
      triggerStepAction(true);
    }
  }
}

function startFromIntro(targetMode: PlayMode = 'slow'): void {
  if (!introAwaiting) return;
  introAwaiting = false;
  introHintBaseFold.clear();
  playMode = targetMode;
  autoFoldEnabled = targetMode !== 'manual';
  activeFoldIsManual = targetMode === 'manual';
  syncDebugControls();

  if (soundWanted && !document.hidden) {
    void setSoundEnabled(true, false, 4.2);
  }

  if (targetMode === 'reverse') {
    setReverseMode(true, false);
    if (!reverseUnfold) startReverseUnfold(true);
  } else {
    const dur =
      targetMode === 'manual'
        ? MANUAL_FOLD_HOUSE_SEC
        : targetMode === 'slow'
          ? SLOW_FOLD_HOUSE_SEC
          : FOLD_HOUSE_SEC;
    launchStaggeredFold(1, 0, dur);
    if (autoFoldEnabled) {
      autoBeatElapsed = 0;
      autoBeatRunning = true;
    }
  }
  syncUI();
}

function activateManualFold(): void {
  if (introAwaiting) {
    startFromIntro('slow');
    return;
  }
  revealIntroMenu();
  if (playMode !== 'manual') {
    setPlayMode('manual', { persist: true, startImmediately: false });
  }
  triggerStepAction(false);
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
  playMode = FACTORY_SETTINGS.playMode;
  debugReverseFoldEnabled = FACTORY_SETTINGS.reverseFold;
  debugCameraTrick = FACTORY_SETTINGS.cameraTrick;
  debugGlideOnFoldEnabled = FACTORY_SETTINGS.glideOnFold;
  debugAnchorMode = FACTORY_SETTINGS.anchorMode;
  debugFadeProjEnabled = FACTORY_SETTINGS.fadeProjOnFold;
  autoFoldEnabled = FACTORY_SETTINGS.autoFold;
  autoSpeed = FACTORY_SETTINGS.autoSpeed;
  autoEaseIn = FACTORY_SETTINGS.autoEaseIn;
  autoEaseOut = FACTORY_SETTINGS.autoEaseOut;
  autoCurve = FACTORY_SETTINGS.autoCurve;
  autoEaseIn2 = FACTORY_SETTINGS.autoEaseIn2;
  autoEaseOut2 = FACTORY_SETTINGS.autoEaseOut2;
  autoCurve2 = FACTORY_SETTINGS.autoCurve2;
  editingCurveTab = 1;
  autoHandoff = FACTORY_SETTINGS.autoHandoff;
  cutoutDropDelay = FACTORY_SETTINGS.cutoutDropDelay;
  shadowStrength = FACTORY_SETTINGS.shadowStrength;
  shadowBlur = FACTORY_SETTINGS.shadowBlur;
  sunAzimuth = FACTORY_SETTINGS.sunAzimuth;
  sunElevation = FACTORY_SETTINGS.sunElevation;
  syncDebugControls();
  resetAll();
  applyActiveOutsideColor();
  if (!catalogModal.hidden) rebuildCatalogGrid(true);
}

let fastSoundStep = 0;

function triggerSoundForFold(houseDur: number): void {
  const scaledDur = houseDur / Math.max(0.25, autoSpeed);
  if (playMode === 'fast') {
    const step = fastSoundStep++;
    if (step % 2 !== 0) return;
    soundtrack.triggerFoldLayer(generation, false, scaledDur * 1.8);
    return;
  }
  fastSoundStep = 0;
  soundtrack.triggerFoldLayer(generation, false, scaledDur);
}

function triggerStepAction(continuousAuto = false, phaseCarrySec = 0): void {
  if (debugReverseFoldEnabled) {
    if (reverseUnfold) return;
    startReverseUnfold(continuousAuto);
    return;
  }
  const isManual = !continuousAuto && !autoFoldEnabled;
  const leadSec = continuousAuto ? 0 : MANUAL_LEAD_DELAY_SEC;
  const baseDur = isManual
    ? MANUAL_FOLD_HOUSE_SEC
    : playMode === 'slow'
      ? SLOW_FOLD_HOUSE_SEC
      : FOLD_HOUSE_SEC;
  const houseDur = Math.max(0.5, baseDur - (continuousAuto ? phaseCarrySec : 0));
  const foldProg = computeFoldProgress();
  const retriggerThreshold = isManual ? 0.42 : 0.65;

  // Trigger overlapping live handoff when:
  // - Current house is settled, OR
  // - Auto 115 BPM downbeat hits while current house is finishing, OR
  // - Manual tap while current house is already >= 42% folded (instant reactive chaining!)
  if (allPanelsSettledFolded() || (allPanelsFoldedTarget() && (continuousAuto || foldProg >= retriggerThreshold))) {
    projectAndSpawnUnderneath(debugCameraTrick, true);
    activeFoldIsManual = isManual;
    triggerCutoutDrop();
    launchStaggeredFold(1, leadSec, houseDur);
    triggerSoundForFold(houseDur);
    if (continuousAuto) {
      autoBeatElapsed = phaseCarrySec;
      autoBeatRunning = true;
    }
    return;
  }
  if (!allPanelsFoldedTarget()) {
    activeFoldIsManual = isManual;
    const lead = cutoutDropState === 'waiting' ? leadSec : 0;
    if (cutoutDropState === 'waiting') triggerCutoutDrop();
    launchStaggeredFold(1, lead, houseDur);
    triggerSoundForFold(houseDur);
    if (continuousAuto) {
      autoBeatElapsed = phaseCarrySec;
      autoBeatRunning = true;
    }
  }
}

function toggleFoldAll(): void {
  const isManual = !autoFoldEnabled;
  activeFoldIsManual = isManual;
  const dur = isManual ? MANUAL_FOLD_HOUSE_SEC : FOLD_HOUSE_SEC;
  if (!allPanelsFoldedTarget() && cutoutDropState === 'waiting') {
    triggerCutoutDrop();
    launchStaggeredFold(1, MANUAL_LEAD_DELAY_SEC, dur);
    return;
  }
  launchStaggeredFold(allPanelsFoldedTarget() ? 0 : 1, 0, dur);
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
  if (debugReverseFoldEnabled) {
    if (reverseUnfold) {
      statusEl.textContent = `${prefix}Unfolding`;
    } else {
      statusEl.textContent = `${prefix}Reverse`;
    }
    return;
  }
  if (!allTargetFolded) {
    statusEl.textContent = `${prefix}Click anywhere to fold`;
  } else if (!settledFolded) {
    statusEl.textContent = `${prefix}Folding`;
  } else {
    statusEl.textContent = `${prefix}Folded`;
  }
}

// ----------------------------------------------------------------------------
// Click-Anywhere Fold & Drag-Anywhere Turntable Interaction
// ----------------------------------------------------------------------------
type DragMode =
  | { kind: 'none' }
  | { kind: 'orbit'; startX: number; startY: number; lastX: number; lastY: number; moved: boolean };

let drag: DragMode = { kind: 'none' };
const activePointers = new Map<number, { x: number; y: number }>();
let lastPinchDist = 0;
let pinchedThisGesture = false;

canvas.addEventListener('pointerdown', (e) => {
  if (cityActive && cityView) {
    cityView.onPointerDown(e, canvas);
    return;
  }
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  canvas.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size >= 2) {
    pinchedThisGesture = true;
    const pts = Array.from(activePointers.values());
    lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    drag = { kind: 'none' };
    canvas.classList.remove('orbiting');
    return;
  }

  pinchedThisGesture = false;
  drag = {
    kind: 'orbit',
    startX: e.clientX,
    startY: e.clientY,
    lastX: e.clientX,
    lastY: e.clientY,
    moved: false,
  };
});

canvas.addEventListener('pointermove', (e) => {
  if (cityActive && cityView) {
    cityView.onPointerMove(e, canvas);
    return;
  }
  const prevPtr = activePointers.get(e.pointerId);
  if (!prevPtr) return;
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
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) {
      drag.moved = true;
      canvas.classList.add('orbiting');
    }
    if (drag.moved) {
      if (Math.hypot(dx, dy) > 1.5) revealCreasesAfterSwap(true);
      targetYaw -= dx * 0.0072;
      targetPitch = Math.max(0.06, Math.min(1.50, targetPitch + dy * 0.0068));
    }
  }
});

function endPointer(e: PointerEvent, isCancel: boolean): void {
  activePointers.delete(e.pointerId);
  const wasClick = !isCancel && !pinchedThisGesture && drag.kind === 'orbit' && !drag.moved;

  if (activePointers.size === 0) {
    canvas.classList.remove('orbiting');
    lastPinchDist = 0;
    pinchedThisGesture = false;
  }

  drag = { kind: 'none' };

  if (wasClick) {
    activateManualFold();
  }
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
  activateManualFold();
});
btnNext.addEventListener('click', (e) => {
  e.stopPropagation();
  activateManualFold();
});
btnReset.addEventListener('click', (e) => {
  e.stopPropagation();
  resetAll();
});

for (const btn of modeBtns) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const mode = btn.dataset.mode as PlayMode | undefined;
    if (mode && VALID_PLAY_MODES.includes(mode)) {
      setPlayMode(mode);
    }
  });
}

btnSound.addEventListener('click', (e) => {
  e.stopPropagation();
  const next = btnSound.getAttribute('aria-pressed') !== 'true';
  void setSoundEnabled(next);
});

function remountWithCurrentMix(persist = true): void {
  syncDebugControls();
  if (persist) saveDebugSettings();
  const wasFolded = computeFoldProgress() > 0.5;
  const savedZoomDelta = userZoomDelta;
  clearPreparedNext();
  justProjected = false;
  materials.setProjection(null);
  mountHouseGeneration(generation, false, false, wasFolded);
  userZoomDelta = savedZoomDelta;
  const z = computeAutoZoom(wasFolded ? 1 : 0);
  const { minDist, maxDist } = getZoomBounds();
  targetDist = curDist = Math.max(minDist, Math.min(maxDist, z.autoDist + userZoomDelta));
  targetLookX = curLookX = z.autoLookX;
  targetLookY = curLookY = z.autoLookY;
  targetLookZ = curLookZ = z.autoLookZ;
  curShadowExtent = z.shadowExtent;
  applyShadowFrustum(curShadowExtent);
  syncCameraFromOrbit();
  if (debugReverseFoldEnabled) {
    prepareReverseChain();
  } else {
    schedulePrepareNext(generation + 1, 80);
  }
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

let catalogThumbs: CatalogThumbRenderer | null = null;
let catalogThumbsLoadPromise: Promise<CatalogThumbRenderer> | null = null;
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

function loadCatalogThumbs(): Promise<CatalogThumbRenderer> {
  if (catalogThumbs) return Promise.resolve(catalogThumbs);
  if (!catalogThumbsLoadPromise) {
    catalogThumbsLoadPromise = import('./catalogThumbRenderer').then(({ CatalogThumbRenderer: Ctor }) => {
      if (!catalogThumbs) {
        catalogThumbs = new Ctor({
          renderer,
          envTexture: sharedEnvTexture,
          sharedWashiTextures,
        });
      }
      return catalogThumbs;
    });
  }
  return catalogThumbsLoadPromise;
}

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
  if (!catalogThumbs) {
    catalogRafId = null;
    void loadCatalogThumbs().then(() => {
      if (token === catalogRenderToken && !catalogModal.hidden && catalogPendingQueue.length > 0 && catalogRafId === null) {
        catalogRafId = window.requestAnimationFrame(() => pumpCatalogQueue(token));
      }
    });
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
    if (catalogThumbs && catalogThumbs.getCached(job.cacheKey)) {
      catalogThumbs.renderToCanvas(job.cacheKey, job.spec, job.thumbCanvas, debugColorEnabled, catalogViewMode, mixWinOpenMode, mixWinOpen);
      job.thumbCanvas.classList.add('is-ready');
    } else {
      catalogPendingQueue.push(job);
    }
  }
  if (catalogPendingQueue.length > 0 && catalogRafId === null) {
    if (catalogThumbs) {
      catalogRafId = window.requestAnimationFrame(() => pumpCatalogQueue(token));
    } else {
      void loadCatalogThumbs().then(() => {
        if (token === catalogRenderToken && !catalogModal.hidden && catalogPendingQueue.length > 0 && catalogRafId === null) {
          catalogRafId = window.requestAnimationFrame(() => pumpCatalogQueue(token));
        }
      });
    }
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
  targetRoll = curRoll = 0;
  mountHouseGeneration(generation, false, false, false);
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

    if (catalogThumbs && catalogThumbs.getCached(cacheKey)) {
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
// 3/4-Top Interactive Italian Mountain Island Diorama (Touch-to-Fold + Serpentine)
// ----------------------------------------------------------------------------
let cityView: CityView | null = null;
let cityViewLoadPromise: Promise<CityView> | null = null;
let cityActive = false;
let citySeed = mixSeed;
const pHills = params.get('hills');
let cityHills =
  pHills !== null && Number.isFinite(Number(pHills))
    ? Math.max(0, Math.min(1, Number(pHills) > 1 ? Number(pHills) / 100 : Number(pHills)))
    : 0.72;
let cityBuiltKey = '';
let cityRebuildDebounce: number | null = null;
const CITY_DEFAULT_STATUS = 'Click or drag to fold houses · Cmd-drag or two fingers to rotate · Pinch to zoom';
const CITY_COMPLETE_STATUS = 'Island village complete · Cmd-drag or two fingers to rotate · Clear or Roll a new island';

function getCityBuildKey(): string {
  return `${citySeed}|${Math.round(cityHills * 100)}|${mixConsistency === null ? 'd' : Math.round(mixConsistency * 100)}|${mixWindow ?? 'a'}|${mixWinOpening ?? 'a'}|${mixWinDetail ?? 'a'}`;
}

function updateCityHud(stats?: CityViewStats | null): void {
  const st = stats ?? cityView?.getStats() ?? null;
  citySeedInput.value = String(citySeed);
  const hPct = Math.round(cityHills * 100);
  cityHillsInput.value = String(hPct);
  cityHillsVal.textContent = `${hPct}%`;
  cityColorBtn.setAttribute('aria-pressed', debugColorEnabled ? 'true' : 'false');
  const folded = st ? st.foldedCount : 0;
  const total = st ? st.totalPlots : 0;
  const allFolded = total > 0 && folded >= total;
  cityFoldBtn.textContent = allFolded ? 'Clear' : 'Fold all';
  if (st) {
    citySubtitle.textContent = allFolded
      ? `Seed ${citySeed} · ${total} / ${total} · Complete`
      : `Seed ${citySeed} · ${folded} / ${total} folded`;
    cityStatus.textContent = allFolded ? CITY_COMPLETE_STATUS : CITY_DEFAULT_STATUS;
  } else {
    citySubtitle.textContent = `Seed ${citySeed}`;
  }
}

function loadCityView(): Promise<CityView> {
  if (cityView) return Promise.resolve(cityView);
  if (!cityViewLoadPromise) {
    cityViewLoadPromise = import('./cityView').then(({ CityView: CityViewCtor }) => {
      if (!cityView) {
        cityView = new CityViewCtor(
          renderer.capabilities.getMaxAnisotropy(),
          sharedEnvTexture,
          {
            onWorldStats: (stats) => {
              if (cityActive) updateCityHud(stats);
            },
            onSelectPlot: (plot: CityBuildingPlot) => {
              setCityOpen(false);
              selectCatalogSpecimen(`city_${plot.id}`, plot.generation, plot.mixOpts);
            },
          },
          sharedWashiTextures,
        );
        const rect = canvas.getBoundingClientRect();
        cityView.resize(Math.max(1, rect.width), Math.max(1, rect.height));
        cityView.setColorEnabled(debugColorEnabled);
        cityView.setWindowOpen(mixWinOpenMode, mixWinOpen);
      }
      return cityView;
    });
  }
  return cityViewLoadPromise;
}

function withCityView(fn: (cv: CityView) => void): void {
  if (cityView) {
    fn(cityView);
    return;
  }
  void loadCityView().then(fn);
}

function rebuildCity(resetCamera = true): void {
  withCityView((cv) => {
    cv.setColorEnabled(debugColorEnabled);
    cv.setWindowOpen(mixWinOpenMode, mixWinOpen);
    cv.rebuild(
      {
        seed: citySeed,
        hills: cityHills,
        consistency: mixConsistency,
        windowStyle: mixWindow,
        windowOpening: mixWinOpening,
        windowDetail: mixWinDetail,
      },
      resetCamera,
    );
    cityBuiltKey = getCityBuildKey();
    updateCityHud(cv.getStats());
  });
}

function scheduleCityRebuild(delayMs = 90): void {
  if (cityRebuildDebounce !== null) window.clearTimeout(cityRebuildDebounce);
  cityRebuildDebounce = window.setTimeout(() => {
    cityRebuildDebounce = null;
    if (cityActive) rebuildCity(false);
  }, delayMs);
}

function setCityOpen(open: boolean, resetCamera = false): void {
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
    updateCityHud();
    withCityView((cv) => {
      if (!cityActive) return;
      cv.setColorEnabled(debugColorEnabled);
      cv.setWindowOpen(mixWinOpenMode, mixWinOpen);
      const nextKey = getCityBuildKey();
      if (!cv.world || cityBuiltKey !== nextKey || resetCamera) {
        rebuildCity(true);
      } else {
        updateCityHud(cv.getStats());
      }
    });
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
cityHillsInput.addEventListener('input', () => {
  const pct = Math.max(0, Math.min(100, Number(cityHillsInput.value) || 0));
  cityHills = pct / 100;
  cityHillsVal.textContent = `${pct}%`;
  scheduleCityRebuild(80);
});
cityFoldBtn.addEventListener('click', () => {
  withCityView((cv) => {
    const st = cv.getStats();
    const allFolded = st.totalPlots > 0 && st.foldedCount >= st.totalPlots;
    cv.setCityFold(allFolded ? 0 : 1, false);
    updateCityHud(cv.getStats());
  });
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
  mixLevels = raw === 'auto' ? null : (Math.max(1, Math.min(6, Number(raw) || 1)) as BuildingLevels);
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
dbgCameraTrick.addEventListener('change', () => {
  const raw = dbgCameraTrick.value;
  if (VALID_CAMERA_TRICKS.includes(raw as CameraTrickMode)) {
    debugCameraTrick = raw as CameraTrickMode;
    saveDebugSettings();
  }
});
dbgGlideFold.addEventListener('change', () => {
  debugGlideOnFoldEnabled = dbgGlideFold.checked;
  saveDebugSettings();
});
for (const btn of dbgAnchorModeBtns) {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.anchorMode;
    if (mode !== 'rest' && mode !== 'subtle' && mode !== 'floor') return;
    debugAnchorMode = mode;
    if (rig) {
      if (mode === 'floor') {
        const baseId = rig.net.panels.find((p) => p.parent === null)?.id ?? 'base';
        rig.setFoldAnchor(baseId, 'floor');
      } else {
        rig.setAnchorMode(mode);
      }
      rig.syncAnchorPose(computeFoldProgress());
    }
    syncDebugControls();
    saveDebugSettings();
  });
}
dbgFadeProj.addEventListener('change', () => {
  debugFadeProjEnabled = dbgFadeProj.checked;
  materials.setProjectionFade(computeProjectionFade(computeFoldProgress()));
  saveDebugSettings();
});
dbgAutoSpeed.addEventListener('input', () => {
  const pct = Math.max(25, Math.min(300, Number(dbgAutoSpeed.value) || 100));
  autoSpeed = pct / 100;
  dbgAutoSpeedVal.textContent = `${autoSpeed.toFixed(2)}×`;
  saveDebugSettings();
});
dbgAutoHandoff.addEventListener('input', () => {
  autoHandoff = Math.max(35, Math.min(140, Number(dbgAutoHandoff.value) || 70));
  dbgAutoHandoffVal.textContent = `${Math.round(autoHandoff)}%`;
  updateCurvePreview();
  saveDebugSettings();
});
for (const btn of dbgCurveTabBtns) {
  btn.addEventListener('click', () => {
    editingCurveTab = btn.dataset.curveTab === '2' ? 2 : 1;
    syncCurveTabSliders();
  });
}
dbgCurveBox.addEventListener('click', (e) => {
  const rect = dbgCurveBox.getBoundingClientRect();
  if (rect.width <= 0) return;
  const relX = (e.clientX - rect.left) / rect.width;
  const split = Math.min(0.65, Math.max(0.32, (autoHandoff / 100) / DUAL_CURVE_MAX_T + 0.08));
  editingCurveTab = relX >= split ? 2 : 1;
  syncCurveTabSliders();
});
dbgAutoIn.addEventListener('input', () => {
  const v = Math.max(0, Math.min(100, Number(dbgAutoIn.value) || 0));
  if (editingCurveTab === 1) autoEaseIn = v;
  else autoEaseIn2 = v;
  dbgAutoInVal.textContent = `${Math.round(v)}%`;
  updateCurvePreview();
  saveDebugSettings();
});
dbgAutoOut.addEventListener('input', () => {
  const v = Math.max(0, Math.min(100, Number(dbgAutoOut.value) || 0));
  if (editingCurveTab === 1) autoEaseOut = v;
  else autoEaseOut2 = v;
  dbgAutoOutVal.textContent = `${Math.round(v)}%`;
  updateCurvePreview();
  saveDebugSettings();
});
dbgAutoCurve.addEventListener('input', () => {
  const v = Math.max(0, Math.min(100, Number(dbgAutoCurve.value) || 0));
  if (editingCurveTab === 1) autoCurve = v;
  else autoCurve2 = v;
  dbgAutoCurveVal.textContent = `${Math.round(v)}%`;
  updateCurvePreview();
  saveDebugSettings();
});
dbgCutoutDelay.addEventListener('input', () => {
  const cs = Math.max(0, Math.min(250, Number(dbgCutoutDelay.value) || 0));
  cutoutDropDelay = cs / 100;
  dbgCutoutDelayVal.textContent = `${cutoutDropDelay.toFixed(2)}s`;
  updateCurvePreview();
  saveDebugSettings();
});
dbgShadowStrength.addEventListener('input', () => {
  shadowStrength = Math.max(0, Math.min(200, Number(dbgShadowStrength.value) || 0));
  dbgShadowStrengthVal.textContent = `${Math.round(shadowStrength)}%`;
  applyActiveOutsideColor();
  saveDebugSettings();
});
dbgShadowBlur.addEventListener('input', () => {
  shadowBlur = Math.max(0, Math.min(8, Number(dbgShadowBlur.value) || 0));
  dbgShadowBlurVal.textContent = shadowBlur.toFixed(1);
  applyActiveOutsideColor();
  saveDebugSettings();
});
dbgSunAzimuth.addEventListener('input', () => {
  sunAzimuth = ((Number(dbgSunAzimuth.value) || 0) % 360 + 360) % 360;
  dbgSunAzimuthVal.textContent = `${Math.round(sunAzimuth)}°`;
  applyActiveOutsideColor();
  saveDebugSettings();
});
dbgSunElevation.addEventListener('input', () => {
  sunElevation = Math.max(12, Math.min(85, Number(dbgSunElevation.value) || 55));
  dbgSunElevationVal.textContent = `${Math.round(sunElevation)}°`;
  applyActiveOutsideColor();
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

  if (isDebugMode && (e.key === '?' || (e.key === '/' && e.shiftKey))) {
    e.preventDefault();
    setHelpOpen(helpModal.hidden);
    return;
  }
  if (isDebugMode && (e.key === 'g' || e.key === 'G')) {
    e.preventDefault();
    setCatalogOpen(catalogModal.hidden);
    return;
  }
  if (isDebugMode && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault();
    setCityOpen(!cityActive);
    return;
  }
  if (cityActive && helpModal.hidden && catalogModal.hidden) {
    if (e.key === ' ' || e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      withCityView((cv) => {
        const st = cv.getStats();
        const allFolded = st.totalPlots > 0 && st.foldedCount >= st.totalPlots;
        cv.setCityFold(allFolded ? 0 : 1, false);
        updateCityHud(cv.getStats());
      });
    } else if (e.key === 'm' || e.key === 'M') {
      const next = btnSound.getAttribute('aria-pressed') !== 'true';
      void setSoundEnabled(next);
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      withCityView((cv) => {
        cv.setCityFold(0, false);
        updateCityHud(cv.getStats());
      });
    }
    return;
  }
  if (!helpModal.hidden || !catalogModal.hidden) return;

  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (introAwaiting) {
      startFromIntro('slow');
    } else {
      activateManualFold();
    }
  } else if (e.key === '1') {
    if (introAwaiting) startFromIntro('manual');
    else setPlayMode('manual', { startImmediately: false });
  } else if (e.key === '2') {
    if (introAwaiting) startFromIntro('slow');
    else setPlayMode('slow');
  } else if (e.key === '3') {
    if (introAwaiting) startFromIntro('fast');
    else setPlayMode('fast');
  } else if (e.key === '4') {
    if (introAwaiting) startFromIntro('reverse');
    else setPlayMode('reverse');
  } else if (e.key === 'f' || e.key === 'F') {
    if (introAwaiting) startFromIntro('slow');
    else toggleFoldAll();
  } else if (e.key === 'a' || e.key === 'A') {
    if (introAwaiting) startFromIntro('fast');
    else setPlayMode(playMode === 'fast' ? 'manual' : 'fast');
  } else if (e.key === 'm' || e.key === 'M') {
    if (introAwaiting) {
      soundWanted = !soundWanted;
      btnSound.setAttribute('aria-pressed', soundWanted ? 'true' : 'false');
    } else {
      const next = btnSound.getAttribute('aria-pressed') !== 'true';
      void setSoundEnabled(next);
    }
  } else if (e.key === 'r' || e.key === 'R') {
    resetAll();
  } else if ((e.key === 'd' || e.key === 'D') && isDebugMode) {
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
    if (introAwaiting) {
      frameIntroHintPose();
    } else if (!justProjected && !reverseUnfold) {
      const fp = computeFoldProgress();
      if (fp <= 0.02) {
        swapDist = targetDist = curDist = ideal.flatDist;
      } else if (fp >= 0.98) {
        swapDist = ideal.flatDist;
        targetDist = curDist = ideal.dist + userZoomDelta;
        targetLookY = curLookY = ideal.lookY;
        curShadowExtent = swapShadowExtent = finalShadowExtent = ideal.shadowExtent;
        applyShadowFrustum(curShadowExtent);
      }
    }
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
  const fp = computeFoldProgress();
  for (const id of rig.panelIds) {
    rig.updatePanelVisual(id, panelState.get(id)?.fold ?? 0, 0, false);
  }
  rig.syncAnchorPose(fp);
  const z = computeAutoZoom(fp);
  targetDist = curDist = z.autoDist;
  targetLookY = curLookY = z.autoLookY;
  curShadowExtent = z.shadowExtent;
  applyShadowFrustum(curShadowExtent);
}
syncCameraFromOrbit();
if (debugReverseFoldEnabled) {
  prepareReverseChain();
}
syncUI();
if (isDebugMode && params.has('city')) {
  setCityOpen(true, !params.has('instant'));
  if (params.has('instant')) {
    withCityView((cv) => cv.setCityFold(1, true));
  }
} else if (isDebugMode && params.has('grid') && !params.has('clean')) {
  setCatalogOpen(true);
}

// Debug hook
(
  window as unknown as {
    __origami?: {
      progress: (v: number) => void;
      fold: (pid: FoldablePanelId, v: number) => void;
      projectNow: (mode?: CameraTrickMode | boolean) => void;
      dropCutout: (atSec?: number) => void;
      setColor: (enabled: boolean) => void;
      setModel: (slot: number | null) => void;
      setMix: (opts: HouseMixOptions) => void;
      setSeed: (seed: number) => void;
      setConsistency: (consistency: number | null) => void;
      setWindowOpen: (mode: WindowOpenMode, ratio?: number) => void;
      openCatalog: (open?: boolean) => void;
      openCity: (open?: boolean, opts?: { seed?: number; hills?: number; instant?: boolean }) => void;
      cityView: (yaw: number, pitch: number, dist: number, tx?: number, ty?: number, tz?: number) => void;
      cityFold: (target: 0 | 1, instant?: boolean) => void;
      cityTouch: (wx: number, wz: number, radius?: number, isClick?: boolean) => number;
      cityInfo: () => CityViewStats | null;
      setSpin: (enabled: boolean) => void;
      setMode: (mode: PlayMode) => void;
      setReverse: (enabled: boolean) => void;
      unfoldNow: (holdBeforeSwap?: boolean) => void;
      reverseSwapNow: () => void;
      setCameraTrick: (mode: CameraTrickMode) => void;
      setPerspectiveCut: (enabled: boolean) => void;
      setGlideOnFold: (enabled: boolean) => void;
      setFadePrint: (enabled: boolean) => void;
      setAuto: (enabled: boolean) => void;
      setSound: (enabled: boolean) => Promise<boolean>;
      soundInfo: () => SoundtrackState;
      setAutoCurve: (opts: {
        speed?: number;
        inPct?: number;
        outPct?: number;
        curvePct?: number;
        inPct2?: number;
        outPct2?: number;
        curvePct2?: number;
        handoffPct?: number;
        cutoutDelaySec?: number;
      }) => void;
      setLighting: (opts: { shadowStrength?: number; shadowBlur?: number; sunAzimuth?: number; sunElevation?: number }) => void;
      setFoldAnchor: (panelId: PanelId, mode?: FoldAnchorMode) => void;
      setAnchorMode: (mode: FoldAnchorMode) => void;
      view: (yaw: number, pitch: number, dist: number, roll?: number) => void;
      info: () => {
        generation: number;
        seed: number;
        consistency: number;
        label: string;
        topology: string;
        roofType: string;
        anchorPanel: PanelId;
        anchorKind: FoldAnchorKind;
        anchorMode: FoldAnchorMode;
        manualReactive: boolean;
        W: number;
        D: number;
        H: number;
        sheetMm: number;
        foldedHeightMm: number;
        curDist: number;
        finalDist: number;
        yaw: number;
        pitch: number;
        bpm: number;
        barSec: number;
        autoSpeed: number;
        autoEaseIn: number;
        autoEaseOut: number;
        autoCurve: number;
        autoEaseIn2: number;
        autoEaseOut2: number;
        autoCurve2: number;
        autoHandoff: number;
        cutoutDropDelay: number;
        cameraTrick: CameraTrickMode;
        playMode: PlayMode;
        introAwaiting: boolean;
        reverseFold: boolean;
        reverseUnfolding: boolean;
        reverseSwapReady: boolean;
        glideOnFold: boolean;
        fadePrint: boolean;
        shadowStrength: number;
        shadowBlur: number;
        sunAzimuth: number;
        sunElevation: number;
        foldProgress: number;
        overlapActive: boolean;
        outgoingFoldProgress: number;
        outgoingLiveFrames: number;
        silhouetteCoverage: number;
        silhouetteBaseline: number;
      };
    };
  }
).__origami = {
  progress(v: number) {
    applyFoldScrub(v, true);
    for (const id of rig.panelIds) {
      rig.updatePanelVisual(id, panelState.get(id)?.fold ?? 0, 0, false);
    }
    const fp = computeFoldProgress();
    rig.syncAnchorPose(fp);
    if (v > 0.001) {
      curPaperRelief = targetPaperRelief = 1;
      rig.setPaperRelief(1);
      if (rig.hasCutout) {
        cutoutDropState = 'done';
        rig.updateCutoutDrop(99);
      }
    }
    materials.setProjectionFade(computeProjectionFade(fp));
    const z = computeAutoZoom(fp);
    const { minDist, maxDist } = getZoomBounds();
    targetDist = curDist = Math.max(minDist, Math.min(maxDist, z.autoDist + userZoomDelta));
    targetLookX = curLookX = z.autoLookX;
    targetLookY = curLookY = z.autoLookY;
    targetLookZ = curLookZ = z.autoLookZ;
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
      rig.updatePanelVisual(pid, v, 0, false);
      rig.syncAnchorPose(computeFoldProgress());
      syncUI();
    }
  },
  projectNow(mode: CameraTrickMode | boolean = debugCameraTrick) {
    const resolved: CameraTrickMode =
      typeof mode === 'boolean' ? (mode ? 'drastic' : 'off') : mode;
    projectAndSpawnUnderneath(resolved);
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
    cityView?.setColorEnabled(debugColorEnabled);
    if (cityActive) updateCityHud();
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
  openCity(open = true, opts?: { seed?: number; hills?: number; instant?: boolean }) {
    if (opts?.seed !== undefined) citySeed = Math.max(0, Math.min(99999, Math.round(opts.seed)));
    if (opts?.hills !== undefined) cityHills = Math.max(0, Math.min(1, opts.hills));
    setCityOpen(open, true);
    if (open && opts?.instant) {
      rebuildCity(true);
      withCityView((cv) => cv.setCityFold(1, true));
    }
  },
  cityView(yaw: number, pitch: number, dist: number, tx = 0, ty = 5.4, tz = 1.5) {
    withCityView((cv) => cv.setCameraView(yaw, pitch, dist, tx, ty, tz));
  },
  cityFold(target: 0 | 1, instant = false) {
    withCityView((cv) => {
      cv.setCityFold(target, instant);
      updateCityHud();
    });
  },
  cityTouch(wx: number, wz: number, radius?: number, isClick = true) {
    if (!cityView) return 0;
    const count = cityView.touchAt(wx, wz, radius, isClick);
    updateCityHud();
    return count;
  },
  cityInfo() {
    return cityView ? cityView.getStats() : null;
  },
  setSpin(enabled: boolean) {
    debugSpinEnabled = enabled;
    syncDebugControls();
    saveDebugSettings();
  },
  setMode(mode: PlayMode) {
    if (VALID_PLAY_MODES.includes(mode)) {
      setPlayMode(mode);
    }
  },
  setReverse(enabled: boolean) {
    setPlayMode(enabled ? 'reverse' : autoFoldEnabled ? 'fast' : 'manual');
  },
  unfoldNow(holdBeforeSwap = false) {
    if (!debugReverseFoldEnabled) setReverseMode(true, false);
    startReverseUnfold(false, holdBeforeSwap);
  },
  reverseSwapNow() {
    if (reverseUnfold) completeReverseUnfoldSwap();
  },
  setCameraTrick(mode: CameraTrickMode) {
    debugCameraTrick = mode;
    syncDebugControls();
    saveDebugSettings();
  },
  setPerspectiveCut(enabled: boolean) {
    debugCameraTrick = enabled ? 'drastic' : 'off';
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
  setAuto(enabled: boolean) {
    if (enabled) {
      setPlayMode(playMode === 'manual' ? 'fast' : playMode);
    } else {
      setPlayMode('manual', { startImmediately: false });
    }
  },
  setSound(enabled: boolean) {
    return setSoundEnabled(Boolean(enabled));
  },
  soundInfo() {
    return soundtrack.getState();
  },
  setAutoCurve(opts: {
    speed?: number;
    inPct?: number;
    outPct?: number;
    curvePct?: number;
    inPct2?: number;
    outPct2?: number;
    curvePct2?: number;
    handoffPct?: number;
    cutoutDelaySec?: number;
  }) {
    if (typeof opts.speed === 'number' && Number.isFinite(opts.speed)) {
      autoSpeed = Math.max(0.25, Math.min(3.0, opts.speed));
    }
    if (typeof opts.inPct === 'number' && Number.isFinite(opts.inPct)) {
      autoEaseIn = Math.max(0, Math.min(100, opts.inPct));
    }
    if (typeof opts.outPct === 'number' && Number.isFinite(opts.outPct)) {
      autoEaseOut = Math.max(0, Math.min(100, opts.outPct));
    }
    if (typeof opts.curvePct === 'number' && Number.isFinite(opts.curvePct)) {
      autoCurve = Math.max(0, Math.min(100, opts.curvePct));
    }
    if (typeof opts.inPct2 === 'number' && Number.isFinite(opts.inPct2)) {
      autoEaseIn2 = Math.max(0, Math.min(100, opts.inPct2));
    }
    if (typeof opts.outPct2 === 'number' && Number.isFinite(opts.outPct2)) {
      autoEaseOut2 = Math.max(0, Math.min(100, opts.outPct2));
    }
    if (typeof opts.curvePct2 === 'number' && Number.isFinite(opts.curvePct2)) {
      autoCurve2 = Math.max(0, Math.min(100, opts.curvePct2));
    }
    if (typeof opts.handoffPct === 'number' && Number.isFinite(opts.handoffPct)) {
      autoHandoff = Math.max(35, Math.min(140, opts.handoffPct));
    }
    if (typeof opts.cutoutDelaySec === 'number' && Number.isFinite(opts.cutoutDelaySec)) {
      cutoutDropDelay = Math.max(0, Math.min(2.5, opts.cutoutDelaySec));
    }
    syncDebugControls();
    saveDebugSettings();
  },
  setLighting(opts: { shadowStrength?: number; shadowBlur?: number; sunAzimuth?: number; sunElevation?: number }) {
    if (typeof opts.shadowStrength === 'number' && Number.isFinite(opts.shadowStrength)) {
      shadowStrength = Math.max(0, Math.min(200, opts.shadowStrength));
    }
    if (typeof opts.shadowBlur === 'number' && Number.isFinite(opts.shadowBlur)) {
      shadowBlur = Math.max(0, Math.min(8, opts.shadowBlur));
    }
    if (typeof opts.sunAzimuth === 'number' && Number.isFinite(opts.sunAzimuth)) {
      sunAzimuth = ((opts.sunAzimuth % 360) + 360) % 360;
    }
    if (typeof opts.sunElevation === 'number' && Number.isFinite(opts.sunElevation)) {
      sunElevation = Math.max(12, Math.min(85, opts.sunElevation));
    }
    applyActiveOutsideColor();
    syncDebugControls();
    saveDebugSettings();
  },
  setFoldAnchor(panelId: PanelId, mode?: FoldAnchorMode) {
    if (mode !== undefined) debugAnchorMode = mode;
    rig.setFoldAnchor(panelId, mode ?? debugAnchorMode);
    rig.syncAnchorPose(computeFoldProgress());
    syncDebugControls();
  },
  setAnchorMode(mode: FoldAnchorMode) {
    debugAnchorMode = mode;
    if (mode === 'floor') {
      const baseId = rig.net.panels.find((p) => p.parent === null)?.id ?? 'base';
      rig.setFoldAnchor(baseId, 'floor');
    } else {
      rig.setAnchorMode(mode);
    }
    rig.syncAnchorPose(computeFoldProgress());
    syncDebugControls();
    saveDebugSettings();
  },
  view(yaw: number, pitch: number, dist: number, roll = 0) {
    targetYaw = curYaw = yaw;
    targetPitch = curPitch = pitch;
    targetRoll = curRoll = roll;
    swapDist = finalDist = targetDist = curDist = dist;
    swapLookX = targetLookX = curLookX = 0;
    swapLookZ = targetLookZ = curLookZ = 0;
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
      anchorPanel: rig.anchorPanelId,
      anchorKind: rig.anchorKind,
      anchorMode: rig.anchorMode,
      manualReactive: activeFoldIsManual,
      W: Math.round(s.W * 10) / 10,
      D: Math.round(s.D * 10) / 10,
      H: Math.round(s.H * 10) / 10,
      sheetMm: rig.net.sheetHalfMm * 2,
      foldedHeightMm: Math.round(rig.net.foldedHeightMm * 10) / 10,
      curDist: Math.round(curDist * 10) / 10,
      finalDist: Math.round(finalDist * 10) / 10,
      yaw: Math.round(curYaw * 1000) / 1000,
      pitch: Math.round(curPitch * 1000) / 1000,
      bpm: Math.round((240 / (getAutoHandoffSec() / autoSpeed)) * 10) / 10,
      barSec: Math.round((getAutoHandoffSec() / autoSpeed) * 1000) / 1000,
      autoSpeed,
      autoEaseIn,
      autoEaseOut,
      autoCurve,
      autoEaseIn2,
      autoEaseOut2,
      autoCurve2,
      autoHandoff,
      cutoutDropDelay,
      cameraTrick: debugCameraTrick,
      playMode,
      introAwaiting,
      reverseFold: debugReverseFoldEnabled,
      reverseUnfolding: Boolean(reverseUnfold),
      reverseSwapReady: Boolean(reverseUnfold?.swapReady),
      glideOnFold: debugGlideOnFoldEnabled,
      fadePrint: debugFadeProjEnabled,
      shadowStrength,
      shadowBlur,
      sunAzimuth,
      sunElevation,
      foldProgress: Math.round(computeFoldProgress() * 1000) / 1000,
      overlapActive: Boolean(outgoing),
      outgoingFoldProgress: outgoing
        ? Math.round(
            (Array.from(outgoing.panelState.values()).reduce((a, p) => a + p.fold, 0) /
              Math.max(1, outgoing.panelState.size)) *
              1000,
          ) / 1000
        : 1,
      outgoingLiveFrames: outgoing ? outgoing.liveFramesRendered : 0,
      silhouetteCoverage: Math.round(lastSilhouetteCoverage * 1000) / 1000,
      silhouetteBaseline: Math.round(lastSilhouetteBaseline * 1000) / 1000,
    };
  },
};

// Main animation loop (crisp paper-crease spring physics + smooth final-stage zoom-out + zero-transition projection!)
let lastTime = performance.now();

function animate(now: number): void {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) * 0.001);
  lastTime = now;

  // Pause background 3D stage rendering while the tab is hidden or the fullscreen Generations Catalog is open!
  if (document.hidden || !catalogModal.hidden) {
    return;
  }

  if (cityActive && cityView) {
    cityView.update(dt);
    renderer.shadowMap.autoUpdate = false;
    if (cityView.consumeShadowDirty()) {
      renderer.shadowMap.needsUpdate = true;
    }
    renderer.render(cityView.scene, cityView.camera);
    return;
  }
  if (!renderer.shadowMap.autoUpdate) {
    renderer.shadowMap.autoUpdate = true;
    renderer.shadowMap.needsUpdate = true;
  }

  // 1. Update gentle ambient breeze + panel folds (live speed-scaled parameterized cubic-bezier wave!)
  windClockSec += dt;
  const targetWind = reverseUnfold ? 0 : 1;
  if (rigWindStrength < targetWind) {
    rigWindStrength = Math.min(targetWind, rigWindStrength + dt * 1.1);
  } else if (rigWindStrength > targetWind) {
    rigWindStrength = Math.max(targetWind, rigWindStrength - dt * 2.5);
  }
  rig.setWind(windClockSec, rigWindStrength, false);

  const foldDt = dt * autoSpeed;
  let foldChanged = false;
  let activeAnimMaxU = 0;
  let anyPanelAnimating = false;
  for (let pIdx = 0; pIdx < rig.panelIds.length; pIdx++) {
    const pid = rig.panelIds[pIdx];
    const ps = panelState.get(pid)!;

    if (introAwaiting) {
      const baseHint = introHintBaseFold.get(pid) ?? 0;
      if (baseHint > 0.001) {
        // Subtle living breath on angled flaps while awaiting the initial tap
        const sway = Math.sin(windClockSec * 1.15 + pIdx * 1.37) * 0.012;
        ps.fold = clamp01(Math.max(0.005, baseHint + sway));
        ps.target = ps.fold;
      }
      rig.updatePanelVisual(pid, ps.fold, 0, false);
      continue;
    }

    if (ps.animating) {
      anyPanelAnimating = true;
      if (ps.delay > 0) {
        ps.delay = Math.max(0, ps.delay - foldDt);
      } else {
        ps.animElapsed += foldDt;
        const u = clamp01(ps.animElapsed / ps.animDuration);
        if (u > activeAnimMaxU) activeAnimMaxU = u;
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

    rig.updatePanelVisual(pid, ps.fold, 0, false);
  }
  let outgoingPlayheadU: number | null = null;
  if (outgoing) {
    let outMaxU = 0;
    for (const pid of outgoing.rig.panelIds) {
      const ps = outgoing.panelState.get(pid);
      if (ps && ps.animDuration > 0) {
        const u = clamp01(ps.animElapsed / ps.animDuration);
        if (u > outMaxU) outMaxU = u;
      }
    }
    outgoingPlayheadU = outMaxU;
  }
  updateCurvePlayhead(activeAnimMaxU, anyPanelAnimating, generation, outgoingPlayheadU, outgoing ? outgoing.generation : null);

  const foldProg = computeFoldProgress();
  rig.syncAnchorPose(foldProg);
  soundtrack.update();

  // Quietly fill the 1-step Reverse lookahead AFTER the exact 0/255 swap frame has rendered!
  if (debugReverseFoldEnabled && !reverseUnfold && reverseLookaheadDirty) {
    prepareReverseChain();
  }

  // ---- Reverse (Unfold) Mode Frame Update: smooth unfold + chad/cutout reassembly + pixel-exact swap! ----
  if (reverseUnfold) {
    if (reverseUnfold.swapReady && !reverseUnfold.holdBeforeSwap && drag.kind === 'none') {
      completeReverseUnfoldSwap();
      renderer.render(scene, camera);
      return;
    }

    reverseUnfold.elapsedSec += foldDt;
    const uUnfold = clamp01(reverseUnfold.elapsedSec / Math.max(0.05, reverseUnfold.totalSec));
    const camEase = activeFoldIsManual
      ? 1 - (1 - uUnfold) * (1 - uUnfold)
      : uUnfold * uUnfold * (3 - 2 * uUnfold);
    // Next house was pre-calculated onto the interior before unfolding — zero fade-in pop!
    materials.setProjectionFade(1);

    // Smoothly melt blank outer corners into `#f5f4f0` as walls lay flat (`foldProg: 0.88 -> 0.42`)
    const relU = clamp01((foldProg - 0.42) / 0.46);
    curPaperRelief = targetPaperRelief = relU * relU * (3 - 2 * relU);
    rig.setPaperRelief(curPaperRelief);

    const remainSec = Math.max(0, reverseUnfold.totalSec - reverseUnfold.elapsedSec);
    if (rig.hasCutout) {
      const revPadSec = activeFoldIsManual
        ? Math.min(0.16, cutoutDropDelay * 0.35)
        : Math.min(0.32, cutoutDropDelay * 0.5);
      rig.updateCutoutReassemble(remainSec, revPadSec);
    }

    // Drive camera smoothly onto exact `landCam` so at `fold = 0` flat projection aligns 0/255 with House B!
    const desiredYaw = reverseUnfold.startYaw + (reverseUnfold.landYaw - reverseUnfold.startYaw) * camEase;
    const desiredPitch = reverseUnfold.startPitch + (reverseUnfold.landPitch - reverseUnfold.startPitch) * camEase;
    const desiredRoll = reverseUnfold.startRoll + (reverseUnfold.landRoll - reverseUnfold.startRoll) * camEase;
    const desiredDist = reverseUnfold.startDist + (reverseUnfold.landDist - reverseUnfold.startDist) * camEase;
    const desiredLookX = reverseUnfold.startLookX + (reverseUnfold.landLookX - reverseUnfold.startLookX) * camEase;
    const desiredLookY = reverseUnfold.startLookY + (reverseUnfold.landLookY - reverseUnfold.startLookY) * camEase;
    const desiredLookZ = reverseUnfold.startLookZ + (reverseUnfold.landLookZ - reverseUnfold.startLookZ) * camEase;
    const desiredShadow =
      reverseUnfold.startShadowExtent + (reverseUnfold.landShadowExtent - reverseUnfold.startShadowExtent) * camEase;

    if (drag.kind === 'none') {
      const lockBoost = clamp01((uUnfold - 0.80) / 0.18);
      const a = Math.min(1, 1 - Math.exp(-dt * 9.0) + lockBoost * lockBoost);
      targetYaw = desiredYaw;
      targetPitch = desiredPitch;
      targetRoll = desiredRoll;
      targetDist = desiredDist;
      targetLookX = desiredLookX;
      targetLookY = desiredLookY;
      targetLookZ = desiredLookZ;
      curYaw += (desiredYaw - curYaw) * a;
      curPitch += (desiredPitch - curPitch) * a;
      curRoll += (desiredRoll - curRoll) * a;
      curDist += (desiredDist - curDist) * a;
      curLookX += (desiredLookX - curLookX) * a;
      curLookY += (desiredLookY - curLookY) * a;
      curLookZ += (desiredLookZ - curLookZ) * a;
      curShadowExtent += (desiredShadow - curShadowExtent) * a;
      if (uUnfold >= 0.999) {
        curYaw = targetYaw = reverseUnfold.landYaw;
        curPitch = targetPitch = reverseUnfold.landPitch;
        curRoll = targetRoll = reverseUnfold.landRoll;
        curDist = targetDist = reverseUnfold.landDist;
        curLookX = targetLookX = reverseUnfold.landLookX;
        curLookY = targetLookY = reverseUnfold.landLookY;
        curLookZ = targetLookZ = reverseUnfold.landLookZ;
        curShadowExtent = reverseUnfold.landShadowExtent;
      }
    } else {
      const camAlpha = 1 - Math.exp(-dt * 5.6);
      curYaw += (targetYaw - curYaw) * camAlpha;
      curPitch += (targetPitch - curPitch) * camAlpha;
      curRoll += (targetRoll - curRoll) * camAlpha;
      curDist += (targetDist - curDist) * camAlpha;
      curLookX += (targetLookX - curLookX) * camAlpha;
      curLookY += (targetLookY - curLookY) * camAlpha;
      curLookZ += (targetLookZ - curLookZ) * camAlpha;
    }
    syncCameraFromOrbit();

    if (allPanelsSettledUnfolded() && reverseUnfold.elapsedSec >= reverseUnfold.totalSec && drag.kind === 'none') {
      curYaw = targetYaw = reverseUnfold.landYaw;
      curPitch = targetPitch = reverseUnfold.landPitch;
      curRoll = targetRoll = reverseUnfold.landRoll;
      curDist = targetDist = reverseUnfold.landDist;
      curLookX = targetLookX = reverseUnfold.landLookX;
      curLookY = targetLookY = reverseUnfold.landLookY;
      curLookZ = targetLookZ = reverseUnfold.landLookZ;
      curShadowExtent = reverseUnfold.landShadowExtent;
      curPaperRelief = targetPaperRelief = 0;
      rig.setPaperRelief(0);
      rig.setFoldLinesVisible(false);
      materials.setProjectionFade(1);
      if (rig.hasCutout) rig.updateCutoutReassemble(0, 0);
      syncCameraFromOrbit();
      // Render 1 exact settled flat frame (`swapReady = true`), then seamlessly swap to real 3D House B on next frame!
      reverseUnfold.swapReady = true;
    }

    renderer.render(scene, camera);
    return;
  }

  materials.setProjectionFade(debugReverseFoldEnabled ? 1 : computeProjectionFade(foldProg));

  // 2. Animate outer paper cutout (per Cutout delay timer) & per-wall window chads (released when each wall moves!)
  if (rig.hasCutout && (cutoutDropState === 'falling' || (cutoutDropState === 'waiting' && anyPanelAnimating))) {
    if (cutoutDropState === 'falling') {
      cutoutDropElapsed += foldDt;
    }
    const effectiveCutoutDelay = activeFoldIsManual
      ? Math.min(cutoutDropDelay, 0.16)
      : playMode === 'slow'
        ? Math.min(cutoutDropDelay, 0.25)
        : cutoutDropDelay;
    const outerDropTime = cutoutDropState === 'falling' ? cutoutDropElapsed - effectiveCutoutDelay : 0;
    const stillFalling = rig.updateCutoutDrop(outerDropTime, foldDt);
    if (!stillFalling && cutoutDropState === 'falling') {
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
    targetPitch = Math.max(0.06, Math.min(1.50, targetPitch + dSlide * slidePitchDelta));
    targetRoll += dSlide * slideRollDelta;
  }
  prevSlideEase = slideEase;

  const { autoDist, autoLookX, autoLookY, autoLookZ, shadowExtent } = computeAutoZoom(foldProg);
  const { minDist, maxDist } = getZoomBounds();
  targetDist = Math.max(minDist, Math.min(maxDist, autoDist + userZoomDelta));
  targetLookX = autoLookX;
  targetLookY = autoLookY;
  targetLookZ = autoLookZ;

  const camAlpha = 1 - Math.exp(-dt * 5.6);
  curYaw += (targetYaw - curYaw) * camAlpha;
  curPitch += (targetPitch - curPitch) * camAlpha;
  curRoll += (targetRoll - curRoll) * camAlpha;
  curDist += (targetDist - curDist) * camAlpha;
  curLookX += (targetLookX - curLookX) * camAlpha;
  curLookY += (targetLookY - curLookY) * camAlpha;
  curLookZ += (targetLookZ - curLookZ) * camAlpha;
  syncCameraFromOrbit();

  // Per-wall blank paper & shadow reveal: individual lifting walls reveal naturally via `projSheetLift`
  // in the shader while still-flat waiting walls stay 100% invisible `#f5f4f0` until their own turn!
  // Only ease global `uPaperReveal` once walls are already upright (`foldProg = 0.55 -> 0.95`).
  if (rig.hasCutout) {
    const raiseRaw = clamp01((foldProg - 0.55) / 0.40);
    const raiseRelief = raiseRaw * raiseRaw * (3 - 2 * raiseRaw);
    targetPaperRelief = Math.max(targetPaperRelief, raiseRelief);
    if (!allPanelsFoldedTarget() && drag.kind === 'none' && hoveredPanel === null && foldProg < 0.02) {
      targetPaperRelief = 0;
    }
  } else {
    targetPaperRelief = 1;
  }

  if (Math.abs(targetPaperRelief - curPaperRelief) > 0.002) {
    curPaperRelief += (targetPaperRelief - curPaperRelief) * (1 - Math.exp(-dt * 6.5));
    if (Math.abs(targetPaperRelief - curPaperRelief) <= 0.004) curPaperRelief = targetPaperRelief;
    rig.setPaperRelief(curPaperRelief);
  }

  if (Math.abs(shadowExtent - curShadowExtent) > 0.04) {
    curShadowExtent += (shadowExtent - curShadowExtent) * camAlpha;
    applyShadowFrustum(curShadowExtent);
  }

  // Pre-build next house early during EVERY fold (both Auto AND manual taps!) so rapid tapping never hitches on rig creation!
  const handoffSec = getAutoHandoffSec();
  if (
    !debugReverseFoldEnabled &&
    (foldProg > 0.22 || (autoFoldEnabled && autoBeatElapsed > handoffSec * 0.42)) &&
    (!preparedNext || preparedNext.generation !== generation + 1)
  ) {
    schedulePrepareNext(generation + 1, 20);
  }

  // Keep status caption updated & quietly pre-build the next house once settled into 3D!
  if (!introAwaiting && introMenuPending && !debugReverseFoldEnabled && allPanelsSettledFolded()) {
    revealIntroMenu();
  }
  if (foldChanged && allPanelsSettledFolded()) {
    schedulePrepareNext(generation + 1, 80);
    syncUI();
  }

  // Auto playback modes:
  //   reverse: continuous reverse unfold chain
  //   slow: full non-overlapping fold, then a 3s pause (SLOW_HOLD_SEC) on each settled house
  //   fast: configurable overlapping auto-fold chain (`autoHandoff` = 35%..140% of House 1's fold duration)
  if (!introAwaiting && autoFoldEnabled && drag.kind === 'none' && helpModal.hidden && catalogModal.hidden) {
    if (debugReverseFoldEnabled) {
      if (!autoBeatRunning) {
        autoBeatRunning = true;
        autoBeatElapsed = 0;
        if (!reverseUnfold) startReverseUnfold(true);
      } else if (!reverseUnfold) {
        autoBeatElapsed += foldDt;
        const holdSec = Math.max(0, (autoHandoff / 100 - 1) * FOLD_HOUSE_SEC);
        if (autoBeatElapsed >= holdSec) {
          startReverseUnfold(true);
        }
      }
    } else if (playMode === 'slow') {
      if (!autoBeatRunning) {
        autoBeatRunning = true;
        autoBeatElapsed = 0;
        if (!allPanelsFoldedTarget()) {
          triggerStepAction(true, 0);
        }
      } else if (allPanelsSettledFolded()) {
        autoBeatElapsed += dt;
        if (autoBeatElapsed >= SLOW_HOLD_SEC) {
          autoBeatElapsed = 0;
          triggerStepAction(true, 0);
        }
      } else {
        autoBeatElapsed = 0;
      }
    } else if (!autoBeatRunning) {
      autoBeatRunning = true;
      autoBeatElapsed = 0;
      if (!foldChanged || allPanelsSettledFolded() || !allPanelsFoldedTarget()) {
        triggerStepAction(true, 0);
      }
    } else {
      autoBeatElapsed += foldDt;
      if (autoBeatElapsed >= handoffSec) {
        const carry = Math.min(0.05, autoBeatElapsed - handoffSec);
        triggerStepAction(true, carry);
      }
    }
  } else {
    autoBeatRunning = false;
    autoBeatElapsed = 0;
  }

  // Dual-pass LIVE texture update during the ~1.2-beat overlap window (77% -> 100%):
  // Keeps advancing & rendering the outgoing house into `outgoing.targetRT` every frame so the
  // incoming house literally folds up while carrying a LIVE-MOVING projection of the previous house!
  if (outgoing) {
    let outStillMoving = false;
    let outFoldSum = 0;
    for (const pid of outgoing.rig.panelIds) {
      const ps = outgoing.panelState.get(pid);
      if (!ps) continue;
      if (ps.animating) {
        if (ps.delay > 0) {
          ps.delay = Math.max(0, ps.delay - foldDt);
        } else {
          ps.animElapsed += foldDt;
          const u = clamp01(ps.animElapsed / ps.animDuration);
          ps.fold = ps.startFold + (ps.target - ps.startFold) * easePaperFold(u, outgoing.curve);
          if (u >= 1) {
            ps.fold = ps.target;
            ps.animating = false;
          }
        }
        outStillMoving = true;
      }
      outFoldSum += ps.fold;
      outgoing.rig.updatePanelVisual(pid, ps.fold, 0, false);
    }

    const outFoldProg = outgoing.rig.panelIds.length > 0 ? outFoldSum / outgoing.rig.panelIds.length : 1;
    outgoing.rig.syncAnchorPose(outFoldProg);
    outgoing.mats.setProjectionFade(computeProjectionFade(outFoldProg));

    if (outgoing.spinEnabled) {
      outgoing.yaw += dt * AUTO_SPIN_RAD_PER_SEC;
    }
    const ozRaw = clamp01((outFoldProg - 0.03) / 0.94);
    const ozEase = 0.5 - 0.5 * Math.cos(Math.PI * ozRaw);
    const outTargetDist = outgoing.swapDist + (outgoing.finalDist - outgoing.swapDist) * ozEase + outgoing.userZoomDelta;
    const outTargetLookX = outgoing.swapLookX * (1 - ozEase);
    const outTargetLookY = outgoing.swapLookY + (outgoing.finalLookY - outgoing.swapLookY) * ozEase;
    const outTargetLookZ = outgoing.swapLookZ * (1 - ozEase);
    const outAlpha = 1 - Math.exp(-dt * 5.6);
    outgoing.dist += (outTargetDist - outgoing.dist) * outAlpha;
    outgoing.lookX += (outTargetLookX - outgoing.lookX) * outAlpha;
    outgoing.lookY += (outTargetLookY - outgoing.lookY) * outAlpha;
    outgoing.lookZ += (outTargetLookZ - outgoing.lookZ) * outAlpha;

    outgoing.camera.up.set(0, 1, 0);
    outgoing.camera.position.set(
      outgoing.lookX + outgoing.dist * Math.cos(outgoing.pitch) * Math.sin(outgoing.yaw),
      outgoing.lookY + outgoing.dist * Math.sin(outgoing.pitch),
      outgoing.lookZ + outgoing.dist * Math.cos(outgoing.pitch) * Math.cos(outgoing.yaw),
    );
    outgoing.camera.lookAt(outgoing.lookX, outgoing.lookY, outgoing.lookZ);
    if (Math.abs(outgoing.roll) > 1e-5) outgoing.camera.rotateZ(outgoing.roll);
    outgoing.camera.updateMatrixWorld(true);

    // Offscreen Pass 1: render outgoing House A live into `outgoing.targetRT` (sampled by active House B!)
    const savedFogNear = studioFog.near;
    const savedFogFar = studioFog.far;
    const savedRigVis = rig.root.visible;
    rig.root.visible = false;
    outgoing.rig.root.visible = true;
    studioFog.near = Math.max(44, outgoing.dist * 1.25);
    studioFog.far = Math.max(120, outgoing.dist * 3.15);
    syncTurntableLights(outgoing.yaw, outgoing.shadowExtent);

    const prevTarget = renderer.getRenderTarget();
    const prevToneMapping = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(outgoing.targetRT);
    renderer.render(scene, outgoing.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.toneMapping = prevToneMapping;
    outgoing.liveFramesRendered += 1;

    // Restore active House B state for Pass 2 main screen render
    outgoing.rig.root.visible = false;
    rig.root.visible = savedRigVis;
    studioFog.near = savedFogNear;
    studioFog.far = savedFogFar;
    syncTurntableLights(curYaw, curShadowExtent);

    // Once House A finishes 100%, its final crisp frame stays frozen in `targetRT` and we dispose the rig!
    if (!outStillMoving) {
      clearOutgoing();
    }
  }

  renderer.render(scene, camera);
}

let sceneRevealed = false;
function scheduleDeferredWarmup(): void {
  const runWarmup = () => {
    if (!warmupDone && !document.hidden) warmupCutoutPipeline();
  };
  const ric = (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof ric === 'function') {
    ric(runWarmup, { timeout: 400 });
  } else {
    globalThis.setTimeout(runWarmup, 140);
  }
}

function revealInitialScene(): void {
  if (sceneRevealed) return;
  sceneRevealed = true;
  renderer.render(scene, camera);
  document.body.classList.remove('loading');
  lastTime = performance.now();
  requestAnimationFrame(animate);
  if (introAwaiting) {
    scheduleDeferredWarmup();
  } else {
    warmupCutoutPipeline();
  }
}

// Compile initial shaders asynchronously (KHR_parallel_shader_compile) while the compositor-driven
// `Loading …` label breathes under the title plate, then fade in the first crisp frame!
void (async () => {
  try {
    if (typeof renderer.compileAsync === 'function') {
      await renderer.compileAsync(scene, camera);
    }
  } catch {
    // Fall back to synchronous first render
  }
  revealInitialScene();
})();

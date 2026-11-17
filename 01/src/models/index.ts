import { bo01 } from './bo01';
import { hoddor } from './hoddor';
import { lillatorg } from './lillatorg';
import { malmohus } from './malmohus';
import { mill } from './mill';
import { mollan } from './mollan';
import { petri } from './petri';
import { vaster } from './vaster';
import { radhus } from './radhus';
import { mazetti } from './mazetti';
import { torget } from './torget';
import { kiosk } from './kiosk';
import { torso } from './torso';
import { liveConcert, liveCongress, liveHotel } from './live';
import { kallbad } from './kallbad';
import { bibliotek } from './bibliotek';
import { gertrud } from './gertrud';
import { skola } from './skola';
import type { Model } from './model';

// The cards, Malmö, simplest first.
export const MODELS: Model[] = [kiosk, lillatorg, vaster, radhus, mazetti, torget, gertrud, bibliotek, skola, bo01, hoddor, kallbad, petri, mollan, liveConcert, liveCongress, liveHotel, malmohus, mill, torso];
export const modelById = (id: string | null | undefined) => MODELS.find((m) => m.id === id) ?? null;
export { foldOrder, type Model } from './model';

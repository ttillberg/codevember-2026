import { bo01 } from './bo01';
import { lillatorg } from './lillatorg';
import { mill } from './mill';
import type { Model } from './model';

// The cards, Malmö, simplest first.
export const MODELS: Model[] = [lillatorg, bo01, mill];
export const modelById = (id: string | null | undefined) => MODELS.find((m) => m.id === id) ?? null;
export { foldOrder, type Model } from './model';

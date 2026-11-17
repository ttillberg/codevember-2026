// The icons of the controls: drawn here, in the style of Hollow's bar: 24 px, one stroke, round caps, in the current colour.
import type { ReactNode } from 'react';

const Svg = ({ children }: { children: ReactNode }) => (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

// a road running away, solid, with its dashes cut out of it
export const RoadIcon = () => <Svg><path fill="currentColor" stroke="none" fillRule="evenodd" d="M8.2 4h7.6a1.6 1.6 0 0 1 1.55 1.2l3 12.8a1.6 1.6 0 0 1-1.55 2H5.2a1.6 1.6 0 0 1-1.55-2l3-12.8A1.6 1.6 0 0 1 8.2 4zM11.4 6h1.2v2.4h-1.2zM11.3 10.2h1.4v3h-1.4zM11.1 15h1.8v3.4h-1.8z" /></Svg>;
// a humpback bridge from the side, solid, with its one arch
export const BridgeIcon = () => <Svg><path fill="currentColor" stroke="none" d="M2 10.6c4 0 5.6-3.2 10-3.2s6 3.2 10 3.2v6H18.6a6.6 5.4 0 0 0-13.2 0H2z" /></Svg>;
// a fist with one finger out, and the streak it drags through the paint
export const SmearIcon = () => <Svg><path d="M10.2 13.5V7.6a1.35 1.35 0 0 1 2.7 0v4.2h1.9a2.3 2.3 0 0 1 2.3 2.3v1.6a4.6 4.2 0 0 1-9.2 0c0-1.6.8-2.8 2.3-3.4" /><path d="M5.2 5.4c1.4 1.7 3 2.2 5 2M12.9 7c2.4-.5 4.6-.6 5.9.5.9.8.9 1.9.3 2.9" /></Svg>;
// a rubber, half rubbed
export const EraseIcon = () => <Svg><path d="M4.2 14.3 12.3 6.2a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L14.2 18.2H8.5z" /><path d="M9.8 10.5l5.2 5.2M14.2 18.2H20" /></Svg>;
// a line you follow, dotted where the traffic runs
export const TraceIcon = () => <Svg><path d="M3 18c4 0 4.5-9 9-9s5 3.5 9-7" /><circle cx="3" cy="18" r="1.2" fill="currentColor" stroke="none" /><circle cx="21" cy="2" r="1.2" fill="currentColor" stroke="none" /></Svg>;
export const UndoIcon = () => <Svg><path d="M9 14 4.5 9.5 9 5" /><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3" /></Svg>;
export const RedoIcon = () => <Svg><path d="M15 14l4.5-4.5L15 5" /><path d="M19.5 9.5H10a5.5 5.5 0 0 0 0 11h3" /></Svg>;
// a clock that goes: each hand is turned to the time by the style of the button it is on (--hour, --minute)
export const ClockIcon = () => <Svg><circle cx="12" cy="12" r="8.5" /><path className="hand hour" d="M12 12V8.2" /><path className="hand minute" d="M12 12V5.8" /></Svg>;
// an eye: what is shown on the picture
export const EyeIcon = () => <Svg><path d="M2.5 12c2.4-4.2 5.6-6.3 9.5-6.3s7.1 2.1 9.5 6.3c-2.4 4.2-5.6 6.3-9.5 6.3S4.900 16.2 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></Svg>;
// a road that swells in the middle, and one that is pinched: the size brush makes roads bigger, or smaller
export const GrowIcon = () => <Svg><path d="M9 3v5.5c-3.4 1.7-3.4 5.3 0 7V21M15 3v5.5c3.4 1.7 3.4 5.3 0 7V21" /></Svg>;
export const ShrinkIcon = () => <Svg><path d="M7.5 3v5.5c3.2 1.7 3.2 5.3 0 7V21M16.5 3v5.5c-3.2 1.7-3.2 5.3 0 7V21" /></Svg>;

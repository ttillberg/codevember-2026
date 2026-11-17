// The icons of the controls: drawn here, in the style of Hollow's bar: 24 px, one stroke, round caps, in the current colour.
import type { ReactNode } from 'react';

const Svg = ({ children }: { children: ReactNode }) => (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

// a road in perspective, with its dashes down the middle
export const RoadIcon = () => <Svg><path d="M7.5 21 10.5 3M16.5 21 13.5 3M12 6.5v2.5M12 11.5v2.5M12 16.5v2.5" /></Svg>;
// a deck on an arch
export const BridgeIcon = () => <Svg><path d="M2.5 17h19M4.5 17a7.5 7.5 0 0 1 15 0" /><path d="M8 17v-3.4M16 17v-3.4" /></Svg>;
// a wave pushed along by an arrow
export const SmearIcon = () => <Svg><path d="M3 9c2.5-2.5 4.5 2.5 7 0s4.5-2.5 7 0 2 1 3 0" /><path d="M4 16h14M14.5 13l3.5 3-3.5 3" /></Svg>;
// a rubber, half rubbed
export const EraseIcon = () => <Svg><path d="M4.2 14.3 12.3 6.2a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L14.2 18.2H8.5z" /><path d="M9.8 10.5l5.2 5.2M14.2 18.2H20" /></Svg>;
// a line you follow, dotted where the traffic runs
export const TraceIcon = () => <Svg><path d="M3 18c4 0 4.5-9 9-9s5 3.5 9-7" /><circle cx="3" cy="18" r="1.2" fill="currentColor" stroke="none" /><circle cx="21" cy="2" r="1.2" fill="currentColor" stroke="none" /></Svg>;
export const UndoIcon = () => <Svg><path d="M9 14 4.5 9.5 9 5" /><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3" /></Svg>;
export const RedoIcon = () => <Svg><path d="M15 14l4.5-4.5L15 5" /><path d="M19.5 9.5H10a5.5 5.5 0 0 0 0 11h3" /></Svg>;
// a clock that goes: each hand is turned to the time by the style of the button it is on (--hour, --minute)
export const ClockIcon = () => <Svg><circle cx="12" cy="12" r="8.5" /><path className="hand hour" d="M12 12V8.2" /><path className="hand minute" d="M12 12V5.8" /></Svg>;
// a flame: the heat map
export const HeatIcon = () => <Svg><path d="M12 3c1 3.5 5 5.5 5 10.5a5 5 0 0 1-10 0c0-2.2 1-3.8 2.2-5 0 2 .8 3.2 2 3.5C11 8 10.6 5.6 12 3z" /></Svg>;

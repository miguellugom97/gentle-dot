import type { AgentState } from "@gentle-dot/protocol";
import { useEffect, useRef, useState } from "react";
import { Agumon } from "../agumon/Agumon.tsx";
import { loadMascot, type Mascot, onMascotChange } from "../mascot.ts";
import { Rose, type RoseMood } from "../rose/Rose.tsx";

const LABELS: Record<AgentState, string> = {
	starting: "starting",
	idle: "ready",
	thinking: "thinking",
	working: "working",
	needs_you: "needs your answer",
	restarting: "restarting",
	error: "unavailable",
};

const MOODS: Record<AgentState, RoseMood> = {
	starting: "restarting",
	idle: "idle",
	thinking: "thinking",
	working: "working",
	needs_you: "needs",
	restarting: "restarting",
	error: "offline",
};

const DRAG_THRESHOLD_PX = 3;

interface DotSurfaceProps {
	agentState: AgentState;
	connected: boolean;
	/** The assistant controls the Mac (S24.6); it shows over every other state. */
	inControl?: boolean;
	/** Yolo mode is on (S24.9): risky actions run without asking, so the rose says so. */
	yolo?: boolean;
	/** The mascot to display (defaults to Agumon or user preference). */
	mascot?: Mascot;
	toggle: () => void;
	startDrag: () => void;
}

/** The collapsed, always-on-top mascot on desktop. A click opens the panel; a drag moves the window. */
export function DotSurface({
	agentState,
	connected,
	inControl = false,
	yolo = false,
	mascot: explicitMascot,
	toggle,
	startDrag,
}: DotSurfaceProps) {
	const [activeMascot, setActiveMascot] = useState<Mascot>(() => explicitMascot ?? loadMascot());

	useEffect(() => {
		if (explicitMascot) {
			setActiveMascot(explicitMascot);
			return;
		}
		return onMascotChange(setActiveMascot);
	}, [explicitMascot]);
	const press = useRef<{ x: number; y: number; dragging: boolean } | undefined>(undefined);
	const state = connected ? agentState : "restarting";
	const label = inControl ? "controlling your Mac" : LABELS[state];

	const isAgumon = activeMascot === "agumon";

	return (
		<button
			type="button"
			className={`dot dot-${state}${inControl ? " dot-in_control" : ""}${yolo ? " dot-yolo" : ""}${isAgumon ? " dot-libre dot-agumon" : ""}`}
			aria-label={`Gentle Dot: ${label}${yolo ? ", yolo mode on" : ""}`}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				press.current = { x: event.clientX, y: event.clientY, dragging: false };
			}}
			onPointerMove={(event) => {
				const p = press.current;
				if (!p || p.dragging) return;
				if (Math.hypot(event.clientX - p.x, event.clientY - p.y) > DRAG_THRESHOLD_PX) {
					p.dragging = true;
					startDrag();
				}
			}}
			onPointerUp={() => {
				const p = press.current;
				press.current = undefined;
				if (p && !p.dragging) toggle();
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					toggle();
				}
			}}
		>
			<span className="dot-disc" aria-hidden="true">
				{isAgumon ? (
					<Agumon mood={inControl ? "control" : MOODS[state]} />
				) : (
					<Rose mood={inControl ? "control" : MOODS[state]} />
				)}
			</span>
			{state === "needs_you" ? (
				<span className="dot-badge" aria-hidden="true">
					!
				</span>
			) : null}
		</button>
	);
}

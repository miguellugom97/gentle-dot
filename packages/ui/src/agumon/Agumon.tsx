import { useEffect, useState } from "react";
import type { RoseMood } from "../rose/Rose.tsx";
import { AGUMON_ATTACK, AGUMON_HAPPY, AGUMON_IDLE, AGUMON_SLEEP, AGUMON_WALK } from "./sprites.ts";

export type AgumonMood = RoseMood;

interface AnimationConfig {
	frames: readonly string[];
	intervalMs: number;
}

const ANIMATIONS: Record<AgumonMood, AnimationConfig> = {
	idle: { frames: AGUMON_IDLE, intervalMs: 450 },
	thinking: { frames: AGUMON_WALK, intervalMs: 180 },
	working: { frames: AGUMON_WALK, intervalMs: 130 },
	control: { frames: AGUMON_ATTACK, intervalMs: 110 },
	needs: { frames: AGUMON_HAPPY, intervalMs: 130 },
	restarting: { frames: AGUMON_SLEEP, intervalMs: 350 },
	offline: { frames: AGUMON_SLEEP, intervalMs: 450 },
};

/**
 * Animated pixel-art Agumon mascot for the desktop floating window.
 * Animates between idle, walk/work, attack (control), celebration (needs_you), and sleep states.
 */
export function Agumon({ mood }: { mood: AgumonMood }) {
	const config = ANIMATIONS[mood] ?? ANIMATIONS.idle;
	const [frameIndex, setFrameIndex] = useState(0);

	useEffect(() => {
		setFrameIndex(0);
		if (config.frames.length <= 1) return;
		const timer = setInterval(() => {
			setFrameIndex((prev) => (prev + 1) % config.frames.length);
		}, config.intervalMs);
		return () => clearInterval(timer);
	}, [config]);

	const currentFrame = config.frames[frameIndex % config.frames.length] ?? config.frames[0];

	return (
		<span className={`agumon agumon-${mood}`} aria-hidden="true">
			<img className="agumon-sprite" src={currentFrame} alt="" draggable={false} />
		</span>
	);
}

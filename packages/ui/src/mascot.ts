export type Mascot = "agumon" | "rose";

const STORAGE_KEY = "gentle-dot:mascot";
const EVENT_NAME = "gentle-dot:mascot-changed";

/** Reads the current mascot from local storage. Defaults to 'agumon'. */
export function loadMascot(): Mascot {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved === "rose" || saved === "agumon") return saved;
	} catch {
		// Ignore local storage errors (e.g. during private browsing or SSR)
	}
	return "agumon";
}

/** Saves the selected mascot and notifies listeners. */
export function saveMascot(mascot: Mascot): void {
	try {
		localStorage.setItem(STORAGE_KEY, mascot);
		window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: mascot }));
	} catch {
		// Ignore local storage errors
	}
}

/** Subscribes to mascot changes in the current and other windows. */
export function onMascotChange(listener: (mascot: Mascot) => void): () => void {
	const handleCustomEvent = (event: Event) => {
		const custom = event as CustomEvent<Mascot>;
		if (custom.detail) listener(custom.detail);
	};

	const handleStorageEvent = (event: StorageEvent) => {
		if (event.key === STORAGE_KEY && (event.newValue === "rose" || event.newValue === "agumon")) {
			listener(event.newValue);
		}
	};

	window.addEventListener(EVENT_NAME, handleCustomEvent);
	window.addEventListener("storage", handleStorageEvent);

	return () => {
		window.removeEventListener(EVENT_NAME, handleCustomEvent);
		window.removeEventListener("storage", handleStorageEvent);
	};
}

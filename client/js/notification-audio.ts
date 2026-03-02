import {withServerBasePath} from "./server-path";

type WindowWithWebkitAudioContext = Window & {
	webkitAudioContext?: typeof AudioContext;
};

const SOUND_URL = withServerBasePath("/audio/pop.wav");
const AudioContextCtor =
	window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;

let audioContext: AudioContext | undefined;
let audioBuffer: AudioBuffer | undefined;
let fallbackAudio: HTMLAudioElement | undefined;
let preparePromise: Promise<void> | undefined;
let unlockedListenersInstalled = false;

function installFallbackAudio() {
	if (fallbackAudio) {
		return;
	}

	fallbackAudio = new Audio();
	fallbackAudio.src = SOUND_URL;
	fallbackAudio.preload = "auto";
}

async function prepare() {
	if (audioBuffer || fallbackAudio) {
		return;
	}

	if (preparePromise) {
		return preparePromise;
	}

	preparePromise = (async () => {
		try {
			if (!AudioContextCtor) {
				installFallbackAudio();
				return;
			}

			audioContext = audioContext || new AudioContextCtor();

			const response = await fetch(SOUND_URL, {cache: "force-cache"});

			if (!response.ok) {
				throw new Error(`Failed to load notification sound (${response.status})`);
			}

			const arrayBuffer = await response.arrayBuffer();
			audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
		} catch {
			installFallbackAudio();
		}
	})();

	return preparePromise;
}

function installUnlockListeners() {
	if (unlockedListenersInstalled) {
		return;
	}

	unlockedListenersInstalled = true;

	const unlock = () => {
		void prepare().then(async () => {
			if (!audioContext) {
				return;
			}

			if (audioContext.state === "suspended") {
				await audioContext.resume().catch(() => {});
			}
		});
	};

	window.addEventListener("pointerdown", unlock, {passive: true});
	window.addEventListener("keydown", unlock, {passive: true});
	window.addEventListener("touchstart", unlock, {passive: true});
}

export function initNotificationAudio() {
	installUnlockListeners();
	void prepare();
}

export function playNotificationSound() {
	void (async () => {
		await prepare();

		if (audioContext && audioBuffer) {
			if (audioContext.state === "suspended") {
				await audioContext.resume().catch(() => {});
			}

			if (audioContext.state !== "running") {
				throw new Error("AudioContext is not running");
			}

			const source = audioContext.createBufferSource();
			source.buffer = audioBuffer;
			source.connect(audioContext.destination);
			source.start(0);
			return;
		}

		installFallbackAudio();

		const audio = fallbackAudio?.cloneNode(true);

		if (audio instanceof HTMLAudioElement) {
			audio.currentTime = 0;
			const result = audio.play();

			if (result && typeof result.catch === "function") {
				result.catch(() => {});
			}
		}
	})().catch(() => {});
}

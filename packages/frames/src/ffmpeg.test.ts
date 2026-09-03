// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	buildFrameArgs,
	buildProbeArgs,
	buildStillArgs,
	decodeStill,
	iterateFrames,
	parseProbe,
	probeMedia,
	timecode,
	type SpawnedProcess,
} from "./ffmpeg.ts";

/** Un faux processus : rejoue des morceaux d'octets puis sort avec `code`. */
function fakeProcess(chunks: Uint8Array[], code = 0, stderr = ""): SpawnedProcess {
	return {
		stdout: new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		}),
		stderr: new ReadableStream<Uint8Array>({
			start(controller) {
				if (stderr) controller.enqueue(new TextEncoder().encode(stderr));
				controller.close();
			},
		}),
		exited: Promise.resolve(code),
	};
}

function textProcess(text: string, code = 0, stderr = ""): SpawnedProcess {
	return fakeProcess([new TextEncoder().encode(text)], code, stderr);
}

describe("horodatage", () => {
	test("formate en HH:MM:SS.mmm", () => {
		expect(timecode(0)).toBe("00:00:00.000");
		expect(timecode(1234)).toBe("00:00:01.234");
		expect(timecode(3_723_456)).toBe("01:02:03.456");
		expect(timecode(-10)).toBe("00:00:00.000");
	});
});

describe("construction des commandes", () => {
	test("l'échantillonnage demande une vignette carrée et du rawvideo", () => {
		const args = buildFrameArgs("ep.mkv", { fps: 2, size: 64 });
		expect(args[0]).toBe("ffmpeg");
		expect(args).toContain("-vf");
		expect(args[args.indexOf("-vf") + 1]).toBe("fps=2,scale=64:64:flags=area");
		expect(args.slice(-5)).toEqual(["-pix_fmt", "rgb24", "-f", "rawvideo", "-"]);
	});

	test("`-ss` passe avant `-i` pour que le saut soit rapide", () => {
		const args = buildFrameArgs("ep.mkv", { startMs: 60_000, endMs: 90_000 });
		expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
		expect(args[args.indexOf("-ss") + 1]).toBe("00:01:00.000");
		// La durée demandée est relative au point de départ.
		expect(args[args.indexOf("-t") + 1]).toBe("00:00:30.000");
	});

	test("une image fixe se décode avec -frames:v 1, sans filtre fps", () => {
		const args = buildStillArgs("capture.jpg", { size: 128 });
		expect(args).toContain("-frames:v");
		expect(args[args.indexOf("-vf") + 1]).toBe("scale=128:128:flags=area");
		expect(args.join(" ")).not.toContain("fps=");
	});

	test("les binaires sont surchargeables", () => {
		expect(buildFrameArgs("a.mp4", {}, { ffmpeg: "/opt/ffmpeg" })[0]).toBe("/opt/ffmpeg");
		expect(buildProbeArgs("a.mp4", { ffprobe: "/opt/ffprobe" })[0]).toBe("/opt/ffprobe");
	});
});

describe("lecture de ffprobe", () => {
	test("convertit durée, dimensions et cadence fractionnaire", () => {
		const info = parseProbe(
			JSON.stringify({
				streams: [{ width: 1280, height: 720, r_frame_rate: "24000/1001", codec_name: "h264" }],
				format: { duration: "1395.861000" },
			}),
		);
		expect(info).toEqual({
			durationMs: 1_395_861,
			width: 1280,
			height: 720,
			fps: 24000 / 1001,
			codec: "h264",
		});
	});

	test("tolère un flux qui n'annonce ni durée ni cadence", () => {
		const info = parseProbe(JSON.stringify({ streams: [{ width: 640, height: 360 }] }));
		expect(info.durationMs).toBe(0);
		expect(info.fps).toBe(0);
		expect(info.codec).toBe("");
	});

	test("remonte le message de ffprobe quand il échoue", async () => {
		const deps = { spawn: () => textProcess("", 1, "moov atom not found") };
		expect(probeMedia("cassé.mp4", deps)).rejects.toThrow(/moov atom not found/);
	});
});

describe("découpage du flux rawvideo", () => {
	const size = 2;
	const frameBytes = size * size * 3;
	const frame = (fill: number) => new Uint8Array(frameBytes).fill(fill);

	test("rend une trame par bloc, horodatée par la cadence", async () => {
		const deps = { spawn: () => fakeProcess([frame(1), frame(2), frame(3)]) };
		const seen: Array<{ tMs: number; first: number }> = [];
		for await (const f of iterateFrames("ep.mkv", { fps: 2, size }, deps)) {
			seen.push({ tMs: f.tMs, first: f.pixels.data[0] });
		}
		expect(seen).toEqual([
			{ tMs: 0, first: 1 },
			{ tMs: 500, first: 2 },
			{ tMs: 1000, first: 3 },
		]);
	});

	test("recolle les trames coupées entre deux morceaux de flux", async () => {
		const stream = new Uint8Array(frameBytes * 2);
		stream.fill(7, 0, frameBytes);
		stream.fill(9, frameBytes);
		const deps = {
			spawn: () => fakeProcess([stream.slice(0, 5), stream.slice(5, frameBytes + 3), stream.slice(frameBytes + 3)]),
		};
		const seen: number[] = [];
		for await (const f of iterateFrames("ep.mkv", { fps: 1, size }, deps)) seen.push(f.pixels.data[0]);
		expect(seen).toEqual([7, 9]);
	});

	test("décale les horodatages quand on démarre au milieu", async () => {
		const deps = { spawn: () => fakeProcess([frame(1), frame(2)]) };
		const seen: number[] = [];
		for await (const f of iterateFrames("ep.mkv", { fps: 1, size, startMs: 10_000 }, deps)) {
			seen.push(f.tMs);
		}
		expect(seen).toEqual([10_000, 11_000]);
	});

	test("une trame incomplète en fin de flux est ignorée", async () => {
		const deps = { spawn: () => fakeProcess([frame(1), new Uint8Array(3)]) };
		const seen: number[] = [];
		for await (const f of iterateFrames("ep.mkv", { fps: 1, size }, deps)) seen.push(f.tMs);
		expect(seen).toEqual([0]);
	});

	test("un code de sortie non nul lève avec le message de ffmpeg", async () => {
		const deps = { spawn: () => fakeProcess([], 1, "Invalid data found") };
		const run = async () => {
			for await (const _ of iterateFrames("ep.mkv", { size }, deps)) {
				// consommer le générateur pour atteindre la vérification de sortie
			}
		};
		expect(run()).rejects.toThrow(/Invalid data found/);
	});

	test("decodeStill rend exactement une vignette", async () => {
		const deps = { spawn: () => fakeProcess([new Uint8Array(frameBytes).fill(4)]) };
		const pixels = await decodeStill("capture.jpg", { size }, deps);
		expect(pixels.width).toBe(size);
		expect(pixels.data).toHaveLength(frameBytes);
	});

	test("decodeStill refuse un flux vide", async () => {
		const deps = { spawn: () => fakeProcess([]) };
		expect(decodeStill("vide.jpg", { size }, deps)).rejects.toThrow(/aucune image décodable/);
	});
});

// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	CL_DIMS,
	DISTANCE_SCALE,
	colorLayoutDistance,
	decodeVector,
	encodeVector,
	extractColorLayout,
	packVector,
	similarityFromDistance,
	unpackVector,
} from "./descriptor.ts";

/** Image unie de `size`×`size`, canaux RGB. */
function flat(size: number, r: number, g: number, b: number) {
	const data = new Uint8Array(size * size * 3);
	for (let i = 0; i < data.length; i += 3) {
		data[i] = r;
		data[i + 1] = g;
		data[i + 2] = b;
	}
	return { data, width: size, height: size, channels: 3 as const };
}

describe("descripteur ColorLayout", () => {
	test("rend 33 coefficients tenant chacun sur un octet", () => {
		const vector = extractColorLayout(flat(64, 12, 200, 90));
		expect(vector).toHaveLength(CL_DIMS);
		expect(Math.min(...vector)).toBeGreaterThanOrEqual(0);
		expect(Math.max(...vector)).toBeLessThanOrEqual(63);
	});

	test("l'encodage base64 fait 28 caractères et se décode à l'identique", () => {
		const vector = extractColorLayout(flat(64, 200, 30, 30));
		const hash = encodeVector(vector);
		expect(hash).toHaveLength(28);
		expect(decodeVector(hash)).toEqual(vector);
	});

	test("empaqueter puis dépaqueter conserve le vecteur", () => {
		const vector = extractColorLayout(flat(32, 5, 5, 250));
		const packed = packVector(vector);
		expect(packed).toBeInstanceOf(Uint8Array);
		expect(packed).toHaveLength(CL_DIMS);
		expect(unpackVector(packed)).toEqual(vector);
	});

	test("refuse un vecteur de mauvaise taille des deux côtés", () => {
		expect(() => packVector([1, 2, 3])).toThrow(/33 coefficients/);
		expect(() => unpackVector(new Uint8Array(10))).toThrow(/33 octets/);
	});

	test("la distance est nulle entre deux vecteurs identiques et symétrique sinon", () => {
		const a = extractColorLayout(flat(64, 10, 20, 30));
		const b = extractColorLayout(flat(64, 200, 180, 160));
		expect(colorLayoutDistance(a, a)).toBe(0);
		expect(colorLayoutDistance(a, b)).toBeGreaterThan(0);
		expect(colorLayoutDistance(a, b)).toBeCloseTo(colorLayoutDistance(b, a), 10);
	});

	test("compare indifféremment un vecteur et sa forme empaquetée", () => {
		const a = extractColorLayout(flat(64, 10, 20, 30));
		const b = extractColorLayout(flat(64, 40, 20, 30));
		expect(colorLayoutDistance(a, packVector(b))).toBeCloseTo(colorLayoutDistance(a, b), 10);
	});

	test("les trois premiers coefficients de luminance pèsent double", () => {
		const base = Array.from({ length: CL_DIMS }, () => 0);
		const early = [...base];
		early[1] = 1; // coefficient pondéré 2
		const late = [...base];
		late[10] = 1; // coefficient pondéré 1
		expect(colorLayoutDistance(base, early)).toBeCloseTo(Math.SQRT2, 10);
		expect(colorLayoutDistance(base, late)).toBeCloseTo(1, 10);
	});

	test("la similarité suit l'échelle mesurée et reste bornée", () => {
		expect(similarityFromDistance(0)).toBe(1);
		expect(similarityFromDistance(DISTANCE_SCALE / 10)).toBeCloseTo(0.9, 10);
		expect(similarityFromDistance(DISTANCE_SCALE * 3)).toBe(0);
		expect(similarityFromDistance(-5)).toBe(1);
	});
});

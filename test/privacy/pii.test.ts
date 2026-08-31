/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, test } from "bun:test";
import {
	detectPii,
	ibanIsValid,
	luhn,
	nirIsValid,
	pseudonymize,
	redactObject,
	redactPii,
	summarizePii,
	type PiiKind,
} from "../../src/privacy/pii.ts";

const SALT = "sel-de-test";
const kinds = (text: string): PiiKind[] => detectPii(text).map((m) => m.kind);

describe("validateurs", () => {
	test("luhn accepte une carte valide et rejette un chiffre modifie", () => {
		expect(luhn("4539578763621486")).toBe(true);
		expect(luhn("4539578763621487")).toBe(false);
		expect(luhn("")).toBe(false);
		expect(luhn("45395a8763621486")).toBe(false);
	});

	test("iban mod-97", () => {
		expect(ibanIsValid("FR7630006000011234567890189")).toBe(true);
		expect(ibanIsValid("FR76 3000 6000 0112 3456 7890 189")).toBe(true);
		expect(ibanIsValid("FR7630006000011234567890188")).toBe(false);
		expect(ibanIsValid("XX00")).toBe(false);
	});

	test("nir: cle 97 et cas corse", () => {
		expect(nirIsValid("1 84 12 76 451 089 46")).toBe(true);
		expect(nirIsValid("184127645108946")).toBe(true);
		expect(nirIsValid("184127645108947")).toBe(false);
		// 2A -> 19 avant calcul de cle : sans la substitution, la cle est fausse.
		expect(nirIsValid("1 84 12 2A 451 089 33")).toBe(true);
	});
});

describe("detection", () => {
	test("email, telephone FR et international", () => {
		expect(kinds("ecris a jean.dupont@exemple.fr")).toEqual(["email"]);
		expect(kinds("appelle le 06 12 34 56 78")).toEqual(["phone"]);
		expect(kinds("tel: +33 6 12 34 56 78")).toEqual(["phone"]);
		expect(kinds("call (555) 123-4567")).toEqual(["phone"]);
	});

	test("une carte bancaire n'est pas decoupee en telephone", () => {
		// Sans arbitrage de priorite, le detecteur telephone morde sur la meme
		// zone et la carte ressort en deux fragments.
		const found = detectPii("carte 4539 5787 6362 1486 fin");
		expect(found).toHaveLength(1);
		expect(found[0]!.kind).toBe("credit_card");
		expect(found[0]!.confidence).toBe(1);
	});

	test("16 chiffres qui echouent a Luhn ne sont pas une carte", () => {
		expect(kinds("ref 4539578763621487")).not.toContain("credit_card");
	});

	test("iban seulement s'il valide mod-97", () => {
		expect(kinds("IBAN FR76 3000 6000 0112 3456 7890 189")).toEqual(["iban"]);
		expect(kinds("IBAN FR76 3000 6000 0112 3456 7890 188")).not.toContain("iban");
	});

	test("secrets: jwt, prefixes de jetons, cookies de session X, url a identifiants", () => {
		expect(
			kinds("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"),
		).toEqual(["jwt"]);
		expect(kinds("token ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toEqual(["api_key"]);
		expect(kinds("AKIAIOSFODNN7EXAMPLE")).toEqual(["api_key"]);
		expect(kinds("Cookie: auth_token=a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4")).toEqual(["session_cookie"]);
		expect(kinds("psql postgres://admin:hunter2@db.internal/prod")).toEqual(["url_credentials"]);
	});

	test("cle privee complete, blocs multilignes compris", () => {
		const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA\nAAAA\n-----END OPENSSH PRIVATE KEY-----";
		const found = detectPii(`avant\n${key}\napres`);
		expect(found).toHaveLength(1);
		expect(found[0]!.kind).toBe("private_key");
		expect(found[0]!.value).toBe(key);
	});

	test("reseau: ipv4, ipv6, mac", () => {
		expect(kinds("depuis 192.168.1.24")).toEqual(["ipv4"]);
		expect(kinds("host 2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toEqual(["ipv6"]);
		expect(kinds("mac 3c:22:fb:1a:2b:3c")).toEqual(["mac"]);
	});

	test("coordonnees seulement au-dela de 4 decimales", () => {
		expect(kinds("48.858,2.294")).toEqual([]);
		expect(kinds("48.858370, 2.294481")).toEqual(["coordinates"]);
	});

	test("plaque d'immatriculation FR", () => {
		expect(kinds("vehicule AB-123-CD")).toEqual(["plate_fr"]);
	});

	test("siren est hors des types par defaut", () => {
		// 9 chiffres sur 10 passent Luhn : actif par defaut, il caviarderait des
		// references de commande.
		expect(kinds("commande 552 100 554")).toEqual([]);
		expect(detectPii("commande 552 100 554", { kinds: ["siren"], minConfidence: 0.4 })).toHaveLength(1);
	});

	test("faux positifs courants epargnes", () => {
		expect(kinds("version 1.2.3")).toEqual([]);
		expect(kinds("commit a1b2c3d4e5f6a7b8c9d0")).toEqual([]);
		expect(kinds("total 1234567 lignes")).toEqual([]);
		expect(kinds("le prix est 4539.57")).toEqual([]);
	});

	test("occurrences triees, sans chevauchement, aux bons offsets", () => {
		const text = "a@b.fr puis 06 12 34 56 78 puis c@d.io";
		const found = detectPii(text);
		expect(found.map((m) => m.kind)).toEqual(["email", "phone", "email"]);
		for (const m of found) expect(text.slice(m.start, m.end)).toBe(m.value);
		for (let i = 1; i < found.length; i++) expect(found[i]!.start).toBeGreaterThanOrEqual(found[i - 1]!.end);
	});

	test("minConfidence filtre les types incertains", () => {
		expect(kinds("serveur 10.0.0.8")).toEqual(["ipv4"]);
		expect(detectPii("serveur 10.0.0.8", { minConfidence: 0.9 })).toEqual([]);
	});
});

describe("caviardage", () => {
	test("label", () => {
		expect(redactPii("ecris a jean@exemple.fr", { mode: "label" }).text).toBe("ecris a [EMAIL]");
	});

	test("mask garde la forme", () => {
		expect(redactPii("jean.dupont@exemple.fr", { mode: "mask" }).text).toBe("j**********@e******.fr");
	});

	test("remove supprime", () => {
		expect(redactPii("de jean@exemple.fr a nous", { mode: "remove" }).text).toBe("de  a nous");
	});

	test("pseudonym: stable pour la meme valeur, distinct sinon, non reversible", () => {
		const a = redactPii("jean@exemple.fr et jean@exemple.fr et paul@exemple.fr", { salt: SALT }).text;
		const [first, second, third] = a.match(/\[EMAIL:[0-9a-f]{8}\]/g) as string[];
		expect(first).toBe(second);
		expect(third).not.toBe(first);
		expect(a).not.toContain("jean@exemple.fr");
	});

	test("pseudonym change avec le sel", () => {
		const one = redactPii("jean@exemple.fr", { salt: "sel-a" }).text;
		const two = redactPii("jean@exemple.fr", { salt: "sel-b" }).text;
		expect(one).not.toBe(two);
	});

	test("pseudonym sans sel est refuse plutot que degrade en hash nu", () => {
		expect(() => redactPii("jean@exemple.fr", { mode: "pseudonym" })).toThrow(/sel/);
		expect(() => pseudonymize("email", "jean@exemple.fr", "")).toThrow(/sel/);
	});

	test("le texte hors occurrence est preserve au caractere pres", () => {
		const text = "  ligne 1 : jean@exemple.fr\n\tligne 2 : rien\n";
		const out = redactPii(text, { mode: "label" }).text;
		expect(out).toBe("  ligne 1 : [EMAIL]\n\tligne 2 : rien\n");
	});

	test("texte sans donnee identifiante est rendu inchange", () => {
		const text = "rien a signaler ici";
		const res = redactPii(text, { salt: SALT });
		expect(res.text).toBe(text);
		expect(res.matches).toEqual([]);
	});
});

describe("redactObject", () => {
	test("caviarde par contenu et par nom de cle", () => {
		const out = redactObject(
			{ user: { email: "jean@exemple.fr", password: "hunter2", age: 31 }, note: "ip 10.0.0.8" },
			{ mode: "label" },
		);
		expect(out).toEqual({
			user: { email: "[EMAIL]", password: "[REDACTED]", age: 31 },
			note: "ip [IP]",
		});
	});

	test("un identifiant social est caviarde par sa cle", () => {
		// Un pseudo n'a aucune forme reconnaissable, mais c'est la donnee la plus
		// identifiante d'un journal de purge.
		expect(redactObject({ handle: "exemple_user" }, { mode: "label" })).toEqual({ handle: "[REDACTED]" });
	});

	test("un mot de passe sans forme reconnaissable n'est attrape que par sa cle", () => {
		expect(detectPii("hunter2")).toEqual([]);
		expect(redactObject({ pwd: "hunter2" }, { mode: "label" })).toEqual({ pwd: "[REDACTED]" });
	});

	test("traverse tableaux et imbrications, garde les cles", () => {
		const out = redactObject({ list: [{ mail: "a@b.fr" }, { mail: "c@d.fr" }] }, { mode: "label" });
		expect(out).toEqual({ list: [{ mail: "[EMAIL]" }, { mail: "[EMAIL]" }] });
	});

	test("ne modifie pas l'objet source", () => {
		const src = { email: "jean@exemple.fr" };
		redactObject(src, { mode: "label" });
		expect(src.email).toBe("jean@exemple.fr");
	});

	test("survit a un cycle", () => {
		const node: Record<string, unknown> = { email: "jean@exemple.fr" };
		node.self = node;
		expect(() => redactObject(node, { mode: "label" })).not.toThrow();
	});

	test("types non textuels intacts", () => {
		const out = redactObject({ n: 42, b: true, z: null, u: undefined }, { mode: "label" });
		expect(out).toEqual({ n: 42, b: true, z: null, u: undefined });
	});
});

describe("resume d'audit", () => {
	test("compte par type", () => {
		const found = detectPii("a@b.fr c@d.fr 06 12 34 56 78");
		expect(summarizePii(found)).toEqual({ email: 2, phone: 1 });
	});
});

describe("cas reel: journal de purge X", () => {
	test("un journal caviarde ne laisse ni cookie ni identifiant en clair", () => {
		const journal = {
			handle: "exemple_user",
			auth_token: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4",
			ct0: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
			queue: [{ id: "1", text: "contactez-moi sur jean@exemple.fr ou au 06 12 34 56 78" }],
		};
		const out = redactObject(journal, { salt: SALT });
		const dumped = JSON.stringify(out);
		expect(dumped).not.toContain("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4");
		expect(dumped).not.toContain("0f1e2d3c4b5a69788796a5b4c3d2e1f0");
		expect(dumped).not.toContain("jean@exemple.fr");
		expect(dumped).not.toContain("06 12 34 56 78");
		expect(dumped).not.toContain("exemple_user");
		expect(out.queue[0]!.id).toBe("1");
	});
});

// Chaque cas ci-dessous a ete trouve par l'audit adversarial du 2026-08-31 :
// tous echouaient avant le correctif, et chacun laissait fuir en clair la
// donnee que le module existe precisement pour cacher.
describe("regressions d'audit", () => {
	test("un chevauchement est arbitre par priorite, pas par position", () => {
		// Le motif telephone (priorite 70) commence a gauche de la carte
		// (priorite 88). Avant correctif, il mordait sur la zone et le PAN
		// valide par Luhn sortait en clair.
		const found = kinds("appel 06 12 34 56 78 puis carte 4539578763621486");
		expect(found).toContain("credit_card");
		const out = redactPii("appel 06 12 34 56 78 puis carte 4539578763621486", {
			mode: "label",
		}).text;
		expect(out).not.toContain("4539578763621486");
	});

	test("une reference partagee est caviardee a chacune de ses occurrences", () => {
		const shared = { email: "jean@exemple.fr" };
		const out = redactObject({ a: shared, b: shared }, { salt: SALT });
		expect(JSON.stringify(out)).not.toContain("jean@exemple.fr");
	});

	test("un cycle ne fait pas fuir l'objet d'origine", () => {
		const node: Record<string, unknown> = { email: "jean@exemple.fr" };
		node.self = node;
		const out = redactObject(node, { salt: SALT }) as Record<string, unknown>;
		expect(out.email).not.toBe("jean@exemple.fr");
		expect(out.self).toBe(out);
	});

	test("une cle sensible efface tout ce qui deborde du motif reconnu", () => {
		// Seul le JWT etait reconnu : la queue `sig=...` restait en clair.
		const out = redactObject(
			{
				authorization:
					"Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U sig=secret-tail",
			},
			{ mode: "label" },
		);
		expect(JSON.stringify(out)).not.toContain("secret-tail");
	});

	test("une valeur non textuelle sous une cle sensible est caviardee aussi", () => {
		const out = redactObject({ password: 1234567890 }, { mode: "label" });
		expect(JSON.stringify(out)).not.toContain("1234567890");
	});

	test("un Set / une Map sous caviardage gardent leur contenu, nettoye", () => {
		const out = redactObject(
			{ vus: new Set(["jean@exemple.fr"]), par: new Map([["k", "jean@exemple.fr"]]) },
			{ mode: "label" },
		) as { vus: Set<string>; par: Map<string, string> };
		expect(out.vus).toBeInstanceOf(Set);
		expect(out.par).toBeInstanceOf(Map);
		expect([...out.vus][0]).toBe("[EMAIL]");
		expect(out.par.get("k")).toBe("[EMAIL]");
	});

	test("une carte Amex (15 chiffres, groupes 4-6-5) est detectee", () => {
		expect(kinds("378282246310005")).toEqual(["credit_card"]);
		expect(kinds("3782 822463 10005")).toEqual(["credit_card"]);
	});

	test("un separateur insecable ne fait pas passer une carte ou un IBAN", () => {
		expect(kinds("4539 5787 6362 1486")).toEqual(["credit_card"]);
		expect(kinds("FR14 2004 1010 0505 0001 3M02 606")).toEqual([
			"iban",
		]);
	});

	test("un sel manquant echoue meme sur un texte sans PII", () => {
		expect(() => redactPii("rien a signaler ici")).toThrow(/sel/);
	});

	test("un BEGIN PRIVATE KEY jamais ferme ne fait pas exploser le temps de detection", () => {
		const bomb = `-----BEGIN RSA PRIVATE KEY-----${"A".repeat(400_000)}`;
		const started = performance.now();
		detectPii(bomb);
		expect(performance.now() - started).toBeLessThan(1000);
	});

	test("mask ne laisse pas une valeur courte quasi intacte", () => {
		const masked = redactPii("06 12 34 56 78", { mode: "mask" }).text;
		expect(masked).not.toContain("56 78");
	});
});

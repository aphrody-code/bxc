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

/**
 * @module bxc/privacy/pii
 *
 * Noyau de detection et de caviardage des donnees personnelles.
 *
 * C'est la brique partagee de l'objectif « protection des infos perso » : tout
 * ce qui doit *reconnaitre* une donnee identifiante — audit d'exposition,
 * nettoyage de journaux, scrub de fichiers avant publication, filtrage des
 * sorties d'agent — passe par ici, exactement comme les deux purges X
 * partagent `purge-engine.ts`. Un faux negatif corrige ici protege tous les
 * appelants d'un coup.
 *
 * Trois principes de conception :
 *
 * 1. **La precision prime sur le rappel.** Un detecteur qui crie au loup rend
 *    le caviardage inutilisable : on cesse de le lire. Tout ce qui se valide
 *    (Luhn, IBAN mod-97, cle NIR) est valide ; ce qui ne peut pas l'etre sans
 *    contexte (SIREN, SIRET) est hors des types actifs par defaut et doit etre
 *    demande explicitement.
 * 2. **Deterministe.** Aucune horloge, aucun aleatoire : le sel de
 *    pseudonymisation est fourni par l'appelant. Le meme corpus produit deux
 *    fois la meme sortie, donc le resultat est diffable et testable.
 * 3. **Le caviardage preserve la structure.** Pseudonymiser plutot que
 *    supprimer garde les correlations (« ces deux lignes parlent de la meme
 *    personne ») sans garder l'identite — c'est ce qui rend un journal encore
 *    exploitable apres nettoyage.
 */

import { createHmac } from "node:crypto";

/** Categorie de donnee identifiante reconnue par {@link detectPii}. */
export type PiiKind =
	| "api_key"
	| "coordinates"
	| "credit_card"
	| "email"
	| "iban"
	| "ipv4"
	| "ipv6"
	| "jwt"
	| "mac"
	| "nir"
	| "phone"
	| "plate_fr"
	| "private_key"
	| "session_cookie"
	| "siren"
	| "url_credentials";

/** Une occurrence localisee dans le texte source. */
export interface PiiMatch {
	kind: PiiKind;
	/** Sous-chaine exacte reperee. */
	value: string;
	/** Index de debut dans le texte source (inclus). */
	start: number;
	/** Index de fin dans le texte source (exclu). */
	end: number;
	/**
	 * 0..1. Vaut 1 quand une somme de controle a valide la donnee (Luhn,
	 * mod-97), moins quand la forme seule est un indice (une IPv4 peut etre un
	 * numero de version).
	 */
	confidence: number;
}

/** Strategie de remplacement appliquee par {@link redactPii}. */
export type RedactionMode =
	/** `j***@e*****.com` — garde la forme, utile pour relire un journal. */
	| "mask"
	/** `[EMAIL]` — le plus lisible, perd toute correlation. */
	| "label"
	/** `[EMAIL:7f3a2b1c]` — meme valeur ⇒ meme jeton, identite non reversible. */
	| "pseudonym"
	/** Suppression pure. */
	| "remove";

export interface DetectOptions {
	/** Types a chercher. Defaut : {@link DEFAULT_PII_KINDS}. */
	kinds?: readonly PiiKind[];
	/** Ignore les occurrences sous ce seuil. Defaut 0.5. */
	minConfidence?: number;
}

export interface RedactOptions extends DetectOptions {
	/** Defaut : `"pseudonym"`. */
	mode?: RedactionMode;
	/**
	 * Sel HMAC de la pseudonymisation. **Obligatoire** en mode `pseudonym` :
	 * sans sel, le jeton est un simple hash et un dictionnaire d'emails
	 * courants le casse en quelques secondes.
	 */
	salt?: string;
}

/**
 * Types actifs par defaut : uniquement ceux dont la precision tient sans
 * contexte. `siren` en est exclu — 9 chiffres sur 10 passent Luhn par hasard,
 * l'activer sur du texte libre caviarde des references de commande.
 */
export const DEFAULT_PII_KINDS: readonly PiiKind[] = [
	"private_key",
	"jwt",
	"api_key",
	"session_cookie",
	"url_credentials",
	"iban",
	"credit_card",
	"nir",
	"email",
	"phone",
	"ipv6",
	"ipv4",
	"mac",
	"coordinates",
	"plate_fr",
];

/**
 * Cles d'objet dont la *valeur* est identifiante quel que soit son contenu.
 * `redactObject` s'en sert pour caviarder un secret que la detection textuelle
 * ne reconnaitrait pas — un mot de passe n'a aucune forme reconnaissable.
 */
const SENSITIVE_KEY = new RegExp(
	"^(?:" +
		[
			"e?mail",
			"phone|tel|mobile|telephone",
			"pass(?:word|wd)?|pwd",
			"secret|credential",
			"(?:access_|refresh_|auth_|bearer_?)?token",
			"api[_-]?key",
			"authorization",
			"cookie|cookies",
			"ct0|auth_token|csrf",
			"session(?:_id)?",
			"ssn|nir|social_security",
			"iban|rib|card(?:_number)?|cvv|cvc",
			"address|adresse|street|postal_code|zip",
			"dob|birth(?:date|day)?|date_de_naissance",
			"lat(?:itude)?|lon(?:g|gitude)?",
			"handle|screen_?name|user_?name|display_?name|pseudo|login",
		].join("|") +
		")$",
	"i",
);

interface Detector {
	kind: PiiKind;
	pattern: RegExp;
	/**
	 * Depart en cas de chevauchement : la donnee la plus specifique gagne. Une
	 * carte bancaire contient une sous-chaine qui ressemble a un telephone ;
	 * sans priorite, le decoupage depend de l'ordre d'iteration.
	 */
	priority: number;
	/** Confiance de base, avant validation. */
	confidence: number;
	/**
	 * Validation optionnelle. `false` rejette l'occurrence, un nombre remplace
	 * la confiance de base.
	 */
	validate?: (value: string, groups: string[]) => boolean | number;
}

// --- validateurs ------------------------------------------------------------

/** Somme de Luhn — cartes bancaires, SIREN/SIRET. */
export function luhn(digits: string): boolean {
	let sum = 0;
	let double = false;
	for (let i = digits.length - 1; i >= 0; i--) {
		let d = digits.charCodeAt(i) - 48;
		if (d < 0 || d > 9) return false;
		if (double) {
			d *= 2;
			if (d > 9) d -= 9;
		}
		sum += d;
		double = !double;
	}
	return digits.length > 0 && sum % 10 === 0;
}

/** Validation IBAN : reordonnancement puis modulo 97 == 1. */
export function ibanIsValid(raw: string): boolean {
	const iban = raw.replace(/[\s-]/g, "").toUpperCase();
	if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
	const moved = iban.slice(4) + iban.slice(0, 4);
	let remainder = 0;
	for (const ch of moved) {
		const code = ch.charCodeAt(0);
		// A..Z devient 10..35, chiffre par chiffre pour rester en entier natif.
		const part = code >= 65 ? String(code - 55) : ch;
		for (const digit of part) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
	}
	return remainder === 1;
}

/**
 * Validation de la cle d'un NIR francais : `97 - (numero mod 97)`.
 * La Corse est le cas particulier — 2A et 2B ne sont pas numeriques et se
 * substituent respectivement par 19 et 18 avant le calcul.
 */
export function nirIsValid(raw: string): boolean {
	const compact = raw.replace(/\s/g, "").toUpperCase();
	if (!/^[1-478]\d{2}(?:0\d|1[0-2]|[2-9]\d)(?:\d{2}|2[AB])\d{6}\d{2}$/.test(compact)) return false;
	const key = Number(compact.slice(-2));
	const body = compact.slice(0, 13).replace("2A", "19").replace("2B", "18");
	if (!/^\d{13}$/.test(body)) return false;
	let remainder = 0;
	for (const digit of body) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
	return 97 - remainder === key;
}

/** Nombre de chiffres d'un numero de telephone, separateurs retires. */
function digitCount(value: string): number {
	let n = 0;
	for (const ch of value) if (ch >= "0" && ch <= "9") n++;
	return n;
}

// --- detecteurs -------------------------------------------------------------

/**
 * Prefixes de jetons connus. Volontairement limite a des prefixes proprietaires
 * : detecter « une longue chaine a forte entropie » ferait exploser les faux
 * positifs sur les hashes de commit et les identifiants de build.
 */
const API_KEY_SOURCE = [
	"sk-ant-[A-Za-z0-9_-]{16,}",
	"sk-proj-[A-Za-z0-9_-]{16,}",
	"sk-[A-Za-z0-9]{20,}",
	"gh[pousr]_[A-Za-z0-9]{16,}",
	"github_pat_[A-Za-z0-9_]{20,}",
	"glpat-[A-Za-z0-9_-]{16,}",
	"AKIA[0-9A-Z]{16}",
	"ASIA[0-9A-Z]{16}",
	"xox[baprs]-[A-Za-z0-9-]{10,}",
	"AIza[0-9A-Za-z_-]{35}",
	"hf_[A-Za-z0-9]{30,}",
	"npm_[A-Za-z0-9]{30,}",
	"[sp]k_(?:live|test)_[A-Za-z0-9]{16,}",
	"xai-[A-Za-z0-9]{16,}",
].join("|");

const DETECTORS: readonly Detector[] = [
	{
		kind: "private_key",
		// Borne explicite sur le corps : `[\s\S]*?` sans plafond backtrack en
		// O(n^2) sur un BEGIN jamais ferme — 6 s pour 450 Ko de texte fourni par
		// un tiers. Aucune cle PEM reelle ne depasse 16 Ko.
		pattern:
			/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s\S]{0,16384}?-----END [^\n]*-----/g,
		priority: 100,
		confidence: 1,
	},
	{
		kind: "jwt",
		pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
		priority: 95,
		confidence: 0.95,
	},
	{
		kind: "api_key",
		pattern: new RegExp(`(?<![A-Za-z0-9_-])(?:${API_KEY_SOURCE})`, "g"),
		priority: 94,
		confidence: 0.95,
	},
	{
		// Specifique a bxc : les jetons de session X circulent en clair dans les
		// jars, les journaux de purge et les traces d'agent.
		kind: "session_cookie",
		pattern:
			/\b(?:auth_token|ct0|_twitter_sess|kdt|guest_id|personalization_id|__Secure-[A-Za-z0-9_-]+)=[A-Za-z0-9%._+-]{8,}/g,
		priority: 93,
		confidence: 0.95,
	},
	{
		kind: "url_credentials",
		pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@[^\s/]+/gi,
		priority: 92,
		confidence: 0.95,
	},
	{
		kind: "iban",
		pattern: /(?<![A-Z0-9])[A-Z]{2}\d{2}(?:[ \u00a0\u202f-]?[A-Z0-9]{2,4}){2,8}(?![A-Z0-9])/g,
		priority: 90,
		confidence: 0.6,
		validate: (value) => (ibanIsValid(value) ? 1 : false),
	},
	{
		// La longueur d'un PAN va de 12 (Maestro) a 19 chiffres, et les groupes
		// ne font pas tous 4 : Amex est 4-6-5, Diners 4-6-4. Un motif en groupes
		// de 4 ne voyait que le 12 et le 16 — Amex, Diners et les 19 passaient au
		// travers. On ratisse large sur la forme, le filtre IIN + Luhn tranche.
		kind: "credit_card",
		pattern: /(?<![\d-])\d(?:[ \u00a0\u202f-]?\d){11,18}(?![\d-])/g,
		priority: 88,
		confidence: 0.6,
		validate: (value) => {
			const digits = value.replace(/\D/g, "");
			if (digits.length < 12 || digits.length > 19) return false;
			// Prefixes IIN reels (Visa, Mastercard, Amex, Diners, Discover,
			// JCB, UnionPay) : sans ce filtre, un identifiant numerique passe
			// Luhn une fois sur dix.
			if (!/^(?:4|5[1-5]|2[2-7]|3[47]|3[0689]|6011|64[4-9]|65|62)/.test(digits)) return false;
			return luhn(digits) ? 1 : false;
		},
	},
	{
		kind: "nir",
		pattern: /(?<!\d)[1-478]\s?\d{2}\s?\d{2}\s?(?:\d{2}|2[AB])\s?\d{3}\s?\d{3}\s?\d{2}(?!\d)/gi,
		priority: 86,
		confidence: 0.6,
		validate: (value) => (nirIsValid(value) ? 1 : false),
	},
	{
		kind: "siren",
		pattern: /(?<![\d-])\d{3}[ ]?\d{3}[ ]?\d{3}(?:[ ]?\d{5})?(?![\d-])/g,
		priority: 84,
		confidence: 0.4,
		validate: (value) => (luhn(value.replace(/ /g, "")) ? 0.5 : false),
	},
	{
		kind: "email",
		pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g,
		priority: 80,
		confidence: 0.95,
	},
	{
		kind: "phone",
		pattern:
			/(?<![\d\w+])(?:\+\d{1,3}[ \u00a0\u202f.-]?(?:\(\d{1,4}\)[ \u00a0\u202f.-]?)?\d(?:[ \u00a0\u202f.-]?\d){6,13}|0[1-9](?:[ \u00a0\u202f.-]?\d{2}){4}|\(\d{3}\)[ \u00a0\u202f.-]?\d{3}[ \u00a0\u202f.-]?\d{4})(?![\d\w])/g,
		priority: 70,
		confidence: 0.8,
		validate: (value) => {
			const n = digitCount(value);
			return n >= 7 && n <= 15;
		},
	},
	{
		kind: "ipv6",
		pattern:
			/(?<![\w:])(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?<![\w:])(?:[0-9A-Fa-f]{1,4}:){1,7}:(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?(?![\w:])/g,
		priority: 66,
		confidence: 0.9,
	},
	{
		kind: "mac",
		pattern: /(?<![\w:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![\w:-])/g,
		priority: 64,
		confidence: 0.9,
	},
	{
		// 0.6 assume : une IPv4 est indissociable d'un numero de version a la
		// seule forme. L'appelant qui nettoie des journaux HTTP peut abaisser
		// `minConfidence` ; celui qui nettoie du code source ne le fera pas.
		kind: "ipv4",
		pattern: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(?![\d.])/g,
		priority: 62,
		confidence: 0.6,
	},
	{
		// >= 4 decimales : c'est ce qui distingue une position (~10 m) d'un
		// couple de nombres quelconque.
		kind: "coordinates",
		pattern:
			/(?<![\d.])[-+]?(?:90(?:\.0+)?|[0-8]?\d\.\d{4,})\s*,\s*[-+]?(?:180(?:\.0+)?|(?:1[0-7]\d|[0-9]?\d)\.\d{4,})(?![\d.])/g,
		priority: 60,
		confidence: 0.85,
	},
	{
		kind: "plate_fr",
		pattern: /(?<![A-Z0-9])[A-HJ-NP-TV-Z]{2}-\d{3}-[A-HJ-NP-TV-Z]{2}(?![A-Z0-9])/gi,
		priority: 58,
		confidence: 0.85,
	},
];

// --- detection --------------------------------------------------------------

/**
 * Repere toutes les donnees identifiantes d'un texte.
 *
 * Les occurrences sont rendues triees par position et **sans chevauchement** :
 * quand deux detecteurs mordent sur la meme zone, le plus prioritaire gagne
 * (voir {@link Detector.priority}). L'appelant peut donc reconstruire le texte
 * par simple concatenation sans recalculer d'offsets.
 */
export function detectPii(text: string, opts: DetectOptions = {}): PiiMatch[] {
	const kinds = new Set(opts.kinds ?? DEFAULT_PII_KINDS);
	const minConfidence = opts.minConfidence ?? 0.5;
	const found: (PiiMatch & { priority: number })[] = [];

	for (const detector of DETECTORS) {
		if (!kinds.has(detector.kind)) continue;
		// Chaque detecteur a son propre curseur : `lastIndex` est un etat porte
		// par l'objet RegExp, le partager entre deux passes sauterait des
		// occurrences.
		const pattern = new RegExp(detector.pattern.source, detector.pattern.flags);
		for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
			const value = m[0];
			if (value.length === 0) {
				pattern.lastIndex++;
				continue;
			}
			let confidence = detector.confidence;
			if (detector.validate) {
				const verdict = detector.validate(value, m.slice(1) as string[]);
				if (verdict === false) continue;
				if (typeof verdict === "number") confidence = verdict;
			}
			if (confidence < minConfidence) continue;
			found.push({
				kind: detector.kind,
				value,
				start: m.index,
				end: m.index + value.length,
				confidence,
				priority: detector.priority,
			});
		}
	}

	// Priorite d'abord, position ensuite. Trier par position et avancer un
	// curseur donnait la zone au detecteur qui *commence* le plus tot, quelle
	// que soit sa priorite : sur « 06 12 34 56 78 4111 1111 1111 1111 » le
	// motif telephone (priorite 70) mordait a gauche et faisait disparaitre la
	// carte validee par Luhn (priorite 88) — le PAN restait en clair.
	found.sort((a, b) =>
		b.priority !== a.priority
			? b.priority - a.priority
			: a.start !== b.start
				? a.start - b.start
				: b.end - a.end,
	);

	const kept: (PiiMatch & { priority: number })[] = [];
	for (const match of found) {
		if (kept.some((k) => match.start < k.end && k.start < match.end)) continue;
		kept.push(match);
	}
	kept.sort((a, b) => a.start - b.start);
	return kept.map(({ priority: _priority, ...clean }) => clean);
}

// --- caviardage -------------------------------------------------------------

const LABEL: Record<PiiKind, string> = {
	api_key: "API_KEY",
	coordinates: "GEO",
	credit_card: "CARD",
	email: "EMAIL",
	iban: "IBAN",
	ipv4: "IP",
	ipv6: "IP",
	jwt: "JWT",
	mac: "MAC",
	nir: "NIR",
	phone: "PHONE",
	plate_fr: "PLATE",
	private_key: "PRIVATE_KEY",
	session_cookie: "SESSION",
	siren: "SIREN",
	url_credentials: "URL_CREDENTIALS",
};

/**
 * Jeton stable et non reversible pour une valeur donnee.
 *
 * Le sel est obligatoire : sans lui, `HMAC(email)` se casse par dictionnaire —
 * l'espace des emails plausibles est petit. Avec un sel garde par l'appelant,
 * deux occurrences de la meme personne restent correlables dans le corpus
 * nettoye sans que l'identite soit retrouvable depuis le corpus seul.
 */
export function pseudonymize(kind: PiiKind, value: string, salt: string): string {
	if (!salt) throw new Error("pseudonymize: un sel est requis (sinon le jeton se casse par dictionnaire)");
	const digest = createHmac("sha256", salt).update(`${kind}:${value.toLowerCase()}`).digest("hex");
	return `[${LABEL[kind]}:${digest.slice(0, 8)}]`;
}

/** Caviardage conservant la forme : `jean.dupont@exemple.fr` → `j**********@e******.fr`. */
function mask(kind: PiiKind, value: string): string {
	if (kind === "email") {
		const at = value.lastIndexOf("@");
		const local = value.slice(0, at);
		const domain = value.slice(at + 1);
		const dot = domain.lastIndexOf(".");
		const name = domain.slice(0, dot);
		return `${local[0]}${"*".repeat(Math.max(1, local.length - 1))}@${name[0]}${"*".repeat(Math.max(1, name.length - 1))}${domain.slice(dot)}`;
	}
	// Les 4 derniers caracteres suffisent a reconcilier une carte ou un
	// telephone avec un releve, sans permettre de le reconstituer — mais
	// seulement si le reste est assez long pour rester secret. Sur une valeur
	// de 6 caracteres, « garder les 4 derniers » revient a ne rien caviarder.
	const alnum = value.replace(/[^A-Za-z0-9]/g, "");
	if (alnum.length < 8) return "*".repeat(Math.max(4, value.length));
	const tail = alnum.slice(-4);
	return `${"*".repeat(Math.max(4, value.length - 4))}${tail}`;
}

export interface RedactResult {
	/** Texte nettoye. */
	text: string;
	/** Occurrences remplacees, dans l'ordre du texte source. */
	matches: PiiMatch[];
}

/**
 * Remplace toutes les donnees identifiantes d'un texte.
 *
 * @example
 * const salt = process.env.BXC_PII_SALT!;
 * const { text, matches } = redactPii(logLine, { salt });
 */
export function redactPii(text: string, opts: RedactOptions = {}): RedactResult {
	const mode = opts.mode ?? "pseudonym";
	// Avant le retour anticipe : un sel manquant est une erreur de configuration
	// de l'appelant, pas une propriete de l'entree. Le controler apres le
	// `matches.length === 0` faisait passer tous les textes propres et n'echouait
	// qu'au premier texte porteur de PII — soit en production, soit jamais.
	if (mode === "pseudonym" && !opts.salt) {
		throw new Error("redactPii: mode 'pseudonym' exige un sel (opts.salt)");
	}
	const matches = detectPii(text, opts);
	if (matches.length === 0) return { text, matches };

	let out = "";
	let cursor = 0;
	for (const match of matches) {
		out += text.slice(cursor, match.start);
		out +=
			mode === "remove"
				? ""
				: mode === "label"
					? `[${LABEL[match.kind]}]`
					: mode === "mask"
						? mask(match.kind, match.value)
						: pseudonymize(match.kind, match.value, opts.salt as string);
		cursor = match.end;
	}
	out += text.slice(cursor);
	return { text: out, matches };
}

/**
 * Caviarde un objet JSON en profondeur.
 *
 * Deux passes complementaires : le contenu des chaines traverse
 * {@link redactPii}, et toute valeur portee par une cle sensible
 * (`password`, `authorization`, `ct0`…) est remplacee integralement — un mot de
 * passe n'a aucune forme reconnaissable, seule sa cle le trahit.
 *
 * Les cles elles-memes ne sont jamais modifiees : la structure reste
 * exploitable par un lecteur ou un test.
 */
export function redactObject<T>(value: T, opts: RedactOptions = {}): T {
	const mode = opts.mode ?? "pseudonym";
	if (mode === "pseudonym" && !opts.salt) {
		throw new Error("redactObject: mode 'pseudonym' exige un sel (opts.salt)");
	}
	// WeakMap et non WeakSet : il faut renvoyer la version *caviardee* deja
	// calculee. Un WeakSet ne peut que dire « deja vu », et le `return node`
	// qui s'ensuivait rendait l'objet d'origine en clair — il suffisait que la
	// meme reference apparaisse deux fois dans le document (partage ou cycle)
	// pour que la seconde occurrence sorte intacte.
	const done = new WeakMap<object, unknown>();

	/** Caviardage integral d'une valeur sans forme reconnaissable. */
	const blank = (node: string): string =>
		mode === "remove"
			? ""
			: mode === "label"
				? "[REDACTED]"
				: mode === "mask"
					? "*".repeat(Math.min(12, node.length))
					: pseudonymize("api_key", node, opts.salt as string);

	const walk = (node: unknown, keyIsSensitive: boolean): unknown => {
		if (typeof node === "string") {
			if (keyIsSensitive && node.length > 0) {
				// La cle dit « sensible », le contenu dit *quoi* : quand les deux
				// parlent, on garde le plus informatif. `{email: "[EMAIL]"}` se
				// relit, `{email: "[REDACTED]"}` non — et le caviardage garde la
				// meme force.
				//
				// Mais seulement si le contenu couvre *toute* la valeur :
				// `{authorization: "Bearer <jwt> sig=<secret>"}` ne laissait
				// caviarder que le JWT et rendait le reste en clair. Des qu'il
				// reste un octet non couvert, la cle tranche et on efface tout.
				const byContent = redactPii(node, opts);
				const covered = byContent.matches.reduce((n, m) => n + (m.end - m.start), 0);
				if (byContent.matches.length > 0 && covered === node.length) return byContent.text;
				return blank(node);
			}
			return redactPii(node, opts).text;
		}
		if (node === null || node === undefined) return node;
		if (typeof node !== "object") {
			// Une cle sensible porte parfois un nombre : coordonnees, numero de
			// telephone stocke en entier, NIR. Ne traiter que les chaines les
			// laissait passer en clair.
			return keyIsSensitive ? blank(String(node)) : node;
		}

		const cached = done.get(node);
		if (cached !== undefined) return cached;

		// Les objets a etat interne ne survivent pas a `Object.entries` : il rend
		// `{}` et le contenu est perdu, pas caviarde. On traite ceux qui portent
		// de la donnee, on laisse passer les dates (pas identifiantes seules).
		if (node instanceof Date) return node;
		if (ArrayBuffer.isView(node) || node instanceof ArrayBuffer) {
			return keyIsSensitive ? blank("") : node;
		}
		if (node instanceof Map) {
			const outMap = new Map<unknown, unknown>();
			done.set(node, outMap);
			for (const [k, v] of node) {
				outMap.set(k, walk(v, typeof k === "string" ? SENSITIVE_KEY.test(k) : keyIsSensitive));
			}
			return outMap;
		}
		if (node instanceof Set) {
			const outSet = new Set<unknown>();
			done.set(node, outSet);
			for (const v of node) outSet.add(walk(v, keyIsSensitive));
			return outSet;
		}

		if (Array.isArray(node)) {
			const outArr: unknown[] = [];
			done.set(node, outArr);
			for (const item of node) outArr.push(walk(item, keyIsSensitive));
			return outArr;
		}
		const out: Record<string, unknown> = {};
		done.set(node, out);
		for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
			out[key] = walk(child, SENSITIVE_KEY.test(key));
		}
		return out;
	};

	return walk(value, false) as T;
}

/** Compte les occurrences par type — resume d'audit. */
export function summarizePii(matches: readonly PiiMatch[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const match of matches) counts[match.kind] = (counts[match.kind] ?? 0) + 1;
	return counts;
}

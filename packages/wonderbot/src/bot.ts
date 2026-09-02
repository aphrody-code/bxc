/**
 * Wonderbot — assemblage de la passerelle Discord.
 *
 * C'est le SEUL module qui parle à discord.js : il traduit une interaction en
 * appel de commande, repose la réponse, publie les annonces. Toute la logique
 * vit ailleurs, dans des modules qui se testent sans jeton.
 *
 * ── AUCUN INTENT PRIVILÉGIÉ ────────────────────────────────────────────────
 * Le client ne demande que `Guilds`. `GuildMembers` est un intent PRIVILÉGIÉ à
 * cocher dans le portail développeur ; demandé sans être accordé, Discord ferme
 * la passerelle (« Disallowed intent(s) », code 4014) et le service boucle sans
 * jamais se connecter. Wonderbot n'en a pas besoin : les rôles de l'appelant
 * arrivent DANS la charge utile de l'interaction, sans qu'il faille lire le
 * cache des membres. `MessageContent` n'est pas demandé non plus — le bot ne
 * lit aucun message, il ne répond qu'à des interactions.
 */

import {
	ActionRowBuilder,
	ChannelType,
	Client,
	Events,
	GatewayIntentBits,
	MessageFlags,
	StringSelectMenuBuilder,
	PermissionFlagsBits,
	type ChatInputCommandInteraction,
	type Interaction,
	type SendableChannels,
} from "discord.js";

import { JournalAnnonces } from "./annonces.ts";
import {
	PREFIXE_MENU,
	SynchronisationForum,
	lireValeurOption,
	type MenuEpisodes,
	type PasserelleForum,
} from "./forum.ts";
import { Reparateur, decrireLacune, detecterLacunes } from "./lacunes.ts";
import { catalogueReel, type Catalogue, type ResultatRafraichissement } from "./catalogue.ts";
import { resumerConfig, type ConfigWonderbot } from "./config.ts";
import {
	DEFINITION_IETV,
	executerIetv,
	reponsePrivee,
	type OptionsCommande,
} from "./commands/ietv.ts";
import { Planificateur } from "./planificateur.ts";
import { ICONES, fiche, listerEpisodes, type Reponse } from "./ui/index.ts";

export interface OptionsBot {
	config: ConfigWonderbot;
	/** Catalogue injectable — les tests en passent un factice. */
	catalogue?: Catalogue;
	/** Journal des annonces, déduit du catalogue par défaut. */
	journal?: JournalAnnonces;
	client?: Client;
	journaliser?: (message: string) => void;
}

/** Rôles de l'appelant, quelle que soit la forme rendue par discord.js. */
export function rolesDeLInteraction(interaction: ChatInputCommandInteraction): string[] {
	const membre = interaction.member;
	if (!membre) return [];
	const roles = (membre as { roles?: unknown }).roles;
	if (Array.isArray(roles)) return roles.filter((r): r is string => typeof r === "string");
	// `GuildMemberRoleManager` : la collection est indexée par identifiant.
	const cache = (roles as { cache?: Map<string, unknown> } | undefined)?.cache;
	return cache ? [...cache.keys()] : [];
}

/**
 * L'appelant peut-il déclencher un rafraîchissement ?
 *
 * Un administrateur du serveur le peut TOUJOURS. Ne gater que sur une liste de
 * rôles laisserait un serveur fraîchement configuré sans personne pour lancer
 * le premier scraping — pas même son propriétaire — tant qu'un rôle n'est pas
 * créé puis reporté dans `WONDERBOT_STAFF_ROLE_IDS`. La liste sert à ÉLARGIR
 * l'accès au-delà des administrateurs, pas à le définir.
 */
export function estStaff(
	roles: readonly string[],
	rolesStaff: readonly string[],
	estAdministrateur = false
): boolean {
	if (estAdministrateur) return true;
	if (rolesStaff.length === 0) return false;
	const autorises = new Set(rolesStaff);
	return roles.some((role) => autorises.has(role));
}

/**
 * L'appelant est-il administrateur du serveur ?
 *
 * `memberPermissions` est calculé par Discord et livré DANS l'interaction : il
 * tient compte des surcharges de salon et ne demande aucun intent privilégié.
 * Il vaut `null` en message privé — là, personne n'est administrateur de rien.
 */
export function estAdministrateur(interaction: ChatInputCommandInteraction): boolean {
	return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

/** Adaptateur d'options : discord.js → l'interface neutre des commandes. */
export function optionsDeLInteraction(interaction: ChatInputCommandInteraction): OptionsCommande {
	return {
		chaine: (nom) => interaction.options.getString(nom),
		entier: (nom) => interaction.options.getInteger(nom),
	};
}

/** Traduit les menus neutres en rangées d'action discord.js. */
function rangeesDeMenus(menus: readonly MenuEpisodes[]) {
	return menus.map((menu) =>
		new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId(menu.customId)
				.setPlaceholder(menu.placeholder)
				.addOptions(menu.options.map((option) => ({ label: option.label, value: option.value })))
		)
	);
}

export class Wonderbot {
	private readonly config: ConfigWonderbot;
	private readonly client: Client;
	private readonly catalogue: Catalogue;
	private readonly journal: JournalAnnonces;
	private readonly journaliser: (message: string) => void;
	private readonly planificateur: Planificateur;
	private forum: SynchronisationForum | null = null;
	private readonly reparateur: Reparateur;
	/** Minuteur de la tentative de réparation en attente, s'il y en a une. */
	private reparationEnAttente: ReturnType<typeof setTimeout> | null = null;

	constructor(options: OptionsBot) {
		this.config = options.config;
		this.journaliser = options.journaliser ?? ((message) => console.log(message));
		this.catalogue = options.catalogue ?? catalogueReel(this.config.cheminCache);
		this.journal = options.journal ?? new JournalAnnonces(this.catalogue);
		this.client =
			options.client ??
			new Client({
				intents: [GatewayIntentBits.Guilds],
			});

		this.reparateur = new Reparateur({
			stockage: this.catalogue,
			tentativesMax: this.config.tentativesReparation,
		});

		this.planificateur = new Planificateur({
			intervalleMs: this.config.intervalleRafraichissementMs,
			rafraichir: () => this.catalogue.rafraichir(),
			surSucces: (resultat) => this.apresRafraichissement(resultat),
			surErreur: (err) =>
				this.journaliser(
					`${ICONES.attention} rafraîchissement échoué : ${err instanceof Error ? err.message : String(err)}`
				),
		});
	}

	/**
	 * Se connecte, publie les commandes, et démarre la boucle de
	 * rafraîchissement sauf mention contraire.
	 *
	 * La promesse ne se résout qu'une fois les commandes PUBLIÉES, pas au
	 * `login` : `login()` rend la main dès la poignée de main, bien avant
	 * `clientReady`. Un appelant qui ne veut que publier (`bxc wonderbot
	 * register`) fermerait sinon la passerelle avant l'enregistrement.
	 */
	async demarrer(options: { planifier?: boolean } = {}): Promise<void> {
		const planifier = options.planifier ?? true;
		this.journaliser(`${ICONES.rafraichir} Wonderbot — ${resumerConfig(this.config)}`);

		this.client.on(Events.InteractionCreate, (interaction) => {
			void this.traiterInteraction(interaction);
		});

		const pret = new Promise<void>((resoudre, rejeter) => {
			this.client.once(Events.ClientReady, async (client) => {
				this.journaliser(
					`${ICONES.succes} Connecté en tant que ${client.user.tag} — ${client.guilds.cache.size} serveur(s)`
				);
				try {
					await this.publierCommandes();
				} catch (err) {
					// Une publication ratée laisse un bot en ligne et muet : on le dit,
					// et on rend la main à l'appelant pour qu'il décide.
					this.journaliser(
						`${ICONES.echec} publication des commandes impossible : ${err instanceof Error ? err.message : String(err)}`
					);
					rejeter(err instanceof Error ? err : new Error(String(err)));
					return;
				}
				// Réconciliation au démarrage : sans elle, un fil supprimé ou un
				// catalogue amorcé hors ligne attendraient le prochain
				// rafraîchissement, soit six heures.
				if (planifier) {
					await this.synchroniserForum();
					this.planificateur.demarrer();
					// Après la résolution : un premier scraping prend plusieurs
					// minutes, l'appelant n'a pas à l'attendre pour savoir que le
					// bot répond.
					void this.rafraichirSiPerime();
				}
				resoudre();
			});
		});

		await this.client.login(this.config.jeton);
		await pret;
	}

	/**
	 * Publie `/episodes` selon la portée configurée.
	 *
	 * Les deux portées s'ADDITIONNENT côté Discord : une publication globale
	 * laisse en place d'éventuelles commandes de guilde, et le membre voit alors
	 * chaque commande en double sans pouvoir dire laquelle répond. On efface donc
	 * les commandes de guilde en passant en global.
	 */
	async publierCommandes(): Promise<void> {
		const application = this.client.application;
		if (!application) throw new Error("application indisponible : appeler après `clientReady`");

		if (this.config.portee === "globale") {
			await application.commands.set([DEFINITION_IETV]);
			for (const [, guilde] of this.client.guilds.cache) {
				// Idempotent : sans commande de guilde, c'est un appel à vide.
				await application.commands.set([], guilde.id);
			}
			this.journaliser(`${ICONES.succes} /${DEFINITION_IETV.name} publiée globalement (propagation : quelques minutes)`);
			return;
		}

		// Intersection entre les guildes VOULUES et celles réellement rejointes :
		// l'API refuse une guilde inconnue, et l'échec priverait AUSSI les autres
		// de leurs commandes.
		const rejointes = this.config.guildes.filter((id) => this.client.guilds.cache.has(id));
		const absentes = this.config.guildes.filter((id) => !this.client.guilds.cache.has(id));
		if (absentes.length > 0) {
			this.journaliser(
				`${ICONES.attention} guilde(s) configurée(s) mais non rejointe(s) : ${absentes.join(", ")} — ` +
					"invitation manquante, ou scope `applications.commands` oublié dans l'URL"
			);
		}

		for (const guilde of rejointes) {
			await application.commands.set([DEFINITION_IETV], guilde);
		}
		this.journaliser(`${ICONES.succes} /${DEFINITION_IETV.name} publiée sur ${rejointes.length} serveur(s)`);
	}

	/**
	 * Un membre a choisi un épisode dans le menu d'un fil.
	 *
	 * Réponse ÉPHÉMÈRE : le lecteur n'apparaît que pour lui. Une réponse
	 * publique remplirait le fil d'un message par visionnage et noierait la
	 * liste que le fil est censé porter.
	 */
	private async traiterMenu(interaction: Interaction): Promise<void> {
		if (!interaction.isStringSelectMenu()) return;
		if (!interaction.customId.startsWith(`${PREFIXE_MENU}:`)) return;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const choix = lireValeurOption(interaction.values[0] ?? "");
		if (!choix) {
			await interaction.editReply({ content: "Sélection illisible — réessaie." });
			return;
		}

		const reponse = await executerIetv(
			"episode",
			{ chaine: () => null, entier: (nom) => (nom === "saison" ? choix.saison : nom === "numero" ? choix.numero : null) },
			{
				catalogue: this.catalogue,
				marque: this.config.marque,
				estStaff: false,
			}
		);

		await interaction.editReply({ embeds: reponse.embeds, content: reponse.contenu ?? "" });
	}

	private async traiterInteraction(interaction: Interaction): Promise<void> {
		if (interaction.isStringSelectMenu()) {
			await this.traiterMenu(interaction);
			return;
		}
		if (!interaction.isChatInputCommand()) return;
		if (interaction.commandName !== DEFINITION_IETV.name) return;

		const sousCommande = interaction.options.getSubcommand();

		// Discord n'accorde que trois secondes au premier accusé de réception :
		// on diffère AVANT toute lecture, même celle du cache. La VISIBILITÉ se
		// fige ici et nulle part ailleurs — `editReply` ne peut plus rendre
		// éphémère une réponse différée publiquement.
		await interaction.deferReply({ flags: reponsePrivee(sousCommande) ? MessageFlags.Ephemeral : undefined });

		let reponse: Reponse;
		try {
			reponse = await executerIetv(
				sousCommande,
				optionsDeLInteraction(interaction),
				{
					catalogue: this.catalogue,
					marque: this.config.marque,
					estStaff: estStaff(
						rolesDeLInteraction(interaction),
						this.config.rolesStaff,
						estAdministrateur(interaction)
					),
				}
			);
		} catch (err) {
			this.journaliser(
				`${ICONES.echec} /${DEFINITION_IETV.name} a levé : ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
			);
			reponse = {
				embeds: [
					fiche({ titre: `${ICONES.echec} Erreur interne`, intention: "echec", marque: this.config.marque })
						.description("La commande a échoué. Le catalogue n'a pas été modifié ; réessaie dans un instant.")
						.finir(),
				],
				prive: true,
			};
		}

		await interaction.editReply({
			embeds: reponse.embeds,
			// `content` vide explicitement : sans lui, discord.js laisse en place
			// le contenu d'une réponse précédente sur la même interaction.
			content: reponse.contenu ?? "",
		});
	}

	/**
	 * Passerelle forum branchée sur discord.js.
	 *
	 * Les étiquettes du salon sont lues à CHAQUE synchronisation : elles se
	 * modifient depuis le client Discord, et une table figée au démarrage
	 * poserait des identifiants d'étiquettes supprimées — ce que l'API refuse.
	 */
	private async passerelleForum(salonId: string): Promise<{
		passerelle: PasserelleForum;
		etiquettes: Record<string, string>;
	}> {
		const salon = await this.client.channels.fetch(salonId);
		if (!salon || salon.type !== ChannelType.GuildForum) {
			throw new Error(
				`le salon ${salonId} n'est pas un forum — WONDERBOT_FORUM_CHANNEL_ID doit désigner un salon de type forum`
			);
		}

		const etiquettes = Object.fromEntries(
			salon.availableTags.map((tag) => [tag.name.toLowerCase(), tag.id])
		);

		const passerelle: PasserelleForum = {
			filsExistants: async () => {
				// Actifs ET archivés : Discord archive les fils inactifs, et un fil
				// archivé existe toujours — le recréer ferait un doublon.
				const actifs = await salon.threads.fetchActive();
				const archives = await salon.threads.fetchArchived({ type: "public", limit: 100 });
				return [...actifs.threads.keys(), ...archives.threads.keys()];
			},
			creerFil: async (nom, embeds, menus, tags) => {
				const fil = await salon.threads.create({
					name: nom,
					message: { embeds, components: rangeesDeMenus(menus) },
					appliedTags: tags,
				});
				return fil.id;
			},
			majFil: async (filId, nom, embeds, menus, tags) => {
				const fil = await salon.threads.fetch(filId);
				if (!fil) return;
				// Un fil archivé doit être rouvert avant d'être modifié.
				if (fil.archived) await fil.setArchived(false);
				if (fil.name !== nom) await fil.setName(nom);
				await fil.setAppliedTags(tags);
				// Le message d'ouverture porte l'identifiant du fil : on le MODIFIE
				// au lieu de republier, pour ne pas noyer les réponses des membres.
				const ouverture = await fil.fetchStarterMessage().catch(() => null);
				await ouverture?.edit({ embeds, components: rangeesDeMenus(menus) });
			},
		};

		return { passerelle, etiquettes };
	}

	/** Met le forum en accord avec le catalogue, si un forum est configuré. */
	private async synchroniserForum(): Promise<void> {
		if (!this.config.salonForum) return;
		try {
			const { passerelle, etiquettes } = await this.passerelleForum(this.config.salonForum);
			this.forum = new SynchronisationForum({
				catalogue: this.catalogue,
				passerelle,
				stockage: this.catalogue,
				marque: this.config.marque,
				etiquettes,
				lacunesConfirmees: this.reparateur.confirmes(),
			});
			const r = await this.forum.synchroniser();
			const total = r.crees.length + r.majs.length + r.recrees.length;
			if (total > 0) {
				this.journaliser(
					`${ICONES.saison} forum synchronisé — ${r.crees.length} fil(s) créé(s), ` +
						`${r.majs.length} mis à jour${r.recrees.length > 0 ? `, ${r.recrees.length} recréé(s)` : ""}`
				);
			}
		} catch (err) {
			// Un forum indisponible ne doit pas faire échouer le rafraîchissement :
			// les commandes, elles, répondent toujours.
			this.journaliser(
				`${ICONES.attention} synchronisation du forum impossible : ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	/**
	 * Rafraîchit au démarrage SI le catalogue est vide ou périmé.
	 *
	 * Le « si » est tout l'intérêt : rescraper à chaque `systemctl restart`
	 * coûterait plusieurs minutes de navigateur pour rien, et un redémarrage en
	 * boucle martèlerait les sources. À l'inverse, ne jamais rafraîchir au
	 * démarrage laisse un catalogue périmé jusqu'à six heures.
	 */
	private async rafraichirSiPerime(): Promise<void> {
		if (!this.config.rafraichirAuDemarrage) return;

		const resume = this.catalogue.resume();
		const dernier = resume.dernierRafraichissement;
		const age = Date.now() - dernier;

		// Le compte d'épisodes prime sur l'horodatage : un rafraîchissement qui
		// s'est terminé sans rien ramener pose quand même sa date, et sans cette
		// condition un catalogue VIDE serait considéré « à jour » pendant six
		// heures. Observé en production dès le premier démarrage.
		const vide = resume.stats.episodes === 0;
		if (!vide && dernier > 0 && age < this.config.intervalleRafraichissementMs) {
			this.journaliser(
				`${ICONES.horloge} catalogue à jour (${Math.round(age / 60_000)} min) — pas de rafraîchissement au démarrage`
			);
			return;
		}

		this.journaliser(
			`${ICONES.rafraichir} catalogue ${vide ? "vide" : "périmé"} — rafraîchissement au démarrage`
		);
		try {
			const resultat = await this.planificateur.declencher();
			await this.apresRafraichissement(resultat);
		} catch (err) {
			this.journaliser(
				`${ICONES.attention} rafraîchissement de démarrage échoué : ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	/**
	 * Cherche les épisodes manquants au milieu d'une saison et programme une
	 * tentative de rattrapage.
	 *
	 * Un seul rattrapage en vol à la fois, et seulement pour des trous qui ont
	 * encore des tentatives : sans ces deux bornes, un catalogue durablement
	 * incomplet relancerait un scraping toutes les quinze minutes, pour
	 * toujours.
	 */
	private planifierReparation(): void {
		if (this.config.tentativesReparation <= 0) return;

		const lacunes = detecterLacunes(this.catalogue.parSaison());
		if (lacunes.length === 0) return;

		const decision = this.reparateur.evaluer(lacunes);

		if (decision.confirmes.length > 0) {
			this.journaliser(
				`${ICONES.attention} ${decision.confirmes.length} épisode(s) introuvable(s) après ` +
					`${this.config.tentativesReparation} tentative(s) : ${lacunes.map(decrireLacune).join(" · ")}`
			);
		}
		if (!decision.retenter) return;

		if (this.reparationEnAttente !== null) {
			this.journaliser(`${ICONES.horloge} réparation déjà programmée — celle-ci est ignorée`);
			return;
		}

		this.journaliser(
			`${ICONES.rafraichir} ${decision.nouveaux.length} trou(s) détecté(s) — nouvelle tentative dans ` +
				`${Math.round(this.config.delaiReparationMs / 60_000)} min : ${lacunes.map(decrireLacune).join(" · ")}`
		);

		this.reparationEnAttente = setTimeout(() => {
			this.reparationEnAttente = null;
			void this.planificateur
				.declencher()
				.then((resultat) => this.apresRafraichissement(resultat))
				.catch((err) =>
					this.journaliser(
						`${ICONES.attention} tentative de réparation échouée : ${err instanceof Error ? err.message : String(err)}`
					)
				);
		}, this.config.delaiReparationMs);
		// Le minuteur ne doit pas retenir le processus au moment de l'arrêt.
		this.reparationEnAttente.unref?.();
	}

	/** Publie les nouveautés après un rafraîchissement réussi. */
	private async apresRafraichissement(resultat: ResultatRafraichissement): Promise<void> {
		this.journaliser(
			`${ICONES.succes} catalogue rafraîchi — ${resultat.stats.episodes} épisode(s), ` +
				`${resultat.sources} source(s), ${(resultat.dureeMs / 1000).toFixed(1)} s`
		);

		this.planifierReparation();
		await this.synchroniserForum();

		if (!this.config.salonAnnonces) return;

		const catalogueComplet = this.catalogue.rechercher({ limite: 20_000 });
		const decision = this.journal.traiter(catalogueComplet, this.config.plafondAnnonces);

		if (decision.amorcage) {
			this.journaliser(
				`${ICONES.horloge} journal d'annonces amorcé sur ${catalogueComplet.length} épisode(s) — ` +
					"aucun rattrapage, la première annonce portera sur une nouveauté à venir"
			);
			return;
		}
		if (decision.aAnnoncer.length === 0) return;

		await this.annoncer(decision.aAnnoncer, decision.omis);
	}

	private async annoncer(episodes: ReturnType<Catalogue["rechercher"]>, omis: number): Promise<void> {
		const salon = await this.client.channels.fetch(this.config.salonAnnonces!).catch(() => null);
		if (!salon || !salon.isSendable()) {
			this.journaliser(
				`${ICONES.echec} salon d'annonces ${this.config.salonAnnonces} injoignable ou interdit à l'écriture — ` +
					"vérifier « Voir le salon », « Envoyer des messages » et « Intégrer des liens » sur le salon lui-même"
			);
			return;
		}

		const liste = listerEpisodes(episodes, { limite: episodes.length });
		const embed = fiche({
			titre: `${ICONES.nouveau} ${episodes.length} nouvel(s) épisode(s) au catalogue`,
			marque: this.config.marque,
		})
			.description(liste.texte)
			.finir(omis > 0 ? `${omis} autre(s) non listé(s)` : undefined);

		await (salon as SendableChannels).send({
			...(this.config.roleAnnonces ? { content: `<@&${this.config.roleAnnonces}>` } : {}),
			embeds: [embed],
			allowedMentions: this.config.roleAnnonces ? { roles: [this.config.roleAnnonces] } : { parse: [] },
		});
		this.journaliser(`${ICONES.nouveau} ${episodes.length} nouveauté(s) annoncée(s)`);
	}

	/** Coupe la boucle, ferme la passerelle et la base. */
	async arreter(): Promise<void> {
		if (this.reparationEnAttente !== null) {
			clearTimeout(this.reparationEnAttente);
			this.reparationEnAttente = null;
		}
		this.planificateur.arreter();
		await this.client.destroy();
		this.catalogue.fermer();
	}
}

/**
 * @aphrody/wonderbot — Wonderbot, le bot Discord du catalogue d'épisodes.
 *
 * Le bot lit le catalogue depuis le cache SQLite de `@aphrody/ietv` et le
 * rafraîchit lui-même : aucun serveur HTTP intermédiaire, aucune dépendance à
 * un démon tiers. Tout ce qui n'est pas la passerelle Discord (`bot.ts`) est
 * testable sans jeton, sans réseau et sans base.
 */

export {
	Wonderbot,
	estAdministrateur,
	estStaff,
	optionsDeLInteraction,
	rolesDeLInteraction,
	type OptionsBot,
} from "./bot.ts";

export {
	Catalogue,
	CLE_DERNIER_RAFRAICHISSEMENT,
	catalogueReel,
	type CacheLike,
	type FiltresRecherche,
	type OptionsCatalogue,
	type ResultatRafraichissement,
	type ResumeCatalogue,
	type ScraperLike,
} from "./catalogue.ts";

export {
	CLE_JOURNAL,
	JournalAnnonces,
	analyserJournal,
	diffNouveaux,
	type DecisionAnnonce,
	type StockageJournal,
} from "./annonces.ts";

export {
	cheminCacheParDefaut,
	lireConfig,
	lireEntier,
	lireFlocons,
	resumerConfig,
	type ConfigWonderbot,
	type EnvLisible,
	type PorteeCommandes,
} from "./config.ts";

export {
	DEFINITION_IETV,
	dateLisible,
	estLisibleEnLigne,
	executerIetv,
	optionsDepuisObjet,
	reponsePrivee,
	type ContexteCommande,
	type OptionsCommande,
} from "./commands/ietv.ts";

export {
	CLE_LACUNES,
	Reparateur,
	decrireLacune,
	detecterLacunes,
	empreinte,
	empreintes,
	lacunesDeSaison,
	type DecisionReparation,
	type LacuneSaison,
	type OptionsReparateur,
	type StockageLacunes,
} from "./lacunes.ts";

export {
	CLE_FILS,
	PREFIXE_MENU,
	lireValeurOption,
	menusDeSaison,
	valeurOption,
	type MenuEpisodes,
	SynchronisationForum,
	analyserTableFils,
	etiquettesDeSaison,
	nomFilSaison,
	type OptionsForum,
	type PasserelleForum,
	type ResultatSynchronisation,
	type StockageFils,
} from "./forum.ts";

export {
	Planificateur,
	type EtatPlanificateur,
	type OptionsPlanificateur,
} from "./planificateur.ts";

export * from "./ui/index.ts";

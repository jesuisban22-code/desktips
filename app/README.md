# Bureau

Regarde Claude Code travailler, dans un atelier isométrique en 3D.

Bureau ne parle **jamais** à l'API Claude. Il lit les transcriptions que Claude Code
écrit déjà sur le disque, dans `~/.claude/projects/<projet>/<session>.jsonl`.
Coût en tokens : **zéro**.

---

## Dans la pièce

| Ce que tu vois | Ce que ça veut dire |
|---|---|
| Un personnage va à un meuble | l'outil qu'il utilise : classeur = lecture, table à dessin = écriture, établi = commande, bibliothèque = web, porte = sous-agent |
| La bulle au-dessus de sa tête | ce qu'il fait **dans la pièce**, en mots : `📂 Read · watch.rs ×11` |
| Il sort de son poste, se tourne vers toi et **lève la main** | Claude attend ton autorisation ou te pose une question. La bannière en haut dit laquelle, la barre des tâches clignote |
| L'ardoise près de la porte | ta dernière demande, et sous elle la liste de tâches de Claude, ou le bilan depuis ta demande (fichiers lus, écrits, commandes) |
| Le terminal sur l'établi | les dernières commandes lancées (`$ npm test`, `PS> Get-ChildItem`, `> outil MCP`), avec le curseur qui clignote |
| La feuille sur la table à dessin | elle se remplit trait après trait à chaque fichier écrit ; à ta demande suivante, elle rejoint la pile des feuilles terminées au pied de la table |
| Le tiroir du classeur | il s'ouvre pendant qu'on y fouille (lectures, recherches) et se referme ensuite |
| Le voyant au-dessus de la porte | rouge quelques secondes après une erreur, ambre tant que Claude attend ta réponse |
| Il sursaute et se gratte la tête / il hoche la tête | un outil vient d'échouer (la bulle dit lequel) / tu viens d'envoyer une demande |
| Au repos | il cligne des yeux, respire, s'étire, regarde autour de lui, croise les bras — de moins en moins souvent si rien ne se passe |
| La lumière | elle suit l'heure réelle : soleil rasant l'après-midi, lampes qui prennent le relais le soir, ville allumée et étoiles la nuit. L'horloge murale est à l'heure |

Les personnages viennent du modèle sculpté `modeles/atelier-personnage.obj`
(doigts, yeux, paupières, montre, poche avec crayon, lacets). Il est figé
assis en train d'écrire ; `node scripts/retarget-personnage.mjs` le découpe
et range chaque pièce sur l'articulation qui la porte, aux longueurs du
squelette de l'app, pour qu'il marche, s'asseye, tende le bras et cligne des
yeux comme avant. À relancer si le modèle change (il écrit
`src/three/personnage.gen.ts`).

Chaque agent a sa coiffure et son accessoire (lunettes, casque, crayon à
l'oreille), pour qu'on les distingue d'un coup d'œil quand ils sont plusieurs.

- **Clique un personnage** (ou son badge en haut) : la caméra le suit et sa fiche
  s'ouvre — ce qu'il fait, ses outils les plus utilisés, ses derniers gestes.
- **Clique l'ardoise** (ou le panneau « Demande ») : la caméra s'approche assez
  pour la lire.
- **Échap**, ou un clic dans le vide : retour à la pièce entière.
- **Mode widget** (bouton `⧉ widget`, ou le menu de l'icône dans la barre des
  tâches) : une petite fenêtre sans bordure, toujours au premier plan, dans le
  coin de l'écran. Elle se déplace par sa barre du haut et revient où tu l'as
  laissée.
- **Paramètres** (bouton en haut à droite) : afficher ou masquer chaque
  panneau (demande, journal, frise, compteurs, bulles), regrouper les étapes
  répétées du journal, heure de la lumière (réelle, fixe, journée en 90 s),
  effets et qualité des ombres, lancement avec Windows et ouverture avec
  Claude Code. Les choix sont gardés d'un lancement à l'autre ; les
  paramètres d'URL (`?fx=0`, `?q=low`, `?hour=`) restent prioritaires.

La pièce n'est redessinée que quand quelque chose bouge : à la fréquence de
l'écran quand les personnages marchent ou travaillent (60 images/s mesurées
dans l'application installée), 12 au repos, 4 après une minute sans rien. Un
clignement ou un étirement demande des images fluides (30 par seconde) le temps
qu'il dure, sans relancer cette cadence : sinon un personnage qui attend tout
l'après-midi garderait la pièce à 12 images/s pour rien. Les gestes au repos
s'espacent d'ailleurs à mesure que le calme dure.

L'alerte « autorisation » vient du déclencheur Claude Code (voir `hook/`) :
la transcription n'écrit rien pendant qu'une boîte de dialogue attend. Les
questions (`AskUserQuestion`) se voient sans lui.

---

## Installer

Double-clique sur **`installeur.bat`** (dans le dossier au-dessus de `app\`) :
il vérifie les outils, lance les tests du moteur sur tes vrais fichiers,
construit l'application et son installeur, puis propose d'enregistrer le
déclencheur Claude Code. Ensuite, **`lancer.bat`** ouvre Bureau.

### Mettre à jour

Menu de l'icône dans la barre des tâches → **« Rechercher une mise à jour »**
(ou Paramètres → Mise à jour). Bureau demande à GitHub la dernière Release du
dépôt écrit dans `app/depot-github.txt` et compare son tag à sa propre
version. S'il y a plus récent, il montre la version et ses notes, et demande
**Confirmer / Annuler**. En confirmant, une fenêtre « Bureau - mise à jour »
télécharge l'installeur de la Release, ferme Bureau, installe et relance.
Seul un fichier des Releases de ce dépôt est accepté.

**Publier une version** : le workflow `.github/workflows/publier.yml`
construit l'installeur Windows et crée la Release à chaque tag `vX.Y.Z`.

```bash
node app/scripts/version.mjs 0.2.0
git commit -am "Bureau 0.2.0"
git tag v0.2.0
git push --follow-tags
```

### S'ouvrir tout seul, ou avec `/desktips`

Le déclencheur (`hook/installer-hook.ps1`) s'inscrit sur trois événements de
Claude Code : la demande d'autorisation, les notifications, et le **début de
session**. À chaque nouvelle session, Bureau s'ouvre donc de lui-même en
widget, dans le coin de l'écran, sans prendre le focus. S'il est déjà ouvert,
il ne se passe rien ; les sessions lancées par le SDK sont ignorées.

- Pour ne plus l'ouvrir automatiquement : menu de l'icône dans la barre des
  tâches → décocher **« S'ouvrir avec Claude Code (en widget) »** (cela crée
  `~/.bureau/autoopen.off`).
- Dans Claude Code, **`/desktips`** ouvre Bureau ou le ramène en widget, et
  **`/desktips grand`** l'ouvre en grande fenêtre. Le skill est installé dans
  `~/.claude/skills/desktips/SKILL.md` avec le déclencheur, et retiré par
  `retirer-declencheur.bat`.
- En ligne de commande : `bureau-hook.exe --open` (widget) ou
  `bureau-hook.exe --open grand`.

Une seule instance tourne à la fois : un second lancement ne fait que réveiller
la première (et lui dire de passer en widget ou en grand).

---

## Démarrer

### Prérequis (Windows)

| Ce qu'il faut | Vérifier | Si absent |
|---|---|---|
| Rust (MSVC) | `rustc --version` | https://rustup.rs |
| Microsoft C++ Build Tools | — | Visual Studio Installer → « Desktop development with C++ » |
| Node.js 18+ | `node --version` | https://nodejs.org |
| WebView2 | déjà là sur Windows 11 | https://developer.microsoft.com/microsoft-edge/webview2/ |

### Construire le `.exe`

Double-clique sur **`installeur.bat`**, ou en ligne de commande :

```bat
npm install
npm run tauri build
```

L'installeur sort dans :

```
src-tauri\target\release\bundle\nsis\Bureau_0.1.0_x64-setup.exe
src-tauri\target\release\bundle\msi\Bureau_0.1.0_x64_en-US.msi
```

Et l'exécutable seul (sans installeur) dans `src-tauri\target\release\bureau.exe`.

Le premier build compile tout Rust et prend 5 à 15 minutes. Les suivants sont rapides.

Les icônes sont générées et valides (`.ico` multi-résolutions à 7 tailles).
Pour les régénérer depuis `src-tauri/icons/icon.png` :

```bat
npx tauri icon src-tauri/icons/icon.png
```

### Développer

```bat
npm install
npm run tauri dev
```

Ou juste le front, dans un navigateur, sans Rust :

```bat
npm install
npx vite
```

Hors de Tauri, l'app rejoue un flux d'événements synthétique qui reproduit la
forme des rafales mesurées sur une vraie session — c'est ce qui permet de
tester l'animation sans lancer Claude Code.

---

## Paramètres d'URL

Utiles en dev et pour les captures automatisées.

| Paramètre | Effet |
|---|---|
| `?fx=0` | coupe le post-traitement (AO, bloom) — utile sur GPU faible |
| `?q=low` | ombres en basse résolution |
| `?debug=chars` | banc d'essai des personnages : toutes les poses, debout et assis |
| `?debug=chars&view=close` | gros plan sur trois figures |
| `?debug=1` | expose l'état des acteurs sur `window.__bureau`, le store sur `window.__bureauStore()`, un injecteur d'événements sur `window.__bureauIngest(evt)` et le nombre d'images dessinées sur `window.__frames` |
| `?replay=<url>` | rejoue une session enregistrée au lieu du flux simulé |
| `?mock=0` | pas de flux simulé : une pièce vide, pilotée par ce qu'on injecte |
| `?batch=0` | ne fusionne pas les meubles (pour comparer, ou déboguer un meuble) |
| `?audit=1` | expose la scène, le moteur de rendu et la caméra (`__scene`, `__gl`, `__camera`) |
| `?hour=23` | fixe l'heure de la lumière (de 0 à 24, décimales acceptées) au lieu de l'heure réelle |
| `?hour=cycle` | fait défiler une journée entière en 90 secondes |

Avec `?debug=1`, `window.__look(x, y, z, zoom)` braque la caméra sur un point
de la pièce (gros plan sur un meuble, par exemple), et `window.__workshop`
montre l'état de l'atelier (commandes du terminal, feuilles, tiroir).

---

## Quelles IA Bureau regarde

Pas seulement Claude Code. Au démarrage il cherche les dossiers suivants et
surveille ceux qui existent :

| Assistant | Emplacement | Format | État |
|---|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | JSONL Anthropic | **vérifié** sur données réelles |
| Cowork | *même dossier, même format* | JSONL Anthropic | **vérifié** sur données réelles |
| Codex | `~/.codex/sessions/AAAA/MM/JJ/rollout-*.jsonl` | items OpenAI | chemin vérifié, schéma déduit |
| Copilot CLI | `~/.copilot/session-state/<id>/events.jsonl` | JSONL | chemin vérifié, schéma déduit |
| Cursor | `~/.cursor/projects/**/agent-transcripts/**.jsonl` | JSONL | chemin vérifié, schéma déduit |
| Gemini CLI | `~/.gemini/tmp/<hash>/chats/` | JSONL | chemin vérifié, schéma déduit |
| Cline | `~/.cline/**` | JSONL | chemin vérifié, schéma déduit |

`CLAUDE_CONFIG_DIR` et `CODEX_HOME` sont respectés.

Chaque assistant a sa couleur de chemise et son poste de travail, donc quand
Claude et Codex travaillent en même temps on les distingue avant même de lire
une étiquette. Bureau suit **une session par assistant** : Claude qui change de
conversation ne chasse pas Codex de la pièce.

### Pourquoi un renifleur de formes plutôt qu'un parser par outil

Les chemins ci-dessus sont publiés et concrets. Les **schémas** ne le sont pas :
chaque outil écrit son propre JSON, plusieurs l'ont changé entre deux versions,
et je n'ai pu tester que celui de Claude sur de vraies données.

Un parser rigide par outil, écrit d'après une documentation que je ne peux pas
vérifier, casse silencieusement dès que le format bouge — et pire, il peut
inventer des événements qui n'ont pas eu lieu. Donc le parser cherche la
*forme* d'un événement où qu'elle se trouve dans la ligne : quelque part il y a
un discriminant qui nomme ce qui s'est passé, et pour un appel d'outil, un
voisin qui porte son nom. Codex le niche sous `payload`, Copilot sous `event`,
d'autres le mettent à plat — la recherche est donc récursive et bornée en
profondeur, pas positionnelle.

Quand rien ne correspond, la ligne devient `Unknown` et disparaît. Un outil dont
le format a évolué affiche donc moins de types d'événements. Il ne plante pas,
et il n'invente rien.

Ajouter un assistant, c'est une entrée dans `src-tauri/src/sources.rs`.

---

## Ce que Bureau regarde exactement

Claude Code écrit chaque session dans `~/.claude/projects/<projet>/<session>.jsonl`.
Les **sous-agents** n'écrivent pas dans ce fichier : ils ont le leur, plusieurs
niveaux plus bas, sous `<session>/subagents/workflows/<run>/agent-*.jsonl`. Et
ils partagent le `sessionId` du parent — leur identité propre est dans un champ
`agentId`. Les deux points ont coûté des bugs : un scan à un seul niveau ne
voyait aucun sous-agent, et les clefer par session les aurait tous fondus en
une seule figure.

Bureau suit **une** session à la fois, celle dont l'activité est la plus
récente. Comme les sous-agents partagent le `sessionId` de leur parent, une
exécution reste groupée, mais une seconde fenêtre Claude Code ne vient pas
mélanger ses agents dans la même pièce. Le badge en haut dit laquelle est
suivie, et combien d'événements ont été écartés.

Au démarrage, seuls les fichiers modifiés dans les six dernières heures sont
rejoués, 80 lignes chacun. Les sessions plus vieilles sont de l'histoire, pas
de l'activité : les rejouer enterrait sous 1600 événements d'archive ce que
l'utilisateur venait réellement de faire.

Le watcher démarre dans le `setup()` de Tauri, bien avant que la fenêtre
n'existe. Tout ce qu'il émettait avant que le front n'attache son écouteur
était simplement perdu — la pièce s'ouvrait vide même en pleine session. Les
événements sont donc mis en attente jusqu'à ce que le front appelle
`frontend_ready`.

---

## Architecture

Le code Rust est coupé en deux, et la ligne de coupe est la seule qui compte :

```
src-tauri/
  core/                  bureau-core — AUCUNE dépendance Tauri
    src/sources.rs       où chaque assistant range ses conversations
    src/evt.rs           une ligne JSONL → un événement normalisé
    src/watch.rs         repérage, relecture de la queue, surveillance
    src/bridge.rs        tampon jusqu'à ce que la fenêtre écoute
    src/solo.rs          une seule instance : la seconde réveille la première
                         (et lui dit : montre-toi, passe en widget, en grand)
    src/launch.rs        ouverture au début d'une session, réglage on/off
    src/bin/bureau-scan  diagnostic en ligne de commande
    src/bin/bureau-hook  le déclencheur : autorisation, notification, début de
                         session ; et `--open` pour /desktips
    tests/engine.rs      32 tests, dont certains sur tes vraies transcriptions
  src/
    lib.rs               la coquille Tauri : fenêtre, barre des tâches, pont
    tray.rs              menu de la barre des tâches (dont « Mode widget »)
```

Pourquoi ce découpage : la coquille Tauri ne se compile que sur une machine
équipée d'un moteur de rendu web. Tant que la logique vivait dedans, elle
n'était vérifiée que par le build Windows — et un appel qui passait un
`PathBuf` là où un `&Source` était attendu y dormait tranquillement. `cargo
test -p bureau-core` tourne partout. Il reste 186 lignes couplées à Tauri,
contre 1140 lignes testées.

```
src/
  store.ts               une session suivie par assistant, agents, événements,
                         demande en cours, tâches, attente, sélection
  anim/queue.ts          file par agent : fusion de rafales, rattrapage élastique
  anim/useActor.ts       machine à états ; écrit dans Object3D et dans la bulle ;
                         visage (clignements, sourcils, bouche), gestes au repos
  anim/motion.ts         les poses : marche, travail par meuble, réactions
  anim/workshop.ts       ce que le travail laisse dans la pièce (commandes,
                         traits dessinés, feuilles finies, tiroir, dernière erreur)
  anim/activity.ts       qui bouge : décide quand la pièce est redessinée
  anim/nav.ts            grille d'occupation + A* + lissage de trajectoire
  components/            la pièce, les meubles, les personnages, le HUD
    StaticBatch.tsx      soude 615 pièces de meubles en 64 maillages, et la porte
                         et le tiroir dans leur propre repère (ils bougent) :
                         2 432 appels de dessin par rendu au départ, 602 après
    Workshop.tsx         terminal, feuille à dessin et pile, voyant, horloge, vapeur
    Dust.tsx             la poussière dans les rayons de soleil
    FrameDriver.tsx      rendu à la demande, ombres redessinées seulement si ça bouge
    CameraRig.tsx        cadrage, suivi d'un personnage, gros plan sur l'ardoise
    Slate.tsx            l'ardoise : texture à la craie redessinée à chaque demande
  ui/widget.ts           la petite fenêtre toujours au premier plan
  three/                 kit géométrique, matériaux, textures procédurales
    daylight.ts          la lumière selon l'heure (soleil, ciel, lampes, ville)
```

---

## Quand la pièce reste vide

Elle le dit maintenant, au lieu de rester vide en silence : la fenêtre affiche
quels assistants ont été trouvés, **dans quels dossiers Bureau a cherché**, et
combien de conversations il y a vu. Sans les chemins, « aucun assistant
détecté » est inexploitable.

En ligne de commande, `bureau-scan.exe` donne la même chose :

```
bureau-scan                        quels assistants, quels dossiers, combien de fichiers
bureau-scan --events               et les événements que ça produit
bureau-scan --path <dossier>       lire un arbre de transcriptions précis
bureau-scan --json sortie.json     tout exporter (voir « Vérification »)
```

---

## Trois décisions qui portent le reste

**Rien n'est une boîte brute.** Chaque solide passe par `chamfer()` ou
`turned()`. Un chanfrein, c'est ce qui accroche la lumière et transforme un cube
en objet. La première version était faite de `BoxGeometry` nus et se lisait
comme de l'art de programmeur.

**Chaque pièce du corps chevauche sa voisine.** Un interstice entre deux
parties du corps se lit instantanément comme « pas un corps ». Le chevauchement
est ce qui fait que des maillages séparés se lisent comme une seule figure.

**L'animation vit hors de React.** La file d'attente change au rythme des
événements, elle est lue au rythme des images. La faire passer par du state
re-rendrait le graphe de scène des dizaines de fois par seconde pour rien.

---

## Le problème de cadence

Claude Code émet ses appels d'outils par rafales : pic mesuré à 13 événements
par seconde sur une vraie session, alors qu'un aller-retour « marcher jusqu'au
classeur, fouiller, revenir » prend 3 à 4 secondes à jouer. Animer un temps par
événement met la pièce en retard de plusieurs minutes en quelques secondes, et
elle ne rattrape jamais.

Trois mécanismes, dans l'ordre où ils s'appliquent :

1. **Fusion des rafales** — des événements consécutifs qui visent le même meuble
   deviennent un seul temps avec un compteur. Onze `Read` d'affilée deviennent
   *un* trajet au classeur avec onze dossiers : moins cher, et plus honnête que
   onze trajets identiques.

2. **Rattrapage élastique** — la vitesse de lecture suit la profondeur de file,
   jusqu'à ×3. Un agent en retard se dépêche visiblement, ce qui se lit comme
   « occupé » plutôt que comme « cassé ».

3. **Repli dur** — au-delà d'un plafond, la queue replie sa fin sur elle-même
   quel que soit le meuble, pour qu'une rafale extrême dégénère en montage
   rapide plutôt qu'en backlog infini.

Le badge « retard 3.8s · 5 en file » dit la vérité. Quand les événements
dépassent l'animation, la pièce *est* en retard, et le dire vaut mieux que de
faire semblant que les figures sont à jour.

---

## Vérification

Un build vert ne prouve rien. Trois des bugs les plus coûteux de ce projet
passaient le typecheck et le compilateur sans broncher : `dt` plafonné à 1/20 s
qui faisait courir l'animation dix fois trop lentement, les résultats d'outils
lus sur les mauvaises lignes (donc aucun outil ne se terminait jamais), et deux
pièces de la table à dessin pivotées d'un quart de tour qui traversaient la
planche. Aucun n'était visible autrement qu'en exécutant.

```bash
cd src-tauri && cargo test -p bureau-core   # 42 tests, dont sur tes transcriptions
npx tsc --noEmit                            # types du front
node scripts/audit.mjs <url>                # géométrie : rien ne traverse rien
node scripts/pipe-e2e.mjs <url> <replay>    # une vraie session rejouée de bout en bout
node scripts/sheet.py <url> <objets>        # planche de rendus, objet par objet
```

**`cargo test`** couvre ce dont la pièce dépend : les résultats d'outils
arrivent sur les lignes `user` et non `assistant` ; un sous-agent garde son
`agentId` alors qu'il partage le `sessionId` de son parent ; un fichier tronqué
est relu au lieu de devenir muet ; une dernière ligne à moitié écrite est
laissée pour le prochain passage ; le tampon de démarrage est borné.

**`pipe-e2e`** rejoue une session enregistrée à travers le vrai chemin
d'ingestion, sans canvas. C'est délibéré : sous un moteur de rendu logiciel une
image prend plusieurs secondes, les minuteurs sont affamés, et un pipeline en
parfait état a l'air mort. Pour fabriquer le fichier :

```bash
src-tauri/target/release/bureau-scan --json public/replay.json
npx vite build && npx vite preview --port 4399
node scripts/pipe-e2e.mjs http://localhost:4399/ /replay.json
```

Dernier passage : 865 événements réels, 8 agents (1 principal + 7 sous-agents),
0 erreur.

**`audit.mjs`** lit le vrai graphe de scène three.js plutôt qu'une
transcription à la main, et ne signale que ce qui se voit : une pièce qui
traverse un panneau de part en part, une pièce qui ressort par la face utile
d'un plan, une pièce qui ne touche rien, une pièce ronde trop facettée.
L'assemblage normal — un tenon dans sa mortaise — est délibérément ignoré.

---

## État

Terminé et vérifié :

- lecture des transcriptions, pour Claude Code, Cowork, et cinq autres assistants
- sous-agents distingués les uns des autres, entrée et sortie par la porte
- file d'animation : fusion de rafales, rattrapage élastique, effondrement
- pièce en 3D : plus aucune intersection, tessellation calculée depuis le rayon
- état vide explicite : ce qui a été trouvé, et où Bureau a cherché
- bulles, fiche d'agent, suivi caméra, ardoise, alerte d'autorisation, mode
  widget : vérifiés dans l'application compilée et installée, pas seulement
  dans le navigateur (le personnage lève la main, le widget s'ouvre, se
  déplace par sa barre et revient à sa place)
- déclencheur Claude Code : lancé sans shell (`args: []`) et en arrière-plan
  (`async`) ; l'ancienne inscription échouait sur chaque appel d'outil
  (725 erreurs dans une seule session) et ne s'est jamais exécutée
- rendu à la demande et meubles fusionnés : 20 → 8,5 ms par rendu de la scène,
  12 images/s au repos au lieu de 60
- ouverture automatique au début d'une session Claude Code (en widget, sans
  prendre le focus) et `/desktips` / `/desktips grand` : vérifiés dans
  l'application installée, une seule instance
- atelier qui réagit au travail (terminal, feuille à dessin et pile, tiroir,
  voyant, horloge, vapeur), réactions à une erreur et à une demande, visages
  (clignements, sourcils, bouche), gestes au repos, accessoires, jour et nuit
  sur l'heure réelle : vérifiés dans le navigateur et dans l'application
  installée (captures prises par le protocole DevTools)
- performances après tous ces ajouts : 326 appels de dessin par rendu, autant
  qu'avant (la porte et le tiroir, qui bougent, sont soudés dans leur propre
  repère). Cadence mesurée dans l'application installée : 60 images/s en
  activité, ~13 au repos, 4 à 10 après une minute. Une mise à jour de la
  lumière toutes les 30 s relançait la cadence rapide et empêchait la pièce de
  jamais redescendre à 4 : corrigé
- 42 tests du moteur, audit géométrique, rejeu de bout en bout

Pas vérifié par une exécution, et honnêtement :

- **une vraie boîte d'autorisation** : le déclencheur est bien lancé par
  Claude Code lui-même (c'est lui qui ouvre Bureau au début de chaque
  session), et la chaîne alerte → moteur → pièce a été vérifiée dans
  l'application avec l'entrée exacte que Claude Code envoie. Mais une vraie
  boîte d'autorisation n'a pas pu être provoquée depuis une session en mode
  automatique.
- **les formats des assistants autres qu'Anthropic** : les chemins sont vérifiés
  d'après les dispositions publiées, les schémas ne le sont pas. Le parseur les
  renifle plutôt que de les supposer, donc un format qui a bougé donne moins
  d'événements — pas un crash, et pas une information fausse.

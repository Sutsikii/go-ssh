# gossh — présentation et guide

## Pourquoi

Administrer dix, cinquante ou deux cents serveurs avec `ssh` dans des fenêtres de terminal
séparées, c'est jongler entre les adresses, les clés, les mots de passe et les onglets, sans
jamais voir d'un coup d'œil lesquels vont mal. Les outils de supervision, eux, demandent
d'installer un agent sur chaque machine.

gossh réunit les deux dans une application de bureau :

- **l'inventaire** des serveurs, rangé en groupes, avec leurs accès ;
- **les terminaux**, autant que voulu, en onglets ou en mosaïque, avec la saisie diffusée à
  tous si besoin ;
- **l'état de la flotte en direct** — CPU, mémoire, disques, réseau — lu par la connexion SSH
  elle-même, sans rien installer ;
- **les commandes groupées** : une commande, cent serveurs, les sorties côte à côte.

Une seule connexion SSH par serveur sert aux terminaux, aux statistiques et aux commandes.

## Prise en main

### 1. Ajouter des serveurs

Le bouton **Ajouter** propose quatre façons :

| | |
|---|---|
| **Nouveau serveur** | le formulaire complet : nom, adresse, utilisateur, port, clé, mot de passe, groupe, rebond, tags, couleur, notes |
| **Ajout en lot** | coller une liste, un serveur par ligne : `root@10.0.1.12 web-prod-1`, `deploy@db.example.com:2222 db`… Ils vont dans le groupe affiché |
| **Importer ~/.ssh/config** | reprend chaque `Host` (sauf les motifs `*`), avec `HostName`, `User`, `Port`, `IdentityFile` et `ProxyJump` |
| **Importer un fichier** | un export gossh (`.json`) ou n'importe quel fichier au format `ssh_config` |

Les serveurs déjà présents (même utilisateur, adresse et port) sont ignorés.

Dans la palette (**Ctrl K**), taper `user@hôte:port` puis Entrée ajoute le serveur et ouvre son
formulaire.

### 2. Les accès

À la connexion, gossh essaie dans l'ordre :

1. la clé privée du serveur, si elle est renseignée (avec sa phrase de passe, si elle en a une) ;
2. sinon les clés par défaut de `~/.ssh` (`id_ed25519`, `id_ecdsa`, `id_rsa`) ;
3. les clés de l'agent SSH (le service *OpenSSH Authentication Agent* de Windows) ;
4. le mot de passe, s'il y en a un (aussi pour le *keyboard-interactive*).

Pour donner le même mot de passe à plusieurs serveurs : les sélectionner, clic droit,
**Définir le mot de passe…**.

Pour passer aux clés sur toute une flotte : **Commandes groupées** → **Copier ma clé** choisit
une clé publique de `~/.ssh` et l'ajoute (une seule fois) au `authorized_keys` de chaque serveur.

### 3. Les clés d'hôtes

À la première connexion, un serveur présente sa clé ; gossh affiche son empreinte et attend
l'accord. Avec beaucoup de nouveaux serveurs, le bandeau **Vérifier les clés** les montre toutes
et les approuve d'un coup. Si une clé connue **change**, gossh refuse de se connecter et le dit,
car c'est aussi ce que ferait une attaque de l'homme du milieu ; on peut la remplacer si le
changement est attendu (serveur réinstallé).

Les clés approuvées sont dans `%APPDATA%\gossh\known_hosts` ; celles de `~/.ssh/known_hosts`
sont reconnues aussi.

### 4. La vue d'ensemble

La page **Serveurs** montre la flotte (ou un groupe, les favoris, les récents) :

- en tête : combien sont en ligne, hors ligne, le CPU moyen, la mémoire utilisée, le disque le
  plus plein ;
- en **cartes** : état, jauges CPU / RAM / disque, courbe du CPU, uptime et latence ;
- en **liste** : un tableau triable par colonne (CPU, RAM, disque, charge…), pratique pour
  repérer le serveur qui chauffe parmi cent.

Clic : statistiques du serveur. Double-clic : terminal. Ctrl+clic, Maj+clic ou la case :
sélection. La barre de sélection ouvre les terminaux, lance une commande groupée, déplace vers
un groupe ; le clic droit donne toutes les actions.

### 5. Les statistiques

La page d'un serveur suit la présentation d'un outil de supervision : CPU (total, user,
system), mémoire et swap, charge 1/5/15 min, réseau reçu/envoyé, E/S disque, sur 5 min, 15 min
ou 1 h, avec la valeur exacte au survol. À côté : le système (OS, noyau, CPU, mémoire, démarrage),
les disques et leur remplissage, le réseau, la connexion et les autres serveurs du groupe.

Les valeurs viennent d'une seule commande shell par relevé, qui lit `/proc/stat`, `/proc/meminfo`,
`/proc/loadavg`, `/proc/net/dev`, `/proc/diskstats` et `df`. Il faut donc un serveur Linux ; les
autres restent utilisables pour les terminaux et les commandes. L'intervalle se règle dans les
paramètres (5 s par défaut), et une heure d'historique est gardée en mémoire. Un serveur
injoignable est réessayé de moins en moins souvent, jusqu'à toutes les 2 minutes.

Les statistiques se désactivent par serveur (formulaire, ou clic droit).

### 6. Les terminaux

- **Ctrl K** puis le nom du serveur, ou double-clic sur sa carte.
- Plusieurs serveurs sélectionnés → **Terminaux** : un onglet chacun, en **mosaïque**.
- **Diffuser la saisie** (icône d'antenne, Ctrl Maj B) : tout ce qui est tapé part dans tous les
  terminaux connectés. Un bandeau rouge le rappelle.
- Clic droit : copie la sélection, ou colle. Ctrl Maj F : recherche. Entrée après une
  déconnexion : reconnecte.
- Les onglets se réordonnent par glisser-déposer ; clic du milieu pour fermer.

### 7. Les commandes groupées

1. Choisir les serveurs (filtre, groupe, Tout / Aucun) — ou partir d'une sélection.
2. Écrire la commande, ou prendre une commande prête.
3. **Ctrl Entrée**.

Chaque serveur a sa sortie, son code de retour et sa durée ; les puces filtrent les réussites et
les échecs, **Relancer les échecs** rejoue sur ceux-là seulement. Les commandes destructrices
évidentes (`reboot`, `shutdown`, `rm -rf /`…) demandent confirmation. 16 serveurs travaillent en
même temps par défaut (réglable).

## Sécurité

- Les mots de passe et phrases de passe sont chiffrés avec **DPAPI** sous Windows : seul le
  compte Windows qui les a enregistrés, sur ce PC, peut les relire. Ailleurs, `servers.json`
  n'est lisible que par l'utilisateur (0600) ; préférer alors les clés et l'agent.
- L'export ne contient **aucun** mot de passe.
- Les clés d'hôtes sont toujours vérifiées ; aucune connexion à un serveur dont la clé n'est pas
  approuvée.
- L'interface ne peut appeler Go que depuis ses propres pages (règle de MyGo).

## Limites connues

- Pas encore de transfert de fichiers (SFTP), de redirection de ports ni de séparation d'un
  onglet en panneaux : voir les pistes dans [architecture.md](architecture.md#pistes).
- Statistiques Linux seulement ; historique en mémoire (perdu à la fermeture).

# Architecture

gossh suit le standard de xdll : une application [MyGo](https://github.com/egoist/mygo) en Go
pur (sans cgo), dont l'interface est une page web sans étape de build (HTML, CSS et JavaScript
classiques dans `web/`, embarqués dans l'exécutable), qui appelle Go par `window.mygo.call`.

```
┌──────────────────────────── fenêtre (WebView2) ────────────────────────────┐
│ web/  core.js · tabs.js · home.js · detail.js · term.js · bulk.js · …       │
│        │ mygo.call("Service.Method")   ▲ événement "status"   ▲ canaux        │
└────────┼───────────────────────────────┼──────────────────────┼─────────────┘
         ▼                               │                      │
   Servers  Terminals  Monitor  Bulk  App        (services liés, hub.go)
         │        │        │      │
         ▼        ▼        ▼      ▼
       Store ── Pool (une connexion SSH par serveur, keepalive, rebonds)
   servers.json      │  HostKeys (known_hosts)
   (DPAPI)           ▼
               golang.org/x/crypto/ssh ──► serveurs
```

## Go

| Fichier | Rôle |
|---|---|
| `main.go` | démarre l'app, lie les services, sert `web/` |
| `hub.go` | `Hub`, l'état partagé ; service **App** (paramètres, thème, import/export, dialogues) |
| `store.go` | l'inventaire (`servers.json`), service **Servers** (ajout, lot, groupes, tags, mots de passe) |
| `secret_windows.go` / `secret_other.go` | chiffrement DPAPI des mots de passe (via `x/sys/windows`) |
| `conn.go` | `Pool` : une connexion par serveur, partagée, avec keepalive et ProxyJump ; méthodes d'authentification ; `HostKeys` (vérification et approbation des clés) |
| `agent_windows.go` / `agent_other.go` | l'agent SSH : tube nommé `\\.\pipe\openssh-ssh-agent`, ou `SSH_AUTH_SOCK` |
| `term.go` | service **Terminals** : PTY + shell, flux de sortie, saisie, redimensionnement |
| `stats.go` | le script de relevé et l'analyse de `/proc` et `df` (fonctions pures, testées) |
| `monitor.go` | service **Monitor** : un relevé par serveur suivi, l'historique, l'événement `status` |
| `bulk.go` | service **Bulk** : une commande sur N serveurs, parallélisme borné, sorties par lignes |
| `sshconfig.go` | lecture de `~/.ssh/config` |
| `clipboard.go` | presse-papier (les terminaux copient et collent par Go) |
| `update.go` | mises à jour automatiques (plugin `updater`), réglages de la page Paramètres |
| `automate.go` | pilote de développement (`-tags gossh_automate`), absent des builds normaux |

### Connexions

`Pool.Client(ctx, id)` renvoie la connexion du serveur ou la crée ; les appels simultanés
attendent la même. Chaque connexion a un *keepalive* toutes les 20 s : une connexion morte est
oubliée, et la prochaine utilisation se reconnecte. Les terminaux, relevés et commandes sont des
*sessions* sur cette connexion. Modifier l'adresse, le port, l'utilisateur, la clé, le rebond ou
le mot de passe d'un serveur ferme sa connexion.

Pour un rebond, la connexion au serveur intermédiaire (elle-même dans le pool) ouvre un canal
`direct-tcpip` vers la cible, sur lequel la poignée de main SSH se fait.

### Clés d'hôtes

Le `HostKeyCallback` compare la clé au `known_hosts` de l'app et à `~/.ssh/known_hosts`. Une clé
inconnue ou changée donne une `HostKeyError`, dont le texte (`hostkey:{…json…}`) passe tel quel à
la page, qui l'affiche ; la clé vue est gardée en attente, et `Monitor.TrustHostKey` l'écrit.

### Statistiques

Un `watcher` par serveur suivi relève toutes les N secondes (`settings.json`), avec un recul
exponentiel jusqu'à 2 min quand le serveur ne répond pas, et s'arrête sur une clé à vérifier.
Chaque relevé est **une** commande shell (`statsScript`, précédée de `infoScript` au premier
relevé d'une connexion) ; `parseCounters` lit les compteurs, `sample` calcule les pourcentages et
débits depuis le relevé précédent. Le statut est diffusé par l'événement `status`
(`StatusChanged.Broadcast`) ; l'historique (720 relevés) se lit par `Monitor.History`.

### Flux vers la page

- Terminal : `Terminals.Open` ouvre le shell et renvoie un identifiant, `Terminals.Stream` envoie
  la sortie par un `mygo.Channel[[]byte]` (en base64 côté page) jusqu'à la fin du shell et renvoie
  son code de sortie. Fermer le canal ferme le terminal.
- Commandes : `Bulk.Run` envoie des `BulkEvent` (`start`, `output`, `done`) par un canal ;
  la sortie part par lignes entières, au plus toutes les 100 ms.

## Page (`web/`)

Scripts classiques chargés dans l'ordre, qui partagent leurs déclarations :

| Fichier | Rôle |
|---|---|
| `core.js` | appels Go, icônes, état, aides de mise en forme, dialogues, menu, barre latérale, actions sur les serveurs |
| `tabs.js` | les onglets (ajout, activation, fermeture, réordonnement, mosaïque, diffusion), la palette Ctrl K, les raccourcis |
| `home.js` | la vue d'ensemble : chiffres clés, cartes, liste triable, sélection, ajouts |
| `detail.js` | la page d'un serveur et les graphiques SVG (`lineChart`) |
| `term.js` | les onglets de terminal (xterm.js) |
| `bulk.js` | les commandes groupées |
| `settings.js` | le formulaire d'un serveur et les paramètres |
| `main.js` | le démarrage |

Un onglet est un objet `{ kind, pane, label(), render(), show(), hide(), destroy(), status(st), focus() }`
dont le panneau est cloné d'un `<template>` de `index.html`. `renderAll` redessine la barre
latérale, les onglets et l'onglet visible une fois par image au plus ; les statuts redessinent la
vue d'ensemble deux fois par seconde au plus.

Le style reprend celui de xdll (jetons `light-dark()` de `:root`, Segoe UI et Sitka pour les
titres, boutons, segments, dialogues, menus, toasts) et y ajoute la typographie à chasse fixe et
les couleurs de séries des tableaux de bord de supervision. xterm.js et ses extensions sont
copiés dans `web/vendor` : rien n'est chargé d'Internet.

## Pistes

- SFTP : parcourir, envoyer et recevoir des fichiers (`github.com/pkg/sftp` sur le même `Pool`).
- Redirections de ports locales et dynamiques (SOCKS), enregistrées par serveur.
- Panneaux dans un onglet (séparation horizontale / verticale).
- Historique des statistiques sur disque et alertes (seuils, notification système).
- Extraits de commandes enregistrés, variables par serveur.

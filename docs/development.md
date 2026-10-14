# Développement

Il faut Go 1.27 ou plus. MyGo est un outil du module (`go tool mygo`), rien d'autre à installer :
pas de Node ni de Bun, la page n'a pas d'étape de build.

```sh
go tool mygo dev                 # lance l'app, la recompile et la recharge à chaque modification
go test ./...                    # tests unitaires et de bout en bout (serveur SSH en mémoire)
go vet ./... && GOOS=linux go vet ./... && GOOS=darwin go build ./...
go tool mygo build               # build/windows-amd64/gossh.exe + installateur
```

Pour ne pas toucher aux vraies données, `GOSSH_DATA` change le dossier des données :

```sh
GOSSH_DATA=/tmp/gossh-dev go tool mygo dev
```

## Règles

Celles de xdll et de MyGo :

- **Pas de cgo** : tout doit compiler avec `CGO_ENABLED=0`. Le code propre à un OS passe par
  `golang.org/x/sys` ou des fichiers `_windows.go` / `_other.go`.
- Les méthodes liées tournent chacune dans sa goroutine : protéger l'état partagé (`Store.mu`,
  `Hub.mu`, `watcher.mu`…). Ne jamais appeler `Store.changed` en tenant `Store.mu`.
- Les erreurs montrées à l'utilisateur sont en français ; les commentaires du code en anglais.
- La page reste en JavaScript sans build : pas de dépendance npm, les bibliothèques vont dans
  `web/vendor` avec leur version exacte.
- Pas de requête vers Internet à l'exécution.

## Tests

| Test | Couvre |
|---|---|
| `stats_test.go` | l'analyse de `/proc` et `df` (y compris busybox), les calculs de pourcentages et de débits |
| `store_test.go` | l'inventaire, l'ajout en lot, le chiffrement, les groupes, l'import de `ssh_config` |
| `e2e_test.go` | un serveur SSH en mémoire : clé d'hôte inconnue puis approuvée, mot de passe refusé, rebond (ProxyJump), commandes groupées (sortie, stderr, codes), terminal (saisie, redimensionnement, code de sortie), statistiques |
| `real_test.go` | de vrais serveurs, si `GOSSH_REAL` est défini |

### Avec de vrais serveurs

Des conteneurs OpenSSH suffisent :

```sh
for i in 1 2 3; do
  docker run -d --name gossh-test-$i -e PASSWORD_ACCESS=true -e USER_NAME=test \
    -e USER_PASSWORD=test --hostname web-test-$i -p 127.0.0.1:2220$i:2222 \
    lscr.io/linuxserver/openssh-server
done
GOSSH_REAL="test:test@127.0.0.1:22201 test:test@127.0.0.1:22202" go test -run TestReal -v .
docker rm -f gossh-test-1 gossh-test-2 gossh-test-3
```

Dans l'app : **Ajout en lot** avec `test@127.0.0.1:22201 web-1` (une ligne par conteneur), puis
sélectionner tout, clic droit, **Définir le mot de passe…** `test`, et **Vérifier les clés**.

### Piloter l'app

Les builds avec `-tags gossh_automate` exécutent `$GOSSH_AUTOMATE/eval.js` dans la fenêtre dès
qu'il apparaît, écrivent le résultat dans `out.json` et une capture dans `shot.png` (c'est ainsi
que les images de la documentation ont été faites) :

```sh
go build -tags gossh_automate -o gossh-dev.exe .
GOSSH_DATA=./data GOSSH_AUTOMATE=./auto ./gossh-dev.exe &
echo 'openPalette(); return state.servers.length' > auto/eval.js
```

## Publier une version

Les apps installées se mettent à jour seules depuis les
[releases GitHub](https://github.com/Sutsikii/go-ssh/releases) (plugin `updater` de MyGo,
comme xdll) : une vérification par jour, puis une fenêtre propose d'installer. Chaque mise à
jour est signée ; l'app refuse ce qui ne l'est pas avec la clé dont la partie publique est
`updates.publicKey` de `mygo.json`.

1. Changer `version` dans `mygo.json` et ajouter une section `## x.y.z` en tête de
   `CHANGELOG.md` (elle devient les notes de la release, montrées dans la fenêtre de mise à jour).
2. Commiter, puis pousser le tag :

   ```sh
   git tag v0.2.0 && git push origin main v0.2.0
   ```

3. `.github/workflows/release.yml` vérifie que le tag correspond à la version, teste, construit
   l'exécutable, l'installateur, l'archive signée, le manifeste `update-windows-amd64.json` et
   les mises à jour delta, puis publie la release.

La clé secrète est dans le secret `MYGO_UPDATER_PRIVATE_KEY` du dépôt, et hors du dépôt dans
`%APPDATA%\mygo\update-keys\gossh\mygo-update.key` : la garder aussi dans un gestionnaire de
mots de passe. La perdre empêche toute mise à jour des apps installées.

Construire en local sans publier : `go tool mygo build` (dans `build/windows-amd64/`).

`.github/workflows/ci.yml` lance `go vet` et les tests sous Linux et Windows à chaque push.

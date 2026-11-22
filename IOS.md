# Follow Trail sur iPhone (App Store / TestFlight)

L'appli iPhone est compilée sur un Mac de GitHub, à chaque mise à jour du dépôt (onglet **Actions** › « Application iPhone (iOS) »). Pas besoin de Mac.

Tant que les clés Apple ne sont pas ajoutées, la compilation vérifie seulement que l'appli se construit, la lance dans le simulateur iPhone et publie des captures d'écran (branche `ci-ios`). Une fois les clés ajoutées, chaque mise à jour est aussi signée et envoyée sur **TestFlight**.

## Ce qu'il faut faire côté Apple (une seule fois)

1. **S'inscrire à l'Apple Developer Program** (developer.apple.com/programs, 99 $ par an), avec son identifiant Apple.
2. **Réserver l'identifiant de l'appli** : developer.apple.com › Certificates, Identifiers & Profiles › Identifiers › « + » › App IDs › App.
   - Description : `Follow Trail`
   - Bundle ID (Explicit) : `io.github.gregmey0.followtrail`
   - Rien d'autre à cocher.
3. **Créer la fiche de l'appli** : appstoreconnect.apple.com › Apps › « + » › Nouvelle app.
   - Plateforme iOS, nom `Follow Trail`, langue française, bundle ID `io.github.gregmey0.followtrail`, SKU `followtrail`.
4. **Créer une clé d'API** : App Store Connect › Utilisateurs et accès › Intégrations › Clés de l'API App Store Connect › « + ».
   - Accès : **Admin** (nécessaire pour que la compilation crée elle-même le certificat et le profil de signature).
   - Noter l'**ID de la clé** et l'**ID de l'émetteur** (Issuer ID), puis **télécharger le fichier `.p8`** : il ne se télécharge qu'une fois.
5. **Trouver l'identifiant d'équipe** (Team ID, 10 caractères) : developer.apple.com › Account › Membership details.
6. **Coller les 4 valeurs dans GitHub** : dépôt `followtrail` › Settings › Secrets and variables › Actions › « New repository secret » :

   | Nom du secret | Valeur |
   |---|---|
   | `ASC_KEY_ID` | ID de la clé |
   | `ASC_ISSUER_ID` | ID de l'émetteur |
   | `ASC_KEY_P8` | tout le contenu du fichier `.p8` (ouvert avec un éditeur de texte), lignes `BEGIN` et `END` comprises |
   | `APPLE_TEAM_ID` | identifiant d'équipe |

7. Relancer la compilation : onglet **Actions** › « Application iPhone (iOS) » › **Run workflow**.

## Tester sur son iPhone

- Installer l'appli **TestFlight** (App Store) sur l'iPhone.
- Dans App Store Connect › Follow Trail › TestFlight : la compilation apparaît après quelques minutes de traitement par Apple.
  - À la première compilation, Apple pose la question du **chiffrement** (« conformité à l'exportation ») : y répondre une fois.
  - S'ajouter comme testeur interne : l'invitation arrive dans TestFlight.
- Jusqu'à 100 testeurs internes (membres du compte) ; pour d'autres personnes, un groupe de test externe (courte vérification par Apple).

## Publier sur l'App Store

Sur App Store Connect : captures d'écran, description, **politique de confidentialité** (lien obligatoire), puis « Soumettre pour vérification ».

Points à expliquer à Apple dans les notes de vérification :
- **Position en arrière-plan** : le partage de la position avec le groupe ou les suiveurs continue téléphone verrouillé pendant une sortie ou une course ; l'utilisateur la démarre et l'arrête lui-même.
- **Audio en arrière-plan** : les messages d'encouragement reçus sont lus à voix haute pendant la course, téléphone verrouillé.
- Pour tester : créer un « Partage de ma course », ouvrir le lien de suivi dans Safari sur un autre appareil ; le mode simulation (Réglages) permet de bouger sans marcher.

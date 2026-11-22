# Follow Trail – course à pied et trail, en direct

Deux usages, sur la même appli :

- **📡 Partager ma course** : le coureur envoie un lien à sa famille et à ses amis. Ils l'ouvrent dans un simple navigateur, sans rien installer, et voient :
  - sa position et sa trace sur la carte, sa batterie ;
  - distance, temps, allure actuelle et moyenne, D+ / D−, VAM, km-effort ;
  - un **tableau par tronçons de 1 ou 5 km** : temps, allure et vitesse, D+ / D−, VAM ;
  - avec le GPX du parcours : avancement, dénivelé restant, profil, **arrivée estimée** et heures de passage aux points du GPX (ravitaillements…) ;
  - plusieurs coureurs à la fois sur la même carte ;
  - une mini messagerie d'**encouragements** : le coureur les reçoit en notification et **à voix haute**, et répond d'un appui (« 🙏 Merci ! », « 🥤 Au ravito »…).
- **👥 Group Run** : une sortie en groupe. Chacun voit les autres sur la carte, les stats et tronçons de chacun, les tracés GPX, et le groupe a sa messagerie (avec « 🆘 Besoin d'aide »). Un spectateur peut suivre toute la sortie sans partager sa position.

Sur ordinateur ou tablette, la carte et la fiche du coureur s'affichent côte à côte.

## Installer

- **Android** : télécharger [FollowTrail.apk](../../releases/latest/download/FollowTrail.apk) depuis le téléphone, l'ouvrir et autoriser l'installation. Le partage continue téléphone verrouillé, et les messages sont lus à voix haute.
- **Web (tout téléphone, iPhone compris)** : https://gregmey0.github.io/followtrail/ puis « Installer l'appli » / « Sur l'écran d'accueil ». Pour partager sa position depuis le navigateur, garder l'écran allumé. Pour suivre quelqu'un, aucune contrainte.

## Calculs

- **Altitude et dénivelé** : sur le tracé GPX suivi, l'altitude vient du GPX (plus juste que le GPS). Ailleurs, l'altitude GPS lissée est recalée sur l'écart GPX − GPS appris sur le tracé.
- **Arrivée estimée** : km-effort restants (1 km + 1 km par 100 m de D+) × allure par km-effort (60 % les 10 derniers km-effort, 40 % depuis le départ, pauses comprises). Calculée après 2 km-effort sur le tracé.
- **Tronçons** : calculés sur la trace partagée, identiques chez le coureur et chez ceux qui le suivent.

## Relais et confidentialité

Les échanges passent par un relais MQTT public (HiveMQ, à défaut EMQX). Tout est chiffré de bout en bout (AES-GCM) avec une clé dérivée du code : le relais ne voit que des données illisibles. En fin de sortie ou de partage, positions, traces et messages sont effacés du relais ; pour une course, seul le bilan final reste lisible par ceux qui ont le lien.

## Développement

- Sources : `src/js/*.js` (modules concaténés dans l'ordre), `src/style.css`, `src/body.html`, icônes générées par `src/icons/gen_icon.py`.
- `python3 build.py` produit `docs/` (version web, GitHub Pages) et `www/` (contenu de l'appli).
- Android : projet Capacitor dans `android/`, identifiant `io.github.gregmey0.followtrail`. Chaque push sur `main` compile l'APK (GitHub Actions) et le publie dans **Releases**.
- La clé `android/app/followtrail-sideload.jks` est volontairement publique : elle sert seulement à ce que chaque nouvelle version s'installe par-dessus la précédente. Une publication sur le Play Store demandera une clé privée.
- Mode simulation (Réglages) pour tester sans bouger. Pour les tests automatiques, `localStorage['flt.testbroker']` peut désigner un relais local (`ws://localhost:8883`).

Greg Meyer, STAPS Avignon. Tous droits réservés.

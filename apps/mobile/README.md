# apps/mobile — thème Flutter

Thème Material 3 équivalent aux jetons web, destiné aux applications gérant/employé/client.

- [`lib/theme/resto_tokens.g.dart`](lib/theme/resto_tokens.g.dart) — **généré** depuis
  `packages/design-tokens/tokens.json` (`npm run flutter:theme`).
- [`lib/theme/resto_theme.dart`](lib/theme/resto_theme.dart) — `ThemeData` clair/sombre, échelle
  typographique, cibles 44 px, `RestoStatusColors` (6 statuts de table), libellés FR/EN.

```dart
MaterialApp(
  theme: RestoTheme.light(),
  darkTheme: RestoTheme.dark(),
  themeMode: ThemeMode.system,
  home: const HomePage(),
)
```

```dart
final statuses = Theme.of(context).extension<RestoStatusColors>()!;
Container(color: statuses.tables[TableStatus.occupee]);
```

Commandes :

```bash
npm run flutter:theme        # regénère resto_tokens.g.dart
npm run flutter:theme:check  # échoue si le fichier Dart est désynchronisé
```

Limite : le SDK Flutter n'est pas installé sur le poste de développement actuel ; le thème est
livré en source, compilé dès que `flutter pub get && flutter analyze` est lancé (CI mobile à venir).

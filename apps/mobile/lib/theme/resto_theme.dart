import 'package:flutter/material.dart';

import 'resto_tokens.g.dart';

/// Statuts de table du contrat partagé (`TABLE_STATUSES`).
enum TableStatus { libre, reservee, occupee, addition, nettoyage, horsService }

extension TableStatusX on TableStatus {
  String get tokenKey => switch (this) {
        TableStatus.libre => 'table-free',
        TableStatus.reservee => 'table-reserved',
        TableStatus.occupee => 'table-occupied',
        TableStatus.addition => 'table-bill',
        TableStatus.nettoyage => 'table-cleaning',
        TableStatus.horsService => 'table-out',
      };

  String label(bool french) => switch (this) {
        TableStatus.libre => french ? 'Libre' : 'Free',
        TableStatus.reservee => french ? 'Réservée' : 'Reserved',
        TableStatus.occupee => french ? 'Occupée' : 'Occupied',
        TableStatus.addition => french ? "En attente d'addition" : 'Bill requested',
        TableStatus.nettoyage => french ? 'À nettoyer' : 'Cleaning',
        TableStatus.horsService => french ? 'Hors service' : 'Out of service',
      };
}

Color _color(Map<String, String> palette, String key) {
  final value = palette[key];
  if (value == null || !value.startsWith('#') || value.length != 7) {
    throw StateError('Jeton de couleur introuvable : $key');
  }
  return Color(int.parse('FF${value.substring(1)}', radix: 16));
}

double _px(Map<String, int> dimensions, String key) => dimensions[key]!.toDouble();

/// Couleurs sémantiques et statuts de table exposés au thème Material 3.
class RestoStatusColors extends ThemeExtension<RestoStatusColors> {
  const RestoStatusColors({
    required this.bg,
    required this.surface,
    required this.ink,
    required this.border,
    required this.tables,
  });

  final Color bg;
  final Color surface;
  final Color ink;
  final Color border;
  final Map<TableStatus, Color> tables;

  static RestoStatusColors of(Brightness brightness) {
    final palette =
        brightness == Brightness.dark ? RestoTokens.darkColors : RestoTokens.lightColors;
    return RestoStatusColors(
      bg: _color(palette, 'bg'),
      surface: _color(palette, 'surface'),
      ink: _color(palette, 'ink'),
      border: _color(palette, 'border'),
      tables: {
        for (final status in TableStatus.values)
          status: _color(palette, status.tokenKey),
      },
    );
  }

  @override
  RestoStatusColors copyWith({
    Color? bg,
    Color? surface,
    Color? ink,
    Color? border,
    Map<TableStatus, Color>? tables,
  }) {
    return RestoStatusColors(
      bg: bg ?? this.bg,
      surface: surface ?? this.surface,
      ink: ink ?? this.ink,
      border: border ?? this.border,
      tables: tables ?? this.tables,
    );
  }

  @override
  RestoStatusColors lerp(ThemeExtension<RestoStatusColors>? other, double t) {
    if (other is! RestoStatusColors) return this;
    return RestoStatusColors(
      bg: Color.lerp(bg, other.bg, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      ink: Color.lerp(ink, other.ink, t)!,
      border: Color.lerp(border, other.border, t)!,
      tables: {
        for (final status in TableStatus.values)
          status: Color.lerp(tables[status], other.tables[status], t)!,
      },
    );
  }
}

/// Thème Material 3 équivalent aux jetons web (clair et sombre).
class RestoTheme {
  const RestoTheme._();

  static ThemeData light() => _build(Brightness.light);

  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final palette =
        brightness == Brightness.dark ? RestoTokens.darkColors : RestoTokens.lightColors;
    final scheme = ColorScheme(
      brightness: brightness,
      primary: _color(palette, 'primary'),
      onPrimary: _color(palette, 'on-primary'),
      secondary: _color(palette, 'secondary'),
      onSecondary: _color(palette, 'on-secondary'),
      error: _color(palette, 'danger'),
      onError: _color(palette, 'on-inverse'),
      surface: _color(palette, 'surface'),
      onSurface: _color(palette, 'ink'),
      outline: _color(palette, 'border'),
    );
    final radius = Radius.circular(_px(RestoTokens.dimensions, 'radius-md'));
    final target = Size.square(_px(RestoTokens.dimensions, 'touch-target'));

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: _color(palette, 'bg'),
      fontFamily: RestoTokens.fontSans,
      textTheme: _textTheme(scheme),
      extensions: <ThemeExtension<dynamic>>[RestoStatusColors.of(brightness)],
      appBarTheme: AppBarTheme(
        backgroundColor: _color(palette, 'bg'),
        foregroundColor: scheme.onSurface,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: _textTheme(scheme).headlineSmall,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: target,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(radius)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: target,
          side: BorderSide(color: scheme.outline),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(radius)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: _color(palette, 'surface'),
        border: OutlineInputBorder(borderRadius: BorderRadius.all(radius)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(radius),
          borderSide: BorderSide(color: scheme.outline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(radius),
          borderSide: BorderSide(
            color: _color(palette, 'focus-ring'),
            width: _px(RestoTokens.dimensions, 'focus-width'),
          ),
        ),
      ),
      dividerColor: scheme.outline,
      snackBarTheme: SnackBarThemeData(
        backgroundColor: _color(palette, 'toast-bg'),
        contentTextStyle: TextStyle(color: _color(palette, 'toast-fg')),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  static TextTheme _textTheme(ColorScheme scheme) {
    final display = RestoTokens.fontDisplay;
    final sans = RestoTokens.fontSans;
    final d = RestoTokens.dimensions;
    TextStyle style(double size, {String? family, FontWeight weight = FontWeight.w400}) =>
        TextStyle(
          fontFamily: family,
          fontSize: size,
          fontWeight: weight,
          color: scheme.onSurface,
        );

    return TextTheme(
      displayLarge: style(_px(d, 'text-6xl').toDouble(), family: display),
      displayMedium: style(_px(d, 'text-5xl'), family: display),
      displaySmall: style(_px(d, 'text-4xl'), family: display),
      headlineLarge: style(_px(d, 'text-3xl'), family: display, weight: FontWeight.w600),
      headlineMedium: style(_px(d, 'text-2xl'), family: display, weight: FontWeight.w600),
      headlineSmall: style(_px(d, 'text-xl'), family: display, weight: FontWeight.w600),
      titleLarge: style(_px(d, 'text-lg'), weight: FontWeight.w600),
      titleMedium: style(_px(d, 'text-md'), weight: FontWeight.w600),
      titleSmall: style(_px(d, 'text-base'), weight: FontWeight.w600),
      bodyLarge: style(_px(d, 'text-md')),
      bodyMedium: style(_px(d, 'text-base')),
      bodySmall: style(_px(d, 'text-sm'), family: sans),
      labelLarge: style(_px(d, 'text-base'), weight: FontWeight.w600),
      labelMedium: style(_px(d, 'text-sm'), weight: FontWeight.w500),
      labelSmall: style(_px(d, 'text-xs'), weight: FontWeight.w500),
    );
  }
}

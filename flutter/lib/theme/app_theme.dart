import 'package:flutter/material.dart';

class AppTheme {
  AppTheme._();

  static const _lightPrimary = Color(0xFF5D8AA8);
  static const _lightSecondary = Color(0xFFC8A2C8);
  static const _darkPrimary = Color(0xFF8B5A2B);
  static const _darkSecondary = Color(0xFF4A90A4);

  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: _lightPrimary,
      secondary: _lightSecondary,
      brightness: Brightness.light,
    );
    return ThemeData(useMaterial3: true, colorScheme: scheme);
  }

  static ThemeData dark() {
    final scheme = ColorScheme.fromSeed(
      seedColor: _darkPrimary,
      secondary: _darkSecondary,
      brightness: Brightness.dark,
    );
    return ThemeData(useMaterial3: true, colorScheme: scheme);
  }
}

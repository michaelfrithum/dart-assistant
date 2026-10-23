# Dart Assistant

Lokaler Dart-Zähler für Home Assistant: 301/501/701, bis zu vier Spieler, Legs und Sets, Statistiken, Vollbild, Caller und eigene Sounds.

**Vorbereiteter Betastand: 1.9.0-beta.1.** Noch nicht auf einer echten Home-Assistant-Instanz getestet. Basis: installierte Version 1.8.6. Repository-Ziel: `michaelfrithum/dart-assistant`. Das Vorliegen dieses Quellpakets bedeutet nicht, dass das GitHub-Repository bereits veröffentlicht ist.

## Installation über HACS

Nach Veröffentlichung des Repositories:

1. In HACS das Menü **Benutzerdefinierte Repositories** öffnen.
2. `https://github.com/michaelfrithum/dart-assistant` hinzufügen, Typ **Integration**.
3. Dart Assistant herunterladen. Für die erste Beta gegebenenfalls Vorabversionen anzeigen lassen.
4. Home Assistant neu starten.
5. Einstellungen → Geräte & Dienste → Integration hinzufügen → **Dart Assistant**.
6. Browserseite neu laden und eine manuelle Dashboard-Karte anlegen:

```yaml
type: custom:dart-score-card
```

Die Integration lädt die Oberfläche und das Standardlogo automatisch. Bei einer Neuinstallation sind weder ein YAML-Eintrag noch eine manuell eingetragene JavaScript-Ressource nötig.

## Eigene Caller und Sounds importieren

Auf der Dart-Startseite das Zahnrad öffnen. Unter **Caller & Audio → Eigenes Soundpaket** eine ZIP auswählen. Maximale ZIP-Größe: 32 MB; entpackte MP3-Dateien zusammen höchstens 64 MB. Import erfordert ein HA-Administratorkonto.

```text
sounds/
  mein-leg-sieg.mp3
  meine-einlaufmusik.mp3
caller/
  Meine Stimme/
    0.mp3
    26.mp3
    60.mp3
    100.mp3
    140.mp3
    180.mp3
    gameon.mp3
    bullseye.mp3
```

Originalarchive mit `Caller/Stimme/*.mp3` oder `Sounds/*.mp3` werden ebenfalls akzeptiert. Auch das Audioverzeichnis innerhalb des privaten Weitergabepakets wird erkannt. Code und sonstige Dateien aus solchen ZIPs werden nicht installiert. Ein Paket muss mindestens eine gültige MP3-Datei enthalten. Die obige Liste ist ein Beispiel; ein vollständiger Caller braucht Ansagen für die erzielbaren Aufnahmesummen. Fehlende Clips werden übersprungen und in den Einstellungen angezeigt.

Danach Caller auswählen und die Vorschautaste antippen. Leg Win, Set Win, Match Win und Einlaufmusik lassen sich unabhängig auswählen; leer bedeutet stumm. **Game On und Bullseye sind im übernommenen Stand an den Caller gebunden.** Caller- und Soundlautstärke sind getrennt. Ausgabe erfolgt im Gerät, das das Dashboard anzeigt.

Gleiche Dateien werden beim erneuten Import übersprungen. Bei gleichem Namen und anderem Inhalt wird eine zusätzliche Datei mit Namenszusatz angelegt, statt die vorhandene Datei zu ersetzen. Bei Caller-Clips wird dadurch die alte Ansage weiter benutzt; für einen vollständig anderen Caller einen neuen Stimmenordner verwenden.

Eigene Dateien liegen weiterhin in `/config/www/darts/audio/`; hochgeladene Logos liegen unter `/config/www/dart-assistant/`. Beide liegen außerhalb des HACS-Installationsordners und bleiben bei einem Update erhalten. Nach externen Dateiänderungen **Dateiliste aktualisieren** antippen.

Im öffentlichen Quellpaket sind **keine fremden Caller-Aufnahmen oder Musikdateien** enthalten. Es enthält nur den Anwendungscode und das Dart-Assistant-Standardlogo. Für importierte Audiodateien ist der Nutzer selbst verantwortlich.

## Umstieg von der manuellen Version 1.8.6

1. Vollständige HA-Sicherung anlegen.
2. Dart Assistant über HACS installieren und HA neu starten.
3. Den alten manuellen Lovelace-Ressourceneintrag `/local/dart-score-card.js?...` entfernen, damit nicht parallel die alte Karte geladen wird. Die alte JS-Datei kann als Sicherung liegen bleiben.
4. Ein vorhandener YAML-Eintrag `dart_assistant: {}` bleibt zunächst gültig. Er wird als UI-Eintrag importiert. Sobald Dart Assistant unter Geräte & Dienste vorhanden ist, kann der YAML-Eintrag entfernt werden; danach neu starten.
5. Browser vollständig neu laden, Version und Einstellungen prüfen, erst danach ein reguläres Match beginnen.

Der Datenhaltungsschlüssel `dart_assistant` und die Browser-Speicherschlüssel bleiben gleich. Vorhandene Einstellungen, Profile, abgeschlossene Matches und eigene Audioverzeichnisse werden nicht durch Beispieldaten ersetzt. Der laufende Matchzustand bleibt browserlokal. Der Umstieg muss vor einer stabilen Veröffentlichung noch in HA getestet werden.

## Aktualisierung und Deaktivierung

Updates über HACS installieren, HA neu starten und Browser neu laden. Keine Dateien aus alten Weitergabepaketen darüberkopieren. Entfernen oder Deaktivieren des UI-Eintrags sperrt die WebSocket-Funktionen und entfernt die automatische Frontend-Registrierung; persönliche Daten und Audiodateien bleiben erhalten. Statische Dateien und bereits geladene Browseransichten verschwinden erst nach Neustart beziehungsweise Neuladen. Bei weiterhin vorhandenem YAML-Eintrag würde die Integration beim nächsten HA-Start erneut eingerichtet; diesen Eintrag daher bei gewünschter Deaktivierung ebenfalls entfernen.

## Manuelle Alternative

Den Ordner `custom_components/dart_assistant` nach `/config/custom_components/dart_assistant` kopieren, HA neu starten und die Integration über Geräte & Dienste hinzufügen. Auch dafür ist kein separates Kopieren von `www` nötig.

## Entwicklung und Prüfung

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
node tests/test_frontend.cjs
node --check custom_components/dart_assistant/frontend/dart-score-card.js
```

Die Python-Tests verwenden kleine HA-Testdoubles; sie ersetzen keinen Start in Home Assistant. Die vorbereitete GitHub-Action führt zusätzlich HACS-Validierung und Hassfest aus. Die Brands-Prüfung wird für das benutzerdefinierte Repository vorläufig ausgenommen; eine Aufnahme in den allgemeinen HACS-Katalog ist ein eigener späterer Schritt.

## Lizenz

Der Anwendungscode steht unter der [MIT-Lizenz](LICENSE), Copyright 2026 Michael Frithum. Diese Lizenz erteilt keine Rechte an fremden Audioaufnahmen, Musik oder separat importierten Inhalten. Drittanbieter-Audio wird nicht mitveröffentlicht.
